/**
 * Turns OALab Studio rows into the hub's project shape. Self-contained (type imports only) so tests check it directly.
 * The rules follow Studio, so hub and Studio show the same numbers:
 * - progress is the share of done tasks; a project without tasks falls back to its finished requests;
 * - "Abgeschlossen" is Studio's status "complete";
 * - "Dein Feedback" means an open task with the label "Kunde" that is released to the customer.
 */
import type { Milestone, Project, ProjectTask } from "../hub-data";

/** The label that marks a task the customer has to do. */
export const CUSTOMER_LABEL = "Kunde";

export type StudioProjectRow = { id: string; organization_id: string; display_name: string; status: string };
export type StudioDetailsRow = {
  project_id: string;
  description: string;
  status: string;
  start_date: string | null;
  due_date: string | null;
  milestones: unknown;
};
export type StudioTaskRow = {
  id: string;
  task_number: number;
  project_id: string;
  title: string;
  status: string;
  due_date: string | null;
  labels: string[] | null;
  client_visible: boolean;
};
export type RequestCounts = { open: number; done: number };

/** Studio projects of a real login, or why they could not be loaded. */
export type LiveProjectsState = { projects: Project[]; error: string | null };

const taskStatuses = ["backlog", "todo", "progress", "review", "done"] as const;
const isCustomerLabel = (label: string) => label.trim().toLowerCase() === CUSTOMER_LABEL.toLowerCase();
/** Request states Studio counts as finished respectively still open. */
const doneRequestStates = new Set(["released", "resolved"]);
const closedRequestStates = new Set(["draft", "released", "resolved", "rejected", "cancelled", "superseded", "archived"]);

export function countRequests(rows: readonly { state: string }[]): RequestCounts {
  return {
    open: rows.filter((row) => !closedRequestStates.has(row.state)).length,
    done: rows.filter((row) => doneRequestStates.has(row.state)).length,
  };
}

export function toProjectTask(row: StudioTaskRow): ProjectTask {
  return {
    id: row.id,
    number: Number(row.task_number),
    title: row.title,
    status: taskStatuses.find((status) => status === row.status) ?? "todo",
    dueOn: row.due_date,
    customer: (row.labels ?? []).some(isCustomerLabel),
    visible: row.client_visible,
  };
}

const percent = (part: number, whole: number) => whole ? Math.round((part / whole) * 100) : 0;

function toMilestones(value: unknown): Milestone[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => item && typeof item === "object" && typeof item.name === "string" && typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
      ? [{ title: item.name, description: "", at: item.date, kind: "milestone" as const }]
      : [])
    .sort((a, b) => a.at.localeCompare(b.at));
}

const targetDate = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", day: "2-digit", month: "long", year: "numeric" });

/** One hub project from its Studio rows; `tasks` are the tasks the viewer may see. */
export function toHubProject(input: { project: StudioProjectRow; details: StudioDetailsRow | null; tasks: ProjectTask[]; requests: RequestCounts; company: string | undefined }): Project {
  const { project, details, tasks, requests } = input;
  // Without Studio details a project counts as running (Studio shows "paused" ones as on hold, the hub has no such status).
  const complete = details?.status === "complete";
  const waiting = tasks.some((task) => task.status !== "done" && task.customer && task.visible);
  const dueOn = details?.due_date ?? null;
  return {
    id: project.id,
    name: project.display_name,
    category: "",
    description: details?.description ?? "",
    status: complete ? "Abgeschlossen" : waiting ? "Dein Feedback" : "In Umsetzung",
    progress: tasks.length
      ? percent(tasks.filter((task) => task.status === "done").length, tasks.length)
      : percent(requests.done, requests.done + requests.open),
    date: dueOn ? targetDate.format(Date.parse(`${dueOn}T00:00:00Z`)) : "Kein Zieltermin",
    artwork: "orange",
    company: input.company,
    organizationId: project.organization_id,
    startedOn: details?.start_date ?? null,
    dueOn,
    milestones: toMilestones(details?.milestones),
    progressBasis: tasks.length ? "tasks" : requests.done + requests.open ? "requests" : "none",
    requests,
    tasks: [...tasks].sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || a.number - b.number),
  };
}

/** Open tasks the customer has to do, earliest due first: "Du bist am Zug". */
export function customerSteps(projects: readonly Project[]) {
  return projects
    .flatMap((project) => (project.tasks ?? [])
      .filter((task) => task.status !== "done" && task.customer && task.visible)
      .map((task) => ({ task, project })))
    .sort((a, b) => (a.task.dueOn ?? "9999").localeCompare(b.task.dueOn ?? "9999") || a.task.number - b.task.number);
}
