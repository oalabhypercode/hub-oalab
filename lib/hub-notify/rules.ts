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
  | "appointment.created" | "appointment.changed" | "appointment.confirmed" | "appointment.cancelled" | "appointment.declined"
  | "chat.message" | "chat.reply"
  | TaskNoticeKind
  | "share.granted"
  | "note.shared" | "note.changed" | "note.edited"
  | "service.message";

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
/** A customer's message reaches the admins sooner: a few minutes, enough for a short burst to become one mail. */
export const CHAT_MAIL_WAIT_MINUTES = 5;
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

/** Notices of the private chat (4.11.2026): a customer wrote (to the admins) or oalab answered (to the customer). */
export const isChatKind = (kind: string) => kind === "chat.message" || kind === "chat.reply";
/**
 * Notices about something to read in the hub (23.11.2026): a chat message, a customer's message on the service platform,
 * a page a customer or freelancer wrote on. Seen in the hub, they need no mail.
 */
export const isReadInHub = (kind: string) => isChatKind(kind) || kind === "service.message" || kind === "note.edited";
/** A customer's message, in the chat or on the service platform, reaches the admins' mail sooner. */
export const mailWaitMinutes = (kind: string) => kind === "chat.message" || kind === "service.message" ? CHAT_MAIL_WAIT_MINUTES : MAIL_WAIT_MINUTES;

/**
 * Chat notices (and the team's lines about service messages and edited notes) read before their mail is due stay out
 * of it: the message was seen in the hub, as when a customer reads an answer on the service platform. Every other
 * notice goes into the mail even if it was opened in the bell (decision of 30.10.2026: the mail is the record).
 */
export const skipsMail = (row: Pick<PendingRow, "kind" | "read_at">) => isReadInHub(row.kind) && Boolean(row.read_at);

/**
 * Logins with a notice that waited long enough (chat messages to admins a few minutes, everything else a quarter of an
 * hour). Everything pending goes into one mail.
 */
export function dueDigests(rows: PendingRow[], now: Date) {
  const byUser = new Map<string, PendingRow[]>();
  for (const row of rows) byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);
  return [...byUser.entries()]
    .filter(([, list]) => list.some((row) => Date.parse(row.created_at) + mailWaitMinutes(row.kind) * 60_000 <= now.getTime()))
    .map(([userId, list]) => ({ userId, rows: [...list].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)) }));
}

/** Where a chat notice leads: the customer's private chat in Nachrichten. */
export const chatHref = (customerId: string) => `/dashboard/messages?chat=${customerId}`;

/** The customer a chat notice belongs to, or null. */
export function noticeChat(href: string) {
  return /^\/dashboard\/messages\?chat=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(href)?.[1] ?? null;
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * The bell's line for a new chat message. To admins: "Neue Nachricht von Nordlicht Studio" with "Jana Sommer: …"; to
 * the customer: "Neue Nachricht von oalab" with "Lena: …" (oalab's people by first name, as in the chat). A further
 * message before the first is read updates the same notice ("Neue Nachrichten von …"), so a conversation fills the
 * bell with one line, not one per message.
 */
export function chatNotice(input: { kind: "chat.message" | "chat.reply"; customerId: string; company: string; author: string; body: string; more?: boolean }): Notice {
  const from = input.kind === "chat.message" ? input.company : "oalab";
  const who = oneLine(input.kind === "chat.reply" ? input.author.split(/\s+/)[0] ?? "" : input.author);
  const title = `${input.more ? "Neue Nachrichten" : "Neue Nachricht"} von ${oneLine(from)}`;
  const body = who ? `${who}: ${oneLine(input.body)}` : oneLine(input.body);
  return { kind: input.kind, title: clip(title, 200), body: clip(body, 300), href: chatHref(input.customerId) };
}

/** The mail setting lives in the login's own metadata; only an explicit "off" stops mails. */
export const mailsWanted = (metadata: Record<string, unknown> | null | undefined) => metadata?.hub_mail_notifications !== false;

/**
 * The appointment's id rides in the notice's link: the bell still opens the calendar, and the mail finds the
 * appointment by it for the calendar buttons (no extra column in hub_inbox).
 */
export const appointmentHref = (appointmentId: string) => `/dashboard/projects/calendar?appointment=${appointmentId}`;

/**
 * The appointment a notice links to, or null. Notices written before the calendar moved under Projekte (16.11.2026)
 * still carry the old address, which forwards; both are read.
 */
export function noticeAppointment(href: string) {
  return /^\/dashboard\/(?:projects\/)?calendar\?appointment=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(href)?.[1] ?? null;
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

/**
 * A note page newly visible to a customer or their freelancers („Neue Notiz“, plan docs/planung/notizen.md 2.3), or a
 * change the team tells them about („Änderung mitteilen“). Only the title, never the content; the link opens the page.
 */
export const noteNotice = (kind: "note.shared" | "note.changed", title: string, customerId: string, pageId: string, edit?: "with" | "only"): Notice => ({
  kind,
  title: clip(`${kind === "note.changed" ? "Notiz geändert" : edit === "with" ? "Neue Notiz zum Mitschreiben" : edit === "only" ? "Du kannst mitschreiben" : "Neue Notiz"}: ${title}`, 200),
  body: edit ? "Unter Projekte › Notizen, zum Lesen und Mitschreiben" : "Unter Projekte › Notizen",
  href: notePageHref(customerId, pageId),
});

/** Where a note notice leads: the page under Projekte › Notizen. */
export const notePageHref = (customerId: string, pageId: string) => `/dashboard/projects/notes?customer=${encodeURIComponent(customerId)}&page=${encodeURIComponent(pageId)}`;

/**
 * The team's line when a customer or a freelancer wrote on a page (23.11.2026): „Notiz bearbeitet: Feedback“ with who
 * and where. A further edit before the line is read updates it, so a page fills the bell with one line.
 */
export function noteEditNotice(input: { title: string; customerId: string; pageId: string; company: string; author: string; side: "customer" | "freelancer" }): Notice {
  const who = oneLine(input.author) || (input.side === "customer" ? "Kunde" : "Freelancer");
  const body = input.side === "customer" ? `${who} · ${oneLine(input.company)}` : `${who} (Freelancer) · ${oneLine(input.company)}`;
  return { kind: "note.edited", title: clip(`Notiz bearbeitet: ${oneLine(input.title)}`, 200), body: clip(body, 300), href: notePageHref(input.customerId, input.pageId) };
}

// Service platform (23.11.2026) ---------------------------------------------------------------------------------------

/** Where a service notice leads: the request in Nachrichten › Service. */
export const serviceHref = (requestId: string) => `/dashboard/messages?tab=service&conversation=${requestId}`;

/** The request a service notice belongs to, or null. */
export function noticeRequest(href: string) {
  return /^\/dashboard\/messages\?tab=service&conversation=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(href)?.[1] ?? null;
}

/** The hub's place in the customers' messages on the service platform, and the mark of each one it reported. */
export const SERVICE_CURSOR = "cursor:service_messages";
export const serviceMark = (messageId: string) => `service-message:${messageId}`;
/** Messages are read again from this long before the cursor, so late commits are not missed; marks keep it idempotent. */
export const SERVICE_OVERLAP_MINUTES = 10;

/**
 * The admins' line for a customer's message on the service platform, like the chat's: „Neue Anfrage von Nordlicht
 * Studio: OA-12 Texte freigeben“ (or „Neue Nachricht von …“ in an open request) with "Jana Sommer: Text". A
 * further message before the line is read updates it („Neue Nachrichten von …“).
 */
export function serviceNotice(input: { requestId: string; reference: string; title: string; company: string; author: string; body: string; first: boolean; more?: boolean }): Notice {
  const company = oneLine(input.company) || "Kunde";
  const lead = input.more ? "Neue Nachrichten von" : input.first ? "Neue Anfrage von" : "Neue Nachricht von";
  const who = oneLine(input.author);
  const body = who ? `${who}: ${oneLine(input.body)}` : oneLine(input.body);
  return { kind: "service.message", title: clip(`${lead} ${company}: ${input.reference} ${oneLine(input.title)}`, 200), body: clip(body, 300), href: serviceHref(input.requestId) };
}

/** A file shared with the customer; the link opens it in the files page. */
export const fileNotice = (fileName: string, fileId: string): Notice => ({ kind: "file.shared", title: clip(`Neue Datei: ${fileName}`, 200), body: "Im Bereich Dateien", href: `/dashboard/files?file=${encodeURIComponent(fileId)}` });

// New files in one line (19.11.2026) -------------------------------------------------------------------------------
//
// While a file line is unread and its mail not on its way, the next files join it instead of adding lines, the newest
// names first, as the task lines do: an upload or a drop of many files becomes one line in the bell and one item in
// the mail. A single file keeps its own line with its link; several lead to the files page.

const SINGLE_FILE = "Neue Datei: ";
const nameOf = (notice: Notice) => notice.title.startsWith(SINGLE_FILE) ? notice.title.slice(SINGLE_FILE.length) : notice.title;

/** How many files a file line stands for: „Neue Datei: …“ one, „4 neue Dateien“ four. */
export function fileNoticeCount(title: string) {
  const many = /^(\d+) neue Dateien$/.exec(title);
  return many ? Number(many[1]) : 1;
}

/** Several files in one line: the number, the two newest names and how many more. */
export function filesNotice(names: string[], total = names.length): Notice {
  const shown = names.slice(0, 2);
  const rest = Math.max(0, total - shown.length);
  return { kind: "file.shared", title: `${total} neue Dateien`, body: clip(rest ? `${shown.join(", ")} und ${rest} weitere` : shown.join(" und "), 300), href: "/dashboard/files" };
}

/** The line for files that find no open line: one file as it always was, several together. */
export const fileNoticeLine = (notices: Notice[]): Notice => notices.length === 1 ? notices[0] : filesNotice(notices.map(nameOf));

/** An unread file line taking in more files, each given as its single-file notice, newest first. */
export function mergeFileNotice(previousTitle: string, notices: Notice[]): Notice {
  const before = previousTitle.startsWith(SINGLE_FILE) ? [previousTitle.slice(SINGLE_FILE.length)] : [];
  return filesNotice([...notices.map(nameOf), ...before], fileNoticeCount(previousTitle) + notices.length);
}

// Releases for freelancers (18.11.2026) ----------------------------------------------------------------------------
//
// An admin switched on an area of a customer under „Vertrag & Domain“ › Freelancer: that freelancer hears of it in the
// bell (no mail). One unread line per customer: further releases there add their area to it.

const SHARE_WHERE = "Unter Kunden › Vertrag & Domain";

/** „Neu freigegeben bei Nordlicht Studio“ with the released areas; the link opens the customer's tab. */
export function shareNotice(company: string, areas: readonly string[], customerId: string): Notice {
  return {
    kind: "share.granted",
    title: clip(`Neu freigegeben bei ${oneLine(company)}`, 200),
    body: clip(`${[...new Set(areas)].join(", ")} · ${SHARE_WHERE}`, 300),
    href: `/dashboard/customers?customer=${encodeURIComponent(customerId)}&tab=vd`,
  };
}

/** The areas a share line names already (its body before the place). */
export const sharedAreasOf = (body: string) => {
  const cut = body.lastIndexOf(` · ${SHARE_WHERE}`);
  return cut > 0 ? body.slice(0, cut).split(", ").filter(Boolean) : [];
};

/** Adds an area to the line the freelancer has not read yet (once each, in the order they came). */
export const mergeShareNotice = (previous: { body: string }, company: string, area: string, customerId: string): Notice =>
  shareNotice(company, [...sharedAreasOf(previous.body), area], customerId);

// Task board notices (17.11.2026) --------------------------------------------------------------------------------
//
// Whoever sees a card hears in the bell when someone else creates or changes it: the project's freelancers (unless
// „Nur Team“), the customer for cards released to them (only what they see: new, status, title, due date) and, when a
// freelancer made the change, the admins (bell only). One line per card and person while it is unread: further
// changes are written into it, newest first, like the chat does. The customer's „Du bist am Zug“ stays with the
// sweep above; a change that hands the card to the customer leaves it to that notice.

export type TaskNoticeKind = "task.created" | "task.changed";
export const TASK_NOTICE_KINDS: readonly TaskNoticeKind[] = ["task.created", "task.changed"];
export const isTaskNotice = (kind: string): kind is TaskNoticeKind => (TASK_NOTICE_KINDS as readonly string[]).includes(kind);

/** Fields of a card whose change the bell names (status and due date have words of their own). */
export type TaskField = "title" | "description" | "priority" | "labels" | "assignees" | "audience";

/**
 * What happened to a card. `status` comes worded („In Arbeit“), `due` as Studio's day (null: removed), `comment` and
 * the checklist point as written.
 */
export type TaskChange = {
  created?: true;
  status?: string;
  fields?: TaskField[];
  due?: string | null;
  comment?: string;
  checklist?: { state: "added" | "done" | "open" | "renamed"; title: string } | { state: "removed" };
  archived?: true;
};

export const hasTaskChange = (change: TaskChange) =>
  Boolean(change.created || change.status || change.fields?.length || change.due !== undefined || change.comment || change.checklist || change.archived);

const FIELD_WORDS: Record<TaskField, string> = { title: "Titel", description: "Beschreibung", priority: "Priorität", labels: "Labels", assignees: "Zuständige", audience: "Sichtbarkeit" };
const FIELD_ORDER = Object.keys(FIELD_WORDS) as TaskField[];
// The parts of a line are joined with " · ", so a quote never carries one.
const quote = (text: string, length: number) => `„${clip(oneLine(text).replace(/·/g, "-"), length)}“`;

/**
 * The parts of a bell line for one change, newest first. The team (freelancers, admins) reads everything and who did
 * it; the customer reads only what they see of a card, without names.
 */
export function taskChangeParts(change: TaskChange, viewer: "team" | "customer", actor = ""): string[] {
  const parts: string[] = [];
  if (change.archived && viewer === "team") parts.push("Archiviert");
  if (change.status) parts.push(`Status: ${change.status}`);
  if (change.due !== undefined) parts.push(change.due ? `Fällig: ${formatDay(change.due)}` : "Fälligkeit entfernt");
  const fields = FIELD_ORDER.filter((field) => change.fields?.includes(field) && (viewer === "team" || field === "title"));
  if (fields.length) parts.push(`Geändert: ${fields.map((field) => FIELD_WORDS[field]).join(", ")}`);
  if (viewer === "team") {
    if (change.comment) parts.push(`Kommentar: ${quote(change.comment, 80)}`);
    const point = change.checklist;
    if (point) {
      parts.push(point.state === "removed"
        ? "Checkliste: ein Punkt entfernt"
        : `Checkliste: ${quote(point.title, 50)} ${{ added: "neu", done: "erledigt", open: "wieder offen", renamed: "umbenannt" }[point.state]}`);
    }
    const who = oneLine(actor);
    if (who) parts.push(`von ${who}`);
  }
  return parts;
}

/** What a customer sees of a change: a new card, its status, title or due date. */
export const customerSeesChange = (change: TaskChange) => Boolean(change.created || change.status || change.due !== undefined || change.fields?.includes("title"));

/** A card as the notices judge it: who may see it, and whether it lies with the customer (taskState). */
export type TaskSight = { teamOnly: boolean; clientVisible: boolean; archived: boolean; customerState: "customer" | "other" };

/**
 * Which notice a change brings to the project's freelancers and to the customer: "task.created" when the card only
 * now becomes visible to them, "task.changed" when they saw it before, null when nothing goes to them. `before` is the
 * card before the change (null for a new one). An archived card tells the freelancers once; the customer never hears
 * of archiving.
 */
export function taskAudience(input: { before: TaskSight | null; after: TaskSight; projectReleased: boolean; change: TaskChange }): { freelancers: TaskNoticeKind | null; customers: TaskNoticeKind | null } {
  const { change, projectReleased } = input;
  // Archiving is judged by who saw the card until now.
  const live = (card: TaskSight) => change.archived ? { ...card, archived: false } : card;
  const after = live(input.after);
  const before = input.before && live(input.before);
  const freelancersSee = (card: TaskSight) => !card.archived && !card.teamOnly;
  const customersSee = (card: TaskSight) => !card.archived && card.clientVisible && projectReleased;
  const newFor = (sees: (card: TaskSight) => boolean) => Boolean(change.created) || before === null || !sees(before);

  const freelancers = freelancersSee(after) ? (newFor(freelancersSee) ? "task.created" : "task.changed") : null;
  let customers: TaskNoticeKind | null = null;
  if (!change.archived && customersSee(after)) {
    // Handed to the customer just now: „Du bist am Zug“ says it.
    const handed = after.customerState === "customer" && before?.customerState !== "customer";
    if (newFor(customersSee)) customers = handed ? null : "task.created";
    else if (customerSeesChange(change) && !handed) customers = "task.changed";
  }
  return { freelancers, customers };
}

/** Where a task notice leads: the card in the board (team, freelancers) or the project (customers). */
export const taskBoardHref = (projectId: string, taskNumber: number) => `/dashboard/projects/tasks?project=${projectId}&task=${taskNumber}`;

/**
 * The start of every line of a card: "Website · #12". The team reads the customer first ("Bäckerei Sonnenschein ·
 * Website · #12", bell V3 of 22.11.2026), since many customers have a project called „Website“.
 */
export const taskNoticePrefix = (project: string, taskNumber: number, company = "") =>
  [...[company, project].map(oneLine).filter(Boolean), `#${taskNumber}`].join(" · ");

export type TaskNoticeDraft = { kind: TaskNoticeKind; taskTitle: string; prefix: string; parts: string[]; href: string };

const TASK_TITLES: Record<TaskNoticeKind, string> = { "task.created": "Neue Aufgabe", "task.changed": "Aufgabe geändert" };
/** A line keeps at most this many parts; older ones drop out. */
const TASK_PARTS = 6;
const joinParts = (prefix: string, parts: string[]) => clip([prefix, ...parts.slice(0, TASK_PARTS)].join(" · "), 300);

/** A new bell line for a card. */
export function taskNotice(draft: TaskNoticeDraft): Notice {
  return { kind: draft.kind, title: clip(`${TASK_TITLES[draft.kind]}: ${oneLine(draft.taskTitle)}`, 200), body: joinParts(draft.prefix, draft.parts), href: draft.href };
}

/** Which part of a line a part fills; a newer part of the same kind replaces the older one. */
const slotOf = (part: string) => /^(Archiviert|Status|Fällig|Geändert|Kommentar|Checkliste|von )/.exec(part)?.[1] ?? part;

/**
 * Writes a change into the line the person has not read yet: newest parts first, an older part of the same kind
 * drops out, the changed fields add up. A new card stays "Neue Aufgabe" however often it changes before it is read.
 */
export function mergeTaskNotice(previous: { kind: string; body: string }, draft: TaskNoticeDraft): Notice {
  const kind: TaskNoticeKind = previous.kind === "task.created" || draft.kind === "task.created" ? "task.created" : "task.changed";
  const start = `${draft.prefix} · `;
  const older = previous.body.startsWith(start) ? previous.body.slice(start.length).split(" · ") : [];
  const fieldsOf = (part: string | undefined) => part?.startsWith("Geändert: ") ? part.slice("Geändert: ".length).split(", ") : [];
  const newer = draft.parts.map((part) => {
    if (slotOf(part) !== "Geändert") return part;
    const words = [...new Set([...fieldsOf(part), ...fieldsOf(older.find((old) => slotOf(old) === "Geändert"))])].filter((word) => word && !word.endsWith("…"));
    return `Geändert: ${words.join(", ")}`;
  });
  const taken = new Set(newer.map(slotOf));
  return taskNotice({ ...draft, kind, parts: [...newer, ...older.filter((part) => !taken.has(slotOf(part)))] });
}

// Live sync (stage 1 of „Echtzeit“, 18.11.2026) ---------------------------------------------------------------------

/** The newest lines of the bell the live check compares. */
export const LIVE_LINES = 10;

/**
 * What an open tab compares with the server every few seconds (app/api/live, components/hub/use-live-sync.ts): the
 * unread count, the newest lines of the bell (a merged line changes its text and time) and, for admins, the waiting
 * registrations. Both sides build it with this function from the same rows, so it only differs when something
 * changed: then the page reads itself anew.
 */
export function liveVersion(input: { unread: number; items: { id: number; createdAt: string; read: boolean; title: string; body: string }[]; pending: number }) {
  // A short checksum of a line's text (FNV-1a), so a chat line that only changes its words still counts.
  const sum = (text: string) => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
    return (hash >>> 0).toString(36);
  };
  const lines = [...input.items]
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) || b.id - a.id)
    .slice(0, LIVE_LINES)
    .map((item) => `${item.id}.${Date.parse(item.createdAt) || 0}.${item.read ? 1 : 0}.${sum(`${item.title}\n${item.body}`)}`);
  return [input.unread, input.pending, ...lines].join("|");
}

// What the layout loads for the bell (23.11.2026) ---------------------------------------------------------------------

/** The newest lines, read or not: „Früher“ in the overview and the live check read them. */
export const INBOX_LATEST = 30;
/** Unread lines the bell lists at most; above it says how many more there are. */
export const INBOX_UNREAD = 100;

/**
 * The rows behind the bell: the INBOX_LATEST newest ones and every unread one up to INBOX_UNREAD, each once, newest
 * first. The bell shows only the unread ones (plan docs/planung/chat-ereignisse-und-glocke.md 2.1), so an older unread
 * notice must not drop out behind newer read ones while the number on the bell still counts it. The LIVE_LINES
 * newest of these rows are always the newest of all, so the page and app/api/live keep building the same version.
 */
export function mergeInboxRows<T extends { id: number; created_at: string }>(latest: readonly T[], unread: readonly T[]): T[] {
  const rows = new Map<number, T>();
  for (const row of [...latest, ...unread]) if (!rows.has(row.id)) rows.set(row.id, row);
  return [...rows.values()].sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0) || b.id - a.id);
}

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
