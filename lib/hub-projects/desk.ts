/**
 * The admins' project page (Projekte V2, user 15.11.2026): every customer on the left, on the right the chosen one with
 * all projects, their domains and links and the Service. Pure rules for the screen and the tests, type imports only.
 * The status is Studio's own (studio_project_details.status), so hub, Studio and the customer always agree; the
 * customer keeps seeing less of it: In Umsetzung, Dein Feedback or Abgeschlossen.
 */
import type { Project, StudioProjectStatus } from "../hub-data";
import type { CustomerPackage } from "../service-packages";
import type { ProjectDomain } from "./map";

export type StatusTone = "info" | "ok" | "bad" | "todo" | "off";

/** Studio's five statuses in Studio's order, with the names Studio gives them. */
export const studioStatusOrder: readonly StudioProjectStatus[] = ["planning", "active", "risk", "hold", "complete"];
export const studioStatuses: Record<StudioProjectStatus, { label: string; tone: StatusTone; hint: string }> = {
  planning: { label: "Planung", tone: "info", hint: "noch nicht begonnen" },
  active: { label: "In Arbeit", tone: "ok", hint: "läuft nach Plan" },
  risk: { label: "Gefährdet", tone: "bad", hint: "Termin oder Umfang wackelt" },
  hold: { label: "Pausiert", tone: "todo", hint: "ruht gerade" },
  complete: { label: "Fertig", tone: "off", hint: "abgeschlossen" },
};
export const isStudioStatus = (value: unknown): value is StudioProjectStatus => typeof value === "string" && (studioStatusOrder as readonly string[]).includes(value);

/** The overview groups what needs attention first: at risk, in work, planned, paused, finished. */
export const studioGroupOrder: readonly StudioProjectStatus[] = ["risk", "active", "planning", "hold", "complete"];

/** A project runs while it is planned, in work or at risk; paused and finished ones do not. */
export const isRunning = (status: StudioProjectStatus) => status === "planning" || status === "active" || status === "risk";

/** The Studio status of a hub project; without one (no Studio row) a finished project counts as complete, else active. */
export const statusOf = (project: Pick<Project, "studio" | "status">): StudioProjectStatus =>
  project.studio?.status ?? (project.status === "Abgeschlossen" ? "complete" : "active");

/** A released customer task is open: the customer is at turn, whatever the status says (map.ts: „Dein Feedback“). */
export const isWaiting = (project: Pick<Project, "status" | "tasks">) => project.tasks
  ? project.tasks.some((task) => task.status !== "done" && task.customer && task.visible)
  : project.status === "Dein Feedback";

/** The project with a status set on this page, until the page's data carries that version (or a newer one) itself. */
export function withStatus<P extends Project>(project: P, set: { status: StudioProjectStatus; version: number } | undefined): P {
  if (!set || (project.studio?.version ?? 0) > set.version) return project;
  return { ...project, status: customerSees(set.status, isWaiting(project)), studio: { ...project.studio, status: set.status, version: set.version } };
}

/** What the customer reads in the hub for a Studio status (the hub's rule in map.ts: only "complete" finishes). */
export function customerSees(status: StudioProjectStatus, waiting: boolean): Project["status"] {
  if (status === "complete") return "Abgeschlossen";
  return waiting ? "Dein Feedback" : "In Umsetzung";
}

/**
 * The row veil (user 15.11.2026, like the User Management's Zugänge since 9.11.2026): the status colours the whole row,
 * full on the left half and fading out to the right, with a rounded bar on the left. Finished projects stay plain.
 */
export type VeilStatus = Exclude<StudioProjectStatus, "complete">;
export const veils: Record<VeilStatus, { dot: string; label: string }> = {
  risk: { dot: "is-none", label: "gefährdet" },
  hold: { dot: "is-open", label: "pausiert" },
  active: { dot: "is-ok", label: "in Arbeit" },
  planning: { dot: "is-info", label: "in Planung" },
};
const veilOrder: readonly VeilStatus[] = ["risk", "hold", "active", "planning"];
export const veilOf = (status: StudioProjectStatus): VeilStatus | null => status === "complete" ? null : status;

/** The legend under a table: how many rows wear which colour, most urgent first; colours without rows stay out. */
export function veilCounts(statuses: readonly StudioProjectStatus[]) {
  return veilOrder.flatMap((status) => {
    const count = statuses.filter((item) => item === status).length;
    return count ? [{ status, count, ...veils[status] }] : [];
  });
}

/** One open request of the customer on the service platform, as the Service group lists it. */
export type DeskRequest = {
  id: string;
  /** "OA-12", how the service platform names it. */
  reference: string;
  title: string;
  /** The service platform's label for its state ("Deine Freigabe"), as the customer reads it there. */
  label: string;
  tone: "todo" | "info" | "ok" | "off";
  /** On the test domain, waiting for the customer's approval. */
  approval: boolean;
  projectId: string | null;
  /** Last change, ISO. */
  at: string;
};

/** A hub customer (kind customer) with everything the project page shows next to the projects. */
export type DeskCustomer = {
  id: string;
  company: string;
  customerNumber: string;
  /** The website from the customer data, as its start page. */
  website: string | null;
  /** The customer's organization on the service platform; without one there are no projects or requests. */
  organizationId: string | null;
  /** The domains of „Vertrag & Domain“. */
  domains: ProjectDomain[];
  /** Both package groups, a group without a package as packageId null. */
  packages: CustomerPackage[];
  /** New requests this month and the package's limit, while the service platform counts them. */
  quota: { used: number; limit: number } | null;
  /** Open requests, newest first. */
  requests: DeskRequest[];
  /** Requests finished this month, with the latest one. */
  done: { count: number; last: { reference: string; title: string; at: string } | null };
};

export type ProjectDesk = {
  customers: DeskCustomer[];
  /** The counted month in German time, „November“, while the service platform counts. */
  month: string | null;
  /** Why the customers could not be loaded; the requests or the quota may fail on their own (`partial`). */
  error: string | null;
  partial: string | null;
};

/** The customer's projects in one word for the list: whether one runs, is at risk or waits for the customer. */
export function customerState(projects: readonly Pick<Project, "studio" | "status" | "tasks">[]): { running: boolean; tone: StatusTone; pill: "risk" | "feedback" | null; sub: string } {
  const statuses = projects.map(statusOf);
  const runningCount = statuses.filter(isRunning).length;
  const runs = runningCount === 1 ? "1 Projekt läuft" : `${runningCount} Projekte laufen`;
  if (statuses.includes("risk")) return { running: true, tone: "bad", pill: "risk", sub: runs };
  if (runningCount) return { running: true, tone: "ok", pill: projects.some((project) => isRunning(statusOf(project)) && isWaiting(project)) ? "feedback" : null, sub: runs };
  if (statuses.includes("hold")) return { running: false, tone: "todo", pill: null, sub: "Projekt pausiert" };
  return { running: false, tone: "off", pill: null, sub: projects.length ? "Kein laufendes Projekt" : "Noch kein Projekt" };
}

/** The two domains of the customer's head: the live website and its test domain, running projects first. */
export function mainLinks(projects: readonly Pick<Project, "studio" | "status" | "liveUrl" | "testUrl">[]): { live: string | null; test: string | null } {
  const ordered = [...projects].sort((a, b) => Number(!isRunning(statusOf(a))) - Number(!isRunning(statusOf(b))));
  const live = ordered.find((project) => project.liveUrl);
  const test = live?.testUrl ? live : ordered.find((project) => project.testUrl);
  return { live: live?.liveUrl ?? null, test: test?.testUrl ?? null };
}

/** The next milestone on or after `asOf` (milestones come sorted by day); null once all are reached or none exists. */
export const nextMilestone = (project: Pick<Project, "milestones">, asOf: string) => project.milestones.find((item) => item.at.slice(0, 10) >= asOf) ?? null;

/** Open projects by urgency (at risk first, then by target day); finished ones are listed apart. */
export function byUrgency<P extends Pick<Project, "studio" | "status" | "dueOn" | "name">>(projects: readonly P[]): P[] {
  return [...projects].sort((a, b) => studioGroupOrder.indexOf(statusOf(a)) - studioGroupOrder.indexOf(statusOf(b))
    || (a.dueOn ?? "9999-12-31").localeCompare(b.dueOn ?? "9999-12-31") || a.name.localeCompare(b.name, "de"));
}
