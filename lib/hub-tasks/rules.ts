/**
 * Rules of the task board, self-contained (type imports only) so tests check them directly: Studio's limits, the place
 * of a card between its neighbours, the due-date wording on cards and rows, and the board's search and filters.
 */
import type { BoardPerson, BoardTask, TaskPriority, TaskStatus } from "./types";

export const TASK_STATUSES: readonly TaskStatus[] = ["backlog", "todo", "progress", "review", "done"];
export const TASK_PRIORITIES: readonly TaskPriority[] = ["none", "low", "medium", "high", "urgent"];

export const STATUS_NAMES: Record<TaskStatus, string> = { backlog: "Backlog", todo: "Offen", progress: "In Arbeit", review: "In Prüfung", done: "Erledigt" };
/** What an empty column says. */
export const STATUS_EMPTY: Record<TaskStatus, string> = {
  backlog: "Ideen und Aufgaben für später",
  todo: "Nichts offen",
  progress: "Gerade arbeitet niemand daran",
  review: "Nichts wartet auf Prüfung",
  done: "Noch nichts erledigt",
};
export const PRIORITY_NAMES: Record<TaskPriority, string> = { none: "Keine Priorität", low: "Niedrig", medium: "Mittel", high: "Hoch", urgent: "Dringend" };

// Studio's checks (studio_workspace migration): titles 1–240 characters, texts up to 20,000, labels 1–64 and unique,
// board_order within ±1e12.
export const MAX_TITLE = 240;
export const MAX_TEXT = 20000;
export const MAX_LABEL = 64;
export const MAX_LABELS = 12;
export const ORDER_LIMIT = 1e12;
/** The done column shows its newest cards; the rest behind „ältere anzeigen“. */
export const DONE_VISIBLE = 6;

export const isStatus = (value: unknown): value is TaskStatus => typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);
export const isPriority = (value: unknown): value is TaskPriority => typeof value === "string" && (TASK_PRIORITIES as readonly string[]).includes(value);

/** One line, single spaces, 1–240 characters; otherwise null. */
export function cleanTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.replace(/\s+/g, " ").trim();
  return title && title.length <= MAX_TITLE ? title : null;
}

/** Free text with line breaks, trimmed at the end; null when longer than Studio allows. */
export function cleanText(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\r\n?/g, "\n").replace(/\s+$/u, "");
  return text.length <= max ? text : null;
}

/** Unique labels of 1–64 characters, at most twelve; null for anything else. */
export function cleanLabels(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const labels: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const label = item.replace(/\s+/g, " ").trim();
    if (!label || label.length > MAX_LABEL) return null;
    if (!labels.some((known) => known.toLowerCase() === label.toLowerCase())) labels.push(label);
  }
  return labels.length <= MAX_LABELS ? labels : null;
}

/** A calendar day (YYYY-MM-DD) or null for none; undefined when the value is no valid day. */
export function cleanDay(value: unknown): string | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? undefined : value;
}

/**
 * The board_order for a card dropped between two neighbours (null where a column ends). Midpoints keep the other
 * cards untouched; `null` means the gap is used up and the column has to be renumbered first.
 */
export function orderBetween(before: number | null, after: number | null): number | null {
  if (before === null && after === null) return 0;
  if (before === null) return after! - 1 >= -ORDER_LIMIT ? after! - 1 : null;
  if (after === null) return before + 1 <= ORDER_LIMIT ? before + 1 : null;
  const middle = (before + after) / 2;
  return middle > before && middle < after ? middle : null;
}

/** Evenly spaced orders (1, 2, 3 …) for a column in the given sequence. */
export const renumbered = (ids: readonly string[]) => new Map(ids.map((id, index) => [id, index + 1]));

/** Within a column: Studio's order, then the number, so equal orders stay stable. */
export const byBoardOrder = (a: Pick<BoardTask, "order" | "number">, b: Pick<BoardTask, "order" | "number">) => a.order - b.order || a.number - b.number;

const DAY = 86_400_000;
const dayValue = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const format = (iso: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", ...options }).format(dayValue(iso));

export type DueInfo = {
  /** Short text on a card: Heute, Morgen, Gestern, the weekday within a week, otherwise the date. */
  short: string;
  /** Text in a list row: like `short`, but the date with weekday beyond tomorrow. */
  row: string;
  /** For the hover hint: "Mittwoch, 18. November". */
  long: string;
  /** "heute", "in 3 Tagen", "2 Tage überfällig". */
  hint: string;
  tone: "" | "is-today" | "is-overdue";
};

export function dueInfo(iso: string | null, today: string, done: boolean): DueInfo | null {
  if (!iso || cleanDay(iso) === undefined) return null;
  const diff = Math.round((dayValue(iso) - dayValue(today)) / DAY);
  const dated = format(iso, { day: "numeric", month: "short" });
  const short = diff === 0 ? "Heute" : diff === 1 ? "Morgen" : diff === -1 ? "Gestern" : diff > 1 && diff < 7 ? format(iso, { weekday: "short" }) : dated;
  const row = diff === 0 ? "Heute" : diff === 1 ? "Morgen" : diff === -1 ? "Gestern" : format(iso, { weekday: "short", day: "numeric", month: "short" });
  const hint = diff === 0 ? "heute" : diff === 1 ? "morgen" : diff > 1 ? `in ${diff} Tagen` : `${-diff} ${diff === -1 ? "Tag" : "Tage"} überfällig`;
  const tone = done ? "" : diff === 0 ? "is-today" : diff < 0 ? "is-overdue" : "";
  return { short, row, long: format(iso, { weekday: "long", day: "numeric", month: "long" }), hint, tone };
}

/** Two letters for an avatar: first and last name, or the first two letters of a single word. */
export function initialsOf(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/[\s-]+/).filter(Boolean);
  if (!words.length) return "?";
  const letters = words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words[words.length - 1][0]}`;
  return letters.toUpperCase();
}

export type AssigneeFilter = "all" | "me" | "team" | "none";
export type DueFilter = "all" | "overdue" | "week" | "none";
export type BoardFilters = { query: string; mine: boolean; assignee: AssigneeFilter; label: string; due: DueFilter };
export const NO_FILTERS: BoardFilters = { query: "", mine: false, assignee: "all", label: "", due: "all" };

/** Whether a task stays visible under the search and filters of the toolbar. */
export function matchesFilters(task: BoardTask, filters: BoardFilters, context: { viewerId: string; today: string; people: ReadonlyMap<string, BoardPerson> }): boolean {
  if (filters.mine && !task.assigneeIds.includes(context.viewerId)) return false;
  if (filters.assignee === "me" && !task.assigneeIds.includes(context.viewerId)) return false;
  if (filters.assignee === "team" && !task.assigneeIds.length) return false;
  if (filters.assignee === "none" && task.assigneeIds.length) return false;
  if (filters.label && !task.labels.some((label) => label.toLowerCase() === filters.label.toLowerCase())) return false;
  if (filters.due !== "all") {
    if (filters.due === "none" && task.dueOn) return false;
    if (filters.due !== "none") {
      const due = dueInfo(task.dueOn, context.today, task.status === "done");
      if (!due || task.status === "done") return false;
      if (filters.due === "overdue" && due.tone !== "is-overdue") return false;
      if (filters.due === "week" && (dayValue(task.dueOn!) - dayValue(context.today)) / DAY > 6) return false;
    }
  }
  const query = filters.query.trim().toLowerCase();
  if (!query) return true;
  const names = task.assigneeIds.map((id) => context.people.get(id)?.name ?? "");
  return [task.title, `#${task.number}`, String(task.number), ...task.labels, ...names].some((text) => text.toLowerCase().includes(query));
}

export const activeFilterCount = (filters: BoardFilters) => [filters.assignee !== "all", Boolean(filters.label), filters.due !== "all"].filter(Boolean).length;

/** One row of Studio's `studio_tasks` as the board reads it. */
export type StudioTaskRow = {
  id: string;
  task_number: number | string;
  project_id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  labels: string[] | null;
  assignee_user_ids: string[] | null;
  client_visible: boolean;
  board_order: number | string;
  version: number | string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type TaskCounts = { comments: number; done: number; total: number; files: number };
export const NO_COUNTS: TaskCounts = { comments: 0, done: 0, total: 0, files: 0 };

/** A board card from its Studio row; unknown statuses land in "Offen", unknown priorities in "Keine". */
export function toBoardTask(row: StudioTaskRow, counts: TaskCounts = NO_COUNTS): BoardTask {
  return {
    id: row.id,
    number: Number(row.task_number),
    projectId: row.project_id,
    title: row.title,
    status: isStatus(row.status) ? row.status : "todo",
    priority: isPriority(row.priority) ? row.priority : "none",
    dueOn: row.due_date,
    labels: row.labels ?? [],
    assigneeIds: row.assignee_user_ids ?? [],
    visible: Boolean(row.client_visible),
    order: Number(row.board_order) || 0,
    version: Number(row.version) || 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    comments: counts.comments,
    checklist: { done: counts.done, total: counts.total },
    files: counts.files,
  };
}

/** Share of done tasks in percent, like Studio's progress. */
export const progressOf = (tasks: readonly Pick<BoardTask, "status">[]) => tasks.length ? Math.round((tasks.filter((task) => task.status === "done").length / tasks.length) * 100) : 0;
