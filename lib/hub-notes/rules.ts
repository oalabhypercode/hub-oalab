/**
 * Rules of the notes area, self-contained (type imports only) so tests check them directly: the four levels of
 * „Sichtbar für“ and the subpage rule (as in the database, migration 202611221001 in service-oalab), what a document may
 * contain (JSON only, a fixed list of blocks and marks, links only https: and mailto:, at most 1 MB) and the plain text
 * and references the server reads from it.
 */
import type { NoteAccess, NoteAudience, NoteDoc, NoteMark, NoteNode, NotePageMeta, NoteRights, NoteSettings, NoteViewer, NoteWidth } from "./types";

// ---- Sichtbar für -----------------------------------------------------------------------------------------------

export const NOTE_AUDIENCES: readonly NoteAudience[] = ["team", "both", "customer", "freelancer"];
export const isNoteAudience = (value: unknown): value is NoteAudience => typeof value === "string" && (NOTE_AUDIENCES as readonly string[]).includes(value);

/** The words of the files („Kunde und Freelancer“, „Nur Kunde“, „Nur Freelancer“) and of the board („Nur Team“). */
export const AUDIENCE_LABELS: Record<NoteAudience, string> = { team: "Nur Team", both: "Kunde und Freelancer", customer: "Nur Kunde", freelancer: "Nur Freelancer" };

/**
 * oalab's own pages (the team entry, stage 2 of the plan „oalab als Unternehmen“) know two levels: „Nur Team“ and „Team
 * und Freelancer“, stored as „Nur Freelancer“ (the database allows only these two there; the words are the ones of
 * lib/hub-team/rules.ts TEAM_SIGHT_LABELS).
 */
export const TEAM_NOTE_AUDIENCES: readonly NoteAudience[] = ["team", "freelancer"];
export const TEAM_NOTE_LABELS = { team: "Nur Team", freelancer: "Team und Freelancer" } as const;
/** A level as it applies to oalab's pages: wherever freelancers would see it „Team und Freelancer“, else „Nur Team“. */
export const teamNoteAudience = (audience: NoteAudience): "team" | "freelancer" => audience === "freelancer" || audience === "both" ? "freelancer" : "team";

/** Customers without a freelancer know only two levels: „Nur Team“ and „Kunde“ (stored as „Nur Kunde“); oalab its two. */
export const audienceLabel = (audience: NoteAudience, hasFreelancer = true, team = false) =>
  team ? TEAM_NOTE_LABELS[teamNoteAudience(audience)] : !hasFreelancer && audience === "customer" ? "Kunde" : AUDIENCE_LABELS[audience];

/** The levels to choose from: four with a freelancer, two without, oalab's two at oalab. */
export const audienceChoices = (hasFreelancer: boolean, team = false): NoteAudience[] => team ? [...TEAM_NOTE_AUDIENCES] : hasFreelancer ? ["team", "both", "customer", "freelancer"] : ["team", "customer"];

const reach = (audience: NoteAudience) => ({ customer: audience === "both" || audience === "customer", freelancer: audience === "both" || audience === "freelancer" });

export const audienceFrom = (customer: boolean, freelancer: boolean): NoteAudience => customer && freelancer ? "both" : customer ? "customer" : freelancer ? "freelancer" : "team";

/** A subpage is at most as visible as its parent: „Nur Team“ is narrower than all, „Nur Kunde“ and „Nur Freelancer“ than both. */
export function within(child: NoteAudience, parent: NoteAudience) {
  const a = reach(child);
  const b = reach(parent);
  return (!a.customer || b.customer) && (!a.freelancer || b.freelancer);
}

/** The widest level within both (what a subpage becomes when its parent turns narrower). */
export function meet(a: NoteAudience, b: NoteAudience): NoteAudience {
  const x = reach(a);
  const y = reach(b);
  return audienceFrom(x.customer && y.customer, x.freelancer && y.freelancer);
}

/** Who gains sight by going from one level to another (a release, which the team confirms first). */
export function gains(from: NoteAudience, to: NoteAudience) {
  const before = reach(from);
  const after = reach(to);
  return { customer: after.customer && !before.customer, freelancer: after.freelancer && !before.freelancer };
}

/** A level as it applies to a customer without freelancers: nobody is there to see „Nur Freelancer“. */
export function fitAudience(audience: NoteAudience, hasFreelancer: boolean): NoteAudience {
  if (hasFreelancer) return audience;
  return audience === "both" ? "customer" : audience === "freelancer" ? "team" : audience;
}

/** What the database lets each viewer read (RLS of hub_note_pages). */
export const viewerReads = (viewer: NoteViewer, audience: NoteAudience) => viewer === "admin" || (viewer === "customer" ? reach(audience).customer : reach(audience).freelancer);

// ---- Zugriff: Kein Zugriff · Lesen · Bearbeiten (23.11.2026) ---------------------------------------------------------

export const NOTE_ACCESS: readonly NoteAccess[] = ["none", "read", "edit"];
export const isNoteAccess = (value: unknown): value is NoteAccess => value === "none" || value === "read" || value === "edit";
export const ACCESS_LABELS: Record<NoteAccess, string> = { none: "Kein Zugriff", read: "Lesen", edit: "Bearbeiten" };

/** Rights as the database keeps them: nobody edits a page they do not see (the guard of migration 202611230002). */
export function fitRights(rights: NoteRights): NoteRights {
  const sight = reach(rights.audience);
  return { audience: rights.audience, customerEdits: sight.customer && rights.customerEdits, freelancerEdits: sight.freelancer && rights.freelancerEdits };
}

/** What the customer and the customer's freelancers may do on a page. */
export function accessOf(page: NoteRights): { customer: NoteAccess; freelancer: NoteAccess } {
  const sight = reach(page.audience);
  return {
    customer: !sight.customer ? "none" : page.customerEdits ? "edit" : "read",
    freelancer: !sight.freelancer ? "none" : page.freelancerEdits ? "edit" : "read",
  };
}

/** Level and rights for a choice per side. */
export const rightsFrom = (customer: NoteAccess, freelancer: NoteAccess): NoteRights =>
  ({ audience: audienceFrom(customer !== "none", freelancer !== "none"), customerEdits: customer === "edit", freelancerEdits: freelancer === "edit" });

/** Whether the viewer may change the page's text (the rules of hub_note_pages decide the same). */
export const viewerEdits = (viewer: NoteViewer, page: NoteRights) => {
  if (viewer === "admin") return true;
  const access = accessOf(page);
  return (viewer === "customer" ? access.customer : access.freelancer) === "edit";
};

/** Who gains sight or the right to edit by going from one setting to another (a release, which the team confirms). */
export function gainsRights(from: NoteRights, to: NoteRights) {
  const before = accessOf(from);
  const after = accessOf(to);
  return {
    customer: after.customer !== "none" && before.customer === "none",
    freelancer: after.freelancer !== "none" && before.freelancer === "none",
    customerEdit: after.customer === "edit" && before.customer !== "edit",
    freelancerEdit: after.freelancer === "edit" && before.freelancer !== "edit",
  };
}

/**
 * The level of a new page: a subpage takes its parent's, a freelancer's page is always „Nur Freelancer“, the team's
 * follows the default for all notes (fitted to customers without freelancers).
 */
export function newPageAudience(viewer: NoteViewer, parent: Pick<NotePageMeta, "audience"> | null, settings: Pick<NoteSettings, "defaultAudience">, hasFreelancer: boolean, team = false): NoteAudience {
  if (viewer === "freelancer") return "freelancer";
  if (parent) return team ? teamNoteAudience(parent.audience) : parent.audience;
  // oalab's new pages start with „Nur Team“, whatever the default for customers says.
  return team ? "team" : fitAudience(settings.defaultAudience, hasFreelancer);
}

/**
 * Level and rights of a new page: a subpage takes its parent's, a freelancer writes the pages they add, and a page the
 * team shares with the customer right away lets the customer edit as the default for all notes says.
 */
export function newPageRights(viewer: NoteViewer, parent: NoteRights | null, settings: Pick<NoteSettings, "defaultAudience" | "customerAccess">, hasFreelancer: boolean, team = false): NoteRights {
  if (viewer === "freelancer") return { audience: "freelancer", customerEdits: false, freelancerEdits: true };
  // oalab's pages: „Nur Team“, or below a page its level; nobody of a customer ever edits them.
  if (team) return fitRights({ audience: parent ? teamNoteAudience(parent.audience) : "team", customerEdits: false, freelancerEdits: parent?.freelancerEdits === true });
  if (parent) return fitRights({ audience: parent.audience, customerEdits: parent.customerEdits, freelancerEdits: parent.freelancerEdits });
  return fitRights({ audience: fitAudience(settings.defaultAudience, hasFreelancer), customerEdits: settings.customerAccess === "edit", freelancerEdits: false });
}

/** Somebody outside the team wrote on the page since the viewer last opened it (the team's dot in the list). */
export function hasOutsideNews(page: Pick<NotePageMeta, "outsideEditedAt" | "seenAt">) {
  if (!page.outsideEditedAt || page.seenAt === undefined) return false;
  return page.seenAt === null || Date.parse(page.outsideEditedAt) > Date.parse(page.seenAt);
}

const accessWord = (access: NoteAccess) => access === "edit" ? "Bearbeiten" : "Lesen";

/** The label on top of a page for the team: „Nur Team“, „Kunde: Bearbeiten“, „Kunde und Freelancer: Lesen“, … (oalab: its two levels) */
export function accessLabel(page: NoteRights, hasFreelancer = true, team = false): string {
  if (team) return TEAM_NOTE_LABELS[teamNoteAudience(page.audience)];
  const access = accessOf(page);
  const freelancer = hasFreelancer ? access.freelancer : "none";
  if (access.customer === "none" && freelancer === "none") return "Nur Team";
  if (freelancer === "none") return `Kunde: ${accessWord(access.customer)}`;
  if (access.customer === "none") return `Freelancer: ${accessWord(freelancer)}`;
  if (access.customer === freelancer) return `Kunde und Freelancer: ${accessWord(access.customer)}`;
  return `Kunde: ${accessWord(access.customer)} · Freelancer: ${accessWord(freelancer)}`;
}

/** The sentence under a side's choice in „Zugriff“. */
export function accessSentence(side: "customer" | "freelancer", access: NoteAccess, customer: string): string {
  const who = side === "customer" ? customer : "Die Freelancer des Kunden";
  const plural = side === "freelancer";
  if (access === "none") return `${who} ${plural ? "sehen" : "sieht"} diese Seite nicht.`;
  if (access === "read") return `${who} ${plural ? "lesen" : "liest"} diese Seite, ohne sie zu ändern.`;
  return `${who} ${plural ? "schreiben" : "schreibt"} auf dieser Seite mit; Neues meldet die Glocke dem Team.`;
}

type TreePage = Pick<NotePageMeta, "id" | "parentId" | "audience" | "title" | "position">;

/** Siblings in their order: by position, then by title. */
export function childrenOf<T extends TreePage>(pages: readonly T[], parentId: string | null): T[] {
  return pages.filter((page) => (page.parentId ?? null) === parentId).sort((a, b) => a.position - b.position || a.title.localeCompare(b.title, "de"));
}

/** Every page below one, at any depth. */
export function descendantsOf<T extends TreePage>(pages: readonly T[], id: string): T[] {
  const out: T[] = [];
  const walk = (parentId: string, guard: number) => {
    if (guard > 10) return;
    for (const child of pages.filter((page) => page.parentId === parentId)) { out.push(child); walk(child.id, guard + 1); }
  };
  walk(id, 0);
  return out;
}

/** The page and its parents, top first. Stops at a page that is missing (not visible to the viewer). */
export function pathOf<T extends TreePage>(pages: readonly T[], id: string): T[] {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const chain: T[] = [];
  let current = byId.get(id);
  while (current && chain.length < 10) {
    chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

/** Levels from the top: a top-level page is 1. The database allows five. */
export const depthOf = (pages: readonly TreePage[], id: string) => pathOf(pages, id).length;
export const MAX_DEPTH = 5;

/** The subpages a narrower level takes along, with the level each of them ends up at (as the database does it). */
export function narrowedBelow<T extends TreePage>(pages: readonly T[], id: string, target: NoteAudience): { id: string; title: string; audience: NoteAudience }[] {
  const changes: { id: string; title: string; audience: NoteAudience }[] = [];
  const walk = (parentId: string, parentAudience: NoteAudience, guard: number) => {
    if (guard > 10) return;
    for (const child of pages.filter((page) => page.parentId === parentId)) {
      if (within(child.audience, parentAudience)) { walk(child.id, child.audience, guard + 1); continue; }
      const next = meet(child.audience, parentAudience);
      changes.push({ id: child.id, title: child.title, audience: next });
      walk(child.id, next, guard + 1);
    }
  };
  walk(id, target, 0);
  return changes;
}

/** A place after every sibling. */
export const positionAfter = (siblings: readonly Pick<NotePageMeta, "position">[]) => siblings.reduce((max, page) => Math.max(max, page.position), 0) + 1;

// ---- Page fields ------------------------------------------------------------------------------------------------

export const MAX_TITLE = 200;
/** The database stops at 1 MB of JSON; the hub leaves room for the request around it. */
export const MAX_DOC_BYTES = 1_000_000;
export const MAX_TEXT = 300_000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && uuidPattern.test(value);
export const isIsoDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/** One line, single spaces, 1–200 characters; otherwise null. */
export function cleanNoteTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.replace(/\s+/g, " ").trim();
  return title && title.length <= MAX_TITLE ? title : null;
}

/** An emoji or nothing: no ASCII (no text, no markup), at most 16 characters as the database counts them. */
export function cleanIcon(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const icon = value.trim();
  if (!icon) return "";
  return [...icon].length <= 16 && !/[\x00-\x7f]/.test(icon) ? icon : null;
}

export const isNoteWidth = (value: unknown): value is NoteWidth => value === "normal" || value === "wide";

/** Links only to https: and mailto: (never javascript:, data: or plain http:). */
export function isSafeHref(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048 || /[\s<>"]/.test(value)) return false;
  return /^https:\/\/[^/?#]+/i.test(value) || /^mailto:[^@\s]+@[^@\s]+$/i.test(value);
}

// ---- Documents --------------------------------------------------------------------------------------------------

/** The kind of a table column, shown as a symbol in its head (plan 1.5): plain text, a tick, a status pill or a person. */
export type ColumnType = "text" | "check" | "status" | "person";
export const COLUMN_TYPES: readonly ColumnType[] = ["text", "check", "status", "person"];
export const COLUMN_TYPE_LABELS: Record<ColumnType, string> = { text: "Text", check: "Häkchen", status: "Status", person: "Person" };
export const isColumnType = (value: unknown): value is ColumnType => typeof value === "string" && (COLUMN_TYPES as readonly string[]).includes(value);

/** The hub's tone for a status cell, from its words: done is green, running blue, waiting orange, everything else grey. */
export function statusTone(text: string): "ok" | "info" | "todo" | "off" {
  const value = text.trim().toLowerCase();
  if (!value) return "off";
  if (/(fertig|erledigt|umgesetzt|live|freigegeben|abgenommen|bestätigt|^ok$|^ja$)/.test(value)) return "ok";
  if (/(in arbeit|läuft|in prüfung|prüfung|review|aktiv)/.test(value)) return "info";
  if (/(offen|wartet|geplant|kunde|anfrage|später)/.test(value)) return "todo";
  return "off";
}

/** A tick cell counts as ticked with „ja“, „x“ or a tick mark. */
export const isTicked = (text: string) => /^(ja|x|✓|✔|✅|yes|true|1)$/i.test(text.trim());

/** What a task list block shows: open tasks, those waiting for the customer, due by a day, or assigned to oneself. */
export type TaskFilter = "open" | "customer" | "due" | "mine";
export const TASK_FILTERS: { id: TaskFilter; label: string }[] = [
  { id: "open", label: "Offen" }, { id: "customer", label: "Beim Kunden" }, { id: "due", label: "Fällig bis" }, { id: "mine", label: "Mir zugewiesen" },
];
export const isTaskFilter = (value: unknown): value is TaskFilter => value === "open" || value === "customer" || value === "due" || value === "mine";
const isTaskNumber = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0 && value < 1e9;
/** A link card's image lies in the hub's own storage, under the notes of a customer. */
const isPreviewImage = (value: unknown): value is string => typeof value === "string" && /^notes\/[0-9a-f-]{36}\/links\/[0-9a-f-]{36}\.webp$/.test(value);

/** Which tasks a task list block shows for this viewer. */
export function filterTasks<T extends { status: string; customerTurn: boolean; dueOn: string | null; assignees: { id: string }[] }>(tasks: readonly T[], filter: TaskFilter, viewerId: string, dueBy?: string | null): T[] {
  const open = tasks.filter((task) => task.status !== "done");
  if (filter === "customer") return open.filter((task) => task.customerTurn);
  if (filter === "mine") return open.filter((task) => task.assignees.some((person) => person.id === viewerId));
  if (filter === "due") return open.filter((task) => task.dueOn && (!dueBy || task.dueOn <= dueBy)).sort((a, b) => (a.dueOn ?? "").localeCompare(b.dueOn ?? ""));
  return open;
}

/** The task's „Sichtbar für“ a note suggests (plan 4.2): „Nur Team“ on internal pages, otherwise „+ Freelancer“. */
export const taskAudienceFor = (pageAudience: NoteAudience): "team" | "shared" => pageAudience === "team" ? "team" : "shared";

type AttrCheck = (value: unknown) => unknown;
const keep = <T>(test: (value: unknown) => value is T, fallback: T | null = null): AttrCheck => (value) => test(value) ? value : fallback;
const isShortText = (max: number) => (value: unknown): value is string => typeof value === "string" && value.length <= max;
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 50;
const isWidths = (value: unknown): value is number[] => Array.isArray(value) && value.length <= 50 && value.every((width) => typeof width === "number" && width >= 20 && width <= 2000);
const isEmojiChar = (value: unknown): value is string => typeof value === "string" && cleanIcon(value) === value && value.length > 0;

/**
 * The blocks and inline nodes a page may hold (step 1), with the attributes each may carry. Unknown blocks are refused;
 * unknown attributes are dropped. References carry only refKind and refId (and, for tasks, the number).
 */
const NODES: Record<string, Record<string, AttrCheck>> = {
  doc: {},
  paragraph: {},
  text: {},
  hardBreak: {},
  heading: { level: (value) => value === 1 || value === 2 || value === 3 ? value : 2 },
  bulletList: {},
  orderedList: { start: (value) => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100000 ? value : 1, type: () => null },
  listItem: {},
  taskList: {},
  taskItem: { checked: (value) => value === true },
  codeBlock: { language: keep(isShortText(40)) },
  horizontalRule: {},
  table: {},
  tableRow: {},
  tableHeader: { colspan: (value) => isCount(value) ? value : 1, rowspan: (value) => isCount(value) ? value : 1, colwidth: keep(isWidths), colType: (value) => isColumnType(value) ? value : "text" },
  tableCell: { colspan: (value) => isCount(value) ? value : 1, rowspan: (value) => isCount(value) ? value : 1, colwidth: keep(isWidths) },
  details: { open: (value) => value === true },
  detailsSummary: {},
  detailsContent: {},
  noteCallout: { emoji: (value) => isEmojiChar(value) ? value : "" },
  noteEmoji: { char: keep(isEmojiChar) },
  noteSubpage: { refKind: () => "page", refId: keep(isUuid) },
  // Step 2: tasks of the board (a box of rows, or a mention in the text), a live task list of a project, a project and
  // a link card with what the server read from the page.
  noteTaskGroup: {},
  noteTaskItem: { refKind: () => "task", refId: keep(isUuid), number: keep(isTaskNumber) },
  noteTaskMention: { refKind: () => "task", refId: keep(isUuid), number: keep(isTaskNumber) },
  noteTaskList: { refKind: () => "project", refId: keep(isUuid), filter: (value) => isTaskFilter(value) ? value : "open", dueBy: keep(isIsoDate) },
  noteProject: { refKind: () => "project", refId: keep(isUuid) },
  noteLinkCard: { href: (value) => typeof value === "string" && /^https:/i.test(value) && isSafeHref(value) ? value : null, title: keep(isShortText(300)), description: keep(isShortText(600)), site: keep(isShortText(120)), image: keep(isPreviewImage) },
  // Step 3: an appointment of the calendar; day, time and status come from the calendar with the viewer's rights.
  noteAppointment: { refKind: () => "appointment", refId: keep(isUuid) },
};

const MARKS: Record<string, Record<string, AttrCheck>> = {
  bold: {},
  italic: {},
  underline: {},
  strike: {},
  code: {},
  link: {
    href: (value) => isSafeHref(value) ? value : null,
    target: (value) => value === "_blank" ? value : null,
    rel: (value) => value === "noopener noreferrer nofollow" ? value : null,
    class: () => null,
    // Step 2: what the server read from the page when the link was added, for the card on hover.
    title: keep(isShortText(300)),
    description: keep(isShortText(600)),
  },
};

/** Attributes without which a node makes no sense. */
const REQUIRED: Record<string, string[]> = { noteEmoji: ["char"], noteSubpage: ["refId"], noteTaskItem: ["refId"], noteTaskMention: ["refId"], noteTaskList: ["refId"], noteProject: ["refId"], noteLinkCard: ["href"], noteAppointment: ["refId"] };

export type NoteRef = { kind: "task" | "project" | "appointment" | "file" | "page"; id: string };
const REF_KINDS = new Set(["task", "project", "appointment", "file", "page"]);
const MAX_NODES = 40000;
const MAX_NESTING = 40;

export type ValidDoc = { ok: true; doc: NoteDoc; text: string; refs: NoteRef[] } | { ok: false; error: string };

const refused = (error: string): ValidDoc => ({ ok: false, error });

/**
 * Checks a document before it is written and returns a clean copy: only known blocks and marks, attributes checked one
 * by one, links only https: and mailto:, at most 1 MB. It also returns the plain text for the search and the references
 * (the database reads the same references itself).
 */
export function validateNoteDoc(input: unknown): ValidDoc {
  if (!input || typeof input !== "object" || (input as NoteNode).type !== "doc") return refused("Das Dokument hat ein unbekanntes Format.");
  let count = 0;
  let error: string | null = null;
  const refs = new Map<string, NoteRef>();

  const cleanAttrs = (type: string, spec: Record<string, AttrCheck>, attrs: unknown) => {
    // Attributes that are not an object (the placeholder a Server Action sends for an object without a prototype) are
    // refused, not dropped: a heading would lose its level and a link its address without anybody noticing.
    if (attrs !== undefined && attrs !== null && typeof attrs !== "object") error = "Ein Block im Dokument ist unvollständig.";
    const source = attrs && typeof attrs === "object" ? attrs as Record<string, unknown> : {};
    const out: Record<string, unknown> = {};
    for (const [key, check] of Object.entries(spec)) {
      if (!(key in source)) continue;
      const value = check(source[key]);
      if (value !== null && value !== undefined) out[key] = value;
    }
    for (const key of REQUIRED[type] ?? []) if (!(key in out)) error = "Ein Block im Dokument ist unvollständig.";
    return out;
  };

  const cleanMarks = (marks: unknown): NoteMark[] | undefined => {
    if (!Array.isArray(marks) || !marks.length) return undefined;
    const out: NoteMark[] = [];
    for (const mark of marks.slice(0, 10)) {
      const type = mark && typeof mark === "object" ? (mark as NoteMark).type : undefined;
      const spec = typeof type === "string" ? MARKS[type] : undefined;
      // Unknown formatting and links that are not https: or mailto: fall away; the text stays.
      if (!spec) continue;
      const attrs = cleanAttrs(type!, spec, (mark as NoteMark).attrs);
      if (type === "link" && !attrs.href) continue;
      out.push(Object.keys(attrs).length ? { type: type!, attrs } : { type: type! });
    }
    return out.length ? out : undefined;
  };

  const clean = (node: unknown, depth: number): NoteNode | null => {
    if (error) return null;
    count += 1;
    if (count > MAX_NODES || depth > MAX_NESTING) { error = "Das Dokument ist zu groß oder zu tief verschachtelt."; return null; }
    if (!node || typeof node !== "object") { error = "Das Dokument hat ein unbekanntes Format."; return null; }
    const raw = node as NoteNode;
    const spec = typeof raw.type === "string" ? NODES[raw.type] : undefined;
    if (!spec || (raw.type === "doc" && depth > 0)) { error = "Das Dokument enthält einen unbekannten Block."; return null; }
    if (raw.type === "text") {
      if (typeof raw.text !== "string" || !raw.text) { error = "Das Dokument enthält leeren Text."; return null; }
      const marks = cleanMarks(raw.marks);
      return marks ? { type: "text", text: raw.text, marks } : { type: "text", text: raw.text };
    }
    const out: NoteNode = { type: raw.type };
    const attrs = cleanAttrs(raw.type, spec, raw.attrs);
    if (Object.keys(attrs).length) out.attrs = attrs;
    if (typeof attrs.refId === "string" && typeof attrs.refKind === "string" && REF_KINDS.has(attrs.refKind)) {
      refs.set(`${attrs.refKind}:${attrs.refId}`, { kind: attrs.refKind as NoteRef["kind"], id: attrs.refId.toLowerCase() });
    }
    if (raw.content !== undefined) {
      if (!Array.isArray(raw.content)) { error = "Das Dokument hat ein unbekanntes Format."; return null; }
      const children = raw.content.map((child) => clean(child, depth + 1)).filter((child): child is NoteNode => Boolean(child));
      if (children.length) out.content = children;
    }
    return out;
  };

  const doc = clean(input, 0) as NoteDoc | null;
  if (error || !doc) return refused(error ?? "Das Dokument hat ein unbekanntes Format.");
  if (byteLength(JSON.stringify(doc)) > MAX_DOC_BYTES) return refused("Die Seite ist zu groß (höchstens 1 MB). Teile sie in Unterseiten auf.");
  return { ok: true, doc, text: noteText(doc), refs: [...refs.values()] };
}

const byteLength = (text: string) => new TextEncoder().encode(text).length;

const BLOCKS = new Set(["paragraph", "heading", "listItem", "taskItem", "codeBlock", "tableRow", "detailsSummary", "noteCallout", "noteLinkCard"]);

/** The plain text of a document for the search: blocks on their own lines, cells separated, emojis as characters. */
export function noteText(doc: NoteDoc): string {
  const parts: string[] = [];
  const walk = (node: NoteNode) => {
    if (node.type === "text" && node.text) parts.push(node.text);
    else if (node.type === "noteEmoji" && typeof node.attrs?.char === "string") parts.push(node.attrs.char);
    else if (node.type === "hardBreak") parts.push("\n");
    else if (node.type === "noteLinkCard") parts.push([node.attrs?.title, node.attrs?.description, node.attrs?.href].filter((part) => typeof part === "string" && part).join(" "));
    else if ((node.type === "noteTaskItem" || node.type === "noteTaskMention") && typeof node.attrs?.number === "number") parts.push(`#${node.attrs.number}`);
    else if (node.type === "tableCell" || node.type === "tableHeader") parts.push(" ");
    for (const child of node.content ?? []) walk(child);
    if (BLOCKS.has(node.type)) parts.push("\n");
  };
  walk(doc);
  return parts.join("").split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n").slice(0, MAX_TEXT);
}

/** A page without content: one empty paragraph. */
export const emptyNoteDoc = (): NoteDoc => ({ type: "doc", content: [{ type: "paragraph" }] });

/**
 * The document as plain JSON for a Server Action. ProseMirror keeps the attributes of blocks and marks in objects
 * without a prototype, which Server Actions do not carry: React sends a placeholder instead, and the server never saw
 * a heading's level, a link's address or a card (found live on 22.11.2026).
 */
export function plainDoc<T>(doc: T): T {
  return JSON.parse(JSON.stringify(doc)) as T;
}

/** Whether a document holds anything beyond empty paragraphs (an empty new page offers its templates, step 2). */
export const isEmptyDoc = (doc: NoteDoc) => !(doc.content ?? []).some((node) => node.type !== "paragraph" || (node.content ?? []).length > 0);

// ---- Wording ----------------------------------------------------------------------------------------------------

/** "vor 5 Min.", "vor 3 Std.", "gestern", "vor 4 Tagen", "am 2. Nov."; `now` for tests. */
export function editedAgo(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const minutes = Math.max(0, Math.round((now - then) / 60000));
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.round(hours / 24);
  if (days === 1) return "gestern";
  if (days < 14) return `vor ${days} Tagen`;
  return `am ${new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", timeZone: "Europe/Berlin" }).format(new Date(then))}`;
}

/** „Kunde und Freelancer sehen diese Seite.“ – the sentence under the levels in the gear. */
export function audienceSentence(audience: NoteAudience, customer: string, hasFreelancer: boolean): string {
  const freelancer = "die Freelancer des Kunden";
  switch (audience) {
    case "team": return "Nur das oalab-Team sieht diese Seite.";
    case "both": return `${customer} und ${freelancer} sehen diese Seite.`;
    case "customer": return hasFreelancer ? `${customer} sieht diese Seite, Freelancer nicht.` : `${customer} sieht diese Seite.`;
    case "freelancer": return `Die Freelancer von ${customer} sehen diese Seite, ${customer} nicht.`;
  }
}
