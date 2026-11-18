import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { createAdminClient } from "@/lib/supabase/admin";
import { readDeactivatedLogins } from "@/lib/hub-users/deactivated";
import { hasTaskChange, type TaskChange } from "@/lib/hub-notify/rules";
import { notifyTaskChange } from "@/lib/hub-notify/server";
import {
  audienceColumns, cleanDay, cleanLabels, cleanText, cleanTitle, diffTask, isAudience, isPriority, isStatus, MAX_TITLE, ORDER_LIMIT, SNAPSHOT_COLUMNS, TASK_COLUMNS, toBoardTask,
  type StudioTaskRow, type TaskSnapshot,
} from "./rules";
import type { BoardTask, TaskComment, TaskPatch, TaskResult, TaskSubtask } from "./types";

// What the task board writes once the caller has passed its checks, shared by the board's actions
// (lib/hub-tasks/actions.ts, the person's own session) and the Claude connector (lib/hub-mcp/writes.ts, a key with the
// admin's claims). Writes go through `supabase`, so Studio's RLS and triggers decide, raise the version and log the
// change under the person's name. Changes carry the version the caller saw; a newer row is never overwritten
// ("stale"). Refreshing the page is the caller's business: only a Server Action can do it. Everyone else who sees the
// card hears of a change in the bell (lib/hub-notify, 17.11.2026).

type Db = NonNullable<ReturnType<typeof createAdminClient>>;
/**
 * `supabase`: the person's own session (or the connector's key with the admin's claims), for every write. `read`: what
 * checks read with: the server key for admins, the own session for freelancers. `db`: the server key, for project rows.
 */
export type TaskContext = { userId: string; supabase: SupabaseClient; read: SupabaseClient; db: Db; freelancer: boolean };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const STALE = "Die Aufgabe wurde inzwischen geändert. Das Board zeigt jetzt den neuesten Stand.";
export const TEAM_DECIDES = "Archivieren, die Freigabe für Kunden und „Nur Team“ bleiben beim oalab-Team.";
export const fail = (error: string, stale = false) => ({ ok: false as const, error, ...(stale ? { stale: true } : {}) });

/**
 * Studio refuses writes from logins without a team role or outside the project (42501), fields that stay with the
 * team (its freelancer guard) and assignees who are neither in the team nor freelancers of the project (its trigger).
 */
export function writeError(error: { code?: string; message?: string } | null, freelancer: boolean): string {
  const message = error?.message ?? "";
  if (message.includes("STUDIO_FREELANCER_FIELD_LOCKED")) return TEAM_DECIDES;
  if (message.includes("STUDIO_FREELANCER_MUST_SERVE_CUSTOMER")) return "Dieser Freelancer betreut den Kunden des Projekts nicht. Ordne ihn zuerst im User Management dem Kunden zu.";
  if (message.includes("STUDIO_ASSIGNEE_MUST_BE_ACTIVE_TEAM_MEMBER")) return "Zuständig können nur aktive Mitglieder des oalab-Teams und Freelancer dieses Projekts sein.";
  if (message.includes("STUDIO_INVALID_LABELS")) return "Ein Label ist leer, zu lang oder doppelt.";
  if (error?.code === "42501") {
    return freelancer
      ? "Speichern abgelehnt: Dieses Projekt oder diese Aufgabe ist für dich nicht mehr freigegeben. Lade die Seite neu."
      : "Speichern abgelehnt: Dein Konto braucht im Studio eine Team-Rolle mit bestätigtem zweiten Faktor.";
  }
  return "Das hat nicht geklappt. Bitte versuche es erneut.";
}

export const numberOf = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
export const idOf = (value: unknown) => (typeof value === "string" && uuid.test(value) ? value : null);

/** Why an update by version hit no row: gone, archived or simply newer. Freelancers learn only "gone". */
export async function whyNotWritten(ctx: Pick<TaskContext, "read">, taskId: string) {
  const { data } = await ctx.read.from("studio_tasks").select("archived").eq("id", taskId).maybeSingle<{ archived: boolean }>();
  if (!data) return fail("Diese Aufgabe gibt es nicht mehr.", true);
  if (data.archived) return fail("Diese Aufgabe wurde archiviert.", true);
  return fail(STALE, true);
}

/** Checks the fields of a change; only known fields with valid values become columns. Freelancers choose no audience. */
function patchColumns(patch: TaskPatch, freelancer: boolean): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  const columns: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const title = cleanTitle(patch.title);
    if (!title) return { ok: false, error: `Der Titel fehlt oder ist länger als ${MAX_TITLE} Zeichen.` };
    columns.title = title;
  }
  if (patch.description !== undefined) {
    const text = cleanText(patch.description);
    if (text === null) return { ok: false, error: "Die Beschreibung ist zu lang." };
    columns.description = text;
  }
  if (patch.priority !== undefined) {
    if (!isPriority(patch.priority)) return { ok: false, error: "Diese Priorität gibt es nicht." };
    columns.priority = patch.priority;
  }
  if (patch.dueOn !== undefined) {
    const day = cleanDay(patch.dueOn);
    if (day === undefined) return { ok: false, error: "Das Datum ist ungültig." };
    columns.due_date = day;
  }
  if (patch.labels !== undefined) {
    const labels = cleanLabels(patch.labels);
    if (!labels) return { ok: false, error: "Ein Label ist leer, zu lang oder doppelt (höchstens 12)." };
    columns.labels = labels;
  }
  if (patch.assigneeIds !== undefined) {
    if (!Array.isArray(patch.assigneeIds) || patch.assigneeIds.length > 20 || patch.assigneeIds.some((value) => !idOf(value))) return { ok: false, error: "Diese Zuständigkeit ist ungültig." };
    columns.assignee_user_ids = [...new Set(patch.assigneeIds)];
  }
  if (patch.audience !== undefined) {
    if (freelancer) return { ok: false, error: TEAM_DECIDES };
    if (!isAudience(patch.audience)) return { ok: false, error: "Diese Sichtbarkeit ist ungültig." };
    Object.assign(columns, audienceColumns(patch.audience));
  }
  return { ok: true, data: columns };
}

export const DEACTIVATED_ASSIGNEE = "Zuständig können nur aktive Zugänge sein: Eine gewählte Person ist im User Management deaktiviert.";

/** Studio knows nothing of the hub's deactivation (lib/hub-users/deactivated.ts): the hub refuses such an assignee itself. */
async function deactivatedAssignee(ctx: TaskContext, columns: Record<string, unknown>): Promise<string | null> {
  const ids = columns.assignee_user_ids as string[] | undefined;
  if (!ids?.length) return null;
  const deactivated = await readDeactivatedLogins(ctx.db, ids);
  if (!deactivated) return "Das hat nicht geklappt. Bitte versuche es erneut.";
  return deactivated.size ? DEACTIVATED_ASSIGNEE : null;
}

/** The saved card as the board shows it: deactivated assignees stay hidden, as on the board itself. */
async function shownTask(ctx: TaskContext, row: StudioTaskRow): Promise<BoardTask> {
  const ids = row.assignee_user_ids ?? [];
  const deactivated = ids.length ? await readDeactivatedLogins(ctx.db, ids) : null;
  return toBoardTask(row, undefined, deactivated ?? undefined);
}

/**
 * Tells everyone else who sees the card, once the response is out: dragging a card never waits for the bell. `before`
 * is the card before the change where it may have changed who sees it (see notifyTaskChange).
 */
export function tellOthers(ctx: Pick<TaskContext, "userId" | "freelancer">, taskId: string, change: TaskChange, before?: TaskSnapshot | null) {
  if (!hasTaskChange(change)) return;
  after(() => notifyTaskChange({ taskId, actorId: ctx.userId, actorFreelancer: ctx.freelancer, change, before }));
}

/** The card as it was, for the bell; null when it cannot be read (then nobody hears of the change). */
async function snapshotOf(ctx: TaskContext, taskId: string) {
  const { data } = await ctx.read.from("studio_tasks").select(SNAPSHOT_COLUMNS).eq("id", taskId).maybeSingle<TaskSnapshot>();
  return data ?? null;
}

/** Moves a card to a column and a place (board_order). A new place in the same column tells nobody. */
export async function moveTaskAs(ctx: TaskContext, input: { taskId: string; status: string; order: number; expectedVersion: number }): Promise<TaskResult<BoardTask>> {
  const taskId = idOf(input?.taskId);
  const order = numberOf(input?.order);
  const version = numberOf(input?.expectedVersion);
  if (!taskId || !isStatus(input?.status) || order === null || Math.abs(order) > ORDER_LIMIT || version === null) return fail("Diese Verschiebung ist ungültig.");
  const before = await snapshotOf(ctx, taskId);
  const { data, error } = await ctx.supabase.from("studio_tasks").update({ status: input.status, board_order: order }).eq("id", taskId).eq("version", version).select(TASK_COLUMNS).maybeSingle<StudioTaskRow>();
  if (error) return fail(writeError(error, ctx.freelancer));
  if (!data) return whyNotWritten(ctx, taskId);
  if (before) tellOthers(ctx, taskId, diffTask(before, data), before);
  return { ok: true, data: await shownTask(ctx, data) };
}

/** A new card in a project's column. Without a place it goes to the end of the column. */
export async function createTaskAs(ctx: TaskContext, input: { projectId: string; title: string; status?: string; order?: number | null; patch?: TaskPatch }): Promise<TaskResult<BoardTask>> {
  const projectId = idOf(input?.projectId);
  const title = cleanTitle(input?.title);
  const status = isStatus(input?.status) ? input.status : "todo";
  if (!projectId) return fail("Dieses Projekt gibt es nicht.");
  if (!title) return fail(`Der Titel fehlt oder ist länger als ${MAX_TITLE} Zeichen.`);
  const columns = patchColumns(input?.patch ?? {}, ctx.freelancer);
  if (!columns.ok) return fail(columns.error);
  const refused = await deactivatedAssignee(ctx, columns.data);
  if (refused) return fail(refused);

  // Freelancers only in their own projects: their session lists them before the server key reads the project.
  if (ctx.freelancer) {
    const own = await ctx.read.from("studio_project_freelancers").select("project_id").eq("project_id", projectId).limit(1).maybeSingle<{ project_id: string }>();
    if (!own.data) return fail("Dieses Projekt gibt es nicht.");
  }
  const project = await ctx.db.from("customer_projects").select("organization_id, status").eq("id", projectId).maybeSingle<{ organization_id: string; status: string }>();
  if (!project.data || project.data.status === "archived") return fail("Das Projekt gibt es nicht mehr oder es ist archiviert.");
  let order = numberOf(input?.order);
  if (order === null || Math.abs(order) > ORDER_LIMIT) {
    const last = await ctx.read.from("studio_tasks").select("board_order").eq("project_id", projectId).eq("status", status).eq("archived", false).order("board_order", { ascending: false }).limit(1).maybeSingle<{ board_order: number }>();
    order = Math.min(ORDER_LIMIT, (last.data ? Number(last.data.board_order) : 0) + 1);
  }
  const { data, error } = await ctx.supabase
    .from("studio_tasks")
    .insert({
      organization_id: project.data.organization_id,
      project_id: projectId,
      title,
      description: "",
      status,
      priority: "none",
      labels: [],
      assignee_user_ids: [],
      // „+ Freelancer“ unless the team chooses otherwise; freelancers never send a choice (patchColumns).
      client_visible: false,
      team_only: false,
      board_order: order,
      created_by: ctx.userId,
      ...columns.data,
    })
    .select(TASK_COLUMNS)
    .single<StudioTaskRow>();
  if (error || !data) return fail(writeError(error, ctx.freelancer));
  tellOthers(ctx, data.id, { created: true });
  return { ok: true, data: await shownTask(ctx, data) };
}

/** Changes title, description, priority, due date, labels, assignees or who sees the card. */
export async function updateTaskAs(ctx: TaskContext, input: { taskId: string; expectedVersion: number; patch: TaskPatch }): Promise<TaskResult<BoardTask>> {
  const taskId = idOf(input?.taskId);
  const version = numberOf(input?.expectedVersion);
  if (!taskId || version === null) return fail("Diese Änderung ist ungültig.");
  const columns = patchColumns(input?.patch ?? {}, ctx.freelancer);
  if (!columns.ok) return fail(columns.error);
  if (!Object.keys(columns.data).length) return fail("Es gibt nichts zu speichern.");
  const refused = await deactivatedAssignee(ctx, columns.data);
  if (refused) return fail(refused);
  const before = await snapshotOf(ctx, taskId);
  const { data, error } = await ctx.supabase.from("studio_tasks").update(columns.data).eq("id", taskId).eq("version", version).eq("archived", false).select(TASK_COLUMNS).maybeSingle<StudioTaskRow>();
  if (error) return fail(writeError(error, ctx.freelancer));
  if (!data) return whyNotWritten(ctx, taskId);
  // The saved row leaves the description out; the change says what it is now.
  const description = "description" in columns.data ? String(columns.data.description) : before?.description;
  if (before) tellOthers(ctx, taskId, diffTask(before, { ...data, description }), before);
  return { ok: true, data: await shownTask(ctx, data) };
}

/** A comment under the card. It never reaches the customer (Studio's client_visible false). */
export async function addCommentAs(ctx: TaskContext, input: { taskId: string; body: string }): Promise<TaskResult<TaskComment>> {
  const taskId = idOf(input?.taskId);
  const body = cleanText(input?.body)?.trim();
  if (!taskId) return fail("Diese Aufgabe gibt es nicht.");
  if (!body) return fail("Der Kommentar ist leer oder zu lang.");
  const task = await ctx.read.from("studio_tasks").select("organization_id, archived").eq("id", taskId).maybeSingle<{ organization_id: string; archived: boolean }>();
  if (!task.data || task.data.archived) return fail("Diese Aufgabe gibt es nicht mehr.", true);
  const { data, error } = await ctx.supabase.from("studio_comments").insert({ organization_id: task.data.organization_id, task_id: taskId, body, author_user_id: ctx.userId, client_visible: false }).select("id, created_at").single<{ id: string; created_at: string }>();
  if (error || !data) return fail(writeError(error, ctx.freelancer));
  tellOthers(ctx, taskId, { comment: body });
  return { ok: true, data: { id: data.id, authorId: ctx.userId, body, createdAt: data.created_at } };
}

/** A point of the checklist: new (without id) or changed (title, done) with its version. */
export async function saveSubtaskAs(ctx: TaskContext, input: { taskId: string; subtaskId?: string; title?: string; done?: boolean; expectedVersion?: number }): Promise<TaskResult<TaskSubtask>> {
  const taskId = idOf(input?.taskId);
  if (!taskId) return fail("Diese Aufgabe gibt es nicht.");
  const title = input?.title === undefined ? undefined : cleanTitle(input.title);
  if (title === null) return fail(`Der Punkt ist leer oder länger als ${MAX_TITLE} Zeichen.`);
  const subtaskId = input?.subtaskId === undefined ? null : idOf(input.subtaskId);
  if (input?.subtaskId !== undefined && !subtaskId) return fail("Diesen Punkt gibt es nicht.");

  if (!subtaskId) {
    if (!title) return fail("Der Punkt ist leer.");
    const task = await ctx.read.from("studio_tasks").select("organization_id, archived").eq("id", taskId).maybeSingle<{ organization_id: string; archived: boolean }>();
    if (!task.data || task.data.archived) return fail("Diese Aufgabe gibt es nicht mehr.", true);
    const last = await ctx.read.from("studio_subtasks").select("board_order").eq("task_id", taskId).order("board_order", { ascending: false }).limit(1).maybeSingle<{ board_order: number }>();
    const { data, error } = await ctx.supabase
      .from("studio_subtasks")
      .insert({ organization_id: task.data.organization_id, task_id: taskId, title, note: "", done: false, board_order: (last.data ? Number(last.data.board_order) : 0) + 1, client_visible: false, created_by: ctx.userId })
      .select("id, title, done, board_order, version")
      .single<{ id: string; title: string; done: boolean; board_order: number; version: number }>();
    if (error || !data) return fail(writeError(error, ctx.freelancer));
    tellOthers(ctx, taskId, { checklist: { state: "added", title: data.title } });
    return { ok: true, data: { id: data.id, title: data.title, done: data.done, order: Number(data.board_order), version: Number(data.version) } };
  }

  const version = numberOf(input?.expectedVersion);
  if (version === null) return fail("Diese Änderung ist ungültig.");
  const columns: Record<string, unknown> = {};
  if (title) columns.title = title;
  if (typeof input?.done === "boolean") columns.done = input.done;
  if (!Object.keys(columns).length) return fail("Es gibt nichts zu speichern.");
  const { data, error } = await ctx.supabase.from("studio_subtasks").update(columns).eq("id", subtaskId).eq("task_id", taskId).eq("version", version).select("id, title, done, board_order, version").maybeSingle<{ id: string; title: string; done: boolean; board_order: number; version: number }>();
  if (error) return fail(writeError(error, ctx.freelancer));
  if (!data) return fail("Dieser Punkt wurde inzwischen geändert.", true);
  tellOthers(ctx, taskId, { checklist: { state: "done" in columns ? (data.done ? "done" : "open") : "renamed", title: data.title } });
  return { ok: true, data: { id: data.id, title: data.title, done: data.done, order: Number(data.board_order), version: Number(data.version) } };
}
