"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyHubAdmin, verifyHubFreelancer } from "@/lib/hub-users/server";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import { audienceColumns, cleanDay, cleanLabels, cleanText, cleanTitle, isAudience, isPriority, isStatus, MAX_TITLE, ORDER_LIMIT, TASK_COLUMNS, toBoardTask, type StudioTaskRow } from "./rules";
import type { BoardTask, TaskComment, TaskDetail, TaskPatch, TaskResult, TaskSubtask } from "./types";

// Every action is a public POST endpoint and checks again. Reading a card's window or image needs the board's own
// check: an active admin (hub role, second factor if the login has one, is_hub_admin()) or an active freelancer with a
// confirmed code. Writing also needs a session confirmed with a code (aal2) and uses the person's *own* session:
// Studio's RLS lets only its team and the project's freelancers write, and only with aal2; its triggers validate the
// row, raise the version and log the change under the person's name, exactly as when the card is moved in Studio.
// Changes carry the version the browser saw; a newer row is never overwritten ("stale").
//
// Freelancers (step 3, 16.11.2026) also *read* with their own session, so a check never tells them about a task they
// cannot see. What they may not do (archive, release to the customer, „Nur Team“) the database refuses as well
// (STUDIO_FREELANCER_FIELD_LOCKED); the hub says so before asking it.

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const denied = { ok: false as const, error: "Dafür brauchst du einen aktiven Zugang zum Aufgaben-Board." };
// A login whose second factor is off signs in with the password alone (aal1); the board offers the code above itself.
const unconfirmed = { ok: false as const, error: "Bearbeiten geht erst mit bestätigter Anmeldung: Klick über dem Board auf „Mit Code bestätigen“." };
const STALE = "Die Aufgabe wurde inzwischen geändert. Das Board zeigt jetzt den neuesten Stand.";
const TEAM_DECIDES = "Archivieren, die Freigabe für Kunden und „Nur Team“ bleiben beim oalab-Team.";
const fail = (error: string, stale = false) => ({ ok: false as const, error, ...(stale ? { stale: true } : {}) });

type Refusal = { ok: false; error: string };
type Db = NonNullable<ReturnType<typeof createAdminClient>>;
/**
 * `supabase`: the person's own session, for every write. `read`: what checks and windows read with: the server key
 * for admins (as before step 3), the own session for freelancers. `db`: the server key, for names and project rows.
 */
type Context = { userId: string; supabase: SupabaseClient; read: SupabaseClient; db: Db; freelancer: boolean };
type Reader = Pick<Context, "userId" | "read" | "freelancer">;

/** Who may read a card's details: the same check as the board itself (lib/hub-tasks/server.ts). */
async function reader(): Promise<Reader | null> {
  const admin = await verifyHubAdmin();
  if (admin) {
    const db = createAdminClient();
    return db ? { userId: admin.userId, read: db, freelancer: false } : null;
  }
  const freelancer = await verifyHubFreelancer();
  return freelancer ? { userId: freelancer.userId, read: freelancer.supabase as unknown as SupabaseClient, freelancer: true } : null;
}

/** Who may write: an active admin whose session confirmed a code (aal2), or an active freelancer; otherwise why not. */
async function actor(): Promise<Context | Refusal> {
  const admin = await verifyHubAdmin();
  const db = createAdminClient();
  if (admin) {
    if (!db) return denied;
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    if (data?.claims?.aal !== "aal2") return unconfirmed;
    return { userId: admin.userId, supabase: supabase as unknown as SupabaseClient, read: db, db, freelancer: false };
  }
  // verifyHubFreelancer lets only sessions with a confirmed code through: freelancers always sign in with one.
  const freelancer = await verifyHubFreelancer();
  if (!freelancer || !db) return denied;
  const session = freelancer.supabase as unknown as SupabaseClient;
  return { userId: freelancer.userId, supabase: session, read: session, db, freelancer: true };
}

/**
 * Studio refuses writes from logins without a team role or outside the project (42501), fields that stay with the
 * team (its freelancer guard) and assignees who are neither in the team nor freelancers of the project (its trigger).
 */
function writeError(error: { code?: string; message?: string } | null, freelancer: boolean): string {
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

const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const id = (value: unknown) => (typeof value === "string" && uuid.test(value) ? value : null);

/** Why an update by version hit no row: gone, archived or simply newer. Freelancers learn only "gone". */
async function whyNotWritten(ctx: Context, taskId: string) {
  const { data } = await ctx.read.from("studio_tasks").select("archived").eq("id", taskId).maybeSingle<{ archived: boolean }>();
  if (!data) return fail("Diese Aufgabe gibt es nicht mehr.", true);
  if (data.archived) return fail("Diese Aufgabe wurde archiviert.", true);
  return fail(STALE, true);
}

/** Moves a card to a column and a place (board_order). */
export async function moveTask(input: { taskId: string; status: string; order: number; expectedVersion: number }): Promise<TaskResult<BoardTask>> {
  const ctx = await actor();
  if ("error" in ctx) return ctx;
  const taskId = id(input?.taskId);
  const order = number(input?.order);
  const version = number(input?.expectedVersion);
  if (!taskId || !isStatus(input?.status) || order === null || Math.abs(order) > ORDER_LIMIT || version === null) return fail("Diese Verschiebung ist ungültig.");
  const { data, error } = await ctx.supabase.from("studio_tasks").update({ status: input.status, board_order: order }).eq("id", taskId).eq("version", version).select(TASK_COLUMNS).maybeSingle<StudioTaskRow>();
  if (error) return fail(writeError(error, ctx.freelancer));
  if (!data) return whyNotWritten(ctx, taskId);
  refreshWorkspace();
  return { ok: true, data: toBoardTask(data) };
}

/** Gives a whole column fresh places (1, 2, 3 …) when the gaps between cards are used up. */
export async function renumberColumn(input: { items: { taskId: string; order: number; expectedVersion: number }[] }): Promise<TaskResult<{ taskId: string; version: number }[]>> {
  const ctx = await actor();
  if ("error" in ctx) return ctx;
  const items = Array.isArray(input?.items) ? input.items.slice(0, 500) : [];
  const saved: { taskId: string; version: number }[] = [];
  for (const item of items) {
    const taskId = id(item?.taskId);
    const order = number(item?.order);
    const version = number(item?.expectedVersion);
    if (!taskId || order === null || version === null) continue;
    const { data } = await ctx.supabase.from("studio_tasks").update({ board_order: order }).eq("id", taskId).eq("version", version).select("version").maybeSingle<{ version: number }>();
    if (data) saved.push({ taskId, version: Number(data.version) });
  }
  refreshWorkspace();
  return { ok: true, data: saved };
}

/** A new card in a project's column. Without a place it goes to the end of the column. */
export async function createTask(input: { projectId: string; title: string; status?: string; order?: number | null; patch?: TaskPatch }): Promise<TaskResult<BoardTask>> {
  const ctx = await actor();
  if ("error" in ctx) return ctx;
  const projectId = id(input?.projectId);
  const title = cleanTitle(input?.title);
  const status = isStatus(input?.status) ? input.status : "todo";
  if (!projectId) return fail("Dieses Projekt gibt es nicht.");
  if (!title) return fail(`Der Titel fehlt oder ist länger als ${MAX_TITLE} Zeichen.`);
  const columns = patchColumns(input?.patch ?? {}, ctx.freelancer);
  if (!columns.ok) return fail(columns.error);

  // Freelancers only in their own projects: their session lists them before the server key reads the project.
  if (ctx.freelancer) {
    const own = await ctx.read.from("studio_project_freelancers").select("project_id").eq("project_id", projectId).limit(1).maybeSingle<{ project_id: string }>();
    if (!own.data) return fail("Dieses Projekt gibt es nicht.");
  }
  const project = await ctx.db.from("customer_projects").select("organization_id, status").eq("id", projectId).maybeSingle<{ organization_id: string; status: string }>();
  if (!project.data || project.data.status === "archived") return fail("Das Projekt gibt es nicht mehr oder es ist archiviert.");
  let order = number(input?.order);
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
  refreshWorkspace();
  return { ok: true, data: toBoardTask(data) };
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
    if (!Array.isArray(patch.assigneeIds) || patch.assigneeIds.length > 20 || patch.assigneeIds.some((value) => !id(value))) return { ok: false, error: "Diese Zuständigkeit ist ungültig." };
    columns.assignee_user_ids = [...new Set(patch.assigneeIds)];
  }
  if (patch.audience !== undefined) {
    if (freelancer) return { ok: false, error: TEAM_DECIDES };
    if (!isAudience(patch.audience)) return { ok: false, error: "Diese Sichtbarkeit ist ungültig." };
    Object.assign(columns, audienceColumns(patch.audience));
  }
  return { ok: true, data: columns };
}

/** Changes title, description, priority, due date, labels, assignees or who sees the card. */
export async function updateTask(input: { taskId: string; expectedVersion: number; patch: TaskPatch }): Promise<TaskResult<BoardTask>> {
  const ctx = await actor();
  if ("error" in ctx) return ctx;
  const taskId = id(input?.taskId);
  const version = number(input?.expectedVersion);
  if (!taskId || version === null) return fail("Diese Änderung ist ungültig.");
  const columns = patchColumns(input?.patch ?? {}, ctx.freelancer);
  if (!columns.ok) return fail(columns.error);
  if (!Object.keys(columns.data).length) return fail("Es gibt nichts zu speichern.");
  const { data, error } = await ctx.supabase.from("studio_tasks").update(columns.data).eq("id", taskId).eq("version", version).eq("archived", false).select(TASK_COLUMNS).maybeSingle<StudioTaskRow>();
  if (error) return fail(writeError(error, ctx.freelancer));
  if (!data) return whyNotWritten(ctx, taskId);
  refreshWorkspace();
  return { ok: true, data: toBoardTask(data) };
}

/** Archives a card: it leaves the board (and Studio's board) but stays in the history. Only the team archives. */
export async function archiveTask(input: { taskId: string; expectedVersion: number }): Promise<TaskResult<null>> {
  const ctx = await actor();
  if ("error" in ctx) return ctx;
  if (ctx.freelancer) return fail(TEAM_DECIDES);
  const taskId = id(input?.taskId);
  const version = number(input?.expectedVersion);
  if (!taskId || version === null) return fail("Diese Aufgabe gibt es nicht.");
  const { data, error } = await ctx.supabase.from("studio_tasks").update({ archived: true }).eq("id", taskId).eq("version", version).select("id").maybeSingle<{ id: string }>();
  if (error) return fail(writeError(error, ctx.freelancer));
  if (!data) return whyNotWritten(ctx, taskId);
  refreshWorkspace();
  return { ok: true, data: null };
}

/**
 * „Beteiligte“ (admins): puts a freelancer who looks after the project's customer on the project, or takes them off.
 * On it they see the project and every task except „Nur Team“; off it they lose it at once and drop out as assignees
 * there (the database's trigger). Saved with the admin's own session (RLS: hub admin with aal2).
 */
export async function setProjectFreelancer(input: { projectId: string; freelancerId: string; on: boolean }): Promise<TaskResult<string[]>> {
  const ctx = await actor();
  if ("error" in ctx) return ctx;
  if (ctx.freelancer) return denied;
  const projectId = id(input?.projectId);
  const freelancerId = id(input?.freelancerId);
  if (!projectId || !freelancerId || typeof input?.on !== "boolean") return fail("Diese Änderung ist ungültig.");
  const project = await ctx.db.from("customer_projects").select("organization_id, status").eq("id", projectId).maybeSingle<{ organization_id: string; status: string }>();
  if (!project.data || project.data.status === "archived") return fail("Das Projekt gibt es nicht mehr oder es ist archiviert.");
  const { error } = input.on
    ? await ctx.supabase.from("studio_project_freelancers").insert({ project_id: projectId, organization_id: project.data.organization_id, freelancer_id: freelancerId })
    : await ctx.supabase.from("studio_project_freelancers").delete().eq("project_id", projectId).eq("freelancer_id", freelancerId);
  // Already on it (a second tab, a double click): that is the state asked for.
  if (error && error.code !== "23505") return fail(writeError(error, false));
  const now = await ctx.db.from("studio_project_freelancers").select("freelancer_id").eq("project_id", projectId).returns<{ freelancer_id: string }[]>();
  refreshWorkspace();
  return { ok: true, data: (now.data ?? []).map((row) => row.freelancer_id) };
}

/** Everything of a card that is not on the board: description, checklist, comments, images and history. */
export async function loadTaskDetail(input: { taskId: string }): Promise<TaskResult<TaskDetail>> {
  const ctx = await reader();
  if (!ctx) return denied;
  const taskId = id(input?.taskId);
  if (!taskId) return fail("Diese Aufgabe gibt es nicht.");
  const [task, subtasks, comments, files, events] = await Promise.all([
    ctx.read.from("studio_tasks").select("description, archived").eq("id", taskId).maybeSingle<{ description: string; archived: boolean }>(),
    ctx.read.from("studio_subtasks").select("id, title, done, board_order, version").eq("task_id", taskId).order("board_order").returns<{ id: string; title: string; done: boolean; board_order: number; version: number }[]>(),
    ctx.read.from("studio_comments").select("id, author_user_id, body, created_at").eq("task_id", taskId).order("created_at").returns<{ id: string; author_user_id: string; body: string; created_at: string }[]>(),
    ctx.read.from("studio_files").select("id, original_filename, byte_size, mime_type, created_by, created_at").eq("task_id", taskId).eq("state", "ready").order("created_at").returns<{ id: string; original_filename: string; byte_size: number; mime_type: string; created_by: string; created_at: string }[]>(),
    ctx.read.from("studio_activity").select("id, actor_user_id, event_type, created_at").eq("task_id", taskId).in("event_type", ["task.insert", "task.update"]).order("created_at", { ascending: false }).limit(40).returns<{ id: string; actor_user_id: string | null; event_type: string; created_at: string }[]>(),
  ]);
  if (!task.data || task.data.archived) return fail("Diese Aufgabe gibt es nicht mehr.", true);
  if (subtasks.error || comments.error || files.error || events.error) return fail("Die Einzelheiten konnten nicht geladen werden.");
  return {
    ok: true,
    data: {
      taskId,
      description: task.data.description,
      subtasks: (subtasks.data ?? []).map((row) => ({ id: row.id, title: row.title, done: row.done, order: Number(row.board_order), version: Number(row.version) })),
      comments: (comments.data ?? []).map((row) => ({ id: row.id, authorId: row.author_user_id, body: row.body, createdAt: row.created_at })),
      files: (files.data ?? []).map((row) => ({ id: row.id, name: row.original_filename, size: Number(row.byte_size), mimeType: row.mime_type, createdBy: row.created_by, createdAt: row.created_at })),
      events: (events.data ?? []).map((row) => ({ id: row.id, actorId: row.actor_user_id, kind: row.event_type, createdAt: row.created_at })).reverse(),
    },
  };
}

/** A comment under the card. It never reaches the customer (Studio's client_visible false). */
export async function addComment(input: { taskId: string; body: string }): Promise<TaskResult<TaskComment>> {
  const ctx = await actor();
  if ("error" in ctx) return ctx;
  const taskId = id(input?.taskId);
  const body = cleanText(input?.body)?.trim();
  if (!taskId) return fail("Diese Aufgabe gibt es nicht.");
  if (!body) return fail("Der Kommentar ist leer oder zu lang.");
  const task = await ctx.read.from("studio_tasks").select("organization_id, archived").eq("id", taskId).maybeSingle<{ organization_id: string; archived: boolean }>();
  if (!task.data || task.data.archived) return fail("Diese Aufgabe gibt es nicht mehr.", true);
  const { data, error } = await ctx.supabase.from("studio_comments").insert({ organization_id: task.data.organization_id, task_id: taskId, body, author_user_id: ctx.userId, client_visible: false }).select("id, created_at").single<{ id: string; created_at: string }>();
  if (error || !data) return fail(writeError(error, ctx.freelancer));
  refreshWorkspace();
  return { ok: true, data: { id: data.id, authorId: ctx.userId, body, createdAt: data.created_at } };
}

/** A point of the checklist: new (without id) or changed (title, done) with its version. */
export async function saveSubtask(input: { taskId: string; subtaskId?: string; title?: string; done?: boolean; expectedVersion?: number }): Promise<TaskResult<TaskSubtask>> {
  const ctx = await actor();
  if ("error" in ctx) return ctx;
  const taskId = id(input?.taskId);
  if (!taskId) return fail("Diese Aufgabe gibt es nicht.");
  const title = input?.title === undefined ? undefined : cleanTitle(input.title);
  if (title === null) return fail(`Der Punkt ist leer oder länger als ${MAX_TITLE} Zeichen.`);
  const subtaskId = input?.subtaskId === undefined ? null : id(input.subtaskId);
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
    refreshWorkspace();
    return { ok: true, data: { id: data.id, title: data.title, done: data.done, order: Number(data.board_order), version: Number(data.version) } };
  }

  const version = number(input?.expectedVersion);
  if (version === null) return fail("Diese Änderung ist ungültig.");
  const columns: Record<string, unknown> = {};
  if (title) columns.title = title;
  if (typeof input?.done === "boolean") columns.done = input.done;
  if (!Object.keys(columns).length) return fail("Es gibt nichts zu speichern.");
  const { data, error } = await ctx.supabase.from("studio_subtasks").update(columns).eq("id", subtaskId).eq("task_id", taskId).eq("version", version).select("id, title, done, board_order, version").maybeSingle<{ id: string; title: string; done: boolean; board_order: number; version: number }>();
  if (error) return fail(writeError(error, ctx.freelancer));
  if (!data) return fail("Dieser Punkt wurde inzwischen geändert.", true);
  refreshWorkspace();
  return { ok: true, data: { id: data.id, title: data.title, done: data.done, order: Number(data.board_order), version: Number(data.version) } };
}

/** Removes a point from the checklist. */
export async function deleteSubtask(input: { taskId: string; subtaskId: string; expectedVersion: number }): Promise<TaskResult<null>> {
  const ctx = await actor();
  if ("error" in ctx) return ctx;
  const taskId = id(input?.taskId);
  const subtaskId = id(input?.subtaskId);
  const version = number(input?.expectedVersion);
  if (!taskId || !subtaskId || version === null) return fail("Diesen Punkt gibt es nicht.");
  const { data, error } = await ctx.supabase.from("studio_subtasks").delete().eq("id", subtaskId).eq("task_id", taskId).eq("version", version).select("id").maybeSingle<{ id: string }>();
  if (error) return fail(writeError(error, ctx.freelancer));
  if (!data) return fail("Dieser Punkt wurde inzwischen geändert.", true);
  refreshWorkspace();
  return { ok: true, data: null };
}

/** A short-lived link to one of Studio's images on a card; freelancers get it only for cards they see (storage RLS). */
export async function taskFileLink(input: { fileId: string }): Promise<TaskResult<string>> {
  const ctx = await reader();
  if (!ctx) return denied;
  const fileId = id(input?.fileId);
  if (!fileId) return fail("Diese Datei gibt es nicht.");
  const file = await ctx.read.from("studio_files").select("storage_bucket, object_key, state").eq("id", fileId).maybeSingle<{ storage_bucket: string; object_key: string; state: string }>();
  if (!file.data || file.data.state !== "ready") return fail("Diese Datei gibt es nicht.");
  const { data, error } = await ctx.read.storage.from(file.data.storage_bucket).createSignedUrl(file.data.object_key, 60);
  if (error || !data?.signedUrl) return fail("Die Datei kann gerade nicht geöffnet werden.");
  return { ok: true, data: data.signedUrl };
}
