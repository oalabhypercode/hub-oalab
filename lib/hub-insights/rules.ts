/**
 * Insights (user 18.11.2026, design „V5“): tiles that answer „Wo steht mein Projekt, was kann ich tun?“ for customers
 * and „Was braucht Aufmerksamkeit?“ for admins. Pure rules for the screen and the tests; type imports only, so the
 * tests load this file directly. Dates are Berlin days (YYYY-MM-DD) that the caller computed.
 */
import type { Project, ProjectTask, StudioProjectStatus } from "../hub-data";
import type { QuotaRow } from "../hub-service-quota/rules";
import type { HubAppointment } from "../hub-calendar/types";
import type { BoardProject, BoardTask } from "../hub-tasks/types";
import type { ShareArea } from "../hub-freelancer-customers/rules";
import type { FreelancerCustomerCard } from "../hub-freelancer-customers/types";

/** Studio's status of a project; without one a finished project counts as complete, else active (as on Projekte). */
const studioStatus = (project: Pick<Project, "studio" | "status">): StudioProjectStatus =>
  project.studio?.status ?? (project.status === "Abgeschlossen" ? "complete" : "active");

/** A customer task that is released and open: the customer is at turn. */
const waitsForCustomer = (task: ProjectTask) => task.customer && task.visible && task.status !== "done";

/**
 * The project a customer sees first: one that waits for their feedback, then the one in work with the nearest target
 * date, finished ones last. The others follow in the same order.
 */
export function orderProjects<P extends Pick<Project, "status" | "dueOn" | "name" | "studio">>(projects: readonly P[]): P[] {
  const rank = (project: P) => project.status === "Dein Feedback" ? 0 : project.status === "Abgeschlossen" ? 2 : 1;
  return [...projects].sort((a, b) => rank(a) - rank(b) || (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || a.name.localeCompare(b.name, "de"));
}

/** Whether a progress figure means something: Studio counts tasks or finished requests; with neither it is no news. */
export const hasProgress = (project: Pick<Project, "progressBasis" | "tasks" | "requests" | "progress">) =>
  project.progressBasis ? project.progressBasis !== "none" : project.progress > 0;

export type QuotaTone = "ok" | "warn" | "full";

/** The month's requests of a Service package: used, free and the tone (from 80 % „fast aufgebraucht“, as quota rules). */
export function quotaView(row: Pick<QuotaRow, "monthlyLimit" | "monthlyUsed">) {
  const limit = Math.max(0, row.monthlyLimit);
  const used = Math.max(0, row.monthlyUsed);
  const free = Math.max(0, limit - used);
  const tone: QuotaTone = limit > 0 && used >= limit ? "full" : limit > 0 && used >= Math.ceil(limit * 0.8) ? "warn" : "ok";
  return { limit, used, free, tone, share: limit > 0 ? Math.min(1, used / limit) : 0 };
}

/** Requests still open on the service platform, over every project of the customer. */
export const openRequests = (projects: readonly Pick<Project, "requests">[]) => projects.reduce((sum, project) => sum + (project.requests?.open ?? 0), 0);

export type DueTask = { task: ProjectTask; project: Project; overdue: boolean };

/** Open tasks due today or earlier over all projects, overdue first, then by date and number (admins' tile). */
export function dueTasks(projects: readonly Project[], today: string): DueTask[] {
  return projects
    .filter((project) => studioStatus(project) !== "complete")
    .flatMap((project) => (project.tasks ?? [])
      .filter((task) => task.status !== "done" && task.dueOn !== null && task.dueOn <= today)
      .map((task) => ({ task, project, overdue: (task.dueOn as string) < today })))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.task.dueOn as string).localeCompare(b.task.dueOn as string) || a.task.number - b.task.number);
}

export type WatchReason = "risk" | "late" | "waiting" | "hold";

/**
 * Projects that need a look, most urgent first: at risk, past their target date, waiting for the customer (a released
 * customer task is open), paused. Finished projects never; each project once, with its most urgent reason.
 */
export function watchProjects(projects: readonly Project[], today: string): { project: Project; reason: WatchReason; waiting: number }[] {
  const order: WatchReason[] = ["risk", "late", "waiting", "hold"];
  return projects.flatMap((project) => {
    const status = studioStatus(project);
    if (status === "complete") return [];
    const waiting = (project.tasks ?? []).filter(waitsForCustomer).length;
    const reason: WatchReason | null = status === "risk" ? "risk"
      : project.dueOn !== null && project.dueOn < today ? "late"
        : waiting > 0 || (!project.tasks && project.status === "Dein Feedback") ? "waiting"
          : status === "hold" ? "hold" : null;
    return reason ? [{ project, reason, waiting }] : [];
  }).sort((a, b) => order.indexOf(a.reason) - order.indexOf(b.reason) || (a.project.dueOn ?? "9999").localeCompare(b.project.dueOn ?? "9999"));
}

export type ServiceRow = { customerId: string; company: string; customerNumber: string; packageId: string; limit: number; used: number; tone: QuotaTone; share: number };

/**
 * The admins' service tile: every customer with a Service package, the fullest first, then by company. Customers
 * without a package or a name (archived, unknown) stay out.
 */
export function serviceRows(rows: readonly QuotaRow[], names: ReadonlyMap<string, { company: string; customerNumber: string }>): ServiceRow[] {
  return rows.flatMap((row) => {
    const name = names.get(row.customerId);
    if (!row.packageId || row.monthlyLimit <= 0 || !name) return [];
    const view = quotaView(row);
    return [{ customerId: row.customerId, company: name.company, customerNumber: name.customerNumber, packageId: row.packageId, limit: view.limit, used: view.used, tone: view.tone, share: view.share }];
  }).sort((a, b) => b.share - a.share || b.used - a.used || a.company.localeCompare(b.company, "de"));
}

/** How many customers stand where: in the frame, nearly full, full. */
export function serviceSummary(rows: readonly Pick<ServiceRow, "tone">[]) {
  return { ok: rows.filter((row) => row.tone === "ok").length, warn: rows.filter((row) => row.tone === "warn").length, full: rows.filter((row) => row.tone === "full").length };
}

// ---------- The widgets of the Übersicht (design „V5“, 18.11.2026): the same numbers as the tiles here ----------

export type TaskCounts = Record<ProjectTask["status"], number>;

/** Tasks by board column: admins over every project that is not finished, customers over what is released to them. */
export function taskCounts(projects: readonly Project[], admin: boolean): TaskCounts {
  const counts: TaskCounts = { backlog: 0, todo: 0, progress: 0, review: 0, done: 0 };
  for (const project of projects) {
    if (admin && studioStatus(project) === "complete") continue;
    for (const task of project.tasks ?? []) if (admin || task.visible) counts[task.status] += 1;
  }
  return counts;
}

/** Open tasks with a date: how many are overdue and how many fall due on each of the `days` days from today on. */
export function dueByDay(projects: readonly Project[], today: string, admin: boolean, days = 14): { overdue: number; days: number[] } {
  return dueOf(projects.filter((project) => studioStatus(project) !== "complete").flatMap((project) => (project.tasks ?? []).filter((task) => admin || task.visible)), today, days);
}

/** Open tasks with a date, counted as overdue or on their day among the `days` days from today on. */
function dueOf(tasks: readonly { status: string; dueOn: string | null }[], today: string, days: number) {
  const result = { overdue: 0, days: new Array<number>(days).fill(0) };
  const start = Date.parse(`${today}T00:00:00Z`);
  for (const task of tasks) {
    if (task.status === "done" || !task.dueOn) continue;
    if (task.dueOn < today) { result.overdue += 1; continue; }
    const index = Math.round((Date.parse(`${task.dueOn}T00:00:00Z`) - start) / 86_400_000);
    if (index < days) result.days[index] += 1;
  }
  return result;
}

// ---------- A freelancer's widgets (18.11.2026): their board, i.e. their projects without „Nur Team“ ----------

/** A freelancer's board tasks by column. */
export function boardCounts(tasks: readonly Pick<BoardTask, "status">[]): TaskCounts {
  const counts: TaskCounts = { backlog: 0, todo: 0, progress: 0, review: 0, done: 0 };
  for (const task of tasks) counts[task.status] += 1;
  return counts;
}

/** Due dates of the tasks assigned to the freelancer: their own deadlines, not the whole project's. */
export const boardDueByDay = (tasks: readonly Pick<BoardTask, "status" | "dueOn" | "assigneeIds">[], userId: string, today: string, days = 14) =>
  dueOf(tasks.filter((task) => task.assigneeIds.includes(userId)), today, days);

export type BoardCustomer = { company: string; customerId: string | null; open: number };

/**
 * The customers a freelancer looks after with the open tasks of their projects there (matched by company name), most
 * open first, then by name. Customers without a project on the board stay with 0; board companies without a hub
 * customer (unknown here) come without an id.
 */
export function boardCustomers(customers: readonly { id: string; company: string }[], projects: readonly Pick<BoardProject, "id" | "company">[], tasks: readonly Pick<BoardTask, "projectId" | "status">[]): BoardCustomer[] {
  const companyOf = new Map(projects.map((project) => [project.id, project.company]));
  const open = new Map<string, number>();
  for (const task of tasks) {
    const company = companyOf.get(task.projectId);
    if (company && task.status !== "done") open.set(company, (open.get(company) ?? 0) + 1);
  }
  const known = new Set(customers.map((customer) => customer.company));
  const rows: BoardCustomer[] = [
    ...customers.map((customer) => ({ company: customer.company, customerId: customer.id, open: open.get(customer.company) ?? 0 })),
    ...[...new Set(projects.map((project) => project.company))].filter((company) => company && !known.has(company)).map((company) => ({ company, customerId: null, open: open.get(company) ?? 0 })),
  ];
  return rows.sort((a, b) => b.open - a.open || a.company.localeCompare(b.company, "de"));
}

export type ProgressRow = { id: string; name: string; company: string; dueOn: string | null; value: number | null; risk: boolean };

/**
 * Project progress: admins see the projects that are not finished, those at risk first, then by target date; customers
 * their own in the order of the „Dein Projekt“ tile. Without counted tasks or requests the value is null („–“).
 */
export function progressRows(projects: readonly Project[], admin: boolean): ProgressRow[] {
  const isRisk = (project: Project) => studioStatus(project) === "risk";
  const list = admin
    ? projects.filter((project) => studioStatus(project) !== "complete").sort((a, b) => Number(isRisk(b)) - Number(isRisk(a)) || (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || a.name.localeCompare(b.name, "de"))
    : orderProjects(projects);
  return list.map((project) => ({ id: project.id, name: project.category || project.name, company: project.company ?? "", dueOn: project.dueOn, value: hasProgress(project) ? project.progress : null, risk: isRisk(project) }));
}

const berlinDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" });

/** Activity: how many things happened on each of the last `days` days up to today, by their day in German time. */
export function activityByDay(stamps: readonly string[], today: string, days = 14): number[] {
  const counts = new Array<number>(days).fill(0);
  const end = Date.parse(`${today}T00:00:00Z`);
  for (const iso of stamps) {
    const time = Date.parse(iso);
    if (Number.isNaN(time)) continue;
    const index = days - 1 - Math.round((end - Date.parse(`${berlinDay.format(time)}T00:00:00Z`)) / 86_400_000);
    if (index >= 0 && index < days) counts[index] += 1;
  }
  return counts;
}

/** Monday of the week a Berlin day lies in (YYYY-MM-DD), for the week strip. */
export function weekStartOf(day: string): string {
  const time = Date.parse(`${day}T00:00:00Z`);
  const back = (new Date(time).getUTCDay() + 6) % 7;
  return new Date(time - back * 86_400_000).toISOString().slice(0, 10);
}

// ---------- What waits for admins, as notifications on the Übersicht (design „V5“, 18.11.2026) ----------

export type AdminTodo =
  | { kind: "registrations"; key: string; count: number }
  | { kind: "request"; key: string; appointment: Pick<HubAppointment, "id" | "title" | "start" | "end" | "customer"> }
  | { kind: "overdue"; key: string; count: number; first: DueTask }
  | { kind: "quota"; key: string; row: ServiceRow }
  | { kind: "risk" | "waiting"; key: string; project: Project; waiting: number };

/**
 * What needs an admin, derived from what the page already knows: waiting registrations, open appointment requests (the
 * next three), overdue tasks (one line), customers whose quota is full, projects at risk or waiting for the customer (the
 * first three). Each key carries the state, so a hidden line comes back when the state changes (one more registration,
 * another overdue task, more requests used).
 */
export function adminTodos({ registrations, appointments, projects, rows, today, now }: { registrations: number; appointments: readonly Pick<HubAppointment, "id" | "title" | "start" | "end" | "status" | "customer">[]; projects: readonly Project[]; rows: readonly ServiceRow[]; today: string; now: number }): AdminTodo[] {
  const todos: AdminTodo[] = [];
  if (registrations > 0) todos.push({ kind: "registrations", key: `registrations:${registrations}`, count: registrations });
  for (const appointment of appointments.filter((item) => item.status === "requested" && item.end > now).slice(0, 3)) todos.push({ kind: "request", key: `request:${appointment.id}`, appointment });
  const overdue = dueTasks(projects, today).filter((item) => item.overdue);
  if (overdue.length) todos.push({ kind: "overdue", key: `overdue:${overdue.map((item) => item.task.id).sort().join(",")}`, count: overdue.length, first: overdue[0] });
  for (const row of rows.filter((item) => item.tone === "full")) todos.push({ kind: "quota", key: `quota:${row.customerId}:${row.used}`, row });
  for (const item of watchProjects(projects, today).filter((entry) => entry.reason === "risk" || entry.reason === "waiting").slice(0, 3)) {
    todos.push({ kind: item.reason as "risk" | "waiting", key: `${item.reason}:${item.project.id}:${item.waiting}`, project: item.project, waiting: item.waiting });
  }
  return todos;
}

/** A derived line's id among the bell's: negative, so it never meets a stored notice, and stable for its key. */
export function todoId(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return -((hash >>> 1) + 1);
}

// ---------- A freelancer's Insights (19.11.2026): their tasks, customers and projects ----------

/** The open tasks assigned to the freelancer: by due date, so the overdue ones come first, those without one last. */
export function myTasks<T extends Pick<BoardTask, "status" | "dueOn" | "assigneeIds" | "number">>(tasks: readonly T[], userId: string): T[] {
  return tasks.filter((task) => task.status !== "done" && task.assigneeIds.includes(userId))
    .sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || a.number - b.number);
}

export type BoardProgress = { id: string; name: string; company: string; dueOn: string | null; done: number; total: number; share: number | null };

/** Each project on the freelancer's board with how many of the tasks they see are done; the nearest target date first. */
export function boardProgress(projects: readonly Pick<BoardProject, "id" | "name" | "company" | "dueOn">[], tasks: readonly Pick<BoardTask, "projectId" | "status">[]): BoardProgress[] {
  return projects.map((project) => {
    const own = tasks.filter((task) => task.projectId === project.id);
    const done = own.filter((task) => task.status === "done").length;
    return { id: project.id, name: project.name, company: project.company, dueOn: project.dueOn, done, total: own.length, share: own.length ? Math.round((done / own.length) * 100) : null };
  }).sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || a.name.localeCompare(b.name, "de"));
}

const SHARE_ORDER: ShareArea[] = ["domains", "mail", "packages", "contact"];
export type CardCustomer = { customerId: string; company: string; open: number; note: string; shares: ShareArea[] };

/**
 * The customers a freelancer looks after, from their cards: the open tasks of their projects (linked through the
 * customer's Service organization), the team's note and the areas oalab released; most open tasks first, then by name.
 */
export function cardCustomers(cards: readonly Pick<FreelancerCustomerCard, "customerId" | "company" | "organizationId" | "note" | "shares">[], projects: readonly Pick<BoardProject, "id" | "organizationId">[], tasks: readonly Pick<BoardTask, "projectId" | "status">[]): CardCustomer[] {
  const organizationOf = new Map(projects.map((project) => [project.id, project.organizationId]));
  const open = new Map<string, number>();
  for (const task of tasks) {
    const organization = organizationOf.get(task.projectId);
    if (organization && task.status !== "done") open.set(organization, (open.get(organization) ?? 0) + 1);
  }
  return cards.map((card) => ({
    customerId: card.customerId,
    company: card.company,
    open: card.organizationId ? open.get(card.organizationId) ?? 0 : 0,
    note: (card.note ?? "").trim(),
    shares: SHARE_ORDER.filter((area) => Boolean(card.shares[area])),
  })).sort((a, b) => b.open - a.open || a.company.localeCompare(b.company, "de"));
}
