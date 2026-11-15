/**
 * Turns OALab Studio rows into the hub's project shape. Self-contained (type imports only) so tests check it directly.
 * The rules follow Studio, so hub and Studio show the same numbers:
 * - progress is the share of done tasks; a project without tasks falls back to its finished requests;
 * - "Abgeschlossen" is Studio's status "complete";
 * - "Dein Feedback" means an open task with the label "Kunde" that is released to the customer.
 */
import type { Milestone, Project, ProjectTask, StudioProjectStatus } from "../hub-data";

/** The label that marks a task the customer has to do. */
export const CUSTOMER_LABEL = "Kunde";

export type StudioProjectRow = { id: string; organization_id: string; display_name: string; status: string; test_url?: string | null; live_url?: string | null };
export type StudioDetailsRow = {
  project_id: string;
  description: string;
  status: string;
  start_date: string | null;
  due_date: string | null;
  milestones: unknown;
  version?: number;
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
  version?: number;
};
export type RequestCounts = { open: number; done: number };

/** A domain of the customer from „Vertrag & Domain“, as the project panel lists it (admins only). */
export type ProjectDomain = { id: string; domain: string; display: string; status: string; renewsOn: string | null };

/** The hub customer behind projects, for the admins' project panel: number, website and domains. */
export type ProjectCustomer = { id: string; company: string; customerNumber: string; website: string | null; domains: ProjectDomain[] };

/** Studio projects of a real login, or why they could not be loaded; admins also get the customers behind them. */
export type LiveProjectsState = { projects: Project[]; error: string | null; customers?: ProjectCustomer[] };

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
    ...(row.version ? { version: Number(row.version) } : {}),
  };
}

const studioStatuses: StudioProjectStatus[] = ["planning", "active", "risk", "hold", "complete"];

/** Studio's status, as Studio shows it: without a details row a paused project is "hold", otherwise "active". */
function studioStatusOf(project: StudioProjectRow, details: StudioDetailsRow | null): StudioProjectStatus {
  return studioStatuses.find((status) => status === details?.status) ?? (project.status === "paused" ? "hold" : "active");
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

/**
 * The website as typed in the user management ("abc.de", "www.abc.de/", "https://abc.de/impressum") as the start page
 * of the site ("https://abc.de/"), or null. Some entries point at a subpage; the shortcut opens the site itself.
 */
export function websiteUrl(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    return url.hostname.includes(".") ? `${url.origin}/` : null;
  } catch {
    return null;
  }
}

/** A stored project address as a link: only https, as the database allows; anything else is no address. */
export function projectUrl(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text || !/^https:\/\/\S+$/i.test(text)) return null;
  try {
    return new URL(text).hostname.includes(".") ? text : null;
  } catch {
    return null;
  }
}

/** "https://www.abc.de/" → "abc.de": the address the way people say it. */
export function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
    return `${parsed.hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return url;
  }
}

/**
 * An address typed into the panel ("abc.de", " https://abc.de/ ") as it is stored: https, no spaces, at most 2048
 * characters; empty clears. Returns an error text for anything else.
 */
export function readProjectUrl(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return { ok: true, value: null };
  if (/^http:\/\//i.test(text)) return { ok: false, error: "Bitte eine sichere Adresse mit https:// eintragen." };
  const withScheme = /^https:\/\//i.test(text) ? text : `https://${text}`;
  if (/\s/.test(withScheme) || withScheme.length > 2048) return { ok: false, error: "Die Adresse darf keine Leerzeichen enthalten." };
  try {
    const url = new URL(withScheme);
    if (!url.hostname.includes(".")) return { ok: false, error: "Das sieht nicht nach einer Web-Adresse aus, etwa kunde.de." };
    return { ok: true, value: url.pathname === "/" && !url.search && !url.hash ? url.origin : url.href };
  } catch {
    return { ok: false, error: "Das sieht nicht nach einer Web-Adresse aus, etwa kunde.de." };
  }
}

export type ProjectSite = { key: "live" | "website" | "test"; url: string; label: string; sub: string };

/**
 * The project's addresses as everyone reads them: the live address (or, without one, the website from the customer
 * data) and the test address, where every change shows first.
 */
export function projectSites(project: Project): ProjectSite[] {
  const sites: ProjectSite[] = [];
  if (project.liveUrl) sites.push({ key: "live", url: project.liveUrl, label: "Live", sub: "Die fertige Website" });
  else if (project.website) sites.push({ key: "website", url: project.website, label: "Website", sub: "Aus den Kundendaten" });
  if (project.testUrl) sites.push({ key: "test", url: project.testUrl, label: "Test", sub: "Vorschau: Änderungen erscheinen zuerst hier" });
  return sites;
}

/** "Website podologie-sassnitz.de" says nothing the address rows do not already show: such a description stays out. */
export function restatesSite(description: string | undefined, urls: (string | null | undefined)[]): boolean {
  const text = description?.trim().toLocaleLowerCase("de").replace(/^(die\s+)?(website|webseite|homepage)\s*:?\s*/, "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  if (!text) return Boolean(description);
  return urls.some((url) => {
    if (!url) return false;
    try {
      return new URL(url).hostname.replace(/^www\./, "") === text;
    } catch {
      return false;
    }
  });
}

const targetDate = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", day: "2-digit", month: "long", year: "numeric" });

/** One hub project from its Studio rows; `tasks` are the tasks the viewer may see. */
export function toHubProject(input: { project: StudioProjectRow; details: StudioDetailsRow | null; tasks: ProjectTask[]; requests: RequestCounts; company: string | undefined; customer?: { id: string; website: string | null } }): Project {
  const { project, details, tasks, requests } = input;
  // Without Studio details a project counts as running (Studio shows "paused" ones as on hold, the hub has no such status).
  const complete = details?.status === "complete";
  const waiting = tasks.some((task) => task.status !== "done" && task.customer && task.visible);
  const dueOn = details?.due_date ?? null;
  const website = websiteUrl(input.customer?.website);
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
    ...(input.customer ? { customerId: input.customer.id } : {}),
    ...(website ? { website } : {}),
    // Test and live address of the project itself (customer_projects, one source for customer, Studio and Business).
    ...(projectUrl(project.live_url) ? { liveUrl: projectUrl(project.live_url)! } : {}),
    ...(projectUrl(project.test_url) ? { testUrl: projectUrl(project.test_url)! } : {}),
    startedOn: details?.start_date ?? null,
    dueOn,
    milestones: toMilestones(details?.milestones),
    progressBasis: tasks.length ? "tasks" : requests.done + requests.open ? "requests" : "none",
    requests,
    studio: { status: studioStatusOf(project, details), version: details?.version ? Number(details.version) : null },
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
