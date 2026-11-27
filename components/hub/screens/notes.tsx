"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Copy, Lock, Maximize2, MessageCircle, Minimize2, NotebookPen, PanelLeftOpen, RefreshCw, Settings, Smile, Image as ImageIcon, Trash2, Type, X } from "lucide-react";
import { categories } from "@/lib/categories";
import { hubHref } from "@/lib/hub-data";
import { useStoredValue } from "@/lib/use-stored-value";
import {
  createNoteAppointment, createNotePage, createNoteTask, loadNoteTrash, loadNotesCustomer, noteAppointmentOptions, noteCoverFiles, noteHistory, noteImageUrls, noteLinkPreview, notePresence, noteReaders, noteRequestSlots,
  noteTaskOptions, notifyNoteChange, notifyNoteTeam, openNotePage, purgeNotePage, requestNoteAppointment, restoreNotePage, restoreNoteRevision, saveNotePage, saveNoteSettings, searchNoteTasks,
  setNoteAccess, setNoteTaskDone, taskMentions, trashNotePage,
} from "@/lib/hub-notes/actions";
import { notesFixtures, previewAppointmentOptions, previewCustomerPages, previewCustomerProjects, previewMentions, previewPage, previewRefs, previewRevisions, toMetaOnly } from "@/lib/hub-notes/fixtures";
import { accessLabel, accessOf, audienceLabel, cleanNoteTitle, editedAgo, emptyNoteDoc, fitRights, gains, isEmptyDoc, narrowedBelow, newPageRights, noteText, pathOf, plainDoc, positionAfter, childrenOf, descendantsOf, rightsFrom, uploadSize, viewerEdits, viewerReads, within } from "@/lib/hub-notes/rules";
import { coverWithLink, keepCoverLink } from "@/lib/hub-notes/covers";
import { noteTemplate } from "@/lib/hub-notes/templates";
import { wallTimeToUtc } from "@/lib/hub-calendar/rules";
import { DEMO_AS_OF } from "@/lib/hub-data";
import { todayIso } from "@/lib/hub-routes";
import { NO_REFS, type NoteAccess, type NoteAppointmentView, type NoteRevision, type NoteAudience, type NoteCover, type NoteCustomer, type NoteDoc, type NoteImageUpload, type NoteLinkPreview, type NotePage, type NotePageMeta, type NotePatch, type NoteProject, type NoteReaders, type NoteRefs, type NoteResult, type NoteRights, type NotesArea, type NoteSettings, type NoteTaskView, type NoteTemplateId, type NoteTrashItem, type NoteViewer } from "@/lib/hub-notes/types";
import type { NoteImageUi } from "./notes-image";
import type { NoteRefsUi } from "./notes-refs";
import type { TaskDraft, TaskOptions } from "./notes-tasks-ui";
import { HistoryPanel, TaskPeek, TemplateChips, TrashAsk, TrashPanel } from "./notes-panels";
import type { AppointmentDraft, NoteCalendarUi } from "./notes-calendar-ui";
import { useAppearance } from "../appearance-provider";
import { HeaderActions } from "../app-shell";
import { LargeTitleHeader } from "../large-title-header";
import { EmojiGlyph } from "./notes-blocks";
import { CoverBand, CoverPicker } from "./notes-cover";
import type { NoteEditorHandle } from "./notes-editor";
import { EmojiPicker } from "./notes-emoji-picker";
import { accessMark, AreaGear, AudienceDialog, PageGear, TeamNotifyDialog, TextSizePop, type AudienceAsk } from "./notes-settings";
import { NotesTree } from "./notes-tree";

// „Notizen“ under Projekte (plan docs/planung/notizen.md, design V2 of 22.11.2026): a calm page list on the left, a
// large writing area on the right, everything about a page behind its gear. Writing saves itself about a second after
// the last keystroke with the version it started from; if somebody else saved in between, nothing is overwritten and
// the own text stays at hand. The design preview runs on examples and saves nothing (?role=customer / freelancer).

const NoteEditor = dynamic(() => import("./notes-editor"), { ssr: false, loading: () => <div className="nz-editor-loading" aria-hidden="true" /> });

const TREE_KEY = "oalab-notes-tree";
/** The preview shows „bearbeitet gerade“ on this page (Abstimmung Startseite). */
const previewPresencePage = "0b0e0000-0000-4000-8000-000000000002";
/** Who opened a page in the preview, for „Zugriff“. */
const previewReaders: NoteReaders = { customer: [{ id: "p-jana", name: "Jana Sommer", seenAt: new Date(Date.UTC(2026, 9, 15, 8, 40)).toISOString() }], freelancer: [{ id: "p-mia", name: "Mia Berger", seenAt: null }] };
const NOTES_CUSTOMER_COOKIE = "oalab-notes-customer";
type SaveStatus = "saved" | "saving" | "error" | "stale";
type Pop = null | "gear" | "area" | "size" | "cover" | "trash" | "bin" | "history";
type Stale = { message: string; current: NotePage; mine: NoteDoc; reloaded: boolean };

const unavailable: NotesArea = { viewer: "customer", viewerId: "", customers: [], customerId: null, projects: [], pages: [], page: null, settings: { defaultAudience: "team", notifyOnShare: true, groupByProject: true, meetingTemplate: "meeting", defaultWidth: "normal", customerAccess: "edit" }, people: {}, taskWriter: false, ready: true, error: "Die Notizen konnten gerade nicht geladen werden." };

const phoneQuery = "(max-width: 767px)";
const subscribePhone = (listener: () => void) => { const list = window.matchMedia(phoneQuery); list.addEventListener("change", listener); return () => list.removeEventListener("change", listener); };
const usePhone = () => useSyncExternalStore(subscribePhone, () => window.matchMedia(phoneQuery).matches, () => false);

export function NotesScreen({ area, preview }: { area?: NotesArea; preview: boolean }) {
  const searchParams = useSearchParams();
  const role = searchParams.get("role");
  const previewViewer: NoteViewer = role === "customer" ? "customer" : role === "freelancer" ? "freelancer" : "admin";
  // The preview opens the page (and customer) of its address once (a link from „Erwähnt in“, a reload); later clicks only
  // change the view.
  const [startPage] = useState(() => searchParams.get("page"));
  const [startCustomer] = useState(() => searchParams.get("customer"));
  const initial = useMemo(() => preview ? notesFixtures(previewViewer, startPage, startCustomer) : area ?? unavailable, [preview, previewViewer, startPage, startCustomer, area]);
  return <NotesWorkspace key={preview ? previewViewer : "live"} initial={initial} preview={preview} />;
}

function NotesWorkspace({ initial, preview }: { initial: NotesArea; preview: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const phone = usePhone();
  const { appearance, update } = useAppearance();
  const viewer = initial.viewer;
  const [customerId, setCustomerId] = useState(initial.customerId);
  const [pages, setPages] = useState<NotePageMeta[]>(initial.pages);
  const [projects, setProjects] = useState<NoteProject[]>(initial.projects);
  const [people, setPeople] = useState(initial.people);
  const [page, setPage] = useState<NotePage | null>(initial.page);
  const [settings, setSettings] = useState<NoteSettings>(initial.settings);
  const [titleDraft, setTitleDraft] = useState(initial.page?.title ?? "");
  const [editorKey, setEditorKey] = useState(0);
  const [storedTree, setStoredTree] = useStoredValue(TREE_KEY, "open");
  const [focus, setFocus] = useState(false);
  const [mobileView, setMobileView] = useState<"tree" | "page">(searchParams.get("page") && initial.page ? "page" : "tree");
  const [openNodes, setOpenNodes] = useState<Record<string, boolean>>(() => Object.fromEntries(initial.page ? pathOf(initial.pages, initial.page.id).map((item) => [item.id, true]) : []));
  const [pop, setPop] = useState<Pop>(null);
  const [iconAnchor, setIconAnchor] = useState<DOMRect | null>(null);
  const [ask, setAsk] = useState<AudienceAsk | null>(null);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [saveError, setSaveError] = useState("");
  const [stale, setStale] = useState<Stale | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refs, setRefs] = useState<NoteRefs>(initial.page?.refs ?? NO_REFS);
  const [trash, setTrash] = useState<{ items: NoteTrashItem[]; loading: boolean }>({ items: [], loading: false });
  // The preview keeps its trash in memory: what went in, with its subpages, to show restoring and deleting for good.
  const [previewBin, setPreviewBin] = useState<{ item: NoteTrashItem; pages: NotePageMeta[] }[]>([]);
  const [peek, setPeek] = useState<NoteTaskView | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [openItems, setOpenItems] = useState(0);
  // Step 3: the history of the open page (team) and who else is on it right now.
  const [history, setHistory] = useState<{ items: NoteRevision[] | null; error: string }>({ items: null, error: "" });
  const [others, setOthers] = useState<{ id: string; name: string }[]>([]);
  // „Zugriff“: who may open the open page and when they did (team; undefined until the gear asks, null while loading).
  const [readers, setReaders] = useState<NoteReaders | null | undefined>(undefined);
  // A new page that only the team sees offers „Mit Kunde teilen“ right under its title until it is shared or closed.
  const [shareHint, setShareHint] = useState<string | null>(null);
  // „Team informieren“ at one of oalab's own pages (stage 2): the dialog with the optional sentence.
  const [teamAsk, setTeamAsk] = useState(false);
  const editor = useRef<NoteEditorHandle | null>(null);
  const titleField = useRef<HTMLTextAreaElement>(null);

  // Saving: pending fields since the last save started, the version it carries, the latest document.
  const pending = useRef<NotePatch>({});
  const timer = useRef<number | undefined>(undefined);
  const inflight = useRef<Promise<boolean> | null>(null);
  const pageRef = useRef<NotePage | null>(initial.page);
  const versionRef = useRef(initial.page?.version ?? 0);
  const lastDoc = useRef<NoteDoc | null>(initial.page?.content ?? null);
  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  useEffect(() => { pageRef.current = page; });

  const customer: NoteCustomer | null = initial.customers.find((item) => item.id === customerId) ?? null;
  const treeOpen = storedTree !== "closed";
  const canCreate = viewer === "admin" || viewer === "freelancer";
  const canEdit = Boolean(page) && viewerEdits(viewer, page!);
  // Customers write title, symbol and text; cover, width, project and date stay with the team (and freelancers).
  const canArrange = canEdit && viewer !== "customer";
  const textSize = appearance.notesTextSize;
  const pageMeta = page ? pages.find((item) => item.id === page.id) ?? toMetaOnly(page) : null;

  const say = useCallback((text: string) => { setToast(text); window.setTimeout(() => setToast((current) => current === text ? null : current), 4200); }, []);

  /** The address follows the open customer and page, without reloading the hub. */
  const remember = useCallback((nextCustomer: string | null, nextPage: string | null) => {
    const query = new URLSearchParams(searchParams.toString());
    if (nextCustomer) query.set("customer", nextCustomer); else query.delete("customer");
    if (nextPage) query.set("page", nextPage); else query.delete("page");
    window.history.replaceState(null, "", `${pathname}?${query.toString()}`);
  }, [pathname, searchParams]);

  /** Writes what is pending now; true when nothing is left unsaved. */
  const flush = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(timer.current);
    if (inflight.current) await inflight.current;
    const current = pageRef.current;
    const patch = pending.current;
    if (!current || !Object.keys(patch).length) return true;
    pending.current = {};
    if (preview) {
      const now = new Date().toISOString();
      setPages((list) => list.map((item) => item.id === current.id ? { ...withMeta(item, patch), updatedAt: now, updatedBy: initial.viewerId } : item));
      setStatus("saved");
      return true;
    }
    setStatus("saving");
    const run = (async () => {
      // The editor's attributes have no prototype, which a Server Action does not carry: the page goes as plain JSON.
      const result = await saveNotePage({ id: current.id, version: versionRef.current, patch: patch.content ? { ...patch, content: plainDoc(patch.content) } : patch });
      if (result.ok) {
        versionRef.current = result.data.version;
        setPages((list) => list.map((item) => item.id === current.id ? { ...withMeta(item, patch), version: result.data.version, updatedAt: result.data.updatedAt, updatedBy: result.data.updatedBy } : item));
        setPage((open) => open && open.id === current.id ? { ...withMeta(open, patch), version: result.data.version, updatedAt: result.data.updatedAt, updatedBy: result.data.updatedBy, ...(patch.content ? { content: patch.content } : {}) } : open);
        setStatus(Object.keys(pending.current).length ? "saving" : "saved");
        return true;
      }
      if (result.stale && result.current) {
        setStale({ message: result.error, current: result.current, mine: lastDoc.current ?? current.content, reloaded: false });
        setStatus("stale");
        return false;
      }
      pending.current = { ...patch, ...pending.current };
      setSaveError(result.error);
      setStatus("error");
      return false;
    })();
    inflight.current = run;
    const ok = await run;
    inflight.current = null;
    if (ok && Object.keys(pending.current).length) timer.current = window.setTimeout(() => void flushRef.current(), 400);
    return ok;
  }, [preview, initial.viewerId]);
  useEffect(() => { flushRef.current = flush; }, [flush]);

  const queue = useCallback((patch: NotePatch, delay = 1000) => {
    pending.current = { ...pending.current, ...patch };
    setStatus((value) => value === "stale" ? value : "saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), delay);
  }, [flush]);

  // Nothing typed may get lost on leaving: the browser asks while a save is open.
  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => { if (Object.keys(pending.current).length || inflight.current) { void flush(); event.preventDefault(); } };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [flush]);

  // Focus: the hub's sidebar, the page head and the page list step aside until only the page is left.
  useEffect(() => {
    const root = document.documentElement;
    if (focus) root.dataset.notesFocus = "true"; else delete root.dataset.notesFocus;
    return () => { delete root.dataset.notesFocus; };
  }, [focus]);
  useEffect(() => {
    if (!focus) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !pop && !iconAnchor) setFocus(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, pop, iconAnchor]);

  const showPage = useCallback((next: NotePage | null, morePeople?: Record<string, string>) => {
    setPage(next);
    pageRef.current = next;
    versionRef.current = next?.version ?? 0;
    lastDoc.current = next?.content ?? null;
    pending.current = {};
    setTitleDraft(next?.title ?? "");
    setRefs(next?.refs ?? NO_REFS);
    setPeek(null);
    setStale(null);
    setStatus("saved");
    setPop(null);
    setReaders(undefined);
    setEditorKey((value) => value + 1);
    if (morePeople) setPeople((current) => ({ ...current, ...morePeople }));
  }, []);

  const openPage = useCallback(async (id: string) => {
    if (page?.id === id) { setMobileView("page"); return; }
    if (!(await flush())) { say("Diese Seite ist noch nicht gespeichert. Bitte erst speichern oder neu laden."); return; }
    let next: NotePage | null = null;
    if (preview) next = previewPage(id, viewer);
    else {
      setBusy(true);
      const result = await openNotePage(id);
      setBusy(false);
      if (!result.ok) { say(result.error); return; }
      next = result.data.page;
      setPeople((current) => ({ ...current, ...result.data.people }));
    }
    if (!next) return;
    const shown = preview ? { ...next, ...(pages.find((item) => item.id === id) ?? {}) } as NotePage : next;
    showPage(shown);
    // Opened counts as seen: the dot for news from outside goes.
    if (viewer === "admin") { const at = new Date().toISOString(); setPages((list) => list.map((item) => item.id === id ? { ...item, seenAt: at } : item)); }
    setOpenNodes((current) => ({ ...current, ...Object.fromEntries(pathOf(pages, id).filter((item) => item.id !== id).map((item) => [item.id, true])) }));
    setMobileView("page");
    remember(customerId, id);
  }, [page?.id, flush, preview, pages, showPage, remember, customerId, say, viewer]);

  const switchCustomer = useCallback(async (id: string) => {
    if (id === customerId) return;
    if (!(await flush())) { say("Diese Seite ist noch nicht gespeichert. Bitte erst speichern oder neu laden."); return; }
    if (viewer === "admin") document.cookie = `${NOTES_CUSTOMER_COOKIE}=${encodeURIComponent(id)}; Path=/; Max-Age=31536000; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
    if (preview) {
      const shown = id === initial.customerId ? initial.pages : previewCustomerPages(id, viewer);
      setCustomerId(id);
      setPages(shown);
      setProjects(id === initial.customerId ? initial.projects : previewCustomerProjects(id));
      const first = childrenOf(shown, null)[0];
      showPage(first ? previewPage(first.id, viewer) : null);
      setMobileView("tree");
      remember(id, first?.id ?? null);
      return;
    }
    setBusy(true);
    const result = await loadNotesCustomer(id);
    if (!result.ok) { setBusy(false); say(result.error); return; }
    setCustomerId(id);
    setPages(result.data.pages);
    setProjects(result.data.projects);
    setPeople(result.data.people);
    const first = childrenOf(result.data.pages, null)[0];
    const opened = first ? await openNotePage(first.id) : null;
    setBusy(false);
    showPage(opened?.ok ? opened.data.page : null);
    setMobileView("tree");
    remember(id, first?.id ?? null);
  }, [customerId, flush, viewer, preview, initial, showPage, remember, say]);

  /** A new page at the top level (in the open page's project) or below a page; it opens with its title selected. */
  const createPage = useCallback(async (parent: NotePageMeta | null): Promise<NotePageMeta | null> => {
    if (!customer) return null;
    if (!(await flush())) return null;
    const top = page ? pathOf(pages, page.id)[0] : null;
    const projectId = parent ? parent.projectId : top?.projectId ?? null;
    let created: NotePage;
    if (preview) {
      const now = new Date().toISOString();
      created = {
        id: crypto.randomUUID(), customerId: customer.id, projectId, parentId: parent?.id ?? null, appointmentId: null, title: "Neue Seite", icon: "", cover: null,
        width: settings.defaultWidth, ...newPageRights(viewer, parent, settings, customer.hasFreelancer, customer.team), outsideEditedAt: null, seenAt: now, datedOn: null,
        position: positionAfter(childrenOf(pages, parent?.id ?? null)), version: 1, updatedBy: initial.viewerId, updatedAt: now, createdAt: now, content: emptyNoteDoc(),
      };
    } else {
      setBusy(true);
      const result = await createNotePage({ customerId: customer.id, projectId, parentId: parent?.id ?? null });
      setBusy(false);
      if (!result.ok) { say(result.error); return null; }
      created = result.data;
    }
    const meta = toMetaOnly(created);
    setPages((list) => [...list, meta]);
    if (parent) setOpenNodes((current) => ({ ...current, [parent.id]: true }));
    return meta;
  }, [customer, flush, page, pages, preview, settings, viewer, initial.viewerId, say]);

  /** „Neue Seite“ in the list, or „+“ / „Neue Unterseite“ at a page: the new page opens with its title selected. */
  const newPage = useCallback(async (parent: NotePageMeta | null) => {
    const meta = await createPage(parent);
    if (!meta) return;
    const full: NotePage = { ...meta, content: emptyNoteDoc() };
    showPage(full);
    setFresh(meta.id);
    setMobileView("page");
    remember(customerId, meta.id);
    const seen = `${customer?.team ? "Sichtbar für" : "Zugriff"}: ${accessLabel(meta, customer?.hasFreelancer ?? true, customer?.team)}.`;
    say(parent ? `Neue Unterseite in „${parent.title}“ angelegt. ${seen}` : `Neue Seite angelegt. ${seen}`);
    // The team decides right away whether the customer gets the page (unless a page above keeps it from them); oalab's
    // own pages have no customer to share with.
    setShareHint(viewer === "admin" && !customer?.team && accessOf(meta).customer === "none" && (!parent || accessOf(parent).customer !== "none") ? meta.id : null);
    window.setTimeout(() => { titleField.current?.focus(); titleField.current?.select(); }, 60);
  }, [createPage, showPage, remember, customerId, say, customer?.hasFreelancer, customer?.team, viewer]);
  // Freelancers add pages only below pages the freelancers see (the server checks the same).
  const canAddUnder = useCallback((parent: NotePageMeta) => viewer === "admin" || (viewer === "freelancer" && within("freelancer", parent.audience)), [viewer]);

  const createSubpage = useCallback(async () => pageMeta ? createPage(pageMeta) : null, [createPage, pageMeta]);

  const patchPage = useCallback((patch: NotePatch, delay = 0) => {
    if (!page) return;
    setPage((open) => open ? withMeta(open, patch) : open);
    setPages((list) => list.map((item) => item.id === page.id ? withMeta(item, patch) : item));
    queue(patch, delay);
  }, [page, queue]);

  const onTitle = (value: string) => {
    setTitleDraft(value.replace(/\n/g, " "));
    const title = cleanNoteTitle(value);
    if (title && page) {
      setPages((list) => list.map((item) => item.id === page.id ? { ...item, title } : item));
      queue({ title });
    }
  };
  // The title grows with its text.
  useEffect(() => {
    const field = titleField.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [titleDraft, textSize, page?.id]);

  /** Who reads and who edits the open page (team): the list and the page follow, subpages narrow with it. */
  const applyRights = useCallback(async (target: NoteRights, notify = false) => {
    if (!page) return;
    setAsk(null);
    const rights = fitRights(target);
    const label = accessLabel(rights, customer?.hasFreelancer ?? true, customer?.team);
    const word = customer?.team ? "Sichtbar für" : "Zugriff";
    if (preview) {
      const changes = new Map(narrowedBelow(pages, page.id, rights.audience).map((item) => [item.id, item.audience]));
      setPages((list) => list.map((item) => item.id === page.id ? { ...item, ...rights } : changes.has(item.id) ? { ...item, ...fitRights({ ...item, audience: changes.get(item.id)! }) } : item));
      setPage((open) => open ? { ...open, ...rights } : open);
      if (accessOf(rights).customer !== "none") setShareHint(null);
      say(`${word}: ${label}.${changes.size ? ` ${changes.size} ${changes.size === 1 ? "Unterseite" : "Unterseiten"} ebenfalls eingeschränkt.` : ""}`);
      return;
    }
    if (!(await flush())) return;
    setBusy(true);
    const result = await setNoteAccess({ id: page.id, rights, notify });
    setBusy(false);
    if (!result.ok) { say(result.error); return; }
    setPages(result.data.pages);
    const fresh = result.data.pages.find((item) => item.id === page.id);
    if (fresh) { versionRef.current = fresh.version; setPage((open) => open ? { ...open, audience: fresh.audience, customerEdits: fresh.customerEdits, freelancerEdits: fresh.freelancerEdits, version: fresh.version, updatedAt: fresh.updatedAt, updatedBy: fresh.updatedBy } : open); }
    if (accessOf(rights).customer !== "none") setShareHint(null);
    const n = result.data.narrowed;
    say(`${rights.audience === "team" ? "Nur noch das oalab-Team sieht diese Seite." : `${word}: ${label}.`}${n ? ` ${n} ${n === 1 ? "Unterseite" : "Unterseiten"} ebenfalls eingeschränkt.` : ""}`);
  }, [page, preview, pages, flush, say, customer?.hasFreelancer, customer?.team]);

  /**
   * One side's choice in „Zugriff“: releasing a page (or narrowing it with subpages) asks first, as before; only
   * switching between „Lesen“ and „Bearbeiten“ applies at once and tells whoever may now write along.
   */
  const requestAccess = (side: "customer" | "freelancer", value: NoteAccess) => {
    if (!page) return;
    // oalab's own pages (stage 2): „Nur Team“ or „Team und Freelancer“. Nobody outside sees them yet, so widening
    // needs no release; narrowing with subpages still asks first.
    if (customer?.team) {
      const target: NoteRights = { audience: side === "freelancer" && value !== "none" ? "freelancer" : "team", customerEdits: false, freelancerEdits: false };
      if (target.audience === page.audience) return;
      const narrowed = narrowedBelow(pages, page.id, target.audience).map(({ title, audience }) => ({ title, audience }));
      if (narrowed.length) setAsk({ page: pageMeta ?? page, target: target.audience, rights: target, narrowed, hidden: [] });
      else void applyRights(target, false);
      return;
    }
    const current = accessOf(page);
    const target = side === "customer" ? rightsFrom(value, current.freelancer) : rightsFrom(current.customer, value);
    if (target.audience === page.audience && target.customerEdits === page.customerEdits && target.freelancerEdits === page.freelancerEdits) return;
    const narrowed = narrowedBelow(pages, page.id, target.audience).map(({ title, audience }) => ({ title, audience }));
    const gained = gains(page.audience, target.audience);
    if (gained.customer || gained.freelancer || narrowed.length) setAsk({ page: pageMeta ?? page, target: target.audience, rights: target, narrowed, hidden: gained.customer || gained.freelancer ? hiddenFor(target.audience) : [] });
    else void applyRights(target, settings.notifyOnShare);
  };

  /** „Mit Kunde teilen“ under a new page's title: the customer reads or writes along as the default for all notes says. */
  const shareWithCustomer = () => {
    if (!page) return;
    requestAccess("customer", settings.customerAccess);
  };

  // ---- Step 2: references, tasks, trash, templates, covers -------------------------------------------------------

  const today = preview ? DEMO_AS_OF : todayIso();
  const boardHref = useCallback((projectId: string, number?: number) => viewer === "customer"
    ? `${hubHref(preview, "projects")}?project=${encodeURIComponent(projectId)}`
    : `${hubHref(preview, "projects")}/tasks?project=${encodeURIComponent(projectId)}${number ? `&task=${number}` : ""}`, [preview, viewer]);
  const addTasks = useCallback((tasks: NoteTaskView[]) => setRefs((current) => {
    const nextTasks = { ...current.tasks };
    for (const task of tasks) nextTasks[task.id] = task;
    const projectTasks = Object.fromEntries(Object.entries(current.projectTasks).map(([id, list]) => [id, list ? list.map((item) => tasks.find((task) => task.id === item.id) ?? item) : list]));
    return { ...current, tasks: nextTasks, projectTasks };
  }), []);
  const addImage = useCallback((path: string, url: string) => setRefs((current) => ({ ...current, images: { ...current.images, [path]: url } })), []);
  const toggleTask = useCallback(async (task: NoteTaskView) => {
    const done = task.status !== "done";
    if (preview || task.version === null) {
      addTasks([{ ...task, status: done ? "done" : "todo" }]);
      say(done ? `#${task.number} ist erledigt. Board und Studio zeigen es auch.` : `#${task.number} ist wieder offen.`);
      return;
    }
    addTasks([{ ...task, status: done ? "done" : "todo" }]);
    const result = await setNoteTaskDone({ taskId: task.id, done, version: task.version });
    if (result.ok) { addTasks([result.data]); say(done ? `#${task.number} ist erledigt. Board und Studio zeigen es auch.` : `#${task.number} ist wieder offen.`); }
    else { addTasks([task]); say(result.error); }
  }, [preview, addTasks, say]);
  const searchTasks = useCallback(async (query: string): Promise<NoteTaskView[]> => {
    if (preview) {
      const term = query.trim().toLowerCase().replace(/^#/, "");
      return Object.values(previewRefs(viewer).tasks).filter((task): task is NoteTaskView => Boolean(task) && (!term || String(task!.number).includes(term) || task!.title.toLowerCase().includes(term))).slice(0, 8);
    }
    if (!customerId) return [];
    const result = await searchNoteTasks({ customerId, query });
    if (!result.ok) return [];
    addTasks(result.data);
    return result.data;
  }, [preview, viewer, customerId, addTasks]);
  const addAppointments = useCallback((list: NoteAppointmentView[]) => setRefs((current) => ({ ...current, appointments: { ...current.appointments, ...Object.fromEntries(list.map((item) => [item.id, item])) } })), []);
  const calendarHref = useCallback((appointmentId: string) => `${hubHref(preview, "projects")}/calendar?appointment=${encodeURIComponent(appointmentId)}`, [preview]);
  // Pictures in the text (27.11.2026): links hold an hour, so a page open longer asks for new ones; the design preview
  // keeps its pictures in the browser and uploads nothing.
  const openPageId = page?.id ?? null;
  const refreshImage = useCallback(async (path: string): Promise<boolean> => {
    if (preview || !openPageId) return false;
    const result = await noteImageUrls({ pageId: openPageId, paths: [path] });
    const url = result.ok ? result.data[path] : undefined;
    if (url) addImage(path, url);
    return Boolean(url);
  }, [preview, openPageId, addImage]);
  const imageUi: NoteImageUi = useMemo(() => ({
    upload: async (file: File, size: { width: number; height: number }): Promise<NoteResult<NoteImageUpload>> => {
      if (!openPageId) return { ok: false, error: "Keine Seite offen." };
      if (preview) {
        const stored = uploadSize(size.width, size.height, 0) ?? size;
        return { ok: true, data: { image: `notes/${customerId ?? "vorschau"}/images/${crypto.randomUUID()}.webp`, url: null, width: stored.width, height: stored.height } };
      }
      const form = new FormData();
      form.set("file", file);
      const response = await fetch(`/api/notes/image?page=${encodeURIComponent(openPageId)}`, { method: "POST", body: form }).catch(() => null);
      const result = response ? await response.json().catch(() => null) as NoteResult<NoteImageUpload> | null : null;
      if (result && (result.ok || result.error)) return result;
      return { ok: false, error: response?.status === 413 ? "Ein Bild darf höchstens 9 MB groß sein." : "Das Bild konnte gerade nicht hochgeladen werden. Versuche es gleich noch einmal." };
    },
    show: addImage,
    notify: say,
  }), [openPageId, preview, customerId, addImage, say]);
  const refsUi: NoteRefsUi = useMemo(() => ({
    refs, viewer, viewerId: initial.viewerId, taskWriter: initial.taskWriter, editable: canEdit, today,
    toggleTask: (task) => void toggleTask(task), openTask: (task) => setPeek(task), boardHref, searchTasks, addTasks, addImage, refreshImage, addAppointments, calendarHref,
  }), [refs, viewer, initial.viewerId, initial.taskWriter, canEdit, today, toggleTask, boardHref, searchTasks, addTasks, addImage, refreshImage, addAppointments, calendarHref]);

  // ---- Step 3: appointments, history, „bearbeitet gerade“ ----------------------------------------------------------

  const pageId = page?.id ?? null;
  const calendarUi: NoteCalendarUi = useMemo(() => ({
    mode: viewer === "admin" ? "create" : "request",
    today,
    loadAppointments: async () => {
      if (preview) return previewAppointmentOptions(viewer);
      if (!customerId) return [];
      const result = await noteAppointmentOptions({ customerId });
      return result.ok ? result.data : [];
    },
    loadSlots: async (day, minutes) => {
      if (preview) return { ok: true, data: { durations: [30, 45, 60, 90], minutes: minutes ?? 60, starts: day <= today ? [] : ["09:00", "09:30", "10:00", "14:00", "15:30"], lastDay: "2026-12-31" } };
      return noteRequestSlots({ day, minutes });
    },
    submit: async (draft: AppointmentDraft) => {
      if (!pageId) return { ok: false, error: "Keine Seite offen." };
      if (preview) {
        const start = new Date(wallTimeToUtc(draft.day, draft.start));
        return { ok: true, data: { id: crypto.randomUUID(), title: draft.title, start: start.toISOString(), end: new Date(start.getTime() + draft.minutes * 60_000).toISOString(), status: viewer === "admin" ? "confirmed" : "requested", teamsUrl: viewer === "admin" && draft.teamsUrl ? draft.teamsUrl : null, customerId } };
      }
      return viewer === "admin" ? createNoteAppointment({ pageId, ...draft }) : requestNoteAppointment({ pageId, ...draft });
    },
    notify: (appointment, onPage) => say(appointment.status === "confirmed"
      ? `„${appointment.title}“ steht im Kalender${customer?.team ? " als interner Termin" : customer ? `; ${customer.name} bekommt eine Meldung` : ""}.${onPage ? " Der Termin steht jetzt auch auf der Seite." : ""}`
      : `Deine Anfrage „${appointment.title}“ ist bei oalab. Du bekommst eine Meldung, sobald sie bestätigt ist.${onPage ? " Sie steht jetzt auch auf der Seite." : ""}`),
  }), [viewer, today, preview, customerId, pageId, say, customer]);

  /** „Zugriff“ in the gear: who may open the page and when they last did (team). */
  const loadReaders = useCallback(async () => {
    // oalab's own pages have no customer and no freelancers yet: nobody to list.
    if (viewer !== "admin" || !page || customer?.team) return;
    if (preview) { setReaders(previewReaders); return; }
    setReaders(null);
    const result = await noteReaders({ pageId: page.id });
    setReaders(result.ok ? result.data : { customer: [], freelancer: [] });
  }, [viewer, page, preview, customer?.team]);
  const toggleGear = () => {
    setOpenItems(editor.current?.openItemCount() ?? 0);
    if (pop !== "gear") void loadReaders();
    setPop((value) => value === "gear" ? null : "gear");
  };

  const openHistory = useCallback(async () => {
    if (!page) return;
    setPop("history");
    if (preview) { setHistory({ items: previewRevisions(page.id), error: "" }); return; }
    setHistory({ items: null, error: "" });
    if (!(await flush())) return;
    const result = await noteHistory({ pageId: page.id });
    setHistory(result.ok ? { items: result.data, error: "" } : { items: [], error: result.error });
  }, [page, preview, flush]);
  const restoreRevision = useCallback(async (revision: NoteRevision) => {
    if (!page) return;
    if (preview) { say("In der Vorschau wird nichts wiederhergestellt."); return; }
    if (!(await flush())) return;
    const result = await restoreNoteRevision({ revisionId: revision.id, version: versionRef.current });
    if (!result.ok) { say(result.error); return; }
    setPages((list) => list.map((item) => item.id === result.data.id ? { ...item, title: result.data.title, icon: result.data.icon, version: result.data.version, updatedAt: result.data.updatedAt, updatedBy: result.data.updatedBy } : item));
    showPage(result.data);
    say("Die frühere Fassung ist wiederhergestellt. Der Stand davor steht im Verlauf.");
  }, [page, preview, flush, say, showPage]);

  // „bearbeitet gerade“: a mark every 15 seconds while the page is open and visible; who else is on it shows on top.
  useEffect(() => {
    if (!pageId) return;
    if (preview) {
      const demo = viewer === "admin" && pageId === previewPresencePage ? [{ id: "p-lea", name: "Lea Brandt" }] : [];
      const timer = window.setTimeout(() => setOthers(demo), 0);
      return () => window.clearTimeout(timer);
    }
    let live = true;
    const beat = async () => {
      if (document.visibilityState !== "visible") return;
      const result = await notePresence({ pageId, editing: canEdit });
      if (live && result.ok) setOthers(result.data);
    };
    const first = window.setTimeout(() => void beat(), 600);
    const timer = window.setInterval(() => void beat(), 15_000);
    return () => {
      live = false;
      window.clearTimeout(first);
      window.clearInterval(timer);
      setOthers([]);
      if (canEdit) void notePresence({ pageId, editing: false, leave: true });
    };
  }, [pageId, canEdit, preview, viewer]);
  const loadTaskOptions = useCallback(async (projectId: string | null): Promise<TaskOptions | null> => {
    if (preview) return { projects, people: [{ id: "p-jonas", name: "Jonas Keller", initials: "JK" }, { id: "p-lea", name: "Lea Brandt", initials: "LB" }, { id: "p-mia", name: "Mia Berger", initials: "MB" }] };
    if (!customerId) return null;
    const result = await noteTaskOptions({ customerId, projectId });
    return result.ok ? result.data : null;
  }, [preview, projects, customerId]);
  const createTasks = useCallback(async (drafts: TaskDraft[]): Promise<NoteTaskView[]> => {
    const created: NoteTaskView[] = [];
    for (const draft of drafts) {
      if (preview) {
        const number = 1047 + created.length;
        created.push({ id: crypto.randomUUID(), number, title: draft.title, status: "todo", dueOn: draft.dueOn, projectId: draft.projectId, projectName: projects.find((item) => item.id === draft.projectId)?.name ?? "", assignees: [], customerTurn: false, audience: draft.audience, version: 1 });
        continue;
      }
      if (!customerId) break;
      const result = await createNoteTask({ customerId, ...draft });
      if (!result.ok) { say(result.error); break; }
      created.push(result.data);
    }
    if (created.length) {
      addTasks(created);
      say(created.length === 1 ? `Aufgabe #${created[0].number} angelegt. Sie steht jetzt auch im Board und in Studio.` : `${created.length} Aufgaben angelegt. Sie stehen jetzt auch im Board und in Studio.`);
    }
    return created;
  }, [preview, projects, customerId, addTasks, say]);
  const loadPreview = useCallback(async (url: string): Promise<{ ok: true; data: NoteLinkPreview & { imageUrl: string | null } } | { ok: false; error: string }> => {
    if (preview) {
      const site = (/^https?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? url).replace(/^www\./, "");
      return { ok: true, data: { href: url.replace(/^http:/i, "https:"), title: `Seite auf ${site}`, description: "Titel, Beschreibung und Bild lädt der Hub beim Einfügen von der Seite.", site, image: null, imageUrl: null } };
    }
    if (!customerId) return { ok: false, error: "Kein Kunde gewählt." };
    return noteLinkPreview({ customerId, url });
  }, [preview, customerId]);

  const openTrash = useCallback(async () => {
    setPop((value) => value === "trash" ? null : "trash");
    if (preview || !customerId) { setTrash({ items: previewBin.map((entry) => entry.item), loading: false }); return; }
    setTrash((current) => ({ ...current, loading: true }));
    const result = await loadNoteTrash({ customerId });
    setTrash({ items: result.ok ? result.data : [], loading: false });
  }, [preview, customerId, previewBin]);
  const trashPage = useCallback(async () => {
    if (!page) return;
    setPop(null);
    if (preview) {
      const meta = pages.find((item) => item.id === page.id);
      const gone = meta ? [meta, ...descendantsOf(pages, page.id)] : [];
      const rest = pages.filter((item) => !gone.some((entry) => entry.id === item.id));
      setPages(rest);
      setPreviewBin((bin) => [{ item: { id: page.id, title: page.title, icon: page.icon, deletedAt: new Date().toISOString(), deletedBy: initial.viewerId, parentId: page.parentId }, pages: gone }, ...bin]);
      const first = childrenOf(rest, null)[0];
      showPage(first ? previewPage(first.id, viewer) : null);
      remember(customerId, first?.id ?? null);
      say("Die Seite liegt jetzt 30 Tage im Papierkorb, mit ihren Unterseiten.");
      return;
    }
    if (!(await flush())) return;
    const result = await trashNotePage({ id: page.id });
    if (!result.ok) { say(result.error); return; }
    setPages(result.data.pages);
    const first = childrenOf(result.data.pages, null)[0];
    const opened = first ? await openNotePage(first.id) : null;
    showPage(opened?.ok ? opened.data.page : null);
    remember(customerId, first?.id ?? null);
    say("Die Seite liegt jetzt 30 Tage im Papierkorb, mit ihren Unterseiten.");
  }, [page, preview, pages, initial.viewerId, viewer, flush, showPage, remember, customerId, say]);
  const restorePage = useCallback(async (id: string) => {
    if (preview) {
      const entry = previewBin.find((item) => item.item.id === id);
      if (!entry) return;
      // Back where it was, or at the top level when its parent is gone meanwhile.
      setPages((list) => [...list, ...entry.pages.map((item) => item.id === id && item.parentId && !list.some((other) => other.id === item.parentId) ? { ...item, parentId: null } : item)]);
      setPreviewBin((bin) => bin.filter((item) => item.item.id !== id));
      setTrash((current) => ({ ...current, items: current.items.filter((item) => item.id !== id) }));
      say("Die Seite ist wieder da.");
      return;
    }
    const result = await restoreNotePage({ id });
    if (!result.ok) { say(result.error); return; }
    setPages(result.data.pages);
    setTrash((current) => ({ ...current, items: current.items.filter((item) => item.id !== id) }));
    say("Die Seite ist wieder da.");
  }, [preview, previewBin, say]);
  const purgePage = useCallback(async (id: string) => {
    if (preview) {
      setPreviewBin((bin) => bin.filter((item) => item.item.id !== id));
      setTrash((current) => ({ ...current, items: current.items.filter((item) => item.id !== id) }));
      say("Die Seite ist endgültig gelöscht.");
      return;
    }
    const result = await purgeNotePage({ id });
    if (!result.ok) { say(result.error); return; }
    setTrash((current) => ({ ...current, items: current.items.filter((item) => item.id !== id) }));
    say("Die Seite ist endgültig gelöscht.");
  }, [preview, say]);
  const notifyChange = useCallback(async () => {
    if (!page) return;
    setPop(null);
    if (preview) { say("Meldung „Notiz geändert“ an alle, die die Seite sehen, ist unterwegs."); return; }
    const result = await notifyNoteChange({ id: page.id });
    say(result.ok ? "Meldung „Notiz geändert“ an alle, die die Seite sehen, ist unterwegs." : result.error);
  }, [page, preview, say]);
  /** „Team informieren“ (oalab's own pages): a line in the other admins' bell; null when it went out, else the reason. */
  const notifyTeam = useCallback(async (message: string): Promise<string | null> => {
    if (!page) return "Keine Seite offen.";
    if (preview) { setTeamAsk(false); say("Das Team hat eine Meldung in der Glocke."); return null; }
    if (!(await flush())) return "Die Seite ist noch nicht gespeichert.";
    const result = await notifyNoteTeam({ id: page.id, message });
    if (!result.ok) return result.error;
    setTeamAsk(false);
    say(result.data.count ? `${result.data.count === 1 ? "Eine Kollegin oder ein Kollege hat" : `${result.data.count} aus dem Team haben`} eine Meldung in der Glocke.` : "Außer dir ist gerade niemand im Team, der eine Meldung bekäme.");
    return null;
  }, [page, preview, flush, say]);
  const applyTemplate = useCallback((id: NoteTemplateId) => {
    setFresh(null);
    if (id === "blank" || !page) return;
    const template = noteTemplate(id);
    editor.current?.editor()?.commands.setContent(template.doc, { emitUpdate: true });
    if (page.title === "Neue Seite") { setTitleDraft(template.title); patchPage({ title: template.title, ...(template.icon && !page.icon ? { icon: template.icon } : {}) }); }
  }, [page, patchPage]);
  const uploadCover = useCallback(async (file: File): Promise<string | null> => {
    if (!page) return "Keine Seite offen.";
    if (preview) return "In der Vorschau wird nichts hochgeladen.";
    if (!(await flush())) return "Die Seite ist noch nicht gespeichert.";
    const form = new FormData();
    form.set("pageId", page.id);
    form.set("version", String(versionRef.current));
    form.set("file", file);
    const response = await fetch("/api/notes/cover", { method: "POST", body: form }).catch(() => null);
    const result = response ? await response.json().catch(() => null) as { ok: boolean; error?: string; data?: { version: number; updatedAt: string; updatedBy: string | null; cover: NonNullable<NotePageMeta["cover"]> } } | null : null;
    if (!result?.ok || !result.data) return result?.error ?? "Das Bild konnte gerade nicht hochgeladen werden.";
    const saved = result.data;
    versionRef.current = saved.version;
    setPage((open) => open ? { ...open, cover: saved.cover, version: saved.version, updatedAt: saved.updatedAt } : open);
    setPages((list) => list.map((item) => item.id === page.id ? { ...item, cover: saved.cover, version: saved.version, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy } : item));
    setPop(null);
    return null;
  }, [page, preview, flush]);
  /** What a release would leave hidden on this page: tasks and subpages the new readers may not see. */
  const hiddenFor = useCallback((target: NoteAudience): string[] => {
    if (!page) return [];
    const gained = gains(page.audience, target);
    const hidden: string[] = [];
    const seen = new Set<string>();
    // Gaining both, each line says who misses it; gaining one, the dialog's heading names who, the line says why.
    const note = (missCustomer: boolean, missFreelancer: boolean, why: string) => gained.customer && gained.freelancer
      ? (missCustomer && missFreelancer ? "sehen beide nicht" : missCustomer ? "sieht der Kunde nicht" : "sehen die Freelancer nicht")
      : why;
    const walk = (node: { type: string; attrs?: Record<string, unknown>; content?: unknown[] }) => {
      const id = String(node.attrs?.refId ?? "");
      if ((node.type === "noteTaskItem" || node.type === "noteTaskMention") && id && !seen.has(id)) {
        seen.add(id);
        const task = refs.tasks[id];
        const label = task ? `#${task.number} ${task.title}` : "Eine Aufgabe";
        const missCustomer = Boolean(task && gained.customer && task.audience !== "customer");
        const missFreelancer = Boolean(task && gained.freelancer && task.audience === "team");
        if (task && (missCustomer || missFreelancer)) hidden.push(`${label} (${note(missCustomer, missFreelancer, task.audience === "team" ? "Nur Team" : task.audience === "shared" ? "+ Freelancer" : "+ Kunde")})`);
      }
      if (node.type === "noteSubpage" && id) {
        const child = pages.find((item) => item.id === id);
        const missCustomer = Boolean(child && gained.customer && !viewerReads("customer", child.audience));
        const missFreelancer = Boolean(child && gained.freelancer && !viewerReads("freelancer", child.audience));
        if (child && (missCustomer || missFreelancer)) hidden.push(`Unterseite „${child.title}“ (${note(missCustomer, missFreelancer, audienceLabel(child.audience))})`);
      }
      for (const child of (node.content ?? []) as typeof node[]) walk(child);
    };
    walk((lastDoc.current ?? page.content) as Parameters<typeof walk>[0]);
    return hidden;
  }, [page, refs, pages]);

  const changeSettings = async (patch: Partial<NoteSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    if (preview) return;
    const result = await saveNoteSettings(patch);
    if (result.ok) setSettings(result.data); else say(result.error);
  };

  const copyLink = () => {
    if (!page || !customerId) return;
    const url = `${window.location.origin}${hubHref(preview, "projects")}/notes?customer=${encodeURIComponent(customerId)}&page=${encodeURIComponent(page.id)}`;
    void navigator.clipboard?.writeText(url).then(() => say("Link zur Seite kopiert. Öffnen kann ihn nur, wer die Seite sehen darf."), () => say("Der Link konnte nicht kopiert werden."));
    setPop(null);
  };

  const reloadStale = () => {
    if (!stale) return;
    const mine = stale.mine;
    showPage(stale.current);
    setStale({ ...stale, mine, reloaded: true });
    setStatus("saved");
  };
  const takeMine = () => {
    if (!stale) return;
    const mine = stale.mine;
    setStale(null);
    editor.current?.editor()?.commands.setContent(mine, { emitUpdate: true });
  };

  if (!initial.ready || (initial.error && !initial.customers.length)) {
    return (
      <>
        <NotesHeader preview={preview} viewer={viewer} />
        <div className="sheet section-first nz-notice"><NotebookPen size={22} aria-hidden="true" /><p>{initial.error ?? "Notizen sind noch nicht eingerichtet."}</p></div>
      </>
    );
  }
  if (!customer) {
    return (
      <>
        <NotesHeader preview={preview} viewer={viewer} />
        <div className="sheet section-first nz-notice"><NotebookPen size={22} aria-hidden="true" /><p>{viewer === "admin" ? "Noch kein Kunde angelegt. Notizen gehören immer zu einem Kunden." : viewer === "freelancer" ? "Du betreust noch keinen Kunden. Sobald oalab dich einem Kunden zuordnet, findest du hier seine Notizen." : "oalab hat noch keine Notizen für dich freigegeben."}</p></div>
      </>
    );
  }

  const parent = pageMeta?.parentId ? pages.find((item) => item.id === pageMeta.parentId) ?? null : null;
  const crumbs = pageMeta ? [
    ...(!treeOpen || phone ? [customer.name] : []),
    projects.find((item) => item.id === pathOf(pages, pageMeta.id)[0]?.projectId)?.name ?? "Allgemein",
    ...pathOf(pages, pageMeta.id).slice(0, -1).map((item) => item.title),
  ] : [];
  // Who reads and who writes the page, always in sight on top (23.11.2026).
  const mark = pageMeta ? accessMark(pageMeta, viewer, customer.hasFreelancer, customer.team) : null;
  const markText = mark ? viewer === "customer" ? `Von oalab geteilt · ${mark.label}` : mark.label : "";
  const showTree = phone ? mobileView === "tree" : treeOpen && !focus;
  const showPageArea = !phone || mobileView === "page";
  const wide = pageMeta?.width === "wide";
  const hasCover = Boolean(pageMeta?.cover);
  const statusLabel = status === "saving" ? "Speichert …" : status === "error" ? "Nicht gespeichert" : status === "stale" ? "Inzwischen geändert" : pageMeta ? `Bearbeitet ${editedAgo(pageMeta.updatedAt)}` : "";

  return (
    <>
      <NotesHeader preview={preview} viewer={viewer} />
      {initial.error && <p className="calendar-notice" role="alert">{initial.error}</p>}
      <section className={`sheet sheet-fill nz-sheet section-first${showTree ? "" : " no-tree"}${phone ? ` is-phone show-${mobileView}` : ""}`} aria-label="Notizen" aria-busy={busy}>
        {showTree && (
          <NotesTree
            viewer={viewer}
            customers={initial.customers}
            customer={customer}
            projects={projects}
            pages={pages}
            openId={page?.id ?? null}
            groupByProject={settings.groupByProject}
            canCreate={canCreate}
            open={openNodes}
            onToggle={(id, open) => setOpenNodes((current) => ({ ...current, [id]: open }))}
            onOpen={(id) => void openPage(id)}
            onCreate={() => void newPage(null)}
            canAddUnder={canAddUnder}
            onCreateUnder={(target) => void newPage(target)}
            onCustomer={(id) => void switchCustomer(id)}
            onArea={() => setPop((value) => value === "area" ? null : "area")}
            areaOpen={pop === "area"}
            onCollapse={() => setStoredTree("closed")}
            phone={phone}
            footer={viewer === "admin" ? <button type="button" className="nz-new" data-trash-button onClick={() => void openTrash()}><Trash2 size={16} aria-hidden="true" /><span>Papierkorb</span></button> : undefined}
          />
        )}
        {pop === "area" && viewer === "admin" && <AreaGear settings={settings} onChange={(patch) => void changeSettings(patch)} onClose={() => setPop(null)} />}
        {pop === "trash" && viewer === "admin" && <TrashPanel items={trash.items} loading={trash.loading} onRestore={(id) => void restorePage(id)} onPurge={(id) => void purgePage(id)} onClose={() => setPop(null)} />}

        {showPageArea && (
          <div className="nz-page">
            <div className="nz-bar">
              {phone && <button type="button" className="nz-back" onClick={() => { void flush(); setMobileView("tree"); }}><ChevronLeft size={20} aria-hidden="true" /><span>Notizen</span></button>}
              {!phone && !showTree && <button type="button" className="nz-ibtn" aria-label="Seitenliste ausklappen" data-tip="Seitenliste ausklappen" onClick={() => { setStoredTree("open"); setFocus(false); }}><PanelLeftOpen size={16} aria-hidden="true" /></button>}
              {pageMeta && !phone && (
                <nav className="nz-crumbs" aria-label="Pfad">
                  {crumbs.map((label, index) => <span key={`${label}-${index}`} className="nz-crumb">{label}<span className="nz-crumb-sep" aria-hidden="true">›</span></span>)}
                  <span className="nz-crumb is-current">{pageMeta.icon && <EmojiGlyph char={pageMeta.icon} size={15} />}{pageMeta.title}</span>
                </nav>
              )}
              <span className="nz-spacer" />
              {others.length > 0 && <span className="nz-presence" role="status" data-tip={others.map((item) => item.name).join(", ")}><span className="nz-presence-dot" aria-hidden="true" /><span className="nz-presence-text">{others.length === 1 ? `${others[0].name} bearbeitet gerade` : `${others.length} Personen bearbeiten gerade`}</span></span>}
              {pageMeta && (viewer !== "customer" || canEdit) && (
                status === "error"
                  ? <button type="button" className="nz-meta is-error" onClick={() => void flush()} data-tip={saveError}><RefreshCw size={13} aria-hidden="true" />Nicht gespeichert – erneut versuchen</button>
                  : <span className={`nz-meta${status === "stale" ? " is-error" : ""}`} aria-live="polite">{canEdit ? statusLabel : `Bearbeitet ${editedAgo(pageMeta.updatedAt)}`}</span>
              )}
              {pageMeta && mark && (
                <button type="button" className={`nz-access is-${mark.tone}`} data-gear-button aria-label={`Zugriff: ${markText}`} data-tip={viewer === "admin" ? "Wer diese Seite sieht und bearbeitet" : undefined} aria-expanded={pop === "gear"} onClick={toggleGear}>
                  <mark.Icon size={14} aria-hidden={true} /><span className="nz-access-text">{markText}</span>
                  {/* On phones customers and freelancers keep the short words, the team the symbol. */}
                  {viewer !== "admin" && <span className="nz-access-short">{mark.label}</span>}
                </button>
              )}
              {pageMeta && !phone && <button type="button" className={`nz-ibtn${focus ? " is-on" : ""}`} aria-pressed={focus} aria-label={focus ? "Fokus beenden" : "Fokus: nur die Seite"} data-tip={focus ? "Fokus beenden (Esc)" : "Fokus: nur die Seite"} onClick={() => setFocus((value) => !value)}>{focus ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}</button>}
              <button type="button" className={`nz-ibtn${pop === "size" ? " is-on" : ""}`} data-size-button aria-label="Schriftgröße" data-tip="Schriftgröße" aria-expanded={pop === "size"} onClick={() => setPop((value) => value === "size" ? null : "size")}><Type size={16} aria-hidden="true" /></button>
              {pageMeta && <button type="button" className={`nz-ibtn${pop === "gear" ? " is-on" : ""}`} data-gear-button aria-label="Einstellungen dieser Seite" data-tip="Einstellungen dieser Seite" aria-expanded={pop === "gear"} onClick={toggleGear}><Settings size={17} aria-hidden="true" /></button>}
              {pageMeta && viewer === "admin" && <button type="button" className={`nz-ibtn is-danger${pop === "bin" ? " is-on" : ""}`} data-bin-button aria-label="In den Papierkorb legen" data-tip="In den Papierkorb legen" aria-expanded={pop === "bin"} onClick={() => setPop((value) => value === "bin" ? null : "bin")}><Trash2 size={16} aria-hidden="true" /></button>}
            </div>

            {stale && (
              <div className="nz-stale" role="alert">
                <p><strong>{stale.message}</strong> {stale.reloaded ? "Die neue Fassung steht jetzt hier. Deine Fassung ist nicht verloren:" : "Nichts wurde überschrieben."}</p>
                <div className="nz-stale-actions">
                  {!stale.reloaded && <button type="button" className="nz-btn is-primary" onClick={reloadStale}><RefreshCw size={14} aria-hidden="true" />Neu laden</button>}
                  <button type="button" className="nz-btn" onClick={() => { void navigator.clipboard?.writeText(noteText(stale.mine)).then(() => say("Deine Fassung ist in der Zwischenablage.")); }}><Copy size={14} aria-hidden="true" />Meinen Text kopieren</button>
                  {stale.reloaded && <button type="button" className="nz-btn" onClick={takeMine}>Meine Fassung übernehmen</button>}
                  {stale.reloaded && <button type="button" className="nz-btn" onClick={() => setStale(null)}>Schließen</button>}
                </div>
              </div>
            )}

            <div className="nz-scroll">
              {page && pageMeta ? (
                <>
                  {pageMeta.cover && (
                    <CoverBand
                      cover={coverWithLink(pageMeta.cover, page.cover)}
                      editable={canArrange}
                      onOpenPicker={() => setPop("cover")}
                      onPosition={(position) => patchPage({ cover: { kind: pageMeta.cover!.kind, value: pageMeta.cover!.value, position } })}
                      onRemove={() => { patchPage({ cover: null }); say("Titelbild entfernt."); }}
                    />
                  )}
                  {pop === "cover" && canArrange && (
                    <CoverPicker
                      value={pageMeta.cover?.kind === "gallery" ? pageMeta.cover.value : null}
                      fileId={pageMeta.cover?.kind === "file" ? pageMeta.cover.value : null}
                      hasCover={hasCover}
                      customerName={customer.name}
                      loadFiles={async () => {
                        if (preview || !customerId) return [];
                        const result = await noteCoverFiles({ customerId });
                        return result.ok ? result.data : [];
                      }}
                      onPickFile={(file) => { patchPage({ cover: { kind: "file", value: file.id, position: 50 } }); setPage((open) => open && open.cover?.kind === "file" ? { ...open, cover: { ...open.cover, url: file.url, name: file.title } } : open); setPages((list) => list.map((item) => item.id === pageMeta.id && item.cover?.kind === "file" ? { ...item, cover: { ...item.cover, url: file.url, name: file.title } } : item)); }}
                      onUpload={uploadCover}
                      onPick={(key) => patchPage({ cover: { kind: "gallery", value: key, position: pageMeta.cover?.position ?? 50 } })}
                      onRemove={() => { patchPage({ cover: null }); setPop(null); }}
                      onClose={() => setPop(null)}
                    />
                  )}
                  <article className={`nz-doc${wide ? " is-wide" : ""}${hasCover ? " has-cover" : ""}`}>
                    <div className={`nz-headzone${hasCover ? " with-cover" : ""}${pageMeta.icon ? "" : " no-icon"}${!pageMeta.icon && !hasCover ? " is-bare" : ""}`}>
                      {pageMeta.icon && (
                        <button type="button" className="nz-page-emoji" disabled={!canEdit} aria-label="Seitensymbol ändern" data-tip={canEdit ? "Symbol ändern" : undefined} onClick={(event) => setIconAnchor(event.currentTarget.getBoundingClientRect())}>
                          <EmojiGlyph char={pageMeta.icon} />
                        </button>
                      )}
                      {canEdit && (!pageMeta.icon || (!hasCover && canArrange)) && (
                        <div className="nz-head-actions">
                          {!pageMeta.icon && <button type="button" className="nz-ghost" onClick={(event) => setIconAnchor(event.currentTarget.getBoundingClientRect())}><Smile size={16} aria-hidden="true" /><span>Symbol hinzufügen</span></button>}
                          {!hasCover && canArrange && <button type="button" className="nz-ghost" data-cover-button onClick={() => setPop("cover")}><ImageIcon size={16} aria-hidden="true" /><span>Titelbild hinzufügen</span></button>}
                        </div>
                      )}
                    </div>
                    {canEdit ? (
                      <textarea
                        ref={titleField}
                        className="nz-title"
                        rows={1}
                        value={titleDraft}
                        placeholder="Ohne Titel"
                        aria-label="Titel der Seite"
                        maxLength={200}
                        onChange={(event) => onTitle(event.target.value)}
                        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); editor.current?.focusStart(); } }}
                        onBlur={() => { if (!cleanNoteTitle(titleDraft)) onTitle("Ohne Titel"); }}
                      />
                    ) : <h2 className="nz-title">{pageMeta.title}</h2>}
                    {viewer === "admin" && shareHint === page.id && accessOf(pageMeta).customer === "none" && (
                      <div className="nz-share-hint" role="note">
                        <Lock size={14} aria-hidden="true" />
                        <span className="nz-share-text">Nur das oalab-Team sieht diese Seite.</span>
                        <button type="button" className="nz-share-btn" onClick={shareWithCustomer}>Mit {customer.name} teilen</button>
                        <button type="button" className="nz-ibtn is-sm" aria-label="Hinweis schließen" onClick={() => setShareHint(null)}><X size={14} aria-hidden="true" /></button>
                      </div>
                    )}
                    {canEdit && fresh === page.id && isEmptyDoc(page.content) && <TemplateChips onPick={applyTemplate} />}
                    <NoteEditor
                      key={`${page.id}-${editorKey}`}
                      page={page}
                      editable={canEdit}
                      pages={pages}
                      onChange={(doc) => { lastDoc.current = doc; if (fresh) setFresh(null); queue({ content: doc }); }}
                      onOpenPage={(id) => void openPage(id)}
                      onCreateSubpage={createSubpage}
                      handleRef={editor}
                      refsUi={refsUi}
                      projects={projects}
                      viewer={viewer}
                      pageAudience={page.audience}
                      internal={Boolean(customer.team)}
                      loadTaskOptions={loadTaskOptions}
                      createTasks={createTasks}
                      loadPreview={loadPreview}
                      calendarUi={calendarUi}
                      imageUi={imageUi}
                    />
                    {viewer === "customer" && !canEdit && (
                      <p className="nz-readonly-note"><MessageCircle size={15} aria-hidden="true" /><span>Diese Seite ist zum Lesen. Etwas ergänzen oder fragen? <Link href={hubHref(preview, "messages")}>Schreib uns im Chat</Link></span></p>
                    )}
                  </article>
                </>
              ) : (
                <p className="nz-empty-page">{pages.length ? "Wähle links eine Seite." : canCreate ? "Noch keine Seite. Leg links mit „Neue Seite“ die erste an." : "oalab hat noch keine Notizen für dich freigegeben."}</p>
              )}
            </div>

            {pop === "gear" && pageMeta && (
              <PageGear
                page={pageMeta}
                viewer={viewer}
                customer={customer}
                projects={projects}
                parent={parent}
                people={people}
                canEdit={canEdit}
                canArrange={canArrange}
                onAccess={requestAccess}
                readers={viewer === "admin" ? readers : undefined}
                chatHref={hubHref(preview, "messages")}
                onProject={(projectId) => patchPage({ projectId })}
                onDate={(datedOn) => patchPage({ datedOn })}
                onWidth={(width) => patchPage({ width })}
                onIcon={() => { const button = document.querySelector<HTMLElement>(".nz-page-emoji, .nz-head-actions .nz-ghost"); setPop(null); setIconAnchor(button?.getBoundingClientRect() ?? new DOMRect(window.innerWidth / 2 - 172, 160, 1, 1)); }}
                onCover={() => setPop("cover")}
                onCopyLink={copyLink}
                onClose={() => setPop(null)}
                onNotify={viewer === "admin" && !customer.team ? () => void notifyChange() : undefined}
                onTeamNotify={viewer === "admin" && customer.team ? () => { setPop(null); setTeamAsk(true); } : undefined}
                onTrash={viewer === "admin" ? () => setPop("bin") : undefined}
                openItems={initial.taskWriter && canEdit ? openItems : 0}
                onOpenItems={() => { setPop(null); editor.current?.convertOpenItems(); }}
                onHistory={viewer === "admin" ? () => void openHistory() : undefined}
                appointmentHref={pageMeta.appointmentId && viewer !== "freelancer" ? calendarHref(pageMeta.appointmentId) : null}
              />
            )}
            {pop === "bin" && pageMeta && viewer === "admin" && <TrashAsk page={pageMeta} subpages={descendantsOf(pages, pageMeta.id).length} onConfirm={() => void trashPage()} onClose={() => setPop(null)} />}
            {pop === "history" && viewer === "admin" && <HistoryPanel items={history.items} error={history.error} onRestore={restoreRevision} onClose={() => setPop(null)} />}
            {pop === "size" && <TextSizePop value={textSize} onChange={(notesTextSize) => update({ notesTextSize })} onClose={() => setPop(null)} />}
          </div>
        )}
      </section>
      {iconAnchor && page && (
        <EmojiPicker
          anchor={iconAnchor}
          heading="Seitensymbol"
          onPick={(icon) => patchPage({ icon })}
          onRemove={pageMeta?.icon ? () => patchPage({ icon: "" }) : undefined}
          onClose={() => setIconAnchor(null)}
        />
      )}
      {ask && <AudienceDialog ask={ask} customer={customer} notifyDefault={settings.notifyOnShare} onConfirm={(notify) => void applyRights(ask.rights, notify)} onClose={() => setAsk(null)} />}
      {teamAsk && pageMeta && customer.team && <TeamNotifyDialog page={pageMeta} onSend={notifyTeam} onClose={() => setTeamAsk(false)} />}
      {peek && (
        <TaskPeek
          key={peek.id}
          task={refs.tasks[peek.id] ?? peek}
          viewer={viewer}
          canTick={initial.taskWriter && (refs.tasks[peek.id] ?? peek).version !== null}
          boardHref={boardHref(peek.projectId, peek.number)}
          loadMentions={async (taskId) => {
            if (preview) return previewMentions(taskId, viewer);
            const result = await taskMentions({ taskId });
            return result.ok ? result.data : [];
          }}
          onToggle={() => void toggleTask(refs.tasks[peek.id] ?? peek)}
          onOpenPage={(mention) => { setPeek(null); if (mention.customerId === customerId) void openPage(mention.id); else router.push(`${hubHref(preview, "projects")}/notes?customer=${encodeURIComponent(mention.customerId)}&page=${encodeURIComponent(mention.id)}`); }}
          onClose={() => setPeek(null)}
        />
      )}
      {toast && <div className="nz-toast" role="status">{toast}</div>}
    </>
  );
}

/** A save's fields on the open page or its list entry; the same cover image keeps its signed link. */
function withMeta<T extends { cover: NoteCover | null }>(item: T, patch: NotePatch): T {
  const meta = metaPatch(patch);
  return { ...item, ...meta, ...(meta.cover !== undefined ? { cover: keepCoverLink(item.cover, meta.cover) } : {}) };
}

/** The fields of a save that the list and the open page show at once. */
function metaPatch(patch: NotePatch): Partial<NotePageMeta> {
  const out: Partial<NotePageMeta> = {};
  if (patch.title !== undefined) out.title = patch.title;
  if (patch.icon !== undefined) out.icon = patch.icon;
  if (patch.width !== undefined) out.width = patch.width;
  if (patch.datedOn !== undefined) out.datedOn = patch.datedOn;
  if (patch.projectId !== undefined) out.projectId = patch.projectId;
  if (patch.cover !== undefined) out.cover = patch.cover ? { ...patch.cover } : null;
  return out;
}

function NotesHeader({ preview, viewer }: { preview: boolean; viewer: NoteViewer }) {
  return (
    <LargeTitleHeader
      title="Notizen"
      icon={<span className="title-icon"><NotebookPen size={24} color={categories.projects.fill} aria-hidden="true" /></span>}
      // Freelancers have no page „Projekte“; their way back is their board.
      leading={<Link href={viewer === "freelancer" ? `${hubHref(preview, "projects")}/tasks` : hubHref(preview, "projects")} className="on-bg-link"><ChevronLeft size={22} strokeWidth={2.5} aria-hidden="true" />{viewer === "freelancer" ? "Aufgaben" : "Projekte"}</Link>}
      actions={<HeaderActions />}
    />
  );
}
