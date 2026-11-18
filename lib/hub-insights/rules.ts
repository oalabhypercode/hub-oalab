/**
 * Insights (user 18.11.2026, design „V5“): tiles that answer „Wo steht mein Projekt, was kann ich tun?“ for customers
 * and „Was braucht Aufmerksamkeit?“ for admins. Pure rules for the screen and the tests; type imports only, so the
 * tests load this file directly. Dates are Berlin days (YYYY-MM-DD) that the caller computed.
 */
import type { Project, ProjectTask, StudioProjectStatus } from "../hub-data";
import type { QuotaRow } from "../hub-service-quota/rules";

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
