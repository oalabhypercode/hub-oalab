"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import { markServiceRead } from "@/lib/hub-notify/server";
import { readMessage, requestReference, teamCommandError, teamIssueError, type TeamIssueAction } from "./rules";
import { conversationReader, isTeamRequest, loadConversations, loadThread, readRequest, withUnread } from "./server";
import { testSitesForRequests } from "./test-site";
import type { ConversationResult, ConversationsState, ConversationThread, ServiceWriteKind, TeamIssueReport } from "./types";
import type { TestSiteView } from "./work-status";

// Every action is a public POST endpoint: authenticate and authorise inside each one. Only active admins open service
// conversations in the hub. They write there only through the team command of the database
// (public.hub_service_command → app.business_team_command, migration 202611250001), which checks the admin's team
// access on the service platform, the request's version and a key per click again; the hub logs each step for the
// admin protocol. The team's own reports („NoteTree-Verbesserung“) are created, finished and reopened with
// public.hub_team_issue (migration 202611270002), with the same checks.

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
  if (command === "on_behalf" && await isTeamRequest(db, request)) return { ok: false, error: "Das ist eine Meldung aus dem Team. Hier schreibt niemand für einen Kunden." };
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

const ISSUE_LOG = { create: "service.team_issue", resolve: "service.team_issue_resolve", reopen: "service.team_issue_reopen" } as const;
const ISSUE_DONE = { create: "NoteTree-Problem gemeldet", resolve: "Meldung erledigt", reopen: "Meldung wieder geöffnet" } as const;
const issuesMissing = "Meldungen sind auf dem Server noch nicht eingerichtet. Bis dahin hilft der private Chat des Teams.";

/** The database's answer to a step on a team report (`app.business_team_issue`). */
interface IssueAnswer { requestId?: unknown; reference?: unknown; existing?: unknown; changed?: unknown; idempotentReplay?: unknown }

/**
 * One step on a team report. The key comes from the screen, one per draft or click. The hub logs only steps that
 * changed something, never a repeated send.
 */
async function teamIssue(action: TeamIssueAction, key: string, input: Record<string, unknown>): Promise<{ ok: true; db: NonNullable<ReturnType<typeof createAdminClient>>; requestId: string; existing: boolean } | { ok: false; error: string }> {
  const db = createAdminClient();
  const admin = db ? await conversationReader() : null;
  if (!db || !admin) return unavailable;
  const { data, error } = await db.rpc("hub_team_issue", { actor: admin.userId, command_key: key, action, input });
  if (error) {
    const missing = error.code === "PGRST202" || /hub_team_issue/.test(error.message ?? "");
    return { ok: false, error: missing ? issuesMissing : teamIssueError(error.message, action) };
  }
  const answer = (data ?? {}) as IssueAnswer;
  if (typeof answer.requestId !== "string") return unavailable;
  if (answer.changed === true && answer.idempotentReplay !== true) {
    await db.from("hub_admin_events").insert({ actor_id: admin.userId, action: ISSUE_LOG[action], summary: `${String(answer.reference)}: ${ISSUE_DONE[action]}`.slice(0, 300), target_customer_id: null }).then(() => undefined, () => undefined);
    // The counts in the sidebar and the tab bar come from the layout.
    refreshWorkspace();
  }
  return { ok: true, db, requestId: answer.requestId, existing: answer.existing === true };
}

/**
 * „NoteTree-Problem melden“: a request „NoteTree-Verbesserung“ in the OALab company, with the report as its first
 * message, optionally naming the customer's request it came up in. The same open text of the same person is not
 * reported twice; then the answer is the report that already exists.
 */
export async function reportTeamIssue(input: { key: string; body: string; relatedRequestId?: string }): Promise<ConversationResult<TeamIssueReport>> {
  if (!uuid.test(String(input?.key)) || (input.relatedRequestId !== undefined && !uuid.test(String(input.relatedRequestId)))) return notFound;
  const message = readMessage(input.body);
  if (!message.ok) return message;
  const step = await teamIssue("create", input.key, { body: message.value, ...(input.relatedRequestId ? { relatedRequestId: input.relatedRequestId } : {}) });
  if (!step.ok) return step;
  const thread = await loadThread(step.db, step.requestId);
  return thread ? { ok: true, data: { thread, existing: step.existing } } : { ok: false, error: "Die Meldung ist gespeichert, ließ sich aber gerade nicht laden. Sie steht gleich in der Liste." };
}

/** Finish or reopen a team report; the conversation comes back as it is afterwards, also when it changed in between. */
async function changeTeamIssue(action: "resolve" | "reopen", input: { id: string; version: number; key: string; body?: string }): Promise<ConversationResult<ConversationThread>> {
  if (!uuid.test(String(input?.id)) || !uuid.test(String(input?.key)) || !Number.isInteger(input?.version)) return notFound;
  const step = await teamIssue(action, input.key, { requestId: input.id, expectedVersion: input.version, ...(input.body === undefined ? {} : { body: input.body }) });
  const db = step.ok ? step.db : createAdminClient();
  const thread = db && (step.ok || await conversationReader()) ? await loadThread(db, input.id) : null;
  if (!step.ok) return { ok: false, error: step.error, ...(thread ? { data: thread } : {}) };
  return thread ? { ok: true, data: thread } : notFound;
}

/** „Erledigt“ on a team report, with `body` as the last answer to the team („Antworten & erledigen“). */
export async function resolveTeamIssue(input: { id: string; version: number; key: string; body?: string }): Promise<ConversationResult<ConversationThread>> {
  if (input?.body === undefined) return changeTeamIssue("resolve", input);
  const message = readMessage(input.body);
  if (!message.ok) return message;
  return changeTeamIssue("resolve", { ...input, body: message.value });
}

/** „Wieder öffnen“ on a finished team report. */
export async function reopenTeamIssue(input: { id: string; version: number; key: string }): Promise<ConversationResult<ConversationThread>> {
  return changeTeamIssue("reopen", { id: input?.id, version: input?.version, key: input?.key });
}
