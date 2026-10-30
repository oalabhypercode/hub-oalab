/**
 * Notifications for customers: what turns into a notice and when the bundled mail is due. Self-contained (no
 * imports), so `node --test` checks the rules directly; lib/hub-notify/server.ts reads and writes the database.
 *
 * - A task "lies with the customer" when it is released to them, not archived, not done and carries the label
 *   "Kunde" (the same rule as "Dein Feedback" in lib/hub-projects/map.ts and the starting marks in the migration).
 *   The customer hears about it once each time it moves to them.
 * - A project notice goes out when Studio's status or target date of a released project changes.
 * - Studio changes come from studio_activity, which has no old values; hub_notice_marks keeps the last state per
 *   task and project, so re-reading an event never notifies twice.
 */

export type NoticeKind =
  | "task.customer" | "project.changed" | "file.shared"
  | "appointment.created" | "appointment.changed" | "appointment.confirmed" | "appointment.cancelled" | "appointment.declined";

export type Notice = { kind: NoticeKind; title: string; body: string; href: string };

export type ActivityRow = { created_at: string; event_type: string; project_id: string; task_id: string | null };
export type NoticeTask = { id: string; project_id: string; task_number: number; title: string; status: string; labels: string[] | null; client_visible: boolean; archived: boolean };
export type NoticeDetails = { project_id: string; status: string; due_date: string | null; client_visible: boolean };
export type NoticeProject = { id: string; organization_id: string; display_name: string; status: string };

export const STUDIO_EVENTS = ["task.insert", "task.update", "project.insert", "project.update"];
export const CURSOR = "cursor:studio_activity";
/** Activity is read again from this long before the cursor, so late commits are not missed; marks keep it idempotent. */
export const OVERLAP_MINUTES = 10;
/** The first unsent notice waits this long, so a burst of changes becomes one mail. */
export const MAIL_WAIT_MINUTES = 15;
/** Notices per mail; the rest are in the hub. */
export const MAIL_ITEMS = 10;

const projectStatusLabels: Record<string, string> = { planning: "Planung", active: "Aktiv", risk: "Risiko", hold: "Pausiert", complete: "Abgeschlossen" };
const day = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
const moment = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

const clip = (value: string, length: number) => value.length > length ? `${value.slice(0, length - 1).trimEnd()}…` : value;
export const projectHref = (projectId: string) => `/dashboard/projects?project=${projectId}`;

/** "6. November 2026" for a Studio date (YYYY-MM-DD). */
export function formatDay(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? day.format(new Date(`${value}T00:00:00Z`)) : value;
}

/** "Fr., 6. November um 10:00 Uhr" for an appointment start, in Berlin time. */
export function formatMoment(iso: string) {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : `${moment.format(at)} Uhr`;
}

export function taskState(task: Pick<NoticeTask, "status" | "labels" | "client_visible" | "archived">): "customer" | "other" {
  const customer = (task.labels ?? []).some((label) => label.trim().toLowerCase() === "kunde");
  return task.client_visible && !task.archived && task.status !== "done" && customer ? "customer" : "other";
}

export const projectState = (details: Pick<NoticeDetails, "status" | "due_date">) => `${details.status}|${details.due_date ?? ""}`;

/** What changed between two project states, in words: "Status: Aktiv → Pausiert · Zieltermin: 6. November 2026". */
export function describeProjectChange(before: string, after: string) {
  const [oldStatus, oldDue] = before.split("|");
  const [newStatus, newDue] = after.split("|");
  const parts: string[] = [];
  if (oldStatus !== newStatus) parts.push(`Status: ${projectStatusLabels[oldStatus] ?? oldStatus} → ${projectStatusLabels[newStatus] ?? newStatus}`);
  if (oldDue !== newDue) parts.push(newDue ? `Zieltermin: ${formatDay(newDue)}` : "Zieltermin entfernt");
  return parts.join(" · ");
}

export type StudioInput = {
  activity: ActivityRow[];
  tasks: NoticeTask[];
  details: NoticeDetails[];
  projects: NoticeProject[];
  marks: Map<string, string>;
};

/**
 * Notices from a batch of Studio activity, per organization, and the marks to store. A task or project seen for the
 * first time only gets a mark, unless it was created in this batch: a new task that lies with the customer notifies.
 */
export function detectStudioNotices({ activity, tasks, details, projects, marks }: StudioInput) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const detailsById = new Map(details.map((row) => [row.project_id, row]));
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const created = new Set(activity.filter((row) => row.event_type.endsWith(".insert")).map((row) => row.task_id ?? row.project_id));
  const visible = (projectId: string) => {
    const project = projectById.get(projectId);
    return project && project.status !== "archived" && detailsById.get(projectId)?.client_visible ? project : null;
  };

  const notices: { organizationId: string; notice: Notice }[] = [];
  const changed = new Map<string, string>();

  const taskIds = [...new Set(activity.filter((row) => row.event_type.startsWith("task.") && row.task_id).map((row) => row.task_id as string))];
  for (const id of taskIds) {
    const task = taskById.get(id);
    if (!task) continue;
    const subject = `task:${id}`;
    const now = taskState(task);
    const before = marks.get(subject) ?? (created.has(id) ? "other" : undefined);
    if (before !== now) changed.set(subject, now);
    const project = visible(task.project_id);
    if (before === undefined || now !== "customer" || before === "customer" || !project) continue;
    notices.push({
      organizationId: project.organization_id,
      notice: { kind: "task.customer", title: clip(`Du bist am Zug: ${task.title}`, 200), body: clip(`${project.display_name} · Aufgabe #${task.task_number}`, 300), href: projectHref(project.id) },
    });
  }

  const projectIds = [...new Set(activity.filter((row) => row.event_type.startsWith("project.")).map((row) => row.project_id))];
  for (const id of projectIds) {
    const row = detailsById.get(id);
    if (!row) continue;
    const subject = `project:${id}`;
    const now = projectState(row);
    const before = marks.get(subject);
    if (before !== now) changed.set(subject, now);
    const project = visible(id);
    if (before === undefined || before === now || !project) continue;
    const change = describeProjectChange(before, now);
    if (!change) continue;
    notices.push({
      organizationId: project.organization_id,
      notice: { kind: "project.changed", title: clip(`Projekt aktualisiert: ${project.display_name}`, 200), body: clip(change, 300), href: projectHref(project.id) },
    });
  }

  return { notices, marks: changed };
}

/** Where to start reading activity: a little before the cursor (see OVERLAP_MINUTES). */
export function readFrom(cursor: string) {
  const at = Date.parse(cursor);
  return Number.isNaN(at) ? null : new Date(at - OVERLAP_MINUTES * 60_000).toISOString();
}

/** The new cursor: the latest activity read, never earlier than the current one. */
export function nextCursor(cursor: string, activity: Pick<ActivityRow, "created_at">[]) {
  return activity.reduce((latest, row) => Date.parse(row.created_at) > Date.parse(latest) ? row.created_at : latest, cursor);
}

export type PendingRow = { id: number; user_id: string; created_at: string; read_at: string | null; kind: string; title: string; body: string; href: string };

/**
 * Logins whose oldest unsent notice waited long enough. Everything pending goes into one mail, also notices the
 * person already opened in the bell (decision of 30.10.2026: the mail is the record, whatever was read).
 */
export function dueDigests(rows: PendingRow[], now: Date) {
  const byUser = new Map<string, PendingRow[]>();
  for (const row of rows) byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);
  const due = now.getTime() - MAIL_WAIT_MINUTES * 60_000;
  return [...byUser.entries()]
    .filter(([, list]) => Math.min(...list.map((row) => Date.parse(row.created_at))) <= due)
    .map(([userId, list]) => ({ userId, rows: [...list].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)) }));
}

/** The mail setting lives in the login's own metadata; only an explicit "off" stops mails. */
export const mailsWanted = (metadata: Record<string, unknown> | null | undefined) => metadata?.hub_mail_notifications !== false;

/**
 * The appointment's id rides in the notice's link: the bell still opens the calendar, and the mail finds the
 * appointment by it for the calendar buttons (no extra column in hub_inbox).
 */
export const appointmentHref = (appointmentId: string) => `/dashboard/calendar?appointment=${appointmentId}`;

/** The appointment a notice links to, or null. */
export function noticeAppointment(href: string) {
  return /^\/dashboard\/calendar\?appointment=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(href)?.[1] ?? null;
}

/** Appointment notices for the customer; null when nothing worth telling changed. */
export function appointmentNotice(input: {
  id: string;
  title: string;
  startsAt: string;
  before: { status: string; startsAt: string } | null;
  status: "confirmed" | "declined" | "cancelled";
  note?: string;
}): Notice | null {
  const when = formatMoment(input.startsAt);
  const note = input.note?.trim() ? ` · ${input.note.trim()}` : "";
  const make = (kind: NoticeKind, title: string, body: string): Notice => ({ kind, title: clip(title, 200), body: clip(body, 300), href: appointmentHref(input.id) });
  if (input.status === "declined") return make("appointment.declined", `Terminanfrage abgelehnt: ${input.title}`, `${when}${note}`);
  if (input.status === "cancelled") return make("appointment.cancelled", `Termin abgesagt: ${input.title}`, `${when}${note}`);
  if (!input.before) return make("appointment.created", `Neuer Termin: ${input.title}`, when);
  if (input.before.status === "requested") return make("appointment.confirmed", `Termin bestätigt: ${input.title}`, when);
  if (Date.parse(input.before.startsAt) !== Date.parse(input.startsAt)) return make("appointment.changed", `Termin verschoben: ${input.title}`, when);
  return null;
}

/** A file shared with the customer; the link opens it in the files page. */
export const fileNotice = (fileName: string, fileId: string): Notice => ({ kind: "file.shared", title: clip(`Neue Datei: ${fileName}`, 200), body: "Im Bereich Dateien", href: `/dashboard/files?file=${encodeURIComponent(fileId)}` });

/** Only these notices offer "In deinen Kalender eintragen"; cancelled and declined ones do not. */
const CALENDAR_KINDS = new Set<string>(["appointment.created", "appointment.confirmed", "appointment.changed"]);

/**
 * Which rows of one mail get calendar buttons, with their appointment: new, confirmed and moved appointments that are
 * still confirmed and not over. Each appointment once, on its latest notice (rows come oldest first); the links
 * always deliver the current time anyway.
 */
export function calendarRows(
  rows: Pick<PendingRow, "id" | "kind" | "href">[],
  appointments: Map<string, { status: string; ends_at: string }>,
  now: Date,
) {
  const latest = new Map<string, number>();
  for (const row of rows) {
    const appointmentId = CALENDAR_KINDS.has(row.kind) ? noticeAppointment(row.href) : null;
    const appointment = appointmentId ? appointments.get(appointmentId) : undefined;
    if (appointmentId && appointment?.status === "confirmed" && Date.parse(appointment.ends_at) > now.getTime()) latest.set(appointmentId, row.id);
  }
  return new Map([...latest].map(([appointmentId, rowId]) => [rowId, appointmentId]));
}
