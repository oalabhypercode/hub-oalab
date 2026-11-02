"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowUpDown, Check, ChevronDown, ChevronLeft, Download, Files, FileType, Folder, FolderPlus, ImagePlus, Inbox, LayoutList, ListFilter, Loader2, Pencil, Plus, Rows3, Search, SlidersHorizontal, Table2, Tag, Trash2, Upload, UserPlus, Users, X } from "lucide-react";
import type { ListView } from "@/lib/appearance";
import { fileCategories, fileCategoryIds, fileDayGroup, fileFormat, formatBytes, formatFileDate, formatFileDay } from "@/lib/hub-files/catalog";
import type { HubFileCustomer, HubFolder, HubStoredFile } from "@/lib/hub-files/types";
import { matchesSearch, sortRows, type SortState } from "@/lib/table-tools";
import { HeaderActions } from "../app-shell";
import { useAppearance } from "../appearance-provider";
import { GlassCard } from "../glass";
import { LargeTitleHeader } from "../large-title-header";
import { MenuChoices, SheetEmpty, SheetFooter, SheetToolbar, TableAddRow, TableGroup, ToolbarMenu, useCollapsedGroups } from "../sheet";
import { FilterSelect, SortControl, SortHeader } from "../table-tools";
import { CategoryTitle } from "./workspace";
import { DeleteFolderDialog, DownloadButton, FolderNameDialog, fileSorts, fileSortValue, type FileSortKey, type FolderDialog } from "./files-dialogs";
import { FilePanel } from "./asset-details";
import { LogoDialog } from "./asset-logo";
import { isFileDrag, UploadPanel, useUploadQueue, type UploadTarget } from "./asset-upload";
import { CustomerSign } from "./customer-sign";
import { CategoryDot, FileIcon } from "./files-parts";
import { useFilesStore } from "./files-store";
import type { ScreenProps } from "./types";

const ALL = "all";
const NO_FOLDER = "none";

type View = { kind: "customer"; id: string } | { kind: "all" } | { kind: "inbox" };
/** The panel over the files: the upload, or one file's details (opened to change its customers from the Ablage). */
type Panel = { kind: "upload" } | { kind: "file"; id: string; assign: boolean };
type CustomerRow = { customer: HubFileCustomer; files: HubStoredFile[]; last: string };
type Group = { key: string; label: string; folder: HubFolder | null; files: HubStoredFile[] };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const totalSize = (list: HubStoredFile[]) => formatBytes(list.reduce((sum, file) => sum + file.sizeBytes, 0));
const newest = (list: HubStoredFile[]) => list.reduce((last, file) => (file.createdAt > last ? file.createdAt : last), "");

/** The switch of every list; the same setting as Profil › Darstellung › Listen. */
function DensitySwitch({ view, onChange }: { view: ListView; onChange: (view: ListView) => void }) {
  return (
    <div className="segmented-control am-density" role="group" aria-label="Ansicht der Liste">
      <button type="button" className="segment" aria-pressed={view === "minimal"} title="Minimalistische Sicht" onClick={() => onChange("minimal")}><LayoutList size={14} aria-hidden="true" />Minimal</button>
      <button type="button" className="segment" aria-pressed={view === "detail"} title="Detailsicht" onClick={() => onChange("detail")}><Table2 size={14} aria-hidden="true" />Detail</button>
    </div>
  );
}

/**
 * Asset Management for admins: customers on the left like the conversations, the chosen customer's files on the right.
 * Every list comes as "Minimal" (symbol in the category's colour, title, day) or "Detail" (all columns).
 * Uploading and a file's details open as panels over the files; files can be dragged straight onto a folder.
 */
export function AssetManagement({ asOf, fileState }: ScreenProps) {
  const store = useFilesStore(fileState);
  const { files, folders } = store;
  const { customers, canManage, source } = fileState;
  const { appearance, update } = useAppearance();
  const listView = appearance.listView;
  const minimal = listView === "minimal";
  const canUpload = canManage && source === "supabase" && !fileState.error;

  const rows = useMemo<CustomerRow[]>(() => customers.map((customer) => {
    const own = files.filter((file) => file.customers.some((item) => item.id === customer.id));
    return { customer, files: own, last: newest(own) };
  }), [customers, files]);
  const inbox = useMemo(() => files.filter((file) => !file.customers.length), [files]);
  // The customers list carries the logos; a file's own customer entries do not, so they are looked up here.
  const logos = useMemo(() => new Map(customers.flatMap((customer) => customer.logo ? [[customer.id, customer.logo] as const] : [])), [customers]);

  // A notice links its file (/files?file=<id>): the page opens with that file and its customer.
  const linkedFile = useSearchParams().get("file");
  const [panel, setPanel] = useState<Panel | null>(() => linkedFile && files.some((file) => file.id === linkedFile) ? { kind: "file", id: linkedFile, assign: false } : null);
  const [view, setView] = useState<View>(() => {
    const linked = files.find((file) => file.id === linkedFile);
    if (linked) return linked.customers[0] ? { kind: "customer", id: linked.customers[0].id } : { kind: "inbox" };
    const recent = [...rows].sort((a, b) => b.last.localeCompare(a.last))[0];
    return recent?.files.length ? { kind: "customer", id: recent.customer.id } : { kind: "all" };
  });
  // Narrow screens show one side at a time: the customers first, unless a link opened a file.
  const [paneOpen, setPaneOpen] = useState(Boolean(linkedFile));
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerOrder, setCustomerOrder] = useState<"recent" | "az">("recent");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL);
  const [format, setFormat] = useState(ALL);
  const [sort, setSort] = useState<SortState<FileSortKey>>({ key: "date", dir: "desc" });
  const [grouping, setGrouping] = useState<"folder" | "none">("folder");
  const groups = useCollapsedGroups();
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<FolderDialog | null>(null);
  const queue = useUploadQueue(customers, folders);
  // Files dragged in from the computer: how many, and the folder under the mouse (NO_FOLDER outside of one).
  const [drag, setDrag] = useState<{ count: number; folder: string } | null>(null);
  const dragDepth = useRef(0);
  const [logoFor, setLogoFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<"download" | "move" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const current = view.kind === "customer" ? customers.find((customer) => customer.id === view.id) ?? null : null;
  const paneFiles = current ? rows.find((row) => row.customer.id === current.id)?.files ?? [] : view.kind === "inbox" ? inbox : files;
  const shown = sortRows(paneFiles.filter((file) =>
    (category === ALL || file.category === category)
    && (format === ALL || fileFormat(file.fileName) === format)
    && matchesSearch(query, [file.title, file.fileName, file.description, fileCategories[file.category], ...file.customers.flatMap((item) => [item.company, item.customerNumber])])), fileSortValue[sort.key], sort.dir, { tieBreak: (file) => file.title });
  const scopeFolders = current ? folders.filter((folder) => folder.customerId === current.id) : [];
  const folderGroups: Group[] = current ? [
    ...scopeFolders.map((folder) => ({ key: folder.id, label: folder.name, folder, files: shown.filter((file) => file.folderIds[current.id] === folder.id) })),
    { key: NO_FOLDER, label: "Ohne Ordner", folder: null, files: shown.filter((file) => !file.folderIds[current.id]) },
  ] : [];
  const selection = shown.filter((file) => selected.includes(file.id));
  const openFile = panel?.kind === "file" ? files.find((file) => file.id === panel.id) : undefined;
  const logoRow = logoFor ? rows.find((row) => row.customer.id === logoFor) : undefined;
  const usedFormats = Array.from(new Set(paneFiles.map((file) => fileFormat(file.fileName)))).sort();
  const usedCategories = fileCategoryIds.filter((id) => paneFiles.some((file) => file.category === id));
  const filterCount = [category !== ALL, format !== ALL].filter(Boolean).length;
  const narrowed = query.trim() !== "" || filterCount > 0;

  const term = customerQuery.trim().toLowerCase();
  const listedRows = rows
    .filter((row) => !term || `${row.customer.company} ${row.customer.customerNumber}`.toLowerCase().includes(term))
    .sort((a, b) => customerOrder === "az" ? a.customer.company.localeCompare(b.customer.company, "de") : b.last.localeCompare(a.last) || a.customer.company.localeCompare(b.customer.company, "de"));

  function choose(next: View) {
    setView(next);
    setPaneOpen(true);
    setSelected([]);
    setQuery("");
    setCategory(ALL);
    setFormat(ALL);
    setNotice("");
    setError("");
    // A file's details belong to the list they were opened from; an upload keeps its files and its target.
    setPanel((now) => now?.kind === "file" ? null : now);
  }
  const toggle = (id: string) => setSelected((list) => list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
  const toggleAll = () => setSelected(selection.length === shown.length ? [] : shown.map((file) => file.id));
  const open = (file: HubStoredFile, assign = false) => setPanel({ kind: "file", id: file.id, assign });

  function startUpload(target: UploadTarget, dropped?: File[]) {
    queue.start(target, dropped);
    setPanel({ kind: "upload" });
    setPaneOpen(true);
  }
  function closeUpload() {
    queue.reset();
    setPanel(null);
  }

  /* ---------- Dragging files in ---------- */
  // Over the files the folder under the mouse lights up and the pill says where the files land; dropped, they wait in
  // the upload panel for their categories. Elsewhere on the sheet a drop does nothing instead of opening the file.
  const canDrop = canUpload && !queue.working;
  const folderUnder = (target: EventTarget) => target instanceof Element ? target.closest("[data-drop-folder]")?.getAttribute("data-drop-folder") ?? NO_FOLDER : NO_FOLDER;
  const overPanel = (target: EventTarget) => target instanceof Element && target.closest(".am-panel") !== null;
  const endDrag = () => { dragDepth.current = 0; setDrag(null); };
  const dropHandlers = canDrop ? {
    onDragEnter: (event: React.DragEvent) => { if (isFileDrag(event)) { event.preventDefault(); dragDepth.current++; } },
    onDragOver: (event: React.DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      if (overPanel(event.target)) { event.dataTransfer.dropEffect = "none"; setDrag(null); return; }
      event.dataTransfer.dropEffect = "copy";
      const folder = current ? folderUnder(event.target) : NO_FOLDER;
      const count = Array.from(event.dataTransfer.items).filter((item) => item.kind === "file").length;
      setDrag((now) => now?.folder === folder && now.count === count ? now : { count, folder });
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!isFileDrag(event)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDrag(null);
    },
    onDrop: (event: React.DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      endDrag();
      if (overPanel(event.target)) return;
      const folder = current ? folderUnder(event.target) : NO_FOLDER;
      startUpload({ customerId: current?.id ?? null, folderId: current && folder !== NO_FOLDER ? folder : "" }, Array.from(event.dataTransfer.files));
    },
  } : {};
  const guardSheet = canDrop ? {
    onDragOver: (event: React.DragEvent) => { if (isFileDrag(event) && !event.defaultPrevented) { event.preventDefault(); event.dataTransfer.dropEffect = "none"; } },
    onDrop: (event: React.DragEvent) => { if (isFileDrag(event)) event.preventDefault(); },
  } : {};
  // A drag that ends outside of the files (dropped elsewhere) must not leave the frame behind.
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const end = () => { dragDepth.current = 0; setDrag(null); };
    window.addEventListener("drop", end);
    return () => window.removeEventListener("drop", end);
  }, [dragging]);
  const dropFolderName = drag && current ? drag.folder === NO_FOLDER ? "Ohne Ordner" : scopeFolders.find((folder) => folder.id === drag.folder)?.name ?? "Ohne Ordner" : "";

  async function download() {
    setBusy("download");
    setError("");
    const result = await store.download(selection);
    setBusy(null);
    if (!result.ok) setError(result.error);
  }

  async function move(target: string) {
    if (!current || !target) return;
    setBusy("move");
    setError("");
    const folderId = target === NO_FOLDER ? null : target;
    const result = await store.move(selection.map((file) => file.id), current.id, folderId);
    setBusy(null);
    if (!result.ok) { setError(result.error); return; }
    const name = folderId ? scopeFolders.find((item) => item.id === folderId)?.name : "Ohne Ordner";
    setNotice(`${plural(result.data.count, "Datei", "Dateien")} nach „${name}“ verschoben.`);
    setSelected([]);
  }

  const others = (file: HubStoredFile) => file.customers.filter((item) => item.id !== current?.id);

  /* ---------- Rows ---------- */
  const minimalRow = (file: HubStoredFile, trail?: React.ReactNode) => {
    const isSelected = selected.includes(file.id);
    const shared = current ? others(file) : [];
    return (
      <div key={file.id} className={`am-min-row${isSelected ? " is-selected" : ""}`} role="listitem">
        <span className={`am-min-lead am-cat-${file.category}`} title={fileCategories[file.category]}>
          <FileIcon file={file} size={17} color="currentColor" />
          <input type="checkbox" checked={isSelected} onChange={() => toggle(file.id)} aria-label={`${file.title} auswählen`} />
        </span>
        <button type="button" className="am-min-title" onClick={() => open(file)} title={file.fileName}>
          <span className="t">{file.title}</span>
          {shared.length > 0 && <span className="am-min-shared" title={`Auch bei ${shared.map((item) => item.company).join(", ")}`}><Users size={12} aria-hidden="true" />{shared.length + 1}</span>}
        </button>
        <span className="am-min-trail">
          {trail}
          <time dateTime={file.createdAt}>{formatFileDay(file.createdAt, asOf)}</time>
          <span className="am-min-acts"><DownloadButton file={file} onError={setError} compact /></span>
        </span>
      </div>
    );
  };

  const fileCell = (file: HubStoredFile) => {
    const shared = current ? others(file) : [];
    return (
      <button type="button" className="am-file" onClick={() => open(file)} title={file.fileName}>
        <span className="am-file-icon"><FileIcon file={file} size={17} /></span>
        <span className="am-file-text">
          <strong>{file.title}</strong>
          <small>{fileFormat(file.fileName)} · {formatBytes(file.sizeBytes)}{shared.length > 0 && <> · auch bei <b>{shared.map((item) => item.company).join(", ")}</b></>}</small>
        </span>
      </button>
    );
  };

  const who = (file: HubStoredFile, compact = false) => file.customers.length
    ? <span className={compact ? "am-min-who" : "am-customer"}><CustomerSign customer={file.customers[0]} logo={logos.get(file.customers[0].id)} size={compact ? "xs" : "sm"} /><span>{file.customers[0].company}</span>{file.customers.length > 1 && <span className={compact ? "am-min-plus" : "am-plus"} title={file.customers.slice(1).map((item) => item.company).join(", ")}>+{file.customers.length - 1}</span>}</span>
    : <span className={compact ? "am-min-who is-inbox" : "am-customer is-inbox"}><Inbox size={compact ? 13 : 15} aria-hidden="true" /><span>Ablage</span></span>;

  const assignButton = (file: HubStoredFile) => canManage && source === "supabase"
    ? <button type="button" className="sheet-action" onClick={() => open(file, true)}><UserPlus size={15} aria-hidden="true" />Zuordnen</button>
    : null;

  const tableRow = (file: HubStoredFile, columns: "customer" | "all" | "inbox") => (
    <tr key={file.id} className={`file-row${selected.includes(file.id) ? " is-selected" : ""}`}>
      <td className="cell-select"><input type="checkbox" checked={selected.includes(file.id)} onChange={() => toggle(file.id)} aria-label={`${file.title} auswählen`} /></td>
      <td className="cell-file">{fileCell(file)}</td>
      {columns === "all" && <td className="cell-customers">{who(file)}</td>}
      <td className="cell-category"><CategoryDot category={file.category} /></td>
      <td className="cell-date numeric">{formatFileDate(file.createdAt)}</td>
      <td className="cell-action">{columns === "inbox" ? assignButton(file) : <DownloadButton file={file} onError={setError} compact />}</td>
    </tr>
  );

  /* ---------- Bodies ---------- */
  const columnsFor = view.kind === "all" ? 6 : 5;
  const tableHead = (
    <thead>
      <tr>
        <th scope="col" className="cell-select"><input type="checkbox" checked={shown.length > 0 && selection.length === shown.length} onChange={toggleAll} disabled={!shown.length} aria-label="Alle angezeigten Dateien auswählen" /></th>
        <SortHeader option={fileSorts.title} label="Datei" sort={sort} onChange={setSort} />
        {view.kind === "all" && <th scope="col">Kunde</th>}
        <SortHeader option={fileSorts.category} sort={sort} onChange={setSort} />
        <SortHeader option={fileSorts.date} sort={sort} onChange={setSort} />
        <th scope="col"><span className="visually-hidden">Aktionen</span></th>
      </tr>
    </thead>
  );

  const folderActions = (group: Group) => <>
    {canUpload && <button type="button" className="table-group-action is-accent" onClick={() => startUpload({ customerId: current!.id, folderId: group.folder?.id ?? "" })} aria-label={`In „${group.label}“ hochladen`} title="Hierher hochladen"><Upload size={14} aria-hidden="true" /></button>}
    {group.folder && <>
      <button type="button" className="table-group-action" onClick={() => setDialog({ kind: "rename", folder: group.folder! })} aria-label={`Ordner „${group.label}“ umbenennen`} title="Umbenennen"><Pencil size={14} aria-hidden="true" /></button>
      <button type="button" className="table-group-action" onClick={() => setDialog({ kind: "delete", folder: group.folder! })} aria-label={`Ordner „${group.label}“ löschen`} title="Löschen"><Trash2 size={14} aria-hidden="true" /></button>
    </>}
  </>;

  const customerBody = minimal ? (
    <div className={`am-min${selection.length ? " is-selecting" : ""}`} role="list" aria-label={`Dateien von ${current?.company ?? ""}`}>
      {folderGroups.map((group) => (
        <div key={group.key} className="am-min-group" role="presentation" data-drop-folder={canDrop ? group.key : undefined}>
          <div className={`am-min-section${drag?.folder === group.key ? " is-drop" : ""}`}>
            <button type="button" className="am-min-section-toggle" aria-expanded={!groups.isCollapsed(group.key)} onClick={() => groups.toggle(group.key)}>
              <ChevronDown size={13} aria-hidden="true" /><span>{group.label}</span><span className="am-min-count">{group.files.length || (narrowed ? "0" : "leer")}</span>
            </button>
            <span className="am-min-section-acts">{folderActions(group)}</span>
          </div>
          {!groups.isCollapsed(group.key) && group.files.map((file) => minimalRow(file))}
        </div>
      ))}
      <button type="button" className="am-min-add" onClick={() => setDialog({ kind: "create" })}><Plus size={15} aria-hidden="true" />Neuer Ordner</button>
    </div>
  ) : (
    <div className="sheet-scroll">
      <table className="file-table">
        <caption className="visually-hidden">Dateien von {current?.company} mit Kategorie und Datum</caption>
        {tableHead}
        {grouping === "folder" ? folderGroups.map((group) => (
          <TableGroup key={group.key} colSpan={columnsFor} label={group.label} count={group.files.length} glyph={<Folder size={16} aria-hidden="true" />}
            collapsed={groups.isCollapsed(group.key)} onToggle={() => groups.toggle(group.key)}
            className={drag?.folder === group.key ? "is-drop" : undefined} dropKey={canDrop ? group.key : undefined}
            empty={narrowed ? "Keine Dateien für diese Auswahl in diesem Ordner." : "Noch leer. Wähle Dateien aus und verschiebe sie hierher."}
            actions={folderActions(group)}>
            {group.files.map((file) => tableRow(file, "customer"))}
          </TableGroup>
        )) : <tbody>{shown.map((file) => tableRow(file, "customer"))}</tbody>}
        {grouping === "folder" && <TableAddRow colSpan={columnsFor} label="Neuer Ordner" onClick={() => setDialog({ kind: "create" })} />}
      </table>
    </div>
  );

  const dayGroups = shown.reduce<{ label: string; files: HubStoredFile[] }[]>((list, file) => {
    const label = fileDayGroup(file.createdAt, asOf);
    const last = list[list.length - 1];
    if (last && last.label === label) last.files.push(file); else list.push({ label, files: [file] });
    return list;
  }, []);

  const allBody = minimal ? (
    <div className={`am-min${selection.length ? " is-selecting" : ""}`} role="list" aria-label="Alle Dateien">
      {dayGroups.map((group) => (
        <div key={group.label} className="am-min-group" role="presentation">
          <div className="am-min-section"><span className="am-min-section-toggle">{group.label}<span className="am-min-count">{group.files.length}</span></span></div>
          {group.files.map((file) => minimalRow(file, who(file, true)))}
        </div>
      ))}
    </div>
  ) : (
    <div className="sheet-scroll">
      <table className="file-table">
        <caption className="visually-hidden">Alle Dateien mit Kunde, Kategorie und Datum</caption>
        {tableHead}
        <tbody>{shown.map((file) => tableRow(file, "all"))}</tbody>
      </table>
    </div>
  );

  const inboxBody = minimal ? (
    <div className={`am-min${selection.length ? " is-selecting" : ""}`} role="list" aria-label="Dateien ohne Kunden">
      {shown.map((file) => minimalRow(file, assignButton(file)))}
    </div>
  ) : (
    <div className="sheet-scroll">
      <table className="file-table">
        <caption className="visually-hidden">Dateien ohne Kunden</caption>
        {tableHead}
        <tbody>{shown.map((file) => tableRow(file, "inbox"))}</tbody>
      </table>
    </div>
  );

  const empty = !shown.length && !(current && folderGroups.length && !narrowed);
  const body = empty
    ? <SheetEmpty text={narrowed ? (query.trim() ? `Keine Dateien zu „${query.trim()}“.` : "Keine Dateien für diese Auswahl.") : view.kind === "inbox" ? "Die Ablage ist leer. Alle Dateien haben einen Kunden." : "Noch keine Dateien."} onReset={narrowed ? () => { setQuery(""); setCategory(ALL); setFormat(ALL); } : undefined} />
    : current ? customerBody : view.kind === "inbox" ? inboxBody : allBody;

  /* ---------- Pane head ---------- */
  const back = <button type="button" className="chat-back" onClick={() => setPaneOpen(false)} aria-label="Zurück zu den Kunden"><ChevronLeft size={24} aria-hidden="true" /></button>;
  const uploadButton = canUpload && <button type="button" className="sheet-action is-primary" onClick={() => startUpload({ customerId: current?.id ?? null, folderId: "" })}><Upload size={15} aria-hidden="true" />Hochladen</button>;
  const head = current ? (
    <header className="am-pane-head">
      {back}
      {/* A click on the sign opens the logo; the badge shows on hover, and always while there is none. */}
      {canUpload ? (
        <button type="button" className="am-sign-edit" onClick={() => setLogoFor(current.id)} title={current.logo ? "Logo ändern" : "Logo hinterlegen"} aria-label={`Logo von ${current.company} ${current.logo ? "ändern" : "hinterlegen"}`}>
          <CustomerSign customer={current} logo={current.logo} size="lg" />
          <span className={`am-sign-badge${current.logo ? "" : " is-shown"}`} aria-hidden="true"><ImagePlus size={12} /></span>
        </button>
      ) : <CustomerSign customer={current} logo={current.logo} size="lg" />}
      <div className="am-pane-title"><strong>{current.company}</strong><span>{minimal ? `${plural(paneFiles.length, "Datei", "Dateien")} · ${totalSize(paneFiles)}` : `${current.customerNumber} · ${plural(paneFiles.length, "Datei", "Dateien")} · ${totalSize(paneFiles)}`}</span></div>
      <div className="am-pane-actions">{!minimal && <button type="button" className="sheet-action am-wide" onClick={() => setDialog({ kind: "create" })}><FolderPlus size={15} aria-hidden="true" />Neuer Ordner</button>}{uploadButton}</div>
    </header>
  ) : view.kind === "inbox" ? (
    <header className="am-pane-head">
      {back}
      <span className="am-tile is-inbox is-lg"><Inbox size={22} aria-hidden="true" /></span>
      <div className="am-pane-title"><strong>Ablage</strong><span>{plural(inbox.length, "Datei", "Dateien")} ohne Kunden. Kunden sehen sie erst nach dem Zuordnen.</span></div>
      <div className="am-pane-actions">{uploadButton}</div>
    </header>
  ) : (
    <header className="am-pane-head">
      {back}
      <span className="am-tile is-lg"><Files size={22} aria-hidden="true" /></span>
      <div className="am-pane-title"><strong>Alle Dateien</strong><span>{minimal ? `${plural(files.length, "Datei", "Dateien")} · neueste zuerst` : `${plural(files.length, "Datei", "Dateien")} bei ${plural(customers.length, "Kunde", "Kunden")} · ${totalSize(files)}`}</span></div>
      <div className="am-pane-actions">{uploadButton}</div>
    </header>
  );

  const filters = <>
    <FilterSelect icon={Tag} name="Nach Kategorie filtern" value={category} onChange={setCategory} options={[{ value: ALL, label: "Alle Kategorien" }, ...usedCategories.map((id) => ({ value: id, label: fileCategories[id] }))]} />
    <FilterSelect icon={FileType} name="Nach Format filtern" value={format} onChange={setFormat} options={[{ value: ALL, label: "Alle Formate" }, ...usedFormats.map((item) => ({ value: item, label: item }))]} />
  </>;

  /* ---------- Customers ---------- */
  const pinned = (target: View, sign: React.ReactNode, title: string, sub: string, right: React.ReactNode) => {
    const active = view.kind === target.kind && (target.kind !== "customer" || (view.kind === "customer" && view.id === target.id));
    return (
      <li key={target.kind === "customer" ? target.id : target.kind}>
        <button type="button" className={`chat-conv${minimal ? " am-min-conv" : ""}`} aria-current={active ? "true" : undefined} onClick={() => choose(target)}>
          {sign}
          {minimal ? <span className="am-min-conv-name">{title}</span> : <span className="chat-conv-main"><span className="chat-conv-top"><strong>{title}</strong>{right}</span><span className="chat-conv-sub"><span className="chat-conv-last">{sub}</span></span></span>}
          {minimal && right}
        </button>
      </li>
    );
  };

  const customerList = (
    <div className="chat-list">
      <div className="chat-list-head">
        <h2>Kunden<span>{customers.length}</span></h2>
        {canUpload && <button type="button" className="chat-icon-button" onClick={() => startUpload({ customerId: null, folderId: "" })} aria-label="Hochladen" title="Hochladen"><Upload size={19} aria-hidden="true" /></button>}
      </div>
      <label className="chat-search"><Search size={15} aria-hidden="true" /><input type="search" value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder={minimal ? "Kunde suchen" : "Kunde oder Kundennummer"} aria-label="Kunden durchsuchen" /></label>
      {!minimal && (
        <div className="chat-filter" role="group" aria-label="Reihenfolge">
          <button type="button" aria-pressed={customerOrder === "recent"} onClick={() => setCustomerOrder("recent")}>Zuletzt aktiv</button>
          <button type="button" aria-pressed={customerOrder === "az"} onClick={() => setCustomerOrder("az")}>A–Z</button>
        </div>
      )}
      <ul className="chat-convs" role="list">
        {!term && pinned({ kind: "all" }, <span className={`am-tile${minimal ? " is-md" : ""}`}><Files size={minimal ? 16 : 20} aria-hidden="true" /></span>, "Alle Dateien", `${plural(customers.length, "Kunde", "Kunden")} · ${totalSize(files)}`, <span className="am-count">{files.length}</span>)}
        {!term && pinned({ kind: "inbox" }, <span className={`am-tile is-inbox${minimal ? " is-md" : ""}`}><Inbox size={minimal ? 16 : 20} aria-hidden="true" /></span>, "Ablage", "Noch keinem Kunden zugeordnet", inbox.length ? <span className="chat-pill tone-todo">{inbox.length}</span> : <span className="am-count">0</span>)}
        <li className="am-list-label">{minimal ? "Kunden" : customerOrder === "az" ? "Kunden von A bis Z" : "Kunden · zuletzt aktiv"}</li>
        {listedRows.map(({ customer, files: own, last }) => pinned(
          { kind: "customer", id: customer.id },
          <CustomerSign customer={customer} logo={customer.logo} size={minimal ? "md" : undefined} />,
          customer.company,
          `${customer.customerNumber} · ${own.length ? plural(own.length, "Datei", "Dateien") : "noch keine Dateien"}`,
          minimal ? <span className="am-count">{own.length || ""}</span> : last ? <time className={formatFileDay(last, asOf) === "Heute" ? "is-new" : undefined}>{formatFileDay(last, asOf)}</time> : null,
        ))}
        {!listedRows.length && <li className="chat-empty">{customers.length ? `Kein Kunde passt zu „${customerQuery.trim()}“.` : "Es sind noch keine Kunden angelegt."}</li>}
      </ul>
    </div>
  );

  return (
    <>
      <LargeTitleHeader title="Asset Management" icon={<CategoryTitle category="files" />} actions={<HeaderActions />} />
      {fileState.error && <GlassCard className="section-first"><p className="t-headline">Dateien nicht verfügbar</p><p className="t-subheadline t-secondary">{fileState.error}</p></GlassCard>}
      {source === "fixtures" && <GlassCard className="section-first file-demo-note"><Inbox size={18} color="var(--accent-text)" aria-hidden="true" /><p className="t-subheadline">Hochladen und Zuordnen ist nur mit echtem Admin-Login möglich. Die Liste zeigt fiktive Beispieldateien; Ordner und Verschiebungen bleiben in diesem Browserfenster.</p></GlassCard>}
      {notice && <p className="calendar-notice" role="status"><Check size={18} aria-hidden="true" />{notice}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}

      {!fileState.error && (
        <div className={`sheet section-first am${minimal ? " is-minimal" : ""}`} data-open={paneOpen ? "" : undefined} {...guardSheet}>
          <div className="am-grid">
            {customerList}
            <section className="am-pane" aria-label={current ? current.company : view.kind === "inbox" ? "Ablage" : "Alle Dateien"} {...dropHandlers}>
              {head}
              <SheetToolbar query={query} onQuery={setQuery} placeholder={current ? `In ${current.company} suchen …` : "Titel, Dateiname oder Kunde …"} label="Dateien durchsuchen" compact={!minimal}
                trailing={<DensitySwitch view={listView} onChange={(next) => update({ listView: next })} />}>
                {minimal ? <ToolbarMenu icon={SlidersHorizontal} label="Filter" badge={filterCount}>{filters}</ToolbarMenu> : <>
                  <ToolbarMenu icon={ListFilter} label="Filter" badge={filterCount}>{filters}</ToolbarMenu>
                  <ToolbarMenu icon={ArrowUpDown} label="Sortierung" value={fileSorts[sort.key].label}><SortControl options={Object.values(fileSorts)} sort={sort} onChange={setSort} /></ToolbarMenu>
                  {current && <ToolbarMenu icon={Rows3} label="Gruppe" value={grouping === "folder" ? "Ordner" : "Keine"}><MenuChoices label="Gruppieren nach" value={grouping} onChange={setGrouping} options={[{ id: "folder", label: "Ordner" }, { id: "none", label: "Keine Gruppen" }]} /></ToolbarMenu>}
                </>}
              </SheetToolbar>
              {selection.length > 0 && (
                <div className="sheet-selection" role="region" aria-label="Auswahl">
                  <strong className="numeric">{plural(selection.length, "Datei", "Dateien")} ausgewählt</strong>
                  <button type="button" className="sheet-action is-primary" onClick={download} disabled={busy !== null}>{busy === "download" ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}{selection.length > 1 ? "ZIP herunterladen" : "Herunterladen"}</button>
                  {current && (
                    <label className="sheet-move"><span className="visually-hidden">Ausgewählte Dateien verschieben nach</span>
                      <select value="" onChange={(event) => move(event.target.value)} disabled={busy !== null}>
                        <option value="">Verschieben nach …</option>
                        {scopeFolders.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                        <option value={NO_FOLDER}>Ohne Ordner</option>
                      </select>
                    </label>
                  )}
                  <button type="button" className="am-icon-btn am-selection-clear" onClick={() => setSelected([])} aria-label="Auswahl aufheben" title="Auswahl aufheben"><X size={17} aria-hidden="true" /></button>
                </div>
              )}
              <div className="am-scroll">{body}</div>
              {!minimal && <SheetFooter hint={shown.length > 1 ? "Mehrere ankreuzen: als ZIP laden oder verschieben" : undefined}>{plural(shown.length, "Datei", "Dateien")}{shown.length ? ` · ${totalSize(shown)}` : ""}</SheetFooter>}
              {drag && <>
                <div className="am-drop" aria-hidden="true" />
                <div className="am-drop-pill" aria-hidden="true">
                  <Upload size={18} />{drag.count > 1 ? `${drag.count} Dateien loslassen` : drag.count === 1 ? "Datei loslassen" : "Dateien loslassen"}
                  <span>{current ? `nach „${dropFolderName}“ · ${current.company}` : "Kunde und Ordner wählst du gleich"}</span>
                </div>
              </>}
              {panel?.kind === "upload" && <UploadPanel queue={queue} customers={customers} onClose={closeUpload} onUploaded={(message) => { setPanel(null); setNotice(message); }} />}
              {openFile && (
                <FilePanel file={openFile} customers={customers} folders={folders} here={current} live={source === "supabase"} canAssign={canManage && source === "supabase"}
                  startAssigning={panel?.kind === "file" && panel.assign} onClose={() => setPanel(null)} onNotice={setNotice}
                  onMove={(customerId, folderId) => store.move([openFile.id], customerId, folderId)} />
              )}
            </section>
          </div>
        </div>
      )}

      {logoRow && <LogoDialog customer={logoRow.customer} files={logoRow.files} onClose={() => setLogoFor(null)} onSaved={(message) => { setLogoFor(null); setNotice(message); }} />}
      {dialog?.kind === "create" && current && (
        <FolderNameDialog title={`Neuer Ordner bei ${current.company}`} initial="" onClose={() => setDialog(null)} onSave={async (name) => {
          const result = await store.addFolder(current.id, name);
          if (result.ok) setNotice(`Ordner „${result.data.name}“ angelegt.`);
          return result;
        }} />
      )}
      {dialog?.kind === "rename" && <FolderNameDialog key={dialog.folder.id} title="Ordner umbenennen" initial={dialog.folder.name} onClose={() => setDialog(null)} onSave={(name) => store.rename(dialog.folder, name)} />}
      {dialog?.kind === "delete" && (
        <DeleteFolderDialog folder={dialog.folder} count={current ? paneFiles.filter((file) => file.folderIds[current.id] === dialog.folder.id).length : 0} onClose={() => setDialog(null)} onDelete={async () => {
          const result = await store.remove(dialog.folder);
          if (result.ok) setNotice(`Ordner „${dialog.folder.name}“ gelöscht.`);
          return result;
        }} />
      )}
    </>
  );
}
