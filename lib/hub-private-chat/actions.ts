"use server";

import { after } from "next/server";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { siteOrigin } from "@/lib/site-origin";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import { readMessage } from "@/lib/hub-conversations/rules";
import { notifyChat } from "@/lib/hub-notify/server";
import { areaSubject, isChatArea } from "@/lib/hub-chat-events/rules";
import { postSubscriptionLine } from "@/lib/hub-chat-events/server";
import { writeAppointment } from "@/lib/hub-calendar/write";
import { dayOf, timeOf } from "@/lib/hub-calendar/rules";
import { CHAT_NOT_SET_UP, CHAT_UNAVAILABLE, chatViewer, isMissingChat, loadPrivateChats, loadPrivateThread, markPrivateRead } from "./server";
import type { PrivateChatResult, PrivateChatState, PrivateChatThread } from "./types";

// Every action is a public POST endpoint: authenticate and authorise inside each one. Reading and writing use the
// person's own session, so Row Level Security has the last word; read marks and notices follow only after the session
// has read the chat.

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = { ok: false as const, error: "Diesen Chat gibt es nicht oder nicht für dich." };

/** The list again, for the screen's regular look for news. */
export async function refreshPrivateChats(): Promise<PrivateChatResult<PrivateChatState>> {
  const state = await loadPrivateChats();
  return state.error ? { ok: false, error: state.error } : { ok: true, data: state };
}

/**
 * Open a chat or look at it again: its messages, and the reader's read mark when something new came (or always, when
 * the person opens it), which also clears the chat's notices in the bell.
 */
export async function openPrivateChat(input: { customerId: string; opened?: boolean }): Promise<PrivateChatResult<PrivateChatThread>> {
  if (!uuid.test(String(input?.customerId))) return notFound;
  const viewer = await chatViewer();
  if (!viewer) return { ok: false, error: CHAT_UNAVAILABLE };
  const thread = await loadPrivateThread(viewer, input.customerId);
  if (!thread.ok) return thread;
  if (thread.data.chat.unread || input.opened === true) {
    await markPrivateRead(viewer, input.customerId);
    // The counts in the sidebar and the tab bar come from the layout.
    if (thread.data.chat.unread) refreshWorkspace();
  }
  return { ok: true, data: { ...thread.data, chat: { ...thread.data.chat, unread: false } } };
}

/**
 * A message in a private chat: customers write for their company, admins as oalab (the database checks both). The same
 * draft sent twice stays one message. Afterwards the other side hears of it in the bell and, unless they read it in
 * time, by mail.
 */
export async function sendPrivateMessage(input: { customerId: string; body: string; clientId: string }): Promise<PrivateChatResult<PrivateChatThread>> {
  if (!uuid.test(String(input?.customerId)) || !uuid.test(String(input?.clientId))) return notFound;
  const message = readMessage(input.body);
  if (!message.ok) return message;
  const viewer = await chatViewer();
  if (!viewer) return { ok: false, error: CHAT_UNAVAILABLE };
  const before = await loadPrivateThread(viewer, input.customerId);
  if (!before.ok) return before;

  const supabase = await createClient();
  const { error } = await supabase.from("hub_private_messages").insert({ customer_id: input.customerId, side: viewer.side, body: message.value, client_id: input.clientId });
  const repeated = error?.code === "23505";
  if (error && !repeated) return { ok: false, error: isMissingChat(error) ? CHAT_NOT_SET_UP : "Die Nachricht ist nicht angekommen. Bitte versuche es erneut." };

  await markPrivateRead(viewer, input.customerId);
  if (!repeated) {
    const { company } = before.data.chat;
    // The links in Telegram lead to this hub; the address is read now, while the request is still there.
    const origin = siteOrigin(await headers()) ?? "https://hub.oalab.de";
    after(() => notifyChat({ side: viewer.side, customerId: input.customerId, company, authorId: viewer.userId, body: message.value, origin }));
  }
  const fresh = await loadPrivateThread(viewer, input.customerId);
  const thread = fresh.ok ? fresh.data : before.data;
  return { ok: true, data: { ...thread, chat: { ...thread.chat, unread: false } } };
}

const fresh = async (viewer: NonNullable<Awaited<ReturnType<typeof chatViewer>>>, customerId: string): Promise<PrivateChatResult<PrivateChatThread>> => {
  const thread = await loadPrivateThread(viewer, customerId);
  return thread.ok ? { ok: true, data: { ...thread.data, chat: { ...thread.data.chat, unread: false } } } : thread;
};

/**
 * „Abos“ (24.11.2026, decision 6): one area of a chat on or off, for everybody in it, by the customer's logins or by
 * admins. Written with the person's own session, so Row Level Security has the last word; afterwards the chat gets a
 * grey line naming who switched what. Never anything of the service platform.
 */
export async function setChatSubscription(input: { customerId: string; area: string; enabled: boolean }): Promise<PrivateChatResult<PrivateChatThread>> {
  if (!uuid.test(String(input?.customerId)) || !isChatArea(input?.area) || typeof input?.enabled !== "boolean") return notFound;
  const viewer = await chatViewer();
  if (!viewer) return { ok: false, error: CHAT_UNAVAILABLE };
  const before = await loadPrivateThread(viewer, input.customerId);
  if (!before.ok) return before;
  if (!before.data.subscriptions) return { ok: false, error: "Abos gibt es in diesem Chat noch nicht." };
  if (before.data.subscriptions[input.area] === input.enabled) return fresh(viewer, input.customerId);
  const supabase = await createClient();
  const { error } = await supabase.from("hub_chat_subscriptions")
    .upsert({ customer_id: input.customerId, subject: areaSubject(input.area), enabled: input.enabled }, { onConflict: "customer_id,subject" });
  if (error) return { ok: false, error: "Das Abo konnte gerade nicht gespeichert werden. Bitte versuche es erneut." };
  await postSubscriptionLine({ customerId: input.customerId, side: viewer.side, authorId: viewer.userId, area: input.area, on: input.enabled });
  return fresh(viewer, input.customerId);
}

type RequestRow = { id: string; title: string; description: string | null; customer_id: string | null; teams_url: string | null; status: string; starts_at: string; ends_at: string };

/**
 * Admins confirm a customer's request right in its card (decision 9), at the time it was asked for: the same as
 * answering it in the calendar, so the customer gets the confirmation in the bell, by mail and as a card. Another time
 * or a decline goes through the calendar („Im Kalender beantworten“).
 */
export async function confirmChatRequest(input: { customerId: string; appointmentId: string }): Promise<PrivateChatResult<PrivateChatThread>> {
  if (!uuid.test(String(input?.customerId)) || !uuid.test(String(input?.appointmentId))) return notFound;
  const viewer = await chatViewer();
  if (!viewer) return { ok: false, error: CHAT_UNAVAILABLE };
  if (viewer.side !== "oalab") return { ok: false, error: "Anfragen bestätigt das oalab-Team." };
  const supabase = await createClient();
  const { data } = await supabase.from("hub_appointments").select("id, title, description, customer_id, teams_url, status, starts_at, ends_at").eq("id", input.appointmentId).maybeSingle<RequestRow>();
  if (!data || data.customer_id !== input.customerId) return { ok: false, error: "Diese Anfrage gibt es nicht mehr." };
  if (data.status !== "requested") return { ok: false, error: "Diese Anfrage ist schon beantwortet." };
  const start = Date.parse(data.starts_at);
  if (!(start > Date.now())) return { ok: false, error: "Diese Anfrage liegt in der Vergangenheit. Bitte im Kalender beantworten." };
  const saved = await writeAppointment(supabase, data.id, {
    title: data.title, description: data.description ?? "", customerId: data.customer_id, teamsUrl: data.teams_url ?? "",
    day: dayOf(start), start: timeOf(start), minutes: Math.round((Date.parse(data.ends_at) - start) / 60_000),
  }, viewer.userId);
  if (!saved.ok) return saved;
  refreshWorkspace();
  return fresh(viewer, input.customerId);
}
