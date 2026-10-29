/**
 * Read-only tools of the hub assistant (admins only). Claude asks for data, the server answers from what the
 * signed-in admin may see anyway; nothing here writes. Self-contained apart from type imports and the shared search
 * rule, so tests check definitions, validation and answers without a server.
 *
 * Every answer is compact JSON. Texts inside it (names, task titles, descriptions) are data typed in by people,
 * never instructions for the assistant; the system prompt says so too.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { Project, ProjectTask } from "../hub-data";

/** The tables' search rule (`matchesSearch` in lib/table-tools.ts), repeated so this module stays self-contained. */
function matchesSearch(query: string, fields: readonly (string | null | undefined)[]) {
  const fold = (value: string) => value.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replaceAll("ß", "ss");
  const words = fold(query).split(/\s+/).filter(Boolean);
  const haystack = fold(fields.filter(Boolean).join(" "));
  return words.every((word) => haystack.includes(word));
}

export type AssistantCustomer = {
  id: string;
  /** Service organization; Studio projects belong to it. Null for hub-only customers. */
  organizationId: string | null;
  company: string;
  customerNumber: string;
  servicePackages: string[];
  city: string;
  website: string;
  contactEmail: string;
};

/** What the tools read from: the admin's view of customers and Studio projects. */
export type AssistantData = { customers: AssistantCustomer[]; projects: Project[] };

export type ToolOutcome = { ok: true; content: string } | { ok: false; error: string };

/** The page the admin has open, sent by the chat panel; checked against the data before it reaches Claude. */
export type AssistantContext = { section: string; projectId: string | null };

const MAX_HITS = 10;
/** An empty search lists everything, up to this many. */
const MAX_LISTED = 50;
const MAX_TASKS = 60;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const nullableId = { anyOf: [{ type: "string" }, { type: "null" }], description: "UUID aus einem vorherigen Ergebnis, sonst null." };

export const ASSISTANT_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "search",
    description: "Sucht Kunden (Unternehmen, Kundennummer) und Projekte (Projektname, Kunde) im Client Hub. Nutze das zuerst, wenn der Nutzer einen Kunden oder ein Projekt mit Namen nennt; dann höchstens 10 Treffer mit IDs. Bei mehreren passenden Treffern frag nach, welcher gemeint ist, statt zu raten. Ein leerer Suchbegriff listet alle Kunden bzw. Projekte (höchstens 50), etwa für „alle laufenden Projekte“.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Suchbegriff, z. B. „Müller“, „KD-24017“ oder „Website-Relaunch“; leer für alle." },
        kind: { type: "string", enum: ["all", "customer", "project"], description: "Was gesucht wird." },
      },
      required: ["query", "kind"],
      additionalProperties: false,
    },
    strict: true,
    eager_input_streaming: true,
  },
  {
    name: "get_customer",
    description: "Stammdaten eines Kunden (Unternehmen, Kundennummer, Servicepakete, Ort, Website, Kontakt-E-Mail) und seine Projekte mit Status und Fortschritt.",
    input_schema: {
      type: "object",
      properties: { customer_id: { type: "string", description: "ID aus search." } },
      required: ["customer_id"],
      additionalProperties: false,
    },
    strict: true,
    eager_input_streaming: true,
  },
  {
    name: "get_project",
    description: "Ein Projekt mit Kunde, Status, Fortschritt, Start, Zieltermin, Beschreibung, Meilensteinen und allen Aufgaben (Stand, Fälligkeit, ob OALAB oder der Kunde dran ist, ob für den Kunden freigegeben).",
    input_schema: {
      type: "object",
      properties: { project_id: { type: "string", description: "ID aus search, get_customer oder dem geöffneten Projekt." } },
      required: ["project_id"],
      additionalProperties: false,
    },
    strict: true,
    eager_input_streaming: true,
  },
  {
    name: "list_tasks",
    description: "Listet Aufgaben, gefiltert nach Kunde oder Projekt, Stand und Zuständigkeit. Ohne Kunde und Projekt über alle Projekte. Höchstens 60 Aufgaben, früheste Fälligkeit zuerst.",
    input_schema: {
      type: "object",
      properties: {
        customer_id: nullableId,
        project_id: nullableId,
        status: { type: "string", enum: ["open", "done", "all"], description: "open = noch nicht erledigt." },
        owner: { type: "string", enum: ["all", "customer", "oalab"], description: "customer = Aufgaben mit dem Label „Kunde“." },
      },
      required: ["customer_id", "project_id", "status", "owner"],
      additionalProperties: false,
    },
    strict: true,
    eager_input_streaming: true,
  },
];

const statusLabels: Record<ProjectTask["status"], string> = { backlog: "Backlog", todo: "offen", progress: "in Arbeit", review: "in Prüfung", done: "erledigt" };

const taskJson = (task: ProjectTask, project?: Project) => ({
  task_number: task.number,
  title: task.title,
  status: statusLabels[task.status],
  due: task.dueOn,
  owner: task.customer ? "Kunde" : "OALAB",
  released_to_customer: task.visible,
  ...(project ? { project: project.name, project_id: project.id, customer: project.company ?? null } : {}),
});

const progressBases = {
  tasks: "Anteil erledigter Aufgaben",
  requests: "Anteil fertiger Anfragen auf der Serviceplattform, weil im Studio keine Aufgaben angelegt sind (so rechnet auch das Studio)",
  none: "keine Aufgaben und keine Anfragen, daher 0 %",
} as const;

const projectSummary = (project: Project) => ({
  project_id: project.id,
  name: project.name,
  customer: project.company ?? null,
  status: project.status,
  progress_percent: project.progress,
  progress_basis: project.progressBasis ? progressBases[project.progressBasis] : null,
  ...(project.progressBasis === "requests" && project.requests ? { requests_open: project.requests.open, requests_done: project.requests.done } : {}),
  due: project.dueOn,
  open_tasks: (project.tasks ?? []).filter((task) => task.status !== "done").length,
});

const customerOf = (data: AssistantData, project: Project) => data.customers.find((customer) => customer.organizationId && customer.organizationId === project.organizationId);
const projectsOf = (data: AssistantData, customer: AssistantCustomer) => customer.organizationId ? data.projects.filter((project) => project.organizationId === customer.organizationId) : [];

const object = (input: unknown) => input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null;
const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const pick = <T extends string>(value: unknown, options: readonly T[]) => options.find((option) => option === value);
const id = (value: unknown) => typeof value === "string" && uuid.test(value) ? value : null;
const answer = (value: unknown): ToolOutcome => ({ ok: true, content: JSON.stringify(value) });
const refuse = (error: string): ToolOutcome => ({ ok: false, error });

/** Runs one tool call. Inputs are checked again here: the schema is strict, but streamed inputs may arrive incomplete. */
export function runAssistantTool(name: string, input: unknown, data: AssistantData): ToolOutcome {
  const args = object(input);
  if (!args) return refuse("Ungültige Eingabe.");

  if (name === "search") {
    const query = text(args.query, 100);
    const kind = pick(args.kind, ["all", "customer", "project"] as const);
    if (typeof args.query !== "string" || !kind) return refuse("Bitte einen Suchbegriff (leer für alle) und die Art (all, customer, project) angeben.");
    const limit = query ? MAX_HITS : MAX_LISTED;
    const customers = kind === "project" ? [] : data.customers
      .filter((customer) => matchesSearch(query, [customer.company, customer.customerNumber, customer.city]))
      .slice(0, limit)
      .map((customer) => ({ customer_id: customer.id, company: customer.company, customer_number: customer.customerNumber, projects: projectsOf(data, customer).length }));
    const projects = kind === "customer" ? [] : data.projects
      .filter((project) => matchesSearch(query, [project.name, project.company]))
      .slice(0, limit)
      .map(projectSummary);
    return answer({ customers, projects, note: customers.length + projects.length ? undefined : "Keine Treffer. Frag nach der genauen Schreibweise oder der Kundennummer." });
  }

  if (name === "get_customer") {
    const customer = data.customers.find((item) => item.id === id(args.customer_id));
    if (!customer) return refuse("Diesen Kunden gibt es nicht oder er ist nicht sichtbar. Nutze zuerst search.");
    return answer({
      customer_id: customer.id,
      company: customer.company,
      customer_number: customer.customerNumber,
      service_packages: customer.servicePackages,
      city: customer.city || null,
      website: customer.website || null,
      contact_email: customer.contactEmail || null,
      projects: projectsOf(data, customer).map(projectSummary),
      note: customer.organizationId ? undefined : "Reiner Hub-Kunde ohne Service-Organisation: Er kann keine Studio-Projekte haben.",
    });
  }

  if (name === "get_project") {
    const project = data.projects.find((item) => item.id === id(args.project_id));
    if (!project) return refuse("Dieses Projekt gibt es nicht oder es ist nicht sichtbar. Nutze zuerst search.");
    return answer({
      ...projectSummary(project),
      customer_id: customerOf(data, project)?.id ?? null,
      start: project.startedOn,
      studio_status: project.studio?.status ?? null,
      description: project.description || null,
      milestones: project.milestones.map((item) => ({ name: item.title, date: item.at.slice(0, 10) })),
      tasks: (project.tasks ?? []).map((task) => taskJson(task)),
      // Without this the assistant took an empty task list for a broken sync.
      note: project.tasks?.length ? undefined : "Im Studio sind für dieses Projekt keine Aufgaben angelegt. Das ist der echte Stand, kein Fehler bei der Übertragung.",
    });
  }

  if (name === "list_tasks") {
    const status = pick(args.status, ["open", "done", "all"] as const);
    const owner = pick(args.owner, ["all", "customer", "oalab"] as const);
    if (!status || !owner) return refuse("Bitte status (open, done, all) und owner (all, customer, oalab) angeben.");
    const customerId = args.customer_id === null ? null : id(args.customer_id);
    const projectId = args.project_id === null ? null : id(args.project_id);
    if ((args.customer_id !== null && !customerId) || (args.project_id !== null && !projectId)) return refuse("customer_id und project_id müssen IDs aus einem Ergebnis sein oder null.");
    const customer = customerId ? data.customers.find((item) => item.id === customerId) : null;
    if (customerId && !customer) return refuse("Diesen Kunden gibt es nicht oder er ist nicht sichtbar.");
    const projects = data.projects.filter((project) => (!projectId || project.id === projectId) && (!customer || project.organizationId === customer.organizationId));
    if (projectId && !projects.length) return refuse("Dieses Projekt gibt es nicht oder es gehört nicht zu diesem Kunden.");
    const tasks = projects
      .flatMap((project) => (project.tasks ?? []).map((task) => ({ task, project })))
      .filter(({ task }) => (status === "all" || (status === "done") === (task.status === "done")) && (owner === "all" || (owner === "customer") === task.customer))
      .sort((a, b) => (a.task.dueOn ?? "9999").localeCompare(b.task.dueOn ?? "9999") || a.task.number - b.task.number);
    return answer({ total: tasks.length, shown: Math.min(tasks.length, MAX_TASKS), tasks: tasks.slice(0, MAX_TASKS).map(({ task, project }) => taskJson(task, project)) });
  }

  return refuse(`Unbekanntes Werkzeug: ${name.slice(0, 40)}.`);
}

/** One line for the chat while a tool runs, e.g. "Suche „Müller“ …". */
export function toolStatus(name: string, input: unknown, data: AssistantData) {
  const args = object(input) ?? {};
  if (name === "search") return text(args.query, 40) ? `Suche „${text(args.query, 40)}“ …` : "Lese alle Kunden und Projekte …";
  if (name === "get_customer") return `Lese Kunde ${data.customers.find((item) => item.id === args.customer_id)?.company ?? ""} …`.replace("  ", " ");
  if (name === "get_project") return `Lese Projekt ${data.projects.find((item) => item.id === args.project_id)?.name ?? ""} …`.replace("  ", " ");
  if (name === "list_tasks") return "Lese Aufgaben …";
  if (name === "propose_tasks" || name === "propose_project_update" || name === "propose_task_updates" || name === "propose_customer") return "Bereite die Vorschau vor …";
  return "Lese Daten …";
}

/** Reads the panel's context; anything that does not fit is dropped rather than passed on. */
export function readContext(input: unknown): AssistantContext | null {
  const value = object(input);
  if (!value) return null;
  const section = text(value.section, 40);
  if (!/^[a-z-]+$/.test(section)) return null;
  return { section, projectId: id(value.projectId) };
}

/** The page context as one short line for Claude; only an open project the admin may see is named. */
export function describeContext(context: AssistantContext | null, data: AssistantData) {
  if (!context) return null;
  const project = context.projectId ? data.projects.find((item) => item.id === context.projectId) : undefined;
  return project
    ? `Der Nutzer hat gerade das Projekt „${project.name}“${project.company ? ` von ${project.company}` : ""} geöffnet (project_id ${project.id}). „Dieses Projekt“ meint dieses.`
    : `Der Nutzer ist gerade im Bereich „${context.section}“ und hat kein Projekt geöffnet.`;
}
