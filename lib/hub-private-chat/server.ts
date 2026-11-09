import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { secondFactorMissing } from "@/lib/hub-auth/second-factor";
import { loadCustomerLogos } from "@/lib/hub-logos/server";
import type { CustomerLogo } from "@/lib/hub-logos/rules";
import { chatHref } from "@/lib/hub-notify/rules";
import { chatUnread, isChatSide, readByOtherSide, type ChatSide } from "./rules";
import type { PrivateChatMessage, PrivateChatResult, PrivateChatState, PrivateChatSummary, PrivateChatThread } from "./types";

// Private chats live in hub_private_messages (migration 202611040001_hub_private_chat in service-oalab). Reading and
// writing use the person's own session, so Row Level Security decides who sees which chat: the logins of a customer
// see their company's chat, admins all of them. Only names (from the profiles) and the read marks go through the
// server key, after the session has shown that the person may read the chat.

const MESSAGES = "id, customer_id, author_id, side, body, created_at";
/** The newest messages over all chats, enough to find each chat's last message and whether it is new. */
const LIST_LIMIT = 1000;
const THREAD_LIMIT = 300;
export const CHAT_UNAVAILABLE = "Der Chat konnte gerade nicht geladen werden. Bitte versuche es erneut.";
export const CHAT_NOT_SET_UP = "Der private Chat ist noch nicht eingerichtet: Die Datenbank-Migration steht noch aus.";
const NOT_FOUND = "Diesen Chat gibt es nicht oder nicht für dich.";

type MessageRow = { id: string; customer_id: string; author_id: string | null; side: string; body: string; created_at: string };
type ReadRow = { user_id: string; side: string; read_at: string };
type CustomerRow = { id: string; company: string; customer_number: string };
type Profile = { name: string; active: boolean };

export interface ChatViewer { readonly userId: string; readonly side: ChatSide; readonly customerIds: readonly string[] }

/** The chat tables are missing until the migration is applied. */
export const isMissingChat = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || /hub_private_/i.test(error.message ?? "")));

/** The signed-in login as a reader of private chats, once per request: admins read all, customers their company's. */
export const chatViewer = cache(async (): Promise<ChatViewer | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  if (await secondFactorMissing(supabase, data.claims.aal)) return null;
  if (await verifyHubAdmin()) return { userId: data.claims.sub, side: "oalab", customerIds: [] };
  // The own session reads the own memberships (RLS, only with an active profile).
  const members = await supabase.from("hub_customer_members").select("customer_id").eq("user_id", data.claims.sub).returns<{ customer_id: string }[]>();
  if (members.error) return null;
  return { userId: data.claims.sub, side: "customer", customerIds: [...new Set((members.data ?? []).map((row) => row.customer_id))] };
});

/** Names of the people who wrote or read along, from their hub profiles (server key, only for ids the reader may see). */
async function profiles(userIds: readonly string[]): Promise<Map<string, Profile>> {
  const ids = [...new Set(userIds)];
  const db = createAdminClient();
  if (!ids.length || !db) return new Map();
  const { data } = await db.from("hub_profiles").select("user_id, first_name, last_name, status").in("user_id", ids)
    .returns<{ user_id: string; first_name: string; last_name: string; status: string }[]>();
  return new Map((data ?? []).map((row) => [row.user_id, { name: `${row.first_name} ${row.last_name}`.trim(), active: row.status === "active" }]));
}

const nameOf = (people: Map<string, Profile>, userId: string | null) => (userId && people.get(userId)?.name) || null;

function toMessage(row: MessageRow, viewer: ChatViewer, people: Map<string, Profile>, otherReads: readonly string[]): PrivateChatMessage | null {
  if (!isChatSide(row.side)) return null;
  return {
    id: row.id,
    side: row.side,
    own: row.author_id === viewer.userId,
    name: nameOf(people, row.author_id),
    body: row.body,
    at: row.created_at,
    read: row.side === viewer.side && readByOtherSide(row.created_at, otherReads),
  };
}

/** A chat in the list; `newest` comes newest first. */
function summarize(customer: CustomerRow, newest: readonly MessageRow[], viewer: ChatViewer, people: Map<string, Profile>, readAt: string | null, logo: CustomerLogo | null): PrivateChatSummary {
  const last = newest.find((row) => isChatSide(row.side)) ?? null;
  const lastOther = newest.find((row) => row.side !== viewer.side);
  const lastOwnSide = newest.find((row) => row.side === viewer.side);
  return {
    customerId: customer.id,
    company: customer.company,
    customerNumber: customer.customer_number,
    logo,
    lastAt: last?.created_at ?? null,
    last: last && isChatSide(last.side) ? { body: last.body, side: last.side, own: last.author_id === viewer.userId, name: nameOf(people, last.author_id) } : null,
    unread: chatUnread({ lastOtherAt: lastOther?.created_at ?? null, lastOwnSideAt: lastOwnSide?.created_at ?? null, readAt }),
  };
}

async function readCustomers(supabase: SupabaseClient, viewer: ChatViewer) {
  if (viewer.side === "customer" && !viewer.customerIds.length) return { data: [] as CustomerRow[], error: null };
  const query = supabase.from("hub_customers").select("id, company, customer_number");
  return (viewer.side === "oalab" ? query : query.in("id", [...viewer.customerIds])).order("company").returns<CustomerRow[]>();
}

const failed = (viewer: ChatSide, error: string): PrivateChatState => ({ source: "live", viewer, chats: [], error });

/**
 * The chats of the signed-in login with their newest message and whether something new came: a customer's own
 * company, for admins every customer (those who wrote first). Shared by the layout's count and the page; the logos
 * come only with the page (loadPrivateChatPage), so the count costs no signed links.
 */
export const loadPrivateChats = cache(async (): Promise<PrivateChatState> => {
  const viewer = await chatViewer();
  if (!viewer) return failed("customer", CHAT_UNAVAILABLE);
  const supabase = await createClient();
  const customers = await readCustomers(supabase, viewer);
  if (customers.error) return failed(viewer.side, CHAT_UNAVAILABLE);
  const rows = customers.data ?? [];
  if (!rows.length) return { source: "live", viewer: viewer.side, chats: [], error: null };
  const messageQuery = supabase.from("hub_private_messages").select(MESSAGES);
  const [messages, reads] = await Promise.all([
    (viewer.side === "oalab" ? messageQuery : messageQuery.in("customer_id", rows.map((row) => row.id)))
      .order("created_at", { ascending: false }).limit(LIST_LIMIT).returns<MessageRow[]>(),
    supabase.from("hub_private_reads").select("customer_id, read_at").eq("user_id", viewer.userId).returns<{ customer_id: string; read_at: string }[]>(),
  ]);
  if (messages.error || reads.error) return failed(viewer.side, isMissingChat(messages.error ?? reads.error) ? CHAT_NOT_SET_UP : CHAT_UNAVAILABLE);

  const byCustomer = new Map<string, MessageRow[]>();
  for (const row of messages.data ?? []) byCustomer.set(row.customer_id, [...(byCustomer.get(row.customer_id) ?? []), row]);
  const readAt = new Map((reads.data ?? []).map((row) => [row.customer_id, row.read_at]));
  const people = await profiles([...byCustomer.values()].flatMap((list) => list[0]?.author_id ? [list[0].author_id] : []));
  const chats = rows
    .map((customer) => summarize(customer, byCustomer.get(customer.id) ?? [], viewer, people, readAt.get(customer.id) ?? null, null))
    .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? "") || a.company.localeCompare(b.company, "de"));
  return { source: "live", viewer: viewer.side, chats, error: null };
});

/** The page's chats: for admins with the logos set in the Asset Management, signed in one call. */
export async function loadPrivateChatPage(): Promise<PrivateChatState> {
  const state = await loadPrivateChats();
  if (state.viewer !== "oalab" || state.error || !state.chats.length) return state;
  const logos = await loadCustomerLogos(await createClient());
  return { ...state, chats: state.chats.map((chat) => ({ ...chat, logo: logos.get(chat.customerId) ?? null })) };
}

/** How many chats wait unread, for the sidebar and the tab bar. */
export async function countUnreadPrivateChats(): Promise<number | undefined> {
  const state = await loadPrivateChats();
  return state.error ? undefined : state.chats.filter((chat) => chat.unread).length;
}

/** One chat with its messages, only if the session may read it. */
export async function loadPrivateThread(viewer: ChatViewer, customerId: string): Promise<PrivateChatResult<PrivateChatThread>> {
  if (viewer.side === "customer" && !viewer.customerIds.includes(customerId)) return { ok: false, error: NOT_FOUND };
  const supabase = await createClient();
  const customer = await supabase.from("hub_customers").select("id, company, customer_number").eq("id", customerId).maybeSingle<CustomerRow>();
  if (customer.error || !customer.data) return { ok: false, error: NOT_FOUND };
  const admin = viewer.side === "oalab";
  const [messages, reads, members, logos] = await Promise.all([
    supabase.from("hub_private_messages").select(MESSAGES).eq("customer_id", customerId)
      .order("created_at", { ascending: false }).limit(THREAD_LIMIT).returns<MessageRow[]>(),
    supabase.from("hub_private_reads").select("user_id, side, read_at").eq("customer_id", customerId).returns<ReadRow[]>(),
    admin ? supabase.from("hub_customer_members").select("user_id").eq("customer_id", customerId).returns<{ user_id: string }[]>() : null,
    admin ? loadCustomerLogos(supabase, [customerId]) : null,
  ]);
  if (messages.error || reads.error) return { ok: false, error: isMissingChat(messages.error ?? reads.error) ? CHAT_NOT_SET_UP : CHAT_UNAVAILABLE };

  const rows = messages.data ?? [];
  const memberIds = (members?.data ?? []).map((row) => row.user_id);
  const people = await profiles([...rows.flatMap((row) => row.author_id ? [row.author_id] : []), ...memberIds]);
  const marks = reads.data ?? [];
  const otherReads = marks.filter((mark) => mark.side !== viewer.side).map((mark) => mark.read_at);
  const ownRead = marks.find((mark) => mark.user_id === viewer.userId)?.read_at ?? null;
  return {
    ok: true,
    data: {
      chat: summarize(customer.data, rows, viewer, people, ownRead, logos?.get(customerId) ?? null),
      messages: rows.map((row) => toMessage(row, viewer, people, otherReads)).filter((message) => message !== null).reverse(),
      people: memberIds.flatMap((id) => { const person = people.get(id); return person?.active && person.name ? [person.name] : []; }),
    },
  };
}

/**
 * The reader looked at the chat: their read mark (server key, only after loadPrivateThread showed that the session may
 * read the chat) and the chat's notices in the bell. A customer's own notices go; for admins the chat counts as seen by
 * the team, so the notice of every admin goes, and with it the mail that would still come.
 */
export async function markPrivateRead(viewer: ChatViewer, customerId: string): Promise<void> {
  const db = createAdminClient();
  if (!db) return;
  const at = new Date().toISOString();
  await db.from("hub_private_reads").upsert({ customer_id: customerId, user_id: viewer.userId, side: viewer.side, read_at: at }, { onConflict: "customer_id,user_id" });
  const notices = db.from("hub_inbox").update({ read_at: at }).eq("href", chatHref(customerId)).is("read_at", null);
  await (viewer.side === "oalab" ? notices.eq("kind", "chat.message") : notices.eq("kind", "chat.reply").eq("user_id", viewer.userId));
}
