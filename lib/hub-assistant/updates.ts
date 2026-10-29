/**
 * Change proposals of the hub assistant (KI-Plan Schritt 5): it may propose changes to a project or to existing tasks,
 * the admin reviews "old → new" in the chat and saves. Every change carries the Studio version it was read at, so a
 * change made in Studio meanwhile is never overwritten. Self-contained apart from type imports, so tests check it.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { ProjectTask, StudioProjectStatus } from "../hub-data";
import type { AssistantData } from "./tools";

export const MAX_TASK_CHANGES = 20;
const MAX_NOTE = 1000;
const MAX_TITLE = 240;
const MAX_DESCRIPTION = 20_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = /^\d{4}-\d{2}-\d{2}$/;

export const projectStatusLabels: Record<StudioProjectStatus, string> = { planning: "Planung", active: "Aktiv", risk: "Risiko", hold: "Pausiert", complete: "Abgeschlossen" };
export const taskStatusLabels: Record<ProjectTask["status"], string> = { backlog: "Backlog", todo: "Offen", progress: "In Arbeit", review: "In Prüfung", done: "Erledigt" };

type ProjectFields = { dueOn: string | null; startOn: string | null; status: StudioProjectStatus; description: string };
/** One field of a project change, in a fixed order; `note` is shown, `description` is what gets written. */
export type ProjectFieldChange =
  | { field: "dueOn" | "startOn"; before: string | null; after: string | null }
  | { field: "status"; before: StudioProjectStatus; after: StudioProjectStatus }
  | { field: "description"; before: string; after: string; note: string };

export type ProjectUpdateProposal = {
  projectId: string;
  organizationId: string;
  projectName: string;
  customer: string | null;
  /** Studio details version read for the proposal; null while Studio has no details row (it is created then). */
  expectedVersion: number | null;
  before: ProjectFields;
  changes: ProjectFieldChange[];
};

type TaskFields = { title: string; status: ProjectTask["status"]; dueOn: string | null; customer: boolean; visible: boolean };
export type TaskChange = { taskId: string; number: number; expectedVersion: number; before: TaskFields; after: Partial<TaskFields> };
export type TaskUpdateProposal = { projectId: string; organizationId: string; projectName: string; customer: string | null; tasks: TaskChange[] };

const keepOr = <T extends string>(values: readonly T[]) => ({ type: "string", enum: ["keep", ...values] });
const dateOrNull = { anyOf: [{ type: "string", format: "date" }, { type: "null" }] };

export const PROPOSE_PROJECT_UPDATE_TOOL: Anthropic.Beta.BetaTool = {
  name: "propose_project_update",
  description: "Schlägt eine Änderung an einem Projekt vor: Zieltermin, Start, Status oder eine Notiz, die an die Beschreibung angehängt wird. Dabei wird nichts gespeichert: Der Nutzer sieht alt → neu und speichert selbst. Nur ändern, was der Nutzer verlangt; alles andere auf keep.",
  input_schema: {
    type: "object",
    properties: {
      project_id: { type: "string", description: "ID aus search, get_customer oder dem geöffneten Projekt." },
      due_action: { type: "string", enum: ["keep", "set", "clear"], description: "Zieltermin: keep, set (auf due) oder clear (entfernen)." },
      due: { ...dateOrNull, description: "Neuer Zieltermin YYYY-MM-DD bei set, sonst null." },
      start_action: { type: "string", enum: ["keep", "set", "clear"], description: "Startdatum: keep, set (auf start) oder clear." },
      start: { ...dateOrNull, description: "Neues Startdatum YYYY-MM-DD bei set, sonst null." },
      status: { ...keepOr(["planning", "active", "risk", "hold", "complete"]), description: "Studio-Status: planning=Planung, active=Aktiv, risk=Risiko, hold=Pausiert, complete=Abgeschlossen; keep lässt ihn." },
      note: { type: "string", description: "Kurze Notiz, die mit Datum an die Projektbeschreibung angehängt wird, z. B. „Wir warten auf Kundenfeedback zur Startseite.“ Leer für keine." },
    },
    required: ["project_id", "due_action", "due", "start_action", "start", "status", "note"],
    additionalProperties: false,
  },
  strict: true,
  eager_input_streaming: true,
};

export const PROPOSE_TASK_UPDATES_TOOL: Anthropic.Beta.BetaTool = {
  name: "propose_task_updates",
  description: "Schlägt Änderungen an bestehenden Aufgaben eines Projekts vor: Titel, Stand, Fälligkeit, ob OALAB oder der Kunde dran ist, Freigabe für den Kunden. Dabei wird nichts gespeichert: Der Nutzer sieht alt → neu je Aufgabe und speichert selbst. Aufgaben über ihre Nummer aus get_project oder list_tasks angeben; nur ändern, was der Nutzer verlangt, alles andere auf keep.",
  input_schema: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        description: "Höchstens 20 Aufgaben, alle aus demselben Projekt.",
        items: {
          type: "object",
          properties: {
            task_number: { type: "integer", description: "Nummer der Aufgabe, z. B. 12 für #12." },
            title: { type: "string", description: "Neuer Titel, leer lässt ihn." },
            status: { ...keepOr(["backlog", "todo", "progress", "review", "done"]), description: "todo=Offen, progress=In Arbeit, review=In Prüfung, done=Erledigt; keep lässt ihn." },
            due_action: { type: "string", enum: ["keep", "set", "clear"], description: "Fälligkeit: keep, set (auf due) oder clear." },
            due: { ...dateOrNull, description: "Neue Fälligkeit YYYY-MM-DD bei set, sonst null." },
            owner: { ...keepOr(["oalab", "customer"]), description: "Wer dran ist (Label „Kunde“); keep lässt es." },
            visibility: { ...keepOr(["internal", "customer"]), description: "internal oder für den Kunden sichtbar; keep lässt es." },
          },
          required: ["task_number", "title", "status", "due_action", "due", "owner", "visibility"],
          additionalProperties: false,
        },
      },
    },
    required: ["tasks"],
    additionalProperties: false,
  },
  strict: true,
  eager_input_streaming: true,
};

type Outcome<T> = { ok: true; proposal: T } | { ok: false; error: string };
const object = (input: unknown) => input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null;
const isDay = (value: unknown): value is string => typeof value === "string" && day.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const noteDate = (now: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" }).format(now);

/** keep / set / clear on a date field; undefined means unchanged. */
function dateAction(action: unknown, value: unknown, label: string): { ok: true; value: string | null | undefined } | { ok: false; error: string } {
  if (action === "keep") return { ok: true, value: undefined };
  if (action === "clear") return { ok: true, value: null };
  if (action === "set") return isDay(value) ? { ok: true, value } : { ok: false, error: `${label}: Bei set braucht es ein Datum JJJJ-MM-TT.` };
  return { ok: false, error: `${label}: keep, set oder clear angeben.` };
}

/** Checks a propose_project_update call and keeps only fields that really change. */
export function prepareProjectUpdate(input: unknown, data: AssistantData, now = new Date()): Outcome<ProjectUpdateProposal> {
  const args = object(input);
  if (!args) return { ok: false, error: "Ungültige Eingabe." };
  const project = typeof args.project_id === "string" && uuid.test(args.project_id) ? data.projects.find((item) => item.id === args.project_id) : undefined;
  if (!project || !project.organizationId || !project.studio) return { ok: false, error: "Dieses Projekt gibt es nicht oder es ist nicht sichtbar. Nutze zuerst search." };
  const due = dateAction(args.due_action, args.due, "Zieltermin");
  if (!due.ok) return due;
  const start = dateAction(args.start_action, args.start, "Startdatum");
  if (!start.ok) return start;
  const statuses: StudioProjectStatus[] = ["planning", "active", "risk", "hold", "complete"];
  const status = args.status === "keep" ? undefined : statuses.find((item) => item === args.status);
  if (args.status !== "keep" && !status) return { ok: false, error: "status: keep oder einen Studio-Status angeben." };
  const note = typeof args.note === "string" ? args.note.replace(/\s+/g, " ").trim() : "";
  if (note.length > MAX_NOTE) return { ok: false, error: `Die Notiz ist länger als ${MAX_NOTE} Zeichen.` };

  const before: ProjectFields = { dueOn: project.dueOn, startOn: project.startedOn, status: project.studio.status, description: project.description };
  const after = { dueOn: due.value === undefined ? before.dueOn : due.value, startOn: start.value === undefined ? before.startOn : start.value };
  if (after.startOn && after.dueOn && after.startOn > after.dueOn) return { ok: false, error: "Der Start liegt dann nach dem Zieltermin. Bitte beides prüfen." };
  const changes: ProjectFieldChange[] = [];
  if (after.dueOn !== before.dueOn) changes.push({ field: "dueOn", before: before.dueOn, after: after.dueOn });
  if (after.startOn !== before.startOn) changes.push({ field: "startOn", before: before.startOn, after: after.startOn });
  if (status && status !== before.status) changes.push({ field: "status", before: before.status, after: status });
  if (note) {
    const description = [before.description.trim(), `${noteDate(now)}: ${note}`].filter(Boolean).join("\n\n");
    if (description.length > MAX_DESCRIPTION) return { ok: false, error: "Die Projektbeschreibung würde zu lang. Bitte im Studio kürzen." };
    changes.push({ field: "description", before: before.description, after: description, note });
  }
  if (!changes.length) return { ok: false, error: "Das ändert nichts: Alle Werte stehen schon so im Projekt." };
  return {
    ok: true,
    proposal: { projectId: project.id, organizationId: project.organizationId, projectName: project.name, customer: project.company ?? null, expectedVersion: project.studio.version, before, changes },
  };
}

/** Checks a propose_task_updates call. All tasks must belong to one project the admin sees; unchanged tasks are refused. */
export function prepareTaskUpdates(input: unknown, data: AssistantData): Outcome<TaskUpdateProposal> {
  const args = object(input);
  if (!args || !Array.isArray(args.tasks) || !args.tasks.length) return { ok: false, error: "Bitte mindestens eine Aufgabe angeben." };
  if (args.tasks.length > MAX_TASK_CHANGES) return { ok: false, error: `Höchstens ${MAX_TASK_CHANGES} Aufgaben auf einmal.` };
  const index = new Map(data.projects.flatMap((project) => (project.tasks ?? []).map((task) => [task.number, { task, project }] as const)));
  const statuses: ProjectTask["status"][] = ["backlog", "todo", "progress", "review", "done"];
  const changes: TaskChange[] = [];
  let projectId: string | null = null;
  for (const raw of args.tasks) {
    const item = object(raw) ?? {};
    const found = typeof item.task_number === "number" ? index.get(item.task_number) : undefined;
    if (!found) return { ok: false, error: `Die Aufgabe #${String(item.task_number)} gibt es nicht oder sie ist nicht sichtbar. Nutze get_project oder list_tasks.` };
    const { task, project } = found;
    if (!project.organizationId || task.version === undefined) return { ok: false, error: `Die Aufgabe #${task.number} lässt sich hier nicht ändern.` };
    if (projectId && projectId !== project.id) return { ok: false, error: "Alle Aufgaben eines Vorschlags müssen zum selben Projekt gehören. Bitte je Projekt einen Vorschlag." };
    projectId = project.id;
    if (changes.some((change) => change.taskId === task.id)) return { ok: false, error: `Die Aufgabe #${task.number} steht doppelt im Vorschlag.` };

    const before: TaskFields = { title: task.title, status: task.status, dueOn: task.dueOn, customer: task.customer, visible: task.visible };
    const after: Partial<TaskFields> = {};
    const title = typeof item.title === "string" ? item.title.replace(/\s+/g, " ").trim() : "";
    if (title.length > MAX_TITLE) return { ok: false, error: `#${task.number}: Der Titel ist länger als ${MAX_TITLE} Zeichen.` };
    if (title && title !== before.title) after.title = title;
    const status = item.status === "keep" ? undefined : statuses.find((value) => value === item.status);
    if (item.status !== "keep" && !status) return { ok: false, error: `#${task.number}: status keep oder einen Stand angeben.` };
    if (status && status !== before.status) after.status = status;
    const due = dateAction(item.due_action, item.due, `#${task.number} Fälligkeit`);
    if (!due.ok) return due;
    if (due.value !== undefined && due.value !== before.dueOn) after.dueOn = due.value;
    if (item.owner !== "keep" && item.owner !== "oalab" && item.owner !== "customer") return { ok: false, error: `#${task.number}: owner keep, oalab oder customer angeben.` };
    if (item.owner !== "keep" && (item.owner === "customer") !== before.customer) after.customer = item.owner === "customer";
    if (item.visibility !== "keep" && item.visibility !== "internal" && item.visibility !== "customer") return { ok: false, error: `#${task.number}: visibility keep, internal oder customer angeben.` };
    if (item.visibility !== "keep" && (item.visibility === "customer") !== before.visible) after.visible = item.visibility === "customer";
    if (!Object.keys(after).length) return { ok: false, error: `#${task.number}: Das ändert nichts, alle Werte stehen schon so.` };
    changes.push({ taskId: task.id, number: task.number, expectedVersion: task.version, before, after });
  }
  const project = data.projects.find((item) => item.id === projectId)!;
  return { ok: true, proposal: { projectId: project.id, organizationId: project.organizationId!, projectName: project.name, customer: project.company ?? null, tasks: changes } };
}

/** The changes to write: only the ones the admin left ticked in the preview. */
export function pickChanges<T>(items: readonly T[], picks: unknown): { ok: true; items: T[] } | { ok: false; error: string } {
  if (!Array.isArray(picks) || picks.length !== items.length || picks.some((pick) => typeof pick !== "boolean")) return { ok: false, error: "Die Auswahl passt nicht zum Vorschlag. Bitte den Chat neu laden." };
  const chosen = items.filter((_, index) => picks[index]);
  return chosen.length ? { ok: true, items: chosen } : { ok: false, error: "Keine Änderung ausgewählt. Zum Verwerfen „Verwerfen“ nutzen." };
}

/** The Studio columns for the chosen project changes (details table). */
export function projectColumns(changes: readonly ProjectFieldChange[]) {
  const columns: Record<string, string | null> = {};
  for (const change of changes) {
    if (change.field === "dueOn") columns.due_date = change.after;
    if (change.field === "startOn") columns.start_date = change.after;
    if (change.field === "status") columns.status = change.after;
    if (change.field === "description") columns.description = change.after;
  }
  return columns;
}

/** The Studio columns for one chosen task change; labels are recomputed from the row's current labels. */
export function taskColumns(change: TaskChange, currentLabels: readonly string[], customerLabel: string) {
  const columns: Record<string, unknown> = {};
  if (change.after.title !== undefined) columns.title = change.after.title;
  if (change.after.status !== undefined) columns.status = change.after.status;
  if (change.after.dueOn !== undefined) columns.due_date = change.after.dueOn;
  if (change.after.visible !== undefined) columns.client_visible = change.after.visible;
  if (change.after.customer !== undefined) {
    const others = currentLabels.filter((label) => label.trim().toLowerCase() !== customerLabel.toLowerCase());
    columns.labels = change.after.customer ? [...others, customerLabel] : others;
  }
  return columns;
}

// How the chat shows a change -------------------------------------------------------------------------------------

/** A change proposal as the server sends it to the chat. */
export type ChangeView =
  | (ProjectUpdateProposal & { kind: "project.update"; id: string; expiresAt: string })
  | (TaskUpdateProposal & { kind: "tasks.update"; id: string; expiresAt: string });

export type ChangeLine = { label: string; before: string; after: string };

const shortDate = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
const showDate = (value: string | null) => value ? shortDate.format(Date.parse(`${value}T00:00:00Z`)) : "–";

/** One line "label: old → new" for a project field; a note shows only what is added. */
export function projectChangeLine(change: ProjectFieldChange): ChangeLine {
  if (change.field === "description") return { label: "Notiz in der Beschreibung", before: "", after: change.note };
  if (change.field === "status") return { label: "Status", before: projectStatusLabels[change.before], after: projectStatusLabels[change.after] };
  return { label: change.field === "dueOn" ? "Zieltermin" : "Start", before: showDate(change.before), after: showDate(change.after) };
}

/** The changed fields of one task as "label: old → new" lines. */
export function taskChangeLines(change: TaskChange): ChangeLine[] {
  const { before, after } = change;
  const lines: ChangeLine[] = [];
  if (after.title !== undefined) lines.push({ label: "Titel", before: before.title, after: after.title });
  if (after.status !== undefined) lines.push({ label: "Stand", before: taskStatusLabels[before.status], after: taskStatusLabels[after.status] });
  if (after.dueOn !== undefined) lines.push({ label: "Fällig", before: showDate(before.dueOn), after: showDate(after.dueOn) });
  if (after.customer !== undefined) lines.push({ label: "Dran ist", before: before.customer ? "Kunde" : "OALAB", after: after.customer ? "Kunde" : "OALAB" });
  if (after.visible !== undefined) lines.push({ label: "Freigabe", before: before.visible ? "für Kunde sichtbar" : "intern", after: after.visible ? "für Kunde sichtbar" : "intern" });
  return lines;
}

/** What Claude learns about a change proposal in later turns: only the outcome the server reported. */
export function changeNote(view: ChangeView, outcome: "open" | "saved" | "discarded" | "failed", detail = "") {
  const what = view.kind === "project.update"
    ? `Änderung am Projekt „${view.projectName}“: ${view.changes.map((change) => projectChangeLine(change).label).join(", ")}`
    : `Änderung an ${view.tasks.map((task) => `#${task.number}`).join(", ")} in „${view.projectName}“`;
  if (outcome === "saved") return `[Vermerk des Hubs: Vorschlag (${what}) wurde vom Nutzer gespeichert.${detail ? ` ${detail}` : ""}]`;
  if (outcome === "discarded") return `[Vermerk des Hubs: Vorschlag (${what}) wurde vom Nutzer verworfen, nichts gespeichert.]`;
  if (outcome === "failed") return `[Vermerk des Hubs: Speichern des Vorschlags (${what}) ist fehlgeschlagen, nichts gespeichert.${detail ? ` ${detail}` : ""}]`;
  return `[Vermerk des Hubs: Vorschlag (${what}) liegt in der Vorschau, noch nicht gespeichert.]`;
}
