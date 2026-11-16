/**
 * What admins type into a project's panel (Projekte V2 step 2, user 16.11.2026): name, description, start and target
 * day, milestones, live and test domain. Self-contained (type imports only) so tests check it directly; the same rules
 * run in the browser, to say at once what is wrong, and in the server actions, which trust nothing the browser sends.
 * The limits are Studio's own (studio_workspace migration and its contracts), so whatever the hub saves Studio accepts.
 */
import type { Project } from "../hub-data";

export const MAX_NAME = 160;
export const MAX_DESCRIPTION = 20000;
export const MAX_MILESTONES = 40;

/** One milestone row while it is typed; `id` only keeps the row in place on screen. */
export type MilestoneDraft = { id: string; name: string; date: string };
/** The panel's fields as typed; an empty day or address means none. */
export type ProjectDraft = { name: string; description: string; startDate: string; dueDate: string; liveUrl: string; testUrl: string; milestones: MilestoneDraft[] };
/** The same fields as Studio stores them. */
export type ProjectFields = { name: string; description: string; startDate: string | null; dueDate: string | null; liveUrl: string | null; testUrl: string | null; milestones: { name: string; date: string }[] };
/** A change for the server: the fields that differ, and whether the customer sees the project. */
export type ProjectPatch = Partial<ProjectFields> & { clientVisible?: boolean };
export type PatchKey = keyof ProjectPatch;

type Read<T> = { ok: true; value: T } | { ok: false; error: string };
export type DraftResult = { ok: true; value: ProjectFields } | { ok: false; field: keyof ProjectDraft; error: string };

/** The names of the fields, for the log and the messages. */
export const fieldLabels: Record<PatchKey, string> = {
  name: "Name",
  description: "Beschreibung",
  startDate: "Start",
  dueDate: "Zieltermin",
  milestones: "Meilensteine",
  liveUrl: "Live-Domain",
  testUrl: "Testdomain",
  clientVisible: "Sichtbarkeit",
};
const patchKeys = Object.keys(fieldLabels) as PatchKey[];

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

/** A real calendar day as YYYY-MM-DD. */
export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

/**
 * An address typed into the panel ("abc.de", " https://abc.de/ ") as it is stored: https, no spaces, at most 2048
 * characters; empty clears. Returns an error text for anything else.
 */
export function readProjectUrl(value: unknown): Read<string | null> {
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

function readName(value: unknown): Read<string> {
  const name = typeof value === "string" ? oneLine(value) : "";
  if (!name) return { ok: false, error: "Bitte gib dem Projekt einen Namen." };
  if (name.length > MAX_NAME) return { ok: false, error: `Der Name darf höchstens ${MAX_NAME} Zeichen haben.` };
  return { ok: true, value: name };
}

function readDescription(value: unknown): Read<string> {
  if (typeof value !== "string") return { ok: false, error: "Die Beschreibung ist ungültig." };
  const text = value.trim();
  if (text.length > MAX_DESCRIPTION) return { ok: false, error: `Die Beschreibung darf höchstens ${MAX_DESCRIPTION.toLocaleString("de-DE")} Zeichen haben.` };
  return { ok: true, value: text };
}

function readDay(value: unknown, label: string): Read<string | null> {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  return isDay(value) ? { ok: true, value } : { ok: false, error: `Bitte beim ${label} ein gültiges Datum eintragen.` };
}

const dayOrder = (start: string | null, due: string | null): Read<null> => start && due && start > due
  ? { ok: false, error: "Der Zieltermin liegt vor dem Start." }
  : { ok: true, value: null };

/** Rows without name and day are left out; a row with only one of them is a mistake. Sorted by day, like Studio. */
function readMilestones(value: unknown): Read<{ name: string; date: string }[]> {
  if (!Array.isArray(value)) return { ok: false, error: "Die Meilensteine sind ungültig." };
  const items: { name: string; date: string }[] = [];
  for (const row of value) {
    const name = typeof row?.name === "string" ? oneLine(row.name) : "";
    const date = typeof row?.date === "string" ? row.date.trim() : "";
    if (!name && !date) continue;
    if (!name || !date) return { ok: false, error: "Jeder Meilenstein braucht ein Datum und einen Namen." };
    if (name.length > MAX_NAME) return { ok: false, error: `Ein Meilenstein darf höchstens ${MAX_NAME} Zeichen haben.` };
    if (!isDay(date)) return { ok: false, error: "Bitte bei jedem Meilenstein ein gültiges Datum eintragen." };
    items.push({ name, date });
  }
  if (items.length > MAX_MILESTONES) return { ok: false, error: `Höchstens ${MAX_MILESTONES} Meilensteine je Projekt.` };
  return { ok: true, value: items.map((item, index) => ({ item, index })).sort((a, b) => a.item.date.localeCompare(b.item.date) || a.index - b.index).map(({ item }) => item) };
}

const prefixed = (label: string, read: Read<string | null>): Read<string | null> => read.ok ? read : { ok: false, error: `${label}: ${read.error}` };

/** The whole panel, as typed, in Studio's form; the first mistake names its field. */
export function readProjectDraft(input: unknown): DraftResult {
  const draft = (input && typeof input === "object" ? input : {}) as Partial<Record<keyof ProjectDraft, unknown>>;
  const name = readName(draft.name);
  if (!name.ok) return { ok: false, field: "name", error: name.error };
  const description = readDescription(draft.description ?? "");
  if (!description.ok) return { ok: false, field: "description", error: description.error };
  const startDate = readDay(draft.startDate, "Start");
  if (!startDate.ok) return { ok: false, field: "startDate", error: startDate.error };
  const dueDate = readDay(draft.dueDate, "Zieltermin");
  if (!dueDate.ok) return { ok: false, field: "dueDate", error: dueDate.error };
  const order = dayOrder(startDate.value, dueDate.value);
  if (!order.ok) return { ok: false, field: "dueDate", error: order.error };
  const milestones = readMilestones(draft.milestones ?? []);
  if (!milestones.ok) return { ok: false, field: "milestones", error: milestones.error };
  const liveUrl = prefixed("Live-Domain", readProjectUrl(draft.liveUrl));
  if (!liveUrl.ok) return { ok: false, field: "liveUrl", error: liveUrl.error };
  const testUrl = prefixed("Testdomain", readProjectUrl(draft.testUrl));
  if (!testUrl.ok) return { ok: false, field: "testUrl", error: testUrl.error };
  return { ok: true, value: { name: name.value, description: description.value, startDate: startDate.value, dueDate: dueDate.value, liveUrl: liveUrl.value, testUrl: testUrl.value, milestones: milestones.value } };
}

/** A change as the server receives it: only known fields, at least one, each checked like the panel checks it. */
export function readProjectPatch(input: unknown): Read<ProjectPatch> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Diese Änderung ist ungültig." };
  const entries = Object.entries(input as Record<string, unknown>);
  if (!entries.length || entries.some(([key]) => !(patchKeys as string[]).includes(key))) return { ok: false, error: "Diese Änderung ist ungültig." };
  const raw = input as Partial<Record<PatchKey, unknown>>;
  const patch: ProjectPatch = {};
  const take = <K extends PatchKey>(key: K, read: Read<ProjectPatch[K]>): string | null => {
    if (!(key in raw)) return null;
    if (!read.ok) return read.error;
    patch[key] = read.value;
    return null;
  };
  const error = take("name", readName(raw.name))
    ?? take("description", readDescription(raw.description))
    ?? take("startDate", readDay(raw.startDate, "Start"))
    ?? take("dueDate", readDay(raw.dueDate, "Zieltermin"))
    ?? take("milestones", readMilestones(raw.milestones))
    ?? take("liveUrl", prefixed("Live-Domain", readProjectUrl(raw.liveUrl)))
    ?? take("testUrl", prefixed("Testdomain", readProjectUrl(raw.testUrl)))
    ?? take("clientVisible", typeof raw.clientVisible === "boolean" ? { ok: true, value: raw.clientVisible } : { ok: false, error: "Diese Änderung ist ungültig." });
  if (error) return { ok: false, error };
  if ("startDate" in patch && "dueDate" in patch) {
    const order = dayOrder(patch.startDate ?? null, patch.dueDate ?? null);
    if (!order.ok) return order;
  }
  return { ok: true, value: patch };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What differs between the stored fields and the typed ones, as a patch. Start and target day travel together, so the
 * server can check their order without reading the project first.
 */
export function changesOf(base: ProjectFields, next: ProjectFields): Partial<ProjectFields> {
  const patch: Partial<ProjectFields> = {};
  for (const key of ["name", "description", "liveUrl", "testUrl", "milestones"] as const) {
    if (!same(base[key], next[key])) Object.assign(patch, { [key]: next[key] });
  }
  if (base.startDate !== next.startDate || base.dueDate !== next.dueDate) Object.assign(patch, { startDate: next.startDate, dueDate: next.dueDate });
  return patch;
}

/** „Name, Zieltermin und Meilensteine“: the changed fields in words, in the panel's order. */
export function changedWords(keys: readonly PatchKey[]): string {
  const words = patchKeys.filter((key) => keys.includes(key)).map((key) => fieldLabels[key]);
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} und ${words.at(-1)}` : words[0] ?? "";
}

/** The panel's fields of a project. */
export function draftOf(project: Pick<Project, "name" | "description" | "startedOn" | "dueOn" | "liveUrl" | "testUrl" | "milestones">): ProjectDraft {
  return {
    name: project.name,
    description: project.description ?? "",
    startDate: project.startedOn ?? "",
    dueDate: project.dueOn ?? "",
    liveUrl: project.liveUrl ?? "",
    testUrl: project.testUrl ?? "",
    milestones: project.milestones.map((milestone, index) => ({ id: `m${index}`, name: milestone.title, date: milestone.at.slice(0, 10) })),
  };
}

/** „Neues Projekt“ starts today, as in Studio, without target day, milestones or addresses. */
export const blankDraft = (today: string): ProjectDraft => ({ name: "", description: "", startDate: today, dueDate: "", liveUrl: "", testUrl: "", milestones: [] });

/** The draft as it would be saved, to tell whether anything changed (spaces and empty milestone rows do not count). */
const canonical = (draft: ProjectDraft) => JSON.stringify([
  oneLine(draft.name), draft.description.trim(), draft.startDate, draft.dueDate, draft.liveUrl.trim(), draft.testUrl.trim(),
  draft.milestones.filter((row) => row.name.trim() || row.date).map((row) => [oneLine(row.name), row.date]),
]);
export const sameDraft = (a: ProjectDraft, b: ProjectDraft) => canonical(a) === canonical(b);

const fieldValue = (draft: ProjectDraft, key: keyof ProjectDraft) => key === "milestones"
  ? JSON.stringify(draft.milestones.map((row) => [row.name, row.date]))
  : draft[key];

/**
 * Newer data from the server while the panel is open: the fields the admin has not touched follow it, the ones being
 * typed stay as they are.
 */
export function mergeDraft(draft: ProjectDraft, base: ProjectDraft, next: ProjectDraft): ProjectDraft {
  const merged = { ...draft };
  for (const key of Object.keys(next) as (keyof ProjectDraft)[]) {
    if (fieldValue(draft, key) === fieldValue(base, key)) Object.assign(merged, { [key]: next[key] });
  }
  return merged;
}

/**
 * Project key from the name, exactly as Studio makes it (lower case, starts with a letter, 2–64 characters):
 * „Website Relaunch 2027“ → `website-relaunch-2027`. A key the customer already has gets a counter.
 */
export function projectKeyFrom(name: string, taken: readonly string[]): string {
  const base = name
    .toLocaleLowerCase("de")
    .replace(/ä/gu, "ae")
    .replace(/ö/gu, "oe")
    .replace(/ü/gu, "ue")
    .replace(/ß/gu, "ss")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^[^a-z]+/u, "")
    .replace(/-+$/u, "")
    .slice(0, 48) || "projekt";
  const padded = base.length < 2 ? `${base}-projekt` : base;
  let key = padded;
  for (let counter = 2; taken.includes(key); counter++) key = `${padded}-${counter}`;
  return key;
}
