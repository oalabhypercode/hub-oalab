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
  SquareCheck, CircleDot, UserRound,
} from "lucide-react";
import { isSafeHref, COLUMN_TYPE_LABELS, COLUMN_TYPES, isColumnType, type ColumnType } from "@/lib/hub-notes/rules";
import type { NoteDoc, NotePage, NotePageMeta } from "@/lib/hub-notes/types";
import type { EmojiEntry } from "@/lib/hub-notes/emoji";
import {
  createColonExtension, createSlashExtension, EmojiGlyph, NoteCallout, NoteEditorContext, NoteEmoji, NoteSubpage, NoteTableColumns, NoteTableHeader,
  NoteTypingRules, setSlashItems, type MenuHandle, type MenuProps, type NoteEditorUi, type SlashItem,
} from "./notes-blocks";
import { EmojiPicker } from "./notes-emoji-picker";

// The writing area of a note (plan 1.3): Tiptap 3 with the basic blocks of step 1, the block menu on „/“, Markdown
// shortcuts, emojis after „:“, a toolbar over selected text, clean links with a card on hover, tables with column
// kinds, and handles to move blocks. Loaded only on the notes page (next/dynamic), so the rest of the hub stays light.
// Who may only read sees the same page without any of the editing tools.

export type NoteEditorHandle = { focusStart: () => void; insertEmojiAtEnd: (char: string) => void; editor: () => Editor | null };

type Props = {
  page: NotePage;
  editable: boolean;
  pages: NotePageMeta[];
  onChange: (doc: NoteDoc) => void;
  onOpenPage: (id: string) => void;
  onCreateSubpage: () => Promise<NotePageMeta | null>;
  handleRef?: React.Ref<NoteEditorHandle>;
};

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

export default function NoteEditor({ page, editable, pages, onChange, onOpenPage, onCreateSubpage, handleRef }: Props) {
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
  }, [pickEmoji]);
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
  useEffect(() => { editor?.setEditable(editable); }, [editor, editable]);

  useImperativeHandle(handleRef, () => ({
    focusStart: () => editor?.chain().focus("start").run(),
    insertEmojiAtEnd: (char) => editor?.chain().focus("end").insertContent({ type: "noteEmoji", attrs: { char } }).run(),
    editor: () => editor,
  }), [editor]);

  const ui: NoteEditorUi = useMemo(() => ({ pages: new Map(pages.map((item) => [item.id, item])), editable, openPage: onOpenPage, pickEmoji }), [pages, editable, onOpenPage, pickEmoji]);

  // Link card on hover: the address, its site and, once the server read them (step 2), title and description.
  useEffect(() => {
    const dom = editor?.view.dom;
    if (!dom) return;
    const over = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest("a[href]");
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
    dom.addEventListener("mouseover", over);
    dom.addEventListener("mouseout", out);
    return () => { dom.removeEventListener("mouseover", over); dom.removeEventListener("mouseout", out); window.clearTimeout(hoverTimer.current); };
  }, [editor]);

  return (
    <NoteEditorContext.Provider value={ui}>
      <div className={`nz-editor${editable ? " is-edit" : " is-read"}`} ref={wrap}>
        {editor && editable && <BlockHandles editor={editor} wrap={wrap} />}
        <EditorContent editor={editor} />
        {editor && editable && !linkEdit && !picker && <SelectionToolbar editor={editor} onLink={openLink} onEmoji={() => pickEmoji(caretRect(editor), "Emoji einfügen", (char) => editor.chain().focus().setTextSelection(editor.state.selection.to).insertContent({ type: "noteEmoji", attrs: { char } }).run())} />}
        {editor && editable && <TableToolbar editor={editor} />}
        {editor && linkEdit && <LinkPopover editor={editor} state={linkEdit} onClose={() => setLinkEdit(null)} />}
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
  );
}

/** A floating glass bar at a screen rectangle, kept on screen; it never takes the editor's focus. */
function Floating({ rect, className, children, above = true, label }: { rect: DOMRect; className: string; children: React.ReactNode; above?: boolean; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const width = box.current?.offsetWidth ?? 300;
    const height = box.current?.offsetHeight ?? 40;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const top = above && rect.top - height - 8 > 8 ? rect.top - height - 8 : rect.bottom + 8;
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

function SelectionToolbar({ editor, onLink, onEmoji }: { editor: Editor; onLink: () => void; onEmoji: () => void }) {
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
    </Floating>
  );
}

/** Address of a link for the selected text (toolbar, ⌘K): only https: and mailto:, „beispiel.de“ becomes https://beispiel.de. */
function LinkPopover({ editor, state, onClose }: { editor: Editor; state: { url: string; rect: DOMRect; existing: boolean }; onClose: () => void }) {
  const [url, setUrl] = useState(state.url);
  const field = useRef<HTMLInputElement>(null);
  // The editor keeps the focus through the toolbar's click; the field takes it as soon as it stands.
  useLayoutEffect(() => { field.current?.focus(); field.current?.select(); }, []);
  const value = url.trim();
  const href = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : value.includes("@") && !value.includes("/") ? `mailto:${value}` : value ? `https://${value}` : "";
  const valid = isSafeHref(href);
  const apply = () => {
    if (!valid) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
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
        <input ref={field} type="url" inputMode="url" placeholder="https://… oder name@firma.de" value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); apply(); } }} />
      </label>
      {value && !valid && <p className="nz-pop-note is-warn">Links gehen nur mit https: oder als E-Mail-Adresse.</p>}
      <div className="nz-actions">
        {state.existing && <button type="button" className="nz-btn is-danger" onClick={() => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); onClose(); }}><Unlink size={14} aria-hidden="true" />Entfernen</button>}
        <span className="nz-spacer" />
        <button type="button" className="nz-btn" onClick={() => { onClose(); editor.commands.focus(); }}>Abbrechen</button>
        <button type="button" className="nz-btn is-primary" disabled={!valid} onClick={apply}>{state.existing ? "Übernehmen" : "Einfügen"}</button>
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
