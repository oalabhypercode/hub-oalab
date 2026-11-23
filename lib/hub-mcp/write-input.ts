/**
 * The writing tools' arguments turned into exactly what the hub's own windows send (the appointment window, the task
 * board, „Neues Projekt“), and their answers in the hub's own words. Pure, so the tests check it directly;
 * lib/hub-mcp/writes.ts loads, saves through the hub's code and logs. The hub's checks (title, times, Teams links,
 * labels, dates, names, addresses) run again on save, with the hub's messages.
 */
import { dayOf, formatDayShort, isDay, timeOf, wallTimeToUtc } from "../hub-calendar/rules";
import type { AppointmentInput } from "../hub-calendar/types";
import { appointmentNotice } from "../hub-notify/rules";
import { isStatus, ORDER_LIMIT } from "../hub-tasks/rules";
import type { TaskPatch, TaskStatus } from "../hub-tasks/types";

type Json = Record<string, unknown>;
export type Read<T> = { ok: true; value: T } | { ok: false; error: string };

const given = (args: Json, key: string) => args[key] !== undefined;
const notText = (key: string) => ({ ok: false as const, error: `${key} muss Text sein.` });

/* ---------- Appointments ---------- */

/** create_appointment: the fields of „Neuer Termin“; without a customer the appointment is internal. */
export function readNewAppointment(args: Json): Read<AppointmentInput> {
  if (typeof args.title !== "string" || !args.title.trim()) return { ok: false, error: "Bitte einen Titel angeben." };
  if (!isDay(args.day)) return { ok: false, error: "Bitte den Tag als JJJJ-MM-TT angeben." };
  if (typeof args.start !== "string") return { ok: false, error: "Bitte den Beginn als HH:MM angeben." };
  for (const key of ["customer_id", "description", "teams_link"]) if (given(args, key) && typeof args[key] !== "string") return notText(key);
  return {
    ok: true,
    value: {
      title: args.title,
      description: (args.description as string | undefined) ?? "",
      customerId: (args.customer_id as string | undefined) || null,
      day: args.day,
      start: args.start,
      minutes: given(args, "minutes") ? Number(args.minutes) : 60,
      teamsUrl: (args.teams_link as string | undefined) ?? "",
    },
  };
}

/** An appointment as it is stored, for a change. */
export type StoredAppointment = { title: string; description: string; start: number; end: number; status: string; teamsUrl: string | null; customerId: string | null };
const CHANGEABLE = ["title", "day", "start", "minutes", "customer_id", "description", "teams_link"] as const;

/**
 * update_appointment: the stored appointment with the given fields over it, all fields at once, as the window saves.
 * Closed appointments stay as they are: the window offers no change for them either.
 */
export function mergeAppointment(stored: StoredAppointment, args: Json): Read<AppointmentInput> {
  if (stored.status === "declined" || stored.status === "cancelled") return { ok: false, error: "Dieser Termin ist abgesagt oder abgelehnt und lässt sich nicht mehr ändern." };
  if (!CHANGEABLE.some((key) => given(args, key))) return { ok: false, error: "Es gibt nichts zu ändern." };
  for (const key of ["title", "day", "start", "description", "teams_link"]) if (given(args, key) && typeof args[key] !== "string") return notText(key);
  if (given(args, "customer_id") && args.customer_id !== null && typeof args.customer_id !== "string") return { ok: false, error: "Unbekannter Kunde." };
  return {
    ok: true,
    value: {
      title: (args.title as string | undefined) ?? stored.title,
      description: (args.description as string | undefined) ?? stored.description,
      customerId: given(args, "customer_id") ? (args.customer_id as string | null) || null : stored.customerId,
      day: (args.day as string | undefined) ?? dayOf(stored.start),
      start: (args.start as string | undefined) ?? timeOf(stored.start),
      minutes: given(args, "minutes") ? Number(args.minutes) : Math.round((stored.end - stored.start) / 60_000),
      teamsUrl: (args.teams_link as string | undefined) ?? stored.teamsUrl ?? "",
    },
  };
}

/** cancel_appointment: a request is declined, a confirmed appointment cancelled, as the window's two buttons do. */
export function closingStatus(status: string): "declined" | "cancelled" | null {
  if (status === "requested") return "declined";
  if (status === "confirmed") return "cancelled";
  return null;
}

/**
 * What the appointment window says after saving (components/hub/screens/calendar-panels.tsx), decided by the very
 * notice the save sends the customer (lib/hub-notify/rules.ts appointmentNotice).
 */
export function appointmentSavedText(input: {
  id: string;
  title: string;
  day: string;
  start: string;
  customerId: string | null;
  company: string | null;
  teams: boolean;
  before: { status: string; startsAt: string; customerId: string | null } | null;
}): string {
  const title = input.title.trim();
  const startsAt = new Date(wallTimeToUtc(input.day, input.start)).toISOString();
  const sameCustomer = input.before && input.before.customerId === input.customerId ? { status: input.before.status, startsAt: input.before.startsAt } : null;
  const notice = input.customerId ? appointmentNotice({ id: input.id, title, startsAt, before: sameCustomer, status: "confirmed" }) : null;
  const who = input.company ?? "Der Kunde";
  if (notice?.kind === "appointment.confirmed") return `Bestätigt: „${title}“ am ${formatDayShort(input.day)}, ${input.start}. ${who} bekommt eine Meldung${input.teams ? " mit Teams-Link" : ""} und Kalenderknöpfen.`;
  const saved = input.before ? `„${title}“ gespeichert.` : `„${title}“ steht am ${formatDayShort(input.day)} um ${input.start} im Kalender.`;
  if (notice?.kind === "appointment.changed") return `${saved} ${who} bekommt eine Meldung zur neuen Zeit.`;
  if (notice) return `${saved} ${who} bekommt eine Meldung.`;
  return saved;
}

/** What the window says after „Termin absagen“ or „Anfrage ablehnen“. */
export function appointmentClosedText(status: "declined" | "cancelled", title: string, company: string | null, note: string): string {
  if (status === "cancelled") return `„${title}“ abgesagt.${company ? ` ${company} bekommt eine Meldung.` : ""}`;
  return `Anfrage „${title}“ abgelehnt. ${company ?? "Der Kunde"} bekommt eine Meldung${note.trim() ? " mit deinem Grund" : ""}.`;
}

/* ---------- Tasks ---------- */

/** The fields of a change as the task window sends them; the board's own checks follow on save. */
export function readTaskPatch(args: Json): Read<TaskPatch> {
  const patch: TaskPatch = {};
  for (const key of ["title", "description"]) if (given(args, key) && typeof args[key] !== "string") return notText(key);
  if (given(args, "title")) patch.title = args.title as string;
  if (given(args, "description")) patch.description = args.description as string;
  if (given(args, "priority")) patch.priority = args.priority as TaskPatch["priority"];
  if (given(args, "due_on")) patch.dueOn = args.due_on as string | null;
  if (given(args, "labels")) patch.labels = args.labels as string[];
  if (given(args, "assignee_ids")) patch.assigneeIds = args.assignee_ids as string[];
  if (given(args, "audience")) patch.audience = args.audience as TaskPatch["audience"];
  return { ok: true, value: patch };
}

export const MAX_NEW_TASKS = 20;
export const MAX_CHECKLIST = 30;
export type NewTask = { title: string; status: TaskStatus; patch: TaskPatch; checklist: string[] };

/** create_tasks: each card as „Neue Aufgabe“ creates it (title, column, then its fields), with its checklist. */
export function readNewTasks(args: Json): Read<NewTask[]> {
  if (!Array.isArray(args.tasks) || !args.tasks.length) return { ok: false, error: "Bitte mindestens eine Aufgabe angeben." };
  if (args.tasks.length > MAX_NEW_TASKS) return { ok: false, error: `Höchstens ${MAX_NEW_TASKS} Aufgaben auf einmal.` };
  const tasks: NewTask[] = [];
  for (const [index, item] of args.tasks.entries()) {
    const label = `Aufgabe ${index + 1}`;
    if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false, error: `${label} ist ungültig.` };
    const { title, status, checklist = [], ...fields } = item as Json;
    if (typeof title !== "string" || !title.trim()) return { ok: false, error: `${label}: Der Titel fehlt.` };
    if (status !== undefined && !isStatus(status)) return { ok: false, error: `${label}: Diese Spalte gibt es nicht.` };
    if (!Array.isArray(checklist) || checklist.length > MAX_CHECKLIST || checklist.some((point) => typeof point !== "string" || !point.trim())) {
      return { ok: false, error: `${label}: Die Checkliste ist ungültig (höchstens ${MAX_CHECKLIST} Punkte, keiner leer).` };
    }
    const patch = readTaskPatch(fields);
    if (!patch.ok) return { ok: false, error: `${label}: ${patch.error}` };
    tasks.push({ title, status: (status as TaskStatus | undefined) ?? "todo", patch: patch.value, checklist: checklist as string[] });
  }
  return { ok: true, value: tasks };
}

/** Where a moved card lands: below the last card of the column or above the first (board_order), within Studio's limit. */
export function moveOrder(position: unknown, orders: readonly number[]): number {
  if (!orders.length) return 1;
  const value = position === "start" ? Math.min(...orders) - 1 : Math.max(...orders) + 1;
  return Math.max(-ORDER_LIMIT, Math.min(ORDER_LIMIT, value));
}

/** A task by its number in a project, as get_project and list_tasks name it. */
export function readTaskRef(args: Json): Read<{ projectId: string; number: number }> {
  if (typeof args.project_id !== "string") return { ok: false, error: "Bitte das Projekt angeben (project_id)." };
  if (typeof args.task_number !== "number" || !Number.isSafeInteger(args.task_number) || args.task_number < 1) return { ok: false, error: "Bitte die Nummer der Aufgabe angeben (task_number)." };
  return { ok: true, value: { projectId: args.project_id, number: args.task_number } };
}

/* ---------- Projects ---------- */

/** create_project: the fields of „Neues Projekt“ (lib/hub-projects/edit.ts readProjectDraft checks them on save). */
export function readNewProject(args: Json): Read<{ customerId: string; status?: unknown; visible?: unknown; draft: Json }> {
  if (typeof args.customer_id !== "string") return { ok: false, error: "Bitte den Kunden angeben (customer_id aus search)." };
  for (const key of ["name", "description", "live_url", "test_url"]) if (given(args, key) && typeof args[key] !== "string") return notText(key);
  return {
    ok: true,
    value: {
      customerId: args.customer_id,
      ...(given(args, "status") ? { status: args.status } : {}),
      ...(given(args, "visible") ? { visible: args.visible } : {}),
      draft: {
        name: args.name ?? "",
        description: args.description ?? "",
        startDate: args.start_date ?? null,
        dueDate: args.due_date ?? null,
        milestones: args.milestones ?? [],
        liveUrl: args.live_url ?? "",
        testUrl: args.test_url ?? "",
      },
    },
  };
}

/**
 * update_project: the fields of the project panel Claude names, in the panel's form (lib/hub-projects/edit.ts
 * readProjectPatch checks them on save), and the status apart, as the page sets it apart. Empty addresses clear them.
 */
export function readProjectUpdate(args: Json): Read<{ projectId: string; patch: Json; status?: unknown }> {
  if (typeof args.project_id !== "string") return { ok: false, error: "Bitte das Projekt angeben (project_id aus search oder get_customer)." };
  for (const key of ["name", "description", "live_url", "test_url"]) if (given(args, key) && typeof args[key] !== "string") return notText(key);
  if (given(args, "visible") && typeof args.visible !== "boolean") return { ok: false, error: "visible ist true oder false." };
  const patch: Json = {};
  if (given(args, "name")) patch.name = args.name;
  if (given(args, "description")) patch.description = args.description;
  if (given(args, "start_date")) patch.startDate = args.start_date;
  if (given(args, "due_date")) patch.dueDate = args.due_date;
  if (given(args, "milestones")) patch.milestones = args.milestones;
  if (given(args, "live_url")) patch.liveUrl = args.live_url;
  if (given(args, "test_url")) patch.testUrl = args.test_url;
  if (given(args, "visible")) patch.clientVisible = args.visible;
  if (!Object.keys(patch).length && !given(args, "status")) return { ok: false, error: "Es gibt nichts zu ändern." };
  return { ok: true, value: { projectId: args.project_id, patch, ...(given(args, "status") ? { status: args.status } : {}) } };
}

export type ChecklistChange = { points: { id: string; done?: boolean; title?: string }[]; add: string[] };

/** update_checklist: points to tick, untick or rename (by point_id from get_task) and new points at the end. */
export function readChecklistChange(args: Json): Read<ChecklistChange> {
  const points = args.points === undefined ? [] : args.points;
  const add = args.add === undefined ? [] : args.add;
  if (!Array.isArray(points) || points.length > MAX_CHECKLIST) return { ok: false, error: `points ist eine Liste mit höchstens ${MAX_CHECKLIST} Punkten.` };
  if (!Array.isArray(add) || add.length > MAX_CHECKLIST || add.some((title) => typeof title !== "string" || !title.trim())) return { ok: false, error: `add ist eine Liste mit höchstens ${MAX_CHECKLIST} Punkten, keiner leer.` };
  const read: ChecklistChange["points"] = [];
  for (const [index, point] of points.entries()) {
    const item = point && typeof point === "object" && !Array.isArray(point) ? point as Json : null;
    if (!item || typeof item.point_id !== "string") return { ok: false, error: `Punkt ${index + 1}: point_id aus get_task fehlt.` };
    if (item.done !== undefined && typeof item.done !== "boolean") return { ok: false, error: `Punkt ${index + 1}: done ist true oder false.` };
    if (item.title !== undefined && (typeof item.title !== "string" || !item.title.trim())) return { ok: false, error: `Punkt ${index + 1}: Der Titel ist leer.` };
    if (item.done === undefined && item.title === undefined) return { ok: false, error: `Punkt ${index + 1}: Es gibt nichts zu ändern.` };
    if (read.some((other) => other.id.toLowerCase() === (item.point_id as string).toLowerCase())) return { ok: false, error: `Punkt ${index + 1} steht doppelt in der Liste.` };
    read.push({ id: item.point_id, ...(item.done !== undefined ? { done: item.done as boolean } : {}), ...(item.title !== undefined ? { title: item.title as string } : {}) });
  }
  if (!read.length && !add.length) return { ok: false, error: "Es gibt nichts zu ändern." };
  return { ok: true, value: { points: read, add: add as string[] } };
}

/** add_availability_exception: the fields of „Ausnahme“ under Verfügbarkeit (lib/hub-calendar/rules.ts readException checks them). */
export function readExceptionArgs(args: Json): Read<{ kind?: unknown; from?: unknown; until?: unknown; allDay?: unknown; start?: unknown; end?: unknown; note?: unknown }> {
  if (args.kind !== "off" && args.kind !== "extra") return { ok: false, error: "kind ist off (nicht verfügbar) oder extra (zusätzliche Zeit)." };
  if (args.kind === "extra" && (given(args, "until") || args.all_day === true)) return { ok: false, error: "Zusätzliche Zeit gilt für einen Tag und von–bis: ohne until und all_day." };
  if (args.all_day === true && (given(args, "start") || given(args, "end"))) return { ok: false, error: "Ganztags hat keine Uhrzeiten: lass start und end weg." };
  if (given(args, "note") && typeof args.note !== "string") return notText("note");
  return { ok: true, value: { kind: args.kind, from: args.from, until: args.until, allDay: args.all_day === true, start: args.start, end: args.end, note: args.note ?? "" } };
}
