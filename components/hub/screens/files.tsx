"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowUpDown, Building2, Check, Download, FileType, Folder, Inbox, ListFilter, Loader2, Pencil, Rows3, Tag, Trash2, Users, X } from "lucide-react";
import { categoryLabel } from "@/lib/categories";
import { createDownloadUrl, setFileAssignments, type ActionResult } from "@/lib/hub-files/actions";
import { fileCategories, fileCategoryIds, fileFormat, formatBytes, formatFileDate, formatFileDateTime, MAX_FOLDER_NAME } from "@/lib/hub-files/catalog";
import type { HubFileCustomer, HubFolder, HubStoredFile } from "@/lib/hub-files/types";
import { matchesSearch, sortRows, type SortState, type SortValue } from "@/lib/table-tools";
import { CategoryMetrics, CategoryTitle } from "./workspace";
import { HeaderActions } from "../app-shell";
import { GlassCard, SectionHeader } from "../glass";
import { LargeTitleHeader } from "../large-title-header";
import { Modal } from "../modal";
import { MenuChoices, SheetEmpty, SheetFooter, SheetToolbar, TableAddRow, TableGroup, ToolbarMenu, useCollapsedGroups } from "../sheet";
import { alphabetical, FilterSelect, SortControl, SortHeader, type SortOption } from "../table-tools";
import { EmptyState } from "./overview";
import { CategoryDot, CategoryPill, CustomerPicker, FileIcon } from "./files-parts";
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

type FileSortKey = "date" | "title" | "category" | "format" | "size";
const fileSorts: Record<FileSortKey, SortOption<FileSortKey>> = {
  date: { id: "date", label: "Bereitgestellt", firstDir: "desc", dirLabels: { asc: "älteste zuerst", desc: "neueste zuerst" } },
  title: { id: "title", label: "Titel", dirLabels: alphabetical },
  category: { id: "category", label: "Kategorie", dirLabels: alphabetical },
  format: { id: "format", label: "Format", dirLabels: alphabetical },
  size: { id: "size", label: "Größe", firstDir: "desc", dirLabels: { asc: "kleinste zuerst", desc: "größte zuerst" } },
};
const fileSortValue: Record<FileSortKey, (file: HubStoredFile) => SortValue> = {
  date: (file) => file.createdAt,
  title: (file) => file.title,
  category: (file) => fileCategories[file.category],
  format: (file) => fileFormat(file.fileName),
  size: (file) => file.sizeBytes,
};

type FileGrouping = "folder" | "none";

export function FilesScreen({ model, populated, fileState, admin }: ScreenProps) {
  const title = categoryLabel("files", admin);
  const store = useFilesStore(fileState);
  const { files, folders } = store;
  const { customers, canManage, source } = fileState;
  const [category, setCategory] = useState<string>(ALL);
  const [customer, setCustomer] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState<string>(ALL);
  const [sort, setSort] = useState<SortState<FileSortKey>>({ key: "date", dir: "desc" });
  const [folderChoice, setFolderChoice] = useState<{ scope: string | null; folder: string }>({ scope: null, folder: ALL });
  const [grouping, setGrouping] = useState<FileGrouping>("folder");
  const groups = useCollapsedGroups();
  const [selected, setSelected] = useState<string[]>([]);
  // A notice links its file (/files?file=<id>): the page opens with that file.
  const linkedFile = useSearchParams().get("file");
  const [openId, setOpenId] = useState<string | null>(() => files.some((file) => file.id === linkedFile) ? linkedFile : null);
  const [dialog, setDialog] = useState<FolderDialog | null>(null);
  const [busy, setBusy] = useState<"download" | "move" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const showCustomers = canManage || customers.length > 1;
  // Folders belong to one customer: customers see their own, admins those of the customer chosen in the filter.
  const scope = showCustomers ? (customer !== ALL && customer !== UNASSIGNED ? customer : null) : customers[0]?.id ?? null;
  const scopeFolders = useMemo(() => folders.filter((item) => item.customerId === scope), [folders, scope]);
  const folder = folderChoice.scope === scope && (folderChoice.folder === ALL || folderChoice.folder === NO_FOLDER || scopeFolders.some((item) => item.id === folderChoice.folder)) ? folderChoice.folder : ALL;
  const inFolder = (file: HubStoredFile, folderId: string) => !scope || folderId === ALL || (folderId === NO_FOLDER ? !file.folderIds[scope] : file.folderIds[scope] === folderId);
  const shown = sortRows(files.filter((file) =>
    (category === ALL || file.category === category)
    && (format === ALL || fileFormat(file.fileName) === format)
    && (customer === ALL || (customer === UNASSIGNED ? !file.customers.length : file.customers.some((item) => item.id === customer)))
    && matchesSearch(query, [file.title, file.fileName, file.description, fileCategories[file.category], ...(showCustomers ? file.customers.flatMap((item) => [item.company, item.customerNumber]) : [])])
    && inFolder(file, folder)), fileSortValue[sort.key], sort.dir, { tieBreak: (file) => file.title });
  const usedFormats = Array.from(new Set(files.map((file) => fileFormat(file.fileName)))).sort();
  // The customer filter also picks the folders, so the reset leaves it alone.
  const menuFilters = [category !== ALL, format !== ALL, showCustomers && customer !== ALL, folder !== ALL].filter(Boolean).length;
  const narrowed = files.length > 0 && (query.trim() !== "" || category !== ALL || format !== ALL || folder !== ALL);
  const resetFilters = () => { setQuery(""); setCategory(ALL); setFormat(ALL); chooseFolder(ALL); };
  const scopeFiles = scope ? files.filter((file) => file.customers.some((item) => item.id === scope)) : [];
  const countIn = (folderId: string) => scopeFiles.filter((file) => inFolder(file, folderId)).length;
  const selection = shown.filter((file) => selected.includes(file.id));
  const openFile = files.find((file) => file.id === openId);
  const usedCategories = fileCategoryIds.filter((id) => files.some((file) => file.category === id));
  const canOrganize = Boolean(scope) && !fileState.error;
  // Folders as groups, like OALab Studio: every folder of the customer (also an empty one), then the files without a folder.
  const byFolder = grouping === "folder" && canOrganize && scope;
  const folderGroups = byFolder ? [
    ...scopeFolders.filter((item) => folder === ALL || folder === item.id).map((item) => ({ key: item.id, label: item.name, folder: item, files: shown.filter((file) => file.folderIds[scope] === item.id) })),
    ...(folder === ALL || folder === NO_FOLDER ? [{ key: NO_FOLDER, label: "Ohne Ordner", folder: null, files: shown.filter((file) => !file.folderIds[scope]) }] : []),
  ] : [];
  const columns = 7 + (showCustomers ? 1 : 0);
  const totalSize = shown.reduce((sum, file) => sum + file.sizeBytes, 0);

  function chooseFolder(next: string) { setFolderChoice({ scope, folder: next }); setNotice(""); }
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
    return <><LargeTitleHeader title={title} icon={<CategoryTitle category="files" />} actions={<HeaderActions />} /><EmptyState section="files" /></>;
  }

  const row = (file: HubStoredFile) => (
    <tr key={file.id} className={`file-row${selected.includes(file.id) ? " is-selected" : ""}`}>
      <td className="cell-select"><input type="checkbox" checked={selected.includes(file.id)} onChange={() => toggle(file.id)} aria-label={`${file.title} auswählen`} /></td>
      <td className="cell-file">
        {/* One fact per cell: the title; the file name is in the tooltip and in the dialog. */}
        <button type="button" className="file-open" onClick={() => setOpenId(file.id)} title={file.fileName}><FileIcon file={file} size={16} /><strong>{file.title}</strong></button>
      </td>
      <td className="cell-category"><CategoryDot category={file.category} /></td>
      <td className="cell-description col-description">{file.description || <span className="cell-none">–</span>}</td>
      <td className="cell-format">{fileFormat(file.fileName)}</td>
      <td className="cell-size numeric">{formatBytes(file.sizeBytes)}</td>
      <td className="cell-date numeric">{formatFileDate(file.createdAt)}</td>
      {showCustomers && <td className="cell-customers">{file.customers.length ? file.customers.map((item) => <span key={item.id} className="customer-chip numeric" title={item.company}>{item.customerNumber}</span>) : <span className="customer-chip customer-chip-empty">Ablage</span>}</td>}
      <td className="cell-action"><DownloadButton file={file} onError={setError} /></td>
    </tr>
  );

  return (
    <>
      <LargeTitleHeader title={title} icon={<CategoryTitle category="files" />} actions={<HeaderActions />} />
      {files.length > 0 && <CategoryMetrics model={model} category="files" />}
      {fileState.error && <GlassCard className="section-first"><p className="t-headline">Dateien nicht verfügbar</p><p className="t-subheadline t-secondary">{fileState.error}</p></GlassCard>}

      {canManage && source === "supabase" && !fileState.error && <><SectionHeader title="Hochladen" /><FileUploadCard customers={customers} folders={folders} /></>}
      {source === "fixtures" && <GlassCard className="section-first file-demo-note"><Inbox size={18} color="var(--accent-text)" aria-hidden="true" /><p className="t-subheadline">{customers.length > 1 ? "Hochladen und Zuordnen ist nur mit echtem Admin-Login möglich. " : ""}Die Tabelle zeigt fiktive Beispieldateien. Ordner und Verschiebungen bleiben in diesem Browserfenster.</p></GlassCard>}
      {notice && <p className="calendar-notice" role="status"><Check size={18} aria-hidden="true" />{notice}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}

      {!fileState.error && (
        <div className="sheet section-first">
          <SheetToolbar query={query} onQuery={setQuery} placeholder={showCustomers ? "Titel, Dateiname, Beschreibung, Kunde …" : "Titel, Dateiname, Beschreibung …"} label="Dateien durchsuchen">
            <ToolbarMenu icon={ListFilter} label="Filter" badge={menuFilters}>
              {showCustomers && <FilterSelect icon={Building2} name="Nach Kunde filtern" value={customer} onChange={setCustomer} options={[{ value: ALL, label: "Alle Kunden" }, ...customers.map((item) => ({ value: item.id, label: `${item.customerNumber} · ${item.company}` })), ...(canManage ? [{ value: UNASSIGNED, label: "Ablage (ohne Zuordnung)" }] : [])]} />}
              {canOrganize && <FilterSelect icon={Folder} name="Nach Ordner filtern" value={folder} onChange={chooseFolder} options={[{ value: ALL, label: "Alle Ordner" }, ...scopeFolders.map((item) => ({ value: item.id, label: item.name })), { value: NO_FOLDER, label: "Ohne Ordner" }]} />}
              <FilterSelect icon={Tag} name="Nach Kategorie filtern" value={category} onChange={setCategory} options={[{ value: ALL, label: "Alle Kategorien" }, ...usedCategories.map((id) => ({ value: id, label: fileCategories[id] }))]} />
              <FilterSelect icon={FileType} name="Nach Format filtern" value={format} onChange={setFormat} options={[{ value: ALL, label: "Alle Formate" }, ...usedFormats.map((item) => ({ value: item, label: item }))]} />
            </ToolbarMenu>
            <ToolbarMenu icon={ArrowUpDown} label="Sortierung" value={fileSorts[sort.key].label}><SortControl options={Object.values(fileSorts)} sort={sort} onChange={setSort} /></ToolbarMenu>
            {canOrganize && (
              <ToolbarMenu icon={Rows3} label="Gruppe" value={grouping === "folder" ? "Ordner" : "Keine"}>
                <MenuChoices label="Gruppieren nach" value={grouping} onChange={setGrouping} options={[{ id: "folder", label: "Ordner" }, { id: "none", label: "Keine Gruppen" }]} />
              </ToolbarMenu>
            )}
          </SheetToolbar>
          {!canOrganize && showCustomers && customer !== UNASSIGNED && <p className="sheet-hint">Wähle im Filter einen Kunden, um seine Ordner zu sehen und Dateien einzusortieren.</p>}
          {selection.length > 0 && (
            <div className="sheet-selection" role="region" aria-label="Auswahl">
              <strong className="numeric">{selection.length === 1 ? "1 Datei" : `${selection.length} Dateien`} ausgewählt</strong>
              <button type="button" className="sheet-action is-primary" onClick={download} disabled={busy !== null}>{busy === "download" ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}{selection.length > 1 ? "Als ZIP herunterladen" : "Herunterladen"}</button>
              {canOrganize && (
                <label className="sheet-move"><span className="visually-hidden">Ausgewählte Dateien verschieben nach</span>
                  <select value="" onChange={(event) => move(event.target.value)} disabled={busy !== null}>
                    <option value="">Verschieben nach …</option>
                    {scopeFolders.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    <option value={NO_FOLDER}>Ohne Ordner</option>
                  </select>
                </label>
              )}
              <button type="button" className="sheet-action" onClick={() => setSelected([])}><X size={15} aria-hidden="true" />Auswahl aufheben</button>
            </div>
          )}
          {shown.length || folderGroups.length ? (
            <div className="sheet-scroll">
              <table className="file-table">
                <caption className="visually-hidden">{canManage ? "Alle Dateien mit Kategorie, Format, Größe, Datum und Kunden" : "Deine Dateien mit Kategorie, Format, Größe und Datum"}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="cell-select"><input type="checkbox" checked={shown.length > 0 && selection.length === shown.length} onChange={toggleAll} disabled={!shown.length} aria-label="Alle angezeigten Dateien auswählen" /></th>
                    <SortHeader option={fileSorts.title} label="Datei" sort={sort} onChange={setSort} />
                    <SortHeader option={fileSorts.category} sort={sort} onChange={setSort} />
                    <th scope="col" className="col-description">Beschreibung</th>
                    <SortHeader option={fileSorts.format} sort={sort} onChange={setSort} />
                    <SortHeader option={fileSorts.size} className="col-size" sort={sort} onChange={setSort} />
                    <SortHeader option={fileSorts.date} sort={sort} onChange={setSort} />
                    {showCustomers && <th scope="col">Kunden</th>}
                    <th scope="col"><span className="visually-hidden">Download</span></th>
                  </tr>
                </thead>
                {byFolder ? folderGroups.map((group) => (
                  <TableGroup key={group.key} colSpan={columns} label={group.label} count={group.files.length} glyph={<Folder size={16} aria-hidden="true" />}
                    collapsed={groups.isCollapsed(group.key)} onToggle={() => groups.toggle(group.key)}
                    empty={narrowed ? "Keine Dateien für diese Auswahl in diesem Ordner." : "Noch keine Dateien in diesem Ordner. Wähle Dateien aus und verschiebe sie hierher."}
                    actions={group.folder && <>
                      <button type="button" className="table-group-action" onClick={() => setDialog({ kind: "rename", folder: group.folder! })} aria-label={`Ordner „${group.label}“ umbenennen`} title="Umbenennen"><Pencil size={14} aria-hidden="true" /></button>
                      <button type="button" className="table-group-action" onClick={() => setDialog({ kind: "delete", folder: group.folder! })} aria-label={`Ordner „${group.label}“ löschen`} title="Löschen"><Trash2 size={14} aria-hidden="true" /></button>
                    </>}>
                    {group.files.map(row)}
                  </TableGroup>
                )) : <tbody>{shown.map(row)}</tbody>}
                {byFolder && <TableAddRow colSpan={columns} label="Neuer Ordner" onClick={() => setDialog({ kind: "create" })} />}
              </table>
            </div>
          ) : (
            <SheetEmpty text={narrowed ? (query.trim() ? `Keine Dateien zu „${query.trim()}“.` : "Keine Dateien für diese Auswahl.") : files.length ? "Keine Dateien für diese Auswahl." : canManage ? "Noch keine Dateien hochgeladen." : "Für dich sind noch keine Dateien freigegeben."} onReset={narrowed ? resetFilters : undefined} />
          )}
          <SheetFooter hint={shown.length > 1 ? "Mehrere ankreuzen: als ZIP laden oder verschieben" : undefined}>{shown.length === 1 ? "1 Datei" : `${shown.length} Dateien`}{shown.length ? ` · ${formatBytes(totalSize)}` : ""}</SheetFooter>
        </div>
      )}

      {openFile && <FileDetailDialog key={openFile.id} file={openFile} customers={customers} folders={folders} canManage={canManage && source === "supabase"} onClose={() => setOpenId(null)} />}
      {dialog?.kind === "create" && scope && (
        <FolderNameDialog title="Neuer Ordner" initial="" onClose={() => setDialog(null)} onSave={async (name) => {
          const result = await store.addFolder(scope, name);
          if (result.ok) setNotice(`Ordner „${result.data.name}“ angelegt.`);
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
