"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyHubAdmin, verifyHubFreelancer } from "@/lib/hub-users/server";
import { readEntriesWithoutActiveLogin } from "@/lib/hub-users/deactivated";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import type { BoardTask, TaskComment, TaskDetail, TaskPatch, TaskResult, TaskSubtask } from "./types";
import {
  addCommentAs, createTaskAs, fail, idOf as id, moveTaskAs, numberOf as number, saveSubtaskAs, TEAM_DECIDES, updateTaskAs, whyNotWritten, writeError,
  type TaskContext,
} from "./write";

// Every action is a public POST endpoint and checks again. Reading a card's window or image needs the board's own
// check: an active admin (hub role, second factor if the login has one, is_hub_admin()) or an active freelancer with a
// confirmed code. Writing also needs a session confirmed with a code (aal2) and uses the person's *own* session:
// Studio's RLS lets only its team and the project's freelancers write, and only with aal2; its triggers validate the
// row, raise the version and log the change under the person's name, exactly as when the card is moved in Studio.
// Changes carry the version the browser saw; a newer row is never overwritten ("stale"). Creating, changing, moving,
// commenting and the checklist run through lib/hub-tasks/write.ts, which the Claude connector uses as well.
//
// Freelancers (step 3, 16.11.2026) also *read* with their own session, so a check never tells them about a task they
// cannot see. What they may not do (archive, release to the customer, „Nur Team“) the database refuses as well
// (STUDIO_FREELANCER_FIELD_LOCKED); the hub says so before asking it.

const denied = { ok: false as const, error: "Dafür brauchst du einen aktiven Zugang zum Aufgaben-Board." };
// A login whose second factor is off signs in with the password alone (aal1); the board offers the code above itself.
const unconfirmed = { ok: false as const, error: "Bearbeiten geht erst mit bestätigter Anmeldung: Klick über dem Board auf „Mit Code bestätigen“." };

type Refusal = { ok: false; error: string };
type Reader = Pick<TaskContext, "userId" | "read" | "freelancer">;

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
async function actor(): Promise<TaskContext | Refusal> {
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

/** After a write that worked, the page shows the new state (only a Server Action can do that). */
function refreshed<T extends { ok: boolean }>(result: T): T {
  if (result.ok) refreshWorkspace();
  return result;
}

/** Moves a card to a column and a place (board_order). */
export async function moveTask(input: { taskId: string; status: string; order: number; expectedVersion: number }): Promise<TaskResult<BoardTask>> {
  const ctx = await actor();
  if ("error" in ctx) return ctx;
  return refreshed(await moveTaskAs(ctx, input));
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
  return refreshed(await createTaskAs(ctx, input));
}

/** Changes title, description, priority, due date, labels, assignees or who sees the card. */
export async function updateTask(input: { taskId: string; expectedVersion: number; patch: TaskPatch }): Promise<TaskResult<BoardTask>> {
  const ctx = await actor();
  if ("error" in ctx) return ctx;
  return refreshed(await updateTaskAs(ctx, input));
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
 * there (the database's trigger). Saved with the admin's own session (RLS: hub admin with aal2). A freelancer whose
 * every login is deactivated is put on no project; one already on it stays there unseen (lib/hub-users/deactivated.ts).
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
  if (input.on) {
    const inactive = await readEntriesWithoutActiveLogin(ctx.db, [freelancerId]);
    if (!inactive) return fail("Das hat nicht geklappt. Bitte versuche es erneut.");
    if (inactive.size) return fail("Dieser Freelancer hat keinen aktiven Zugang mehr. Im User Management lässt sich ein Zugang wieder aktivieren.");
  }
  const { error } = input.on
    ? await ctx.supabase.from("studio_project_freelancers").insert({ project_id: projectId, organization_id: project.data.organization_id, freelancer_id: freelancerId })
    : await ctx.supabase.from("studio_project_freelancers").delete().eq("project_id", projectId).eq("freelancer_id", freelancerId);
  // Already on it (a second tab, a double click): that is the state asked for.
  if (error && error.code !== "23505") return fail(writeError(error, false));
  const now = await ctx.db.from("studio_project_freelancers").select("freelancer_id").eq("project_id", projectId).returns<{ freelancer_id: string }[]>();
  const ids = (now.data ?? []).map((row) => row.freelancer_id);
  const unseen = await readEntriesWithoutActiveLogin(ctx.db, ids);
  refreshWorkspace();
  return { ok: true, data: ids.filter((freelancer) => !unseen?.has(freelancer)) };
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
  return refreshed(await addCommentAs(ctx, input));
}

/** A point of the checklist: new (without id) or changed (title, done) with its version. */
export async function saveSubtask(input: { taskId: string; subtaskId?: string; title?: string; done?: boolean; expectedVersion?: number }): Promise<TaskResult<TaskSubtask>> {
  const ctx = await actor();
  if ("error" in ctx) return ctx;
  return refreshed(await saveSubtaskAs(ctx, input));
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
