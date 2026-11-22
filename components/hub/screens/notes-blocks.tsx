"use client";

import { createContext, useContext } from "react";
import { Extension, InputRule, Node, mergeAttributes, type Editor, type Range } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, ReactRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PmNode } from "@tiptap/pm/model";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { TableHeader } from "@tiptap/extension-table";
import { FileText, Lock } from "lucide-react";
import { emojiSrc, isKnownEmoji, searchEmojis, stripVariation, type EmojiEntry } from "@/lib/hub-notes/emoji";
import { isColumnType, isTicked, statusTone } from "@/lib/hub-notes/rules";
import type { NotePageMeta } from "@/lib/hub-notes/types";

// The notes' own blocks for Tiptap 3 (plan 6.2): emojis in the text, the callout with its emoji, a subpage, the block
// menu on „/“, emoji suggestions after „:“ and the kinds of table columns. They save as plain JSON (refKind and refId
// only for references); lib/hub-notes/rules.ts checks the same names on the server.

/** What the blocks need from the page around the editor: other pages, opening one, the emoji picker. */
export type NoteEditorUi = {
  pages: Map<string, NotePageMeta>;
  editable: boolean;
  openPage: (id: string) => void;
  pickEmoji: (anchor: DOMRect, heading: string, onPick: (char: string) => void, onRemove?: () => void) => void;
};
export const NoteEditorContext = createContext<NoteEditorUi>({ pages: new Map(), editable: false, openPage: () => {}, pickEmoji: () => {} });

/** An emoji of the set as the hub's own image; any other emoji stays a character. */
export function EmojiGlyph({ char, size }: { char: string; size?: number }) {
  const src = emojiSrc(char);
  // Plain <img>: the files are tiny, served by the hub itself, and must not go through image optimisation.
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img className="nz-emoji-img" src={src} alt={char} width={size} height={size} draggable={false} /> : <span className="nz-emoji-char">{char}</span>;
}

// ---- Emoji in the text --------------------------------------------------------------------------------------------

const emojiKey = new PluginKey("noteEmojiInput");
/** Emojis of the set, longest sequences first, to find them in typed or pasted text. */
const emojiPattern = () => /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}️?)*/gu;

export const NoteEmoji = Node.create({
  name: "noteEmoji",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return { char: { default: null, parseHTML: (element) => element.getAttribute("data-char"), renderHTML: (attrs) => ({ "data-char": attrs.char }) } };
  },
  parseHTML() {
    return [{ tag: "span[data-note-emoji]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const char = String(node.attrs.char ?? "");
    const src = emojiSrc(char);
    return ["span", mergeAttributes(HTMLAttributes, { "data-note-emoji": "", class: "nz-emoji" }), src ? ["img", { src, alt: char, draggable: "false", class: "nz-emoji-img" }] : char];
  },
  renderText({ node }) {
    return String(node.attrs.char ?? "");
  },
  addProseMirrorPlugins() {
    const type = this.type;
    return [
      new Plugin({
        key: emojiKey,
        props: {
          // An emoji of the set typed with the keyboard's own picker becomes the hub's image as well.
          handleTextInput(view, from, to, text) {
            const match = text.match(emojiPattern());
            if (!match || match.join("") !== text || !match.every((char) => isKnownEmoji(char))) return false;
            const nodes = match.map((char) => type.create({ char: stripVariation(char) }));
            view.dispatch(view.state.tr.replaceWith(from, to, nodes).scrollIntoView());
            return true;
          },
        },
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((tr) => tr.docChanged && tr.getMeta("paste"))) return null;
          const found: { from: number; to: number; char: string }[] = [];
          state.doc.descendants((node, pos) => {
            if (!node.isText || !node.text) return;
            for (const match of node.text.matchAll(emojiPattern())) {
              if (isKnownEmoji(match[0])) found.push({ from: pos + (match.index ?? 0), to: pos + (match.index ?? 0) + match[0].length, char: stripVariation(match[0]) });
            }
          });
          if (!found.length) return null;
          const tr = state.tr;
          for (const item of found.reverse()) tr.replaceWith(item.from, item.to, type.create({ char: item.char }));
          return tr;
        },
      }),
    ];
  },
});

// ---- Callout ------------------------------------------------------------------------------------------------------

function CalloutView({ node, updateAttributes }: ReactNodeViewProps) {
  const ui = useContext(NoteEditorContext);
  const emoji = String(node.attrs.emoji ?? "");
  return (
    <NodeViewWrapper className="nz-callout">
      <button
        type="button"
        className="nz-callout-ico"
        contentEditable={false}
        disabled={!ui.editable}
        aria-label="Symbol des Hinweises ändern"
        data-tip={ui.editable ? "Symbol ändern" : undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => ui.pickEmoji(event.currentTarget.getBoundingClientRect(), "Symbol des Hinweises", (char) => updateAttributes({ emoji: char }), () => updateAttributes({ emoji: "" }))}
      >
        {emoji ? <EmojiGlyph char={emoji} /> : <span className="nz-callout-dot" aria-hidden="true" />}
      </button>
      <NodeViewContent className="nz-callout-body" />
    </NodeViewWrapper>
  );
}

export const NoteCallout = Node.create({
  name: "noteCallout",
  group: "block",
  content: "paragraph+",
  defining: true,
  addAttributes() {
    return { emoji: { default: "💡", parseHTML: (element) => element.getAttribute("data-emoji") ?? "💡", renderHTML: (attrs) => ({ "data-emoji": attrs.emoji }) } };
  },
  parseHTML() {
    return [{ tag: "div[data-note-callout]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-note-callout": "", class: "nz-callout" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
});

// ---- Subpage ------------------------------------------------------------------------------------------------------

function SubpageView({ node }: ReactNodeViewProps) {
  const ui = useContext(NoteEditorContext);
  const id = String(node.attrs.refId ?? "");
  const page = ui.pages.get(id);
  // A subpage the viewer may not see is simply not there for them (the database hides it as well).
  if (!page) {
    return (
      <NodeViewWrapper className="nz-sub-wrap" data-hidden="true">
        {ui.editable && <span className="nz-sub is-missing" contentEditable={false}><Lock size={16} aria-hidden="true" /><span>Seite nicht verfügbar</span></span>}
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper className="nz-sub-wrap">
      <button type="button" className="nz-sub" contentEditable={false} onClick={() => ui.openPage(page.id)}>
        {page.icon ? <span className="nz-sub-icon"><EmojiGlyph char={page.icon} /></span> : <FileText size={18} aria-hidden="true" />}
        <span className="nz-sub-title">{page.title}</span>
      </button>
    </NodeViewWrapper>
  );
}

export const NoteSubpage = Node.create({
  name: "noteSubpage",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      refKind: { default: "page", renderHTML: () => ({ "data-ref-kind": "page" }) },
      refId: { default: null, parseHTML: (element) => element.getAttribute("data-ref-id"), renderHTML: (attrs) => ({ "data-ref-id": attrs.refId }) },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-note-subpage]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-note-subpage": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(SubpageView);
  },
});

// ---- Small typing rules -------------------------------------------------------------------------------------------

/** „> “ at the start of a line opens a toggle (Aufklapper), as in Notion; „[] “ a checklist comes with the task list. */
export const NoteTypingRules = Extension.create({
  name: "noteTypingRules",
  addInputRules() {
    return [
      new InputRule({
        find: /^>\s$/,
        handler: ({ range, chain }) => {
          chain().deleteRange(range).setDetails().run();
        },
      }),
    ];
  },
});

// ---- Table columns ------------------------------------------------------------------------------------------------

/** Header cells carry the kind of their column (Text, Häkchen, Status, Person). */
export const NoteTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      colType: { default: "text", parseHTML: (element) => element.getAttribute("data-col-type") ?? "text", renderHTML: (attrs) => ({ "data-col-type": attrs.colType }) },
    };
  },
});

const columnKey = new PluginKey("noteTableColumns");

/** Marks every body cell with the kind of its column and, for statuses and ticks, the tone of its words. */
function columnDecorations(doc: PmNode) {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "table") return true;
    const kinds: string[] = [];
    node.firstChild?.forEach((cell) => { for (let span = 0; span < (Number(cell.attrs.colspan) || 1); span++) kinds.push(isColumnType(cell.attrs.colType) ? String(cell.attrs.colType) : "text"); });
    let rowPos = pos + 1;
    node.forEach((row, _offset, rowIndex) => {
      let cellPos = rowPos + 1;
      let column = 0;
      row.forEach((cell) => {
        const kind = kinds[column] ?? "text";
        if (rowIndex > 0 && kind !== "text") {
          const text = cell.textContent;
          const attrs: Record<string, string> = { "data-col-type": kind };
          if (kind === "status") attrs["data-tone"] = statusTone(text);
          if (kind === "check") attrs["data-ticked"] = String(isTicked(text));
          decorations.push(Decoration.node(cellPos, cellPos + cell.nodeSize, attrs));
        }
        column += Number(cell.attrs.colspan) || 1;
        cellPos += cell.nodeSize;
      });
      rowPos += row.nodeSize;
    });
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

export const NoteTableColumns = Extension.create({
  name: "noteTableColumns",
  addProseMirrorPlugins() {
    return [new Plugin({ key: columnKey, props: { decorations: (state) => columnDecorations(state.doc) } })];
  },
});

// ---- Menus on „/“ and „:“ -----------------------------------------------------------------------------------------

export type SlashItem = { id: string; label: string; hint: string; icon: React.ReactNode; group: string; keywords?: string; run: (editor: Editor, range: Range) => void };

type MenuHandle = { onKeyDown: (event: KeyboardEvent) => boolean };
type MenuProps<T> = { items: T[]; command: (item: T) => void; query: string };

/** Mounts a React menu at the caret through the suggestion plugin's own positioning, in the hub's glass. */
function menuRenderer<T>(Component: React.ComponentType<MenuProps<T> & { handleRef: React.RefObject<MenuHandle | null> }>) {
  return () => {
    let renderer: ReactRenderer | null = null;
    let unmount: (() => void) | undefined;
    const handleRef: React.RefObject<MenuHandle | null> = { current: null };
    return {
      onStart: (props: SuggestionProps<T, T>) => {
        renderer = new ReactRenderer(Component, { editor: props.editor, props: { items: props.items, command: props.command, query: props.query, handleRef } });
        unmount = props.mount(renderer.element as HTMLElement);
      },
      onUpdate: (props: SuggestionProps<T, T>) => renderer?.updateProps({ items: props.items, command: props.command, query: props.query, handleRef }),
      onKeyDown: (props: SuggestionKeyDownProps) => {
        if (props.event.key === "Escape") { unmount?.(); unmount = undefined; renderer?.destroy(); renderer = null; return true; }
        return handleRef.current?.onKeyDown(props.event) ?? false;
      },
      onExit: () => { unmount?.(); unmount = undefined; renderer?.destroy(); renderer = null; },
    };
  };
}

export const slashKey = new PluginKey("noteSlash");
export const colonKey = new PluginKey("noteColon");

type SlashStorage = { items: (query: string) => SlashItem[] };
const slashStorage = (editor: Editor) => (editor.storage as unknown as Record<string, SlashStorage>).noteSlash;

/** The page hands its current blocks to the menu (their callbacks change with the page around the editor). */
export function setSlashItems(editor: Editor, items: (query: string) => SlashItem[]) {
  slashStorage(editor).items = items;
}

export function createSlashExtension(Menu: React.ComponentType<MenuProps<SlashItem> & { handleRef: React.RefObject<MenuHandle | null> }>) {
  return Extension.create<Record<string, never>, SlashStorage>({
    name: "noteSlash",
    addStorage() {
      return { items: () => [] };
    },
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem, SlashItem>({
          editor: this.editor,
          pluginKey: slashKey,
          char: "/",
          allowSpaces: false,
          placement: "bottom-start",
          items: ({ query, editor }) => slashStorage(editor).items(query),
          command: ({ editor, range, props }) => props.run(editor, range),
          // Not inside code, and not in the middle of a word (addresses like „a/b“ stay text).
          allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
          render: menuRenderer<SlashItem>(Menu),
        }),
      ];
    },
  });
}

export function createColonExtension(Menu: React.ComponentType<MenuProps<EmojiEntry> & { handleRef: React.RefObject<MenuHandle | null> }>) {
  return Extension.create({
    name: "noteColon",
    addProseMirrorPlugins() {
      return [
        Suggestion<EmojiEntry, EmojiEntry>({
          editor: this.editor,
          pluginKey: colonKey,
          char: ":",
          allowSpaces: false,
          minQueryLength: 2,
          placement: "bottom-start",
          items: ({ query }) => /^[\p{L}]{2,20}$/u.test(query) ? searchEmojis(query, 8) : [],
          command: ({ editor, range, props }) => {
            editor.chain().focus().deleteRange(range).insertContent([{ type: "noteEmoji", attrs: { char: props.char } }, { type: "text", text: " " }]).run();
          },
          allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
          render: menuRenderer<EmojiEntry>(Menu),
        }),
      ];
    },
  });
}

export type { MenuHandle, MenuProps };
