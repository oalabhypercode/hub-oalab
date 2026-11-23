"use client";

import { useRef, useState } from "react";
import { ChevronDown, Grid2x2, Grid3x3, Plus, Square, Users } from "lucide-react";
import type { TileSize } from "@/lib/appearance";
import { fileCategories, fileFormat, formatBytes, formatFileDay } from "@/lib/hub-files/catalog";
import { mayBeClear, previewKind, previewUrl } from "@/lib/hub-files/preview";
import type { HubStoredFile } from "@/lib/hub-files/types";
import { detectLogoGround } from "@/lib/hub-logos/ground";
import type { LogoBackground } from "@/lib/hub-logos/rules";
import { GroupCheck, groupTicks } from "../sheet";
import { FileIcon } from "./files-parts";

/** A folder of the open customer (`folder`), a day of „Alle Dateien“, or one group without a heading (the Ablage). */
export type TileGroup = { key: string; label: string; folder: boolean; files: HubStoredFile[] };

const interactive = (target: EventTarget) => target instanceof Element && target.closest("input, label, a, .at-acts") !== null;

/**
 * „Kacheln“ (user 23.11.2026): every file as a card with a picture, so logos and images are recognised at a glance.
 * Images show a small preview the server makes (lib/hub-files/preview.ts): photos fill the picture, see-through logos
 * stand whole on a chequered ground (a light logo on a dark one); other files show their symbol and format. A click
 * opens the details, the tick in the corner (on hover, or always once something is ticked) selects; ⇧ adds a range,
 * Strg or ⌘ one card more. Cards drag like the rows of the other views (asset-drag.ts); folders take files and drops.
 */
export function AssetTiles({ label, groups, size, selected, onSelect, onOpen, openId, fresh, dragIds, live, asOf, isCollapsed, onToggleGroup, isDrop, dropKeyOf, folderActions, customerOf, tagOf, sharedWith, actionsOf, dragAttrs, onAddFolder, emptyFolder }: {
  label: string;
  groups: TileGroup[];
  size: TileSize;
  selected: string[];
  /** The new selection (the page closes a file's details first, as for a tick in the other views). */
  onSelect: (ids: string[]) => void;
  onOpen: (file: HubStoredFile) => void;
  /** The file whose details are open: its card keeps a quiet ring. */
  openId: string | null;
  fresh: string[];
  dragIds: string[];
  /** Real files: previews come from the server; the design preview's example files show themselves. */
  live: boolean;
  asOf: string;
  isCollapsed: (key: string) => boolean;
  onToggleGroup: (key: string) => void;
  isDrop: (key: string) => boolean;
  /** The folder a group takes files for while something is dragged (undefined: none). */
  dropKeyOf: (group: TileGroup) => string | undefined;
  folderActions: (group: TileGroup) => React.ReactNode;
  /** „Alle Dateien“: the customer under the title instead of day and size. */
  customerOf?: (file: HubStoredFile) => React.ReactNode;
  tagOf: (file: HubStoredFile) => React.ReactNode;
  /** The other customers who have the file, at the open customer. */
  sharedWith: (file: HubStoredFile) => string[];
  /** Small buttons on the picture: download, and „Zuordnen“ in the Ablage. */
  actionsOf: (file: HubStoredFile) => React.ReactNode;
  dragAttrs: (file: HubStoredFile) => Record<string, string>;
  onAddFolder?: () => void;
  /** What an empty folder says, by whether files may be put in. */
  emptyFolder: string;
}) {
  const anchor = useRef<string | null>(null);
  const order = groups.flatMap((group) => isCollapsed(group.key) ? [] : group.files.map((file) => file.id));
  const selecting = selected.some((id) => order.includes(id));

  const toggle = (id: string) => { anchor.current = id; onSelect(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]); };
  const range = (id: string) => {
    const from = anchor.current && order.includes(anchor.current) ? order.indexOf(anchor.current) : order.indexOf(id);
    const to = order.indexOf(id);
    const ids = order.slice(Math.min(from, to), Math.max(from, to) + 1);
    onSelect([...selected, ...ids.filter((item) => !selected.includes(item))]);
  };
  function click(event: React.MouseEvent, file: HubStoredFile) {
    if (interactive(event.target)) return;
    if (event.shiftKey) { event.preventDefault(); range(file.id); return; }
    if (event.metaKey || event.ctrlKey) { toggle(file.id); return; }
    anchor.current = file.id;
    onOpen(file);
  }
  const many = (files: HubStoredFile[]) => {
    const ids = files.map((file) => file.id);
    onSelect(ids.every((id) => selected.includes(id)) ? selected.filter((id) => !ids.includes(id)) : [...selected, ...ids.filter((id) => !selected.includes(id))]);
  };

  const card = (file: HubStoredFile) => {
    const isSelected = selected.includes(file.id);
    const others = sharedWith(file);
    return (
      <div key={file.id} role="listitem" className={`at-card am-cat-${file.category}${isSelected ? " is-selected" : ""}${openId === file.id ? " is-open" : ""}${fresh.includes(file.id) ? " is-fresh" : ""}${dragIds.includes(file.id) ? " is-dragged" : ""}`}
        {...dragAttrs(file)} onClick={(event) => click(event, file)}>
        {/* The symbol the drag carries along (asset-drag.ts). */}
        <span className="visually-hidden" data-drag-icon><FileIcon file={file} size={17} color="currentColor" /></span>
        <button type="button" className="at-open" aria-label={`${file.title} öffnen`} data-tip={file.fileName}><TilePicture file={file} live={live} /></button>
        <label className="at-check" data-tip="Auswählen"><input type="checkbox" checked={isSelected} onChange={() => toggle(file.id)} aria-label={`${file.title} auswählen`} /></label>
        <span className="at-acts">{actionsOf(file)}</span>
        <span className="at-meta">
          <span className="at-title"><span className="t">{file.title}</span>{tagOf(file)}<span className={`file-dot file-dot-${file.category}`} data-tip={fileCategories[file.category]}><i aria-hidden="true" /></span></span>
          {customerOf ? <span className="at-sub">{customerOf(file)}</span> : (
            <span className="at-sub">
              <span>{formatFileDay(file.createdAt, asOf)} · {formatBytes(file.sizeBytes)}</span>
              {others.length > 0 && <span className="am-min-shared" data-tip={`Auch bei ${others.join(", ")}`}><Users size={12} aria-hidden="true" />{others.length + 1}</span>}
            </span>
          )}
        </span>
      </div>
    );
  };

  return (
    <div className={`at is-${size}${selecting ? " is-selecting" : ""}`} role="list" aria-label={label}>
      {groups.map((group) => {
        const collapsed = isCollapsed(group.key);
        const ticks = groupTicks(group.files.map((file) => file.id), selected);
        return (
          <div key={group.key} className="at-group" role="presentation" data-drop-folder={dropKeyOf(group)}>
            {group.label && (
              <div className={`am-min-section${isDrop(group.key) ? " is-drop" : ""}`}>
                <span className="am-min-section-check">{group.files.length > 0 && <GroupCheck {...ticks} onChange={() => many(group.files)} label={`Alle Dateien in „${group.label}“ auswählen`} />}</span>
                <button type="button" className="am-min-section-toggle" aria-expanded={!collapsed} onClick={() => onToggleGroup(group.key)}>
                  <ChevronDown size={13} aria-hidden="true" /><span>{group.label}</span><span className="am-min-count">{group.files.length || "leer"}</span>
                </button>
                {group.folder && <span className="am-min-section-acts">{folderActions(group)}</span>}
              </div>
            )}
            {!collapsed && (group.files.length ? <div className="at-grid">{group.files.map(card)}</div> : group.folder && <p className="at-empty">{emptyFolder}</p>)}
          </div>
        );
      })}
      {onAddFolder && <button type="button" className="am-min-add" onClick={onAddFolder}><Plus size={15} aria-hidden="true" />Neuer Ordner</button>}
    </div>
  );
}

/**
 * The picture of a card: an image's preview (photos fill it, see-through ones stand whole on the ground that fits them),
 * else the file's symbol and format; an iPhone photo (HEIC) says it has none. Loads only when it scrolls into view.
 */
function TilePicture({ file, live }: { file: HubStoredFile; live: boolean }) {
  const kind = previewKind(file.fileName, file.mimeType);
  const source = kind !== "image" ? null : file.sampleHref ?? (live ? previewUrl(file, "s") : null);
  const clear = mayBeClear(file.fileName);
  const [state, setState] = useState<"loading" | "shown" | "failed">("loading");
  const [ground, setGround] = useState<LogoBackground | null>(null);
  if (source && state !== "failed") {
    return (
      <span className={`at-thumb is-image${clear ? (ground === "dark" ? " is-dark" : " is-clear") : " is-photo"}${state === "loading" ? " is-loading" : ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a preview the hub made itself, nothing to optimise */}
        <img src={source} alt="" loading="lazy" decoding="async" draggable={false}
          onLoad={(event) => {
            setState("shown");
            const shown = event.currentTarget.currentSrc || source;
            if (clear) detectLogoGround(shown).then(setGround);
          }}
          onError={() => setState("failed")} />
        <span className="at-format">{fileFormat(file.fileName)}</span>
      </span>
    );
  }
  return (
    <span className="at-thumb is-doc">
      <span className="at-doc"><FileIcon file={file} size={34} color="currentColor" /><b>{fileFormat(file.fileName)}</b>{(kind === "heic" || state === "failed") && <small>Keine Vorschau</small>}</span>
    </span>
  );
}

/**
 * The size of the cards, like the size slider at the bottom right of the Finder: in the footer of the list where it
 * stays in sight (from 1024 px wide and 560 px high), else next to the view switch (glass.css shows one of the two).
 */
export function TileSizeSwitch({ size, onChange, place }: { size: TileSize; onChange: (size: TileSize) => void; place: "bottom" | "top" }) {
  const option = (value: TileSize, Icon: typeof Square, tip: string) => (
    <button type="button" className="segment" aria-pressed={size === value} onClick={() => onChange(value)} aria-label={tip} data-tip={tip}><Icon size={14} aria-hidden="true" /></button>
  );
  return (
    <span className={`at-size-wrap is-${place}`}>
      {place === "bottom" && <span className="at-size-label" aria-hidden="true">Größe</span>}
      <span className="segmented-control at-size" role="group" aria-label="Größe der Kacheln">
        {option("small", Grid3x3, "Kleine Kacheln")}{option("medium", Grid2x2, "Mittlere Kacheln")}{option("large", Square, "Große Kacheln")}
      </span>
    </span>
  );
}
