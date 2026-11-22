"use client";

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { findParentNode, type Range } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableCell, TableRow } from "@tiptap/extension-table";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { Placeholder } from "@tiptap/extensions";
import { NodeSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Slice } from "@tiptap/pm/model";
import { TableMap } from "@tiptap/pm/tables";
import {
  Bold, ChevronDown, ChevronRight, CheckSquare, Code, Columns3, Copy, ExternalLink, FileText, GripVertical, Heading1, Heading2, Heading3, Italic,
  Lightbulb, Link2, List, ListOrdered, Minus, Pencil, Plus, Rows3, Smile, Strikethrough, Table2, Trash2, Type, Underline, ArrowDown, ArrowUp, Unlink,
  SquareCheck, CircleDot, UserRound, SquareKanban, ListTodo, FolderOpen, IdCard, CalendarDays, CalendarPlus,
} from "lucide-react";
import { isSafeHref, COLUMN_TYPE_LABELS, COLUMN_TYPES, isColumnType, type ColumnType } from "@/lib/hub-notes/rules";
import type { NoteAppointmentView, NoteAudience, NoteDoc, NoteLinkPreview, NotePage, NotePageMeta, NoteProject, NoteTaskView, NoteViewer } from "@/lib/hub-notes/types";
import type { EmojiEntry } from "@/lib/hub-notes/emoji";
import {
  createColonExtension, createSlashExtension, EmojiGlyph, NoteCallout, NoteEditorContext, NoteEmoji, NoteSubpage, NoteTableColumns, NoteTableHeader,
  NoteTypingRules, setSlashItems, type MenuHandle, type MenuProps, type NoteEditorUi, type SlashItem,
} from "./notes-blocks";
import { EmojiPicker } from "./notes-emoji-picker";
import { createHashExtension, NoteAppointment, NoteLinkCard, NoteProject as NoteProjectNode, NoteRefsContext, NoteTaskGroup, NoteTaskItem, NoteTaskList, NoteTaskMention, setTaskSearch, type NoteRefsUi } from "./notes-refs";
import { RefPicker, TaskConvertDialog, type PickerKind, type TaskDraft, type TaskOptions } from "./notes-tasks-ui";
import { AppointmentDialog, AppointmentPicker, ReadSelectionBar, type NoteCalendarUi } from "./notes-calendar-ui";

// The writing area of a note (plan 1.3): Tiptap 3 with the basic blocks of step 1, the block menu on „/“, Markdown
// shortcuts, emojis after „:“, a toolbar over selected text, clean links with a card on hover, tables with column
// kinds, and handles to move blocks. Loaded only on the notes page (next/dynamic), so the rest of the hub stays light.
// Who may only read sees the same page without any of the editing tools.

export type NoteEditorHandle = { focusStart: () => void; insertEmojiAtEnd: (char: string) => void; editor: () => Editor | null; convertOpenItems: () => void; openItemCount: () => number };

type PreviewResult = { ok: true; data: NoteLinkPreview & { imageUrl: string | null } } | { ok: false; error: string };

type Props = {
  page: NotePage;
  editable: boolean;
  pages: NotePageMeta[];
  onChange: (doc: NoteDoc) => void;
  onOpenPage: (id: string) => void;
  onCreateSubpage: () => Promise<NotePageMeta | null>;
  handleRef?: React.Ref<NoteEditorHandle>;
  /** Step 2: what references show, and the ways to add tasks, projects and link cards. */
  refsUi: NoteRefsUi;
  projects: NoteProject[];
  viewer: NoteViewer;
  pageAudience: NoteAudience;
  loadTaskOptions: (projectId: string | null) => Promise<TaskOptions | null>;
  createTasks: (drafts: TaskDraft[]) => Promise<NoteTaskView[]>;
  loadPreview: (url: string) => Promise<PreviewResult>;
  /** Step 3: appointments as blocks, and selected text as an appointment (the team enters it, others ask for one). */
  calendarUi: NoteCalendarUi;
};

/** Puts a block where the caret stands: in place of an empty line, else after the line. */
function insertBlock(editor: Editor, at: number, content: Record<string, unknown>) {
  const $at = editor.state.doc.resolve(Math.min(at, editor.state.doc.content.size));
  const empty = $at.parent.isTextblock && $at.parent.content.size === 0 && $at.depth > 0;
  if (empty) return editor.chain().focus().insertContentAt({ from: $at.before(), to: $at.after() }, content).run();
  const after = $at.depth > 0 ? $at.after(1) : at;
  return editor.chain().focus().insertContentAt(after, content).run();
}

/** A task as a row: into the task box right before the caret's line, or as a new box. */
function insertTaskRow(editor: Editor, at: number, task: NoteTaskView) {
  const item = { type: "noteTaskItem", attrs: { refKind: "task", refId: task.id, number: task.number } };
  const $at = editor.state.doc.resolve(Math.min(at, editor.state.doc.content.size));
  const index = $at.index(0);
  const before = index > 0 ? editor.state.doc.child(index - 1) : null;
  if (before?.type.name === "noteTaskGroup" && $at.parent.content.size === 0) {
    let pos = 0;
    for (let i = 0; i < index - 1; i++) pos += editor.state.doc.child(i).nodeSize;
    return editor.chain().focus().insertContentAt(pos + before.nodeSize - 1, item).run();
  }
  return insertBlock(editor, at, { type: "noteTaskGroup", content: [item] });
}

type Picker = { anchor: DOMRect; heading: string; onPick: (char: string) => void; onRemove?: () => void };

/** Links carry what the server read from the page (title and description, step 2) for the card on hover. */
const NoteLink = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      description: { default: null, parseHTML: (element) => element.getAttribute("data-description"), renderHTML: (attrs) => attrs.description ? { "data-description": attrs.description } : {} },
    };
  },
});

/** Puts the caret's screen position into a rectangle for popups. */
function caretRect(editor: Editor): DOMRect {
  const { from } = editor.state.selection;
  const at = editor.view.coordsAtPos(from);
  return new DOMRect(at.left, at.top, 1, at.bottom - at.top);
}

function SlashMenu({ items, command, query, handleRef }: MenuProps<SlashItem> & { handleRef: React.RefObject<MenuHandle | null> }) {
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  // A new query starts at the first block again.
  const [lastQuery, setLastQuery] = useState(query);
  if (lastQuery !== query) { setLastQuery(query); setActive(0); }
  useImperativeHandle(handleRef, () => ({
    onKeyDown: (event) => {
      if (event.key === "ArrowDown") { setActive((value) => (value + 1) % Math.max(items.length, 1)); return true; }
      if (event.key === "ArrowUp") { setActive((value) => (value - 1 + items.length) % Math.max(items.length, 1)); return true; }
      if (event.key === "Enter") { if (items[active]) command(items[active]); return true; }
      return false;
    },
  }), [items, active, command]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);
  const groups = [...new Set(items.map((item) => item.group))];
  return (
    <div className="nz-menu nz-glass" role="listbox" aria-label="Block einfügen" ref={list} onMouseDown={(event) => event.preventDefault()}>
      {groups.map((group) => (
        <div key={group}>
          <div className="nz-menu-caption">{group}</div>
          {items.map((item, index) => item.group !== group ? null : (
            <button key={item.id} type="button" role="option" aria-selected={index === active} data-index={index} className={`nz-menu-item${index === active ? " is-active" : ""}`} onMouseEnter={() => setActive(index)} onClick={() => command(item)}>
              <span className="nz-menu-icon">{item.icon}</span>
              <span className="nz-menu-text"><strong>{item.label}</strong><span>{item.hint}</span></span>
            </button>
          ))}
        </div>
      ))}
      {!items.length && <p className="nz-menu-empty">Kein Block passt zu „{query}“.</p>}
      <div className="nz-menu-foot">Enter fügt ein · Esc schließt</div>
    </div>
  );
}

function ColonMenu({ items, command, query, handleRef }: MenuProps<EmojiEntry> & { handleRef: React.RefObject<MenuHandle | null> }) {
  const [active, setActive] = useState(0);
  const [lastQuery, setLastQuery] = useState(query);
  if (lastQuery !== query) { setLastQuery(query); setActive(0); }
  useImperativeHandle(handleRef, () => ({
    onKeyDown: (event) => {
      if (!items.length) return false;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") { setActive((value) => (value + 1) % items.length); return true; }
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") { setActive((value) => (value - 1 + items.length) % items.length); return true; }
      if (event.key === "Enter" || event.key === "Tab") { command(items[active]); return true; }
      return false;
    },
  }), [items, active, command]);
  return (
    <div className="nz-colon nz-glass" role="listbox" aria-label="Emoji-Vorschläge" onMouseDown={(event) => event.preventDefault()}>
      {items.map((item, index) => (
        <button key={item.char} type="button" role="option" aria-selected={index === active} className={`nz-colon-item${index === active ? " is-active" : ""}`} onMouseEnter={() => setActive(index)} onClick={() => command(item)}>
          <EmojiGlyph char={item.char} size={20} /><span>:{item.name}</span>
        </button>
      ))}
      {!items.length && <span className="nz-colon-none">Kein Emoji zu „{query}“</span>}
    </div>
  );
}

const domainOf = (href: string) => /^https:\/\/([^/?#]+)/i.exec(href)?.[1]?.replace(/^www\./i, "") ?? href.replace(/^mailto:/i, "");

export default function NoteEditor({ page, editable, pages, onChange, onOpenPage, onCreateSubpage, handleRef, refsUi, projects, viewer, pageAudience, loadTaskOptions, createTasks, loadPreview, calendarUi }: Props) {
  const [picker2, setPicker2] = useState<{ kind: PickerKind; anchor: DOMRect; at: number } | null>(null);
  const [apptPicker, setApptPicker] = useState<{ anchor: DOMRect; at: number } | null>(null);
  /** „Termin anlegen/anfragen“ for a text; `at` is where the block goes afterwards (null on a page one only reads). */
  const [apptDraft, setApptDraft] = useState<{ title: string; at: number | null } | null>(null);
  const [convert, setConvert] = useState<{ titles: string[]; apply: (tasks: NoteTaskView[]) => void } | null>(null);
  const [pasted, setPasted] = useState<{ url: string; from: number; to: number; locate: () => DOMRect | null } | null>(null);
  const previewRef = useRef(loadPreview);
  useEffect(() => { previewRef.current = loadPreview; });
  const [picker, setPicker] = useState<Picker | null>(null);
  const [linkEdit, setLinkEdit] = useState<{ url: string; rect: DOMRect; existing: boolean } | null>(null);
  const [hoverLink, setHoverLink] = useState<{ href: string; title: string; description: string; rect: DOMRect; pos: number } | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const wrap = useRef<HTMLDivElement>(null);
  const changeRef = useRef(onChange);
  const subpageRef = useRef(onCreateSubpage);
  useEffect(() => { changeRef.current = onChange; subpageRef.current = onCreateSubpage; });

  const pickEmoji = useCallback((anchor: DOMRect, heading: string, onPick: (char: string) => void, onRemove?: () => void) => setPicker({ anchor, heading, onPick, onRemove }), []);
  const editorRef = useRef<Editor | null>(null);
  const openLink = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || !editor.isEditable) return;
    const existing = editor.getAttributes("link").href as string | undefined;
    if (editor.state.selection.empty && !existing) return;
    if (existing) editor.chain().extendMarkRange("link").run();
    setLinkEdit({ url: existing ?? "", rect: caretRect(editor), existing: Boolean(existing) });
  }, []);
  const openLinkRef = useRef(openLink);

  /** The blocks of the menu on „/“ (step 1), filtered by what follows the slash. */
  const slashItems = useCallback((query: string): SlashItem[] => {
    const basic = "Grundblöcke";
    const hub = "Aus dem Hub";
    const all: SlashItem[] = [
      { id: "text", group: basic, label: "Text", hint: "Ein Absatz", icon: <Type size={16} />, run: (editor, range) => editor.chain().focus().deleteRange(range).setParagraph().run() },
      { id: "h1", group: basic, label: "Überschrift 1", hint: "Großer Abschnitt", keywords: "titel heading", icon: <Heading1 size={16} />, run: (editor, range) => editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run() },
      { id: "h2", group: basic, label: "Überschrift 2", hint: "Gliedert die Seite", keywords: "heading", icon: <Heading2 size={16} />, run: (editor, range) => editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run() },
      { id: "h3", group: basic, label: "Überschrift 3", hint: "Kleiner Abschnitt", keywords: "heading", icon: <Heading3 size={16} />, run: (editor, range) => editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run() },
      { id: "bullets", group: basic, label: "Aufzählung", hint: "Punkte untereinander", keywords: "liste", icon: <List size={16} />, run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run() },
      { id: "numbers", group: basic, label: "Nummerierung", hint: "1., 2., 3.", keywords: "liste nummer", icon: <ListOrdered size={16} />, run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run() },
      { id: "checks", group: basic, label: "Checkliste", hint: "Zum Abhaken", keywords: "todo aufgaben", icon: <CheckSquare size={16} />, run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run() },
      { id: "table", group: basic, label: "Tabelle", hint: "Zeilen und Spalten", icon: <Table2 size={16} />, run: (editor, range) => editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
      { id: "callout", group: basic, label: "Hinweis", hint: "Hervorgehobener Kasten mit Emoji", keywords: "callout box", icon: <Lightbulb size={16} />, run: (editor, range) => editor.chain().focus().deleteRange(range).setParagraph().wrapIn("noteCallout").run() },
      { id: "toggle", group: basic, label: "Aufklapper", hint: "Inhalt zum Aufklappen", keywords: "toggle details", icon: <ChevronRight size={16} />, run: (editor, range) => editor.chain().focus().deleteRange(range).setDetails().run() },
      { id: "divider", group: basic, label: "Trennlinie", hint: "Teilt Abschnitte", keywords: "linie hr", icon: <Minus size={16} />, run: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run() },
      { id: "code", group: basic, label: "Code", hint: "Quelltext in fester Breite", icon: <Code size={16} />, run: (editor, range) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run() },
      {
        id: "emoji", group: basic, label: "Emoji", hint: "Auch mit „:“ und Name, etwa :rakete", icon: <Smile size={16} />,
        run: (editor, range) => {
          editor.chain().focus().deleteRange(range).run();
          pickEmoji(caretRect(editor), "Emoji einfügen", (char) => editor.chain().focus().insertContent({ type: "noteEmoji", attrs: { char } }).run());
        },
      },
      {
        id: "task", group: hub, label: "Aufgabe", hint: "Aus dem Board, im Text auch mit „#“", keywords: "task board", icon: <SquareKanban size={16} />,
        run: (editor, range) => { editor.chain().focus().deleteRange(range).run(); setPicker2({ kind: "task", anchor: caretRect(editor), at: editor.state.selection.from }); },
      },
      {
        id: "taskList", group: hub, label: "Aufgabenliste", hint: "Die Aufgaben eines Projekts, lebend", keywords: "tasks liste board", icon: <ListTodo size={16} />,
        run: (editor, range) => { editor.chain().focus().deleteRange(range).run(); setPicker2({ kind: "taskList", anchor: caretRect(editor), at: editor.state.selection.from }); },
      },
      {
        id: "project", group: hub, label: "Projekt", hint: "Status, Fortschritt und Ziel", keywords: "projekt status", icon: <FolderOpen size={16} />,
        run: (editor, range) => { editor.chain().focus().deleteRange(range).run(); setPicker2({ kind: "project", anchor: caretRect(editor), at: editor.state.selection.from }); },
      },
      {
        id: "linkCard", group: hub, label: "Linkkarte", hint: "Adresse einfügen, als Karte zeigen", keywords: "link bookmark karte", icon: <Link2 size={16} />,
        run: (editor, range) => { editor.chain().focus().deleteRange(range).run(); setPicker2({ kind: "linkCard", anchor: caretRect(editor), at: editor.state.selection.from }); },
      },
      ...(viewer === "admin" ? [{
        id: "appointment", group: hub, label: "Termin", hint: "Aus dem Kalender, mit Uhrzeit und Stand", keywords: "termin kalender meeting", icon: <CalendarDays size={16} />,
        run: (editor: Editor, range: Range) => { editor.chain().focus().deleteRange(range).run(); setApptPicker({ anchor: caretRect(editor), at: editor.state.selection.from }); },
      }] : []),
      {
        id: "subpage", group: hub, label: "Unterseite", hint: "Neue Seite unter dieser", keywords: "seite page", icon: <FileText size={16} />,
        run: (editor, range) => {
          editor.chain().focus().deleteRange(range).run();
          const at = editor.state.selection.from;
          void subpageRef.current().then((child) => {
            if (!child) return;
            const empty = editor.state.selection.$from.parent.content.size === 0;
            const insert = { type: "noteSubpage", attrs: { refKind: "page", refId: child.id } };
            if (empty) editor.chain().focus().insertContentAt({ from: at - 1, to: at + 1 }, insert).run();
            else editor.chain().focus().insertContentAt(at, insert).run();
          });
        },
      },
    ];
    const term = query.trim().toLowerCase();
    return term ? all.filter((item) => `${item.label} ${item.keywords ?? ""}`.toLowerCase().includes(term)) : all;
  }, [pickEmoji, viewer]);
  useEffect(() => { openLinkRef.current = openLink; });

  const extensions = useMemo(() => [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      blockquote: false,
      link: false,
      dropcursor: { width: 2, class: "nz-dropcursor" },
    }),
    NoteLink.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      defaultProtocol: "https",
      protocols: [],
      isAllowedUri: (url) => isSafeHref(url),
      shouldAutoLink: (url) => isSafeHref(url),
      HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank", class: null },
    }),
    TaskList,
    TaskItem.configure({ nested: true, a11y: { checkboxLabel: (node, checked) => `${checked ? "Erledigt" : "Offen"}: ${node.textContent || "leerer Punkt"}` } }),
    Table.configure({ resizable: true, cellMinWidth: 80, lastColumnResizable: false, HTMLAttributes: { class: "nz-table" } }),
    TableRow,
    NoteTableHeader,
    TableCell,
    NoteTableColumns,
    Details.configure({ persist: true, HTMLAttributes: { class: "nz-details" }, renderToggleButton: ({ element, isOpen }) => element.setAttribute("aria-label", isOpen ? "Zuklappen" : "Aufklappen") }),
    DetailsSummary,
    DetailsContent,
    Placeholder.configure({
      showOnlyCurrent: true,
      includeChildren: true,
      placeholder: ({ node }) => node.type.name === "heading" ? `Überschrift ${node.attrs.level}` : node.type.name === "detailsSummary" ? "Aufklapper" : "Schreib los oder tippe „/“ für Blöcke",
    }),
    NoteEmoji,
    NoteCallout,
    NoteSubpage,
    NoteTypingRules,
    NoteTaskGroup,
    NoteTaskItem,
    NoteTaskMention,
    NoteTaskList,
    NoteProjectNode,
    NoteLinkCard,
    NoteAppointment,
    createHashExtension(),
    createSlashExtension(SlashMenu),
    createColonExtension(ColonMenu),
  ], []);

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions,
    content: page.content,
    editorProps: {
      attributes: { class: "nz-prose", "aria-label": `Text der Seite „${page.title}“` },
      handleKeyDown: (_view, event) => {
        // ⌘K sets a link here; the hub's search keeps ⌘K everywhere else.
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
          event.preventDefault();
          event.stopPropagation();
          openLinkRef.current();
          return true;
        }
        return false;
      },
      // A pasted address on its own: a link in the text at once, and the question „Link im Text oder Linkkarte?“.
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData("text/plain")?.trim() ?? "";
        if (!view.editable || !view.state.selection.empty || !/^https:\/\/\S+$/i.test(text) || !isSafeHref(text)) return false;
        const from = view.state.selection.from;
        const mark = view.state.schema.marks.link.create({ href: text });
        view.dispatch(view.state.tr.insert(from, view.state.schema.text(text, [mark])).scrollIntoView());
        // Where the link stands is read again while the page scrolls (it may still be scrolling to it).
        const locate = () => {
          if (view.isDestroyed || from > view.state.doc.content.size) return null;
          const at = view.coordsAtPos(from);
          return new DOMRect(at.left, at.top, 1, at.bottom - at.top);
        };
        setPasted({ url: text, from, to: from + text.length, locate });
        return true;
      },
      handleClick: (view, _pos, event) => {
        const anchor = (event.target as HTMLElement).closest("a[href]");
        if (!anchor) return false;
        // Reading: a click opens the link. Writing: ⌘/Strg + Klick, a plain click places the caret.
        if (!view.editable || event.metaKey || event.ctrlKey) {
          const href = anchor.getAttribute("href") ?? "";
          if (isSafeHref(href)) window.open(href, "_blank", "noopener,noreferrer");
          return true;
        }
        return false;
      },
    },
    // Only what somebody did saves: a change Tiptap makes on its own (the empty line it keeps at the end, say) has no
    // steps of its own and goes along with the next real change instead of writing when a page merely opens.
    onUpdate: ({ editor: current, transaction }) => { if (transaction.steps.length) changeRef.current(current.getJSON() as NoteDoc); },
  }, [page.id]);

  useEffect(() => { editorRef.current = editor; }, [editor]);
  useEffect(() => { if (editor) setSlashItems(editor, slashItems); }, [editor, slashItems]);
  useEffect(() => { if (editor) setTaskSearch(editor, refsUi.searchTasks); }, [editor, refsUi.searchTasks]);
  useEffect(() => { editor?.setEditable(editable); }, [editor, editable]);

  /** Open points of the checklists on this page: their text and where they stand. */
  const openItems = useCallback(() => {
    const found: { pos: number; text: string }[] = [];
    editor?.state.doc.descendants((node, pos) => {
      if (node.type.name === "taskItem" && !node.attrs.checked && node.textContent.trim()) found.push({ pos, text: node.textContent.trim().slice(0, 240) });
    });
    return found;
  }, [editor]);

  /**
   * Turns checklist lines into task rows once the tasks exist (the lines are found again by their text): the rows of one
   * list go into one box right after it, and a list whose lines all became tasks gives way to its box.
   */
  const replaceItems = useCallback((done: { text: string; task: NoteTaskView }[]) => {
    if (!editor || !done.length) return;
    const { state } = editor;
    type Line = { pos: number; size: number; list: { from: number; to: number; items: number }; task: NoteTaskView };
    const lines: Line[] = [];
    state.doc.descendants((node, pos) => {
      if (node.type.name !== "taskItem") return;
      const text = node.textContent.trim().slice(0, 240);
      const match = done.find((item) => item.text === text && !lines.some((line) => line.task.id === item.task.id));
      if (!match) return;
      const $pos = state.doc.resolve(pos);
      let depth = 1;
      while (depth < $pos.depth && $pos.node(depth).type.name !== "taskList") depth += 1;
      lines.push({ pos, size: node.nodeSize, list: { from: $pos.before(depth), to: $pos.after(depth), items: $pos.node(depth).childCount }, task: match.task });
    });
    if (!lines.length) return;
    const lists = new Map<number, Line[]>();
    for (const line of lines) lists.set(line.list.to, [...(lists.get(line.list.to) ?? []), line]);
    const tr = state.tr;
    for (const [listEnd, rows] of [...lists].sort((a, b) => b[0] - a[0])) {
      const box = state.schema.nodeFromJSON({ type: "noteTaskGroup", content: rows.sort((a, b) => a.pos - b.pos).map((row) => ({ type: "noteTaskItem", attrs: { refKind: "task", refId: row.task.id, number: row.task.number } })) });
      tr.insert(tr.mapping.map(listEnd), box);
      const whole = rows.length >= rows[0].list.items && rows.every((row) => state.doc.resolve(row.pos).depth === state.doc.resolve(rows[0].list.from).depth + 1);
      if (whole) tr.delete(tr.mapping.map(rows[0].list.from), tr.mapping.map(listEnd, -1));
      else for (const row of [...rows].sort((a, b) => b.pos - a.pos)) tr.delete(tr.mapping.map(row.pos), tr.mapping.map(row.pos + row.size, -1));
    }
    editor.view.dispatch(tr);
  }, [editor]);

  useImperativeHandle(handleRef, () => ({
    focusStart: () => editor?.chain().focus("start").run(),
    insertEmojiAtEnd: (char) => editor?.chain().focus("end").insertContent({ type: "noteEmoji", attrs: { char } }).run(),
    editor: () => editor,
    openItemCount: () => openItems().length,
    convertOpenItems: () => {
      const items = openItems();
      if (items.length) setConvert({ titles: items.map((item) => item.text), apply: (tasks) => replaceItems(tasks.map((task) => ({ text: task.title, task }))) });
    },
  }), [editor, openItems, replaceItems]);

  const ui: NoteEditorUi = useMemo(() => ({ pages: new Map(pages.map((item) => [item.id, item])), editable, openPage: onOpenPage, pickEmoji }), [pages, editable, onOpenPage, pickEmoji]);

  // Link card on hover: the address, its site and, once the server read them (step 2), title and description.
  useEffect(() => {
    const dom = editor?.view.dom;
    if (!dom) return;
    const over = (event: MouseEvent) => {
      // Only links in the text (no class, as in app/notes.css): cards, appointments and „Im Board“ bring their own buttons.
      const anchor = (event.target as HTMLElement).closest("a[href]:not([class])");
      if (!anchor || !dom.contains(anchor)) return;
      window.clearTimeout(hoverTimer.current);
      const pos = editor.view.posAtDOM(anchor, 0);
      const mark = editor.state.doc.resolve(Math.min(pos + 1, editor.state.doc.content.size)).marks().find((item) => item.type.name === "link");
      const href = anchor.getAttribute("href") ?? "";
      hoverTimer.current = window.setTimeout(() => setHoverLink({ href, title: String(mark?.attrs.title ?? ""), description: String(mark?.attrs.description ?? ""), rect: anchor.getBoundingClientRect(), pos }), 250);
    };
    const out = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest("a[href]")) return;
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = window.setTimeout(() => setHoverLink(null), 220);
    };
    // A changed text may have taken the link away while the mouse rested on it (no „mouseout“ then): the card goes too.
    const changed = () => { window.clearTimeout(hoverTimer.current); setHoverLink(null); };
    dom.addEventListener("mouseover", over);
    dom.addEventListener("mouseout", out);
    editor.on("update", changed);
    return () => { dom.removeEventListener("mouseover", over); dom.removeEventListener("mouseout", out); editor.off("update", changed); window.clearTimeout(hoverTimer.current); };
  }, [editor]);

  const asTask = (title: string, apply: (task: NoteTaskView) => void) => setConvert({ titles: [title], apply: (tasks) => { if (tasks[0]) apply(tasks[0]); } });

  return (
    <NoteRefsContext.Provider value={refsUi}>
    <NoteEditorContext.Provider value={ui}>
      <div className={`nz-editor${editable ? " is-edit" : " is-read"}`} ref={wrap}>
        {editor && editable && <BlockHandles editor={editor} wrap={wrap} />}
        {editor && editable && refsUi.taskWriter && <CheckLineAction editor={editor} wrap={wrap} onConvert={(pos, text) => asTask(text, (task) => replaceItems([{ text, task: { ...task, title: text } }]))} />}
        <EditorContent editor={editor} />
        {editor && editable && !linkEdit && !picker && !convert && <SelectionToolbar editor={editor} onLink={openLink} onEmoji={() => pickEmoji(caretRect(editor), "Emoji einfügen", (char) => editor.chain().focus().setTextSelection(editor.state.selection.to).insertContent({ type: "noteEmoji", attrs: { char } }).run())}
          onTask={refsUi.taskWriter ? () => {
            const { from, to } = editor.state.selection;
            const text = editor.state.doc.textBetween(from, to, " ").trim().slice(0, 240);
            if (text) asTask(text, (task) => editor.chain().focus().insertContentAt({ from, to }, [{ type: "noteTaskMention", attrs: { refKind: "task", refId: task.id, number: task.number } }, { type: "text", text: " " }]).run());
          } : undefined}
          appointmentLabel={calendarUi.mode === "create" ? "Termin anlegen" : calendarUi.mode === "request" ? "Termin anfragen" : undefined}
          onAppointment={() => {
            const { from, to } = editor.state.selection;
            const text = editor.state.doc.textBetween(from, to, " ").replace(/\s+/g, " ").trim().slice(0, 200);
            if (text) setApptDraft({ title: text, at: to });
          }} />}
        {editor && !editable && calendarUi.mode === "request" && !apptDraft && <ReadSelectionBar host={wrap} onRequest={(text) => setApptDraft({ title: text, at: null })} />}
        {editor && editable && <TableToolbar editor={editor} />}
        {editor && linkEdit && <LinkPopover editor={editor} state={linkEdit} onClose={() => setLinkEdit(null)} onCard={async (href) => {
          const result = await previewRef.current(href);
          if (!result.ok) return result.error;
          const $pos = editor.state.doc.resolve(editor.state.selection.to);
          editor.chain().focus().insertContentAt($pos.depth > 0 ? $pos.after(1) : editor.state.selection.to, { type: "noteLinkCard", attrs: { href: result.data.href, title: result.data.title, description: result.data.description, site: result.data.site, image: result.data.image } }).run();
          if (result.data.image && result.data.imageUrl) refsUi.addImage(result.data.image, result.data.imageUrl);
          return null;
        }} />}
        {editor && pasted && (
          <PasteChoice locate={pasted.locate} url={pasted.url} onClose={() => setPasted(null)} onCard={async () => {
            const result = await previewRef.current(pasted.url);
            if (!result.ok) return result.error;
            if (result.data.image && result.data.imageUrl) refsUi.addImage(result.data.image, result.data.imageUrl);
            editor.chain().focus().insertContentAt({ from: pasted.from, to: pasted.to }, { type: "noteLinkCard", attrs: { href: result.data.href, title: result.data.title, description: result.data.description, site: result.data.site, image: result.data.image } }).run();
            setPasted(null);
            return null;
          }} />
        )}
        {editor && picker2 && (
          <RefPicker
            kind={picker2.kind}
            anchor={picker2.anchor}
            projects={projects}
            searchTasks={refsUi.searchTasks}
            loadPreview={(url) => previewRef.current(url)}
            onClose={() => setPicker2(null)}
            onTask={(task) => { refsUi.addTasks([task]); insertTaskRow(editor, picker2.at, task); setPicker2(null); }}
            onProject={(project) => { insertBlock(editor, picker2.at, { type: picker2.kind === "taskList" ? "noteTaskList" : "noteProject", attrs: { refKind: "project", refId: project.id, ...(picker2.kind === "taskList" ? { filter: "open" } : {}) } }); setPicker2(null); }}
            onLinkCard={(card) => { if (card.image && card.imageUrl) refsUi.addImage(card.image, card.imageUrl); insertBlock(editor, picker2.at, { type: "noteLinkCard", attrs: { href: card.href, title: card.title, description: card.description, site: card.site, image: card.image } }); setPicker2(null); }}
          />
        )}
        {editor && apptPicker && (
          <AppointmentPicker anchor={apptPicker.anchor} load={calendarUi.loadAppointments} onClose={() => setApptPicker(null)}
            onPick={(appointment) => { refsUi.addAppointments([appointment]); insertBlock(editor, apptPicker.at, { type: "noteAppointment", attrs: { refKind: "appointment", refId: appointment.id } }); setApptPicker(null); }} />
        )}
        {editor && apptDraft && (
          <AppointmentDialog ui={calendarUi} title={apptDraft.title} onClose={() => setApptDraft(null)}
            onDone={(appointment: NoteAppointmentView) => {
              refsUi.addAppointments([appointment]);
              const onPage = apptDraft.at !== null && editor.isEditable;
              if (onPage) insertBlock(editor, apptDraft.at!, { type: "noteAppointment", attrs: { refKind: "appointment", refId: appointment.id } });
              calendarUi.notify(appointment, onPage);
              setApptDraft(null);
              window.getSelection()?.removeAllRanges();
            }} />
        )}
        {convert && (
          <TaskConvertDialog
            titles={convert.titles}
            viewer={viewer}
            pageAudience={pageAudience}
            projectId={page.projectId}
            loadOptions={loadTaskOptions}
            onClose={() => setConvert(null)}
            onCreate={async (drafts) => {
              const created = await createTasks(drafts);
              if (created.length) convert.apply(created);
              setConvert(null);
            }}
          />
        )}
        {hoverLink && !linkEdit && (
          <LinkCard
            link={hoverLink}
            editable={editable}
            onEnter={() => window.clearTimeout(hoverTimer.current)}
            onLeave={() => { hoverTimer.current = window.setTimeout(() => setHoverLink(null), 160); }}
            onEdit={() => {
              if (!editor) return;
              editor.chain().focus().setTextSelection(hoverLink.pos + 1).extendMarkRange("link").run();
              setHoverLink(null);
              openLink();
            }}
            onRemove={() => { editor?.chain().focus().setTextSelection(hoverLink.pos + 1).extendMarkRange("link").unsetLink().run(); setHoverLink(null); }}
          />
        )}
        {picker && <EmojiPicker anchor={picker.anchor} heading={picker.heading} onPick={picker.onPick} onRemove={picker.onRemove} onClose={() => setPicker(null)} />}
      </div>
    </NoteEditorContext.Provider>
    </NoteRefsContext.Provider>
  );
}

/** „Link im Text oder Linkkarte?“ right after an address was pasted, as in Notion and Loop. */
function PasteChoice({ locate, url, onCard, onClose }: { locate: () => DOMRect | null; url: string; onCard: () => Promise<string | null>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  // It stays at the link: read after the page settled, and again on every scroll and resize.
  useEffect(() => {
    let frame = 0;
    const update = () => { window.cancelAnimationFrame(frame); frame = window.requestAnimationFrame(() => setRect(locate())); };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); };
  }, [locate]);
  if (!rect) return null;
  const domain = (/^https:\/\/([^/?#]+)/i.exec(url)?.[1] ?? url).replace(/^www\./, "");
  return (
    <Floating rect={rect} className="nz-pop nz-paste-pop" above={false} label="Link einfügen als">
      <div className="nz-menu-caption">{domain} einfügen als</div>
      <button type="button" className="nz-menu-item" onClick={onClose}><span className="nz-menu-icon"><Link2 size={15} aria-hidden="true" /></span><span className="nz-menu-text"><strong>Link im Text</strong><span>Unterstrichen, Vorschau beim Darüberfahren</span></span></button>
      <button type="button" className="nz-menu-item" disabled={busy} onClick={async () => { setBusy(true); const failed = await onCard(); setBusy(false); if (failed) setError(failed); }}><span className="nz-menu-icon"><IdCard size={15} aria-hidden="true" /></span><span className="nz-menu-text"><strong>{busy ? "Lädt Vorschau …" : "Linkkarte"}</strong><span>Titel, Beschreibung und Bild als Karte</span></span></button>
      {error && <p className="nz-pop-note is-warn">{error}</p>}
      <div className="nz-menu-foot">Esc lässt den Link im Text</div>
    </Floating>
  );
}

/** „Als Aufgabe“ at the end of a checklist line under the mouse (team with a confirmed code and freelancers). */
function CheckLineAction({ editor, wrap, onConvert }: { editor: Editor; wrap: React.RefObject<HTMLDivElement | null>; onConvert: (pos: number, text: string) => void }) {
  const [line, setLine] = useState<{ pos: number; top: number; text: string } | null>(null);
  useEffect(() => {
    const host = wrap.current;
    if (!host) return;
    const onMove = (event: MouseEvent) => {
      const item = (event.target as HTMLElement).closest?.('ul[data-type="taskList"] > li');
      if (!item || !editor.view.dom.contains(item) || item.getAttribute("data-checked") === "true") { setLine((current) => current && (event.target as HTMLElement).closest?.(".nz-to-task") ? current : null); return; }
      const pos = editor.view.posAtDOM(item, 0) - 1;
      const node = editor.state.doc.nodeAt(Math.max(0, pos));
      const text = node?.type.name === "taskItem" ? node.textContent.trim() : "";
      if (!text) return;
      const rect = item.getBoundingClientRect();
      setLine({ pos, top: rect.top - host.getBoundingClientRect().top, text });
    };
    const onLeave = () => setLine(null);
    host.addEventListener("mousemove", onMove);
    host.addEventListener("mouseleave", onLeave);
    return () => { host.removeEventListener("mousemove", onMove); host.removeEventListener("mouseleave", onLeave); };
  }, [editor, wrap]);
  if (!line) return null;
  return <button type="button" className="nz-to-task" style={{ top: line.top }} contentEditable={false} onClick={() => { setLine(null); onConvert(line.pos, line.text.slice(0, 240)); }}><SquareKanban size={14} aria-hidden="true" />Als Aufgabe</button>;
}

/** A floating glass bar at a screen rectangle, kept on screen; it never takes the editor's focus. */
function Floating({ rect, className, children, above = true, label }: { rect: DOMRect; className: string; children: React.ReactNode; above?: boolean; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const width = box.current?.offsetWidth ?? 300;
    const height = box.current?.offsetHeight ?? 40;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    // Its preferred side, or the other one when it would leave the window there.
    const over = rect.top - height - 8;
    const under = rect.bottom + 8;
    const top = above ? (over > 8 ? over : under) : (under + height > window.innerHeight - 8 && over > 8 ? over : under);
    setPlace({ left, top });
  }, [rect, above]);
  return (
    <div ref={box} className={`${className} nz-glass`} role="toolbar" aria-label={label} style={place ? { left: place.left, top: place.top } : { left: rect.left, top: rect.bottom + 8 }} onMouseDown={(event) => { if (!(event.target as HTMLElement).closest("input, select")) event.preventDefault(); }}>
      {children}
    </div>
  );
}

/** Follows scrolling and resizing while something floats over the page. */
function useViewportTick(active: boolean) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const bump = () => setTick((value) => value + 1);
    window.addEventListener("scroll", bump, true);
    window.addEventListener("resize", bump);
    return () => { window.removeEventListener("scroll", bump, true); window.removeEventListener("resize", bump); };
  }, [active]);
  return tick;
}

type BlockKind = "paragraph" | "h1" | "h2" | "h3" | "bullets" | "numbers" | "checks" | "code";
const blockKinds: { id: BlockKind; label: string }[] = [
  { id: "paragraph", label: "Text" }, { id: "h1", label: "Überschrift 1" }, { id: "h2", label: "Überschrift 2" }, { id: "h3", label: "Überschrift 3" },
  { id: "bullets", label: "Aufzählung" }, { id: "numbers", label: "Nummerierung" }, { id: "checks", label: "Checkliste" }, { id: "code", label: "Code" },
];

function SelectionToolbar({ editor, onLink, onEmoji, onTask, appointmentLabel, onAppointment }: { editor: Editor; onLink: () => void; onEmoji: () => void; onTask?: () => void; appointmentLabel?: string; onAppointment?: () => void }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const { selection } = current.state;
      const show = current.isEditable && current.isFocused && !selection.empty && !(selection instanceof NodeSelection) && !current.isActive("codeBlock") && !selection.$from.parent.type.spec.code;
      const kind: BlockKind = current.isActive("heading", { level: 1 }) ? "h1" : current.isActive("heading", { level: 2 }) ? "h2" : current.isActive("heading", { level: 3 }) ? "h3"
        : current.isActive("taskList") ? "checks" : current.isActive("orderedList") ? "numbers" : current.isActive("bulletList") ? "bullets" : "paragraph";
      return {
        show, from: selection.from, to: selection.to, kind,
        bold: current.isActive("bold"), italic: current.isActive("italic"), underline: current.isActive("underline"), strike: current.isActive("strike"), link: current.isActive("link"),
      };
    },
  });
  const [kindOpen, setKindOpen] = useState(false);
  const tick = useViewportTick(Boolean(state?.show));
  const rect = useMemo(() => {
    if (!state?.show) return null;
    void tick;
    const start = editor.view.coordsAtPos(state.from);
    const end = editor.view.coordsAtPos(state.to);
    return new DOMRect(Math.min(start.left, end.left), Math.min(start.top, end.top), Math.abs(end.right - start.left), Math.max(start.bottom, end.bottom) - Math.min(start.top, end.top));
  }, [editor, state?.show, state?.from, state?.to, tick]);
  if (!state?.show || !rect) return null;
  const setKind = (kind: BlockKind) => {
    const chain = editor.chain().focus();
    if (kind === "paragraph") chain.setParagraph().run();
    else if (kind === "h1" || kind === "h2" || kind === "h3") chain.setHeading({ level: Number(kind.slice(1)) as 1 | 2 | 3 }).run();
    else if (kind === "bullets") chain.toggleBulletList().run();
    else if (kind === "numbers") chain.toggleOrderedList().run();
    else if (kind === "checks") chain.toggleTaskList().run();
    else chain.toggleCodeBlock().run();
    setKindOpen(false);
  };
  const mark = (on: boolean, label: string, icon: React.ReactNode, run: () => void) => (
    <button type="button" className={`nz-tb${on ? " is-on" : ""}`} aria-pressed={on} aria-label={label} data-tip={label} onClick={run}>{icon}</button>
  );
  return (
    <Floating rect={rect} className="nz-toolbar" label="Markierten Text formatieren">
      <span className="nz-tb-kind">
        <button type="button" className="nz-tb nz-tb-wide" aria-haspopup="menu" aria-expanded={kindOpen} onClick={() => setKindOpen((open) => !open)}>
          <span>{blockKinds.find((item) => item.id === state.kind)?.label ?? "Text"}</span><ChevronDown size={14} aria-hidden="true" />
        </button>
        {kindOpen && (
          <span className="nz-tb-menu nz-glass" role="menu">
            {blockKinds.map((item) => <button key={item.id} type="button" role="menuitemradio" aria-checked={item.id === state.kind} className={`nz-tb-menu-item${item.id === state.kind ? " is-on" : ""}`} onClick={() => setKind(item.id)}>{item.label}</button>)}
          </span>
        )}
      </span>
      <span className="nz-tb-sep" />
      {mark(state.bold, "Fett", <Bold size={15} />, () => editor.chain().focus().toggleBold().run())}
      {mark(state.italic, "Kursiv", <Italic size={15} />, () => editor.chain().focus().toggleItalic().run())}
      {mark(state.underline, "Unterstrichen", <Underline size={15} />, () => editor.chain().focus().toggleUnderline().run())}
      {mark(state.strike, "Durchgestrichen", <Strikethrough size={15} />, () => editor.chain().focus().toggleStrike().run())}
      <span className="nz-tb-sep" />
      <button type="button" className={`nz-tb nz-tb-wide${state.link ? " is-on" : ""}`} aria-pressed={state.link} onClick={onLink}><Link2 size={15} aria-hidden="true" /><span>Link</span></button>
      <button type="button" className="nz-tb" aria-label="Emoji einfügen" data-tip="Emoji einfügen" onClick={onEmoji}><Smile size={15} aria-hidden="true" /></button>
      {(onTask || (appointmentLabel && onAppointment)) && <span className="nz-tb-sep" />}
      {onTask && <button type="button" className="nz-tb nz-tb-wide" onClick={onTask}><SquareKanban size={15} aria-hidden="true" /><span>Als Aufgabe</span></button>}
      {appointmentLabel && onAppointment && <button type="button" className="nz-tb" aria-label={appointmentLabel} data-tip={appointmentLabel} onClick={onAppointment}><CalendarPlus size={15} aria-hidden="true" /></button>}
    </Floating>
  );
}

/** Address of a link for the selected text (toolbar, ⌘K): only https: and mailto:, „beispiel.de“ becomes https://beispiel.de. */
function LinkPopover({ editor, state, onClose, onCard }: { editor: Editor; state: { url: string; rect: DOMRect; existing: boolean }; onClose: () => void; onCard: (href: string) => Promise<string | null> }) {
  const [url, setUrl] = useState(state.url);
  const [mode, setMode] = useState<"text" | "card">("text");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
  const field = useRef<HTMLInputElement>(null);
  // The editor keeps the focus through the toolbar's click; the field takes it as soon as it stands.
  useLayoutEffect(() => { field.current?.focus(); field.current?.select(); }, []);
  const value = url.trim();
  const href = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : value.includes("@") && !value.includes("/") ? `mailto:${value}` : value ? `https://${value}` : "";
  const valid = isSafeHref(href);
  const apply = async () => {
    if (!valid || busy) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    if (mode === "card" && /^https:/i.test(href)) {
      setBusy(true);
      const error = await onCard(href);
      setBusy(false);
      if (error) { setFailed(error); return; }
    }
    onClose();
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); editor.commands.focus(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editor, onClose]);
  return (
    <Floating rect={state.rect} className="nz-pop nz-link-pop" above={false} label="Link einfügen">
      <label className="nz-field">
        <span>Adresse</span>
        <input ref={field} type="url" inputMode="url" placeholder="https://… oder name@firma.de" value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void apply(); } }} />
      </label>
      {value && !valid && <p className="nz-pop-note is-warn">Links gehen nur mit https: oder als E-Mail-Adresse.</p>}
      {!state.existing && (
        <div className="nz-pop-sec">
          <div className="nz-pop-label">Zeigen als</div>
          <div className="nz-grid2">
            <button type="button" className={`nz-opt${mode === "text" ? " is-on" : ""}`} aria-pressed={mode === "text"} onClick={() => setMode("text")}><Link2 size={16} aria-hidden="true" /><span>Link im Text</span></button>
            <button type="button" className={`nz-opt${mode === "card" ? " is-on" : ""}`} aria-pressed={mode === "card"} onClick={() => setMode("card")}><IdCard size={16} aria-hidden="true" /><span>Linkkarte</span></button>
          </div>
        </div>
      )}
      {failed && <p className="nz-pop-note is-warn">{failed}</p>}
      <div className="nz-actions">
        {state.existing && <button type="button" className="nz-btn is-danger" onClick={() => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); onClose(); }}><Unlink size={14} aria-hidden="true" />Entfernen</button>}
        <span className="nz-spacer" />
        <button type="button" className="nz-btn" onClick={() => { onClose(); editor.commands.focus(); }}>Abbrechen</button>
        <button type="button" className="nz-btn is-primary" disabled={!valid || busy} onClick={() => void apply()}>{busy ? "Lädt Vorschau …" : state.existing ? "Übernehmen" : "Einfügen"}</button>
      </div>
    </Floating>
  );
}

function LinkCard({ link, editable, onEnter, onLeave, onEdit, onRemove }: { link: { href: string; title: string; description: string; rect: DOMRect }; editable: boolean; onEnter: () => void; onLeave: () => void; onEdit: () => void; onRemove: () => void }) {
  const domain = domainOf(link.href);
  const mail = /^mailto:/i.test(link.href);
  return (
    <div className="nz-peek nz-glass" role="tooltip" style={{ left: Math.max(8, Math.min(link.rect.left, window.innerWidth - 308)), top: link.rect.bottom + 6 }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {link.title && <strong>{link.title}</strong>}
      {link.description && <span className="nz-peek-desc">{link.description}</span>}
      <span className="nz-peek-site"><span className="nz-fav" aria-hidden="true">{(domain.charAt(0) || "·").toUpperCase()}</span><span className="nz-peek-domain">{mail ? domain : link.href.replace(/^https:\/\//, "")}</span></span>
      <span className="nz-peek-actions">
        <a className="nz-btn" href={link.href} target="_blank" rel="noopener noreferrer nofollow"><ExternalLink size={14} aria-hidden="true" />{mail ? "E-Mail schreiben" : "Öffnen"}</a>
        {editable && <button type="button" className="nz-btn" onClick={onEdit}><Pencil size={14} aria-hidden="true" />Bearbeiten</button>}
        {editable && <button type="button" className="nz-btn" onClick={onRemove} aria-label="Link entfernen" data-tip="Link entfernen"><Unlink size={14} aria-hidden="true" /></button>}
      </span>
    </div>
  );
}

/**
 * „+“ and the grip next to the block under the mouse (plan 1.3): „+“ adds a line below and opens the block menu; the
 * grip moves the block by dragging and, clicked, offers up, down, duplicate and delete. On phones they stay hidden.
 */
function BlockHandles({ editor, wrap }: { editor: Editor; wrap: React.RefObject<HTMLDivElement | null> }) {
  const [block, setBlock] = useState<{ pos: number; top: number; height: number } | null>(null);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    const host = wrap.current;
    if (!host) return;
    const onMove = (event: MouseEvent) => {
      if (menu) return;
      const root = editor.view.dom;
      const bounds = root.getBoundingClientRect();
      const probe = document.elementFromPoint(Math.min(Math.max(event.clientX, bounds.left + 4), bounds.right - 4), event.clientY);
      let element = probe instanceof HTMLElement ? probe : null;
      while (element && element.parentElement !== root) element = element.parentElement;
      if (!element) return;
      const pos = editor.view.posAtDOM(element, 0);
      const resolved = editor.state.doc.resolve(Math.min(pos, editor.state.doc.content.size));
      const start = resolved.depth > 0 ? resolved.before(1) : pos;
      const rect = element.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      setBlock({ pos: start, top: rect.top - hostRect.top, height: rect.height });
    };
    const onLeave = () => { if (!menu) setBlock(null); };
    host.addEventListener("mousemove", onMove);
    host.addEventListener("mouseleave", onLeave);
    return () => { host.removeEventListener("mousemove", onMove); host.removeEventListener("mouseleave", onLeave); };
  }, [editor, wrap, menu]);
  if (!block) return null;
  const node = editor.state.doc.nodeAt(block.pos);
  if (!node) return null;
  const end = block.pos + node.nodeSize;
  const addBelow = () => {
    editor.chain().insertContentAt(end, { type: "paragraph", content: [{ type: "text", text: "/" }] }).focus(end + 2).run();
  };
  const move = (direction: -1 | 1) => {
    const { doc } = editor.state;
    const $pos = doc.resolve(block.pos);
    const index = $pos.index(0);
    const neighbour = direction < 0 ? (index > 0 ? doc.child(index - 1) : null) : (index < doc.childCount - 1 ? doc.child(index + 1) : null);
    if (!neighbour) return;
    const tr = editor.state.tr.delete(block.pos, end);
    const target = direction < 0 ? block.pos - neighbour.nodeSize : block.pos + neighbour.nodeSize;
    tr.insert(target, node);
    editor.view.dispatch(tr.scrollIntoView());
    setMenu(false);
    setBlock(null);
  };
  const onDragStart = (event: React.DragEvent) => {
    const selection = NodeSelection.create(editor.state.doc, block.pos);
    editor.view.dispatch(editor.state.tr.setSelection(selection));
    startBlockDrag(editor.view, selection.content());
    const element = editor.view.nodeDOM(block.pos);
    if (element instanceof HTMLElement) event.dataTransfer.setDragImage(element, 0, 0);
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData("text/plain", node.textContent);
  };
  return (
    <div className="nz-handles" style={{ top: block.top + Math.min(block.height / 2, 18) - 12 }} contentEditable={false}>
      <button type="button" className="nz-handle" aria-label="Block darunter einfügen" data-tip="Darunter einfügen" onClick={addBelow}><Plus size={16} aria-hidden="true" /></button>
      <button type="button" className="nz-handle" draggable aria-label="Block verschieben oder bearbeiten" data-tip="Ziehen zum Verschieben, Klick für mehr" aria-haspopup="menu" aria-expanded={menu} onDragStart={onDragStart} onClick={() => setMenu((open) => !open)}><GripVertical size={16} aria-hidden="true" /></button>
      {menu && (
        <span className="nz-handle-menu nz-glass" role="menu" onMouseLeave={() => setMenu(false)}>
          <button type="button" role="menuitem" onClick={() => move(-1)}><ArrowUp size={15} aria-hidden="true" />Nach oben</button>
          <button type="button" role="menuitem" onClick={() => move(1)}><ArrowDown size={15} aria-hidden="true" />Nach unten</button>
          <button type="button" role="menuitem" onClick={() => { editor.chain().insertContentAt(end, node.toJSON()).run(); setMenu(false); }}><Copy size={15} aria-hidden="true" />Duplizieren</button>
          <button type="button" role="menuitem" className="is-danger" onClick={() => { editor.chain().deleteRange({ from: block.pos, to: end }).run(); setMenu(false); setBlock(null); }}><Trash2 size={15} aria-hidden="true" />Löschen</button>
        </span>
      )}
    </div>
  );
}

const columnIcons: Record<ColumnType, typeof Type> = { text: Type, check: SquareCheck, status: CircleDot, person: UserRound };

/** Hands a block to ProseMirror's own drop handling, which moves it where it is dropped. */
function startBlockDrag(view: EditorView, slice: Slice) {
  view.dragging = { slice, move: true };
}

/** Rows, columns and the kind of a column, while the caret stands in a table. */
function TableToolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current.isEditable || !current.isFocused) return null;
      const table = findParentNode((node) => node.type.name === "table")(current.state.selection);
      const cell = findParentNode((node) => node.type.name === "tableCell" || node.type.name === "tableHeader")(current.state.selection);
      if (!table || !cell) return null;
      const map = TableMap.get(table.node);
      const column = map.findCell(cell.pos - table.start).left;
      const headerPos = table.start + map.map[column];
      const header = current.state.doc.nodeAt(headerPos);
      return { tablePos: table.pos, column, headerPos, kind: (isColumnType(header?.attrs.colType) ? header?.attrs.colType : "text") as ColumnType, headerIsHeader: header?.type.name === "tableHeader" };
    },
  });
  const tick = useViewportTick(Boolean(state));
  if (!state) return null;
  void tick;
  const dom = editor.view.nodeDOM(state.tablePos);
  const element = dom instanceof HTMLElement ? dom : null;
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  const setKind = (kind: ColumnType) => {
    const header = editor.state.doc.nodeAt(state.headerPos);
    if (!header || header.type.name !== "tableHeader") return;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(state.headerPos, undefined, { ...header.attrs, colType: kind }));
  };
  return (
    <Floating rect={new DOMRect(rect.left, rect.top, rect.width, 1)} className="nz-toolbar nz-table-bar" label="Tabelle bearbeiten">
      <button type="button" className="nz-tb nz-tb-wide" onClick={() => editor.chain().focus().addRowAfter().run()}><Rows3 size={15} aria-hidden="true" /><span>Neue Zeile</span></button>
      <button type="button" className="nz-tb nz-tb-wide" onClick={() => editor.chain().focus().addColumnAfter().run()}><Columns3 size={15} aria-hidden="true" /><span>Neue Spalte</span></button>
      <span className="nz-tb-sep" />
      {state.headerIsHeader && (
        <span className="nz-tb-kinds" role="radiogroup" aria-label="Art dieser Spalte">
          {COLUMN_TYPES.map((kind) => {
            const Icon = columnIcons[kind];
            return <button key={kind} type="button" role="radio" aria-checked={state.kind === kind} className={`nz-tb${state.kind === kind ? " is-on" : ""}`} aria-label={`Spaltenart: ${COLUMN_TYPE_LABELS[kind]}`} data-tip={`Spaltenart: ${COLUMN_TYPE_LABELS[kind]}`} onClick={() => setKind(kind)}><Icon size={15} aria-hidden="true" /></button>;
          })}
        </span>
      )}
      <span className="nz-tb-sep" />
      <button type="button" className="nz-tb" aria-label="Zeile löschen" data-tip="Zeile löschen" onClick={() => editor.chain().focus().deleteRow().run()}><Rows3 size={15} aria-hidden="true" /><Minus size={11} aria-hidden="true" /></button>
      <button type="button" className="nz-tb" aria-label="Spalte löschen" data-tip="Spalte löschen" onClick={() => editor.chain().focus().deleteColumn().run()}><Columns3 size={15} aria-hidden="true" /><Minus size={11} aria-hidden="true" /></button>
      <button type="button" className="nz-tb is-danger" aria-label="Tabelle löschen" data-tip="Tabelle löschen" onClick={() => editor.chain().focus().deleteTable().run()}><Trash2 size={15} aria-hidden="true" /></button>
    </Floating>
  );
}

export type { Range };
