import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { loadCustomerLogos } from "@/lib/hub-logos/server";
import type { CustomerLogo } from "@/lib/hub-logos/rules";
import { conversationState, isSender, requestReference, type ConversationSender } from "./rules";
import type { ConversationMessage, ConversationsState, ConversationSummary, ConversationThread } from "./types";

// Service conversations are the service platform's requests (service_requests) with their client-visible messages
// (request_messages). Since 4 November 2026 only admins read them in the hub, in the tab "Service"; customers write to
// oalab in their private chat (lib/hub-private-chat) and use the service platform for requests. Service grants browsers
// no direct read, so the hub first checks for an active admin and only then reads with the server key.

const REQUESTS = "id, request_number, title, state, organization_id, created_at, updated_at";
const MESSAGES = "id, request_id, sender_type, sender_user_id, body, body_format, created_at";
const LIST_LIMIT = 200;
const THREAD_LIMIT = 200;
const unavailable = "Die Gespräche konnten gerade nicht geladen werden. Bitte versuche es erneut.";

interface RequestRow { id: string; request_number: number; title: string; state: string; organization_id: string; created_at: string; updated_at: string }
interface MessageRow { id: string; request_id: string; sender_type: string; sender_user_id: string | null; body: string; body_format: string; created_at: string }
/** The hub customer behind an organization of the service platform, with its logo from the Asset Management. */
interface CompanyOf { readonly name: string | null; readonly customerId: string | null; readonly logo: CustomerLogo | null }

/** An active admin, once per request; nobody else reads service conversations in the hub. */
export const conversationReader = cache(async (): Promise<{ readonly userId: string } | null> => verifyHubAdmin());

const chunks = <T,>(items: readonly T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

/** Names of the people who wrote, from their hub profiles. */
async function names(db: SupabaseClient, userIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return new Map();
  const { data } = await db.from("hub_profiles").select("user_id, first_name, last_name").in("user_id", ids)
    .returns<{ user_id: string; first_name: string; last_name: string }[]>();
  return new Map((data ?? []).map((row) => [row.user_id, `${row.first_name} ${row.last_name}`.trim()]).filter(([, name]) => name) as [string, string][]);
}

/**
 * Company name, hub customer and logo per organization. The logos are a decoration: without them (missing migration,
 * failed signature) the initials stay.
 */
async function companies(db: SupabaseClient, organizationIds: readonly string[]): Promise<Map<string, CompanyOf> | null> {
  const ids = [...new Set(organizationIds)];
  if (!ids.length) return new Map();
  const [organizations, customers] = await Promise.all([
    db.from("organizations").select("id, name").in("id", ids).returns<{ id: string; name: string }[]>(),
    db.from("hub_customers").select("id, organization_id").in("organization_id", ids).returns<{ id: string; organization_id: string }[]>(),
  ]);
  if (organizations.error) return null;
  const customerOf = new Map((customers.data ?? []).map((row) => [row.organization_id, row.id]));
  const logos = await loadCustomerLogos(await createClient(), [...customerOf.values()]);
  return new Map(ids.map((id) => {
    const customerId = customerOf.get(id) ?? null;
    return [id, { name: organizations.data?.find((row) => row.id === id)?.name ?? null, customerId, logo: customerId ? logos.get(customerId) ?? null : null }];
  }));
}

function toMessage(row: MessageRow, people: Map<string, string>): ConversationMessage | null {
  if (!isSender(row.sender_type)) return null;
  const sender: ConversationSender = row.sender_type;
  return {
    id: row.id,
    sender,
    // Admins see who of the team or of the customer wrote.
    name: row.sender_user_id ? people.get(row.sender_user_id) ?? null : null,
    body: row.body,
    markdown: row.body_format === "safe_markdown",
    at: row.created_at,
  };
}

function summarize(request: RequestRow, newest: MessageRow[], people: Map<string, string>, company: CompanyOf | undefined): ConversationSummary {
  const state = conversationState(request.state);
  const last = newest.map((row) => toMessage(row, people)).find((message) => message !== null) ?? null;
  return {
    id: request.id,
    reference: requestReference(request.request_number),
    title: request.title,
    state: request.state,
    stateLabel: state.label,
    tone: state.tone,
    group: state.group,
    company: company?.name ?? null,
    customerId: company?.customerId ?? null,
    logo: company?.logo ?? null,
    lastAt: last?.at ?? request.updated_at,
    lastMessage: last && { body: last.body, sender: last.sender, name: last.name },
  };
}

const failed = (error: string): ConversationsState => ({ source: "service", conversations: [], error });

/** Every customer's service conversations with their newest message, for the admins' tab "Service". */
export const loadConversations = cache(async (): Promise<ConversationsState> => {
  const db = createAdminClient();
  if (!db) return failed("Gespräche sind noch nicht eingerichtet: Es fehlt der Server-Schlüssel (SUPABASE_SECRET_KEY).");
  if (!(await conversationReader())) return failed(unavailable);
  const requests = await db.from("service_requests").select(REQUESTS).is("trashed_at", null)
    .order("updated_at", { ascending: false }).limit(LIST_LIMIT).returns<RequestRow[]>();
  if (requests.error) return failed(unavailable);
  const rows = requests.data ?? [];
  if (!rows.length) return { source: "service", conversations: [], error: null };

  const ids = rows.map((request) => request.id);
  // The newest messages of these requests, enough to find each one's last message.
  const [messageParts, company] = await Promise.all([
    Promise.all(chunks(ids, 100).map((part) => db.from("request_messages").select(MESSAGES).in("request_id", part).eq("visibility", "client")
      .order("created_at", { ascending: false }).limit(1000).returns<MessageRow[]>())),
    companies(db, rows.map((request) => request.organization_id)),
  ]);
  if (messageParts.some((part) => part.error) || !company) return failed(unavailable);

  const byRequest = new Map<string, MessageRow[]>();
  for (const row of messageParts.flatMap((part) => part.data ?? [])) byRequest.set(row.request_id, [...(byRequest.get(row.request_id) ?? []), row]);
  for (const list of byRequest.values()) list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const people = await names(db, [...byRequest.values()].flatMap((list) => list[0]?.sender_user_id ? [list[0].sender_user_id] : []));

  const conversations = rows
    .map((request) => summarize(request, byRequest.get(request.id) ?? [], people, company.get(request.organization_id)))
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return { source: "service", conversations, error: null };
});

/** Real conversations for an admin login; customers get none. */
export async function loadConversationsForIdentity(identity: { account?: { role: string | null } | null }) {
  if (identity.account?.role !== "oalab_admin") return undefined;
  return loadConversations();
}

/** One conversation with its messages, for an admin. */
export async function loadThread(db: SupabaseClient, requestId: string): Promise<ConversationThread | null> {
  const request = await db.from("service_requests").select(REQUESTS).eq("id", requestId).is("trashed_at", null).maybeSingle<RequestRow>();
  if (request.error || !request.data) return null;
  const [messages, company] = await Promise.all([
    db.from("request_messages").select(MESSAGES).eq("request_id", requestId).eq("visibility", "client")
      .order("created_at", { ascending: false }).limit(THREAD_LIMIT).returns<MessageRow[]>(),
    companies(db, [request.data.organization_id]),
  ]);
  if (messages.error) return null;
  const rows = messages.data ?? [];
  const people = await names(db, rows.flatMap((row) => row.sender_user_id ? [row.sender_user_id] : []));
  return {
    conversation: summarize(request.data, rows, people, company?.get(request.data.organization_id)),
    messages: rows.map((row) => toMessage(row, people)).filter((message) => message !== null).reverse(),
  };
}
