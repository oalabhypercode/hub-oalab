"use client";

import { useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Extension, Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { Captions, ExternalLink, ImageOff, Maximize2, Trash2, X } from "lucide-react";
import { isNoteImageSize, NOTE_IMAGE_MAX_BYTES, NOTE_IMAGE_SIZES, uploadSize, type NoteImageSize } from "@/lib/hub-notes/rules";
import type { NoteImageUpload, NoteResult } from "@/lib/hub-notes/types";
import { NoteRefsContext } from "./notes-refs";

// Pictures in the text (27.11.2026): a screenshot pasted with Ctrl/⌘ + V, image files dragged onto the page, or „/Bild“.
// While a picture goes up, a placeholder with the local picture stands where it will go (a decoration, never part of
// the saved page); once the hub stored it (app/api/notes/image), the picture block takes its place. The block keeps
// only the picture's place in the hub's storage, its size and caption; the link to show it comes with the page's
// references, signed for the viewer like the previews of link cards (lib/hub-notes/refs.ts).

const pixels = (value: string | null) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 16_384 ? number : null;
};

export const NoteImage = Node.create({
  name: "noteImage",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      image: { default: null, parseHTML: (element) => element.getAttribute("data-image"), renderHTML: (attrs) => (attrs.image ? { "data-image": attrs.image } : {}) },
      width: { default: null, parseHTML: (element) => pixels(element.getAttribute("data-width")), renderHTML: (attrs) => (attrs.width ? { "data-width": String(attrs.width) } : {}) },
      height: { default: null, parseHTML: (element) => pixels(element.getAttribute("data-height")), renderHTML: (attrs) => (attrs.height ? { "data-height": String(attrs.height) } : {}) },
      size: { default: "large", parseHTML: (element) => { const value = element.getAttribute("data-size"); return isNoteImageSize(value) ? value : "large"; }, renderHTML: (attrs) => ({ "data-size": attrs.size }) },
      caption: { default: null, parseHTML: (element) => element.getAttribute("data-caption") || null, renderHTML: (attrs) => (attrs.caption ? { "data-caption": attrs.caption } : {}) },
    };
  },
  parseHTML() { return [{ tag: "figure[data-note-image]" }]; },
  renderHTML({ HTMLAttributes }) { return ["figure", mergeAttributes(HTMLAttributes, { "data-note-image": "" })]; },
  renderText({ node }) { return node.attrs.caption ? `[Bild: ${node.attrs.caption}]` : "[Bild]"; },
  addNodeView() { return ReactNodeViewRenderer(ImageView); },
});

function ImageView({ node, selected, updateAttributes, deleteNode, editor }: ReactNodeViewProps) {
  const ui = useContext(NoteRefsContext);
  const path = typeof node.attrs.image === "string" ? node.attrs.image : "";
  const url = path ? ui?.refs.images[path] : undefined;
  const size: NoteImageSize = isNoteImageSize(node.attrs.size) ? node.attrs.size : "large";
  const width = typeof node.attrs.width === "number" ? node.attrs.width : undefined;
  const height = typeof node.attrs.height === "number" ? node.attrs.height : undefined;
  const caption = typeof node.attrs.caption === "string" ? node.attrs.caption : "";
  const editable = Boolean(ui?.editable) && editor.isEditable;
  const [failed, setFailed] = useState<string | null>(null);
  const asked = useRef(false);
  const [zoom, setZoom] = useState(false);
  const [captionOpen, setCaptionOpen] = useState(false);
  const [draft, setDraft] = useState(caption);
  // A caption changed elsewhere (undo, another person) shows in the field too.
  const [seen, setSeen] = useState(caption);
  if (seen !== caption) { setSeen(caption); setDraft(caption); }
  const shown = url && url !== failed ? url : null;
  const label = caption || "Bild";

  // A link runs out after an hour: the page asks once for a new one, then shows that the picture is missing.
  const onError = () => {
    if (!url) return;
    if (!asked.current && ui?.refreshImage) {
      asked.current = true;
      void ui.refreshImage(path).then((fresh) => { if (!fresh) setFailed(url); });
      return;
    }
    setFailed(url);
  };
  const commit = () => {
    const next = draft.replace(/\s+/g, " ").trim().slice(0, 300);
    if (next !== caption) updateAttributes({ caption: next || null });
    setCaptionOpen(false);
  };

  return (
    <NodeViewWrapper as="figure" className={`nz-image is-${size}${selected ? " is-selected" : ""}`} contentEditable={false}>
      <div className="nz-image-frame" style={width ? { width: `${width}px` } : undefined}>
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element -- a signed link to the hub's own storage, or the picture still in the browser
          <img src={shown} alt={label} width={width} height={height} draggable={false} onError={onError} onDoubleClick={() => setZoom(true)} onClick={() => { if (!editable) setZoom(true); }} />
        ) : (
          <span className="nz-image-missing" style={width && height ? { aspectRatio: `${width} / ${height}` } : undefined}>
            <ImageOff size={18} aria-hidden="true" />
            {path ? "Bild nicht verfügbar" : "Bild fehlt"}
          </span>
        )}
        {editable && (
          <span className="nz-image-bar nz-glass" role="toolbar" aria-label="Bild" onMouseDown={(event) => event.preventDefault()}>
            {NOTE_IMAGE_SIZES.map((item) => (
              <button key={item.id} type="button" className={`nz-tb${size === item.id ? " is-on" : ""}`} aria-pressed={size === item.id} onClick={() => updateAttributes({ size: item.id })}>{item.label}</button>
            ))}
            <span className="nz-tb-sep" />
            <button type="button" className={`nz-tb${caption || captionOpen ? " is-on" : ""}`} aria-label="Bildunterschrift" data-tip="Bildunterschrift" onClick={() => setCaptionOpen(true)}><Captions size={15} aria-hidden="true" /></button>
            {shown && <button type="button" className="nz-tb" aria-label="Vergrößern" data-tip="Vergrößern" onClick={() => setZoom(true)}><Maximize2 size={15} aria-hidden="true" /></button>}
            <button type="button" className="nz-tb is-danger" aria-label="Bild löschen" data-tip="Bild löschen" onClick={() => deleteNode()}><Trash2 size={15} aria-hidden="true" /></button>
          </span>
        )}
      </div>
      {editable && (caption || captionOpen) && (
        <input
          className="nz-image-caption"
          value={draft}
          placeholder="Bildunterschrift"
          maxLength={300}
          aria-label="Bildunterschrift"
          autoFocus={captionOpen}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); commit(); editor.commands.focus(); }
            if (event.key === "Escape") { event.preventDefault(); setDraft(caption); setCaptionOpen(false); editor.commands.focus(); }
          }}
        />
      )}
      {!editable && caption && <figcaption className="nz-image-caption">{caption}</figcaption>}
      {zoom && shown && <Lightbox url={shown} label={label} caption={caption} onClose={() => setZoom(false)} />}
    </NodeViewWrapper>
  );
}

/** The picture large over the hub, to read small text in a screenshot; Esc, a click beside it or „Schließen“ ends it. */
function Lightbox({ url, label, caption, onClose }: { url: string; label: string; caption: string; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return createPortal(
    <div className="nz-lightbox" role="dialog" aria-modal="true" aria-label={label} onClick={onClose}>
      <figure className="nz-lightbox-figure" onClick={(event) => event.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a signed link to the hub's own storage, or the picture still in the browser */}
        <img src={url} alt={label} />
        {caption && <figcaption>{caption}</figcaption>}
      </figure>
      <div className="nz-lightbox-actions" onClick={(event) => event.stopPropagation()}>
        <a className="nz-lightbox-btn" href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} aria-hidden="true" />In neuem Tab</a>
        <button ref={close} type="button" className="nz-lightbox-btn" onClick={onClose}><X size={16} aria-hidden="true" />Schließen</button>
      </div>
    </div>,
    document.body,
  );
}

// ---- Placeholders while pictures go up -----------------------------------------------------------------------------

type Pending = { id: string; pos: number; preview: string; width: number; height: number };
type UploadsMeta = { add?: Pending[]; remove?: string };

const uploadsKey = new PluginKey<DecorationSet>("noteImageUploads");
/** Pictures that go up together keep their order: a later placeholder at the same place stands after an earlier one. */
let order = 0;

function placeholder(item: Pending) {
  const box = document.createElement("div");
  box.className = "nz-image-upload";
  box.contentEditable = "false";
  const frame = document.createElement("div");
  frame.className = "nz-image-frame";
  frame.style.width = `${item.width}px`;
  const picture = document.createElement("img");
  picture.src = item.preview;
  picture.alt = "";
  picture.width = item.width;
  picture.height = item.height;
  const label = document.createElement("span");
  label.className = "nz-image-upload-label";
  label.textContent = "Lädt hoch …";
  frame.append(picture, label);
  box.append(frame);
  return box;
}

export const NoteImageUploads = Extension.create({
  name: "noteImageUploads",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: uploadsKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            let next = set.map(tr.mapping, tr.doc);
            const meta = tr.getMeta(uploadsKey) as UploadsMeta | undefined;
            if (meta?.add?.length) next = next.add(tr.doc, meta.add.map((item) => Decoration.widget(item.pos, () => placeholder(item), { id: item.id, key: item.id, side: 1 + ++order, ignoreSelection: true })));
            if (meta?.remove) next = next.remove(next.find(undefined, undefined, (spec) => spec.id === meta.remove));
            return next;
          },
        },
        props: { decorations: (state) => uploadsKey.getState(state) },
      }),
    ];
  },
});

const placeholderAt = (state: EditorState, id: string) => uploadsKey.getState(state)?.find(undefined, undefined, (spec) => spec.id === id)[0]?.from ?? null;

/** Where pictures go from a place in the page: in place of an empty line, else after the top-level block around it. */
export function anchorAt(doc: ProseNode, pos: number): number {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  if ($pos.depth === 0) return $pos.pos;
  const top = $pos.node(1);
  return top.isTextblock && top.content.size === 0 ? $pos.before(1) : $pos.after(1);
}

/** Where pictures go from the caret: after a selected block (a picture just added, say), else as anchorAt says. */
export function pictureAnchor(state: EditorState): number {
  const { selection } = state;
  if (selection instanceof NodeSelection) {
    const $end = state.doc.resolve(selection.to);
    return $end.depth === 0 ? selection.to : $end.after(1);
  }
  return anchorAt(state.doc, selection.from);
}

// ---- Uploading -------------------------------------------------------------------------------------------------

export type NoteImageUi = {
  /** Stores a picture for the open page; the design preview keeps it in the browser only. */
  upload: (file: File, size: { width: number; height: number }) => Promise<NoteResult<NoteImageUpload>>;
  /** Puts a picture's link into the page's references, so the block shows it. */
  show: (path: string, url: string) => void;
  /** A short line in the hub's notice at the bottom. */
  notify: (message: string) => void;
};

async function measure(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size.width > 0 && size.height > 0 ? size : null;
  } catch {
    return null;
  }
}

const canvasBlob = (canvas: HTMLCanvasElement, type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * A picture larger than the hub keeps (wider than 2400 pixels, more than 6 megapixels or heavier than 9 MB) is shrunk
 * in the browser first, so the upload stays small and the server has little to do; the hub would shrink it to the same
 * size. WebP where the browser writes it, else JPEG on white (JPEG has no transparency).
 */
async function prepare(file: File, width: number, height: number): Promise<{ ok: true; file: File } | { ok: false; error: string }> {
  const target = uploadSize(width, height, file.size);
  if (!target) return { ok: true, file };
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas");
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, target.width, target.height);
    bitmap.close();
    let blob = await canvasBlob(canvas, "image/webp", 0.92);
    if (!blob || blob.type !== "image/webp" || blob.size > NOTE_IMAGE_MAX_BYTES) {
      context.globalCompositeOperation = "destination-over";
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, target.width, target.height);
      blob = await canvasBlob(canvas, "image/jpeg", 0.9);
    }
    if (!blob || blob.size > NOTE_IMAGE_MAX_BYTES) return { ok: false, error: "Das Bild ist auch verkleinert noch größer als 9 MB." };
    const name = `${(file.name || "Bild").replace(/\.[^.]+$/, "")}.${blob.type === "image/webp" ? "webp" : "jpg"}`;
    return { ok: true, file: new File([blob], name, { type: blob.type }) };
  } catch {
    return { ok: false, error: "Das Bild ließ sich im Browser nicht verkleinern. Versuche es mit einem kleineren Ausschnitt." };
  }
}

function removePlaceholder(view: EditorView, id: string) {
  if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(uploadsKey, { remove: id } satisfies UploadsMeta));
}

/** The stored picture in place of its placeholder; it stays selected while the caret still stood where it went. */
function placePicture(view: EditorView, id: string, attrs: Record<string, unknown>) {
  if (view.isDestroyed) return;
  const pos = placeholderAt(view.state, id);
  const tr = view.state.tr.setMeta(uploadsKey, { remove: id } satisfies UploadsMeta);
  if (pos === null) { view.dispatch(tr); return; }
  const follow = pictureAnchor(view.state) === pos;
  try {
    tr.insert(pos, view.state.schema.nodes.noteImage.create(attrs));
    if (follow) tr.setSelection(NodeSelection.create(tr.doc, pos));
    view.dispatch(tr.scrollIntoView());
  } catch {
    removePlaceholder(view, id);
  }
}

/**
 * Puts pictures into the page: placeholders at once where `where` says (asked once the pictures are measured), then
 * one upload after the other. A picture the hub could not take leaves its placeholder with a short notice.
 */
export async function insertPictures(view: EditorView, files: File[], where: () => number | null, ui: NoteImageUi) {
  const jobs: Pending[] = [];
  const sources = new Map<string, File>();
  for (const file of files) {
    const size = await measure(file);
    if (!size) { ui.notify(`„${file.name || "Bild"}“ ließ sich nicht lesen. PNG, JPG, WebP oder GIF gehen.`); continue; }
    const id = `upload-${crypto.randomUUID()}`;
    sources.set(id, file);
    jobs.push({ id, pos: 0, preview: URL.createObjectURL(file), ...size });
  }
  const at = view.isDestroyed ? null : where();
  if (at === null || !jobs.length) { for (const job of jobs) URL.revokeObjectURL(job.preview); return; }
  view.dispatch(view.state.tr.setMeta(uploadsKey, { add: jobs.map((job) => ({ ...job, pos: at })) } satisfies UploadsMeta));
  for (const job of jobs) {
    // Another page opened meanwhile: nothing more goes up for this one.
    if (view.isDestroyed) { URL.revokeObjectURL(job.preview); continue; }
    const ready = await prepare(sources.get(job.id)!, job.width, job.height);
    const result = ready.ok ? await ui.upload(ready.file, { width: job.width, height: job.height }) : ready;
    if (!result.ok) {
      removePlaceholder(view, job.id);
      URL.revokeObjectURL(job.preview);
      ui.notify(result.error);
      continue;
    }
    // The picture still in the browser shows at once and without a second download; a reload signs the stored one.
    ui.show(result.data.image, job.preview);
    placePicture(view, job.id, { image: result.data.image, width: result.data.width, height: result.data.height, size: "large" });
  }
}
