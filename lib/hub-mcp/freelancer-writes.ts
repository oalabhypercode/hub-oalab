import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDayShort, timeOf, wallTimeToUtc } from "@/lib/hub-calendar/rules";
import { requestAppointmentAs, withdrawRequestAs, type CalendarClient } from "@/lib/hub-calendar/write";
import { loadFreelancerCardsWith } from "@/lib/hub-freelancer-customers/server";
import { isStatus, STATUS_NAMES } from "@/lib/hub-tasks/rules";
import { loadFreelancerBoardAs } from "@/lib/hub-tasks/server";
import type { BoardProject, TaskResult } from "@/lib/hub-tasks/types";
import { addCommentAs, createTaskAs, moveTaskAs, saveSubtaskAs, updateTaskAs, type TaskContext } from "@/lib/hub-tasks/write";
import { freelancerLinks } from "./freelancer-tools";
import type { ToolResult } from "./protocol";
import { logEvent, type Connection } from "./store";
import { moveOrder, readChecklistChange, readNewTasks, readTaskPatch, readTaskRef } from "./write-input";
import { changeChecklist, checklistText } from "./board";

// A freelancer's writing tools (stage 2, 19.11.2026): tasks in their own projects and requests to oalab, through the
// very code the board and the request window save with (lib/hub-tasks/write.ts with `freelancer: true`,
// lib/hub-calendar/write.ts). Every write and every check reads with the freelancer's claims (`supabase` and `read` of
// the task context), so Studio's rules and its freelancer guard decide exactly as in the hub: no „Nur Team“ cards,
// nothing outside their projects, no choice of who sees a card, no archive. The server key goes only where the board's
// own freelancer actions pass it as well (`db`: project rows and deactivated logins inside the cores). Every change
// gets a `claude.*` line in the admin log with the freelancer as its author; the bell tells the others as in the hub.

type Json = Record<string, unknown>;
type Db = NonNullable<ReturnType<typeof createAdminClient>>;
type Writer = {
  userId: string;
  client: SupabaseClient;
  db: Db;
  origin: string;
  today: string;
  projects?: Promise<BoardProject[] | null>;
  customers?: Promise<Map<string, string>>;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const refuse = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });
const noProject = "Dieses Projekt gehört nicht zu deinen Projekten, oder es gibt es nicht mehr. Nimm die ID aus search oder get_project.";
const noTask = "Diese Aufgabe gibt es in dem Projekt nicht, oder du siehst sie nicht. Nimm task_number aus get_project oder list_tasks.";
const teamDecides = "Wer eine Aufgabe sieht, entscheidet das oalab-Team. Lass audience weg.";
const hasAudience = (value: unknown) => Boolean(value) && typeof value === "object" && "audience" in (value as Json);

/** Runs one writing tool for a checked freelancer's connection with the right to write (lib/hub-mcp/freelancer.ts). */
export async function runFreelancerWrite(connection: Connection, name: string, args: Json, context: { origin: string; today: string }, client: SupabaseClient): Promise<ToolResult> {
  const db = createAdminClient();
  if (!db) return refuse("Der Hub kann gerade nicht speichern. Bitte versuche es gleich noch einmal.");
  const writer: Writer = { userId: connection.userId, client, db, origin: context.origin, today: context.today };
  try {
    switch (name) {
      case "create_tasks": return await createTasks(writer, args);
      case "update_task": return await updateTask(writer, args);
      case "move_task": return await moveTask(writer, args);
      case "add_task_comment": return await addTaskComment(writer, args);
      case "request_appointment": return await requestAppointment(writer, args);
      case "withdraw_request": return await withdrawRequest(writer, args);
      case "update_checklist": return await updateChecklist(writer, args);
      default: return refuse("Dieses Werkzeug gibt es nicht.");
    }
  } catch (error) {
    console.error("[hub-mcp] freelancer write failed", name, error instanceof Error ? error.message : "unknown");
    return refuse("Das hat gerade nicht geklappt. Nichts Neues wurde gespeichert, oder nur ein Teil; sieh im Hub nach und versuche es erneut.");
  }
}

/* ---------- Tasks ---------- */

/** As the board's actions build it for a freelancer (lib/hub-tasks/actions.ts actor()), with the connector's claims. */
const taskContext = (w: Writer): TaskContext => ({ userId: w.userId, supabase: w.client, read: w.client, db: w.db, freelancer: true });

/** The freelancer's projects as their board shows them: archived ones and those of archived customers are not there. */
const projectsOf = (w: Writer) => (w.projects ??= loadFreelancerBoardAs(w.userId, w.client).then((board) => (board.error ? null : board.projects)));

/** One of the freelancer's projects, or null: a project they are not on does not exist for them. */
async function ownProject(w: Writer, projectId: unknown) {
  if (typeof projectId !== "string" || !uuid.test(projectId)) return null;
  return (await projectsOf(w))?.find((project) => project.id.toLowerCase() === projectId.toLowerCase()) ?? null;
}

/** The hub customer of a project for the admin log, from the freelancer's own customer cards. */
async function logFor(w: Writer, project: BoardProject, action: `claude.${string}`, summary: string) {
  w.customers ??= loadFreelancerCardsWith(w.client).then((cards) => new Map((cards ?? []).flatMap((card) => (card.organizationId ? [[card.organizationId, card.customerId] as const] : []))));
  await logEvent(w.userId, action, summary, (await w.customers).get(project.organizationId) ?? null);
}

type FoundTask = { id: string; version: number; title: string; archived: boolean };

/** A card the freelancer sees (their claims: „Nur Team“ cards are not there), by project and number. */
async function findTask(w: Writer, ref: { projectId: string; number: number }): Promise<FoundTask | null> {
  const { data } = await w.client.from("studio_tasks").select("id, version, title, archived").eq("project_id", ref.projectId).eq("task_number", ref.number)
    .maybeSingle<{ id: string; version: number; title: string; archived: boolean }>();
  return data ? { id: data.id, version: Number(data.version), title: data.title, archived: data.archived } : null;
}

/** A change on the card as it is now; someone saving in between makes it stale, then it runs once more on the newer card. */
async function onCurrentTask<T>(w: Writer, ref: { projectId: string; number: number }, write: (task: FoundTask) => Promise<TaskResult<T>>): Promise<{ ok: true; data: T; task: FoundTask } | { ok: false; error: string }> {
  for (let attempt = 0; ; attempt++) {
    const task = await findTask(w, ref);
    if (!task) return { ok: false, error: noTask };
    if (task.archived) return { ok: false, error: "Diese Aufgabe wurde archiviert." };
    const result = await write(task);
    if (result.ok) return { ok: true, data: result.data, task };
    if (!result.stale || attempt >= 1) return { ok: false, error: result.error };
  }
}

async function createTasks(w: Writer, args: Json): Promise<ToolResult> {
  if (Array.isArray(args.tasks) && args.tasks.some(hasAudience)) return refuse(teamDecides);
  const read = readNewTasks(args);
  if (!read.ok) return refuse(read.error);
  const project = await ownProject(w, args.project_id);
  if (!project) return refuse(noProject);

  const ctx = taskContext(w);
  const created: Json[] = [];
  const failed: { title: string; error: string }[] = [];
  for (const item of read.value) {
    // As the board's form for freelancers: the new card is theirs unless Claude names who holds it.
    const patch = item.patch.assigneeIds === undefined ? { ...item.patch, assigneeIds: [w.userId] } : item.patch;
    const result = await createTaskAs(ctx, { projectId: project.id, title: item.title, status: item.status, patch });
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
      link: freelancerLinks(w.origin).task(project.id, result.data.number),
    });
  }
  if (!created.length) return refuse(failed.length === 1 ? failed[0].error : `Keine Aufgabe wurde angelegt. ${failed[0]?.error ?? ""}`.trim());
  const what = created.length === 1 ? `Aufgabe „${String(created[0].title)}“` : `${created.length} Aufgaben`;
  await logFor(w, project, "claude.tasks.created", `${what} in „${project.name}“ über Claude angelegt (Freelancer)`);
  return json({
    saved: true,
    message: `${created.length === 1 ? "Eine Aufgabe ist" : `${created.length} Aufgaben sind`} in „${project.name}“ angelegt${failed.length ? `, ${failed.length} nicht` : ""}. Das oalab-Team sieht sie im Board.`,
    project: { project_id: project.id, name: project.name, link: freelancerLinks(w.origin).project(project.id) },
    created,
    ...(failed.length ? { not_created: failed } : {}),
  });
}

async function updateTask(w: Writer, args: Json): Promise<ToolResult> {
  const ref = readTaskRef(args);
  if (!ref.ok) return refuse(ref.error);
  const { project_id: _project, task_number: _number, ...fields } = args;
  void _project; void _number;
  if (hasAudience(fields)) return refuse(teamDecides);
  const patch = readTaskPatch(fields);
  if (!patch.ok) return refuse(patch.error);
  if (!Object.keys(patch.value).length) return refuse("Es gibt nichts zu ändern.");
  const project = await ownProject(w, ref.value.projectId);
  if (!project) return refuse(noProject);
  const ctx = taskContext(w);
  const result = await onCurrentTask(w, ref.value, (task) => updateTaskAs(ctx, { taskId: task.id, expectedVersion: task.version, patch: patch.value }));
  if (!result.ok) return refuse(result.error);
  await logFor(w, project, "claude.task.updated", `Aufgabe „${result.data.title}“ in „${project.name}“ über Claude geändert (Freelancer)`);
  return json({
    saved: true,
    message: `„${result.data.title}“ ist gespeichert.`,
    task: { task_number: result.data.number, title: result.data.title, status: STATUS_NAMES[result.data.status], link: freelancerLinks(w.origin).task(project.id, result.data.number) },
  });
}

async function moveTask(w: Writer, args: Json): Promise<ToolResult> {
  const ref = readTaskRef(args);
  if (!ref.ok) return refuse(ref.error);
  if (!isStatus(args.status)) return refuse("Diese Spalte gibt es nicht.");
  const status = args.status;
  const project = await ownProject(w, ref.value.projectId);
  if (!project) return refuse(noProject);
  const ctx = taskContext(w);
  const result = await onCurrentTask(w, ref.value, async (task) => {
    // The column as the freelancer's board shows it (their claims), as dragging there would place the card.
    const column = await w.client.from("studio_tasks").select("board_order").eq("project_id", project.id).eq("status", status).eq("archived", false).neq("id", task.id).returns<{ board_order: number }[]>();
    const order = moveOrder(args.position, (column.data ?? []).map((row) => Number(row.board_order)));
    return moveTaskAs(ctx, { taskId: task.id, status, order, expectedVersion: task.version });
  });
  if (!result.ok) return refuse(result.error);
  await logFor(w, project, "claude.task.moved", `Aufgabe „${result.data.title}“ in „${project.name}“ über Claude nach „${STATUS_NAMES[status]}“ verschoben (Freelancer)`);
  return json({
    saved: true,
    message: `„${result.data.title}“ steht jetzt in „${STATUS_NAMES[status]}“.`,
    task: { task_number: result.data.number, title: result.data.title, status: STATUS_NAMES[result.data.status], link: freelancerLinks(w.origin).task(project.id, result.data.number) },
  });
}

async function addTaskComment(w: Writer, args: Json): Promise<ToolResult> {
  const ref = readTaskRef(args);
  if (!ref.ok) return refuse(ref.error);
  if (typeof args.text !== "string") return refuse("Bitte den Kommentar als Text angeben.");
  const project = await ownProject(w, ref.value.projectId);
  if (!project) return refuse(noProject);
  const task = await findTask(w, ref.value);
  if (!task || task.archived) return refuse(noTask);
  const result = await addCommentAs(taskContext(w), { taskId: task.id, body: args.text });
  if (!result.ok) return refuse(result.error);
  await logFor(w, project, "claude.task.commented", `Kommentar zu „${task.title}“ in „${project.name}“ über Claude geschrieben (Freelancer)`);
  return json({
    saved: true,
    message: `Der Kommentar steht unter „${task.title}“. Ihn sehen das oalab-Team und die Freelancer des Projekts, nie der Kunde.`,
    task: { task_number: ref.value.number, title: task.title, link: freelancerLinks(w.origin).task(project.id, ref.value.number) },
  });
}

/* ---------- Requests to oalab ---------- */

const calendarClient = (w: Writer) => w.client as unknown as CalendarClient;

async function requestAppointment(w: Writer, args: Json): Promise<ToolResult> {
  for (const key of ["title", "day", "start", "description"]) if (args[key] !== undefined && typeof args[key] !== "string") return refuse(`${key} muss Text sein.`);
  if (args.minutes !== undefined && typeof args.minutes !== "number") return refuse("minutes muss eine Zahl sein.");
  const input = {
    title: (args.title as string | undefined) ?? "",
    description: (args.description as string | undefined) ?? "",
    day: (args.day as string | undefined) ?? "",
    start: (args.start as string | undefined) ?? "",
    minutes: (args.minutes as number | undefined) ?? 60,
  };
  // The request window's own code: availability, booked times with buffer, own open requests, at most five open.
  const saved = await requestAppointmentAs(calendarClient(w), w.userId, input);
  if (!saved.ok) return refuse(saved.error);
  const title = input.title.trim();
  const start = wallTimeToUtc(input.day, input.start);
  await logEvent(w.userId, "claude.appointment.requested", `Termin „${title}“ am ${formatDayShort(input.day)} um ${input.start} über Claude angefragt (Freelancer)`);
  return json({
    today: w.today,
    saved: true,
    message: `Deine Anfrage „${title}“ für ${formatDayShort(input.day)}, ${input.start} Uhr ist bei oalab. Du bekommst eine Meldung, sobald sie bestätigt ist.`,
    appointment: {
      appointment_id: saved.data.id, title, status: "Angefragt", day: input.day, start: input.start, end: timeOf(start + input.minutes * 60_000), minutes: input.minutes,
      link: freelancerLinks(w.origin).appointment(saved.data.id),
    },
  });
}

async function withdrawRequest(w: Writer, args: Json): Promise<ToolResult> {
  const id = typeof args.appointment_id === "string" && uuid.test(args.appointment_id) ? args.appointment_id : null;
  if (!id) return refuse("Diese Anfrage gibt es nicht. Nimm die ID aus list_appointments.");
  // Only the login's own entries, as list_appointments shows them; the database function checks it once more.
  const memberships = await w.client.from("hub_customer_members").select("customer_id").eq("user_id", w.userId).returns<{ customer_id: string }[]>();
  const entries = (memberships.data ?? []).map((row) => row.customer_id);
  const { data } = entries.length
    ? await w.client.from("hub_appointments").select("id, title, status").eq("id", id).in("customer_id", entries).maybeSingle<{ id: string; title: string; status: string }>()
    : { data: null };
  if (!data) return refuse("Diese Anfrage gibt es nicht. Nimm die ID aus list_appointments.");
  if (data.status === "confirmed") return refuse("Dieser Termin ist schon bestätigt. Absagen kann ihn nur das oalab-Team; schreib ihm unter „Nachrichten“.");
  if (data.status !== "requested") return refuse("Diese Anfrage ist schon beantwortet oder zurückgezogen.");
  const done = await withdrawRequestAs(calendarClient(w), data.id);
  if (!done.ok) return refuse(done.error);
  await logEvent(w.userId, "claude.appointment.withdrawn", `Anfrage „${data.title}“ über Claude zurückgezogen (Freelancer)`);
  return json({
    today: w.today,
    saved: true,
    message: `Deine Anfrage „${data.title}“ ist zurückgezogen.`,
    appointment: { appointment_id: data.id, title: data.title, link: freelancerLinks(w.origin).appointment(data.id) },
  });
}

/** update_checklist on a card of their own projects, through the task window's own code with their claims (lib/hub-mcp/board.ts). */
async function updateChecklist(w: Writer, args: Json): Promise<ToolResult> {
  const ref = readTaskRef(args);
  if (!ref.ok) return refuse(ref.error);
  const change = readChecklistChange(args);
  if (!change.ok) return refuse(change.error);
  const project = await ownProject(w, ref.value.projectId);
  if (!project) return refuse(noProject);
  const task = await findTask(w, { projectId: project.id, number: ref.value.number });
  if (!task || task.archived) return refuse(noTask);
  const result = await changeChecklist(taskContext(w), task.id, change.value);
  if (!result.ok) return refuse(result.error);
  if (result.changed || result.added) await logFor(w, project, "claude.task.checklist", `Checkliste von „${task.title}“ in „${project.name}“ über Claude geändert (Freelancer)`);
  return json({
    saved: Boolean(result.changed || result.added),
    message: checklistText(task.title, result),
    checklist: result.points,
    task: { task_number: ref.value.number, title: task.title, link: freelancerLinks(w.origin).task(project.id, ref.value.number) },
  });
}
