"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, Copy, Maximize2, Minimize2, NotebookPen, PanelLeftOpen, RefreshCw, Settings, Smile, Image as ImageIcon, Type } from "lucide-react";
import { categories } from "@/lib/categories";
import { hubHref } from "@/lib/hub-data";
import { useStoredValue } from "@/lib/use-stored-value";
import { createNotePage, loadNotesCustomer, openNotePage, saveNotePage, saveNoteSettings, setNoteAudience } from "@/lib/hub-notes/actions";
import { notesFixtures, previewPage, toMetaOnly } from "@/lib/hub-notes/fixtures";
import { audienceLabel, cleanNoteTitle, editedAgo, emptyNoteDoc, gains, narrowedBelow, noteText, pathOf, positionAfter, childrenOf, viewerEdits, newPageAudience } from "@/lib/hub-notes/rules";
import type { NoteAudience, NoteCustomer, NoteDoc, NotePage, NotePageMeta, NotePatch, NoteProject, NotesArea, NoteSettings, NoteViewer } from "@/lib/hub-notes/types";
import { useAppearance } from "../appearance-provider";
import { HeaderActions } from "../app-shell";
import { LargeTitleHeader } from "../large-title-header";
import { EmojiGlyph } from "./notes-blocks";
import { CoverBand, CoverPicker } from "./notes-cover";
import type { NoteEditorHandle } from "./notes-editor";
import { EmojiPicker } from "./notes-emoji-picker";
import { AreaGear, AudienceDialog, audienceIcons, PageGear, TextSizePop, type AudienceAsk } from "./notes-settings";
import { NotesTree } from "./notes-tree";

// „Notizen“ under Projekte (plan docs/planung/notizen.md, design V2 of 22.11.2026): a calm page list on the left, a
// large writing area on the right, everything about a page behind its gear. Writing saves itself about a second after
// the last keystroke with the version it started from; if somebody else saved in between, nothing is overwritten and
// the own text stays at hand. The design preview runs on examples and saves nothing (?role=customer / freelancer).

const NoteEditor = dynamic(() => import("./notes-editor"), { ssr: false, loading: () => <div className="nz-editor-loading" aria-hidden="true" /> });

const TREE_KEY = "oalab-notes-tree";
const NOTES_CUSTOMER_COOKIE = "oalab-notes-customer";
type SaveStatus = "saved" | "saving" | "error" | "stale";
type Pop = null | "gear" | "area" | "size" | "cover";
type Stale = { message: string; current: NotePage; mine: NoteDoc; reloaded: boolean };

const unavailable: NotesArea = { viewer: "customer", viewerId: "", customers: [], customerId: null, projects: [], pages: [], page: null, settings: { defaultAudience: "team", notifyOnShare: true, groupByProject: true, meetingTemplate: "meeting", defaultWidth: "normal" }, people: {}, ready: true, error: "Die Notizen konnten gerade nicht geladen werden." };

const phoneQuery = "(max-width: 767px)";
const subscribePhone = (listener: () => void) => { const list = window.matchMedia(phoneQuery); list.addEventListener("change", listener); return () => list.removeEventListener("change", listener); };
const usePhone = () => useSyncExternalStore(subscribePhone, () => window.matchMedia(phoneQuery).matches, () => false);

export function NotesScreen({ area, preview }: { area?: NotesArea; preview: boolean }) {
  const searchParams = useSearchParams();
  const role = searchParams.get("role");
  const previewViewer: NoteViewer = role === "customer" ? "customer" : role === "freelancer" ? "freelancer" : "admin";
  const initial = useMemo(() => preview ? notesFixtures(previewViewer) : area ?? unavailable, [preview, previewViewer, area]);
  return <NotesWorkspace key={preview ? previewViewer : "live"} initial={initial} preview={preview} />;
}

function NotesWorkspace({ initial, preview }: { initial: NotesArea; preview: boolean }) {
  const pathname = usePathname();
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
  const canEdit = Boolean(page) && viewerEdits(viewer, page!.audience);
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
      setPages((list) => list.map((item) => item.id === current.id ? { ...item, ...metaPatch(patch), updatedAt: now, updatedBy: initial.viewerId } : item));
      setStatus("saved");
      return true;
    }
    setStatus("saving");
    const run = (async () => {
      const result = await saveNotePage({ id: current.id, version: versionRef.current, patch });
      if (result.ok) {
        versionRef.current = result.data.version;
        setPages((list) => list.map((item) => item.id === current.id ? { ...item, ...metaPatch(patch), version: result.data.version, updatedAt: result.data.updatedAt, updatedBy: result.data.updatedBy } : item));
        setPage((open) => open && open.id === current.id ? { ...open, ...metaPatch(patch), version: result.data.version, updatedAt: result.data.updatedAt, updatedBy: result.data.updatedBy, ...(patch.content ? { content: patch.content } : {}) } : open);
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
    setStale(null);
    setStatus("saved");
    setPop(null);
    setEditorKey((value) => value + 1);
    if (morePeople) setPeople((current) => ({ ...current, ...morePeople }));
  }, []);

  const openPage = useCallback(async (id: string) => {
    if (page?.id === id) { setMobileView("page"); return; }
    if (!(await flush())) { say("Diese Seite ist noch nicht gespeichert. Bitte erst speichern oder neu laden."); return; }
    let next: NotePage | null = null;
    if (preview) next = previewPage(id);
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
    setOpenNodes((current) => ({ ...current, ...Object.fromEntries(pathOf(pages, id).filter((item) => item.id !== id).map((item) => [item.id, true])) }));
    setMobileView("page");
    remember(customerId, id);
  }, [page?.id, flush, preview, pages, showPage, remember, customerId, say]);

  const switchCustomer = useCallback(async (id: string) => {
    if (id === customerId) return;
    if (!(await flush())) { say("Diese Seite ist noch nicht gespeichert. Bitte erst speichern oder neu laden."); return; }
    if (viewer === "admin") document.cookie = `${NOTES_CUSTOMER_COOKIE}=${encodeURIComponent(id)}; Path=/; Max-Age=31536000; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
    if (preview) {
      const shown = id === initial.customerId ? initial.pages : [];
      setCustomerId(id);
      setPages(shown);
      setProjects(id === initial.customerId ? initial.projects : []);
      const first = childrenOf(shown, null)[0];
      showPage(first ? previewPage(first.id) : null);
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
        width: settings.defaultWidth, audience: newPageAudience(viewer, parent, settings, customer.hasFreelancer), datedOn: null,
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

  const newTopPage = useCallback(async () => {
    const meta = await createPage(null);
    if (!meta) return;
    const full: NotePage = { ...meta, content: emptyNoteDoc() };
    showPage(full);
    setMobileView("page");
    remember(customerId, meta.id);
    say(`Neue Seite angelegt. Sichtbar für: ${audienceLabel(meta.audience, customer?.hasFreelancer ?? true)}.`);
    window.setTimeout(() => { titleField.current?.focus(); titleField.current?.select(); }, 60);
  }, [createPage, showPage, remember, customerId, say, customer?.hasFreelancer]);

  const createSubpage = useCallback(async () => pageMeta ? createPage(pageMeta) : null, [createPage, pageMeta]);

  const patchPage = useCallback((patch: NotePatch, delay = 0) => {
    if (!page) return;
    setPage((open) => open ? { ...open, ...metaPatch(patch) } : open);
    setPages((list) => list.map((item) => item.id === page.id ? { ...item, ...metaPatch(patch) } : item));
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

  const applyAudience = useCallback(async (target: NoteAudience) => {
    if (!page) return;
    setAsk(null);
    if (preview) {
      const changes = new Map(narrowedBelow(pages, page.id, target).map((item) => [item.id, item.audience]));
      setPages((list) => list.map((item) => item.id === page.id ? { ...item, audience: target } : changes.has(item.id) ? { ...item, audience: changes.get(item.id)! } : item));
      setPage((open) => open ? { ...open, audience: target } : open);
      say(`Sichtbar für: ${audienceLabel(target, customer?.hasFreelancer ?? true)}.${changes.size ? ` ${changes.size} ${changes.size === 1 ? "Unterseite" : "Unterseiten"} ebenfalls eingeschränkt.` : ""}`);
      return;
    }
    if (!(await flush())) return;
    setBusy(true);
    const result = await setNoteAudience({ id: page.id, audience: target });
    setBusy(false);
    if (!result.ok) { say(result.error); return; }
    setPages(result.data.pages);
    const fresh = result.data.pages.find((item) => item.id === page.id);
    if (fresh) { versionRef.current = fresh.version; setPage((open) => open ? { ...open, audience: fresh.audience, version: fresh.version, updatedAt: fresh.updatedAt, updatedBy: fresh.updatedBy } : open); }
    const n = result.data.narrowed;
    say(`${target === "team" ? "Nur noch das oalab-Team sieht diese Seite." : `Sichtbar für: ${audienceLabel(target, customer?.hasFreelancer ?? true)}.`}${n ? ` ${n} ${n === 1 ? "Unterseite" : "Unterseiten"} ebenfalls eingeschränkt.` : ""}`);
  }, [page, preview, pages, flush, say, customer?.hasFreelancer]);

  const requestAudience = (target: NoteAudience) => {
    if (!page || target === page.audience) return;
    const narrowed = narrowedBelow(pages, page.id, target).map(({ title, audience }) => ({ title, audience }));
    const gained = gains(page.audience, target);
    if (gained.customer || gained.freelancer || narrowed.length) setAsk({ page: pageMeta ?? page, target, narrowed });
    else void applyAudience(target);
  };

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
  const AudienceMark = pageMeta ? audienceIcons[pageMeta.audience] : null;
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
            onCreate={() => void newTopPage()}
            onCustomer={(id) => void switchCustomer(id)}
            onArea={() => setPop((value) => value === "area" ? null : "area")}
            areaOpen={pop === "area"}
            onCollapse={() => setStoredTree("closed")}
            phone={phone}
          />
        )}
        {pop === "area" && viewer === "admin" && <AreaGear settings={settings} onChange={(patch) => void changeSettings(patch)} onClose={() => setPop(null)} />}

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
              {pageMeta && viewer === "customer" && <span className="nz-shared">Von oalab geteilt</span>}
              {pageMeta && viewer !== "customer" && (
                status === "error"
                  ? <button type="button" className="nz-meta is-error" onClick={() => void flush()} data-tip={saveError}><RefreshCw size={13} aria-hidden="true" />Nicht gespeichert – erneut versuchen</button>
                  : <span className={`nz-meta${status === "stale" ? " is-error" : ""}`} aria-live="polite">{canEdit ? statusLabel : `Bearbeitet ${editedAgo(pageMeta.updatedAt)}`}</span>
              )}
              {pageMeta && viewer !== "customer" && AudienceMark && (
                <button type="button" className="nz-ibtn" data-gear-button aria-label={`Sichtbar für: ${audienceLabel(pageMeta.audience, customer.hasFreelancer)}`} data-tip={`Sichtbar für: ${audienceLabel(pageMeta.audience, customer.hasFreelancer)}`} onClick={() => setPop("gear")}><AudienceMark size={16} aria-hidden={true} /></button>
              )}
              {pageMeta && !phone && <button type="button" className={`nz-ibtn${focus ? " is-on" : ""}`} aria-pressed={focus} aria-label={focus ? "Fokus beenden" : "Fokus: nur die Seite"} data-tip={focus ? "Fokus beenden (Esc)" : "Fokus: nur die Seite"} onClick={() => setFocus((value) => !value)}>{focus ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}</button>}
              <button type="button" className={`nz-ibtn${pop === "size" ? " is-on" : ""}`} data-size-button aria-label="Schriftgröße" data-tip="Schriftgröße" aria-expanded={pop === "size"} onClick={() => setPop((value) => value === "size" ? null : "size")}><Type size={16} aria-hidden="true" /></button>
              {pageMeta && <button type="button" className={`nz-ibtn${pop === "gear" ? " is-on" : ""}`} data-gear-button aria-label="Einstellungen dieser Seite" data-tip="Einstellungen dieser Seite" aria-expanded={pop === "gear"} onClick={() => setPop((value) => value === "gear" ? null : "gear")}><Settings size={17} aria-hidden="true" /></button>}
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
                      cover={pageMeta.cover}
                      editable={canEdit}
                      onOpenPicker={() => setPop("cover")}
                      onPosition={(position) => patchPage({ cover: { kind: pageMeta.cover!.kind, value: pageMeta.cover!.value, position } })}
                      onRemove={() => { patchPage({ cover: null }); say("Titelbild entfernt."); }}
                    />
                  )}
                  {pop === "cover" && canEdit && (
                    <CoverPicker
                      value={pageMeta.cover?.kind === "gallery" ? pageMeta.cover.value : null}
                      hasCover={hasCover}
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
                      {canEdit && (!pageMeta.icon || !hasCover) && (
                        <div className="nz-head-actions">
                          {!pageMeta.icon && <button type="button" className="nz-ghost" onClick={(event) => setIconAnchor(event.currentTarget.getBoundingClientRect())}><Smile size={16} aria-hidden="true" /><span>Symbol hinzufügen</span></button>}
                          {!hasCover && <button type="button" className="nz-ghost" data-cover-button onClick={() => setPop("cover")}><ImageIcon size={16} aria-hidden="true" /><span>Titelbild hinzufügen</span></button>}
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
                    <NoteEditor
                      key={`${page.id}-${editorKey}`}
                      page={page}
                      editable={canEdit}
                      pages={pages}
                      onChange={(doc) => { lastDoc.current = doc; queue({ content: doc }); }}
                      onOpenPage={(id) => void openPage(id)}
                      onCreateSubpage={createSubpage}
                      handleRef={editor}
                    />
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
                onAudience={requestAudience}
                onProject={(projectId) => patchPage({ projectId })}
                onDate={(datedOn) => patchPage({ datedOn })}
                onWidth={(width) => patchPage({ width })}
                onIcon={() => { const button = document.querySelector<HTMLElement>(".nz-page-emoji, .nz-head-actions .nz-ghost"); setPop(null); setIconAnchor(button?.getBoundingClientRect() ?? new DOMRect(window.innerWidth / 2 - 172, 160, 1, 1)); }}
                onCover={() => setPop("cover")}
                onCopyLink={copyLink}
                onClose={() => setPop(null)}
              />
            )}
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
      {ask && <AudienceDialog ask={ask} customer={customer} onConfirm={() => void applyAudience(ask.target)} onClose={() => setAsk(null)} />}
      {toast && <div className="nz-toast" role="status">{toast}</div>}
    </>
  );
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
