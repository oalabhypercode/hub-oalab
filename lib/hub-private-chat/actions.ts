"use server";

import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import { readMessage } from "@/lib/hub-conversations/rules";
import { notifyChat } from "@/lib/hub-notify/server";
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
    after(() => notifyChat({ side: viewer.side, customerId: input.customerId, company, authorId: viewer.userId, body: message.value }));
  }
  const fresh = await loadPrivateThread(viewer, input.customerId);
  const thread = fresh.ok ? fresh.data : before.data;
  return { ok: true, data: { ...thread, chat: { ...thread.chat, unread: false } } };
}
