/**
 * Notes as Markdown, for the Claude connector (lib/hub-mcp/notes.ts): a page's document (Tiptap JSON, checked by
 * lib/hub-notes/rules.ts) becomes Markdown that Claude reads, and Markdown that Claude writes becomes a document the
 * hub's editor opens. The hub's own blocks keep their place as links with the scheme `oalab:` on a line of their own
 * (subpages, task boxes, live task lists, projects, appointments; a task inside a sentence is a mention), a link card is
 * a link titled „Linkkarte“, a picture `![Unterschrift](oalab:image/<id>)` (27.11.2026), a callout a quote, a toggle
 * <details>. What Markdown cannot say (column types and widths of tables, what a link card or a link's hover shows, a
 * picture's place and size) comes back from the page as it was; a picture the page did not have falls away, since
 * pictures go up only in the hub. Self-contained (lib/hub-notes/rules.ts and type imports only), so tests check it directly.
 */
import { cleanIcon, isIsoDate, isSafeHref, isTaskFilter, TASK_FILTERS } from "./rules";
import type { NoteDoc, NoteMark, NoteNode } from "./types";

/** The title of a link that makes it a link card. */
export const CARD_TITLE = "Linkkarte";

/** What a picture without a caption is called in Markdown. */
export const IMAGE_LABEL = "Bild";

/** The id of a picture in the text, from its place in storage (`notes/<customer>/images/<id>.webp`). */
const imageIdOf = (path: unknown) => (typeof path === "string" ? /\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.webp$/i.exec(path)?.[1]?.toLowerCase() ?? null : null);

/** What the reader shows of the hub's own blocks: titles and states, read with the viewer's rights beforehand. */
export type MarkdownLabels = {
  /** Titles of the customer's pages the viewer sees, by id. */
  pages?: Record<string, string>;
  /** Tasks by id; null: the viewer does not see it (any more). `status` is the column's name. */
  tasks?: Record<string, { number: number; title: string; status: string } | null>;
  projects?: Record<string, { name: string; status?: string } | null>;
  /** `when` as the hub writes it, e.g. „Mo, 24.11.2026, 10:00–11:00“. */
  appointments?: Record<string, { title: string; when: string; status: string } | null>;
};

// ---- Reading: document → Markdown ----------------------------------------------------------------------------------

/** The page as Markdown; empty paragraphs fall away. */
export function noteToMarkdown(doc: NoteDoc | null | undefined, labels: MarkdownLabels = {}): string {
  return blocksMd(doc?.content ?? [], labels).join("\n\n").trim();
}

const LISTS = new Set(["bulletList", "orderedList", "taskList"]);

function blocksMd(nodes: readonly NoteNode[], labels: MarkdownLabels): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    const block = blockMd(node, labels);
    if (block) out.push(block);
  }
  return out;
}

function refIdOf(node: NoteNode) {
  const id = node.attrs?.refId;
  return typeof id === "string" ? id.toLowerCase() : null;
}
const label = (text: string) => escapeText(text.replace(/\s+/g, " ").trim());

function blockMd(node: NoteNode, labels: MarkdownLabels): string {
  switch (node.type) {
    case "paragraph":
      return paragraphText(node.content, labels);
    case "heading": {
      const raw = node.attrs?.level;
      const level = raw === 1 || raw === 3 ? raw : 2;
      const text = inlineMd(node.content, labels).replace(/\n+/g, " ").trim();
      return `${"#".repeat(level)}${text ? ` ${text}` : ""}`;
    }
    case "bulletList":
    case "orderedList":
    case "taskList":
      return listMd(node, labels);
    case "codeBlock":
      return codeMd(node);
    case "horizontalRule":
      return "---";
    case "table":
      return tableMd(node, labels);
    case "details":
      return detailsMd(node, labels);
    case "noteCallout":
      return calloutMd(node, labels);
    case "noteSubpage": {
      const id = refIdOf(node);
      return id ? `[Unterseite: ${label(labels.pages?.[id] ?? "nicht sichtbar")}](oalab:page/${id})` : "";
    }
    case "noteTaskGroup":
      return (node.content ?? []).map((item) => taskMd(item, labels, false)).filter(Boolean).join("\n");
    case "noteTaskItem":
      return taskMd(node, labels, false);
    case "noteTaskList": {
      const id = refIdOf(node);
      if (!id) return "";
      const rawFilter = node.attrs?.filter;
      const rawDue = node.attrs?.dueBy;
      const filter = isTaskFilter(rawFilter) ? rawFilter : "open";
      const due = filter === "due" && isIsoDate(rawDue) ? rawDue : null;
      const name = labels.projects?.[id]?.name ?? "Projekt nicht sichtbar";
      const shown = TASK_FILTERS.find((item) => item.id === filter)?.label ?? "Offen";
      return `[Aufgabenliste: ${label(`${name} · ${shown}${due ? ` ${due}` : ""}`)}](oalab:tasklist/${id}?filter=${filter}${due ? `&due=${due}` : ""})`;
    }
    case "noteProject": {
      const id = refIdOf(node);
      if (!id) return "";
      const project = labels.projects?.[id];
      return `[Projekt: ${label(project ? `${project.name}${project.status ? ` · ${project.status}` : ""}` : "nicht sichtbar")}](oalab:project/${id})`;
    }
    case "noteAppointment": {
      const id = refIdOf(node);
      if (!id) return "";
      const item = labels.appointments?.[id];
      return `[Termin: ${label(item ? `${item.title} · ${item.when} · ${item.status}` : "nicht sichtbar")}](oalab:appointment/${id})`;
    }
    case "noteLinkCard": {
      const href = node.attrs?.href;
      if (typeof href !== "string" || !isSafeHref(href)) return "";
      const title = [node.attrs?.title, node.attrs?.site].find((value): value is string => typeof value === "string" && Boolean(value.trim())) ?? href;
      return `[${label(title)}](${hrefMd(href)} "${CARD_TITLE}")`;
    }
    case "noteImage": {
      const id = imageIdOf(node.attrs?.image);
      if (!id) return "";
      const caption = typeof node.attrs?.caption === "string" ? label(node.attrs.caption) : "";
      return `![${caption || IMAGE_LABEL}](oalab:image/${id})`;
    }
    default:
      return lineStarts(escapeText(plainText(node)));
  }
}

function taskMd(node: NoteNode, labels: MarkdownLabels, inline: boolean) {
  const id = refIdOf(node);
  if (!id) return "";
  const task = labels.tasks?.[id];
  const stored = node.attrs?.number;
  const number = task?.number ?? (typeof stored === "number" ? stored : null);
  const text = task ? `#${task.number} ${task.title}${inline ? "" : ` · ${task.status}`}` : `Aufgabe${number ? ` #${number}` : ""} (nicht sichtbar)`;
  return `[${label(text)}](oalab:task/${id})`;
}

/** A line holding nothing but one task would come back as a task box: a mention there says so with `?mention`. */
const LONE_TASK = /^\[(?:\\.|[^\\\]])*\]\(oalab:task\/[0-9a-f-]{36}\)$/;

function paragraphText(nodes: readonly NoteNode[] | undefined, labels: MarkdownLabels) {
  return lineStarts(inlineMd(nodes, labels))
    .split("\n")
    .map((line) => (LONE_TASK.test(line) ? `${line.slice(0, -1)}?mention)` : line))
    .join("\n");
}

function listMd(node: NoteNode, labels: MarkdownLabels): string {
  const lines: string[] = [];
  const ordered = node.type === "orderedList";
  const start = node.attrs?.start;
  let number = ordered && typeof start === "number" ? start : 1;
  for (const item of node.content ?? []) {
    const marker = node.type === "taskList" ? `- [${item.attrs?.checked === true ? "x" : " "}]` : ordered ? `${number++}.` : "-";
    const pad = " ".repeat(node.type === "taskList" ? 2 : marker.length + 1);
    const content = item.content ?? [];
    const first = content[0]?.type === "paragraph" ? content[0] : null;
    const [head, ...more] = (first ? paragraphText(first.content, labels) : "").split("\n");
    lines.push(head ? `${marker} ${head}` : marker);
    for (const line of more) lines.push(line ? pad + line : "");
    for (const block of first ? content.slice(1) : content) {
      const text = blockMd(block, labels);
      if (!text) continue;
      // A second paragraph needs a blank line; a nested list follows directly.
      if (!LISTS.has(block.type)) lines.push("");
      for (const line of text.split("\n")) lines.push(line ? pad + line : "");
    }
  }
  return lines.join("\n");
}

function codeMd(node: NoteNode): string {
  const text = (node.content ?? []).map((child) => child.text ?? "").join("");
  const fence = "`".repeat(Math.max(3, ...(text.match(/`+/g) ?? []).map((run) => run.length + 1)));
  const raw = node.attrs?.language;
  const language = typeof raw === "string" ? raw.replace(/[^\w+#.-]/g, "") : "";
  return `${fence}${language}\n${text}\n${fence}`;
}

function tableMd(node: NoteNode, labels: MarkdownLabels): string {
  const rows = (node.content ?? []).map((row) => (row.content ?? []).map((cell) => cellMd(cell, labels)));
  if (!rows.length) return "";
  const width = Math.max(1, ...rows.map((row) => row.length));
  const line = (row: string[]) => `| ${Array.from({ length: width }, (_, index) => row[index] ?? "").join(" | ")} |`;
  return [line(rows[0]), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n");
}

function cellMd(cell: NoteNode, labels: MarkdownLabels): string {
  return (cell.content ?? [])
    .map((block) => (block.type === "paragraph" ? inlineMd(block.content, labels) : escapeText(plainText(block))))
    .join("<br>")
    .replace(/\n/g, "<br>")
    .replace(/\|/g, "\\|")
    .trim();
}

function detailsMd(node: NoteNode, labels: MarkdownLabels): string {
  const summary = (node.content ?? []).find((child) => child.type === "detailsSummary");
  const body = (node.content ?? []).find((child) => child.type === "detailsContent");
  const title = escapeText(summary ? plainText(summary) : "").replace(/\n+/g, " ").trim();
  const inner = blocksMd(body?.content ?? [], labels).join("\n\n");
  return [`<details${node.attrs?.open === true ? " open" : ""}>`, `<summary>${title}</summary>`, ...(inner ? ["", inner, ""] : []), "</details>"].join("\n");
}

function calloutMd(node: NoteNode, labels: MarkdownLabels): string {
  const raw = node.attrs?.emoji;
  const emoji = typeof raw === "string" ? raw : "";
  const paragraphs = (node.content ?? []).map((child) => paragraphText(child.content, labels));
  if (!paragraphs.length) paragraphs.push("");
  if (emoji) paragraphs[0] = paragraphs[0] ? `${emoji} ${paragraphs[0]}` : emoji;
  return paragraphs.map((text) => text.split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n")).join("\n>\n");
}

/** The text of a node and everything in it, without formatting. */
export function plainText(node: NoteNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  const char = node.attrs?.char;
  if (node.type === "noteEmoji") return typeof char === "string" ? char : "";
  const number = node.attrs?.number;
  if ((node.type === "noteTaskMention" || node.type === "noteTaskItem") && typeof number === "number") return `#${number}`;
  return (node.content ?? []).map(plainText).join(node.type === "tableRow" ? " " : "");
}

// Inline: the marks of neighbouring texts open once and close once, the longest-running outermost.

const DELIMS: Record<string, readonly [string, string]> = { bold: ["**", "**"], strike: ["~~", "~~"], underline: ["<u>", "</u>"] };
const FORMATS = new Set(["bold", "italic", "strike", "underline"]);
const MARK_ORDER = ["link", "bold", "italic", "strike", "underline"];
type Segment = { text: string; marks: NoteMark[] } | { raw: string };

const sameMark = (a: NoteMark, b: NoteMark) => a.type === b.type && (a.type !== "link" || a.attrs?.href === b.attrs?.href);
const marksOf = (segment: Segment | undefined) => (segment && "text" in segment ? segment.marks : []);
/** An address with brackets goes in <…>, so it comes back exactly as it was. */
const hrefMd = (href: string) => (/[()\s]/.test(href) ? `<${href}>` : href);

function inlineMd(nodes: readonly NoteNode[] | undefined, labels: MarkdownLabels): string {
  const segments: Segment[] = [];
  for (const node of nodes ?? []) {
    if (node.type === "text" && typeof node.text === "string") {
      const marks = node.marks ?? [];
      // Code takes no other formatting in the editor.
      if (marks.some((mark) => mark.type === "code")) segments.push({ raw: codeSpan(node.text) });
      // An address shown as itself stays a bare address.
      else if (marks.length === 1 && marks[0].type === "link" && marks[0].attrs?.href === node.text && /^https:\/\/[^\s<>()]+$/.test(node.text)) segments.push({ raw: `<${node.text}>` });
      else segments.push({ text: node.text, marks: marks.filter((mark) => (mark.type === "link" ? isSafeHref(mark.attrs?.href) : FORMATS.has(mark.type))) });
    } else if (node.type === "hardBreak") segments.push({ raw: "\n" });
    else if (node.type === "noteTaskMention") segments.push({ raw: taskMd(node, labels, true) });
    else segments.push({ text: plainText(node), marks: [] });
  }
  return emit(expel(segments));
}

/** Spaces at the edge of a formatted text go outside its delimiters (`**a **b` is no bold in Markdown). */
function expel(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  segments.forEach((segment, index) => {
    if (!("text" in segment) || !segment.marks.length) { out.push(segment); return; }
    const lead = /^\s+/.exec(segment.text)?.[0] ?? "";
    const trail = segment.text.length > lead.length ? /\s+$/.exec(segment.text)?.[0] ?? "" : "";
    const core = segment.text.slice(lead.length, segment.text.length - trail.length);
    const shared = (other: Segment | undefined) => segment.marks.filter((mark) => marksOf(other).some((item) => sameMark(mark, item)));
    if (lead) out.push({ text: lead, marks: shared(segments[index - 1]) });
    if (core) out.push({ text: core, marks: segment.marks });
    if (trail) out.push({ text: trail, marks: shared(segments[index + 1]) });
  });
  return out;
}

function emit(segments: Segment[]): string {
  let out = "";
  let stack: { mark: NoteMark; close: string }[] = [];
  const runLength = (from: number, mark: NoteMark) => {
    let count = 0;
    while (from + count < segments.length && marksOf(segments[from + count]).some((item) => sameMark(item, mark))) count++;
    return count;
  };
  const firstChar = (segment: Segment | undefined) => (!segment ? "" : "text" in segment ? escapeText(segment.text)[0] ?? "" : segment.raw[0] ?? "");
  segments.forEach((segment, index) => {
    const marks = marksOf(segment);
    let keep = 0;
    while (keep < stack.length && marks.some((mark) => sameMark(mark, stack[keep].mark))) keep++;
    for (let level = stack.length - 1; level >= keep; level--) out += stack[level].close;
    stack = stack.slice(0, keep);
    const opening = marks
      .filter((mark) => !stack.some((open) => sameMark(open.mark, mark)))
      .sort((a, b) => runLength(index, b) - runLength(index, a) || MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
    for (const mark of opening) {
      let open: string;
      let close: string;
      if (mark.type === "link") { open = "["; close = `](${hrefMd(String(mark.attrs?.href ?? ""))})`; }
      else if (mark.type === "italic") {
        // `_` inside words is no emphasis: there it is `*`.
        const star = isWord(out[out.length - 1]) || isWord(firstChar(segments[index + runLength(index, mark)]));
        open = close = star ? "*" : "_";
      } else [open, close] = DELIMS[mark.type];
      out += open;
      stack.push({ mark, close });
    }
    out += "text" in segment ? escapeText(segment.text) : segment.raw;
  });
  for (let level = stack.length - 1; level >= 0; level--) out += stack[level].close;
  return out;
}

function codeSpan(text: string) {
  const value = text.replace(/\n/g, " ");
  const ticks = "`".repeat(Math.max(1, ...(value.match(/`+/g) ?? []).map((run) => run.length + 1)));
  const pad = value.startsWith("`") || value.endsWith("`") || /^ .*[^ ].* $/.test(value) ? " " : "";
  return `${ticks}${pad}${value}${pad}${ticks}`;
}

const isWord = (char: string | undefined) => Boolean(char) && /[\p{L}\p{N}]/u.test(char as string);

/** Text that stays text: every character Markdown would read as formatting gets a backslash. */
function escapeText(text: string): string {
  const chars = [...text];
  let out = "";
  chars.forEach((char, index) => {
    if ("\\*`[]<".includes(char)) out += `\\${char}`;
    else if (char === "_" && !(isWord(chars[index - 1]) && isWord(chars[index + 1]))) out += "\\_";
    else if (char === "~" && (chars[index + 1] === "~" || chars[index - 1] === "~")) out += "\\~";
    else out += char;
  });
  return out;
}

/** A line of text never starts a block: headings, quotes, lists, rules and tables get a backslash. */
function lineStarts(text: string): string {
  return text
    .split("\n")
    .map((line) => line
      .replace(/^(\s*)(#{1,6})(?=\s|$)/, "$1\\$2")
      .replace(/^(\s*)([>|+-])/, "$1\\$2")
      .replace(/^(\s*)(\d{1,9})([.)])(?=\s|$)/, "$1$2\\$3"))
    .join("\n");
}

// ---- Writing: Markdown → document ----------------------------------------------------------------------------------

export type MarkdownOptions = {
  /** The page as it was: what Markdown cannot say (table columns, link cards, hover texts, task numbers) comes back from it. */
  before?: NoteDoc | null;
  /** A task by project and number (`oalab:task/<project>/<number>`), looked up by the server beforehand. */
  task?: (projectId: string, number: number) => { id: string; number: number } | null;
  /** The hub's address: pages, projects and appointments named inside a sentence become links into the hub. */
  origin?: string;
};

export type ParsedNote = { ok: true; doc: NoteDoc } | { ok: false; error: string };

type Context = MarkdownOptions & { error: string | null; depth: number; carry: Carry };

export const MAX_MARKDOWN = 400_000;
const MAX_BLOCK_DEPTH = 20;
/** How far an emphasis or a link label may reach: longer is no formatting, and long texts stay quick. */
const SCAN = 4000;

/** Markdown as a document the editor opens; refuses what cannot become one (an unknown task, too long). */
export function markdownToNote(markdown: string, options: MarkdownOptions = {}): ParsedNote {
  if (typeof markdown !== "string") return { ok: false, error: "Der Inhalt muss Markdown-Text sein." };
  if (markdown.length > MAX_MARKDOWN) return { ok: false, error: "Der Inhalt ist zu lang. Teile ihn auf mehrere Seiten auf." };
  const context: Context = { ...options, error: null, depth: 0, carry: carryFrom(options.before) };
  const lines = markdown
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/^\t+/, (tabs) => "    ".repeat(tabs.length)));
  const content = parseBlocks(lines, context);
  if (context.error) return { ok: false, error: context.error };
  const doc: NoteDoc = { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
  applyCarry(doc, context.carry);
  return { ok: true, doc };
}

/** The tasks a text names by project and number (`oalab:task/<project>/<number>`), for the server to look up. */
export function taskNumbersIn(markdown: string): { projectId: string; number: number }[] {
  const found = new Map<string, { projectId: string; number: number }>();
  for (const match of markdown.matchAll(/oalab:task\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(\d{1,9})/gi)) {
    const projectId = match[1].toLowerCase();
    const number = Number(match[2]);
    found.set(`${projectId}/${number}`, { projectId, number });
  }
  return [...found.values()];
}

/** A page with more blocks at its end or its start (the empty lines at the end of the page fall away first). */
export function addToNote(before: NoteDoc, addition: NoteDoc, at: "end" | "start"): NoteDoc {
  const current = [...(before.content ?? [])];
  while (current.length && isEmptyParagraph(current[current.length - 1])) current.pop();
  const added = (addition.content ?? []).filter((node, _index, all) => !(isEmptyParagraph(node) && all.length === 1));
  const content = at === "start" ? [...added, ...current] : [...current, ...added];
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

const isEmptyParagraph = (node: NoteNode | undefined) => node?.type === "paragraph" && !(node.content ?? []).length;

const FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*([^`\s]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/;
const DETAILS = /^ {0,3}<details(\s+open)?\s*>(.*)$/i;
const DETAILS_END = /^(.*?)<\/details>\s*$/i;
const DELIMITER_ROW = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const CELL_BREAK = /(?<!\\)<br\s*\/?>/i;
const EMOJI_START = new RegExp(`^(\\p{Extended_Pictographic}(?:${String.fromCharCode(0xfe0f)}|${String.fromCharCode(0x200d)}\\p{Extended_Pictographic}|\\p{Emoji_Modifier})*)(?:\\s+|$)`, "u");

const hasPipe = (line: string) => /(^|[^\\])\|/.test(line);
const isTableStart = (lines: string[], index: number) => hasPipe(lines[index]) && index + 1 < lines.length && DELIMITER_ROW.test(lines[index + 1]) && lines[index + 1].includes("|");

function startsBlock(lines: string[], index: number) {
  const line = lines[index];
  return FENCE.test(line) || DETAILS.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line) || isTableStart(lines, index);
}

function parseBlocks(lines: string[], context: Context): NoteNode[] {
  const out: NoteNode[] = [];
  if (context.depth > MAX_BLOCK_DEPTH) {
    const text = lines.join("\n").trim();
    return text ? [{ type: "paragraph", content: [{ type: "text", text }] }] : [];
  }
  context.depth++;
  let index = 0;
  while (index < lines.length && !context.error) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    let match: RegExpExecArray | null;
    if ((match = FENCE.exec(line))) index = parseFence(lines, index, match, out);
    else if ((match = DETAILS.exec(line))) index = parseDetails(lines, index, match, out, context);
    else if ((match = HEADING.exec(line))) {
      const content = parseInline((match[2] ?? "").trim(), [], context);
      out.push({ type: "heading", attrs: { level: Math.min(3, match[1].length) }, ...(content.length ? { content } : {}) });
      index++;
    } else if (RULE.test(line)) { out.push({ type: "horizontalRule" }); index++; }
    else if (QUOTE.test(line)) index = parseQuote(lines, index, out, context);
    else if (ITEM.test(line)) index = parseList(lines, index, out, context);
    else if (isTableStart(lines, index)) index = parseTable(lines, index, out, context);
    else index = parseParagraph(lines, index, out, context);
  }
  context.depth--;
  return out;
}

function parseFence(lines: string[], start: number, match: RegExpExecArray, out: NoteNode[]): number {
  const indent = new RegExp(`^ {0,${match[1].length}}`);
  const fence = match[2];
  const language = /^[\w+#.-]{1,40}$/.test(match[3]) ? match[3] : "";
  const body: string[] = [];
  let index = start + 1;
  while (index < lines.length) {
    const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[index]);
    if (close && close[1][0] === fence[0] && close[1].length >= fence.length) { index++; break; }
    body.push(lines[index].replace(indent, ""));
    index++;
  }
  const text = body.join("\n");
  out.push({ type: "codeBlock", ...(language ? { attrs: { language } } : {}), ...(text ? { content: [{ type: "text", text }] } : {}) });
  return index;
}

function parseDetails(lines: string[], start: number, match: RegExpExecArray, out: NoteNode[], context: Context): number {
  const inner: string[] = [];
  let index = start + 1;
  const sameLine = DETAILS_END.exec(match[2] ?? "");
  if (sameLine) inner.push(sameLine[1]);
  else {
    if (match[2]?.trim()) inner.push(match[2].trim());
    let depth = 1;
    for (; index < lines.length; index++) {
      if (DETAILS.test(lines[index])) depth++;
      const closing = DETAILS_END.exec(lines[index]);
      if (closing && --depth === 0) {
        if (closing[1].trim()) inner.push(closing[1]);
        index++;
        break;
      }
      inner.push(lines[index]);
    }
  }
  let summary = "";
  const first = inner.findIndex((line) => line.trim());
  const head = first >= 0 ? /^\s*<summary>(.*?)<\/summary>(.*)$/i.exec(inner[first]) : null;
  if (head) {
    summary = plainText({ type: "paragraph", content: parseInline(head[1].trim(), [], context) }).replace(/\s+/g, " ").trim();
    inner.splice(first, 1, ...(head[2].trim() ? [head[2].trim()] : []));
  }
  const blocks = parseBlocks(inner, context);
  out.push({
    type: "details",
    ...(match[1] ? { attrs: { open: true } } : {}),
    content: [
      { type: "detailsSummary", ...(summary ? { content: [{ type: "text", text: summary }] } : {}) },
      { type: "detailsContent", content: blocks.length ? blocks : [{ type: "paragraph" }] },
    ],
  });
  return index;
}

function parseQuote(lines: string[], start: number, out: NoteNode[], context: Context): number {
  const body: string[] = [];
  let index = start;
  for (; index < lines.length; index++) {
    const match = QUOTE.exec(lines[index]);
    if (!match) break;
    body.push(match[1]);
  }
  let emoji = "";
  const first = body.findIndex((line) => line.trim());
  if (first >= 0) {
    const found = EMOJI_START.exec(body[first].trim());
    if (found && cleanIcon(found[1]) === found[1]) {
      emoji = found[1];
      body[first] = body[first].trim().slice(found[0].length);
    }
  }
  const paragraphs: NoteNode[] = [];
  let run: string[] = [];
  const flush = () => { if (run.length) paragraphs.push(paragraphOf(run, context)); run = []; };
  for (const line of body) {
    if (line.trim()) run.push(line);
    else flush();
  }
  flush();
  // A callout holds paragraphs only; one with nothing but its emoji keeps an empty line.
  out.push({ type: "noteCallout", attrs: { emoji }, content: paragraphs.length ? paragraphs : [{ type: "paragraph" }] });
  return index;
}

type ListKind = "bullet" | "ordered" | "task";

function parseList(lines: string[], start: number, out: NoteNode[], context: Context): number {
  const base = (ITEM.exec(lines[start]) as RegExpExecArray)[1].length;
  const sameLevel = (line: string) => {
    const match = ITEM.exec(line);
    return Boolean(match) && !RULE.test(line) && Math.abs((match as RegExpExecArray)[1].length - base) <= 1;
  };
  let current: { kind: ListKind; node: NoteNode & { content: NoteNode[] } } | null = null;
  let index = start;
  while (index < lines.length && sameLevel(lines[index]) && !context.error) {
    const match = ITEM.exec(lines[index]) as RegExpExecArray;
    const marker = match[2];
    const first = match[4] ?? "";
    const spacing = match[3]?.length ?? 0;
    const column = match[1].length + marker.length + (first ? Math.min(Math.max(spacing, 1), 4) : 1);
    const body: string[] = [first];
    let next = index + 1;
    let blank = false;
    while (next < lines.length) {
      const line = lines[next];
      if (!line.trim()) { body.push(""); blank = true; next++; continue; }
      const indent = line.length - line.trimStart().length;
      if (indent >= column) { body.push(line.slice(column)); blank = false; next++; continue; }
      // A line that goes on with the item's text without indentation (lazy continuation).
      if (!blank && !startsBlock(lines, next)) { body.push(line.trim()); next++; continue; }
      break;
    }
    while (body.length > 1 && !body[body.length - 1].trim()) body.pop();

    const ordered = /^\d/.test(marker);
    const task = ordered ? null : /^\[([ xX])\](?:[ \t]+|$)/.exec(body[0]);
    if (task) body[0] = body[0].slice(task[0].length);
    const kind: ListKind = ordered ? "ordered" : task ? "task" : "bullet";
    if (!current || current.kind !== kind) {
      if (current) out.push(current.node);
      const startAt = Math.min(100000, Math.max(1, parseInt(marker, 10) || 1));
      current = { kind, node: kind === "ordered" ? { type: "orderedList", attrs: { start: startAt }, content: [] } : { type: kind === "task" ? "taskList" : "bulletList", content: [] } };
    }
    const blocks = parseBlocks(body, context);
    if (blocks[0]?.type !== "paragraph") blocks.unshift({ type: "paragraph" });
    current.node.content.push(task ? { type: "taskItem", attrs: { checked: task[1] !== " " }, content: blocks } : { type: "listItem", content: blocks });

    index = next;
    let after = index;
    while (after < lines.length && !lines[after].trim()) after++;
    if (after < lines.length && sameLevel(lines[after])) index = after;
    else break;
  }
  if (current) out.push(current.node);
  return index;
}

function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\\" && text[index + 1] === "|") { cell += "\\|"; index++; continue; }
    if (text[index] === "|") { cells.push(cell.trim()); cell = ""; continue; }
    cell += text[index];
  }
  cells.push(cell.trim());
  return cells;
}

function parseTable(lines: string[], start: number, out: NoteNode[], context: Context): number {
  const rows = [splitRow(lines[start])];
  let index = start + 2;
  while (index < lines.length && lines[index].trim() && hasPipe(lines[index]) && !startsBlock(lines, index)) {
    rows.push(splitRow(lines[index]));
    index++;
  }
  const width = rows[0].length;
  const cell = (text: string, header: boolean): NoteNode => {
    const paragraphs = text.split(CELL_BREAK).map((part): NoteNode => {
      const content = parseInline(part.trim(), [], context);
      return content.length ? { type: "paragraph", content } : { type: "paragraph" };
    });
    return { type: header ? "tableHeader" : "tableCell", content: paragraphs.length ? paragraphs : [{ type: "paragraph" }] };
  };
  out.push({
    type: "table",
    content: rows.map((cells, row) => ({ type: "tableRow", content: Array.from({ length: width }, (_, column) => cell(cells[column] ?? "", row === 0)) })),
  });
  return index;
}

function parseParagraph(lines: string[], start: number, out: NoteNode[], context: Context): number {
  const collected: string[] = [];
  let index = start;
  while (index < lines.length && lines[index].trim() && (index === start || !startsBlock(lines, index))) {
    collected.push(lines[index]);
    index++;
  }
  // Lines that are nothing but a link to the hub's own blocks become those blocks; task rows next to each other one box.
  let text: string[] = [];
  let tasks: NoteNode[] = [];
  const flushText = () => { if (text.length) out.push(paragraphOf(text, context)); text = []; };
  const flushTasks = () => { if (tasks.length) out.push({ type: "noteTaskGroup", content: tasks }); tasks = []; };
  for (const line of collected) {
    const block = blockLine(line.trim(), context);
    if (context.error) return index;
    if (block === DROPPED) continue;
    if (block?.type === "noteTaskItem") { flushText(); tasks.push(block); continue; }
    flushTasks();
    if (block) { flushText(); out.push(block); continue; }
    text.push(line);
  }
  flushTasks();
  flushText();
  return index;
}

/** Lines of one paragraph: each new line is a line break, as people mean it. */
function paragraphOf(lines: string[], context: Context): NoteNode {
  const text = lines
    .map((line, index) => {
      const value = line.replace(/^\s+/, "");
      return index < lines.length - 1 ? value.replace(/(?: {2,}|\\)$/, "") : value;
    })
    .join("\n")
    .replace(/\s+$/, "");
  const content = parseInline(text, [], context);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

// The hub's own blocks: `oalab:<kind>/<id>` on a line of its own, or a link titled „Linkkarte“.

type Ref = { kind: "page" | "task" | "tasklist" | "project" | "appointment"; id: string; number?: number; params: URLSearchParams };

function readRef(url: string): Ref | null {
  const match = /^oalab:(page|task|tasklist|project|appointment)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/(\d{1,9}))?(?:\?([^#\s]*))?$/i.exec(url);
  if (!match) return null;
  return { kind: match[1].toLowerCase() as Ref["kind"], id: match[2].toLowerCase(), ...(match[3] ? { number: Number(match[3]) } : {}), params: new URLSearchParams(match[4] ?? "") };
}

/** A line that stood for a picture the page did not have: it falls away instead of becoming text. */
const DROPPED: NoteNode = { type: "dropped" };

/**
 * A picture as `![Unterschrift](oalab:image/<id>)` on a line of its own: only a picture the page already had comes back,
 * with its place and size from the page; the text in brackets is its caption („Bild“ for none).
 */
function imageLine(line: string, context: Context): NoteNode | null {
  const link = readLink(line, 1);
  if (!link || link.end !== line.length) return null;
  const id = /^oalab:image\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(link.url)?.[1]?.toLowerCase();
  if (!id) return null;
  const kept = context.carry.images.get(id);
  if (!kept) return DROPPED;
  const caption = labelText(link.label, context).slice(0, 300);
  const attrs: Record<string, unknown> = { ...kept };
  delete attrs.caption;
  if (caption && caption !== IMAGE_LABEL) attrs.caption = caption;
  return { type: "noteImage", attrs };
}

function blockLine(line: string, context: Context): NoteNode | null {
  if (line.startsWith("![")) return imageLine(line, context);
  if (!line.startsWith("[")) return null;
  const link = readLink(line, 0);
  if (!link || link.end !== line.length) return null;
  if (link.title?.trim().toLowerCase() === CARD_TITLE.toLowerCase() && /^https:/i.test(link.url) && isSafeHref(link.url)) {
    const title = labelText(link.label, context).slice(0, 300);
    let site = "";
    try { site = new URL(link.url).hostname.replace(/^www\./, "").slice(0, 120); } catch { site = ""; }
    return { type: "noteLinkCard", attrs: { href: link.url, ...(title && title !== link.url ? { title } : {}), ...(site ? { site } : {}) } };
  }
  const ref = readRef(link.url);
  if (!ref || (ref.kind === "task" && ref.params.has("mention"))) return null;
  if (ref.kind === "task") return taskNode("noteTaskItem", ref, link.label, context);
  if (ref.kind === "page") return { type: "noteSubpage", attrs: { refKind: "page", refId: ref.id } };
  if (ref.kind === "project") return { type: "noteProject", attrs: { refKind: "project", refId: ref.id } };
  if (ref.kind === "appointment") return { type: "noteAppointment", attrs: { refKind: "appointment", refId: ref.id } };
  const filter = ref.params.get("filter");
  const due = ref.params.get("due");
  return {
    type: "noteTaskList",
    attrs: { refKind: "project", refId: ref.id, filter: isTaskFilter(filter) ? filter : "open", ...(filter === "due" && isIsoDate(due) ? { dueBy: due } : {}) },
  };
}

function taskNode(type: "noteTaskItem" | "noteTaskMention", ref: Ref, text: string, context: Context): NoteNode | null {
  if (ref.number !== undefined) {
    const found = context.task?.(ref.id, ref.number) ?? null;
    if (!found) {
      context.error = `Aufgabe #${ref.number} gibt es im Projekt ${ref.id} nicht, oder sie ist nicht sichtbar. Nimm project_id und task_number aus get_project oder list_tasks.`;
      return null;
    }
    return { type, attrs: { refKind: "task", refId: found.id.toLowerCase(), number: found.number } };
  }
  const given = Number(ref.params.get("nr") ?? /#(\d{1,9})\b/.exec(text)?.[1] ?? NaN);
  const number = Number.isInteger(given) && given > 0 ? given : context.carry.numbers.get(ref.id);
  return { type, attrs: { refKind: "task", refId: ref.id, ...(number ? { number } : {}) } };
}

/** Where a page, a project or an appointment named inside a sentence opens in the hub. */
function hubHref(ref: Ref, origin: string | undefined): string | null {
  if (!origin || !/^https:\/\//.test(origin)) return null;
  if (ref.kind === "page") return `${origin}/dashboard/projects/notes?page=${ref.id}`;
  if (ref.kind === "appointment") return `${origin}/dashboard/projects/calendar?appointment=${ref.id}`;
  return `${origin}/dashboard/projects?project=${ref.id}`;
}

// Inline: escapes, code, links, <u>, **bold**, *italic* or _italic_, ~~strike~~, line breaks and bare https addresses.

const PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;
const linkMark = (href: string): NoteMark => ({ type: "link", attrs: { href, target: "_blank", rel: "noopener noreferrer nofollow" } });
const addMark = (marks: NoteMark[], mark: NoteMark) => (marks.some((item) => sameMark(item, mark)) ? marks : [...marks, mark]);
const sameMarks = (a: NoteMark[] = [], b: NoteMark[] = []) => a.length === b.length && a.every((mark) => b.some((other) => sameMark(mark, other)));

function pushText(out: NoteNode[], text: string, marks: NoteMark[]) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last?.type === "text" && sameMarks(last.marks, marks)) { last.text = (last.text ?? "") + text; return; }
  out.push(marks.length ? { type: "text", text, marks } : { type: "text", text });
}

/** Nodes of a nested part, with texts of the same formatting as their neighbours joined into one. */
function append(out: NoteNode[], nodes: NoteNode[]) {
  for (const node of nodes) {
    if (node.type === "text" && typeof node.text === "string") pushText(out, node.text, node.marks ?? []);
    else out.push(node);
  }
}

function readCode(text: string, at: number): { text: string; end: number } | null {
  let ticks = 0;
  while (text[at + ticks] === "`") ticks++;
  let search = at + ticks;
  const limit = at + SCAN;
  while (search < text.length && search < limit) {
    const found = text.indexOf("`", search);
    if (found < 0 || found > limit) return null;
    let run = 0;
    while (text[found + run] === "`") run++;
    if (run === ticks) {
      let value = text.slice(at + ticks, found).replace(/\n/g, " ");
      if (/^ .*[^ ].* $/.test(value) || /^ [^ ]+ $/.test(value)) value = value.slice(1, -1);
      return { text: value, end: found + run };
    }
    search = found + run;
  }
  return null;
}

type Link = { label: string; url: string; title: string | null; end: number };

/** `[label](url "title")` at `at`, with nested brackets and escapes in the label; null if it is none. */
function readLink(text: string, at: number): Link | null {
  if (text[at] !== "[") return null;
  let depth = 0;
  let close = -1;
  const limit = Math.min(text.length, at + SCAN);
  for (let index = at; index < limit; index++) {
    const char = text[index];
    if (char === "\\") { index++; continue; }
    if (char === "`") { const code = readCode(text, index); if (code) { index = code.end - 1; continue; } }
    if (char === "[") depth++;
    if (char === "]" && --depth === 0) { close = index; break; }
  }
  if (close < 0 || text[close + 1] !== "(") return null;
  let index = close + 2;
  while (text[index] === " ") index++;
  let url = "";
  if (text[index] === "<") {
    const end = text.indexOf(">", index);
    if (end < 0) return null;
    url = text.slice(index + 1, end);
    index = end + 1;
  } else {
    let balance = 0;
    for (; index < text.length; index++) {
      const char = text[index];
      if (char === "\\" && PUNCTUATION.test(text[index + 1] ?? "")) { url += text[index + 1]; index++; continue; }
      if (/\s/.test(char)) break;
      if (char === "(") balance++;
      if (char === ")") { if (!balance) break; balance--; }
      url += char;
    }
  }
  while (text[index] === " ") index++;
  let title: string | null = null;
  const quote = text[index];
  if (quote === "\"" || quote === "'") {
    const end = text.indexOf(quote, index + 1);
    if (end < 0) return null;
    title = text.slice(index + 1, end);
    index = end + 1;
    while (text[index] === " ") index++;
  }
  if (text[index] !== ")") return null;
  return { label: text.slice(at + 1, close), url: url.trim(), title, end: index + 1 };
}

const labelText = (text: string, context: Context) => plainText({ type: "paragraph", content: parseInline(text, [], { ...context, error: null }) }).replace(/\s+/g, " ").trim();

/**
 * Where an emphasis that opened just before `from` closes; -1 if it does not. A pair (`**`, `~~`) closes with the last
 * two of a run (`***a***`), a single (`*`, `_`) skips pairs inside it (`*a **b** c*`) and closes with the last of a
 * longer run (`*a **b***`).
 */
function findClose(text: string, from: number, delimiter: string): number {
  const char = delimiter[0];
  const limit = Math.min(text.length, from + SCAN);
  for (let index = from; index < limit; index++) {
    const current = text[index];
    if (current === "\\") { index++; continue; }
    if (current === "`") { const code = readCode(text, index); if (code) { index = code.end - 1; continue; } }
    if (current === "[") { const link = readLink(text, index); if (link) { index = link.end - 1; continue; } }
    if (current !== char) continue;
    let run = 0;
    while (text[index + run] === char) run++;
    if (delimiter.length === 2) {
      if (run >= 2 && index > from) return index + run - 2;
      index += run - 1;
      continue;
    }
    if (run === 2) { index += 1; continue; }
    const at = index + run - 1;
    const before = text[at - 1];
    if (at > from && before && !/\s/.test(before) && (char !== "_" || !isWord(text[at + 1]))) return at;
    index += run - 1;
  }
  return -1;
}

function parseInline(text: string, marks: NoteMark[], context: Context): NoteNode[] {
  const out: NoteNode[] = [];
  let buffer = "";
  const flush = () => { pushText(out, buffer, marks); buffer = ""; };
  let index = 0;
  while (index < text.length && !context.error) {
    const char = text[index];
    if (char === "\\" && PUNCTUATION.test(text[index + 1] ?? "")) { buffer += text[index + 1]; index += 2; continue; }
    if (char === "\n") { flush(); out.push({ type: "hardBreak" }); index++; continue; }
    if (char === "`") {
      const code = readCode(text, index);
      if (code) { flush(); pushText(out, code.text, [{ type: "code" }]); index = code.end; continue; }
      let run = 0;
      while (text[index + run] === "`") run++;
      buffer += "`".repeat(run);
      index += run;
      continue;
    }
    if (char === "[") {
      const link = readLink(text, index);
      if (link) { flush(); append(out, linkNodes(link, marks, context)); index = link.end; continue; }
    }
    if (char === "<") {
      const rest = text.slice(index, index + 2100);
      const auto = /^<((?:https:\/\/|mailto:)[^\s<>]+)>/i.exec(rest);
      if (auto && isSafeHref(auto[1])) { flush(); pushText(out, auto[1], addMark(marks, linkMark(auto[1]))); index += auto[0].length; continue; }
      const lineBreak = /^<br\s*\/?>/i.exec(rest);
      if (lineBreak) { flush(); out.push({ type: "hardBreak" }); index += lineBreak[0].length; continue; }
      if (/^<u>/i.test(rest)) {
        const close = text.toLowerCase().indexOf("</u>", index + 3);
        if (close > index + 3) { flush(); append(out, parseInline(text.slice(index + 3, close), addMark(marks, { type: "underline" }), context)); index = close + 4; continue; }
      }
    }
    if (char === "*" || char === "_" || (char === "~" && text[index + 1] === "~")) {
      const double = text[index + 1] === char;
      if (double) {
        const close = findClose(text, index + 2, char + char);
        if (close > index + 2) {
          flush();
          append(out, parseInline(text.slice(index + 2, close), addMark(marks, { type: char === "~" ? "strike" : "bold" }), context));
          index = close + 2;
          continue;
        }
      } else if (char !== "~" && text[index + 1] && !/\s/.test(text[index + 1]) && (char !== "_" || !isWord(text[index - 1]))) {
        const close = findClose(text, index + 1, char);
        if (close > index + 1) {
          flush();
          append(out, parseInline(text.slice(index + 1, close), addMark(marks, { type: "italic" }), context));
          index = close + 1;
          continue;
        }
      }
      buffer += double ? char + char : char;
      index += double ? 2 : 1;
      continue;
    }
    if (char === "h" && text.startsWith("https://", index) && (index === 0 || /[\s(]/.test(text[index - 1])) && !marks.some((mark) => mark.type === "link")) {
      let url = /^https:\/\/[^\s<>"]+/.exec(text.slice(index, index + 2100))?.[0] ?? "";
      while (/[.,;:!?'")\]]$/.test(url) && !(url.endsWith(")") && (url.match(/\(/g) ?? []).length >= (url.match(/\)/g) ?? []).length)) url = url.slice(0, -1);
      if (url.length > 8 && isSafeHref(url)) { flush(); pushText(out, url, addMark(marks, linkMark(url))); index += url.length; continue; }
    }
    buffer += char;
    index++;
  }
  flush();
  return out;
}

function linkNodes(link: Link, marks: NoteMark[], context: Context): NoteNode[] {
  const ref = readRef(link.url);
  if (ref) {
    if (ref.kind === "task") {
      const node = taskNode("noteTaskMention", ref, link.label, context);
      return node ? [node] : [];
    }
    const href = hubHref(ref, context.origin);
    const text = labelText(link.label, context) || "Hub";
    return href ? [{ type: "text", text, marks: addMark(marks, linkMark(href)) }] : [{ type: "text", text, ...(marks.length ? { marks } : {}) }];
  }
  if (isSafeHref(link.url)) {
    const inner = parseInline(link.label || link.url, addMark(marks, linkMark(link.url)), context);
    return inner.length ? inner : [{ type: "text", text: link.url, marks: addMark(marks, linkMark(link.url)) }];
  }
  // Addresses the hub does not link (http:, javascript:, …) keep their text only.
  return parseInline(link.label, marks, context);
}

// ---- What Markdown cannot say comes back from the page as it was -----------------------------------------------------

type Carry = {
  links: Map<string, Record<string, unknown>>;
  cards: Map<string, Record<string, unknown>>;
  /** The pictures of the page by id, with their place, size and caption. */
  images: Map<string, Record<string, unknown>>;
  /** Per table (by its header row): the column types, and each cell's width by row and column. */
  tables: Map<string, { types: unknown[]; widths: unknown[][] }>;
  numbers: Map<string, number>;
};

const headerKey = (table: NoteNode) => (table.content?.[0]?.content ?? []).map((cell) => plainText(cell).replace(/\s+/g, " ").trim()).join("\u0001");

function carryFrom(doc: NoteDoc | null | undefined): Carry {
  const carry: Carry = { links: new Map(), cards: new Map(), images: new Map(), tables: new Map(), numbers: new Map() };
  const walk = (node: NoteNode) => {
    for (const mark of node.marks ?? []) {
      const href = mark.attrs?.href;
      if (mark.type === "link" && typeof href === "string" && (mark.attrs?.title || mark.attrs?.description)) carry.links.set(href, { title: mark.attrs?.title, description: mark.attrs?.description });
    }
    const href = node.attrs?.href;
    if (node.type === "noteLinkCard" && typeof href === "string") carry.cards.set(href, { ...node.attrs });
    const imageId = node.type === "noteImage" ? imageIdOf(node.attrs?.image) : null;
    if (imageId) carry.images.set(imageId, { ...node.attrs });
    const refId = node.attrs?.refId;
    const number = node.attrs?.number;
    if ((node.type === "noteTaskItem" || node.type === "noteTaskMention") && typeof refId === "string" && typeof number === "number") carry.numbers.set(refId.toLowerCase(), number);
    if (node.type === "table") {
      const rows = node.content ?? [];
      const types = (rows[0]?.content ?? []).map((cell) => cell.attrs?.colType);
      const widths = rows.map((row) => (row.content ?? []).map((cell) => cell.attrs?.colwidth));
      carry.tables.set(headerKey(node), { types, widths });
    }
    for (const child of node.content ?? []) walk(child);
  };
  if (doc) walk(doc as NoteNode);
  return carry;
}

function applyCarry(doc: NoteDoc, carry: Carry) {
  const walk = (node: NoteNode) => {
    for (const mark of node.marks ?? []) {
      const href = mark.attrs?.href;
      const kept = mark.type === "link" && typeof href === "string" ? carry.links.get(href) : undefined;
      if (kept) mark.attrs = { ...mark.attrs, ...Object.fromEntries(Object.entries(kept).filter(([, value]) => typeof value === "string" && value)) };
    }
    const href = node.attrs?.href;
    if (node.type === "noteLinkCard" && typeof href === "string") {
      const kept = carry.cards.get(href);
      if (kept) node.attrs = { ...kept, href };
    }
    if (node.type === "table") {
      const kept = carry.tables.get(headerKey(node));
      if (kept) {
        (node.content ?? []).forEach((row, rowIndex) => (row.content ?? []).forEach((cell, column) => {
          const attrs: Record<string, unknown> = { ...(cell.attrs ?? {}) };
          if (rowIndex === 0 && typeof kept.types[column] === "string") attrs.colType = kept.types[column];
          const width = kept.widths[rowIndex]?.[column];
          if (Array.isArray(width)) attrs.colwidth = width;
          if (Object.keys(attrs).length) cell.attrs = attrs;
        }));
      }
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc as NoteNode);
}
