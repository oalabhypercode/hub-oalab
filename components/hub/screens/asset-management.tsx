"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, ArrowUpDown, Check, ChevronDown, ChevronLeft, Download, Files, FileType, Folder, FolderInput, FolderPlus, Handshake, ImagePlus, Inbox, LayoutList, List, ListFilter, Pencil, PenLine, Plus, Rows3, Search, SlidersHorizontal, Table2, Tag, Trash2, Upload, UserPlus, Users, X } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import type { ListView } from "@/lib/appearance";
import { deleteFiles, setFileAudience } from "@/lib/hub-files/actions";
import { fileCategories, fileCategoryIds, fileDayGroup, fileFormat, formatBytes, formatFileDate, formatFileDay } from "@/lib/hub-files/catalog";
import type { HubFileCustomer, HubFolder, HubStoredFile } from "@/lib/hub-files/types";
import { matchesSearch, sortRows, type SortState } from "@/lib/table-tools";
import { HeaderActions } from "../app-shell";
import { useAppearance } from "../appearance-provider";
import { GlassCard } from "../glass";
import { useInfo } from "../info-box";
import { LargeTitleHeader } from "../large-title-header";
import { GroupCheck, groupTicks, MenuChoices, SheetEmpty, SheetFooter, SheetToolbar, TableAddRow, TableGroup, ToolbarMenu, useCollapsedGroups } from "../sheet";
import { FilterSelect, SortControl, SortHeader } from "../table-tools";
import { CategoryTitle } from "./workspace";
import { DeleteFilesDialog, DeleteFolderDialog, DownloadButton, FolderNameDialog, fileSorts, fileSortValue, type FileSortKey, type FolderDialog } from "./files-dialogs";
import { CustomerLogoDialog } from "../customer-logo-dialog";
import { Select } from "../select";
import { categoryDot } from "../select-options";
import type { AssignSource } from "@/lib/hub-files/assign";
import { AssignPanel, type AssignRequest } from "./asset-assign";
import { useFileDrag, type FileDropTarget } from "./asset-drag";
import { FinderList } from "./asset-list";
import { FilePanel } from "./asset-details";
import { namesByPlace, RenamePanel, storedEntries } from "./asset-naming";
import { isFileDrag, UploadPanel, useUploadQueue, type UploadTarget } from "./asset-upload";
import { CustomerSign } from "./customer-sign";
import { audienceTag, servedByNames, ServedByDialog } from "./asset-freelancers";
import { CategoryDot, FileIcon } from "./files-parts";
import { useFilesStore } from "./files-store";
import type { ScreenProps } from "./types";

const ALL = "all";
const NO_FOLDER = "none";

type View = { kind: "customer"; id: string } | { kind: "all" } | { kind: "inbox" };
/**
 * The panel over the files: the upload, one file's details, „Umbenennen“ for the ticked files, or „Zuordnen“ for some
 * files to one customer (`key` starts it afresh for every new request).
 */
type Panel = { kind: "upload" } | { kind: "file"; id: string; assign: boolean } | { kind: "rename" } | { kind: "assign"; request: AssignRequest; key: string };
/** A notice that leads somewhere ("Café Morgenrot ansehen"), kept only as long as its line is the one shown. */
type NoticeLink = { message: string; label: string; view: View };
type CustomerRow = { customer: HubFileCustomer; files: HubStoredFile[]; last: string };
type Group = { key: string; label: string; folder: HubFolder | null; files: HubStoredFile[] };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const totalSize = (list: HubStoredFile[]) => formatBytes(list.reduce((sum, file) => sum + file.sizeBytes, 0));
const newest = (list: HubStoredFile[]) => list.reduce((last, file) => (file.createdAt > last ? file.createdAt : last), "");

/** The switch of every list; the same setting as Profil › Darstellung › Listen. */
function DensitySwitch({ view, onChange }: { view: ListView; onChange: (view: ListView) => void }) {
  return (
    <div className="segmented-control am-density" role="group" aria-label="Ansicht der Liste">
      <button type="button" className="segment" aria-pressed={view === "minimal"} data-tip="Minimalistische Sicht" onClick={() => onChange("minimal")}><LayoutList size={14} aria-hidden="true" />Minimal</button>
      <button type="button" className="segment" aria-pressed={view === "list"} data-tip="Listensicht wie im Finder" onClick={() => onChange("list")}><List size={14} aria-hidden="true" />Liste</button>
      <button type="button" className="segment" aria-pressed={view === "detail"} data-tip="Detailsicht" onClick={() => onChange("detail")}><Table2 size={14} aria-hidden="true" />Detail</button>
    </div>
  );
}

/**
 * Asset Management for admins: customers on the left like the conversations, the chosen customer's files on the right.
 * Every list comes as "Minimal" (symbol in the category's colour, title, day), "Liste" (the Finder's list view, see
 * asset-list.tsx) or "Detail" (all columns).
 * Uploading and a file's details open as panels over the files; files can be dragged straight onto a folder.
 * Admins see the freelancers as a group of their own below the customers, and at each customer who looks after it.
 * Freelancers get the same view, read only: "Meine Dateien" (their own entry) and the customers they look after.
 */
export function AssetManagement({ asOf, fileState }: ScreenProps) {
  const store = useFilesStore(fileState);
  const { files, folders } = store;
  const { customers, canManage, source } = fileState;
  const freelancerView = Boolean(fileState.freelancer);
  const ownId = fileState.freelancer?.ownId ?? null;
  // „Betreut von“ names and offers no freelancer whose every login is deactivated (lib/hub-users/deactivated.ts).
  const freelancerEntries = useMemo(() => customers.filter((customer) => customer.kind === "freelancer" && !customer.inactive), [customers]);
  const { appearance, update } = useAppearance();
  const listView = appearance.listView;
  const minimal = listView === "minimal";
  // „Liste“ (the Finder's list view) shares the compact customer list and head with Minimal, and the footer with Detail.
  const finder = listView === "list";
  const compact = minimal || finder;
  const canUpload = canManage && source === "supabase" && !fileState.error;

  const rows = useMemo<CustomerRow[]>(() => customers.map((customer) => {
    const own = files.filter((file) => file.customers.some((item) => item.id === customer.id));
    return { customer, files: own, last: newest(own) };
  }), [customers, files]);
  const inbox = useMemo(() => files.filter((file) => !file.customers.length), [files]);
  // The customers list carries the logos; a file's own customer entries do not, so they are looked up here.
  const logos = useMemo(() => new Map(customers.flatMap((customer) => customer.logo ? [[customer.id, customer.logo] as const] : [])), [customers]);

  // A notice links its file (/files?file=<id>): the page opens with that file and its customer. The project dialog
  // links its customer (/files?customer=<id>): the page opens on that customer's files.
  const params = useSearchParams();
  const linkedFile = params.get("file");
  const linkedCustomer = customers.some((customer) => customer.id === params.get("customer")) ? params.get("customer") : null;
  const [panel, setPanel] = useState<Panel | null>(() => linkedFile && files.some((file) => file.id === linkedFile) ? { kind: "file", id: linkedFile, assign: false } : null);
  const [view, setView] = useState<View>(() => {
    const linked = files.find((file) => file.id === linkedFile);
    if (linked) return linked.customers[0] ? { kind: "customer", id: linked.customers[0].id } : { kind: "inbox" };
    if (linkedCustomer) return { kind: "customer", id: linkedCustomer };
    const recent = [...rows].filter((row) => row.customer.id !== ownId).sort((a, b) => b.last.localeCompare(a.last))[0];
    if (recent?.files.length) return { kind: "customer", id: recent.customer.id };
    return ownId ? { kind: "customer", id: ownId } : { kind: "all" };
  });
  // Narrow screens show one side at a time: the customers first, unless a link opened a file or a customer.
  const [paneOpen, setPaneOpen] = useState(Boolean(linkedFile || linkedCustomer));
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
  // Files waiting for "Endgültig löschen": one from its details or several from the selection.
  const [deleting, setDeleting] = useState<HubStoredFile[] | null>(null);
  const queue = useUploadQueue(customers, folders);
  // Files dragged in from the computer: how many, and the folder under the mouse (NO_FOLDER outside of one).
  const [drag, setDrag] = useState<{ count: number; folder: string } | null>(null);
  const dragDepth = useRef(0);
  // The same over the customer list: how many files and the customer (or "inbox") under the mouse, if any.
  const [listDrag, setListDrag] = useState<{ count: number; id: string | null } | null>(null);
  const listDepth = useRef(0);
  const sheet = useRef<HTMLDivElement>(null);
  const [logoFor, setLogoFor] = useState<string | null>(null);
  const [servedFor, setServedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<"download" | "move" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeLink, setNoticeLink] = useState<NoticeLink | null>(null);
  // Files just uploaded, renamed or moved light up for a few seconds, so the eye finds them in the list.
  const [fresh, setFresh] = useState<string[]>([]);
  useEffect(() => {
    if (!fresh.length) return;
    const timer = window.setTimeout(() => setFresh([]), 6000);
    return () => window.clearTimeout(timer);
  }, [fresh]);
  // The customer that just got files lights up in the list for a moment (it may also have moved to the top).
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 3200);
    return () => window.clearTimeout(timer);
  }, [flash]);
  // Freelancers read here what they see and what not; admins have an ⓘ at each feature instead.
  const freelancerInfo = useInfo("Was du hier siehst", {
    steps: [
      <><b>Meine Dateien</b> stellt oalab für dich bereit.</>,
      <><b>Meine Kunden:</b> ansehen und laden, nichts ändern.</>,
      <><b>„Nur für dich“</b> heißt: Der Kunde sieht es nicht.</>,
    ],
    ask: "Was sehe ich als Freelancer im Asset Management?",
  });

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
  // „Umbenennen“ belongs to the ticks: once none is left, it closes (adjusted while rendering, no effect needed).
  if (panel?.kind === "rename" && !selection.length) setPanel(null);
  const renaming = panel?.kind === "rename" && selection.length > 0;
  // „Zuordnen“ keeps the files it was opened with; once none of them exists any more, it closes.
  const assigning = panel?.kind === "assign" ? files.filter((file) => panel.request.ids.includes(file.id)) : [];
  if (panel?.kind === "assign" && !assigning.length) setPanel(null);
  const openFile = panel?.kind === "file" ? files.find((file) => file.id === panel.id) : undefined;
  const logoRow = logoFor ? rows.find((row) => row.customer.id === logoFor) : undefined;
  const usedFormats = Array.from(new Set(paneFiles.map((file) => fileFormat(file.fileName)))).sort();
  const usedCategories = fileCategoryIds.filter((id) => paneFiles.some((file) => file.category === id));
  const filterCount = [category !== ALL, format !== ALL].filter(Boolean).length;
  const narrowed = query.trim() !== "" || filterCount > 0;

  // Folders and moves: admins (and the preview) everywhere; a freelancer only in their own files, never at a customer.
  const canOrganize = !freelancerView || (current !== null && current.id === ownId);
  // Renaming several files: admins only, like the title in a file's details; the preview renames in this tab.
  const canRename = canManage && !fileState.error;
  // „Zuordnen“: admins only, to any customer or freelancer whose logins are not all deactivated.
  const canAssign = canManage && !fileState.error;
  const assignTargets = useMemo(() => customers.filter((customer) => !(customer.kind === "freelancer" && customer.inactive)), [customers]);
  const isOwn = current !== null && current.id === ownId;
  const servedBy = current && canManage && current.kind !== "freelancer" ? servedByNames(current, freelancerEntries) : "";
  const customersOf = (freelancerId: string) => customers.filter((customer) => customer.freelancerIds?.includes(freelancerId)).length;

  const term = customerQuery.trim().toLowerCase();
  const listedRows = rows
    .filter((row) => row.customer.id !== ownId)
    .filter((row) => !term || `${row.customer.company} ${row.customer.customerNumber}`.toLowerCase().includes(term))
    .sort((a, b) => customerOrder === "az" ? a.customer.company.localeCompare(b.customer.company, "de") : b.last.localeCompare(a.last) || a.customer.company.localeCompare(b.customer.company, "de"));
  const listedCustomers = listedRows.filter((row) => row.customer.kind !== "freelancer");
  const listedFreelancers = listedRows.filter((row) => row.customer.kind === "freelancer");
  const ownRow = ownId ? rows.find((row) => row.customer.id === ownId) ?? null : null;
  const customerCount = customers.filter((customer) => customer.kind !== "freelancer" && customer.id !== ownId).length;

  const closeDetails = () => setPanel((now) => now?.kind === "file" ? null : now);
  function choose(next: View) {
    setView(next);
    setPaneOpen(true);
    setSelected([]);
    setQuery("");
    setCategory(ALL);
    setFormat(ALL);
    setNotice("");
    setError("");
    // A file's details and „Zuordnen“ belong to the list they were opened from; an upload keeps its files and its target.
    closeDetails();
    setPanel((now) => now?.kind === "assign" ? null : now);
  }
  // Where „Zuordnen“ takes the files from: the Ablage, „Alle Dateien“ (they stay with their customers) or the open customer.
  const assignSource = (): AssignSource => current ? { kind: "customer", id: current.id, company: current.company } : view.kind === "inbox" ? { kind: "inbox" } : { kind: "all" };
  function openAssign(ids: string[], target: string | null) {
    setPanel({ kind: "assign", request: { ids, target, source: assignSource() }, key: `${target ?? ""}|${ids.join(",")}` });
    setPaneOpen(true);
  }
  function assigned(message: string, ids: string[], customerId: string) {
    const company = customers.find((customer) => customer.id === customerId)?.company ?? "Kunde";
    setPanel(null);
    setSelected((now) => now.filter((id) => !ids.includes(id)));
    setError("");
    setNotice(message);
    setNoticeLink({ message, label: `${company} ansehen`, view: { kind: "customer", id: customerId } });
    setFresh(ids);
    setFlash(customerId);
  }
  // Ticks and a file's details exclude each other, because the details would cover the selection bar: a tick closes
  // them, and opening a file clears the ticks, like a click on one file in a file manager. An upload stays open.
  const toggle = (id: string) => { closeDetails(); setSelected((list) => list.includes(id) ? list.filter((item) => item !== id) : [...list, id]); };
  const toggleAll = () => { closeDetails(); setSelected(selection.length === shown.length ? [] : shown.map((file) => file.id)); };
  // A folder's (or a day's) tick: all of its shown files, or none of them again; other ticks stay as they are.
  const toggleMany = (list: HubStoredFile[]) => {
    closeDetails();
    const ids = list.map((file) => file.id);
    setSelected((now) => ids.every((id) => now.includes(id)) ? now.filter((id) => !ids.includes(id)) : [...now, ...ids.filter((id) => !now.includes(id))]);
  };
  const ticksOf = (list: HubStoredFile[]) => groupTicks(list.map((file) => file.id), selected);
  const groupCheck = (list: HubStoredFile[], label: string) => ({ ...ticksOf(list), onChange: () => toggleMany(list), label: `Alle Dateien in „${label}“ auswählen`, disabled: !list.length });
  const open = (file: HubStoredFile, assign = false) => { setSelected([]); setPanel({ kind: "file", id: file.id, assign }); };

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
  // Files from the computer onto a customer in the list (or onto the Ablage) open the upload for that place (19.11.2026).
  const listTarget = (target: EventTarget) => {
    const id = target instanceof Element ? target.closest<HTMLElement>("[data-drop-customer]")?.dataset.dropCustomer : undefined;
    return id && (id === "inbox" || customers.some((customer) => customer.id === id)) ? id : null;
  };
  const endListDrag = () => { listDepth.current = 0; setListDrag(null); };
  const listDropHandlers = canDrop ? {
    onDragEnter: (event: React.DragEvent) => { if (isFileDrag(event)) { event.preventDefault(); listDepth.current++; } },
    onDragOver: (event: React.DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      const id = listTarget(event.target);
      event.dataTransfer.dropEffect = id ? "copy" : "none";
      const count = Array.from(event.dataTransfer.items).filter((item) => item.kind === "file").length;
      setListDrag((now) => now?.id === id && now.count === count ? now : { count, id });
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!isFileDrag(event)) return;
      listDepth.current = Math.max(0, listDepth.current - 1);
      if (!listDepth.current) setListDrag(null);
    },
    onDrop: (event: React.DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      endListDrag();
      const id = listTarget(event.target);
      if (!id) return;
      choose(id === "inbox" ? { kind: "inbox" } : { kind: "customer", id });
      startUpload({ customerId: id === "inbox" ? null : id, folderId: "" }, Array.from(event.dataTransfer.files));
    },
  } : {};
  // A drag that ends outside of the files (dropped elsewhere) must not leave the frame behind.
  const dragging = drag !== null || listDrag !== null;
  useEffect(() => {
    if (!dragging) return;
    const end = () => { dragDepth.current = 0; setDrag(null); listDepth.current = 0; setListDrag(null); };
    window.addEventListener("drop", end);
    window.addEventListener("dragend", end);
    return () => { window.removeEventListener("drop", end); window.removeEventListener("dragend", end); };
  }, [dragging]);
  const dropFolderName = drag && current ? drag.folder === NO_FOLDER ? "Ohne Ordner" : scopeFolders.find((folder) => folder.id === drag.folder)?.name ?? "Ohne Ordner" : "";
  const listDropName = listDrag?.id === "inbox" ? "in die Ablage" : listDrag?.id ? `für ${customers.find((customer) => customer.id === listDrag.id)?.company ?? "den Kunden"}` : "";

  /* ---------- Dragging files within the page ---------- */
  // Ticked files (or the one grabbed) go onto a customer in the list, which opens „Zuordnen“ with that customer set,
  // or onto a folder of the open customer, which moves them there at once (user 19.11.2026).
  const canDragRows = !fileState.error && (canAssign || canOrganize);
  // The folder a file lies in at the open customer (NO_FOLDER without one): dropped there again, it stays put.
  const folderOf = (id: string) => (current && files.find((file) => file.id === id)?.folderIds[current.id]) || NO_FOLDER;
  const canDropRows = (target: FileDropTarget) => target.kind === "customer"
    ? canAssign && target.id !== "inbox" && target.id !== current?.id
    : current !== null && canOrganize;
  const { drag: rowDrag } = useFileDrag({
    root: sheet,
    enabled: canDragRows,
    idsFor: (id) => selected.includes(id) ? shown.filter((file) => selected.includes(file.id)).map((file) => file.id) : [id],
    canDrop: canDropRows,
    describe: (target) => target.kind === "customer" ? `Zu ${customers.find((customer) => customer.id === target.id)?.company ?? "diesem Kunden"}` : `In „${target.key === NO_FOLDER ? "Ohne Ordner" : scopeFolders.find((folder) => folder.id === target.key)?.name ?? "Ohne Ordner"}“`,
    hint: current ? (canAssign ? "Auf einen Kunden oder Ordner ziehen" : "Auf einen Ordner ziehen") : "Links auf einen Kunden ziehen",
    onDrop: (ids, target) => target.kind === "customer" ? openAssign(ids, target.id) : moveInto(ids.filter((id) => folderOf(id) !== target.key), target.key),
  });
  const dropState = (id: string) => rowDrag ? (id !== "all" && canDropRows({ kind: "customer", id }) ? "on" : "off") : listDrag ? (id === "all" ? "off" : "on") : undefined;
  const isDropTarget = (id: string) => (rowDrag?.over?.kind === "customer" && rowDrag.over.id === id) || listDrag?.id === id;
  const folderLit = (key: string) => drag?.folder === key || (rowDrag?.over?.kind === "folder" && rowDrag.over.key === key);
  const dragAttrs = (file: HubStoredFile): Record<string, string> => canDragRows ? { "data-drag-file": file.id, "data-drag-title": file.title, "data-drag-cat": file.category } : {};

  async function download() {
    setBusy("download");
    setError("");
    const result = await store.download(selection);
    setBusy(null);
    if (!result.ok) setError(result.error);
  }

  async function move(target: string) {
    if (target) await moveInto(selection.map((file) => file.id), target);
  }

  /** Files of the open customer into one of its folders („Verschieben“ in the selection, or dragged onto the folder). */
  async function moveInto(ids: string[], target: string) {
    if (!current || !ids.length) return;
    setBusy("move");
    setError("");
    const folderId = target === NO_FOLDER ? null : target;
    const result = await store.move(ids, current.id, folderId);
    setBusy(null);
    if (!result.ok) { setError(result.error); return; }
    const name = folderId ? scopeFolders.find((item) => item.id === folderId)?.name : "Ohne Ordner";
    setNotice(`${plural(result.data.count, "Datei", "Dateien")} nach „${name}“ verschoben.`);
    setSelected((now) => now.filter((id) => !ids.includes(id)));
    setFresh(ids);
  }

  async function remove(list: HubStoredFile[]) {
    const ids = list.map((file) => file.id);
    const result = await deleteFiles(ids);
    if (!result.ok) return result;
    setSelected((now) => now.filter((id) => !ids.includes(id)));
    setPanel((now) => now?.kind === "file" && ids.includes(now.id) ? null : now);
    const gone = result.data.count;
    if (gone < ids.length) setError(`${gone} von ${ids.length} Dateien gelöscht. Die übrigen ließen sich nicht löschen.`);
    else setNotice(ids.length === 1 ? `„${list[0].title}“ gelöscht.` : `${plural(gone, "Datei", "Dateien")} gelöscht.`);
    return result;
  }

  const others = (file: HubStoredFile) => file.customers.filter((item) => item.id !== current?.id);

  /* ---------- Rows ---------- */
  const tagOf = (file: HubStoredFile) => {
    if (!current || (!freelancerView && !current.freelancerIds?.length)) return null;
    const text = audienceTag(file.audiences?.[current.id], freelancerView);
    return text ? <span className="am-audience-tag">{text}</span> : null;
  };

  const minimalRow = (file: HubStoredFile, trail?: React.ReactNode) => {
    const isSelected = selected.includes(file.id);
    const shared = current && !freelancerView ? others(file) : [];
    return (
      <div key={file.id} className={`am-min-row${isSelected ? " is-selected" : ""}${fresh.includes(file.id) ? " is-fresh" : ""}${rowDrag?.ids.includes(file.id) ? " is-dragged" : ""}`} role="listitem" {...dragAttrs(file)}>
        <span className={`am-min-lead am-cat-${file.category}`} data-tip={fileCategories[file.category]}>
          <FileIcon file={file} size={17} color="currentColor" />
          <input type="checkbox" checked={isSelected} onChange={() => toggle(file.id)} aria-label={`${file.title} auswählen`} />
        </span>
        <button type="button" className="am-min-title" onClick={() => open(file)} data-tip={file.fileName}>
          <span className="t">{file.title}</span>
          {shared.length > 0 && <span className="am-min-shared" data-tip={`Auch bei ${shared.map((item) => item.company).join(", ")}`}><Users size={12} aria-hidden="true" />{shared.length + 1}</span>}
          {tagOf(file)}
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
    const shared = current && !freelancerView ? others(file) : [];
    return (
      <button type="button" className="am-file" onClick={() => open(file)} data-tip={file.fileName}>
        <span className="am-file-icon"><FileIcon file={file} size={17} /></span>
        <span className="am-file-text">
          <strong>{file.title}{tagOf(file)}</strong>
          <small>{fileFormat(file.fileName)} · {formatBytes(file.sizeBytes)}{shared.length > 0 && <> · auch bei <b>{shared.map((item) => item.company).join(", ")}</b></>}</small>
        </span>
      </button>
    );
  };

  const who = (file: HubStoredFile, compact = false) => file.customers.length
    ? <span className={compact ? "am-min-who" : "am-customer"}><CustomerSign customer={file.customers[0]} logo={logos.get(file.customers[0].id)} size={compact ? "xs" : "sm"} /><span>{file.customers[0].company}</span>{file.customers.length > 1 && <span className={compact ? "am-min-plus" : "am-plus"} data-tip={file.customers.slice(1).map((item) => item.company).join(", ")}>+{file.customers.length - 1}</span>}</span>
    : <span className={compact ? "am-min-who is-inbox" : "am-customer is-inbox"}><Inbox size={compact ? 13 : 15} aria-hidden="true" /><span>Ablage</span></span>;

  const assignButton = (file: HubStoredFile) => canAssign
    ? <button type="button" className="sheet-action" onClick={() => openAssign([file.id], null)}><UserPlus size={15} aria-hidden="true" />Zuordnen</button>
    : null;

  const tableRow = (file: HubStoredFile, columns: "customer" | "all" | "inbox") => (
    <tr key={file.id} className={`file-row${selected.includes(file.id) ? " is-selected" : ""}${fresh.includes(file.id) ? " is-fresh" : ""}${rowDrag?.ids.includes(file.id) ? " is-dragged" : ""}`} {...dragAttrs(file)}>
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
        <th scope="col" className="cell-select"><GroupCheck {...ticksOf(shown)} onChange={toggleAll} disabled={!shown.length} label="Alle angezeigten Dateien auswählen" /></th>
        <SortHeader option={fileSorts.title} label="Datei" sort={sort} onChange={setSort} />
        {view.kind === "all" && <th scope="col">Kunde</th>}
        <SortHeader option={fileSorts.category} sort={sort} onChange={setSort} />
        <SortHeader option={fileSorts.date} sort={sort} onChange={setSort} />
        <th scope="col"><span className="visually-hidden">Aktionen</span></th>
      </tr>
    </thead>
  );

  const folderActions = (group: Group) => <>
    {canUpload && <button type="button" className="table-group-action is-accent" onClick={() => startUpload({ customerId: current!.id, folderId: group.folder?.id ?? "" })} aria-label={`In „${group.label}“ hochladen`} data-tip="Hierher hochladen"><Upload size={14} aria-hidden="true" /></button>}
    {group.folder && canOrganize && <>
      <button type="button" className="table-group-action" onClick={() => setDialog({ kind: "rename", folder: group.folder! })} aria-label={`Ordner „${group.label}“ umbenennen`} data-tip="Umbenennen"><Pencil size={14} aria-hidden="true" /></button>
      <button type="button" className="table-group-action" onClick={() => setDialog({ kind: "delete", folder: group.folder! })} aria-label={`Ordner „${group.label}“ löschen`} data-tip="Löschen"><Trash2 size={14} aria-hidden="true" /></button>
    </>}
  </>;

  // „Liste“: the Finder's list view (asset-list.tsx). A click there selects, so it shares the ticks with the other views.
  const finderList = (folderList: Group[] | null, label: string, showCustomer: boolean) => (
    <FinderList label={label} groups={folderList} files={shown} showCustomer={showCustomer} selected={selected}
      onSelect={(ids) => { closeDetails(); setSelected(ids); }} onOpen={(file) => open(file)} fresh={fresh} dragIds={rowDrag?.ids ?? []}
      isDrop={folderLit} isCollapsed={groups.isCollapsed} onToggle={groups.toggle} sort={sort} onSort={setSort}
      folderActions={(group) => folderActions(group)} customerOf={(file) => who(file, true)} dragAttrs={dragAttrs}
      canDropFolders={canDrop || canDragRows} asOf={asOf} />
  );

  const customerBody = finder ? finderList(narrowed ? folderGroups.filter((group) => !group.folder || group.files.length) : folderGroups, `Dateien von ${current?.company ?? ""}`, false) : minimal ? (
    <div className={`am-min${selection.length ? " is-selecting" : ""}`} role="list" aria-label={`Dateien von ${current?.company ?? ""}`}>
      {folderGroups.map((group) => (
        <div key={group.key} className="am-min-group" role="presentation" data-drop-folder={canDrop || canDragRows ? group.key : undefined}>
          <div className={`am-min-section${folderLit(group.key) ? " is-drop" : ""}`}>
            <span className="am-min-section-check">{group.files.length > 0 && <GroupCheck {...groupCheck(group.files, group.label)} />}</span>
            <button type="button" className="am-min-section-toggle" aria-expanded={!groups.isCollapsed(group.key)} onClick={() => groups.toggle(group.key)}>
              <ChevronDown size={13} aria-hidden="true" /><span>{group.label}</span><span className="am-min-count">{group.files.length || (narrowed ? "0" : "leer")}</span>
            </button>
            <span className="am-min-section-acts">{folderActions(group)}</span>
          </div>
          {!groups.isCollapsed(group.key) && group.files.map((file) => minimalRow(file))}
        </div>
      ))}
      {canOrganize && <button type="button" className="am-min-add" onClick={() => setDialog({ kind: "create" })}><Plus size={15} aria-hidden="true" />Neuer Ordner</button>}
    </div>
  ) : (
    <div className="sheet-scroll">
      <table className="file-table">
        <caption className="visually-hidden">Dateien von {current?.company} mit Kategorie und Datum</caption>
        {tableHead}
        {grouping === "folder" ? folderGroups.map((group) => (
          <TableGroup key={group.key} colSpan={columnsFor} label={group.label} count={group.files.length} glyph={<Folder size={16} aria-hidden="true" />}
            collapsed={groups.isCollapsed(group.key)} onToggle={() => groups.toggle(group.key)}
            className={folderLit(group.key) ? "is-drop" : undefined} dropKey={canDrop || canDragRows ? group.key : undefined}
            empty={narrowed ? "Keine Dateien für diese Auswahl in diesem Ordner." : canOrganize ? "Noch leer. Dateien hierher ziehen oder ankreuzen und verschieben." : "Noch leer."}
            actions={folderActions(group)} select={groupCheck(group.files, group.label)}>
            {group.files.map((file) => tableRow(file, "customer"))}
          </TableGroup>
        )) : <tbody>{shown.map((file) => tableRow(file, "customer"))}</tbody>}
        {grouping === "folder" && canOrganize && <TableAddRow colSpan={columnsFor} label="Neuer Ordner" onClick={() => setDialog({ kind: "create" })} />}
      </table>
    </div>
  );

  const dayGroups = shown.reduce<{ label: string; files: HubStoredFile[] }[]>((list, file) => {
    const label = fileDayGroup(file.createdAt, asOf);
    const last = list[list.length - 1];
    if (last && last.label === label) last.files.push(file); else list.push({ label, files: [file] });
    return list;
  }, []);

  const allBody = finder ? finderList(null, "Alle Dateien", true) : minimal ? (
    <div className={`am-min${selection.length ? " is-selecting" : ""}`} role="list" aria-label="Alle Dateien">
      {dayGroups.map((group) => (
        <div key={group.label} className="am-min-group" role="presentation">
          <div className="am-min-section">
            <span className="am-min-section-check"><GroupCheck {...groupCheck(group.files, group.label)} /></span>
            <span className="am-min-section-toggle">{group.label}<span className="am-min-count">{group.files.length}</span></span>
          </div>
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

  const inboxBody = finder ? finderList(null, "Dateien ohne Kunden", false) : minimal ? (
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
  // „Alle auswählen“ over the list (user 13.11.2026): in Minimal, and in Detail on phones, where the table drops its head.
  const selectAll = !empty && shown.length > 0 && (
    <label className={`am-select-all${minimal ? "" : " is-detail"}`}>
      <span className="am-select-all-box"><GroupCheck {...ticksOf(shown)} onChange={toggleAll} /></span>
      <span>{narrowed ? `Alle ${shown.length} Treffer auswählen` : "Alle auswählen"}</span>
    </label>
  );
  const body = empty
    ? <SheetEmpty text={narrowed ? (query.trim() ? `Keine Dateien zu „${query.trim()}“.` : "Keine Dateien für diese Auswahl.") : view.kind === "inbox" ? "Die Ablage ist leer. Alle Dateien haben einen Kunden." : "Noch keine Dateien."} onReset={narrowed ? () => { setQuery(""); setCategory(ALL); setFormat(ALL); } : undefined} />
    : current ? customerBody : view.kind === "inbox" ? inboxBody : allBody;

  /* ---------- Pane head ---------- */
  const back = <button type="button" className="chat-back" onClick={() => setPaneOpen(false)} aria-label="Zurück zu den Kunden"><ChevronLeft size={24} aria-hidden="true" /></button>;
  // On phones the head's buttons show their symbols only, so the customer's name keeps its room (glass.css).
  const uploadButton = canUpload && <button type="button" className="sheet-action is-primary" onClick={() => startUpload({ customerId: current?.id ?? null, folderId: "" })}><Upload size={15} aria-hidden="true" /><span className="am-btn-text">Hochladen</span></button>;
  const head = current ? (
    <header className="am-pane-head">
      {back}
      {/* The logo opens from its own button and from the sign; the badge shows on hover, and always while there is none. */}
      {canUpload ? (
        <button type="button" className="am-sign-edit" onClick={() => setLogoFor(current.id)} data-tip={current.logo ? "Logo ändern" : "Logo hochladen"} aria-label={`Logo von ${current.company} ${current.logo ? "ändern" : "hochladen"}`}>
          <CustomerSign customer={current} logo={current.logo} size="lg" />
          <span className={`am-sign-badge${current.logo ? "" : " is-shown"}`} aria-hidden="true"><ImagePlus size={12} /></span>
        </button>
      ) : <CustomerSign customer={current} logo={current.logo} size="lg" />}
      <div className="am-pane-title">
        <strong>{isOwn ? "Meine Dateien" : current.company}</strong>
        <span>{[
          isOwn ? "Von oalab für dich" : compact ? "" : current.customerNumber,
          current.kind === "freelancer" && canManage ? `Freelancer · ${plural(customersOf(current.id), "Kunde", "Kunden")}` : "",
          plural(paneFiles.length, "Datei", "Dateien"),
          totalSize(paneFiles),
        ].filter(Boolean).join(" · ")}</span>
      </div>
      <div className="am-pane-actions">
        {canUpload && fileState.freelancers && current.kind !== "freelancer" && freelancerEntries.length > 0 && (
          <button type="button" className={`sheet-action am-served${servedBy ? " is-set" : ""}`} onClick={() => setServedFor(current.id)} data-tip={servedBy ? `Betreut von ${servedBy}` : "Einen Freelancer zuordnen"}>
            <Handshake size={15} aria-hidden="true" /><span className="am-served-text">{servedBy ? servedBy : "Freelancer"}</span>
          </button>
        )}
        {canUpload && <button type="button" className="sheet-action am-logo-button" onClick={() => setLogoFor(current.id)} data-tip={`Logo von ${current.company}`}><ImagePlus size={15} aria-hidden="true" /><span className="am-logo-text">{current.logo ? "Logo ändern" : "Logo hochladen"}</span></button>}
        {!minimal && canOrganize && <button type="button" className="sheet-action am-wide" onClick={() => setDialog({ kind: "create" })}><FolderPlus size={15} aria-hidden="true" />Neuer Ordner</button>}{uploadButton}
      </div>
    </header>
  ) : view.kind === "inbox" ? (
    <header className="am-pane-head">
      {back}
      <span className="am-tile is-inbox is-lg"><Inbox size={22} aria-hidden="true" /></span>
      <div className="am-pane-title"><strong>Ablage</strong><span>{plural(inbox.length, "Datei", "Dateien")} ohne Kunden. {canAssign ? `${finder ? "Auswählen" : "Anhaken"} und links auf einen Kunden ziehen.` : "Kunden sehen sie erst nach dem Zuordnen."}</span></div>
      <div className="am-pane-actions">{uploadButton}</div>
    </header>
  ) : (
    <header className="am-pane-head">
      {back}
      <span className="am-tile is-lg"><Files size={22} aria-hidden="true" /></span>
      <div className="am-pane-title"><strong>Alle Dateien</strong><span>{compact ? `${plural(files.length, "Datei", "Dateien")} · neueste zuerst` : `${plural(files.length, "Datei", "Dateien")} bei ${plural(customerCount, "Kunde", "Kunden")} · ${totalSize(files)}`}</span></div>
      <div className="am-pane-actions">{uploadButton}</div>
    </header>
  );

  const filters = <>
    <FilterSelect icon={Tag} name="Nach Kategorie filtern" value={category} onChange={setCategory} options={[{ value: ALL, label: "Alle Kategorien" }, ...usedCategories.map((id) => ({ value: id, label: fileCategories[id], lead: categoryDot(id) }))]} />
    <FilterSelect icon={FileType} name="Nach Format filtern" value={format} onChange={setFormat} options={[{ value: ALL, label: "Alle Formate" }, ...usedFormats.map((item) => ({ value: item, label: item }))]} />
  </>;

  /* ---------- Customers ---------- */
  const pinned = (target: View, sign: React.ReactNode, title: string, sub: string, right: React.ReactNode) => {
    const active = view.kind === target.kind && (target.kind !== "customer" || (view.kind === "customer" && view.id === target.id));
    // While files are dragged, the customers (and, for files from the computer, the Ablage) take them; the rest steps back.
    const dropId = target.kind === "customer" ? target.id : target.kind;
    const takes = (canAssign || canDrop) && dropId !== "all";
    return (
      <li key={target.kind === "customer" ? target.id : target.kind}>
        <button type="button" className={`chat-conv${compact ? " am-min-conv" : ""}${target.kind === "customer" && flash === target.id ? " is-flash" : ""}${isDropTarget(dropId) ? " is-drop-target" : ""}`} aria-current={active ? "true" : undefined} onClick={() => choose(target)}
          data-drop-customer={takes ? dropId : undefined} data-drop-state={dropState(dropId)}>
          {sign}
          {compact ? <span className="am-min-conv-name">{title}</span> : <span className="chat-conv-main"><span className="chat-conv-top"><strong>{title}</strong>{right}</span><span className="chat-conv-sub"><span className="chat-conv-last">{sub}</span></span></span>}
          {compact && right}
        </button>
      </li>
    );
  };

  const customerRow = ({ customer, files: own, last }: CustomerRow) => pinned(
    { kind: "customer", id: customer.id },
    <CustomerSign customer={customer} logo={customer.logo} size={compact ? "md" : undefined} />,
    customer.company,
    `${customer.customerNumber} · ${customer.kind === "freelancer" ? `Freelancer · ${plural(customersOf(customer.id), "Kunde", "Kunden")}` : own.length ? plural(own.length, "Datei", "Dateien") : "noch keine Dateien"}`,
    compact ? <span className="am-count">{own.length || ""}</span> : last ? <time className={formatFileDay(last, asOf) === "Heute" ? "is-new" : undefined}>{formatFileDay(last, asOf)}</time> : null,
  );

  const customerList = (
    <div className="chat-list" {...listDropHandlers}>
      <div className="chat-list-head">
        <h2>{freelancerView ? "Meine Kunden" : "Kunden"}<span>{customerCount}</span>{freelancerView && freelancerInfo.button}</h2>
        {canUpload && <button type="button" className="chat-icon-button" onClick={() => startUpload({ customerId: null, folderId: "" })} aria-label="Hochladen" data-tip="Hochladen"><Upload size={19} aria-hidden="true" /></button>}
      </div>
      {freelancerView && freelancerInfo.box}
      <label className="chat-search"><Search size={15} aria-hidden="true" /><input type="search" value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder={compact ? "Kunde suchen" : "Kunde oder Kundennummer"} aria-label="Kunden durchsuchen" /></label>
      {!compact && (
        <div className="chat-filter" role="group" aria-label="Reihenfolge">
          <button type="button" aria-pressed={customerOrder === "recent"} onClick={() => setCustomerOrder("recent")}>Zuletzt aktiv</button>
          <button type="button" aria-pressed={customerOrder === "az"} onClick={() => setCustomerOrder("az")}>A–Z</button>
        </div>
      )}
      <ul className="chat-convs" role="list">
        {!term && pinned({ kind: "all" }, <span className={`am-tile${compact ? " is-md" : ""}`}><Files size={compact ? 16 : 20} aria-hidden="true" /></span>, "Alle Dateien", `${plural(customerCount, "Kunde", "Kunden")} · ${totalSize(files)}`, <span className="am-count">{files.length}</span>)}
        {!term && !freelancerView && pinned({ kind: "inbox" }, <span className={`am-tile is-inbox${compact ? " is-md" : ""}`}><Inbox size={compact ? 16 : 20} aria-hidden="true" /></span>, "Ablage", "Noch keinem Kunden zugeordnet", inbox.length ? <span className="chat-pill tone-todo">{inbox.length}</span> : <span className="am-count">0</span>)}
        {!term && ownRow && pinned({ kind: "customer", id: ownRow.customer.id }, <CustomerSign customer={ownRow.customer} logo={ownRow.customer.logo} size={compact ? "md" : undefined} />, "Meine Dateien", `Von oalab für dich · ${ownRow.files.length ? plural(ownRow.files.length, "Datei", "Dateien") : "noch keine Dateien"}`, compact ? <span className="am-count">{ownRow.files.length || ""}</span> : ownRow.last ? <time>{formatFileDay(ownRow.last, asOf)}</time> : null)}
        <li className="am-list-label">{freelancerView ? "Meine Kunden" : compact ? "Kunden" : customerOrder === "az" ? "Kunden von A bis Z" : "Kunden · zuletzt aktiv"}</li>
        {listedCustomers.map(customerRow)}
        {!listedCustomers.length && <li className="chat-empty">{term ? `Kein Kunde passt zu „${customerQuery.trim()}“.` : freelancerView ? "Dir sind noch keine Kunden zugeordnet." : "Es sind noch keine Kunden angelegt."}</li>}
        {listedFreelancers.length > 0 && <>
          <li className="am-list-label">Freelancer</li>
          {listedFreelancers.map(customerRow)}
        </>}
      </ul>
      {listDrag?.id && (
        <div className="am-drop-pill is-list" aria-hidden="true">
          <Upload size={18} />{listDrag.count > 1 ? `${listDrag.count} Dateien loslassen` : listDrag.count === 1 ? "Datei loslassen" : "Dateien loslassen"}<span>{listDropName}</span>
        </div>
      )}
    </div>
  );

  return (
    <>
      <LargeTitleHeader title="Asset Management" icon={<CategoryTitle category="files" />} actions={<HeaderActions />} />
      {fileState.error && <GlassCard className="section-first"><p className="t-headline">Dateien nicht verfügbar</p><p className="t-subheadline t-secondary">{fileState.error}</p></GlassCard>}
      {source === "fixtures" && <GlassCard className="section-first file-demo-note"><Inbox size={18} color="var(--accent-text)" aria-hidden="true" /><p className="t-subheadline">Hochladen und Zuordnen ist nur mit echtem Admin-Login möglich. Die Liste zeigt fiktive Beispieldateien; Ordner und Verschiebungen bleiben in diesem Browserfenster.</p></GlassCard>}
      {notice && (
        <p className="calendar-notice" role="status">
          <Check size={18} aria-hidden="true" /><span className="calendar-notice-text">{notice}</span>
          {noticeLink?.message === notice && <button type="button" className="calendar-notice-action" onClick={() => choose(noticeLink.view)}>{noticeLink.label}<ArrowRight size={15} aria-hidden="true" /></button>}
        </p>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}

      {!fileState.error && (
        <div ref={sheet} className={`sheet section-first am${compact ? " is-minimal" : ""}${finder ? " is-list" : ""}${rowDrag ? " is-dragging" : ""}`} data-open={paneOpen ? "" : undefined} {...guardSheet}>
          <div className="am-grid">
            {customerList}
            <section className={`am-pane${panel && (panel.kind !== "rename" || renaming) ? " has-panel" : ""}`} aria-label={current ? current.company : view.kind === "inbox" ? "Ablage" : "Alle Dateien"} {...dropHandlers}>
              {head}
              <SheetToolbar query={query} onQuery={setQuery} placeholder={current ? `In ${current.company} suchen …` : "Titel, Dateiname oder Kunde …"} label="Dateien durchsuchen" compact={!compact}
                trailing={<DensitySwitch view={listView} onChange={(next) => update({ listView: next })} />}>
                {compact ? <ToolbarMenu icon={SlidersHorizontal} label="Filter" badge={filterCount}>{filters}</ToolbarMenu> : <>
                  <ToolbarMenu icon={ListFilter} label="Filter" badge={filterCount}>{filters}</ToolbarMenu>
                  <ToolbarMenu icon={ArrowUpDown} label="Sortierung" value={fileSorts[sort.key].label}><SortControl options={Object.values(fileSorts)} sort={sort} onChange={setSort} /></ToolbarMenu>
                  {current && <ToolbarMenu icon={Rows3} label="Gruppe" value={grouping === "folder" ? "Ordner" : "Keine"}><MenuChoices label="Gruppieren nach" value={grouping} onChange={setGrouping} options={[{ id: "folder", label: "Ordner" }, { id: "none", label: "Keine Gruppen" }]} /></ToolbarMenu>}
                </>}
              </SheetToolbar>
              {/* The count on the left, every action on the right, × at the end (user 13.11.2026). Narrower panes shorten
                  it in steps, phones show symbols only, and with a panel open only the count and × stay (glass.css). */}
              {selection.length > 0 && (
                <div className="sheet-selection am-selection" role="region" aria-label="Auswahl">
                  <strong className="numeric">{selection.length} <span className="am-sel-long">{selection.length === 1 ? "Datei" : "Dateien"} </span>ausgewählt</strong>
                  <span className="am-sel-acts">
                    <button type="button" className="sheet-action is-primary" onClick={download} disabled={busy !== null}>{busy === "download" ? <MiniLoader size={16} /> : <Download size={15} aria-hidden="true" />}<span className="am-btn-text">{selection.length > 1 ? "ZIP herunterladen" : "Herunterladen"}</span></button>
                    {canAssign && <button type="button" className="sheet-action" aria-pressed={panel?.kind === "assign"} onClick={() => openAssign(selection.map((file) => file.id), null)} disabled={busy !== null} data-tip-compact="Zuordnen"><UserPlus size={15} aria-hidden="true" /><span className="am-btn-text" data-tip-label>Zuordnen</span></button>}
                    {canRename && <button type="button" className="sheet-action" aria-pressed={renaming} onClick={() => setPanel(renaming ? null : { kind: "rename" })} disabled={busy !== null}><PenLine size={15} aria-hidden="true" /><span className="am-btn-text">Umbenennen</span></button>}
                    {current && canOrganize && (
                      <span className="sheet-move">
                        <FolderInput className="sheet-move-icon" size={15} aria-hidden="true" />
                        <Select variant="bare" chevron label="Ausgewählte Dateien verschieben nach" placeholder="Verschieben" value="" onChange={move} disabled={busy !== null}
                          options={[...scopeFolders.map((item) => ({ value: item.id, label: item.name, lead: <Folder size={15} aria-hidden="true" /> })), { value: NO_FOLDER, label: "Ohne Ordner", lead: <Inbox size={15} aria-hidden="true" /> }]} />
                      </span>
                    )}
                    {canUpload && <button type="button" className="sheet-action is-danger" onClick={() => setDeleting(selection)} disabled={busy !== null} data-tip-compact="Löschen"><Trash2 size={15} aria-hidden="true" /><span className="am-btn-text" data-tip-label>Löschen</span></button>}
                  </span>
                  <button type="button" className="am-icon-btn am-selection-clear" onClick={() => setSelected([])} aria-label="Auswahl aufheben" data-tip="Auswahl aufheben"><X size={17} aria-hidden="true" /></button>
                </div>
              )}
              <div className="am-scroll">{selectAll}{body}</div>
              {!minimal && <SheetFooter hint={shown.length > 1 ? (finder ? `Mit ⇧ oder ⌘/Strg mehrere wählen${canAssign ? ", dann links auf einen Kunden ziehen" : ""}` : canAssign ? "Mehrere ankreuzen und links auf einen Kunden ziehen" : "Mehrere ankreuzen: als ZIP laden oder verschieben") : undefined}>{plural(shown.length, "Datei", "Dateien")}{shown.length ? ` · ${totalSize(shown)}` : ""}</SheetFooter>}
              {drag && <>
                <div className="am-drop" aria-hidden="true" />
                <div className="am-drop-pill" aria-hidden="true">
                  <Upload size={18} />{drag.count > 1 ? `${drag.count} Dateien loslassen` : drag.count === 1 ? "Datei loslassen" : "Dateien loslassen"}
                  <span>{current ? `nach „${dropFolderName}“ · ${current.company}` : "Kunde und Ordner wählst du gleich"}</span>
                </div>
              </>}
              {panel?.kind === "upload" && <UploadPanel queue={queue} customers={customers} existing={namesByPlace(files)} onClose={closeUpload} onUploaded={(message, ids) => { setPanel(null); setNotice(message); setFresh(ids); }} />}
              {panel?.kind === "assign" && assigning.length > 0 && (
                <AssignPanel key={panel.key} request={panel.request} files={assigning} customers={assignTargets} folders={folders} onAssign={store.assign} onClose={() => setPanel(null)} onDone={assigned} />
              )}
              {renaming && (
                <RenamePanel files={selection} entries={storedEntries(selection, current, folders)} existing={namesByPlace(files, new Set(selected))} onClose={() => setPanel(null)} onRename={store.renameFiles}
                  onDone={(message, ids) => { setPanel(null); setSelected([]); setError(""); setNotice(message); setFresh(ids); }} />
              )}
              {openFile && (
                <FilePanel file={openFile} customers={customers} folders={folders} here={current} live={source === "supabase"} canAssign={canManage && source === "supabase"}
                  canFile={(customerId) => !freelancerView || customerId === ownId} freelancerView={freelancerView}
                  onAudience={canManage && source === "supabase" && fileState.freelancers ? async (customerId, audience) => {
                    const result = await setFileAudience(openFile.id, customerId, audience);
                    if (result.ok) setNotice(`Sichtbarkeit von „${openFile.title}“ gespeichert.`);
                    return result;
                  } : undefined}
                  startAssigning={panel?.kind === "file" && panel.assign} onClose={() => setPanel(null)} onNotice={setNotice}
                  onMove={(customerId, folderId) => store.move([openFile.id], customerId, folderId)} onDelete={() => setDeleting([openFile])} />
              )}
            </section>
          </div>
        </div>
      )}

      {deleting && <DeleteFilesDialog files={deleting} onClose={() => setDeleting(null)} onDelete={() => remove(deleting)} />}
      {logoRow && <CustomerLogoDialog customer={logoRow.customer} onClose={() => setLogoFor(null)} onSaved={(message) => { setLogoFor(null); setNotice(message); }} />}
      {servedFor && current?.id === servedFor && <ServedByDialog customer={current} freelancers={freelancerEntries} onClose={() => setServedFor(null)} onSaved={(message) => { setServedFor(null); setNotice(message); }} />}
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
