"use client";

import { useMemo, useState } from "react";
import { Check, Download, Folder, FolderPlus, Inbox, Loader2, Pencil, Search, Trash2, Users, X } from "lucide-react";
import { createDownloadUrl, setFileAssignments, type ActionResult } from "@/lib/hub-files/actions";
import { fileCategories, fileCategoryIds, fileFormat, formatBytes, formatFileDate, formatFileDateTime, MAX_FOLDER_NAME } from "@/lib/hub-files/catalog";
import type { HubFileCustomer, HubFolder, HubStoredFile } from "@/lib/hub-files/types";
import { CategoryMetrics, CategoryTitle } from "./workspace";
import { HeaderActions } from "../app-shell";
import { GlassCard, SectionHeader } from "../glass";
import { LargeTitleHeader } from "../large-title-header";
import { Modal } from "../modal";
import { EmptyState } from "./overview";
import { CategoryPill, CustomerPicker, FileIcon } from "./files-parts";
import { useFilesStore } from "./files-store";
import { FileUploadCard } from "./files-upload";
import type { ScreenProps } from "./types";

const ALL = "all";
const UNASSIGNED = "unassigned";
const NO_FOLDER = "none";

/** Fixture samples are plain links; real files get a 60-second signed URL from the server first. */
function DownloadButton({ file, onError, label = false }: { file: HubStoredFile; onError: (message: string) => void; label?: boolean }) {
  const [busy, setBusy] = useState(false);
  const content = <>{busy ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <Download size={18} aria-hidden="true" />}{label && <span>Herunterladen</span>}</>;
  const className = label ? "sheet-button sheet-button-primary" : "file-download";
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
function FileDetailDialog({ file, customers, folders, canManage, onClose }: { file: HubStoredFile; customers: HubFileCustomer[]; folders: HubFolder[]; canManage: boolean; onClose: () => void }) {
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
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
            <button type="button" className="sheet-button sheet-button-primary" onClick={save} disabled={saving}>{saving ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}Zuordnung speichern</button>
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

/** Name a new folder or rename one. */
function FolderNameDialog({ title, initial, onSave, onClose }: { title: string; initial: string; onSave: (name: string) => Promise<ActionResult<unknown>>; onClose: () => void }) {
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const result = await onSave(name);
    setSaving(false);
    if (result.ok) onClose(); else setError(result.error);
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="upload-form">
        <label className="upload-field"><span>Name des Ordners</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={MAX_FOLDER_NAME} placeholder="z. B. Verträge, Logos, Briefings" autoFocus required disabled={saving} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="file-assign-actions">
          <button type="button" className="sheet-button" onClick={onClose} disabled={saving}>Abbrechen</button>
          <button type="submit" className="sheet-button sheet-button-primary" disabled={saving || !name.trim()}>{saving ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}Speichern</button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteFolderDialog({ folder, count, onDelete, onClose }: { folder: HubFolder; count: number; onDelete: () => Promise<ActionResult<unknown>>; onClose: () => void }) {
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
        <button type="button" className="sheet-button sheet-button-danger" onClick={confirm} disabled={deleting}>{deleting ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <Trash2 size={18} aria-hidden="true" />}Ordner löschen</button>
      </div>
    </Modal>
  );
}

type FolderDialog = { kind: "create" } | { kind: "rename" | "delete"; folder: HubFolder };

export function FilesScreen({ model, populated, fileState }: ScreenProps) {
  const store = useFilesStore(fileState);
  const { files, folders } = store;
  const { customers, canManage, source } = fileState;
  const [category, setCategory] = useState<string>(ALL);
  const [customer, setCustomer] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [folderChoice, setFolderChoice] = useState<{ scope: string | null; folder: string }>({ scope: null, folder: ALL });
  const [selected, setSelected] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<FolderDialog | null>(null);
  const [busy, setBusy] = useState<"download" | "move" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const showCustomers = canManage || customers.length > 1;
  // Folders belong to one customer: customers see their own, admins those of the customer chosen in the filter.
  const scope = showCustomers ? (customer !== ALL && customer !== UNASSIGNED ? customer : null) : customers[0]?.id ?? null;
  const scopeFolders = useMemo(() => folders.filter((item) => item.customerId === scope), [folders, scope]);
  const folder = folderChoice.scope === scope && (folderChoice.folder === ALL || folderChoice.folder === NO_FOLDER || scopeFolders.some((item) => item.id === folderChoice.folder)) ? folderChoice.folder : ALL;
  const activeFolder = scopeFolders.find((item) => item.id === folder);
  const inFolder = (file: HubStoredFile, folderId: string) => !scope || folderId === ALL || (folderId === NO_FOLDER ? !file.folderIds[scope] : file.folderIds[scope] === folderId);
  const term = query.trim().toLowerCase();
  const shown = files.filter((file) =>
    (category === ALL || file.category === category)
    && (customer === ALL || (customer === UNASSIGNED ? !file.customers.length : file.customers.some((item) => item.id === customer)))
    && (!term || `${file.title} ${file.fileName} ${file.description}`.toLowerCase().includes(term))
    && inFolder(file, folder));
  const scopeFiles = scope ? files.filter((file) => file.customers.some((item) => item.id === scope)) : [];
  const countIn = (folderId: string) => scopeFiles.filter((file) => inFolder(file, folderId)).length;
  const selection = shown.filter((file) => selected.includes(file.id));
  const openFile = files.find((file) => file.id === openId);
  const usedCategories = fileCategoryIds.filter((id) => files.some((file) => file.category === id));
  const canOrganize = Boolean(scope) && !fileState.error;

  const chooseFolder = (next: string) => { setFolderChoice({ scope, folder: next }); setNotice(""); };
  const toggle = (id: string) => setSelected((list) => list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
  const toggleAll = () => setSelected(selection.length === shown.length ? [] : shown.map((file) => file.id));

  async function download() {
    setBusy("download");
    setError("");
    const result = await store.download(selection);
    setBusy(null);
    if (!result.ok) setError(result.error);
  }

  async function move(target: string) {
    if (!scope || !target) return;
    setBusy("move");
    setError("");
    const folderId = target === NO_FOLDER ? null : target;
    const result = await store.move(selection.map((file) => file.id), scope, folderId);
    setBusy(null);
    if (!result.ok) { setError(result.error); return; }
    const name = folderId ? scopeFolders.find((item) => item.id === folderId)?.name : "Ohne Ordner";
    setNotice(`${result.data.count === 1 ? "1 Datei" : `${result.data.count} Dateien`} nach „${name}“ verschoben.`);
    setSelected([]);
  }

  if (source === "fixtures" && !populated) {
    return <><LargeTitleHeader title="Dateien" icon={<CategoryTitle category="files" />} actions={<HeaderActions />} /><EmptyState section="files" /></>;
  }

  return (
    <>
      <LargeTitleHeader title="Dateien" icon={<CategoryTitle category="files" />} actions={<HeaderActions />} />
      {files.length > 0 && <CategoryMetrics model={model} category="files" />}
      {fileState.error && <GlassCard className="section-first"><p className="t-headline">Dateien nicht verfügbar</p><p className="t-subheadline t-secondary">{fileState.error}</p></GlassCard>}

      {canManage && source === "supabase" && !fileState.error && <><SectionHeader title="Hochladen" /><FileUploadCard customers={customers} folders={folders} /></>}
      {source === "fixtures" && <GlassCard className="section-first file-demo-note"><Inbox size={18} color="var(--accent-text)" aria-hidden="true" /><p className="t-subheadline">{customers.length > 1 ? "Hochladen und Zuordnen ist nur mit echtem Admin-Login möglich. " : ""}Die Tabelle zeigt fiktive Beispieldateien. Ordner und Verschiebungen bleiben in diesem Browserfenster.</p></GlassCard>}

      {!fileState.error && <>
        <SectionHeader title={canManage ? "Alle Dateien" : "Deine Dateien"} />
        <div className="list-toolbar file-toolbar">
          <label className="search-input glass glass-float"><Search size={16} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Titel, Dateiname oder Beschreibung" aria-label="Dateien durchsuchen" /></label>
          <label className="glass customer-filter"><span>Kategorie</span><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Nach Kategorie filtern"><option value={ALL}>Alle</option>{usedCategories.map((id) => <option key={id} value={id}>{fileCategories[id]}</option>)}</select></label>
          {showCustomers && <label className="glass customer-filter"><span>Kunde</span><select value={customer} onChange={(event) => setCustomer(event.target.value)} aria-label="Nach Kunde filtern"><option value={ALL}>Alle</option>{customers.map((item) => <option key={item.id} value={item.id}>{item.customerNumber} · {item.company}</option>)}{canManage && <option value={UNASSIGNED}>Ablage (ohne Zuordnung)</option>}</select></label>}
        </div>

        {canOrganize ? (
          <div className="folder-bar" role="group" aria-label="Ordner">
            <button type="button" className="folder-chip" aria-pressed={folder === ALL} onClick={() => chooseFolder(ALL)}>Alle Dateien <span className="numeric">{scopeFiles.length}</span></button>
            {scopeFolders.map((item) => <button key={item.id} type="button" className="folder-chip" aria-pressed={folder === item.id} onClick={() => chooseFolder(item.id)}><Folder size={15} aria-hidden="true" />{item.name} <span className="numeric">{countIn(item.id)}</span></button>)}
            <button type="button" className="folder-chip" aria-pressed={folder === NO_FOLDER} onClick={() => chooseFolder(NO_FOLDER)}>Ohne Ordner <span className="numeric">{countIn(NO_FOLDER)}</span></button>
            <button type="button" className="folder-add" onClick={() => setDialog({ kind: "create" })}><FolderPlus size={16} aria-hidden="true" />Neuer Ordner</button>
          </div>
        ) : showCustomers && customer !== UNASSIGNED && <p className="t-footnote folder-hint">Wähle oben einen Kunden, um seine Ordner zu sehen und Dateien einzusortieren.</p>}
        {activeFolder && (
          <div className="folder-actions">
            <span><Folder size={16} aria-hidden="true" />{activeFolder.name}</span>
            <button type="button" onClick={() => setDialog({ kind: "rename", folder: activeFolder })}><Pencil size={14} aria-hidden="true" />Umbenennen</button>
            <button type="button" onClick={() => setDialog({ kind: "delete", folder: activeFolder })}><Trash2 size={14} aria-hidden="true" />Löschen</button>
          </div>
        )}

        {selection.length > 0 && (
          <div className="selection-bar glass glass-float" role="region" aria-label="Auswahl">
            <strong className="numeric">{selection.length === 1 ? "1 Datei" : `${selection.length} Dateien`} ausgewählt</strong>
            <button type="button" className="sheet-button sheet-button-primary selection-download" onClick={download} disabled={busy !== null}>{busy === "download" ? <Loader2 size={17} className="spin" aria-hidden="true" /> : <Download size={17} aria-hidden="true" />}{selection.length > 1 ? "Als ZIP herunterladen" : "Herunterladen"}</button>
            {canOrganize && (
              <label className="selection-move"><span className="visually-hidden">Ausgewählte Dateien verschieben nach</span>
                <select value="" onChange={(event) => move(event.target.value)} disabled={busy !== null}>
                  <option value="">Verschieben nach …</option>
                  {scopeFolders.filter((item) => item.id !== folder).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  {folder !== NO_FOLDER && <option value={NO_FOLDER}>Ohne Ordner</option>}
                </select>
              </label>
            )}
            <button type="button" className="selection-clear" onClick={() => setSelected([])}><X size={16} aria-hidden="true" />Auswahl aufheben</button>
          </div>
        )}
        {notice && <p className="calendar-notice glass" role="status"><Check size={18} aria-hidden="true" />{notice}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}

        {shown.length ? (
          <div className="glass file-table-card">
            <table className="file-table">
              <caption className="visually-hidden">{canManage ? "Alle Dateien mit Kategorie, Format, Datum und Kunden" : "Deine Dateien mit Kategorie, Format und Datum"}</caption>
              <thead>
                <tr>
                  <th scope="col" className="cell-select"><input type="checkbox" checked={selection.length === shown.length} onChange={toggleAll} aria-label="Alle angezeigten Dateien auswählen" /></th>
                  <th scope="col">Datei</th>
                  <th scope="col">Kategorie</th>
                  <th scope="col" className="col-description">Beschreibung</th>
                  <th scope="col">Format</th>
                  <th scope="col">Bereitgestellt</th>
                  {showCustomers && <th scope="col">Kunden</th>}
                  <th scope="col"><span className="visually-hidden">Download</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((file) => {
                  const folderName = scope && folder === ALL ? folders.find((item) => item.id === file.folderIds[scope])?.name : undefined;
                  return (
                    <tr key={file.id} className={`file-row${selected.includes(file.id) ? " is-selected" : ""}`}>
                      <td className="cell-select"><input type="checkbox" checked={selected.includes(file.id)} onChange={() => toggle(file.id)} aria-label={`${file.title} auswählen`} /></td>
                      <td className="cell-file">
                        <FileIcon file={file} />
                        <button type="button" className="file-open" onClick={() => setOpenId(file.id)}><strong>{file.title}</strong><small>{file.fileName}</small>{folderName && <span className="file-folder"><Folder size={12} aria-hidden="true" />{folderName}</span>}</button>
                      </td>
                      <td className="cell-category"><CategoryPill category={file.category} /></td>
                      <td className="cell-description col-description"><span>{file.description || "–"}</span></td>
                      <td className="cell-format"><strong>{fileFormat(file.fileName)}</strong><small>{formatBytes(file.sizeBytes)}</small></td>
                      <td className="cell-date">{formatFileDate(file.createdAt)}</td>
                      {showCustomers && <td className="cell-customers">{file.customers.length ? file.customers.map((item) => <span key={item.id} className="customer-chip numeric" title={item.company}>{item.customerNumber}</span>) : <span className="customer-chip customer-chip-empty">Ablage</span>}</td>}
                      <td className="cell-action"><DownloadButton file={file} onError={setError} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <GlassCard><p className="t-subheadline t-secondary">{activeFolder ? `Der Ordner „${activeFolder.name}“ ist noch leer. Wähle in „Alle Dateien“ Dateien aus und verschiebe sie hierher.` : files.length ? "Keine Dateien für diese Auswahl." : canManage ? "Noch keine Dateien hochgeladen." : "Für dich sind noch keine Dateien freigegeben."}</p></GlassCard>
        )}
      </>}

      {openFile && <FileDetailDialog key={openFile.id} file={openFile} customers={customers} folders={folders} canManage={canManage && source === "supabase"} onClose={() => setOpenId(null)} />}
      {dialog?.kind === "create" && scope && (
        <FolderNameDialog title="Neuer Ordner" initial="" onClose={() => setDialog(null)} onSave={async (name) => {
          const result = await store.addFolder(scope, name);
          if (result.ok) { setFolderChoice({ scope, folder: result.data.id }); setNotice(`Ordner „${result.data.name}“ angelegt.`); }
          return result;
        }} />
      )}
      {dialog?.kind === "rename" && <FolderNameDialog key={dialog.folder.id} title="Ordner umbenennen" initial={dialog.folder.name} onClose={() => setDialog(null)} onSave={(name) => store.rename(dialog.folder, name)} />}
      {dialog?.kind === "delete" && (
        <DeleteFolderDialog folder={dialog.folder} count={countIn(dialog.folder.id)} onClose={() => setDialog(null)} onDelete={async () => {
          const result = await store.remove(dialog.folder);
          if (result.ok) { chooseFolder(ALL); setNotice(`Ordner „${dialog.folder.name}“ gelöscht.`); }
          return result;
        }} />
      )}
    </>
  );
}
