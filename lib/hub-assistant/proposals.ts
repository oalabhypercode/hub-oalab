/**
 * Proposals of the hub assistant: Claude may only *propose* new tasks; the admin reviews them in the chat and saves.
 * This module checks a proposal against the data the admin sees and applies the admin's choices from the preview.
 * Self-contained apart from type imports, so tests check it without a server.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { AssistantData } from "./tools";

/** Hub limit per proposal; one meeting rarely yields more. */
export const MAX_PROPOSED_TASKS = 20;
const MAX_TITLE = 240;
const MAX_DESCRIPTION = 2000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = /^\d{4}-\d{2}-\d{2}$/;

export type ProposedTask = {
  title: string;
  description: string;
  /** The customer has to do it (label "Kunde"); otherwise OALAB. */
  customer: boolean;
  /** Released to the customer (client_visible). */
  visible: boolean;
  dueOn: string | null;
  /** An open task with the same title already exists in the project. */
  duplicate: boolean;
};

export type TaskProposal = { projectId: string; organizationId: string; projectName: string; customer: string | null; tasks: ProposedTask[] };

/** What the chat shows: the stored proposal plus its id and how long it stays valid. */
export type ProposalView = TaskProposal & { id: string; expiresAt: string };

/** The admin's choice per proposed task in the preview: only switches, never new text. */
export type TaskChoice = { include: boolean; customer: boolean; visible: boolean };

export const PROPOSE_TASKS_TOOL: Anthropic.Beta.BetaTool = {
  name: "propose_tasks",
  description: "Schlägt 1 bis 20 neue Aufgaben für genau ein Projekt vor. Dabei wird nichts gespeichert: Der Nutzer sieht im Chat eine Vorschau, kann Aufgaben abwählen oder umstellen und speichert selbst. Nutze es, wenn der Nutzer Aufgaben anlegen möchte. Kurze, klare Titel. due nur, wenn der Nutzer ein Datum nennt, sonst null. owner customer nur, wenn der Kunde selbst etwas tun muss. visible_to_customer nur true, wenn der Nutzer das ausdrücklich will.",
  input_schema: {
    type: "object",
    properties: {
      project_id: { type: "string", description: "ID aus search, get_customer oder dem geöffneten Projekt." },
      tasks: {
        type: "array",
        description: "Die vorgeschlagenen Aufgaben, höchstens 20.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Kurzer Titel, höchstens 240 Zeichen." },
            description: { type: "string", description: "Optionale Details, sonst leer." },
            owner: { type: "string", enum: ["oalab", "customer"], description: "Wer die Aufgabe erledigt." },
            visible_to_customer: { type: "boolean", description: "Für den Kunden freigeben; im Zweifel false." },
            due: { anyOf: [{ type: "string", format: "date" }, { type: "null" }], description: "Fälligkeit YYYY-MM-DD, nur wenn genannt." },
          },
          required: ["title", "description", "owner", "visible_to_customer", "due"],
          additionalProperties: false,
        },
      },
    },
    required: ["project_id", "tasks"],
    additionalProperties: false,
  },
  strict: true,
  eager_input_streaming: true,
};

/** Lower case without accents and extra spaces, so "Startseite prüfen" equals "startseite  pruefen"-ish titles. */
export const foldTitle = (text: string) => text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replaceAll("ß", "ss").replace(/\s+/g, " ").trim();

const isDay = (value: unknown): value is string => typeof value === "string" && day.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/** Checks a propose_tasks call. Unknown projects, empty or oversized titles and bad dates are refused, not repaired. */
export function prepareTaskProposal(input: unknown, data: AssistantData): { ok: true; proposal: TaskProposal } | { ok: false; error: string } {
  const args = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null;
  if (!args) return { ok: false, error: "Ungültige Eingabe." };
  const projectId = typeof args.project_id === "string" && uuid.test(args.project_id) ? args.project_id : null;
  const project = projectId ? data.projects.find((item) => item.id === projectId) : undefined;
  if (!project || !project.organizationId) return { ok: false, error: "Dieses Projekt gibt es nicht oder es ist nicht sichtbar. Nutze zuerst search." };
  if (project.status === "Abgeschlossen") return { ok: false, error: "Das Projekt ist abgeschlossen. Frag nach, ob die Aufgaben trotzdem dort hinsollen." };
  if (!Array.isArray(args.tasks) || !args.tasks.length) return { ok: false, error: "Bitte mindestens eine Aufgabe vorschlagen." };
  if (args.tasks.length > MAX_PROPOSED_TASKS) return { ok: false, error: `Höchstens ${MAX_PROPOSED_TASKS} Aufgaben auf einmal; teile den Vorschlag auf.` };

  const existing = new Set((project.tasks ?? []).filter((task) => task.status !== "done").map((task) => foldTitle(task.title)));
  const seen = new Set<string>();
  const tasks: ProposedTask[] = [];
  for (const [index, raw] of args.tasks.entries()) {
    const task = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const title = typeof task.title === "string" ? task.title.replace(/\s+/g, " ").trim() : "";
    const description = typeof task.description === "string" ? task.description.trim() : "";
    if (!title || title.length > MAX_TITLE) return { ok: false, error: `Aufgabe ${index + 1}: Der Titel fehlt oder ist länger als ${MAX_TITLE} Zeichen.` };
    if (description.length > MAX_DESCRIPTION) return { ok: false, error: `Aufgabe ${index + 1}: Die Beschreibung ist länger als ${MAX_DESCRIPTION} Zeichen.` };
    if (task.owner !== "oalab" && task.owner !== "customer") return { ok: false, error: `Aufgabe ${index + 1}: owner muss oalab oder customer sein.` };
    if (task.due !== null && !isDay(task.due)) return { ok: false, error: `Aufgabe ${index + 1}: due muss ein Datum JJJJ-MM-TT oder null sein.` };
    const key = foldTitle(title);
    tasks.push({
      title,
      description,
      customer: task.owner === "customer",
      visible: task.visible_to_customer === true,
      dueOn: task.due as string | null,
      duplicate: existing.has(key) || seen.has(key),
    });
    seen.add(key);
  }
  return { ok: true, proposal: { projectId: project.id, organizationId: project.organizationId, projectName: project.name, customer: project.company ?? null, tasks } };
}

/** The tasks to save: the stored proposal with the admin's switches applied. Anything that does not fit is refused. */
export function applyChoices(tasks: readonly ProposedTask[], choices: unknown): { ok: true; tasks: ProposedTask[] } | { ok: false; error: string } {
  if (!Array.isArray(choices) || choices.length !== tasks.length) return { ok: false, error: "Die Auswahl passt nicht zum Vorschlag. Bitte den Chat neu laden." };
  const chosen: ProposedTask[] = [];
  for (const [index, raw] of choices.entries()) {
    const choice = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
    if (!choice || typeof choice.include !== "boolean" || typeof choice.customer !== "boolean" || typeof choice.visible !== "boolean") {
      return { ok: false, error: "Die Auswahl passt nicht zum Vorschlag. Bitte den Chat neu laden." };
    }
    if (choice.include) chosen.push({ ...tasks[index], customer: choice.customer, visible: choice.visible });
  }
  if (!chosen.length) return { ok: false, error: "Keine Aufgabe ausgewählt. Zum Verwerfen „Verwerfen“ nutzen." };
  return { ok: true, tasks: chosen };
}

/** What Claude learns about a proposal in later turns: only the outcome the server reported, never a guess. */
export function proposalNote(view: Pick<ProposalView, "projectName" | "tasks">, outcome: "open" | "saved" | "discarded" | "failed", saved?: number) {
  const count = view.tasks.length;
  const what = `${count === 1 ? "eine Aufgabe" : `${count} Aufgaben`} für „${view.projectName}“`;
  if (outcome === "saved") return `[Vermerk des Hubs: Vorschlag (${what}) wurde vom Nutzer gespeichert, ${saved === 1 ? "eine Aufgabe" : `${saved} Aufgaben`} angelegt.]`;
  if (outcome === "discarded") return `[Vermerk des Hubs: Vorschlag (${what}) wurde vom Nutzer verworfen, nichts gespeichert.]`;
  if (outcome === "failed") return `[Vermerk des Hubs: Speichern des Vorschlags (${what}) ist fehlgeschlagen, nichts gespeichert.]`;
  return `[Vermerk des Hubs: Vorschlag (${what}) liegt in der Vorschau, noch nicht gespeichert.]`;
}
