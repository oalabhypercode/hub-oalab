/**
 * Rules of the notes area, self-contained (type imports only) so tests check them directly: the four levels of
 * „Sichtbar für“ and the subpage rule (as in the database, migration 202611221001 in service-oalab), what a document may
 * contain (JSON only, a fixed list of blocks and marks, links only https: and mailto:, at most 1 MB) and the plain text
 * and references the server reads from it.
 */
import type { NoteAudience, NoteDoc, NoteMark, NoteNode, NotePageMeta, NoteSettings, NoteViewer, NoteWidth } from "./types";

// ---- Sichtbar für -----------------------------------------------------------------------------------------------

export const NOTE_AUDIENCES: readonly NoteAudience[] = ["team", "both", "customer", "freelancer"];
export const isNoteAudience = (value: unknown): value is NoteAudience => typeof value === "string" && (NOTE_AUDIENCES as readonly string[]).includes(value);

/** The words of the files („Kunde und Freelancer“, „Nur Kunde“, „Nur Freelancer“) and of the board („Nur Team“). */
export const AUDIENCE_LABELS: Record<NoteAudience, string> = { team: "Nur Team", both: "Kunde und Freelancer", customer: "Nur Kunde", freelancer: "Nur Freelancer" };

/** Customers without a freelancer know only two levels: „Nur Team“ and „Kunde“ (stored as „Nur Kunde“). */
export const audienceLabel = (audience: NoteAudience, hasFreelancer = true) => !hasFreelancer && audience === "customer" ? "Kunde" : AUDIENCE_LABELS[audience];

/** The levels to choose from: four with a freelancer, two without. */
export const audienceChoices = (hasFreelancer: boolean): NoteAudience[] => hasFreelancer ? ["team", "both", "customer", "freelancer"] : ["team", "customer"];

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

/** What the database lets each viewer read and write (RLS of hub_note_pages). */
export const viewerReads = (viewer: NoteViewer, audience: NoteAudience) => viewer === "admin" || (viewer === "customer" ? reach(audience).customer : reach(audience).freelancer);
export const viewerEdits = (viewer: NoteViewer, audience: NoteAudience) => viewer === "admin" || (viewer === "freelancer" && audience === "freelancer");

/**
 * The level of a new page: a subpage takes its parent's, a freelancer's page is always „Nur Freelancer“, the team's
 * follows the default for all notes (fitted to customers without freelancers).
 */
export function newPageAudience(viewer: NoteViewer, parent: Pick<NotePageMeta, "audience"> | null, settings: Pick<NoteSettings, "defaultAudience">, hasFreelancer: boolean): NoteAudience {
  if (viewer === "freelancer") return "freelancer";
  if (parent) return parent.audience;
  return fitAudience(settings.defaultAudience, hasFreelancer);
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
const REQUIRED: Record<string, string[]> = { noteEmoji: ["char"], noteSubpage: ["refId"] };

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

const BLOCKS = new Set(["paragraph", "heading", "listItem", "taskItem", "codeBlock", "tableRow", "detailsSummary", "noteCallout"]);

/** The plain text of a document for the search: blocks on their own lines, cells separated, emojis as characters. */
export function noteText(doc: NoteDoc): string {
  const parts: string[] = [];
  const walk = (node: NoteNode) => {
    if (node.type === "text" && node.text) parts.push(node.text);
    else if (node.type === "noteEmoji" && typeof node.attrs?.char === "string") parts.push(node.attrs.char);
    else if (node.type === "hardBreak") parts.push("\n");
    else if (node.type === "tableCell" || node.type === "tableHeader") parts.push(" ");
    for (const child of node.content ?? []) walk(child);
    if (BLOCKS.has(node.type)) parts.push("\n");
  };
  walk(doc);
  return parts.join("").split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n").slice(0, MAX_TEXT);
}

/** A page without content: one empty paragraph. */
export const emptyNoteDoc = (): NoteDoc => ({ type: "doc", content: [{ type: "paragraph" }] });

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
