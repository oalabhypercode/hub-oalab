"use client";

import { useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp, Folder } from "lucide-react";
import { fileCategories, fileKind, formatBytes, formatFileStamp } from "@/lib/hub-files/catalog";
import type { HubFolder, HubStoredFile } from "@/lib/hub-files/types";
import { nextSort, type SortState } from "@/lib/table-tools";
import { fileSorts, type FileSortKey } from "./files-dialogs";
import { FileIcon } from "./files-parts";

/** One folder of the open customer with its shown files; the files without a folder come as `folder: null`. */
export type ListGroup = { key: string; label: string; folder: HubFolder | null; files: HubStoredFile[] };

type Line =
  | { kind: "folder"; key: string; group: ListGroup }
  | { kind: "file"; key: string; file: HubStoredFile; parent: string | null };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const lineId = (key: string) => `fl-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
const interactive = (target: EventTarget) => target instanceof Element && target.closest("button, a, input") !== null;

/**
 * „Liste“, the list view of the Asset Management (user 19.11.2026), after the Finder's list view on the Mac: one low,
 * striped line per entry with the columns Name, Bereitgestellt, Größe and Art (and Kunde under „Alle Dateien“), the
 * category as a coloured tag dot like the Finder's tags, and the open customer's folders as lines with a triangle
 * that opens them in place. A click selects a file, ⇧ a range, Strg or ⌘ one more; a double click, Enter or the space
 * bar opens its details. The arrow keys walk the lines (→ opens a folder, ← closes it), Strg or ⌘ + A selects all.
 * Selected lines take the accent while the list has the focus, like the Finder's. On touch screens a tap selects and
 * the arrow at the end of a line opens it. Files drag from here like from the other lists (asset-drag.ts).
 */
export function FinderList({ label, groups, files, showCustomer, selected, onSelect, onOpen, fresh, dragIds, isDrop, isCollapsed, onToggle, sort, onSort, folderActions, customerOf, dragAttrs, canDropFolders, asOf }: {
  label: string;
  /** The open customer's folders; null for the Ablage and „Alle Dateien“, which list `files` flat. */
  groups: ListGroup[] | null;
  files: HubStoredFile[];
  showCustomer: boolean;
  selected: string[];
  onSelect: (ids: string[]) => void;
  onOpen: (file: HubStoredFile) => void;
  fresh: string[];
  dragIds: string[];
  /** Whether a drag (files from the computer or from the list) would land in this folder ("none": without one). */
  isDrop: (key: string) => boolean;
  isCollapsed: (key: string) => boolean;
  onToggle: (key: string) => void;
  sort: SortState<FileSortKey>;
  onSort: (sort: SortState<FileSortKey>) => void;
  folderActions: (group: ListGroup) => React.ReactNode;
  customerOf: (file: HubStoredFile) => React.ReactNode;
  dragAttrs: (file: HubStoredFile) => Record<string, string>;
  canDropFolders: boolean;
  asOf: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const anchor = useRef<string | null>(null);
  const pending = useRef<string | null>(null);
  const pointer = useRef("mouse");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // The ring around the current line shows while the keyboard walks the list, not after a click (like the Finder).
  const [keys, setKeys] = useState(false);

  const lines: Line[] = [];
  if (groups) {
    for (const group of groups) {
      if (!group.folder) continue;
      lines.push({ kind: "folder", key: `folder:${group.key}`, group });
      if (!isCollapsed(group.key)) for (const file of group.files) lines.push({ kind: "file", key: file.id, file, parent: group.key });
    }
    for (const file of groups.find((group) => !group.folder)?.files ?? []) lines.push({ kind: "file", key: file.id, file, parent: null });
  } else for (const file of files) lines.push({ kind: "file", key: file.id, file, parent: null });
  const order = lines.flatMap((line) => line.kind === "file" ? [line.file.id] : []);
  const active = lines.some((line) => line.key === activeKey) ? activeKey : null;

  const only = (id: string) => { anchor.current = id; onSelect([id]); };
  const toggle = (id: string) => { anchor.current = id; onSelect(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]); };
  const range = (id: string) => {
    const from = anchor.current && order.includes(anchor.current) ? order.indexOf(anchor.current) : order.indexOf(id);
    const to = order.indexOf(id);
    onSelect(order.slice(Math.min(from, to), Math.max(from, to) + 1));
  };
  const reach = (line: Line | undefined, extend = false) => {
    if (!line) return;
    setActiveKey(line.key);
    document.getElementById(lineId(line.key))?.scrollIntoView({ block: "nearest" });
    if (line.kind === "file") { if (extend) range(line.file.id); else only(line.file.id); }
    else if (!extend) { anchor.current = null; onSelect([]); }
  };

  function onKeyDown(event: React.KeyboardEvent) {
    if (interactive(event.target) && event.target !== box.current) return;
    if (!keys && event.key !== "Shift" && event.key !== "Control" && event.key !== "Meta") setKeys(true);
    const index = lines.findIndex((line) => line.key === active);
    const line = index >= 0 ? lines[index] : undefined;
    const key = event.key;
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      reach(lines[index < 0 ? (key === "ArrowDown" ? 0 : lines.length - 1) : Math.max(0, Math.min(lines.length - 1, index + (key === "ArrowDown" ? 1 : -1)))], event.shiftKey);
    } else if (key === "Home" || key === "End") {
      event.preventDefault();
      reach(key === "Home" ? lines[0] : lines[lines.length - 1], event.shiftKey);
    } else if (key === "ArrowRight" && line?.kind === "folder") {
      event.preventDefault();
      if (isCollapsed(line.group.key)) onToggle(line.group.key);
    } else if (key === "ArrowLeft" && line) {
      event.preventDefault();
      if (line.kind === "folder") { if (!isCollapsed(line.group.key)) onToggle(line.group.key); }
      else if (line.parent) reach(lines.find((item) => item.kind === "folder" && item.group.key === line.parent));
    } else if ((key === "Enter" || key === " ") && line) {
      event.preventDefault();
      if (line.kind === "folder") onToggle(line.group.key); else onOpen(line.file);
    } else if (key.toLowerCase() === "a" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSelect(order);
    } else if (key === "Escape" && selected.length) {
      event.stopPropagation();
      onSelect([]);
    }
  }

  // A press selects at once (so a drag carries it), unless the line is part of the selection already: then the click
  // narrows it to this line, if no drag followed. ⇧ adds a range, Strg or ⌘ one line more.
  function press(event: React.PointerEvent, line: Line) {
    pointer.current = event.pointerType;
    if (event.pointerType !== "mouse" || event.button !== 0 || interactive(event.target)) return;
    box.current?.focus({ preventScroll: true });
    setActiveKey(line.key);
    setKeys(false);
    pending.current = null;
    if (line.kind === "folder") return;
    const id = line.file.id;
    if (event.shiftKey) { event.preventDefault(); range(id); }
    else if (event.metaKey || event.ctrlKey) toggle(id);
    else if (!selected.includes(id)) only(id);
    else pending.current = id;
  }
  function click(event: React.MouseEvent, line: Line) {
    if (interactive(event.target)) return;
    if (line.kind === "folder") { if (pointer.current !== "mouse") onToggle(line.group.key); return; }
    if (pointer.current !== "mouse") { setActiveKey(line.key); toggle(line.file.id); return; }
    if (pending.current === line.file.id && !event.shiftKey && !event.metaKey && !event.ctrlKey) only(line.file.id);
    pending.current = null;
  }

  const head = (key: FileSortKey | null, text: string, className: string) => {
    const on = key !== null && sort.key === key;
    return (
      <span role="columnheader" className={`fl-col ${className}`} aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
        {key ? (
          <button type="button" className={`fl-sort${on ? " is-active" : ""}`} onClick={() => onSort(nextSort(sort, key, fileSorts[key].firstDir))} data-tip={`Nach ${text} sortieren`}>
            <span>{text}</span>{on && (sort.dir === "asc" ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />)}
          </button>
        ) : <span>{text}</span>}
      </span>
    );
  };

  return (
    <div ref={box} className={`fl${showCustomer ? " has-customer" : ""}`} role="treegrid" aria-label={label} aria-multiselectable="true" tabIndex={0} data-keys={keys ? "" : undefined}
      aria-activedescendant={active ? lineId(active) : undefined} onKeyDown={onKeyDown}>
      <div className="fl-head" role="row">
        {head("title", "Name", "fl-name")}
        {showCustomer && head(null, "Kunde", "fl-customer")}
        {head("date", "Bereitgestellt", "fl-date")}
        {head("size", "Größe", "fl-size")}
        {head("format", "Art", "fl-kind")}
      </div>
      <div className={`fl-body${isDrop("none") ? " is-drop" : ""}`} role="rowgroup" data-drop-folder={groups && canDropFolders ? "none" : undefined}
        onPointerDown={(event) => { if (event.target === event.currentTarget && event.pointerType === "mouse") { box.current?.focus({ preventScroll: true }); setActiveKey(null); onSelect([]); } }}>
        {lines.map((line, index) => {
          const alt = index % 2 === 1 ? " is-alt" : "";
          const current = line.key === active ? " is-active" : "";
          if (line.kind === "folder") {
            const { group } = line;
            const open = !isCollapsed(group.key);
            const newest = group.files.reduce((last, file) => (file.createdAt > last ? file.createdAt : last), "");
            return (
              <div key={line.key} id={lineId(line.key)} role="row" aria-level={1} aria-expanded={open} className={`fl-row is-folder${alt}${current}${isDrop(group.key) ? " is-drop" : ""}`}
                data-drop-folder={canDropFolders ? group.key : undefined} onPointerDown={(event) => press(event, line)} onClick={(event) => click(event, line)} onDoubleClick={() => onToggle(group.key)}>
                <span role="gridcell" className="fl-cell fl-name">
                  <button type="button" className="fl-twist" tabIndex={-1} onClick={() => onToggle(group.key)} aria-label={`${group.label} ${open ? "zuklappen" : "aufklappen"}`}><ChevronRight size={13} aria-hidden="true" /></button>
                  <span className="fl-icon is-folder"><Folder size={16} strokeWidth={1.8} aria-hidden="true" /></span>
                  <span className="fl-title">{group.label}</span>
                  <span className="fl-acts">{folderActions(group)}</span>
                </span>
                {showCustomer && <span role="gridcell" className="fl-cell fl-customer" />}
                <span role="gridcell" className="fl-cell fl-date">{newest ? formatFileStamp(newest, asOf) : "–"}</span>
                <span role="gridcell" className="fl-cell fl-size">{group.files.length ? plural(group.files.length, "Datei", "Dateien") : "leer"}</span>
                <span role="gridcell" className="fl-cell fl-kind">Ordner</span>
              </div>
            );
          }
          const { file } = line;
          const isSelected = selected.includes(file.id);
          return (
            <div key={line.key} id={lineId(line.key)} role="row" aria-level={line.parent ? 2 : 1} aria-selected={isSelected}
              className={`fl-row${alt}${current}${isSelected ? " is-selected" : ""}${fresh.includes(file.id) ? " is-fresh" : ""}${dragIds.includes(file.id) ? " is-dragged" : ""}`}
              data-drop-folder={groups && canDropFolders ? line.parent ?? "none" : undefined} {...dragAttrs(file)}
              onPointerDown={(event) => press(event, line)} onClick={(event) => click(event, line)} onDoubleClick={(event) => { if (!interactive(event.target)) onOpen(file); }}>
              <span role="gridcell" className={`fl-cell fl-name${line.parent ? " is-inner" : ""}`}>
                <span className="fl-twist is-none" aria-hidden="true" />
                <span className={`fl-icon am-cat-${file.category}`}><FileIcon file={file} size={16} color="currentColor" /></span>
                <span className="fl-title" data-tip={file.fileName}>{file.title}</span>
                <span className={`file-dot file-dot-${file.category} fl-tag`} data-tip={fileCategories[file.category]}><i aria-hidden="true" /></span>
                <button type="button" className="fl-open" onClick={() => onOpen(file)} aria-label={`${file.title} öffnen`}><ChevronRight size={16} aria-hidden="true" /></button>
              </span>
              {showCustomer && <span role="gridcell" className="fl-cell fl-customer">{customerOf(file)}</span>}
              <span role="gridcell" className="fl-cell fl-date">{formatFileStamp(file.createdAt, asOf)}</span>
              <span role="gridcell" className="fl-cell fl-size">{formatBytes(file.sizeBytes)}</span>
              <span role="gridcell" className="fl-cell fl-kind">{fileKind(file.fileName)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
