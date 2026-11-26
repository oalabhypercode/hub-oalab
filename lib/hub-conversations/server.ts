import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { loadCustomerLogos } from "@/lib/hub-logos/server";
import type { CustomerLogo } from "@/lib/hub-logos/rules";
import { readArchive } from "@/lib/hub-archive/server";
import { conversationState, isSender, requestReference, type ConversationSender } from "./rules";
import { noticeRequest } from "@/lib/hub-notify/rules";
import { previewMails, testSitesFor } from "./test-site";
import type { ConversationMessage, ConversationsState, ConversationSummary, ConversationThread, ServiceControls } from "./types";

// Service conversations are the service platform's requests (service_requests) with their client-visible messages
// (request_messages). Only admins see them in the hub, in the tab "Service"; customers write to oalab in their private
// chat (lib/hub-private-chat) and use the service platform for requests. Service grants browsers no direct read, so the
// hub first checks for an active admin and only then reads with the server key. Admins also step in there (migration
// 202611250001): give a request back, write for the customer or answer as oalab (./actions.ts).

const REQUESTS = "id, request_number, title, state, organization_id, project_id, created_at, updated_at";
// Results of oalab carry what landed on the test site (`delivery`); the hub only needs its kind (26.11.2026).
const MESSAGES = "id, request_id, sender_type, sender_user_id, body, body_format, created_at, delivery_kind:delivery->>kind";
// The team's mark on messages it wrote for a customer comes with migration 202611250001; without it every message reads
// as before (the second try leaves the column out).
const MESSAGES_TEAM = `${MESSAGES}, on_behalf`;
const LIST_LIMIT = 200;
const THREAD_LIMIT = 200;
const unavailable = "Die Gespräche konnten gerade nicht geladen werden. Bitte versuche es erneut.";

export interface RequestRow { id: string; request_number: number; title: string; state: string; organization_id: string; project_id: string | null; created_at: string; updated_at: string }
interface MessageRow { id: string; request_id: string; sender_type: string; sender_user_id: string | null; body: string; body_format: string; created_at: string; on_behalf?: boolean; delivery_kind?: string | null }

type Read<T> = PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>;
const missingColumn = (error: { code?: string; message?: string }) => error.code === "42703" || error.code === "PGRST204" || /on_behalf/.test(error.message ?? "");

/** Messages with the team's mark, or without it while the database does not know the column yet. */
async function readMessages<T>(query: (columns: string) => Read<T>) {
  const first = await query(MESSAGES_TEAM);
  return first.error && missingColumn(first.error) ? query(MESSAGES) : first;
}
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
    onBehalf: row.on_behalf === true && sender === "client",
    ...(sender === "oalab" && (row.delivery_kind === "preview" || row.delivery_kind === "work") ? { result: row.delivery_kind } : {}),
  };
}

function summarize(request: RequestRow, newest: MessageRow[], people: Map<string, string>, company: CompanyOf | undefined, aiPaused: boolean): ConversationSummary {
  const state = conversationState(request.state);
  const last = newest.map((row) => toMessage(row, people)).find((message) => message !== null) ?? null;
  return {
    // Newest first: who wrote last on each side, for „Rückmeldung fehlt“ (26.11.2026).
    lastClientAt: newest.find((row) => row.sender_type === "client")?.created_at ?? null,
    lastResultAt: newest.find((row) => row.sender_type === "oalab")?.created_at ?? null,
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
    lastMessage: last && { body: last.body, sender: last.sender, name: last.name, onBehalf: last.onBehalf },
    aiPaused,
  };
}

/**
 * Requests whose AI waits for a person: „Selbst nachbearbeiten“ in Service or stopped in NoteTree. A decoration of the
 * list; without it (no rights, older database) no request shows as paused.
 */
async function pausedRequests(db: SupabaseClient): Promise<ReadonlySet<string>> {
  const { data, error } = await db.from("business_automation_tasks").select("request_id").eq("state", "paused").limit(500).returns<{ request_id: string }[]>();
  return new Set(error ? [] : (data ?? []).map((row) => row.request_id));
}

const TEAM_ROLES = ["oalab_operator", "oalab_release_manager", "oalab_admin"];

/**
 * Whether an admin is on the oalab team of the service platform: the same rule as `app.user_is_oalab_staff`, which
 * the team command checks again. Cached per request; a failed read counts as access, so the database's own answer
 * stays the one the admin sees.
 */
const teamAccessOf = cache(async (userId: string): Promise<boolean> => {
  const db = createAdminClient();
  if (!db) return true;
  const { data, error } = await db.from("memberships").select("organization_id").eq("user_id", userId).eq("status", "active")
    .in("role", TEAM_ROLES).returns<{ organization_id: string }[]>();
  if (error) return true;
  const organizations = (data ?? []).map((row) => row.organization_id);
  if (organizations.length === 0) return false;
  const team = await db.from("organizations").select("id").in("id", organizations).eq("kind", "oalab").eq("status", "active").limit(1);
  return team.error ? true : (team.data ?? []).length > 0;
});

/** What an admin may do in one conversation; `null` keeps it read-only, as before the team controls existed. */
export async function readControls(db: SupabaseClient, requestId: string): Promise<ServiceControls | null> {
  const [{ data, error }, admin] = await Promise.all([db.rpc("hub_service_controls", { request: requestId }), conversationReader()]);
  if (error || !data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (!Number.isInteger(row.version)) return null;
  return {
    version: row.version as number,
    handBack: row.handBack === "client" || row.handBack === "ai" ? row.handBack : null,
    aiState: typeof row.aiState === "string" ? row.aiState : null,
    writable: row.writable === true,
    teamAccess: admin ? await teamAccessOf(admin.userId) : false,
  };
}

const failed = (error: string): ConversationsState => ({ source: "service", conversations: [], error });

/**
 * Every customer's service conversations with their newest message, for the admins' tab "Service". Those of archived
 * or deleted customers stay in Service, archived with their organization, and out of this list (lib/hub-archive).
 */
export const loadConversations = cache(async (): Promise<ConversationsState> => {
  const db = createAdminClient();
  if (!db) return failed("Gespräche sind noch nicht eingerichtet: Es fehlt der Server-Schlüssel (SUPABASE_SECRET_KEY).");
  if (!(await conversationReader())) return failed(unavailable);
  return readConversations(db);
});

/**
 * The requests with a customer's message the signed-in admin has not seen yet: their unread lines in the bell
 * (service.message, 23.11.2026), read with the admin's own session. Empty for everybody else.
 */
export const unreadServiceRequests = cache(async (): Promise<string[]> => {
  if (!(await conversationReader())) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from("hub_inbox").select("href").eq("kind", "service.message").is("read_at", null).limit(200).returns<{ href: string }[]>();
  if (error) return [];
  return [...new Set((data ?? []).map((row) => noticeRequest(row.href)).filter((id): id is string => Boolean(id)))];
});


/**
 * The list for a caller already checked as an admin: the page above, or the Claude connector after its key check
 * (lib/hub-mcp/areas.ts). Read with the server key; archived customers stay out.
 */
export async function readConversations(db: SupabaseClient): Promise<ConversationsState> {
  const archive = await readArchive(db);
  const query = db.from("service_requests").select(REQUESTS).is("trashed_at", null);
  const requests = await (archive.organizationIds.size ? query.not("organization_id", "in", `(${[...archive.organizationIds].join(",")})`) : query)
    .order("updated_at", { ascending: false }).limit(LIST_LIMIT).returns<RequestRow[]>();
  if (requests.error) return failed(unavailable);
  const rows = requests.data ?? [];
  if (!rows.length) return { source: "service", conversations: [], error: null };

  const ids = rows.map((request) => request.id);
  // The newest messages of these requests, enough to find each one's last message.
  const [messageParts, company, paused] = await Promise.all([
    Promise.all(chunks(ids, 100).map((part) => readMessages((columns) => db.from("request_messages").select(columns).in("request_id", part).eq("visibility", "client")
      .order("created_at", { ascending: false }).limit(1000).returns<MessageRow[]>()))),
    companies(db, rows.map((request) => request.organization_id)),
    pausedRequests(db),
  ]);
  if (messageParts.some((part) => part.error) || !company) return failed(unavailable);

  const byRequest = new Map<string, MessageRow[]>();
  for (const row of messageParts.flatMap((part) => part.data ?? [])) byRequest.set(row.request_id, [...(byRequest.get(row.request_id) ?? []), row]);
  for (const list of byRequest.values()) list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const people = await names(db, [...byRequest.values()].flatMap((list) => list[0]?.sender_user_id ? [list[0].sender_user_id] : []));

  const conversations = rows
    .map((request) => summarize(request, byRequest.get(request.id) ?? [], people, company.get(request.organization_id), paused.has(request.id)))
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return { source: "service", conversations, error: null };
}

/** Real conversations for an admin login, with the requests they have not seen yet; customers get none. */
export async function loadConversationsForIdentity(identity: { account?: { role: string | null } | null }) {
  if (identity.account?.role !== "oalab_admin") return undefined;
  return withUnread(await loadConversations());
}

/** The list with the requests the signed-in admin has not seen yet (the tab „Service“, 23.11.2026). */
export async function withUnread(state: ConversationsState): Promise<ConversationsState> {
  return state.error ? state : { ...state, unread: await unreadServiceRequests() };
}

/** The request behind a conversation, for the team's commands: its company of the service platform. */
export async function readRequest(db: SupabaseClient, requestId: string): Promise<RequestRow | null> {
  const request = await db.from("service_requests").select(REQUESTS).eq("id", requestId).is("trashed_at", null).maybeSingle<RequestRow>();
  return request.error ? null : request.data;
}

/**
 * One conversation with its messages and what an admin may do there, since 26.11.2026 with its test site (date of the
 * last change) and per result whether the e-mail „Neue Testansicht bereit“ went out.
 */
export async function loadThread(db: SupabaseClient, requestId: string): Promise<ConversationThread | null> {
  const request = await readRequest(db, requestId);
  if (!request) return null;
  const [messages, company, controls, sites, mails] = await Promise.all([
    readMessages((columns) => db.from("request_messages").select(columns).eq("request_id", requestId).eq("visibility", "client")
      .order("created_at", { ascending: false }).limit(THREAD_LIMIT).returns<MessageRow[]>()),
    companies(db, [request.organization_id]),
    readControls(db, requestId),
    testSitesFor(db, [request]),
    previewMails(db, requestId),
  ]);
  if (messages.error) return null;
  const rows = messages.data ?? [];
  const people = await names(db, rows.flatMap((row) => row.sender_user_id ? [row.sender_user_id] : []));
  return {
    conversation: summarize(request, rows, people, company?.get(request.organization_id), controls?.aiState === "paused"),
    messages: rows.map((row) => toMessage(row, people)).filter((message) => message !== null).reverse(),
    controls,
    testSite: sites.get(request.id) ?? null,
    mails,
  };
}
