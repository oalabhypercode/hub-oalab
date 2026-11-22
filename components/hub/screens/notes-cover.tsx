"use client";

import { useRef } from "react";
import { X } from "lucide-react";
import { COVER_GROUPS, coverPositionLabel, GALLERY_COVERS, nextCoverPosition } from "@/lib/hub-notes/covers";
import type { NoteCover } from "@/lib/hub-notes/types";
import { useDismiss } from "./notes-settings";

// The cover band over a page (plan 1.6) and its picker. Step 1: the gallery, drawn with CSS like the hub's
// backgrounds, so nothing loads from elsewhere; images from the customer's files and uploads follow in step 2.

export function CoverBand({ cover, editable, onOpenPicker, onPosition, onRemove }: { cover: NoteCover; editable: boolean; onOpenPicker: () => void; onPosition: (position: number) => void; onRemove: () => void }) {
  const style: React.CSSProperties = { backgroundPosition: `center ${cover.position}%` };
  const className = cover.kind === "gallery" ? `nz-cover nz-cv-${cover.value}` : cover.url ? "nz-cover is-image" : "nz-cover nz-cv-calm";
  if (cover.kind !== "gallery" && cover.url) style.backgroundImage = `url("${cover.url.replace(/"/g, "%22")}")`;
  return (
    <div className={className} style={style} role="img" aria-label="Titelbild">
      {cover.kind === "file" && cover.name && <span className="nz-cover-label">{cover.name}</span>}
      {editable && (
        <span className="nz-cover-actions">
          <button type="button" className="nz-glass-btn" onClick={onOpenPicker}>Titelbild ändern</button>
          <button type="button" className="nz-glass-btn" onClick={() => onPosition(nextCoverPosition(cover.position))}>Position: {coverPositionLabel(cover.position)}</button>
          <button type="button" className="nz-glass-btn" onClick={onRemove}>Entfernen</button>
        </span>
      )}
    </div>
  );
}

export function CoverPicker({ value, hasCover, onPick, onRemove, onClose }: { value: string | null; hasCover: boolean; onPick: (key: string) => void; onRemove: () => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useDismiss(box, onClose, "[data-cover-button]");
  return (
    <div ref={box} className={`nz-pop nz-cover-pop nz-glass${hasCover ? " at-cover" : " at-head"}`} role="dialog" aria-label="Titelbild wählen">
      <div className="nz-pop-head">
        <strong>Titelbild</strong>
        {hasCover && <button type="button" className="nz-ghost" onClick={onRemove}>Entfernen</button>}
        <button type="button" className="nz-ibtn" aria-label="Schließen" onClick={onClose}><X size={16} aria-hidden="true" /></button>
      </div>
      {COVER_GROUPS.map((group) => (
        <div key={group.id}>
          <div className="nz-cv-group">{group.label}</div>
          <div className="nz-cv-grid">
            {GALLERY_COVERS.filter((cover) => cover.group === group.id).map((cover) => (
              <button key={cover.key} type="button" className={`nz-cv-item${value === cover.key ? " is-on" : ""}`} aria-pressed={value === cover.key} onClick={() => onPick(cover.key)}>
                <span className={`nz-cv-swatch nz-cv-${cover.key}`} aria-hidden="true" />
                <span className="nz-cv-name">{cover.name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="nz-pop-foot">Bilder aus den Dateien des Kunden und eigene Bilder kommen als Nächstes dazu.</p>
    </div>
  );
}
