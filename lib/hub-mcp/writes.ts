import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { connectorClaims } from "@/lib/platform/auth";
import { createOwnClaimsClient } from "@/lib/platform/client";
import { appointmentStatuses, formatDayShort, isAppointmentStatus, timeOf, wallTimeToUtc } from "@/lib/hub-calendar/rules";
import type { AppointmentInput } from "@/lib/hub-calendar/types";
import { closeAppointmentAs, writeAppointment, type CalendarClient } from "@/lib/hub-calendar/write";
import { isStatus, STATUS_NAMES } from "@/lib/hub-tasks/rules";
import type { TaskResult } from "@/lib/hub-tasks/types";
import { addCommentAs, createTaskAs, moveTaskAs, saveSubtaskAs, updateTaskAs, type TaskContext } from "@/lib/hub-tasks/write";
import { createProjectAs, type ProjectTeam } from "@/lib/hub-projects/write";
import type { ToolResult } from "./protocol";
import { logEvent, type Connection } from "./store";
import { hubLinks } from "./tools";
import {
  appointmentClosedText, appointmentSavedText, closingStatus, mergeAppointment, moveOrder, readNewAppointment, readNewProject, readNewTasks,
  readTaskPatch, readTaskRef,
} from "./write-input";

// The connector's writing tools (step 3, scope hub:write). Each one saves through the very code the hub's own window
// saves with (lib/hub-calendar/write.ts, lib/hub-tasks/write.ts, lib/hub-projects/write.ts), with a key that carries
// the admin's claims (lib/platform/auth.ts connectorClaims): Row Level Security, Studio's checks and triggers, the
// customer's notices and the names in Studio's history are the same as if the admin had saved in the hub. Checks read
// with the server key, as the board does for admins. Every change also gets a line in the admin log (`claude.*`).
// Nothing here deletes or archives; the hub pages show the change on their next load (no Server Action, no refresh()).

type Json = Record<string, unknown>;
type Db = NonNullable<ReturnType<typeof createAdminClient>>;
type Writer = { userId: string; db: Db; supabase: SupabaseClient; origin: string; today: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const refuse = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });
const noCustomer = "Diesen Kunden gibt es nicht. Nimm die ID aus search.";
const noAppointment = "Diesen Termin gibt es nicht. Nimm die ID aus list_appointments.";

/** Runs one writing tool for a checked connection with the right to write (lib/hub-mcp/server.ts checks both). */
export async function runWriteTool(connection: Connection, name: string, args: Json, context: { origin: string; today: string }): Promise<ToolResult> {
  const db = createAdminClient();
  const claims = await connectorClaims(connection.userId).catch(() => null);
  if (!db || !claims) return refuse("Der Hub kann gerade nicht speichern. Bitte versuche es gleich noch einmal.");
  const writer: Writer = { userId: connection.userId, db, supabase: createOwnClaimsClient(claims), origin: context.origin, today: context.today };
  try {
    switch (name) {
      case "create_appointment": return await createAppointment(writer, args);
      case "update_appointment": return await updateAppointment(writer, args);
      case "cancel_appointment": return await cancelAppointment(writer, args);
      case "create_tasks": return await createTasks(writer, args);
      case "update_task": return await updateTask(writer, args);
      case "move_task": return await moveTask(writer, args);
      case "add_task_comment": return await addTaskComment(writer, args);
      case "create_project": return await createProject(writer, args);
      default: return refuse("Dieses Werkzeug gibt es nicht.");
    }
  } catch (error) {
    console.error("[hub-mcp] write failed", name, error instanceof Error ? error.message : "unknown");
    return refuse("Das hat gerade nicht geklappt. Nichts Neues wurde gespeichert, oder nur ein Teil; sieh im Hub nach und versuche es erneut.");
  }
}

/* ---------- Appointments ---------- */

const calendarClient = (w: Writer) => w.supabase as unknown as CalendarClient;

/** A customer of the hub (not a freelancer entry), with its company; null when unknown. */
async function customerOf(w: Writer, customerId: string | null) {
  if (!customerId || !uuid.test(customerId)) return null;
  const { data } = await w.db.from("hub_customers").select("id, company, kind").eq("id", customerId).maybeSingle<{ id: string; company: string; kind: string | null }>();
  return data && (data.kind ?? "customer") === "customer" ? data : null;
}

type StoredRow = { id: string; title: string; description: string; starts_at: string; ends_at: string; status: string; teams_url: string | null; customer_id: string | null };

async function storedAppointment(w: Writer, id: unknown) {
  if (typeof id !== "string" || !uuid.test(id)) return null;
  const { data } = await w.db.from("hub_appointments").select("id, title, description, starts_at, ends_at, status, teams_url, customer_id").eq("id", id).maybeSingle<StoredRow>();
  return data ?? null;
}

function appointmentAnswer(w: Writer, id: string, input: AppointmentInput, status: string, company: string | null) {
  const start = wallTimeToUtc(input.day, input.start);
  return {
    appointment_id: id,
    title: input.title.trim(),
    status: isAppointmentStatus(status) ? appointmentStatuses[status] : status,
    day: input.day,
    start: input.start,
    end: timeOf(start + input.minutes * 60_000),
    minutes: input.minutes,
    customer: company,
    internal: !input.customerId,
    link: hubLinks(w.origin).appointment(id),
  };
}

async function createAppointment(w: Writer, args: Json): Promise<ToolResult> {
  const read = readNewAppointment(args);
  if (!read.ok) return refuse(read.error);
  const input = read.value;
  const customer = await customerOf(w, input.customerId);
  if (input.customerId && !customer) return refuse(noCustomer);
  const saved = await writeAppointment(calendarClient(w), null, input);
  if (!saved.ok) return refuse(saved.error);
  const id = saved.data.id;
  await logEvent(w.userId, "claude.appointment.created", `Termin „${input.title.trim()}“ am ${formatDayShort(input.day)} um ${input.start} über Claude eingetragen`, customer?.id);
  return json({
    today: w.today,
    saved: true,
    message: appointmentSavedText({ id, title: input.title, day: input.day, start: input.start, customerId: input.customerId, company: customer?.company ?? null, teams: Boolean(input.teamsUrl.trim()), before: null }),
    appointment: appointmentAnswer(w, id, input, "confirmed", customer?.company ?? null),
  });
}

async function updateAppointment(w: Writer, args: Json): Promise<ToolResult> {
  const stored = await storedAppointment(w, args.appointment_id);
  if (!stored) return refuse(noAppointment);
  const merged = mergeAppointment({
    title: stored.title, description: stored.description, start: Date.parse(stored.starts_at), end: Date.parse(stored.ends_at),
    status: stored.status, teamsUrl: stored.teams_url, customerId: stored.customer_id,
  }, args);
  if (!merged.ok) return refuse(merged.error);
  const input = merged.value;
  const customer = await customerOf(w, input.customerId);
  if (input.customerId && !customer) return refuse(noCustomer);
  const saved = await writeAppointment(calendarClient(w), stored.id, input);
  if (!saved.ok) return refuse(saved.error);
  const confirmed = stored.status === "requested";
  await logEvent(w.userId, confirmed ? "claude.appointment.confirmed" : "claude.appointment.updated", `Termin „${input.title.trim()}“ über Claude ${confirmed ? "bestätigt" : "geändert"}`, customer?.id);
  return json({
    today: w.today,
    saved: true,
    message: appointmentSavedText({
      id: stored.id, title: input.title, day: input.day, start: input.start, customerId: input.customerId, company: customer?.company ?? null, teams: Boolean(input.teamsUrl.trim()),
      before: { status: stored.status, startsAt: stored.starts_at, customerId: stored.customer_id },
    }),
    appointment: appointmentAnswer(w, stored.id, input, "confirmed", customer?.company ?? null),
  });
}

async function cancelAppointment(w: Writer, args: Json): Promise<ToolResult> {
  const stored = await storedAppointment(w, args.appointment_id);
  if (!stored) return refuse(noAppointment);
  const status = closingStatus(stored.status);
  if (!status) return refuse("Dieser Termin ist schon abgesagt oder abgelehnt.");
  if (args.note !== undefined && typeof args.note !== "string") return refuse("note muss Text sein.");
  const note = (args.note as string | undefined) ?? "";
  const closed = await closeAppointmentAs(calendarClient(w), stored.id, status, note);
  if (!closed.ok) return refuse(closed.error);
  const customer = await customerOf(w, stored.customer_id);
  await logEvent(w.userId, `claude.appointment.${status}`, `Termin „${stored.title}“ über Claude ${status === "declined" ? "abgelehnt" : "abgesagt"}`, customer?.id);
  return json({
    today: w.today,
    saved: true,
    message: appointmentClosedText(status, stored.title, customer?.company ?? null, note),
    appointment: { appointment_id: stored.id, title: stored.title, status: appointmentStatuses[status], link: hubLinks(w.origin).appointment(stored.id) },
  });
}

/* ---------- Tasks ---------- */

const taskContext = (w: Writer): TaskContext => ({ userId: w.userId, supabase: w.supabase, read: w.db as unknown as SupabaseClient, db: w.db, freelancer: false });

/** The project of a task tool: its name and the hub customer of its organization, for the answer and the log. */
async function projectOf(w: Writer, projectId: string) {
  const project = await w.db.from("customer_projects").select("id, display_name, organization_id, status").eq("id", projectId).maybeSingle<{ id: string; display_name: string; organization_id: string; status: string }>();
  if (!project.data) return null;
  const customer = await w.db.from("hub_customers").select("id").eq("organization_id", project.data.organization_id).eq("kind", "customer").limit(1).maybeSingle<{ id: string }>();
  return { name: project.data.display_name, archived: project.data.status === "archived", customerId: customer.data?.id };
}

type FoundTask = { id: string; version: number; title: string; archived: boolean };

async function findTask(w: Writer, ref: { projectId: string; number: number }): Promise<FoundTask | null> {
  const { data } = await w.db.from("studio_tasks").select("id, version, title, archived").eq("project_id", ref.projectId).eq("task_number", ref.number)
    .maybeSingle<{ id: string; version: number; title: string; archived: boolean }>();
  return data ? { id: data.id, version: Number(data.version), title: data.title, archived: data.archived } : null;
}

/**
 * A change on the card as it is now (its current version). Someone saving in between makes the write stale; then it
 * runs once more on the newer card. Only the fields Claude changes are written, so nobody else's change is lost.
 */
async function onCurrentTask<T>(w: Writer, ref: { projectId: string; number: number }, write: (task: FoundTask) => Promise<TaskResult<T>>): Promise<{ ok: true; data: T; task: FoundTask } | { ok: false; error: string }> {
  for (let attempt = 0; ; attempt++) {
    const task = await findTask(w, ref);
    if (!task) return { ok: false, error: "Diese Aufgabe gibt es in dem Projekt nicht. Nimm task_number aus get_project oder list_tasks." };
    if (task.archived) return { ok: false, error: "Diese Aufgabe wurde archiviert." };
    const result = await write(task);
    if (result.ok) return { ok: true, data: result.data, task };
    if (!result.stale || attempt >= 1) return { ok: false, error: result.error };
  }
}

async function createTasks(w: Writer, args: Json): Promise<ToolResult> {
  if (typeof args.project_id !== "string" || !uuid.test(args.project_id)) return refuse("Bitte das Projekt angeben (project_id aus search).");
  const projectId = args.project_id;
  const read = readNewTasks(args);
  if (!read.ok) return refuse(read.error);
  const project = await projectOf(w, projectId);
  if (!project || project.archived) return refuse("Das Projekt gibt es nicht mehr oder es ist archiviert.");

  const ctx = taskContext(w);
  const created: Json[] = [];
  const failed: { title: string; error: string }[] = [];
  for (const item of read.value) {
    const result = await createTaskAs(ctx, { projectId, title: item.title, status: item.status, patch: item.patch });
    if (!result.ok) {
      failed.push({ title: item.title, error: result.error });
      continue;
    }
    const missing: string[] = [];
    for (const point of item.checklist) {
      const saved = await saveSubtaskAs(ctx, { taskId: result.data.id, title: point });
      if (!saved.ok) missing.push(point);
    }
    created.push({
      task_number: result.data.number,
      title: result.data.title,
      status: STATUS_NAMES[result.data.status],
      ...(item.checklist.length ? { checklist_points: item.checklist.length - missing.length } : {}),
      ...(missing.length ? { checklist_not_saved: missing } : {}),
      link: hubLinks(w.origin).task(projectId, result.data.number),
    });
  }
  if (!created.length) return refuse(failed.length === 1 ? failed[0].error : `Keine Aufgabe wurde angelegt. ${failed[0]?.error ?? ""}`.trim());
  const what = created.length === 1 ? `Aufgabe „${String(created[0].title)}“` : `${created.length} Aufgaben`;
  await logEvent(w.userId, "claude.tasks.created", `${what} in „${project.name}“ über Claude angelegt`, project.customerId);
  return json({
    saved: true,
    message: `${created.length === 1 ? "Eine Aufgabe ist" : `${created.length} Aufgaben sind`} in „${project.name}“ angelegt${failed.length ? `, ${failed.length} nicht` : ""}.`,
    project: { project_id: projectId, name: project.name, link: hubLinks(w.origin).project(projectId) },
    created,
    ...(failed.length ? { not_created: failed } : {}),
  });
}

async function updateTask(w: Writer, args: Json): Promise<ToolResult> {
  const ref = readTaskRef(args);
  if (!ref.ok) return refuse(ref.error);
  const { project_id: _project, task_number: _number, ...fields } = args;
  void _project; void _number;
  const patch = readTaskPatch(fields);
  if (!patch.ok) return refuse(patch.error);
  if (!Object.keys(patch.value).length) return refuse("Es gibt nichts zu ändern.");
  const ctx = taskContext(w);
  const result = await onCurrentTask(w, ref.value, (task) => updateTaskAs(ctx, { taskId: task.id, expectedVersion: task.version, patch: patch.value }));
  if (!result.ok) return refuse(result.error);
  const project = await projectOf(w, ref.value.projectId);
  await logEvent(w.userId, "claude.task.updated", `Aufgabe „${result.data.title}“${project ? ` in „${project.name}“` : ""} über Claude geändert`, project?.customerId);
  return json({
    saved: true,
    message: `„${result.data.title}“ ist gespeichert.`,
    task: { task_number: result.data.number, title: result.data.title, status: STATUS_NAMES[result.data.status], link: hubLinks(w.origin).task(ref.value.projectId, result.data.number) },
  });
}

async function moveTask(w: Writer, args: Json): Promise<ToolResult> {
  const ref = readTaskRef(args);
  if (!ref.ok) return refuse(ref.error);
  if (!isStatus(args.status)) return refuse("Diese Spalte gibt es nicht.");
  const status = args.status;
  const ctx = taskContext(w);
  const result = await onCurrentTask(w, ref.value, async (task) => {
    const column = await w.db.from("studio_tasks").select("board_order").eq("project_id", ref.value.projectId).eq("status", status).eq("archived", false).neq("id", task.id).returns<{ board_order: number }[]>();
    const order = moveOrder(args.position, (column.data ?? []).map((row) => Number(row.board_order)));
    return moveTaskAs(ctx, { taskId: task.id, status, order, expectedVersion: task.version });
  });
  if (!result.ok) return refuse(result.error);
  const project = await projectOf(w, ref.value.projectId);
  await logEvent(w.userId, "claude.task.moved", `Aufgabe „${result.data.title}“ über Claude nach „${STATUS_NAMES[status]}“ verschoben`, project?.customerId);
  return json({
    saved: true,
    message: `„${result.data.title}“ steht jetzt in „${STATUS_NAMES[status]}“.`,
    task: { task_number: result.data.number, title: result.data.title, status: STATUS_NAMES[result.data.status], link: hubLinks(w.origin).task(ref.value.projectId, result.data.number) },
  });
}

async function addTaskComment(w: Writer, args: Json): Promise<ToolResult> {
  const ref = readTaskRef(args);
  if (!ref.ok) return refuse(ref.error);
  if (typeof args.text !== "string") return refuse("Bitte den Kommentar als Text angeben.");
  const task = await findTask(w, ref.value);
  if (!task || task.archived) return refuse("Diese Aufgabe gibt es in dem Projekt nicht. Nimm task_number aus get_project oder list_tasks.");
  const result = await addCommentAs(taskContext(w), { taskId: task.id, body: args.text });
  if (!result.ok) return refuse(result.error);
  const project = await projectOf(w, ref.value.projectId);
  await logEvent(w.userId, "claude.task.commented", `Kommentar zu „${task.title}“ über Claude geschrieben`, project?.customerId);
  return json({
    saved: true,
    message: `Der Kommentar steht unter „${task.title}“. Kunden sehen ihn nicht.`,
    task: { task_number: ref.value.number, title: task.title, link: hubLinks(w.origin).task(ref.value.projectId, ref.value.number) },
  });
}

/* ---------- Projects ---------- */

async function createProject(w: Writer, args: Json): Promise<ToolResult> {
  const read = readNewProject(args);
  if (!read.ok) return refuse(read.error);
  const team: ProjectTeam = { userId: w.userId, supabase: w.supabase as unknown as ProjectTeam["supabase"], db: w.db };
  // createProjectAs writes the admin log line itself (claude.project.created).
  const result = await createProjectAs(team, { customerId: read.value.customerId, status: read.value.status, visible: read.value.visible, draft: read.value.draft }, "claude");
  if (!result.ok) return refuse(result.error);
  const visible = read.value.visible === true;
  return json({
    saved: true,
    message: `Projekt „${result.data.name}“ ist angelegt. ${visible ? "Der Kunde sieht es in seinem Hub." : "Der Kunde sieht es noch nicht."}`,
    project: { project_id: result.data.id, name: result.data.name, link: hubLinks(w.origin).project(result.data.id) },
  });
}
