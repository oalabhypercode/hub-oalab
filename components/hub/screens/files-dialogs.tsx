"use client";

import { useState } from "react";
import { Check, Download, Trash2, Users } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { createDownloadUrl, setFileAssignments, type ActionResult } from "@/lib/hub-files/actions";
import { fileCategories, fileFormat, formatBytes, formatFileDateTime, MAX_FOLDER_NAME } from "@/lib/hub-files/catalog";
import type { HubFileCustomer, HubFolder, HubStoredFile } from "@/lib/hub-files/types";
import type { SortValue } from "@/lib/table-tools";
import { useInfo } from "../info-box";
import { Modal } from "../modal";
import { alphabetical, type SortOption } from "../table-tools";
import { CategoryPill, CustomerPicker, FileIcon } from "./files-parts";

/** Fixture samples are plain links; real files get a 60-second signed URL from the server first. */
export function DownloadButton({ file, onError, label = false, compact = false, className: look }: { file: HubStoredFile; onError: (message: string) => void; label?: boolean; compact?: boolean; className?: string }) {
  const [busy, setBusy] = useState(false);
  const content = <>{busy ? <MiniLoader size={18} /> : <Download size={18} aria-hidden="true" />}{label && <span>Herunterladen</span>}</>;
  const className = look ?? (label ? "sheet-button sheet-button-primary" : compact ? "am-icon-btn is-accent" : "file-download");
  if (file.sampleHref) {
    return <a className={className} href={file.sampleHref} download={file.fileName} aria-label={label ? undefined : `${file.title} herunterladen`} title={label ? undefined : "Herunterladen"}>{content}</a>;
  }
  async function download() {
    setBusy(true);
    const result = await createDownloadUrl(file.id);
    setBusy(false);
    if (result.ok) window.location.assign(result.data.url);
    else onError(result.error);
  }
  return <button type="button" className={className} onClick={download} disabled={busy} aria-label={label ? undefined : `${file.title} herunterladen`} title={label ? undefined : "Herunterladen"}>{content}</button>;
}

/** All details of a file; admins can change the customer assignment here. */
export function FileDetailDialog({ file, customers, folders, canManage, onClose, startEditing = false }: { file: HubStoredFile; customers: HubFileCustomer[]; folders: HubFolder[]; canManage: boolean; onClose: () => void; startEditing?: boolean }) {
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(startEditing && canManage);
  const [selected, setSelected] = useState(file.customers.map((customer) => customer.id));
  const [saving, setSaving] = useState(false);
  const folderName = (customerId: string) => folders.find((folder) => folder.id === file.folderIds[customerId])?.name ?? "Ohne Ordner";

  async function save() {
    setSaving(true);
    const result = await setFileAssignments(file.id, selected);
    setSaving(false);
    if (result.ok) { setEditing(false); setError(""); } else setError(result.error);
  }

  return (
    <Modal title={file.title} onClose={onClose}>
      <div className="file-detail-head"><span className="modal-file-icon"><FileIcon file={file} size={30} /></span><span><strong>{file.fileName}</strong><small>{fileFormat(file.fileName)} · {formatBytes(file.sizeBytes)}</small></span></div>
      <dl className="file-details">
        <div><dt>Kategorie</dt><dd><CategoryPill category={file.category} /></dd></div>
        <div className="file-details-block"><dt>Beschreibung</dt><dd>{file.description || "Keine Beschreibung hinterlegt."}</dd></div>
        <div><dt>Originaldatei</dt><dd>{file.fileName}</dd></div>
        <div><dt>Format</dt><dd>{fileFormat(file.fileName)} ({file.mimeType})</dd></div>
        <div><dt>Größe</dt><dd>{formatBytes(file.sizeBytes)} ({new Intl.NumberFormat("de-DE").format(file.sizeBytes)} Bytes)</dd></div>
        <div><dt>Bereitgestellt</dt><dd>{formatFileDateTime(file.createdAt)}</dd></div>
        <div><dt>{file.customers.length > 1 ? "Kunden" : "Kunde"}</dt><dd>{file.customers.length ? file.customers.map((customer) => `${customer.customerNumber} · ${customer.company}`).join(", ") : "Ablage (keinem Kunden zugeordnet)"}</dd></div>
        {file.customers.length > 0 && <div><dt>Ordner</dt><dd>{file.customers.length === 1 ? folderName(file.customers[0].id) : file.customers.map((customer) => `${customer.customerNumber}: ${folderName(customer.id)}`).join(", ")}</dd></div>}
        {file.sha256 && <div className="file-details-block"><dt>Prüfsumme (SHA-256)</dt><dd className="file-checksum">{file.sha256}</dd></div>}
      </dl>
      {file.sha256 && <p className="t-footnote t-secondary file-detail-note">Der Download liefert genau diese Fassung. Die Prüfsumme wurde beim Upload berechnet.</p>}
      {file.sampleHref && <p className="t-footnote t-secondary file-detail-note">Fiktive Beispieldatei für die Demo.</p>}
      {canManage && editing && (
        <div className="file-assign">
          <CustomerPicker customers={customers} selected={selected} onChange={setSelected} idPrefix={`assign-${file.id}`} />
          <div className="file-assign-actions">
            <button type="button" className="sheet-button" onClick={() => { setEditing(false); setSelected(file.customers.map((customer) => customer.id)); }} disabled={saving}>Abbrechen</button>
            <button type="button" className="sheet-button sheet-button-primary" onClick={save} disabled={saving}>{saving ? <MiniLoader size={18} /> : <Check size={18} aria-hidden="true" />}Zuordnung speichern</button>
          </div>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="file-detail-actions">
        {canManage && !editing && <button type="button" className="sheet-button" onClick={() => setEditing(true)}><Users size={18} aria-hidden="true" />Zuordnung ändern</button>}
        <DownloadButton file={file} onError={setError} label />
      </div>
    </Modal>
  );
}

/** Name a new folder or rename one; the same window for admins, customers and freelancers. */
export function FolderNameDialog({ title, initial, onSave, onClose }: { title: string; initial: string; onSave: (name: string) => Promise<ActionResult<unknown>>; onClose: () => void }) {
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const info = useInfo("Ordner", {
    steps: [
      <><b>Eine Ebene</b> je Firma, jeder Name einmal.</>,
      <><b>Alle Logins der Firma</b> sehen dieselben Ordner.</>,
      <><b>Löschen</b> schiebt die Dateien nach „Ohne Ordner“.</>,
    ],
    ask: "Wie funktionieren Ordner in den Dateien?",
  });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const result = await onSave(name);
    setSaving(false);
    if (result.ok) onClose(); else setError(result.error);
  }

  return (
    <Modal title={title} onClose={onClose} actions={info.button}>
      {info.box}
      <form onSubmit={submit} className="upload-form">
        <label className="upload-field"><span>Name des Ordners</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={MAX_FOLDER_NAME} placeholder="z. B. Verträge, Logos, Briefings" autoFocus required disabled={saving} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="file-assign-actions">
          <button type="button" className="sheet-button" onClick={onClose} disabled={saving}>Abbrechen</button>
          <button type="submit" className="sheet-button sheet-button-primary" disabled={saving || !name.trim()}>{saving ? <MiniLoader size={18} /> : <Check size={18} aria-hidden="true" />}Speichern</button>
        </div>
      </form>
    </Modal>
  );
}

export function DeleteFolderDialog({ folder, count, onDelete, onClose }: { folder: HubFolder; count: number; onDelete: () => Promise<ActionResult<unknown>>; onClose: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  async function confirm() {
    setDeleting(true);
    const result = await onDelete();
    setDeleting(false);
    if (result.ok) onClose(); else setError(result.error);
  }
  return (
    <Modal title={`„${folder.name}“ löschen?`} onClose={onClose}>
      <p className="modal-description">{count ? `${count === 1 ? "Die Datei darin landet" : `Die ${count} Dateien darin landen`} in „Ohne Ordner“. Gelöscht wird keine Datei.` : "Der Ordner ist leer."}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="file-assign-actions">
        <button type="button" className="sheet-button" onClick={onClose} disabled={deleting}>Abbrechen</button>
        <button type="button" className="sheet-button sheet-button-danger" onClick={confirm} disabled={deleting}>{deleting ? <MiniLoader size={18} /> : <Trash2 size={18} aria-hidden="true" />}Ordner löschen</button>
      </div>
    </Modal>
  );
}

const names = (list: string[]) => list.length <= 3 ? list.join(", ").replace(/, ([^,]*)$/, " und $1") : `${list.slice(0, 2).join(", ")} und ${list.length - 2} weiteren Kunden`;

/** Deleting files for good: first says where they disappear, then deletes record and stored file. */
export function DeleteFilesDialog({ files, onDelete, onClose }: { files: HubStoredFile[]; onDelete: () => Promise<ActionResult<unknown>>; onClose: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const one = files.length === 1 ? files[0] : null;
  const companies = Array.from(new Set(files.flatMap((file) => file.customers.map((customer) => customer.company))));
  const where = companies.length
    ? `${one ? "Die Datei verschwindet" : `Die ${files.length} Dateien verschwinden`} bei ${names(companies)}.`
    : `${one ? "Die Datei liegt" : "Die Dateien liegen"} in der Ablage, kein Kunde sieht sie.`;
  async function confirm() {
    setDeleting(true);
    const result = await onDelete();
    setDeleting(false);
    if (result.ok) onClose(); else setError(result.error);
  }
  return (
    <Modal title={one ? `„${one.title}“ löschen?` : `${files.length} Dateien löschen?`} onClose={onClose}>
      <p className="modal-description">{where} Das lässt sich nicht rückgängig machen.</p>
      {one && one.customers.length > 1 && <p className="modal-description">Soll sie nur bei einem der Kunden verschwinden, nimm stattdessen „Zuordnung ändern“ in den Details.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="file-assign-actions">
        <button type="button" className="sheet-button" onClick={onClose} disabled={deleting}>Abbrechen</button>
        <button type="button" className="sheet-button sheet-button-danger" onClick={confirm} disabled={deleting}>{deleting ? <MiniLoader size={18} /> : <Trash2 size={18} aria-hidden="true" />}Endgültig löschen</button>
      </div>
    </Modal>
  );
}

export type FolderDialog = { kind: "create" } | { kind: "rename" | "delete"; folder: HubFolder };

export type FileSortKey = "date" | "title" | "category" | "format" | "size";
export const fileSorts: Record<FileSortKey, SortOption<FileSortKey>> = {
  date: { id: "date", label: "Bereitgestellt", firstDir: "desc", dirLabels: { asc: "älteste zuerst", desc: "neueste zuerst" } },
  title: { id: "title", label: "Titel", dirLabels: alphabetical },
  category: { id: "category", label: "Kategorie", dirLabels: alphabetical },
  format: { id: "format", label: "Format", dirLabels: alphabetical },
  size: { id: "size", label: "Größe", firstDir: "desc", dirLabels: { asc: "kleinste zuerst", desc: "größte zuerst" } },
};
export const fileSortValue: Record<FileSortKey, (file: HubStoredFile) => SortValue> = {
  date: (file) => file.createdAt,
  title: (file) => file.title,
  category: (file) => fileCategories[file.category],
  format: (file) => fileFormat(file.fileName),
  size: (file) => file.sizeBytes,
};
