import "server-only";
import { createTaskAs, moveTaskAs, type TaskContext } from "@/lib/hub-tasks/write";
import { loadAssignees } from "@/lib/hub-tasks/server";
import { isIsoDate, isUuid } from "./rules";
import { resolveRefs } from "./refs";
import { canWriteTasks, notesCustomers, notesProjects, type NotesContext } from "./server";
import type { NoteProject, NoteResult, NoteTaskView } from "./types";

// Tasks from a note (plan 4): no second task list, but Studio's own rows, written through the board's own code
// (createTaskAs, moveTaskAs in lib/hub-tasks/write.ts) with the person's session, so Studio's rules, triggers and
// history decide and everybody who sees the card hears of it in the bell. Freelancers only in their projects and
// without choosing who sees the task; admins only with a confirmed code, as on the board.

const fail = <T,>(error: string): NoteResult<T> => ({ ok: false, error });

async function taskContext(ctx: NotesContext): Promise<TaskContext | string> {
  if (!ctx.db) return "Aufgaben sind gerade nicht erreichbar.";
  if (!(await canWriteTasks(ctx))) return ctx.viewer === "admin" ? "Aufgaben gehen erst mit bestätigter Anmeldung: Bestätige sie einmal mit einem Code aus der Mail." : "Aufgaben legen das oalab-Team und Freelancer an.";
  return { userId: ctx.userId, supabase: ctx.session, read: ctx.viewer === "admin" ? ctx.db : ctx.session, db: ctx.db, freelancer: ctx.viewer === "freelancer" };
}

/** A task as a note shows it, read like every reference (with the person's rights). */
async function viewOf(ctx: NotesContext, taskId: string): Promise<NoteTaskView | null> {
  const refs = await resolveRefs(ctx, { type: "doc", content: [{ type: "noteTaskMention", attrs: { refKind: "task", refId: taskId } }] });
  return refs.tasks[taskId] ?? null;
}

/** The projects of a customer where the person may add tasks, and who may hold them there. */
export async function noteTaskOptionsAs(ctx: NotesContext, input: { customerId: string; projectId?: string | null }): Promise<NoteResult<{ projects: NoteProject[]; people: { id: string; name: string; initials: string }[] }>> {
  const writer = await taskContext(ctx);
  if (typeof writer === "string") return fail(writer);
  const customers = await notesCustomers(ctx);
  const customer = customers?.find((item) => item.id === input?.customerId);
  if (!customer) return fail("Bei diesem Kunden kannst du keine Aufgaben anlegen.");
  const projects = await notesProjects(ctx, customer);
  const projectId = input.projectId && projects.some((project) => project.id === input.projectId) ? input.projectId : projects[0]?.id;
  const people = projectId ? await loadAssignees(writer.db, projectId) : [];
  return { ok: true, data: { projects, people: (people ?? []).map((person) => ({ id: person.id, name: person.name, initials: person.initials })) } };
}

export type NoteTaskInput = { customerId: string; projectId: string; title: string; assigneeIds?: string[]; dueOn?: string | null; audience?: "team" | "shared" | "customer" };

/** A new task in „Zu erledigen“ of a project of the page's customer; the note then shows it as a task block. */
export async function createNoteTaskAs(ctx: NotesContext, input: NoteTaskInput): Promise<NoteResult<NoteTaskView>> {
  const writer = await taskContext(ctx);
  if (typeof writer === "string") return fail(writer);
  const customers = await notesCustomers(ctx);
  const customer = customers?.find((item) => item.id === input?.customerId);
  if (!customer) return fail("Bei diesem Kunden kannst du keine Aufgaben anlegen.");
  const projects = await notesProjects(ctx, customer);
  if (!isUuid(input.projectId) || !projects.some((project) => project.id === input.projectId)) return fail("Wähle ein Projekt dieses Kunden.");
  const dueOn = input.dueOn && isIsoDate(input.dueOn) ? input.dueOn : null;
  const assigneeIds = Array.isArray(input.assigneeIds) ? input.assigneeIds.filter(isUuid).slice(0, 10) : [];
  const created = await createTaskAs(writer, {
    projectId: input.projectId,
    title: String(input.title ?? ""),
    status: "todo",
    patch: { assigneeIds, dueOn, ...(writer.freelancer || !input.audience ? {} : { audience: input.audience }) },
  });
  if (!created.ok) return fail(created.error);
  const view = await viewOf(ctx, created.data.id);
  return view ? { ok: true, data: view } : fail("Die Aufgabe ist angelegt, ließ sich aber gerade nicht lesen.");
}

/** Ticks a task off („Erledigt“) or opens it again („Zu erledigen“), with the version the note showed. */
export async function setNoteTaskDoneAs(ctx: NotesContext, input: { taskId: string; done: boolean; version: number }): Promise<NoteResult<NoteTaskView>> {
  const writer = await taskContext(ctx);
  if (typeof writer === "string") return fail(writer);
  if (!isUuid(input?.taskId) || !Number.isInteger(input?.version)) return fail("Diese Aufgabe ist unbekannt.");
  const status = input.done ? "done" : "todo";
  const row = await writer.read.from("studio_tasks").select("project_id").eq("id", input.taskId).maybeSingle<{ project_id: string }>();
  if (!row.data) return fail("Diese Aufgabe gibt es nicht mehr, oder sie ist nicht für dich freigegeben.");
  const last = await writer.read.from("studio_tasks").select("board_order").eq("project_id", row.data.project_id).eq("status", status).eq("archived", false).order("board_order", { ascending: false }).limit(1).maybeSingle<{ board_order: number }>();
  const moved = await moveTaskAs(writer, { taskId: input.taskId, status, order: Math.min(1e12, (last.data ? Number(last.data.board_order) : 0) + 1), expectedVersion: input.version });
  if (!moved.ok) return fail(moved.error);
  const view = await viewOf(ctx, input.taskId);
  return view ? { ok: true, data: view } : fail("Die Aufgabe ließ sich gerade nicht lesen.");
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** Tasks of the customer's projects for „#“ and „/Aufgabe“: by number („#1031“, „1031“) or by words of the title. */
export async function searchNoteTasksAs(ctx: NotesContext, input: { customerId: string; query: string }): Promise<NoteResult<NoteTaskView[]>> {
  if (ctx.viewer === "customer" || !ctx.db) return { ok: true, data: [] };
  const customers = await notesCustomers(ctx);
  const customer = customers?.find((item) => item.id === input?.customerId);
  if (!customer) return { ok: true, data: [] };
  const projects = await notesProjects(ctx, customer);
  if (!projects.length) return { ok: true, data: [] };
  const read = ctx.viewer === "admin" ? ctx.db : ctx.session;
  const term = String(input.query ?? "").trim().replace(/^#/, "").slice(0, 80);
  let query = read.from("studio_tasks").select("id").in("project_id", projects.map((project) => project.id)).eq("archived", false);
  if (/^\d+$/.test(term)) query = query.eq("task_number", Number(term));
  else if (term) query = query.ilike("title", `%${escapeLike(term)}%`);
  const { data } = await query.order("updated_at", { ascending: false }).limit(8).returns<{ id: string }[]>();
  const ids = (data ?? []).map((row) => row.id);
  if (!ids.length) return { ok: true, data: [] };
  const refs = await resolveRefs(ctx, { type: "doc", content: ids.map((id) => ({ type: "noteTaskMention", attrs: { refKind: "task", refId: id } })) });
  return { ok: true, data: ids.map((id) => refs.tasks[id]).filter((task): task is NoteTaskView => Boolean(task)) };
}
