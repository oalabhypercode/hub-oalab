"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import { markServiceRead } from "@/lib/hub-notify/server";
import { readMessage, requestReference, teamCommandError } from "./rules";
import { conversationReader, loadConversations, loadThread, readRequest, withUnread } from "./server";
import { testSitesForRequests } from "./test-site";
import type { ConversationResult, ConversationsState, ConversationThread, ServiceWriteKind } from "./types";
import type { TestSiteView } from "./work-status";

// Every action is a public POST endpoint: authenticate and authorise inside each one. Only active admins open service
// conversations in the hub. They write there only through the team command of the database
// (public.hub_service_command → app.business_team_command, migration 202611250001), which checks the admin's team
// access on the service platform, the request's version and a key per click again; the hub logs each step for the
// admin protocol.

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = { ok: false as const, error: "Dieses Gespräch gibt es nicht oder nicht für dich." };
const unavailable = { ok: false as const, error: "Die Gespräche konnten gerade nicht geladen werden. Bitte versuche es erneut." };

/** The list again, for the screen's regular look for news. */
export async function refreshConversations(): Promise<ConversationResult<ConversationsState>> {
  const state = await loadConversations();
  return state.error ? { ok: false, error: state.error } : { ok: true, data: await withUnread(state) };
}

/** Open a conversation to read along; its lines in the bell count as read for the whole team. */
export async function openConversation(input: { id: string }): Promise<ConversationResult<ConversationThread>> {
  if (!uuid.test(String(input?.id))) return notFound;
  const db = createAdminClient();
  if (!db || !(await conversationReader())) return unavailable;
  const thread = await loadThread(db, input.id);
  if (!thread) return notFound;
  // The counts in the sidebar and the tab bar come from the layout.
  if (await markServiceRead(input.id)) refreshWorkspace();
  return { ok: true, data: thread };
}

/**
 * The test sites of requests oalab works on, with the date of their last change: the list shows „Rückmeldung fehlt“
 * once a site changed and the AI did not report (26.11.2026). Asked after the list shows, so it never holds the page up.
 */
export async function serviceSites(input: { ids: string[] }): Promise<ConversationResult<Record<string, TestSiteView | null>>> {
  const ids = Array.isArray(input?.ids) ? [...new Set(input.ids.map(String).filter((id) => uuid.test(id)))].slice(0, 40) : [];
  if (!ids.length) return { ok: true, data: {} };
  const db = createAdminClient();
  if (!db || !(await conversationReader())) return unavailable;
  const sites = await testSitesForRequests(db, ids);
  return sites ? { ok: true, data: sites } : unavailable;
}

const COMMANDS = { hand_back: "work.hand_back", on_behalf: "message.on_behalf", reply: "message.reply" } as const;
const LOG = { hand_back: "service.hand_back", on_behalf: "service.on_behalf", reply: "service.reply" } as const;
type Command = keyof typeof COMMANDS;

/**
 * One team command on a service request. The key comes from the screen, one per click or draft, so a double click or a
 * repeated send after a lost answer stays one step. Answers with the conversation as it is afterwards; when the request
 * changed in between, with the fresh conversation and the reason.
 */
async function teamCommand(command: Command, input: { id: string; version: number; key: string; body?: string }): Promise<ConversationResult<ConversationThread>> {
  if (!uuid.test(String(input?.id)) || !uuid.test(String(input?.key)) || !Number.isInteger(input?.version)) return notFound;
  const db = createAdminClient();
  const admin = db ? await conversationReader() : null;
  if (!db || !admin) return unavailable;
  const request = await readRequest(db, input.id);
  if (!request) return notFound;
  const { error } = await db.rpc("hub_service_command", {
    actor: admin.userId,
    command_key: input.key,
    action: COMMANDS[command],
    input: { requestId: request.id, organizationId: request.organization_id, expectedVersion: input.version, ...(input.body === undefined ? {} : { body: input.body }) },
  });
  const thread = await loadThread(db, request.id);
  if (error) {
    const missing = error.code === "PGRST202" || /hub_service_command/.test(error.message ?? "");
    return { ok: false, error: missing ? "Eingreifen ist auf dem Server noch nicht eingerichtet. Bis dahin liest du hier nur mit." : teamCommandError(error.message), ...(thread ? { data: thread } : {}) };
  }
  const reference = requestReference(request.request_number);
  const summary = command === "hand_back"
    ? `${reference}: ${thread?.conversation.state === "release_review" ? "wieder zur Zustimmung freigegeben" : "an die KI zurückgegeben"}`
    : `${reference}: ${command === "on_behalf" ? "für den Kunden geschrieben" : "als oalab geantwortet"}`;
  const customerId = thread?.conversation.customerId ?? null;
  await db.from("hub_admin_events").insert({ actor_id: admin.userId, action: LOG[command], summary: summary.slice(0, 300), target_customer_id: customerId }).then(() => undefined, () => undefined);
  // The counts in the sidebar and the tab bar come from the layout.
  refreshWorkspace();
  return thread ? { ok: true, data: thread } : notFound;
}

/** „Wieder freigeben“ or „KI weitermachen lassen“: undo „Selbst nachbearbeiten“ or a stop in NoteTree. */
export async function handBackService(input: { id: string; version: number; key: string }): Promise<ConversationResult<ConversationThread>> {
  return teamCommand("hand_back", input);
}

/** Write into a service conversation: for the customer (counts as their message, the AI takes it up) or as oalab. */
export async function writeService(input: { id: string; version: number; key: string; kind: ServiceWriteKind; body: string }): Promise<ConversationResult<ConversationThread>> {
  if (input?.kind !== "on_behalf" && input?.kind !== "reply") return notFound;
  const message = readMessage(input.body);
  if (!message.ok) return message;
  return teamCommand(input.kind, { ...input, body: message.value });
}
