"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { COVER_GROUPS, coverPositionLabel, GALLERY_COVERS, nextCoverPosition } from "@/lib/hub-notes/covers";
import type { NoteCover } from "@/lib/hub-notes/types";
import { useDismiss } from "./notes-settings";

// The cover band over a page (plan 1.6) and its picker with three tabs: the gallery (drawn with CSS like the hub's
// backgrounds), images from the customer's files (who may not see the file sees a calm colour) and an upload, which the
// hub turns into a WebP of 1500 × 500 pixels at the customer's notes. Nothing loads from foreign servers.

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

type CoverFile = { id: string; title: string; url: string | null };

export function CoverPicker({ value, fileId, hasCover, customerName, loadFiles, onPick, onPickFile, onUpload, onRemove, onClose }: {
  value: string | null;
  fileId: string | null;
  hasCover: boolean;
  customerName: string;
  loadFiles?: () => Promise<CoverFile[]>;
  onPick: (key: string) => void;
  onPickFile?: (file: CoverFile) => void;
  onUpload?: (file: File) => Promise<string | null>;
  onRemove: () => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"gallery" | "files" | "upload">("gallery");
  const [files, setFiles] = useState<CoverFile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useDismiss(box, onClose, "[data-cover-button]");
  useEffect(() => {
    if (tab !== "files" || files || !loadFiles) return;
    let live = true;
    void loadFiles().then((found) => { if (live) setFiles(found); });
    return () => { live = false; };
  }, [tab, files, loadFiles]);
  const upload = async (file: File | undefined) => {
    if (!file || !onUpload) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setError("Als Titelbild gehen JPG, PNG oder WebP."); return; }
    if (file.size > 5 * 1024 * 1024) { setError("Ein Titelbild darf höchstens 5 MB groß sein."); return; }
    setBusy(true);
    setError("");
    const failed = await onUpload(file);
    setBusy(false);
    if (failed) setError(failed);
  };
  return (
    <div ref={box} className={`nz-pop nz-cover-pop nz-glass${hasCover ? " at-cover" : " at-head"}`} role="dialog" aria-label="Titelbild wählen">
      <div className="nz-pop-head">
        <strong>Titelbild</strong>
        {hasCover && <button type="button" className="nz-ghost" onClick={onRemove}>Entfernen</button>}
        <button type="button" className="nz-ibtn" aria-label="Schließen" onClick={onClose}><X size={16} aria-hidden="true" /></button>
      </div>
      {(loadFiles || onUpload) && (
        <div className="nz-cv-tabs" role="tablist" aria-label="Quelle des Titelbilds">
          {([["gallery", "Galerie"], ...(loadFiles ? [["files", "Aus den Dateien"]] : []), ...(onUpload ? [["upload", "Hochladen"]] : [])] as [typeof tab, string][]).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`nz-cv-tab${tab === id ? " is-on" : ""}`} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
      )}
      {tab === "files" && (
        <>
          <p className="nz-pop-note is-pad">{files?.length ? `Bilder aus den Dateien von ${customerName}. Wer eine Datei nicht sehen darf, sieht statt des Bildes eine ruhige Farbe.` : files ? `Bei ${customerName} liegen noch keine Bilder in den Dateien.` : "Lädt …"}</p>
          <div className="nz-cv-grid">
            {(files ?? []).map((file) => (
              <button key={file.id} type="button" className={`nz-cv-item${fileId === file.id ? " is-on" : ""}`} aria-pressed={fileId === file.id} onClick={() => onPickFile?.(file)}>
                <span className="nz-cv-swatch" style={file.url ? { backgroundImage: `url("${file.url.replace(/"/g, "%22")}")`, backgroundSize: "cover" } : undefined} aria-hidden="true" />
                <span className="nz-cv-name">{file.title}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {tab === "upload" && (
        <div className="nz-cv-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void upload(event.dataTransfer.files[0]); }}>
          <ImagePlus size={22} aria-hidden="true" />
          <strong>Bild hierher ziehen</strong>
          <span>JPG, PNG oder WebP bis 5 MB, am besten 1500 × 500 Pixel. Es landet bei den Notizen des Kunden und ist so sichtbar wie diese Seite.</span>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => void upload(event.target.files?.[0])} />
          <button type="button" className="nz-btn" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Lädt hoch …" : "Bild auswählen"}</button>
          {error && <p className="nz-pop-note is-warn">{error}</p>}
        </div>
      )}
      {tab === "gallery" && COVER_GROUPS.map((group) => (
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
    </div>
  );
}
