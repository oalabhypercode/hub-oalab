// Karten im Chat (stage 2 of docs/planung/chat-ereignisse-und-glocke.md, 24 November 2026): what oalab changes for a
// customer can also stand as a card in the customer's private chat under „Nachrichten“, per area as the chat's
// subscriptions („Abos“) say. A card is only written where the customer gets the same change in the bell. Pure rules
// for the server, the screen and the tests; this file imports nothing.
//
// The hub's chat only: hub messages are free communication with oalab, the service platform bills per request and runs
// an AI. Nothing here reads, writes or counts anything of the service platform (rule of 23 November 2026).

export type ChatViewerSide = "customer" | "oalab";

// ---- Areas and subscriptions ----------------------------------------------------------------------------------------

export type ChatArea = "appointments" | "files" | "notes" | "tasks" | "projects" | "contract";
export const CHAT_AREAS: readonly ChatArea[] = ["appointments", "files", "notes", "tasks", "projects", "contract"];
export const AREA_LABELS: Readonly<Record<ChatArea, string>> = {
  appointments: "Termine", files: "Dateien", notes: "Notizen", tasks: "Aufgaben", projects: "Projekte", contract: "Vertrag & Domain",
};
/** Decision 7 of 23.11.2026: in every chat, old and new, everything is on except Aufgaben, which change often. */
export const DEFAULT_SUBSCRIPTIONS: Readonly<Record<ChatArea, boolean>> = {
  appointments: true, files: true, notes: true, tasks: false, projects: true, contract: true,
};
export const isChatArea = (value: unknown): value is ChatArea => typeof value === "string" && (CHAT_AREAS as readonly string[]).includes(value);
/** The row's subject in hub_chat_subscriptions; later also „project:<id>“ for following one thing. */
export const areaSubject = (area: ChatArea) => `area:${area}`;
export const subjectArea = (subject: string): ChatArea | null => {
  const area = subject.startsWith("area:") ? subject.slice(5) : "";
  return isChatArea(area) ? area : null;
};

/** The switches of a chat: the stored rows over the defaults (no row, the default). */
export function subscriptionsOf(rows: readonly { subject: string; enabled: boolean }[]): Record<ChatArea, boolean> {
  const out = { ...DEFAULT_SUBSCRIPTIONS };
  for (const row of rows) {
    const area = subjectArea(row.subject);
    if (area) out[area] = row.enabled === true;
  }
  return out;
}

/** What a switch in „Im Chat mitteilen“ covers, in the words of the side that reads it. */
export function areaDescription(area: ChatArea, viewer: ChatViewerSide, company: string): string {
  if (area === "appointments") return "Neue, bestätigte, verschobene und abgesagte Termine, Terminanfragen";
  if (area === "files") return viewer === "oalab" ? `Neue Dateien für ${company.trim() || "den Kunden"}` : "Neue Dateien für euch";
  if (area === "notes") return "Freigegebene und geänderte Notizseiten";
  if (area === "tasks") return "Neue Aufgaben, Änderungen und „Du bist am Zug“";
  if (area === "projects") return "Status und Zieltermin";
  return "Verlauf, Domains, E-Mail-Adressen und Pakete";
}

export const subscriptionIntro = (viewer: ChatViewerSide, company: string) =>
  viewer === "oalab"
    ? `Was ihr für ${company.trim() || "diesen Kunden"} ändert, steht zusätzlich als Karte in diesem Chat.`
    : "Was oalab für euch ändert, steht zusätzlich als Karte in diesem Chat.";
export const SUBSCRIPTION_FOOT = "Gilt für alle in diesem Chat. Die Glocke meldet weiterhin alles.";

// ---- Events -----------------------------------------------------------------------------------------------------------

export type AppointmentEventKind =
  | "appointment.created" | "appointment.confirmed" | "appointment.changed" | "appointment.cancelled" | "appointment.declined"
  | "appointment.requested" | "appointment.withdrawn";
export type TaskEventKind = "task.customer" | "task.created" | "task.changed";
export type ChatEventKind =
  | AppointmentEventKind | "file.shared" | "note.shared" | "note.changed" | TaskEventKind | "project.changed" | "contract.changed" | "subscription";

/** What a card keeps of an appointment: enough for its lines and to compare with today's state. */
export type AppointmentFacts = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  teams: boolean;
  /** The start before a move („Termin verschoben“). */
  before?: string | null;
  /** The reason for a cancellation or a declined request, as the customer reads it in the bell. */
  note?: string;
};
export type FileFact = { id: string; name: string };
export type NoteFact = { customerId: string; pageId: string; title: string; edit?: "with" | "only" };
export type TaskFact = { projectId: string; number: number; title: string; project: string; parts: string[] };
export type ProjectFact = { id: string; name: string; change: string };
export type ContractItem = { what: "timeline" | "domain" | "mailbox" | "package"; label: string; change: "new" | "changed" };

export type ChatEvent =
  | { v: 1; kind: AppointmentEventKind; appointment: AppointmentFacts }
  | { v: 1; kind: "file.shared"; files: FileFact[]; total: number }
  | { v: 1; kind: "note.shared" | "note.changed"; note: NoteFact }
  | { v: 1; kind: TaskEventKind; task: TaskFact }
  | { v: 1; kind: "project.changed"; project: ProjectFact }
  | { v: 1; kind: "contract.changed"; items: ContractItem[] }
  | { v: 1; kind: "subscription"; area: ChatArea; on: boolean };

const APPOINTMENT_KINDS: readonly string[] = [
  "appointment.created", "appointment.confirmed", "appointment.changed", "appointment.cancelled", "appointment.declined", "appointment.requested", "appointment.withdrawn",
];
const TASK_KINDS: readonly string[] = ["task.customer", "task.created", "task.changed"];

/** Grey lines in the chat (subscriptions, a withdrawn request): they never count as news. */
export const SYSTEM_EVENT_KINDS: readonly ChatEventKind[] = ["subscription", "appointment.withdrawn"];
export const isSystemEvent = (event: Pick<ChatEvent, "kind">) => (SYSTEM_EVENT_KINDS as readonly string[]).includes(event.kind);

/** The area a card belongs to and its switch; subscription lines belong to none and always show. */
export function areaOf(kind: ChatEventKind): ChatArea | null {
  if (kind === "subscription") return null;
  if (kind.startsWith("appointment.")) return "appointments";
  if (kind === "file.shared") return "files";
  if (kind === "note.shared" || kind === "note.changed") return "notes";
  if (kind.startsWith("task.")) return "tasks";
  if (kind === "project.changed") return "projects";
  return "contract";
}

const MAX_TEXT = 300;
const MAX_FILES = 20;
const MAX_PARTS = 6;
const MAX_ITEMS = 10;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const oneLine = (value: unknown, max = MAX_TEXT) => {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};
const isTime = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/**
 * The card as stored in hub_private_messages.event, read defensively: anything unknown or broken is no card (the chat
 * then shows the row's one line of text, as for a message).
 */
export function readChatEvent(value: unknown): ChatEvent | null {
  const raw = record(value);
  if (!raw || typeof raw.kind !== "string") return null;
  const kind = raw.kind;
  if (APPOINTMENT_KINDS.includes(kind)) {
    const a = record(raw.appointment);
    if (!a || typeof a.id !== "string" || !uuid.test(a.id) || !isTime(a.startsAt) || !isTime(a.endsAt)) return null;
    return {
      v: 1, kind: kind as AppointmentEventKind,
      appointment: {
        id: a.id, title: oneLine(a.title, 200) || "Termin", startsAt: a.startsAt, endsAt: a.endsAt, teams: a.teams === true,
        ...(isTime(a.before) ? { before: a.before } : {}), ...(oneLine(a.note) ? { note: oneLine(a.note) } : {}),
      },
    };
  }
  if (kind === "file.shared") {
    const files = Array.isArray(raw.files) ? raw.files.flatMap((file) => {
      const f = record(file);
      return f && typeof f.id === "string" && uuid.test(f.id) ? [{ id: f.id, name: oneLine(f.name, 200) || "Datei" }] : [];
    }).slice(0, MAX_FILES) : [];
    if (!files.length) return null;
    const total = Number.isInteger(raw.total) && Number(raw.total) >= files.length ? Number(raw.total) : files.length;
    return { v: 1, kind, files, total };
  }
  if (kind === "note.shared" || kind === "note.changed") {
    const n = record(raw.note);
    if (!n || typeof n.customerId !== "string" || !uuid.test(n.customerId) || typeof n.pageId !== "string" || !uuid.test(n.pageId)) return null;
    const edit = n.edit === "with" || n.edit === "only" ? n.edit : undefined;
    return { v: 1, kind, note: { customerId: n.customerId, pageId: n.pageId, title: oneLine(n.title, 200) || "Ohne Titel", ...(edit ? { edit } : {}) } };
  }
  if (TASK_KINDS.includes(kind)) {
    const t = record(raw.task);
    if (!t || typeof t.projectId !== "string" || !uuid.test(t.projectId) || !Number.isInteger(t.number)) return null;
    const parts = Array.isArray(t.parts) ? t.parts.map((part) => oneLine(part, 160)).filter(Boolean).slice(0, MAX_PARTS) : [];
    return { v: 1, kind: kind as TaskEventKind, task: { projectId: t.projectId, number: Number(t.number), title: oneLine(t.title, 200) || "Aufgabe", project: oneLine(t.project, 200), parts } };
  }
  if (kind === "project.changed") {
    const p = record(raw.project);
    if (!p || typeof p.id !== "string" || !uuid.test(p.id)) return null;
    return { v: 1, kind, project: { id: p.id, name: oneLine(p.name, 200) || "Projekt", change: oneLine(p.change) } };
  }
  if (kind === "contract.changed") {
    const items = Array.isArray(raw.items) ? raw.items.flatMap((item) => {
      const i = record(item);
      if (!i || !["timeline", "domain", "mailbox", "package"].includes(String(i.what))) return [];
      const label = oneLine(i.label, 200);
      return label ? [{ what: i.what as ContractItem["what"], label, change: i.change === "changed" ? "changed" as const : "new" as const }] : [];
    }).slice(0, MAX_ITEMS) : [];
    return items.length ? { v: 1, kind, items } : null;
  }
  if (kind === "subscription") {
    return isChatArea(raw.area) && typeof raw.on === "boolean" ? { v: 1, kind, area: raw.area, on: raw.on } : null;
  }
  return null;
}

// ---- Words and times --------------------------------------------------------------------------------------------------

const ZONE = "Europe/Berlin";
const dayShort = new Intl.DateTimeFormat("de-DE", { timeZone: ZONE, weekday: "short", day: "numeric", month: "short" });
const clock = new Intl.DateTimeFormat("de-DE", { timeZone: ZONE, hour: "2-digit", minute: "2-digit" });

/** „Di., 24. Nov., 10:00“: a start in one go, in German time. */
export const shortWhen = (iso: string) => `${dayShort.format(new Date(iso))}, ${clock.format(new Date(iso))}`;
/** „Di., 24. Nov. · 10:00–10:30“ (and „· Teams“ with a meeting link). */
export const appointmentWhen = (facts: Pick<AppointmentFacts, "startsAt" | "endsAt" | "teams">) =>
  `${dayShort.format(new Date(facts.startsAt))} · ${clock.format(new Date(facts.startsAt))}–${clock.format(new Date(facts.endsAt))}${facts.teams ? " · Teams" : ""}`;

const CONTRACT_WORDS: Readonly<Record<ContractItem["what"], { new: string; changed: string }>> = {
  timeline: { new: "Neu im Verlauf", changed: "Verlauf geändert" },
  domain: { new: "Domain eingetragen", changed: "Domain geändert" },
  mailbox: { new: "E-Mail-Adresse angelegt", changed: "E-Mail-Adresse geändert" },
  package: { new: "Paket gebucht", changed: "Paket geändert" },
};
export const contractItemLine = (item: ContractItem) => `${CONTRACT_WORDS[item.what][item.change]}: ${item.label}`;

/** „logo.svg“, „logo.svg und farben.pdf“, „logo.svg, farben.pdf und 3 weitere“. */
export function fileNames(files: readonly FileFact[], total: number): string {
  const shown = files.slice(0, 2).map((file) => file.name);
  const rest = Math.max(0, total - shown.length);
  if (rest) return `${shown.join(", ")} und ${rest} weitere`;
  return shown.length > 1 ? shown.join(" und ") : shown[0] ?? "";
}

const taskPlace = (task: TaskFact) => [task.project, `#${task.number} ${task.title}`].filter(Boolean).join(" › ");
const quoted = (title: string) => `„${title}“`;

/** The heading and what it is about, as the reading side reads it („Du bist am Zug“ or „Nordlicht Studio ist am Zug“). */
export function eventHeading(event: ChatEvent, viewer: ChatViewerSide, company: string): { heading: string; subject: string } {
  switch (event.kind) {
    case "appointment.created": return { heading: "Neuer Termin", subject: event.appointment.title };
    case "appointment.confirmed": return { heading: "Termin bestätigt", subject: event.appointment.title };
    case "appointment.changed": return { heading: "Termin verschoben", subject: event.appointment.title };
    case "appointment.cancelled": return { heading: "Termin abgesagt", subject: event.appointment.title };
    case "appointment.declined": return { heading: "Terminanfrage abgelehnt", subject: event.appointment.title };
    case "appointment.requested": return { heading: "Terminanfrage", subject: event.appointment.title };
    case "appointment.withdrawn": return { heading: "Terminanfrage zurückgezogen", subject: event.appointment.title };
    case "file.shared": return { heading: event.total > 1 ? `${event.total} neue Dateien` : "Neue Datei", subject: fileNames(event.files, event.total) };
    case "note.shared": return { heading: event.note.edit === "with" ? "Neue Notiz zum Mitschreiben" : event.note.edit === "only" ? "Notiz zum Mitschreiben" : "Neue Notiz", subject: event.note.title };
    case "note.changed": return { heading: "Notiz geändert", subject: event.note.title };
    case "task.customer": return { heading: viewer === "oalab" ? `${company.trim() || "Der Kunde"} ist am Zug` : "Du bist am Zug", subject: taskPlace(event.task) };
    case "task.created": return { heading: "Neue Aufgabe", subject: taskPlace(event.task) };
    case "task.changed": return { heading: "Aufgabe geändert", subject: taskPlace(event.task) };
    case "project.changed": return { heading: "Projekt aktualisiert", subject: event.project.name };
    case "contract.changed": return {
      heading: event.items.every((item) => item.change === "new") ? "Neu unter Vertrag & Domain" : "Vertrag & Domain geändert",
      subject: event.items.length === 1 ? contractItemLine(event.items[0]) : `${event.items.length} Einträge`,
    };
    case "subscription": return { heading: `${AREA_LABELS[event.area]} ${event.on ? "abonniert" : "abbestellt"}`, subject: "" };
  }
}

/**
 * The card in one line of text: the row's body, so the list of chats, the bell's older readers and Claude read it
 * without knowing cards. Neutral words, no „Du“: everybody reads the same row.
 */
export function eventLine(event: ChatEvent): string {
  switch (event.kind) {
    case "appointment.created": case "appointment.confirmed": case "appointment.changed": case "appointment.requested":
      return oneLine(`${eventHeading(event, "oalab", "").heading}: ${event.appointment.title}, ${shortWhen(event.appointment.startsAt)}`, 500);
    case "appointment.cancelled": case "appointment.declined": case "appointment.withdrawn":
      return oneLine(`${eventHeading(event, "oalab", "").heading}: ${event.appointment.title}, ${shortWhen(event.appointment.startsAt)}`, 500);
    case "file.shared": return oneLine(`${event.total > 1 ? `${event.total} neue Dateien` : "Neue Datei"}: ${fileNames(event.files, event.total)}`, 500);
    case "note.shared": case "note.changed": return oneLine(`${eventHeading(event, "oalab", "").heading}: ${event.note.title}`, 500);
    case "task.customer": return oneLine(`Am Zug: ${taskPlace(event.task)}`, 500);
    case "task.created": case "task.changed": return oneLine(`${eventHeading(event, "oalab", "").heading}: ${taskPlace(event.task)}${event.task.parts.length ? ` · ${event.task.parts.join(" · ")}` : ""}`, 500);
    case "project.changed": return oneLine(`Projekt aktualisiert: ${event.project.name}${event.project.change ? ` · ${event.project.change}` : ""}`, 500);
    case "contract.changed": return oneLine(`Vertrag & Domain: ${event.items.map(contractItemLine).join(" · ")}`, 500);
    case "subscription": return `${AREA_LABELS[event.area]} ${event.on ? "abonniert" : "abbestellt"}`;
  }
}

/** The list of chats shows a card as one line, as the reading side reads its heading: „Neuer Termin: Abstimmung Texte“. */
export function eventListLine(event: ChatEvent, viewer: ChatViewerSide, company: string): string {
  const { heading, subject } = eventHeading(event, viewer, company);
  return subject ? `${heading}: ${subject}` : heading;
}

/**
 * A grey line in the chat: „Du hast Aufgaben abonniert“, „Jana Sommer hat Termine abbestellt“, „Tim Berger hat die
 * Terminanfrage „Abstimmung Texte“ zurückgezogen“. `who` is the writer as the chat names them (chatSender).
 */
export function systemLine(event: ChatEvent, input: { own: boolean; who: string }): string {
  const subject = input.own ? "Du hast" : `${input.who.trim() || "Jemand"} hat`;
  if (event.kind === "subscription") return `${subject} ${AREA_LABELS[event.area]} ${event.on ? "abonniert" : "abbestellt"}`;
  if (event.kind === "appointment.withdrawn") return `${subject} die Terminanfrage ${quoted(event.appointment.title)} zurückgezogen`;
  return eventLine(event);
}

// ---- Links ------------------------------------------------------------------------------------------------------------
// The same addresses as the bell's notices (lib/hub-notify/rules.ts; the tests compare them).

export const cardAppointmentHref = (appointmentId: string) => `/dashboard/projects/calendar?appointment=${appointmentId}`;
export const cardFileHref = (files: readonly FileFact[], total: number) => total === 1 && files.length === 1 ? `/dashboard/files?file=${encodeURIComponent(files[0].id)}` : "/dashboard/files";
export const cardNoteHref = (note: NoteFact) => `/dashboard/projects/notes?customer=${encodeURIComponent(note.customerId)}&page=${encodeURIComponent(note.pageId)}`;
export const cardProjectHref = (projectId: string) => `/dashboard/projects?project=${projectId}`;
export const cardTaskHref = (task: TaskFact) => `/dashboard/projects/tasks?project=${task.projectId}&task=${task.number}`;
export const cardContractHref = (viewer: ChatViewerSide, customerId: string) => viewer === "oalab" ? `/dashboard/contracts?customer=${encodeURIComponent(customerId)}` : "/dashboard/contracts";

// ---- The card on the screen -------------------------------------------------------------------------------------------

/** Today's state of an appointment a card names; null when it no longer exists, undefined when it was not read. */
export type AppointmentNow = { status: string; startsAt: string; endsAt: string } | null | undefined;
export type CardBadge = { label: string; tone: "ok" | "info" | "todo" | "off" };
export type CardAction =
  | { kind: "open"; label: string; href: string }
  | { kind: "calendar"; label: string; appointmentId: string }
  | { kind: "confirm"; label: string; appointmentId: string };
export type ChatCardView = {
  area: ChatArea;
  heading: string;
  subject: string;
  lines: string[];
  /** The time before a move („vorher“, struck through). */
  was: string | null;
  badge: CardBadge | null;
  actions: CardAction[];
};

/**
 * The state an older appointment card wears (plan 3.4): a request stays „offen“ until the team answers it; a card of an
 * appointment that was moved, confirmed or cancelled since says so. The newest card of a change wears none.
 */
export function appointmentBadge(event: ChatEvent, now: AppointmentNow, at: number): CardBadge | null {
  if (!("appointment" in event) || now === undefined) return null;
  if (event.kind === "appointment.cancelled" || event.kind === "appointment.declined" || event.kind === "appointment.withdrawn") return null;
  if (now === null) return { label: "entfernt", tone: "off" };
  if (event.kind === "appointment.requested") {
    if (now.status === "requested") return Date.parse(now.startsAt) > at ? { label: "offen", tone: "todo" } : { label: "abgelaufen", tone: "off" };
    if (now.status === "confirmed") return { label: "bestätigt", tone: "ok" };
    if (now.status === "declined") return { label: "abgelehnt", tone: "off" };
    return { label: "zurückgezogen", tone: "off" };
  }
  if (now.status === "cancelled") return { label: "abgesagt", tone: "off" };
  if (now.status === "declined") return { label: "abgelehnt", tone: "off" };
  if (Date.parse(now.startsAt) !== Date.parse(event.appointment.startsAt)) return { label: "verschoben", tone: "info" };
  return null;
}

/**
 * A card as the reading side sees it: symbol and colour come from its area, the heading names the change, two or three
 * lines say what matters, the buttons lead on. Admins confirm a request here as it was asked („Bestätigen“); another
 * time or a decline goes through the calendar.
 */
export function cardView(event: ChatEvent, ctx: { viewer: ChatViewerSide; company: string; customerId: string; appointment?: AppointmentNow; at: number }): ChatCardView | null {
  const area = areaOf(event.kind);
  if (!area || isSystemEvent(event)) return null;
  const { heading, subject } = eventHeading(event, ctx.viewer, ctx.company);
  const base = { area, heading, subject, lines: [] as string[], was: null as string | null, badge: null as CardBadge | null, actions: [] as CardAction[] };
  if ("appointment" in event) {
    const facts = event.appointment;
    const badge = appointmentBadge(event, ctx.appointment, ctx.at);
    const lines = [appointmentWhen(facts)];
    if (facts.note && (event.kind === "appointment.cancelled" || event.kind === "appointment.declined")) lines.push(facts.note);
    const open = { kind: "open" as const, label: "Im Kalender öffnen", href: cardAppointmentHref(facts.id) };
    const live = ctx.appointment;
    const upcoming = Boolean(live && Date.parse(live.endsAt) > ctx.at);
    const actions: CardAction[] = [];
    if (event.kind === "appointment.requested") {
      if (ctx.viewer === "oalab" && live?.status === "requested" && upcoming) {
        actions.push({ kind: "confirm", label: "Bestätigen", appointmentId: facts.id }, { kind: "open", label: "Im Kalender beantworten", href: cardAppointmentHref(facts.id) });
      } else actions.push(open);
    } else if (event.kind !== "appointment.cancelled" && event.kind !== "appointment.declined") {
      actions.push(open);
      // Into the own calendar app only while the appointment stands as the card says.
      if (ctx.viewer === "customer" && live?.status === "confirmed" && upcoming && !badge) actions.push({ kind: "calendar", label: "In meinen Kalender", appointmentId: facts.id });
    }
    return { ...base, lines, was: event.kind === "appointment.changed" && facts.before ? shortWhen(facts.before) : null, badge, actions };
  }
  switch (event.kind) {
    case "file.shared":
      return { ...base, lines: event.total > 2 ? [event.files.slice(0, 3).map((file) => file.name).join(", ")] : [], subject: event.total > 2 ? "" : subject,
        actions: [{ kind: "open", label: "Öffnen", href: cardFileHref(event.files, event.total) }] };
    case "note.shared": case "note.changed":
      return { ...base, lines: ["Unter Projekte › Notizen"], actions: [{ kind: "open", label: "Öffnen", href: cardNoteHref(event.note) }] };
    case "task.customer":
      return { ...base, lines: [ctx.viewer === "oalab" ? "Die Aufgabe liegt jetzt beim Kunden" : "Die Aufgabe liegt jetzt bei dir", ...event.task.parts].slice(0, 3),
        actions: [{ kind: "open", label: "Öffnen", href: ctx.viewer === "oalab" ? cardTaskHref(event.task) : cardProjectHref(event.task.projectId) }] };
    case "task.created": case "task.changed":
      return { ...base, lines: event.task.parts.length ? [event.task.parts.slice(0, 3).join(" · ")] : [],
        actions: [{ kind: "open", label: "Öffnen", href: ctx.viewer === "oalab" ? cardTaskHref(event.task) : cardProjectHref(event.task.projectId) }] };
    case "project.changed":
      return { ...base, lines: event.project.change ? [event.project.change] : [], actions: [{ kind: "open", label: "Öffnen", href: cardProjectHref(event.project.id) }] };
    case "contract.changed": {
      const shown = event.items.slice(0, 3).map(contractItemLine);
      const rest = event.items.length - shown.length;
      return { ...base, subject: event.items.length === 1 ? "" : subject, lines: rest > 0 ? [...shown, `und ${rest} weitere`] : shown,
        actions: [{ kind: "open", label: "Öffnen", href: cardContractHref(ctx.viewer, ctx.customerId) }] };
    }
    default:
      return null;
  }
}

// ---- Writing: keys and one card for many changes ----------------------------------------------------------------------

/**
 * Cards that grow instead of piling up (plan 3.4): files with files, changes of one task with each other and
 * Vertrag & Domain with itself, while the card is the newest in the chat and the other side has not looked since.
 */
export function mergeGroup(event: ChatEvent): string | null {
  if (event.kind === "file.shared") return "files";
  if (event.kind === "task.created" || event.kind === "task.changed") return `task:${event.task.projectId}:${event.task.number}`;
  if (event.kind === "contract.changed") return "contract";
  return null;
}

const slotOf = (part: string) => /^([^:]{1,40}):/.exec(part)?.[1] ?? part;

/** The card the newest one becomes with the next change of its group; null when they do not belong together. */
export function mergeEvents(previous: ChatEvent, next: ChatEvent): ChatEvent | null {
  const group = mergeGroup(next);
  if (!group || mergeGroup(previous) !== group) return null;
  if (previous.kind === "file.shared" && next.kind === "file.shared") {
    const known = new Set(previous.files.map((file) => file.id));
    const added = next.files.filter((file) => !known.has(file.id));
    return { v: 1, kind: "file.shared", files: [...added, ...previous.files].slice(0, MAX_FILES), total: previous.total + added.length };
  }
  if ((previous.kind === "task.created" || previous.kind === "task.changed") && (next.kind === "task.created" || next.kind === "task.changed")) {
    const slots = new Set(next.task.parts.map(slotOf));
    const parts = [...next.task.parts, ...previous.task.parts.filter((part) => !slots.has(slotOf(part)))].slice(0, MAX_PARTS);
    return { v: 1, kind: previous.kind === "task.created" ? "task.created" : "task.changed", task: { ...next.task, parts } };
  }
  if (previous.kind === "contract.changed" && next.kind === "contract.changed") {
    const key = (item: ContractItem) => `${item.what}:${item.label}`;
    const fresh = new Set(next.items.map(key));
    // A change to something the card already names as new stays „new“.
    const items = next.items.map((item) => previous.items.some((old) => key(old) === key(item) && old.change === "new") ? { ...item, change: "new" as const } : item);
    return { v: 1, kind: "contract.changed", items: [...items, ...previous.items.filter((item) => !fresh.has(key(item)))].slice(0, MAX_ITEMS) };
  }
  return null;
}

/**
 * A card's key, unique per chat (hub_private_messages.event_key): changes from the regular run name their subject and
 * the time of the change, so a repeated run writes nothing twice; everything else adds a fresh token.
 */
export const eventKey = (kind: ChatEventKind, subject: string, token: string) => oneLine(`${kind}:${subject}:${token}`, 200);
