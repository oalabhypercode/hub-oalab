"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowUpDown, Building2, Check, Download, FileType, Folder, Inbox, ListFilter, Loader2, Pencil, Rows3, Tag, Trash2, X } from "lucide-react";
import { categoryLabel } from "@/lib/categories";
import { fileCategories, fileCategoryIds, fileFormat, formatBytes, formatFileDate } from "@/lib/hub-files/catalog";
import type { HubStoredFile } from "@/lib/hub-files/types";
import { matchesSearch, sortRows, type SortState } from "@/lib/table-tools";
import { CategoryMetrics, CategoryTitle } from "./workspace";
import { HeaderActions } from "../app-shell";
import { GlassCard, SectionHeader } from "../glass";
import { LargeTitleHeader } from "../large-title-header";
import { MenuChoices, SheetEmpty, SheetFooter, SheetToolbar, TableAddRow, TableGroup, ToolbarMenu, useCollapsedGroups } from "../sheet";
import { FilterSelect, SortControl, SortHeader } from "../table-tools";
import { EmptyState } from "./overview";
import { CategoryDot, FileIcon } from "./files-parts";
import { DeleteFolderDialog, DownloadButton, FileDetailDialog, FolderNameDialog, fileSorts, fileSortValue, type FileSortKey, type FolderDialog } from "./files-dialogs";
import { useFilesStore } from "./files-store";
import { AssetManagement } from "./asset-management";
import { FileUploadCard } from "./files-upload";
import type { ScreenProps } from "./types";

const ALL = "all";
const UNASSIGNED = "unassigned";
const NO_FOLDER = "none";

type FileGrouping = "folder" | "none";

/** Admins work in the Asset Management (customers first); customers keep their own files table. */
export function FilesScreen(props: ScreenProps) {
  return props.admin ? <AssetManagement {...props} /> : <CustomerFiles {...props} />;
}

function CustomerFiles({ model, populated, fileState, admin }: ScreenProps) {
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
