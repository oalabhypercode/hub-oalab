import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { secondFactorMissing } from "@/lib/hub-auth/second-factor";
import { conversationState, isSender, isUnread, requestReference, type ConversationSender } from "./rules";
import type { ConversationMessage, ConversationsState, ConversationSummary, ConversationThread } from "./types";

// Conversations are the service platform's requests (service_requests) with their client-visible messages
// (request_messages). Service grants browsers no direct read of them, so the hub decides who reads what first and only
// then reads with the server key, like the projects:
// - admins pass the same check as the user management and read every customer's conversations, without answering;
// - customers read the requests of their company's organizations (hub_customer_members → hub_customers).

const REQUESTS = "id, request_number, title, state, version, organization_id, created_at, updated_at";
const MESSAGES = "id, request_id, sender_type, sender_user_id, body, body_format, created_at";
const LIST_LIMIT = 200;
const THREAD_LIMIT = 200;
const unavailable = "Die Gespräche konnten gerade nicht geladen werden. Bitte versuche es erneut.";

interface RequestRow { id: string; request_number: number; title: string; state: string; version: number; organization_id: string; created_at: string; updated_at: string }
interface MessageRow { id: string; request_id: string; sender_type: string; sender_user_id: string | null; body: string; body_format: string; created_at: string }
export interface ConversationViewer { readonly userId: string; readonly admin: boolean; readonly organizationIds: readonly string[] }

/** The signed-in login as a reader of conversations, once per request. */
export const conversationViewer = cache(async (): Promise<ConversationViewer | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  if (await secondFactorMissing(supabase, data.claims.aal)) return null;
  if (await verifyHubAdmin()) return { userId: data.claims.sub, admin: true, organizationIds: [] };
  // The own session reads the own company (RLS), so nobody can name somebody else's organization here.
  const members = await supabase.from("hub_customer_members").select("customer:hub_customers(organization_id)").eq("user_id", data.claims.sub)
    .returns<{ customer: { organization_id: string | null } | null }[]>();
  if (members.error) return null;
  const organizationIds = [...new Set((members.data ?? []).flatMap((row) => row.customer?.organization_id ? [row.customer.organization_id] : []))];
  return { userId: data.claims.sub, admin: false, organizationIds };
});

const chunks = <T,>(items: readonly T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

/** Names of the people who wrote, from their hub profiles. */
async function names(db: SupabaseClient, userIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return new Map();
  const { data } = await db.from("hub_profiles").select("user_id, first_name, last_name").in("user_id", ids)
    .returns<{ user_id: string; first_name: string; last_name: string }[]>();
  return new Map((data ?? []).map((row) => [row.user_id, `${row.first_name} ${row.last_name}`.trim()]).filter(([, name]) => name) as [string, string][]);
}

function toMessage(row: MessageRow, viewer: ConversationViewer, people: Map<string, string>): ConversationMessage | null {
  if (!isSender(row.sender_type)) return null;
  const sender: ConversationSender = row.sender_type;
  return {
    id: row.id,
    sender,
    own: !viewer.admin && sender === "client" && row.sender_user_id === viewer.userId,
    // Clients see the team as "oalab-Team"; admins see who of them wrote.
    name: row.sender_user_id && (sender === "client" || viewer.admin) ? people.get(row.sender_user_id) ?? null : null,
    body: row.body,
    markdown: row.body_format === "safe_markdown",
    at: row.created_at,
  };
}

function summarize(request: RequestRow, newest: MessageRow[], seenAt: string | null, viewer: ConversationViewer, people: Map<string, string>, company: string | null): ConversationSummary {
  const state = conversationState(request.state);
  const last = newest.map((row) => toMessage(row, viewer, people)).find((message) => message !== null) ?? null;
  const lastAnswer = newest.find((row) => row.sender_type === "oalab" || row.sender_type === "assistant");
  return {
    id: request.id,
    reference: requestReference(request.request_number),
    title: request.title,
    state: request.state,
    stateLabel: state.label,
    tone: state.tone,
    group: state.group,
    // Admins read along only; answers and internal notes come from NoteTree Business.
    canReply: !viewer.admin && state.canReply,
    version: request.version,
    company,
    lastAt: last?.at ?? request.updated_at,
    lastMessage: last && { body: last.body, sender: last.sender, own: last.own, name: last.name },
    unread: !viewer.admin && isUnread(lastAnswer?.created_at ?? null, seenAt),
  };
}

async function readRequests(db: SupabaseClient, viewer: ConversationViewer): Promise<RequestRow[] | null> {
  if (!viewer.admin && !viewer.organizationIds.length) return [];
  let query = db.from("service_requests").select(REQUESTS).is("trashed_at", null);
  if (!viewer.admin) query = query.in("organization_id", viewer.organizationIds);
  const { data, error } = await query.order("updated_at", { ascending: false }).limit(LIST_LIMIT).returns<RequestRow[]>();
  return error ? null : data ?? [];
}

/** The conversations of the signed-in login with their newest message and whether something new came. */
export const loadConversations = cache(async (): Promise<ConversationsState> => {
  const db = createAdminClient();
  if (!db) return { source: "service", readOnly: false, conversations: [], error: "Gespräche sind noch nicht eingerichtet: Es fehlt der Server-Schlüssel (SUPABASE_SECRET_KEY)." };
  const viewer = await conversationViewer();
  if (!viewer) return { source: "service", readOnly: false, conversations: [], error: unavailable };
  const requests = await readRequests(db, viewer);
  if (!requests) return { source: "service", readOnly: viewer.admin, conversations: [], error: unavailable };
  if (!requests.length) return { source: "service", readOnly: viewer.admin, conversations: [], error: null };

  const ids = requests.map((request) => request.id);
  // The newest messages of these requests, enough to find each one's last message and last answer.
  const [messageParts, seen, organizations] = await Promise.all([
    Promise.all(chunks(ids, 100).map((part) => db.from("request_messages").select(MESSAGES).in("request_id", part).eq("visibility", "client")
      .order("created_at", { ascending: false }).limit(1000).returns<MessageRow[]>())),
    viewer.admin ? null : db.from("request_seen").select("request_id, seen_at").eq("user_id", viewer.userId).in("request_id", ids).returns<{ request_id: string; seen_at: string }[]>(),
    viewer.admin ? db.from("organizations").select("id, name").in("id", [...new Set(requests.map((request) => request.organization_id))]).returns<{ id: string; name: string }[]>() : null,
  ]);
  if (messageParts.some((part) => part.error) || seen?.error || organizations?.error) return { source: "service", readOnly: viewer.admin, conversations: [], error: unavailable };

  const byRequest = new Map<string, MessageRow[]>();
  for (const row of messageParts.flatMap((part) => part.data ?? [])) byRequest.set(row.request_id, [...(byRequest.get(row.request_id) ?? []), row]);
  for (const rows of byRequest.values()) rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const seenAt = new Map((seen?.data ?? []).map((row) => [row.request_id, row.seen_at]));
  const companies = new Map((organizations?.data ?? []).map((row) => [row.id, row.name]));
  const people = await names(db, [...byRequest.values()].flatMap((rows) => rows[0]?.sender_user_id ? [rows[0].sender_user_id] : []));

  const conversations = requests
    .map((request) => summarize(request, byRequest.get(request.id) ?? [], seenAt.get(request.id) ?? null, viewer, people, companies.get(request.organization_id) ?? null))
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return { source: "service", readOnly: viewer.admin, conversations, error: null };
});

/** Real conversations for a signed-in login; the preview, the public demo and the demo logins keep their examples. */
export async function loadConversationsForIdentity(identity: { publicDemo: boolean; demoAccess: unknown }) {
  return identity.publicDemo || identity.demoAccess ? undefined : loadConversations();
}

/** How many conversations wait unread, for the sidebar and the tab bar. Admins read along and get no count. */
export async function countUnreadConversations(identity: { publicDemo: boolean; demoAccess: unknown }): Promise<number | undefined> {
  const state = await loadConversationsForIdentity(identity);
  return state ? state.conversations.filter((conversation) => conversation.unread).length : undefined;
}

/** One conversation with its messages, only if the viewer may read it. */
export async function loadThread(db: SupabaseClient, viewer: ConversationViewer, requestId: string): Promise<ConversationThread | null> {
  const request = await db.from("service_requests").select(REQUESTS).eq("id", requestId).is("trashed_at", null).maybeSingle<RequestRow>();
  if (request.error || !request.data) return null;
  if (!viewer.admin && !viewer.organizationIds.includes(request.data.organization_id)) return null;
  const [messages, seen, organization] = await Promise.all([
    db.from("request_messages").select(MESSAGES).eq("request_id", requestId).eq("visibility", "client")
      .order("created_at", { ascending: false }).limit(THREAD_LIMIT).returns<MessageRow[]>(),
    viewer.admin ? null : db.from("request_seen").select("seen_at").eq("request_id", requestId).eq("user_id", viewer.userId).maybeSingle<{ seen_at: string }>(),
    viewer.admin ? db.from("organizations").select("name").eq("id", request.data.organization_id).maybeSingle<{ name: string }>() : null,
  ]);
  if (messages.error) return null;
  const rows = messages.data ?? [];
  const people = await names(db, rows.flatMap((row) => row.sender_user_id ? [row.sender_user_id] : []));
  return {
    conversation: summarize(request.data, rows, seen?.data?.seen_at ?? null, viewer, people, organization?.data?.name ?? null),
    messages: rows.map((row) => toMessage(row, viewer, people)).filter((message) => message !== null).reverse(),
  };
}

/**
 * The client read the conversation: the service platform then skips its reply e-mail, as when reading in its own chat.
 * Admins read along and leave no mark. A failed mark only means the e-mail may still come.
 */
export async function markThreadSeen(db: SupabaseClient, viewer: ConversationViewer, requestId: string): Promise<void> {
  if (viewer.admin) return;
  const request = await db.from("service_requests").select("organization_id").eq("id", requestId).maybeSingle<{ organization_id: string }>();
  if (request.error || !request.data || !viewer.organizationIds.includes(request.data.organization_id)) return;
  await db.from("request_seen").upsert(
    { request_id: requestId, user_id: viewer.userId, organization_id: request.data.organization_id, seen_at: new Date().toISOString() },
    { onConflict: "request_id,user_id" },
  );
}
