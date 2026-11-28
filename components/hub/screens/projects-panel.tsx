"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleDot, ExternalLink, EyeOff, FlaskConical, FolderOpen, Gauge, Globe, LayoutGrid, LifeBuoy, Lock, MessageSquare, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Search, Trash2, Unplug } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { confirmSessionHref } from "@/lib/auth-redirect";
import { formatDay } from "@/lib/hub-contracts/rules";
import { domainStatuses, isDomainStatus } from "@/lib/hub-domains/rules";
import { formatDeadline, hubHref, type Project, type StudioProjectStatus } from "@/lib/hub-data";
import { packageCatalog, serviceRequestLimit } from "@/lib/service-packages";
import { byUrgency, customerState, isRunning, isWaiting, mainLinks, nextMilestone, statusOf, studioStatuses, withStudio, type DeskCustomer, type DeskEntry, type ProjectDesk, type StudioSaved } from "@/lib/hub-projects/desk";
import { readProjectUrl } from "@/lib/hub-projects/edit";
import { INTERNAL_TAG } from "@/lib/hub-team/rules";
import { shortUrl } from "@/lib/hub-projects/map";
import { saveProjectDetails, saveProjectUrls, setProjectStatus } from "@/lib/hub-projects/actions";
import { useAppearance } from "../appearance-provider";
import { useInfo } from "../info-box";
import { quickLinks, taskBoardHref } from "../project-links";
import { Select } from "../select";
import { SheetFooter, TableGroup, useCollapsedGroups } from "../sheet";
import { useHubShell } from "../shell-context";
import { CopyButton, DomainDialog } from "./contracts-domains";
import { tableHit } from "./contracts-parts";
import { CustomerSign } from "./customer-sign";
import { NewProjectPanel } from "./projects-new-panel";
import { ProjectsOverview } from "./projects-overview";
import { DueCell, LinkButtons, ProgressCell, rowMarks, StatusPick, StudioGlyph, VeilKey } from "./projects-parts";
import { ProjectSidePanel } from "./projects-side-panel";
import type { ScreenProps } from "./types";

/** One entry of the customer list: a hub customer (or, for a project without one, its organization) with its projects. */
type Entry = DeskEntry;
type Show = "all" | "running" | "idle";
type LinkKind = "live" | "test";
type LinkEdit = { mode: "add" | "edit"; projectId: string; kind: LinkKind; url: string; error: string };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const entryKey = (project: Project) => project.customerId ?? project.organizationId ?? project.company ?? project.id;
const isTyping = (element: Element | null) => Boolean(element?.closest("input, textarea, select, [contenteditable='true']"));
const linkLabel: Record<LinkKind, string> = { live: "Live-Domain", test: "Testdomain" };
const LinkIcon = ({ kind, size = 16 }: { kind: LinkKind; size?: number }) => kind === "live" ? <Globe size={size} aria-hidden="true" /> : <FlaskConical size={size} aria-hidden="true" />;
const dayMonth = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", timeZone: "Europe/Berlin" });
const shortDay = (iso: string) => dayMonth.format(new Date(iso));

/**
 * „Projekte“ for admins (Projekte V2, user 15.11.2026), built like „Vertrag & Domain“: every customer on the left
 * (search, Alle · Laufend · Ohne Projekt, „Alle Projekte“ on top), the chosen one on the right with all its projects,
 * their status to set right in the row and its colour over the row, the domains and links, the Service and the
 * finished projects. A project opens its panel at the right edge. The address holds the choice (?customer=,
 * ?project=), so links from the bell, the search, the calendar and the assistant open it here.
 */
export function ProjectsPanel({ projects, desk, asOf, preview, fileState }: ScreenProps & { desk: ProjectDesk }) {
  const params = useSearchParams();
  const router = useRouter();
  const { manageUsers, askAboutProject } = useHubShell();
  const groups = useCollapsedGroups();
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [overviewPanel, setOverviewPanel] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, StudioSaved>>({});
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [edit, setEdit] = useState<LinkEdit | null>(null);
  const [saving, setSaving] = useState(false);
  const [domainFor, setDomainFor] = useState<DeskCustomer | null>(null);
  // „Kacheln“ (27.11.2026): list or tiles and their size per device; in the tiles the customer list folds away until asked for.
  const { appearance, update } = useAppearance();
  const tilesView = appearance.projectView === "tiles";
  const [showList, setShowList] = useState(false);

  const statusInfo = useInfo("Projektstatus", {
    steps: [
      <><b>Fünf Stufen</b> wie im Studio, ein Klick ändert sie.</>,
      <><b>Der Kunde</b> sieht nur In Umsetzung oder Abgeschlossen.</>,
      <><b>Die Zeile</b> trägt die Farbe ihres Status.</>,
    ],
    ask: "Wie funktioniert der Projektstatus?",
  });
  const linksInfo = useInfo("Domains & Links", {
    steps: [
      <><b>Live-Domain</b> ist die echte Website des Kunden.</>,
      <><b>Testdomain:</b> Service-Änderungen landen zuerst hier.</>,
      <><b>Ein Klick</b> öffnet die Seite in einem neuen Tab.</>,
    ],
    ask: "Wofür sind Live-Domain und Testdomain?",
  });
  const serviceInfo = useInfo("Service", {
    steps: [
      <><b>Paket und Kontingent</b> wie in Vertrag & Domain.</>,
      <><b>Offene Anfragen</b> kommen von der Serviceplattform.</>,
      <><b>Freigabe:</b> Die Änderung liegt auf der Testdomain.</>,
    ],
    ask: "Was zeigt der Service-Teil bei Projekte?",
  });

  // A status or visibility set here shows at once, until the page's data carries that version itself.
  const view = useMemo(() => projects.map((project) => withStudio(project, saved[project.id])), [projects, saved]);
  const remember = (projectId: string, next: StudioSaved) => setSaved((current) => ({ ...current, [projectId]: { ...current[projectId], ...next } }));
  // The open panel reports unsaved changes; another project, another customer or closing asks before they are lost.
  const dirty = useRef(false);
  const reportDirty = useCallback((value: boolean) => { dirty.current = value; }, []);
  const leave = () => {
    if (dirty.current && !window.confirm("Deine Änderungen sind noch nicht gespeichert. Verwerfen?")) return false;
    dirty.current = false;
    return true;
  };
  const entries = useMemo<Entry[]>(() => {
    const byKey = new Map<string, Entry>(desk.customers.map((customer) => [customer.id, { key: customer.id, company: customer.company, customer, projects: [] }]));
    for (const project of view) {
      const key = entryKey(project);
      const entry = byKey.get(key) ?? { key, company: project.company ?? "Ohne Kunde", customer: null, projects: [] };
      entry.projects.push(project);
      byKey.set(key, entry);
    }
    // oalab's own entry (plan „oalab als Unternehmen“) first, then the customers A–Z.
    return [...byKey.values()].sort((a, b) => Number(Boolean(b.customer?.team)) - Number(Boolean(a.customer?.team)) || a.company.localeCompare(b.company, "de"));
  }, [desk.customers, view]);
  const states = useMemo(() => new Map(entries.map((item) => [item.key, customerState(item.projects)])), [entries]);
  const logos = useMemo(() => new Map([
    ...fileState.customers.flatMap((customer) => customer.logo ? [[customer.id, customer.logo] as const] : []),
    // The team entry is no customer of the asset management; its logo comes with the desk.
    ...desk.customers.flatMap((customer) => customer.team && customer.logo ? [[customer.id, customer.logo] as const] : []),
  ]), [fileState.customers, desk.customers]);

  // The choice lives in the address: a customer, and the project whose panel is open (a project alone opens its customer).
  const linked = view.find((project) => project.id === params.get("project")) ?? null;
  const paneKey = params.get("customer") ?? (linked ? entryKey(linked) : null);
  const entry = entries.find((item) => item.key === paneKey) ?? null;
  const panelProject = entry ? (linked && entryKey(linked) === entry.key ? linked : null) : view.find((project) => project.id === overviewPanel) ?? null;
  const [paneOpen, setPaneOpen] = useState(Boolean(entry));
  // Without a session confirmed by a code Studio refuses every change, so the page stays read-only and offers the code,
  // like the task board (16.11.2026). The code page sits outside the hub and returns to this customer and project.
  const locked = !desk.confirmed;
  const choice = params.toString();
  const confirmHref = locked ? confirmSessionHref(`${hubHref(preview, "projects")}${choice ? `?${choice}` : ""}`) : null;
  const codeFirst = "Erst „Mit Code bestätigen“ oben auf der Seite";

  function navigate(next: { customer?: string | null; project?: string | null }) {
    const url = new URL(window.location.href);
    url.searchParams.delete("customer");
    url.searchParams.delete("project");
    if (next.customer) url.searchParams.set("customer", next.customer);
    if (next.project) url.searchParams.set("project", next.project);
    // replaceState keeps the page as it is: no new request, the search params update in place.
    window.history.replaceState(null, "", url);
  }
  function chooseCustomer(key: string | null) {
    if (!leave()) return;
    navigate({ customer: key });
    setOverviewPanel(null);
    setCreating(false);
    setEdit(null);
    setNotice(null);
    setPaneOpen(true);
  }
  const openProject = (project: Project) => {
    if (project.id === panelProject?.id && !creating) return;
    if (!leave()) return;
    setCreating(false);
    if (entry) navigate({ customer: entry.key, project: project.id }); else setOverviewPanel(project.id);
  };
  const closePanel = () => {
    if (!leave()) return;
    setCreating(false);
    if (entry) navigate({ customer: entry.key }); else setOverviewPanel(null);
  };
  const startProject = () => {
    if (creating || locked || !leave()) return;
    if (entry) navigate({ customer: entry.key });
    setNotice(null);
    setCreating(true);
  };
  /** „Neues Projekt“ from a tile: the customer opens with the new project's panel, as „Projekt“ in its head does. */
  const createFor = (key: string) => {
    if (locked || !leave()) return;
    navigate({ customer: key });
    setOverviewPanel(null);
    setEdit(null);
    setNotice(null);
    setPaneOpen(true);
    setCreating(true);
  };

  async function changeStatus(project: Project, status: StudioProjectStatus) {
    setBusy(project.id);
    setNotice(null);
    try {
      const result = await setProjectStatus({ projectId: project.id, status, expectedVersion: project.studio?.version ?? null });
      if (!result.ok) {
        setNotice({ text: result.error, error: true });
        if (result.stale) router.refresh();
        return;
      }
      remember(project.id, result.data);
      setNotice({ text: `„${project.name}“ steht jetzt auf ${studioStatuses[status].label}.` });
    } catch {
      setNotice({ text: "Das hat gerade nicht geklappt. Bitte versuche es erneut.", error: true });
    } finally {
      setBusy(null);
    }
  }

  /** Releases a project to the customer or takes it back; like the status, at once. */
  async function changeVisible(project: Project, visible: boolean) {
    setBusy(project.id);
    setNotice(null);
    try {
      const result = await saveProjectDetails({ projectId: project.id, expectedVersion: project.studio?.version ?? null, patch: { clientVisible: visible } });
      if (!result.ok) {
        setNotice({ text: result.error, error: true });
        if (result.stale) router.refresh();
        return;
      }
      if (result.data.version !== null) remember(project.id, { version: result.data.version, visible });
      setNotice({ text: visible ? `„${project.name}“ sieht der Kunde jetzt unter Projekte.` : `„${project.name}“ ist wieder intern; der Kunde sieht es nicht mehr.` });
    } catch {
      setNotice({ text: "Das hat gerade nicht geklappt. Bitte versuche es erneut.", error: true });
    } finally {
      setBusy(null);
    }
  }

  async function saveLink(remove = false) {
    if (!edit) return;
    const project = view.find((item) => item.id === edit.projectId);
    if (!project) return;
    const read = readProjectUrl(remove ? "" : edit.url);
    if (!read.ok) { setEdit({ ...edit, error: read.error }); return; }
    if (!remove && !read.value) { setEdit({ ...edit, error: "Bitte eine Adresse eintragen, etwa kunde.de." }); return; }
    setSaving(true);
    try {
      const result = await saveProjectUrls({
        projectId: project.id,
        liveUrl: edit.kind === "live" ? read.value ?? "" : project.liveUrl ?? "",
        testUrl: edit.kind === "test" ? read.value ?? "" : project.testUrl ?? "",
      });
      if (!result.ok) { setEdit({ ...edit, error: result.error }); return; }
      setEdit(null);
      setNotice({ text: remove ? `${linkLabel[edit.kind]} von „${project.name}“ entfernt.` : `${linkLabel[edit.kind]} von „${project.name}“ gespeichert.` });
    } catch {
      setEdit({ ...edit, error: "Das hat gerade nicht geklappt. Bitte versuche es erneut." });
    } finally {
      setSaving(false);
    }
  }

  /* ---------- Customers ---------- */
  const term = query.trim().toLocaleLowerCase("de");
  const runningCount = entries.filter((item) => states.get(item.key)?.running).length;
  const counts = { running: runningCount, idle: entries.length - runningCount };
  const listed = entries
    .filter((item) => show === "all" || (show === "running") === Boolean(states.get(item.key)?.running))
    .filter((item) => tableHit(term, item.company, item.customer?.customerNumber, item.customer?.website, ...item.projects.flatMap((project) => [project.name, project.liveUrl, project.testUrl]), ...(item.customer?.domains.map((domain) => domain.display) ?? [])));
  const runningProjects = view.filter((project) => isRunning(statusOf(project))).length;

  const list = (
    <div className="chat-list">
      {/* Customers only: oalab stands above them under „Intern“. */}
      <div className="chat-list-head"><h2>Kunden<span>{entries.filter((item) => !item.customer?.team).length}</span></h2></div>
      <label className="chat-search"><Search size={15} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kunde, Projekt oder Domain" aria-label="Kunden nach Name, Projekt oder Domain durchsuchen" /></label>
      <div className="chat-filter" role="group" aria-label="Kunden zeigen">
        <button type="button" aria-pressed={show === "all"} onClick={() => setShow("all")}>Alle</button>
        <button type="button" aria-pressed={show === "running"} onClick={() => setShow("running")}>Laufend{counts.running > 0 && <span>{counts.running}</span>}</button>
        <button type="button" aria-pressed={show === "idle"} onClick={() => setShow("idle")}>Ohne Projekt{counts.idle > 0 && <span>{counts.idle}</span>}</button>
      </div>
      <ul className="chat-convs" role="list">
        {!term && (
          <li>
            <button type="button" className="chat-conv" aria-current={!entry ? "true" : undefined} onClick={() => chooseCustomer(null)}>
              <span className="am-tile pp-tile-icon"><LayoutGrid size={20} aria-hidden="true" /></span>
              <span className="chat-conv-main"><span className="chat-conv-top"><strong>Alle Projekte</strong></span><span className="chat-conv-sub"><span className="chat-conv-last">{plural(view.length, "Projekt", "Projekte")} · {runningProjects} laufen</span></span></span>
            </button>
          </li>
        )}
        {listed.map((item, index) => {
          const state = states.get(item.key)!;
          const cancelled = item.customer?.packages.find((pkg) => pkg.group === "service" && pkg.packageId && pkg.until);
          const team = Boolean(item.customer?.team);
          // oalab stands on its own above the customers; the customers keep their label.
          const label = team ? INTERNAL_TAG : index === 0 || listed[index - 1].customer?.team
            ? show === "running" ? "Mit laufendem Projekt" : show === "idle" ? "Ohne laufendes Projekt" : "Kunden von A bis Z" : null;
          return (
            <Fragment key={item.key}>
            {label && <li className="am-list-label">{label}</li>}
            <li>
              <button type="button" className="chat-conv" aria-current={entry?.key === item.key ? "true" : undefined} onClick={() => chooseCustomer(item.key)}>
                <CustomerSign customer={{ id: item.key, company: item.company }} logo={logos.get(item.key) ?? null} />
                <span className="chat-conv-main">
                  <span className="chat-conv-top"><strong>{item.company}</strong>
                    {team ? <span className="chat-pill tone-info" data-tip="Projekte des oalab-Teams, für keinen Kunden sichtbar">{INTERNAL_TAG}</span>
                      : state.pill === "risk" ? <span className="chat-pill tone-bad">Gefährdet</span>
                      : state.pill === "feedback" ? <span className="chat-pill tone-todo" data-tip="Eine Aufgabe liegt beim Kunden">Feedback</span>
                      : cancelled?.until ? <span className="chat-pill tone-todo" data-tip={`Service gekündigt zum ${formatDay(cancelled.until)}`}>Gekündigt</span>
                      : null}
                  </span>
                  <span className="chat-conv-sub"><span className="chat-conv-last"><i className={`pj-list-dot tone-${state.tone}`} aria-hidden="true" />{[item.customer?.customerNumber, state.sub].filter(Boolean).join(" · ")}</span></span>
                </span>
              </button>
            </li>
            </Fragment>
          );
        })}
        {!listed.length && <li className="chat-empty">{term ? `Kein Kunde passt zu „${query.trim()}“.` : "Keine Kunden in dieser Auswahl."}</li>}
      </ul>
    </div>
  );

  const back = <button type="button" className="chat-back" onClick={() => setPaneOpen(false)} aria-label="Zurück zu den Kunden"><ChevronLeft size={24} aria-hidden="true" /></button>;
  // Read-only until the session confirms a code: information, not an error, with the way to the code (as on the board).
  const lockLine = confirmHref && (
    <div className="calendar-notice kb-lock-note" role="status">
      <Lock size={18} aria-hidden="true" />
      <span className="kb-lock-text"><b>Nur lesen.</b> Zum Bearbeiten bestätigst du deine Anmeldung einmal mit einem Code aus der Mail.</span>
      <a className="sheet-action is-primary" href={confirmHref}>Mit Code bestätigen</a>
    </div>
  );
  const noticeLine = <>
    {lockLine}
    {notice && (notice.error
      ? <p className={`form-error${lockLine ? "" : " section-first"}`} role="alert">{notice.text}</p>
      : <p className={`calendar-notice${lockLine ? "" : " section-first"}`} role="status"><Check size={18} aria-hidden="true" />{notice.text}</p>)}
  </>;
  // „Neues Projekt“ needs a hub customer with an organization on the service platform, where projects live.
  const newFor = creating && entry?.customer?.organizationId ? { key: entry.key, customer: entry.customer } : null;
  const panel = newFor ? (
    <NewProjectPanel key={`new-${newFor.key}`} customer={newFor.customer} asOf={asOf} onClose={closePanel} onDirty={reportDirty}
      onCreated={(project) => {
        dirty.current = false;
        setCreating(false);
        navigate({ customer: newFor.key, project: project.id });
        setNotice({ text: `Projekt „${project.name}“ angelegt.` });
      }} />
  ) : panelProject && (
    <ProjectSidePanel key={panelProject.id} project={panelProject} asOf={asOf} busy={busy === panelProject.id} confirmHref={confirmHref} boardHref={taskBoardHref(preview, panelProject.id)}
      onStatus={(status) => changeStatus(panelProject, status)} onVisible={(visible) => changeVisible(panelProject, visible)} onClose={closePanel} onDirty={reportDirty}
      onSaved={(result, text) => { if (result.version !== null) remember(panelProject.id, { version: result.version }); setNotice({ text }); }}
      onStale={() => router.refresh()}
      onAsk={manageUsers ? () => askAboutProject({ id: panelProject.id, name: panelProject.name }) : undefined} />
  );

  /* ---------- All projects ---------- */
  if (!entry) {
    const count = (status: StudioProjectStatus) => view.filter((project) => statusOf(project) === status).length;
    return (
      <>
        {noticeLine}
        <div className={`sheet section-first am pp pj${tilesView && !showList ? " pj-wide" : ""}`} data-open={paneOpen ? "" : undefined}>
          <div className="am-grid">
            {list}
            <section className="am-pane" aria-label="Alle Projekte">
              <header className="am-pane-head">
                {back}
                {tilesView && (
                  <button type="button" className="am-icon-btn pj-list-toggle" onClick={() => setShowList((now) => !now)} aria-pressed={showList}
                    aria-label={showList ? "Kundenliste ausblenden" : "Kundenliste einblenden"} data-tip={showList ? "Kundenliste ausblenden" : "Kundenliste einblenden"} data-tip-sub={showList ? "mehr Platz für die Kacheln" : undefined}>
                    {showList ? <PanelLeftClose size={18} aria-hidden="true" /> : <PanelLeftOpen size={18} aria-hidden="true" />}
                  </button>
                )}
                <span className="am-tile is-lg pp-tile-icon"><LayoutGrid size={22} aria-hidden="true" /></span>
                <div className="am-pane-title"><strong>Alle Projekte</strong><span>{[plural(view.length, "Projekt", "Projekte"), `${runningProjects} laufen`, `${count("hold")} pausiert`, `${count("complete")} fertig`].join(" · ")}</span></div>
              </header>
              {view.length || tilesView
                ? <ProjectsOverview projects={view} entries={entries} keyOf={entryKey} logos={logos} asOf={asOf} current={panelProject?.id ?? null} busy={busy} locked={locked} lockHint={locked ? codeFirst : null}
                  view={appearance.projectView} tileSize={appearance.projectTileSize} panelOpen={Boolean(panelProject)}
                  onView={(projectView) => update({ projectView })} onTileSize={(projectTileSize) => update({ projectTileSize })}
                  onOpen={openProject} onCustomer={chooseCustomer} onCreate={createFor} onStatus={changeStatus} />
                : <div className="sheet-empty"><p>Noch keine Projekte. Wähle links einen Kunden; dort legst du mit „Projekt“ das erste an.</p></div>}
            </section>
          </div>
        </div>
        {panel}
      </>
    );
  }

  /* ---------- One customer ---------- */
  const customer = entry.customer;
  // oalab's own entry: internal projects only, without the customer's packages, Service, domains and shortcuts.
  const team = Boolean(customer?.team);
  // Why „Neues Projekt“ waits: no organization on the service platform yet, or a session without the code.
  const createBlock = !customer?.organizationId ? "Erst braucht der Kunde ein Konto auf der Serviceplattform" : locked ? codeFirst : null;
  const running = byUrgency(entry.projects.filter((project) => statusOf(project) !== "complete"));
  const finished = byUrgency(entry.projects.filter((project) => statusOf(project) === "complete"));
  const links = mainLinks(entry.projects);
  const held = customer?.packages.flatMap((pkg) => pkg.packageId ? [packageCatalog[pkg.packageId].short] : []) ?? [];
  const jumps = customer && !team ? quickLinks({ customerId: customer.id, company: customer.company, dueOn: null }, preview, true).filter((link) => link.id !== "date") : [];
  const projectName = (id: string | null) => entry.projects.find((project) => project.id === id)?.name ?? null;
  const addresses = [...running, ...finished].flatMap((project) => (["live", "test"] as const).flatMap((kind) => {
    const url = kind === "live" ? project.liveUrl : project.testUrl;
    return url ? [{ project, kind, url }] : [];
  }));

  const projectRow = (project: Project) => {
    const status = statusOf(project);
    const milestone = nextMilestone(project, asOf);
    const sub = status === "complete" ? (project.dueOn ? `Fertig · Ziel war ${formatDeadline(project.dueOn)}` : "Fertig")
      : milestone ? `Nächster Meilenstein: ${milestone.title} · ${formatDeadline(milestone.at.slice(0, 10))}`
      : project.milestones.length ? "Alle Meilensteine erreicht" : "Noch kein Meilenstein";
    return (
      <tr key={project.id} className={`file-row pj-row${rowMarks(project, panelProject?.id === project.id)}`} onClick={() => openProject(project)}>
        <td className="pj-cell-main">
          <span className="am-file">
            <span className={`pj-glyph tone-${studioStatuses[status].tone}`}><StudioGlyph status={status} size={16} /></span>
            <span className="am-file-text">
              <span className="pj-name">
                <button type="button" className="pj-open" onClick={(event) => { event.stopPropagation(); openProject(project); }} aria-label={`${project.name}: alle Angaben öffnen`}><strong>{project.name}</strong></button>
                {isWaiting(project) && isRunning(status) && <span className="chat-pill tone-todo" data-tip="Eine Aufgabe liegt beim Kunden">Kunde am Zug</span>}
                {project.studio?.visible !== true && !project.internal && <span className="pj-hidden" data-tip="Der Kunde sieht dieses Projekt noch nicht"><EyeOff size={13} aria-hidden="true" />intern</span>}
              </span>
              <small>{sub}</small>
            </span>
          </span>
        </td>
        <td className="pj-cell-status"><StatusPick project={project} busy={busy === project.id} locked={locked} onChange={(next) => changeStatus(project, next)} /></td>
        <td className="pj-cell-due"><DueCell project={project} asOf={asOf} /></td>
        <td className="pj-cell-progress"><ProgressCell project={project} /></td>
        <td className="pj-cell-links"><LinkButtons project={project} /></td>
        <td className="pj-cell-open"><ChevronRight size={18} aria-hidden="true" /></td>
      </tr>
    );
  };

  const editing = (project: Project, kind: LinkKind) => edit?.mode === "edit" && edit.projectId === project.id && edit.kind === kind;
  const startAdd = () => {
    const target = running[0] ?? finished[0];
    if (!target) return;
    const kind: LinkKind = target.liveUrl && !target.testUrl ? "test" : "live";
    setEdit({ mode: "add", projectId: target.id, kind, url: "", error: "" });
  };
  const linkForm = (current: LinkEdit) => {
    const project = entry.projects.find((item) => item.id === current.projectId) ?? null;
    const taken = current.mode === "add" && project ? (current.kind === "live" ? project.liveUrl : project.testUrl) : null;
    return (
      <tr className="pj-inline">
        <td colSpan={2}>
          <form className="pj-form" noValidate onSubmit={(event) => { event.preventDefault(); void saveLink(); }}>
            <div className="pj-form-row">
              {current.mode === "add"
                ? <div className="chat-filter pj-kind-filter" role="group" aria-label="Art der Adresse">{(["live", "test"] as const).map((kind) => <button key={kind} type="button" aria-pressed={current.kind === kind} onClick={() => setEdit({ ...current, kind, error: "" })}>{linkLabel[kind]}</button>)}</div>
                : <span className="pj-kind-label"><span className={`pj-kind is-${current.kind}`}><LinkIcon kind={current.kind} /></span><b>{linkLabel[current.kind]}</b></span>}
              {current.mode === "edit" && project && <span className="pj-form-hint">{project.name}</span>}
            </div>
            {current.mode === "add" && entry.projects.length > 1 && project && (
              <div className="pj-form-row">
                <span className="am-label">Projekt</span>
                <span className="um-pick pj-form-pick">
                  <span className="company-mark pj-mark"><StudioGlyph status={statusOf(project)} /></span>
                  <Select variant="bare" showLead={false} label="Projekt" value={current.projectId} onChange={(projectId) => setEdit({ ...current, projectId, error: "" })}
                    options={[...running, ...finished].map((item) => ({ value: item.id, label: item.name, meta: studioStatuses[statusOf(item)].label, lead: <StudioGlyph status={statusOf(item)} /> }))} />
                  <ChevronDown size={16} aria-hidden="true" />
                </span>
              </div>
            )}
            <div className="pj-form-row">
              <label className={`pj-url is-${current.kind}`}>
                <LinkIcon kind={current.kind} />
                <input value={current.url} onChange={(event) => setEdit({ ...current, url: event.target.value, error: "" })} placeholder={current.kind === "live" ? "kunde.de" : "test.kunde.de"} aria-label={linkLabel[current.kind]}
                  inputMode="url" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={2048} disabled={saving} autoFocus />
              </label>
            </div>
            {taken && <p className="pj-form-hint">{project!.name} hat schon eine {linkLabel[current.kind]} ({shortUrl(taken)}). Speichern ersetzt sie.</p>}
            {current.error && <p className="pj-form-error" role="alert">{current.error}</p>}
            <div className="pj-form-actions">
              {current.mode === "edit" && <button type="button" className="sheet-action is-danger" onClick={() => void saveLink(true)} disabled={saving}><Trash2 size={15} aria-hidden="true" />Entfernen</button>}
              <span className="pj-spacer" />
              <button type="button" className="sheet-action" onClick={() => setEdit(null)} disabled={saving}>Abbrechen</button>
              <button type="submit" className="sheet-action is-primary" disabled={saving}>{saving ? <MiniLoader size={15} /> : <Check size={15} aria-hidden="true" />}Speichern</button>
            </div>
            <p className="pj-form-hint">Nur https-Adressen. {current.kind === "test" ? "Die Testdomain ist dieselbe wie auf der Serviceplattform: Service-Änderungen landen zuerst dort." : "Die Live-Domain ist dieselbe wie auf der Serviceplattform („Live schalten“)."}</p>
          </form>
        </td>
      </tr>
    );
  };

  const service = customer?.packages.find((pkg) => pkg.group === "service" && pkg.packageId) ?? null;
  const contractsHref = customer ? `${hubHref(preview, "contracts")}?customer=${encodeURIComponent(customer.id)}` : hubHref(preview, "contracts");
  const requests = customer?.requests ?? [];
  const serviceRow = (key: string, icon: React.ReactNode, title: React.ReactNode, sub: React.ReactNode, date: React.ReactNode, actions: React.ReactNode, tone = "") => (
    <tr key={key} className="file-row">
      <td><span className="am-file"><span className={`am-file-icon cdm-file-icon${tone ? ` ${tone}` : " is-service"}`}>{icon}</span><span className="am-file-text"><strong>{title}</strong><small>{sub}</small></span></span></td>
      <td className="pj-cell-date">{date}</td>
      <td className="pj-cell-acts">{actions}</td>
    </tr>
  );
  const toContracts = (label: string) => <Link className="row-action" href={contractsHref} aria-label={label} data-tip={label}><ArrowUpRight size={16} aria-hidden="true" /></Link>;

  return (
    <>
      {noticeLine}
      <div className="sheet section-first am pp pj" data-open={paneOpen ? "" : undefined}>
        <div className="am-grid">
          {list}
          <section className="am-pane" aria-label={entry.company}>
            <header className="am-pane-head">
              {back}
              <CustomerSign customer={{ id: entry.key, company: entry.company }} logo={logos.get(entry.key) ?? null} size="lg" />
              <div className="am-pane-title"><strong>{entry.company}</strong><span>{[customer?.customerNumber, team ? "Interne Projekte des oalab-Teams" : held.join(" · ") || (customer ? "noch keine Pakete" : "kein Kunde im Hub zugeordnet")].filter(Boolean).join(" · ")}</span></div>
              {(links.live || links.test) && (
                <div className="pj-head-links">
                  {links.live && <a className="pj-chip is-live" href={links.live} target="_blank" rel="noopener noreferrer" aria-label={`Live-Domain ${shortUrl(links.live)} öffnen (neuer Tab)`} data-tip="Live-Domain öffnen" data-tip-sub="neuer Tab"><Globe size={15} aria-hidden="true" /><span className="pj-chip-text">{shortUrl(links.live)}</span><ArrowUpRight size={14} className="pj-chip-arrow" aria-hidden="true" /></a>}
                  {links.test && <a className="pj-chip is-test" href={links.test} target="_blank" rel="noopener noreferrer" aria-label={`Testdomain ${shortUrl(links.test)} öffnen (neuer Tab)`} data-tip="Testdomain öffnen" data-tip-sub={shortUrl(links.test)}><FlaskConical size={15} aria-hidden="true" /><span className="pj-chip-text">Testdomain</span><ArrowUpRight size={14} className="pj-chip-arrow" aria-hidden="true" /></a>}
                </div>
              )}
              <PaneJumps links={jumps} />
              {customer && (
                <button type="button" className="sheet-action is-primary pj-new" onClick={startProject} disabled={Boolean(createBlock) || creating} aria-label="Neues Projekt"
                  data-tip={createBlock ?? undefined} data-tip-compact={createBlock ? undefined : "Neues Projekt"}>
                  <Plus size={15} aria-hidden="true" /><span className="pj-new-label" data-tip-label>Projekt</span>
                </button>
              )}
            </header>
            <div className="am-scroll pj-scroll">
              <table className="file-table pj-table">
                <caption className="visually-hidden">Projekte von {entry.company}</caption>
                <TableGroup colSpan={6} label="Projekte" count={running.length} glyph={<FolderOpen size={16} aria-hidden="true" />} collapsed={groups.isCollapsed("projects")} onToggle={() => groups.toggle("projects")}
                  actions={statusInfo.button}>
                  {running.map(projectRow)}
                  {!running.length && <tr className="table-empty-row"><td colSpan={6}>{entry.projects.length ? "Gerade läuft kein Projekt." : team ? "Noch kein internes Projekt. Lege das erste mit „Projekt anlegen“ an." : customer?.organizationId || !customer ? "Für diesen Kunden gibt es noch kein Projekt." : "Noch kein Projekt: Dieser Kunde ist noch nicht auf der Serviceplattform."}</td></tr>}
                  {customer && (
                    <tr className="table-add-row">
                      <td colSpan={6}>
                        <button type="button" className="table-add" onClick={startProject} disabled={Boolean(createBlock) || creating} data-tip={createBlock ?? undefined}><Plus size={16} aria-hidden="true" />Projekt anlegen</button>
                      </td>
                    </tr>
                  )}
                </TableGroup>
              </table>
              <table className="file-table pj-table">
                <caption className="visually-hidden">Domains und Links von {entry.company}</caption>
                <TableGroup colSpan={2} label="Domains & Links" count={addresses.length + (customer?.domains.length ?? 0)} glyph={<Globe size={16} aria-hidden="true" />} collapsed={groups.isCollapsed("links")} onToggle={() => groups.toggle("links")}
                  actions={<>{customer && !team && <button type="button" className="table-group-action" onClick={() => setDomainFor(customer)} data-tip="Domain eintragen" data-tip-sub="unter Vertrag & Domain" aria-label="Domain unter Vertrag & Domain eintragen"><Plus size={15} aria-hidden="true" /></button>}{linksInfo.button}</>}>
                  {addresses.map(({ project, kind, url }) => editing(project, kind) && edit ? <Fragment key={`${project.id}-${kind}`}>{linkForm(edit)}</Fragment> : (
                    <tr key={`${project.id}-${kind}`} className="file-row pj-link-row">
                      <td>
                        <span className="am-file">
                          <span className={`pj-kind is-${kind}`}><LinkIcon kind={kind} /></span>
                          <span className="am-file-text">
                            <a className="pj-host" href={url} target="_blank" rel="noopener noreferrer"><span>{shortUrl(url)}</span><ArrowUpRight size={13} aria-hidden="true" /></a>
                            <small>{linkLabel[kind]} · {project.name}{kind === "test" ? " · Service-Änderungen zuerst hier" : ""}</small>
                          </span>
                        </span>
                      </td>
                      <td className="pj-cell-acts">
                        <a className="row-action" href={url} target="_blank" rel="noopener noreferrer" aria-label={`${shortUrl(url)} öffnen (neuer Tab)`} data-tip="Öffnen" data-tip-sub="neuer Tab"><ExternalLink size={16} aria-hidden="true" /></a>
                        <CopyButton value={url} label="Adresse" />
                        {!locked && <button type="button" className="row-action" onClick={() => setEdit({ mode: "edit", projectId: project.id, kind, url, error: "" })} aria-label={`${linkLabel[kind]} von ${project.name} ändern`} data-tip="Ändern"><Pencil size={16} aria-hidden="true" /></button>}
                      </td>
                    </tr>
                  ))}
                  {(customer?.domains ?? []).map((domain) => {
                    const status = isDomainStatus(domain.status) ? domain.status : "active";
                    return (
                      <tr key={domain.id} className="file-row pj-link-row">
                        <td>
                          <Link className="am-file" href={`${hubHref(preview, "contracts")}?customer=${encodeURIComponent(customer!.id)}&tab=domains`} data-tip="In Vertrag & Domain öffnen">
                            <span className="pj-kind is-domain"><CircleDot size={16} aria-hidden="true" /></span>
                            <span className="am-file-text"><strong>{domain.display}</strong><small>{["Domain", domainStatuses[status].label, domain.renewsOn ? `verlängert sich am ${formatDay(domain.renewsOn)}` : ""].filter(Boolean).join(" · ")}</small></span>
                          </Link>
                        </td>
                        <td className="pj-cell-acts"><a className="row-action" href={`https://${domain.domain}`} target="_blank" rel="noopener noreferrer" aria-label={`${domain.display} öffnen (neuer Tab)`} data-tip="Öffnen" data-tip-sub="neuer Tab"><ExternalLink size={16} aria-hidden="true" /></a></td>
                      </tr>
                    );
                  })}
                  {!addresses.length && !customer?.domains.length && edit?.mode !== "add" && <tr className="table-empty-row"><td colSpan={2}>Noch keine Domain hinterlegt.</td></tr>}
                  {edit?.mode === "add" ? linkForm(edit) : (
                    <tr className="table-add-row">
                      <td colSpan={2}>
                        <button type="button" className="table-add" onClick={startAdd} disabled={!entry.projects.length || locked} data-tip={locked ? codeFirst : entry.projects.length ? undefined : team ? "Erst braucht es ein Projekt" : "Erst braucht der Kunde ein Projekt"}><Plus size={16} aria-hidden="true" />Live-Domain oder Testdomain hinterlegen</button>
                      </td>
                    </tr>
                  )}
                </TableGroup>
              </table>
              {!team && <table className="file-table pj-table">
                <caption className="visually-hidden">Service von {entry.company}</caption>
                <TableGroup colSpan={3} label="Service" count={requests.length} glyph={<LifeBuoy size={16} aria-hidden="true" />} collapsed={groups.isCollapsed("service")} onToggle={() => groups.toggle("service")} actions={serviceInfo.button}>
                  {service?.packageId
                    ? serviceRow("package", <LifeBuoy size={16} aria-hidden="true" />, packageCatalog[service.packageId].short,
                      <>{[service.since ? `seit ${formatDay(service.since)}` : "", `${serviceRequestLimit(service.packageId)} neue Anfragen im Monat`].filter(Boolean).join(" · ")}{service.until && <> · <b>gekündigt zum {formatDay(service.until)}</b></>}</>,
                      null, toContracts("In Vertrag & Domain öffnen"))
                    : serviceRow("package", <LifeBuoy size={16} aria-hidden="true" />, "Kein Servicepaket", "Anfragen über die Serviceplattform sind nicht gebucht", null, customer ? toContracts("In Vertrag & Domain festlegen") : null, "is-off")}
                  {customer?.quota && desk.month && (() => {
                    const { used, limit } = customer.quota;
                    const share = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
                    return (
                      <tr key="quota" className="file-row">
                        <td><span className="am-file"><span className="am-file-icon cdm-file-icon is-service"><Gauge size={16} aria-hidden="true" /></span><span className="am-file-text"><strong>Anfragen im {desk.month}</strong><small>{used >= limit ? "Kontingent ausgeschöpft" : `${limit - used} frei bis Monatsende`}</small></span></span></td>
                        <td className="pj-cell-date pj-cell-meter" colSpan={2}>
                          <div className="cdm-meter-row pj-meter">
                            <div className={`cdm-meter${used >= limit ? " is-full" : share >= 80 ? " is-warn" : ""}`} role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-label={`Anfragen im ${desk.month}`}><span style={{ width: `${share}%` }} /></div>
                            <strong className="numeric">{used} von {limit}</strong>
                          </div>
                        </td>
                      </tr>
                    );
                  })()}
                  {customer && !customer.organizationId && serviceRow("platform", <Unplug size={16} aria-hidden="true" />, "Noch nicht auf der Serviceplattform", "Ohne Organisation dort gibt es keine Projekte und Anfragen", null, null, "is-off")}
                  {requests.map((request) => {
                    const project = entry.projects.find((item) => item.id === request.projectId) ?? null;
                    return serviceRow(request.id, <MessageSquare size={16} aria-hidden="true" />, request.title,
                      <>{request.reference}{projectName(request.projectId) ? ` · ${projectName(request.projectId)}` : ""} · <span className={`chat-pill tone-${request.tone}`}>{request.label}</span></>,
                      <time dateTime={request.at}>{shortDay(request.at)}</time>,
                      <>
                        {request.approval && project?.testUrl && <a className="row-action" href={project.testUrl} target="_blank" rel="noopener noreferrer" aria-label="Auf der Testdomain ansehen (neuer Tab)" data-tip="Auf der Testdomain ansehen" data-tip-sub={shortUrl(project.testUrl)}><FlaskConical size={16} aria-hidden="true" /></a>}
                        <Link className="row-action" href={`${hubHref(preview, "messages")}?tab=service&conversation=${encodeURIComponent(request.id)}`} aria-label={`${request.reference} in Nachrichten öffnen`} data-tip="In Nachrichten öffnen"><ArrowUpRight size={16} aria-hidden="true" /></Link>
                      </>);
                  })}
                  {desk.month && (service?.packageId || customer?.done.count) ? serviceRow("done", <CheckCheck size={16} aria-hidden="true" />, `${plural(customer?.done.count ?? 0, "Anfrage", "Anfragen")} im ${desk.month} erledigt`,
                    customer?.done.last ? `zuletzt ${customer.done.last.reference} ${customer.done.last.title}` : "noch keine in diesem Monat",
                    customer?.done.last ? <time dateTime={customer.done.last.at}>{shortDay(customer.done.last.at)}</time> : null, null, "is-off") : null}
                  {desk.partial && <tr className="table-empty-row"><td colSpan={3}>{desk.partial}</td></tr>}
                </TableGroup>
              </table>}
              {finished.length > 0 && (
                <table className="file-table pj-table">
                  <caption className="visually-hidden">Abgeschlossene Projekte von {entry.company}</caption>
                  <TableGroup colSpan={6} label="Abgeschlossen" count={finished.length} glyph={<StudioGlyph status="complete" />} collapsed={groups.isCollapsed("done")} onToggle={() => groups.toggle("done")}>
                    {finished.map(projectRow)}
                  </TableGroup>
                </table>
              )}
            </div>
            <SheetFooter hint={<VeilKey projects={entry.projects} fallback="Ein Klick auf ein Projekt öffnet alle Angaben" />}>
              {[customer?.customerNumber, plural(running.length, "offenes Projekt", "offene Projekte"), plural(addresses.length + (customer?.domains.length ?? 0), "Domain", "Domains")].filter(Boolean).join(" · ")}
            </SheetFooter>
          </section>
        </div>
      </div>
      {statusInfo.box}{linksInfo.box}{serviceInfo.box}
      {panel}
      {domainFor && <DomainDialog customer={{ id: domainFor.id, company: domainFor.company, customerNumber: domainFor.customerNumber, logo: null, packages: [] }} onClose={() => setDomainFor(null)} onSaved={(text) => { setNotice({ text }); router.refresh(); }} />}
    </>
  );
}

/** Jumps to everything around the customer, as quiet icons in the pane's head; digits 1–9 open them too. */
function PaneJumps({ links }: { links: ReturnType<typeof quickLinks> }) {
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || !/^[1-9]$/.test(event.key)) return;
      if (isTyping(document.activeElement) || document.querySelector("dialog[open]")) return;
      const link = nav.current?.querySelector<HTMLElement>(`[data-quick="${event.key}"]`);
      if (!link) return;
      event.preventDefault();
      link.click();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  if (!links.length) return null;
  return (
    <nav ref={nav} className="am-pane-actions pp-jumps" aria-label="Schnellzugriff">
      {links.map((link, index) => (
        <Link key={link.id} href={link.href} className="am-icon-btn pp-jump" data-quick={index + 1} data-tip={`${link.tip} · ${index + 1}`} aria-label={link.tip} aria-keyshortcuts={String(index + 1)}>{link.icon}</Link>
      ))}
    </nav>
  );
}
