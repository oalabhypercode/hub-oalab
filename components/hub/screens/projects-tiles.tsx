"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUpRight, Calendar, ChevronDown, ChevronRight, EyeOff, Flag, Hand, Plus } from "lucide-react";
import type { TileSize } from "@/lib/appearance";
import { formatDay } from "@/lib/hub-contracts/rules";
import { deadlineHint, formatDeadline, type Project, type StudioProjectStatus } from "@/lib/hub-data";
import type { CustomerLogo } from "@/lib/hub-logos/rules";
import { customerState, isRunning, isWaiting, nextMilestone, projectTimeline, statusOf, tileSections, type ProjectTile, type ProjectTimeline } from "@/lib/hub-projects/desk";
import { INTERNAL_TAG } from "@/lib/hub-team/rules";
import { packageCatalog } from "@/lib/service-packages";
import { useCollapsedGroups } from "../sheet";
import { CustomerSign } from "./customer-sign";
import { LinkButtons, progressBasis, ProgressCell, StatusPick, StudioGlyph } from "./projects-parts";

const phoneQuery = "(max-width: 767px)";
const subscribePhone = (listener: () => void) => { const list = window.matchMedia(phoneQuery); list.addEventListener("change", listener); return () => list.removeEventListener("change", listener); };
const usePhone = () => useSyncExternalStore(subscribePhone, () => window.matchMedia(phoneQuery).matches, () => false);

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const day = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("de-DE", { ...options, timeZone: "UTC" });
const shortDay = day({ day: "2-digit", month: "short" });
const dayMonth = day({ day: "2-digit", month: "2-digit" });
const weekday = day({ weekday: "short", day: "2-digit", month: "2-digit" });
const at = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
/** The grid's rows are this small; every tile spans as many as it is high, plus the gap below it. */
const TILE_ROW = 4;

type Handlers = {
  onOpen: (project: Project) => void;
  onCustomer: (key: string) => void;
  onCreate: (key: string) => void;
  onStatus: (project: Project, status: StudioProjectStatus) => void;
};

/**
 * „Kacheln“ of Alle Projekte (user 27.11.2026): every customer a rounded tile with its projects as cards, for a quick
 * look over everything. A card carries its status like a row of the list (veil and bar), its status pill changes it at
 * once and a click opens the project's panel; the tile's head opens the customer. Three sizes: one line per project,
 * cards, or cards with the time line. Phones always show one line per project.
 */
export function ProjectTiles({ tiles, grouped, finished, size, asOf, current, busy, locked, lockHint, logos, panelOpen, ...handlers }: Handlers & {
  tiles: ProjectTile[];
  /** „Gruppe: Status“: the tiles in sections, at risk first; else one board. */
  grouped: boolean;
  /** The filter shows the finished projects: they are the cards, nothing folds away. */
  finished: boolean;
  size: TileSize;
  asOf: string;
  current: string | null;
  busy: string | null;
  /** The session has not confirmed a code: the status only shows. */
  locked: boolean;
  /** Why „Neues Projekt“ waits, or null. */
  lockHint: string | null;
  logos: Map<string, CustomerLogo>;
  /** A project's panel is open at the right edge: the tiles make room for it. */
  panelOpen: boolean;
}) {
  const phone = usePhone();
  const shown: TileSize = phone ? "small" : size;
  const sections = useCollapsedGroups();
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const board = useRoomForPanel(panelOpen, current);
  const fold = (key: string) => setUnfolded((now) => {
    const next = new Set(now);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const tile = (item: ProjectTile) => (
    <Tile key={item.entry.key} item={item} size={shown} finished={finished} asOf={asOf} current={current} busy={busy} locked={locked} lockHint={lockHint}
      logo={logos.get(item.entry.key) ?? null} unfolded={unfolded.has(item.entry.key)} onFold={() => fold(item.entry.key)} {...handlers} />
  );
  return (
    <div className="am-scroll pj-tscroll">
      <div ref={board} className={`pj-tiles is-${shown}`}>
        {grouped ? tileSections.map((section) => {
          const list = tiles.filter((item) => item.section === section.id);
          if (!list.length) return null;
          const collapsed = sections.isCollapsed(section.id);
          return (
            <section key={section.id} className="pj-tsec" aria-label={section.label}>
              <div className="pj-tsec-head">
                <button type="button" className="table-group-toggle" aria-expanded={!collapsed} onClick={() => sections.toggle(section.id)}>
                  <ChevronDown size={14} className="table-group-chevron" aria-hidden="true" />
                  <span className="table-group-glyph"><StudioGlyph status={section.glyph} /></span>
                  <span className="table-group-label">{section.label}</span>
                  <span className="table-group-count numeric">{list.length}</span>
                </button>
                <span className="pj-tsec-hint">{plural(list.length, "Kunde", "Kunden")} · {section.hint}</span>
              </div>
              {!collapsed && <TileGrid>{list.map(tile)}</TileGrid>}
            </section>
          );
        }) : <TileGrid>{tiles.map(tile)}</TileGrid>}
      </div>
    </div>
  );
}

/**
 * The tiles as a masonry: a grid of small rows in which every tile spans as many rows as it is high (measured, and again
 * whenever it changes), so the columns fill without gaps and the order still reads from left to right.
 */
function TileGrid({ children }: { children: React.ReactNode }) {
  const grid = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = grid.current;
    if (!element) return;
    const gap = parseFloat(getComputedStyle(element).columnGap) || 14;
    const fit = (tile: Element) => {
      if (tile instanceof HTMLElement) tile.style.gridRowEnd = `span ${Math.max(1, Math.ceil((tile.getBoundingClientRect().height + gap) / TILE_ROW))}`;
    };
    const tiles = [...element.children];
    tiles.forEach(fit);
    const observer = new ResizeObserver((entries) => entries.forEach((entry) => fit(entry.target)));
    tiles.forEach((tile) => observer.observe(tile));
    return () => observer.disconnect();
  });
  return <div ref={grid} className="pj-tgrid">{children}</div>;
}

/**
 * While a project's panel is open at the right edge, the tiles move aside (they would sit under it), so the open card
 * stays in sight. Where too little would be left beside the panel, it floats over the tiles as it does over the list.
 */
function useRoomForPanel(open: boolean, current: string | null) {
  const board = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = board.current;
    if (!element) return;
    const place = () => {
      const panel = open ? document.querySelector<HTMLElement>("aside.pj-panel") : null;
      const scroll = element.parentElement;
      let room = 0;
      if (panel && scroll && !window.matchMedia(phoneQuery).matches) {
        const area = scroll.getBoundingClientRect();
        room = Math.max(0, Math.round(area.right - panel.getBoundingClientRect().left + 14));
        if (area.width - room < 340) room = 0;
      }
      element.style.paddingRight = room ? `${room + 16}px` : "";
    };
    place();
    if (open && current) element.querySelector(`[data-project="${CSS.escape(current)}"]`)?.scrollIntoView({ block: "nearest" });
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, current]);
  return board;
}

/** One customer: the head opens it, „+“ starts a project there, then its open projects and the finished ones folded away. */
function Tile({ item, size, finished, asOf, current, busy, locked, lockHint, logo, unfolded, onFold, ...handlers }: Handlers & {
  item: ProjectTile;
  size: TileSize;
  finished: boolean;
  asOf: string;
  current: string | null;
  busy: string | null;
  locked: boolean;
  lockHint: string | null;
  logo: CustomerLogo | null;
  unfolded: boolean;
  onFold: () => void;
}) {
  const { entry, open, done } = item;
  const customer = entry.customer;
  const state = customerState(entry.projects);
  const cancelled = customer?.packages.find((pkg) => pkg.group === "service" && pkg.packageId && pkg.until);
  const pill = customer?.team ? <span className="chat-pill tone-info" data-tip="Projekte des oalab-Teams, für keinen Kunden sichtbar">{INTERNAL_TAG}</span>
    : state.pill === "risk" ? <span className="chat-pill tone-bad">Gefährdet</span>
    : state.pill === "feedback" ? <span className="chat-pill tone-todo" data-tip="Eine Aufgabe liegt beim Kunden">Feedback</span>
    : cancelled?.until ? <span className="chat-pill tone-todo" data-tip={`Service gekündigt zum ${formatDay(cancelled.until)}`}>Gekündigt</span>
    : null;
  // The number and the package that matters for projects (Service first); all packages are in the customer's pane.
  const pkg = customer?.packages.find((held) => held.group === "service" && held.packageId) ?? customer?.packages.find((held) => held.packageId);
  const sub = customer?.team ? "Interne Projekte" : customer ? [customer.customerNumber, pkg?.packageId ? packageCatalog[pkg.packageId].short : "noch kein Paket"].filter(Boolean).join(" · ") : "kein Kunde im Hub zugeordnet";
  const canCreate = Boolean(customer?.organizationId);
  const cards = finished ? done : open;
  const empty = !entry.projects.length
    ? customer?.team ? "Noch kein internes Projekt." : customer && !customer.organizationId ? "Noch nicht auf der Serviceplattform." : "Noch kein Projekt."
    : "Gerade läuft kein Projekt.";
  return (
    <article className="pj-tile" aria-label={entry.company}>
      <div className="pj-tile-head">
        <CustomerSign customer={{ id: entry.key, company: entry.company }} logo={logo} size={size === "small" ? "md" : undefined} />
        <span className="pj-tile-name">
          <span className="pj-tile-top">
            <button type="button" className="pj-tile-open" onClick={() => handlers.onCustomer(entry.key)} aria-label={`${entry.company} öffnen`}><strong>{entry.company}</strong></button>
            {pill}
          </span>
          <span className="pj-tile-sub">{sub}</span>
        </span>
        <span className="pj-tile-acts">
          {canCreate && (
            <button type="button" className="row-action pj-tile-add" onClick={() => handlers.onCreate(entry.key)} disabled={Boolean(lockHint)} aria-label={`Neues Projekt für ${entry.company}`}
              data-tip={lockHint ?? "Neues Projekt"} data-tip-sub={lockHint ? undefined : `für ${entry.company}`}><Plus size={16} aria-hidden="true" /></button>
          )}
          <button type="button" className="row-action" onClick={() => handlers.onCustomer(entry.key)} aria-label={`${entry.company} öffnen`} data-tip={`${entry.company} öffnen`} data-tip-sub="Domains, Service und alle Projekte"><ArrowUpRight size={16} aria-hidden="true" /></button>
        </span>
      </div>
      <div className="pj-tile-body">
        {cards.length ? (
          <div className="pj-tile-cards">
            {cards.map((project) => <Card key={project.id} project={project} size={size} asOf={asOf} current={current === project.id} busy={busy === project.id} locked={locked} onOpen={handlers.onOpen} onStatus={handlers.onStatus} />)}
          </div>
        ) : (
          <div className="pj-tile-empty">
            <span>{empty}</span>
            {canCreate && !entry.projects.length && <button type="button" className="table-add pj-tile-add" onClick={() => handlers.onCreate(entry.key)} disabled={Boolean(lockHint)} data-tip={lockHint ?? undefined}><Plus size={15} aria-hidden="true" />Projekt anlegen</button>}
          </div>
        )}
        {!finished && done.length > 0 && <>
          <button type="button" className="pj-fold" aria-expanded={unfolded} onClick={onFold}>
            <ChevronRight size={14} aria-hidden="true" /><StudioGlyph status="complete" size={13} /><span>{done.length} abgeschlossen</span>
          </button>
          {unfolded && (
            <div className="pj-done-list">
              {done.map((project) => (
                <button key={project.id} type="button" className={`pj-done-row${current === project.id ? " is-current" : ""}`} data-project={project.id} onClick={() => handlers.onOpen(project)} aria-label={`${project.name}: alle Angaben öffnen`}>
                  <StudioGlyph status="complete" size={13} /><span>{project.name}</span><small className="numeric">{project.dueOn ? shortDay.format(at(project.dueOn)) : ""}</small>
                </button>
              ))}
            </div>
          )}
        </>}
      </div>
    </article>
  );
}

/**
 * A project: the status as the card's colour and sign, the name (it opens the panel and stretches over the card), the
 * status pill, the next milestone, progress, time left and the domains. Small cards keep one line.
 */
function Card({ project, size, asOf, current, busy, locked, onOpen, onStatus }: {
  project: Project;
  size: TileSize;
  asOf: string;
  current: boolean;
  busy: boolean;
  locked: boolean;
  onOpen: (project: Project) => void;
  onStatus: (project: Project, status: StudioProjectStatus) => void;
}) {
  const status = statusOf(project);
  const className = `pj-card${size === "small" ? " is-sm" : size === "large" ? " is-lg" : ""}${status === "complete" ? " is-done" : ` has-veil veil-${status}`}${current ? " is-current" : ""}`;
  const name = <button type="button" className="pj-card-open pj-card-name" aria-label={`${project.name}: alle Angaben öffnen`}>{project.name}</button>;
  const marks = <>
    {isWaiting(project) && isRunning(status) && <span className="pj-card-mark is-turn" data-tip="Kunde am Zug" data-tip-sub="Eine Aufgabe liegt beim Kunden"><Hand size={14} aria-hidden="true" /></span>}
    {project.studio?.visible !== true && !project.internal && <span className="pj-card-mark" data-tip="Der Kunde sieht dieses Projekt noch nicht"><EyeOff size={13} aria-hidden="true" />intern</span>}
  </>;
  // The whole card opens the panel; the status field and the domains stop their clicks on their own.
  if (size === "small") {
    return (
      <div className={className} data-project={project.id} onClick={() => onOpen(project)}>
        <StudioGlyph status={status} />
        <span className="pj-card-titleline">{name}{marks}</span>
        <Due project={project} asOf={asOf} small />
        <span className="pj-card-pct numeric">{project.progressBasis === "none" ? "–" : `${project.progress} %`}</span>
      </div>
    );
  }
  return (
    <div className={className} data-project={project.id} onClick={() => onOpen(project)}>
      <div className="pj-card-top">
        <StudioGlyph status={status} />{name}{marks}<span className="pj-gap" />
        <StatusPick project={project} busy={busy} locked={locked} onChange={(next) => onStatus(project, next)} />
      </div>
      <div className="pj-card-line"><Flag size={12} aria-hidden="true" /><span>{milestoneLine(project, status, asOf)}</span></div>
      {size === "large" && <TimeLine project={project} timeline={projectTimeline(project, asOf)} asOf={asOf} />}
      <div className="pj-card-foot">
        {size === "large" ? <span className="pj-gap" /> : <span className="pj-card-progress"><ProgressCell project={project} /></span>}
        <Due project={project} asOf={asOf} />
        <span className="pj-card-links"><LinkButtons project={project} /></span>
      </div>
    </div>
  );
}

function milestoneLine(project: Project, status: StudioProjectStatus, asOf: string) {
  if (status === "complete") return project.dueOn ? `Fertig · Ziel war ${formatDeadline(project.dueOn)}` : "Fertig";
  const milestone = nextMilestone(project, asOf);
  if (milestone) return <><b>{milestone.title}</b> · {weekday.format(at(milestone.at.slice(0, 10)))}{milestone.kind === "feedback" ? " · vom Kunden" : ""}</>;
  return project.milestones.length ? "Alle Meilensteine erreicht" : "Noch kein Meilenstein";
}

/**
 * The target day on a card: the time left says more than the day, red once it has passed; the day is in the hint.
 * Small cards on a computer are narrow and show the day instead, phones the time left (glass.css shows one of the two).
 */
function Due({ project, asOf, small = false }: { project: Project; asOf: string; small?: boolean }) {
  const icon = small ? null : <Calendar size={13} aria-hidden="true" />;
  if (!project.dueOn) return <span className="pj-card-due">{icon}<span>{small ? "–" : "ohne Zieltermin"}</span></span>;
  if (statusOf(project) === "complete") return <span className="pj-card-due">{icon}<span className="numeric">{shortDay.format(at(project.dueOn))}</span></span>;
  const hint = deadlineHint(project.dueOn, false, asOf);
  const target = `Zieltermin ${formatDeadline(project.dueOn)}`;
  return (
    <span className={`pj-card-due${hint.endsWith("überfällig") ? " is-overdue" : ""}`} data-tip={small ? hint : target} data-tip-sub={small ? target : undefined}>
      {icon}
      {small ? <><span className="pj-due-day numeric">{dayMonth.format(at(project.dueOn))}</span><span className="pj-due-left">{hint}</span></> : <span>{hint}</span>}
    </span>
  );
}

/** The large card's time line: the done share over the time that has passed, with the milestones and today on it. */
function TimeLine({ project, timeline, asOf }: { project: Project; timeline: ProjectTimeline | null; asOf: string }) {
  const status = statusOf(project);
  const done = project.progressBasis === "none" ? null : project.progress;
  const doneRow = (
    <div className="pj-tl-row">
      <span>Erledigt</span>
      <span className="pj-tl-track" data-tip={done === null ? "Noch keine Aufgaben oder Anfragen" : progressBasis(project)}>{done !== null && <span className="pj-tl-fill is-done" style={{ width: `${done}%` }} />}</span>
      <b className="numeric">{done === null ? "–" : `${done} %`}</b>
    </div>
  );
  if (!timeline) {
    return <div className="pj-tl">{doneRow}<div className="pj-tl-row"><span>Zeit</span><span className="pj-tl-none">{project.dueOn ? "Ohne Startdatum" : "Ohne Zieltermin"}</span><b /></div></div>;
  }
  const label = status === "complete" ? "fertig" : timeline.over ? `+${timeline.over} T.` : `${Math.round(timeline.share)} %`;
  return (
    <div className="pj-tl">
      {doneRow}
      <div className="pj-tl-row">
        <span>Zeit</span>
        <span className="pj-tl-track">
          <span className={`pj-tl-fill is-time${timeline.over ? " is-over" : ""}`} style={{ width: `${timeline.share}%` }} />
          {timeline.marks.map((mark) => (
            <span key={`${mark.day}-${mark.title}`} className={`pj-tl-ms${mark.past ? " is-past" : ""}${mark.next ? " is-next" : ""}${mark.feedback ? " is-feedback" : ""}`} style={{ left: `${mark.at}%` }}
              data-tip={mark.title} data-tip-sub={`${weekday.format(at(mark.day))}${mark.feedback ? " · vom Kunden" : ""}`} />
          ))}
          {status !== "complete" && !timeline.over && <span className="pj-tl-today" style={{ left: `${timeline.share}%` }} data-tip="Heute" data-tip-sub={weekday.format(at(asOf))} />}
        </span>
        <b className={`numeric${timeline.over ? " is-over" : ""}`} data-tip={timeline.over ? `${plural(timeline.over, "Tag", "Tage")} über dem Zieltermin` : undefined}>{label}</b>
      </div>
      <div className="pj-tl-dates numeric"><span>{dayMonth.format(at(timeline.start))}</span><span>{dayMonth.format(at(timeline.due))}</span></div>
    </div>
  );
}
