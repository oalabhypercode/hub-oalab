import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { areaOf, areaSubject, DEFAULT_SUBSCRIPTIONS, eventKey, eventLine, mergeEvents, mergeGroup, readChatEvent, subscriptionsOf, type ChatArea, type ChatEvent } from "./rules";

// Cards in the private chat (24.11.2026, migration 202611240001_hub_chat_events in service-oalab). Only the server
// writes them, with the service role, right where the customer's notice is written (lib/hub-notify/server.ts and the
// calendar), so a card exists only where the bell has the same change. Nothing here throws: a card that cannot be
// written never breaks the change itself; the server log names the kind and the database's code, nothing more.
//
// The hub's chat only. Nothing here reads or writes the service platform (its requests, messages or quota), and
// nothing of it comes into the chat (rule of 23.11.2026).

export type ChatPost = {
  customerId: string;
  /** oalab's changes stand on oalab's side; a customer's request on the customer's. */
  side: "customer" | "oalab";
  /** Who made the change; null for what the studio reports by itself (it then comes from „oalab“). */
  authorId: string | null;
  event: ChatEvent;
  /** Unique per chat: a repeated run writes nothing twice (rules.ts eventKey). */
  key: string;
};

function logFailure(kind: string, error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message = error instanceof Error ? error.message.slice(0, 120) : "";
  console.error(`[hub-chat] card ${kind} failed`, code || message || "unknown");
}

/** Cards come into customers' chats; freelancers' chats follow in a step of their own (decision 11), archived ones never. */
async function cardsAllowed(db: SupabaseClient, customerId: string) {
  const { data, error } = await db.from("hub_customers").select("kind, archived_at").eq("id", customerId).maybeSingle<{ kind: string | null; archived_at: string | null }>();
  if (error) throw error;
  return Boolean(data) && (data?.kind ?? "customer") === "customer" && !data?.archived_at;
}

/** The chat's switch for an area; without a row the default (decision 7). A missing table (no migration) throws. */
async function subscribed(db: SupabaseClient, customerId: string, area: ChatArea) {
  const { data, error } = await db.from("hub_chat_subscriptions").select("enabled").eq("customer_id", customerId).eq("subject", areaSubject(area)).maybeSingle<{ enabled: boolean }>();
  if (error) throw error;
  return data ? data.enabled === true : DEFAULT_SUBSCRIPTIONS[area];
}

/**
 * The card a new change joins (plan 3.4): the chat's newest row, by the same person on the same side, of the same
 * group (files, one task, Vertrag & Domain), and nobody of the other side has looked at the chat since.
 */
async function joinable(db: SupabaseClient, post: ChatPost): Promise<{ id: string; event: ChatEvent } | null> {
  if (!mergeGroup(post.event)) return null;
  const last = await db.from("hub_private_messages").select("id, side, author_id, created_at, event").eq("customer_id", post.customerId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string; side: string; author_id: string | null; created_at: string; event: unknown }>();
  if (last.error || !last.data || last.data.side !== post.side || last.data.author_id !== post.authorId) return null;
  const previous = readChatEvent(last.data.event);
  const merged = previous && mergeEvents(previous, post.event);
  if (!merged) return null;
  const seen = await db.from("hub_private_reads").select("read_at").eq("customer_id", post.customerId).neq("side", post.side).gte("read_at", last.data.created_at).limit(1);
  if (seen.error || (seen.data ?? []).length) return null;
  return { id: last.data.id, event: merged };
}

/** Writes one card, or grows the newest one; respects the chat's subscriptions. Never throws. */
export async function postChatEvent(post: ChatPost): Promise<void> {
  const db = createAdminClient();
  if (!db) return;
  try {
    if (!(await cardsAllowed(db, post.customerId))) return;
    const area = areaOf(post.event.kind);
    if (area && !(await subscribed(db, post.customerId, area))) return;
    const target = await joinable(db, post);
    if (target) {
      // The grown card moves to now, like a merged line in the bell.
      const { error } = await db.from("hub_private_messages").update({ event: target.event, body: eventLine(target.event), created_at: new Date().toISOString() }).eq("id", target.id);
      if (!error) return;
      logFailure(post.event.kind, error);
    }
    const { error } = await db.from("hub_private_messages").insert({
      customer_id: post.customerId, side: post.side, author_id: post.authorId, body: eventLine(post.event), client_id: crypto.randomUUID(), event: post.event, event_key: post.key,
    });
    // The same change a second time (a repeated run): its card is there already.
    if (error && error.code !== "23505") logFailure(post.event.kind, error);
  } catch (error) {
    logFailure(post.event.kind, error);
  }
}

/** The same change for several customers' chats, one after the other. */
export async function postChatEvents(posts: readonly ChatPost[]) {
  for (const post of posts) await postChatEvent(post);
}

/** A grey line „… hat Aufgaben abonniert“ after someone switched an area of the chat. */
export const postSubscriptionLine = (input: { customerId: string; side: "customer" | "oalab"; authorId: string; area: ChatArea; on: boolean }) =>
  postChatEvent({
    customerId: input.customerId, side: input.side, authorId: input.authorId,
    event: { v: 1, kind: "subscription", area: input.area, on: input.on },
    key: eventKey("subscription", input.area, crypto.randomUUID()),
  });

/**
 * The switches of a chat as the reader's own session reads them (Row Level Security: the chat's logins and admins).
 * Null when the table is missing, before the migration: the chat then simply has no „Abos“.
 */
export async function loadChatSubscriptions(supabase: SupabaseClient, customerId: string): Promise<Record<ChatArea, boolean> | null> {
  const { data, error } = await supabase.from("hub_chat_subscriptions").select("subject, enabled").eq("customer_id", customerId).returns<{ subject: string; enabled: boolean }[]>();
  return error ? null : subscriptionsOf(data ?? []);
}
