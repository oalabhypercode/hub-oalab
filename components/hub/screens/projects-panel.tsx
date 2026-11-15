"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronLeft, CircleDot, FileText, Flag, FolderOpen, Globe, LayoutGrid, ListChecks, Pencil, Plus, Save, Search, Sparkles } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { categories } from "@/lib/categories";
import { formatDay } from "@/lib/hub-contracts/rules";
import { domainStatuses, isDomainStatus, type DomainStatus } from "@/lib/hub-domains/rules";
import { currentMilestone, deadlineHint, formatDeadline, hubHref, type Project, type ProjectTask } from "@/lib/hub-data";
import type { ProjectCustomer } from "@/lib/hub-projects/map";
import { restatesSite, shortUrl } from "@/lib/hub-projects/map";
import { saveProjectUrls } from "@/lib/hub-projects/actions";
import { SegmentedControl } from "../controls";
import { MiniProgress } from "../list";
import { Modal } from "../modal";
import { quickLinks } from "../project-links";
import { SheetFooter, SheetToolbar, StatusGlyph, TableGroup, useCollapsedGroups, type GlyphKind } from "../sheet";
import { useHubShell } from "../shell-context";
import { CopyButton, DomainDialog } from "./contracts-domains";
import { ADMIN_COLUMNS, tableHit, useContractAction } from "./contracts-parts";
import { CustomerSign } from "./customer-sign";
import { projectGlyph, ProjectTable } from "./projects-table";
import type { ScreenProps } from "./types";

/** One entry of the customer list: a hub customer (or, without one, the organization) with its projects. */
type Entry = { key: string; company: string; customer: ProjectCustomer | null; projects: Project[] };
type Show = "all" | "active" | "done";
type StateRow = { key: string; icon: React.ReactNode; title: React.ReactNode; sub: string; kind: React.ReactNode; date: string | null; text: string };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const entryKey = (project: Project) => project.customerId ?? project.organizationId ?? project.company ?? project.id;
const matchesShow = (show: Show, project: Project) => show === "all" || (show === "done") === (project.status === "Abgeschlossen");
const taskStatus: Record<ProjectTask["status"], { label: string; glyph: GlyphKind }> = {
  backlog: { label: "Backlog", glyph: "pending" },
  todo: { label: "Offen", glyph: "pending" },
  progress: { label: "In Arbeit", glyph: "progress" },
  review: { label: "In Prüfung", glyph: "invited" },
  done: { label: "Erledigt", glyph: "done" },
};
const domainGlyph: Record<DomainStatus, GlyphKind> = { active: "active", setup: "progress", transfer: "progress", cancelled: "pending", ended: "rejected" };
const isTyping = (element: Element | null) => Boolean(element?.closest("input, textarea, select, [contenteditable='true']"));

/**
 * „Projekte“ for admins, built like „Vertrag & Domain“: the customers with projects on the left (search, Alle · Aktiv
 * · Abgeschlossen, the overview table on top), the chosen customer's project on the right – its website first (live
 * and test address), then the customer's domains, where the project stands and its tasks. The URL holds the choice
 * (?customer=, ?project=), so links from the bell, the search, the calendar and the assistant open it here.
 */
export function ProjectsPanel({ projects, customers, asOf, preview, fileState }: ScreenProps & { customers: ProjectCustomer[] }) {
  const params = useSearchParams();
  const router = useRouter();
  const { manageUsers, askAboutProject } = useHubShell();
  const groups = useCollapsedGroups();
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [tabQuery, setTabQuery] = useState("");
  const [dialog, setDialog] = useState<"urls" | "domain" | null>(null);
  const [notice, setNotice] = useState("");

  const entries = useMemo<Entry[]>(() => {
    const byKey = new Map<string, Entry>();
    for (const project of projects) {
      const key = entryKey(project);
      const entry = byKey.get(key) ?? { key, company: project.company ?? "Ohne Kunde", customer: customers.find((item) => item.id === project.customerId) ?? null, projects: [] };
      entry.projects.push(project);
      byKey.set(key, entry);
    }
    return [...byKey.values()].sort((a, b) => a.company.localeCompare(b.company, "de"));
  }, [projects, customers]);
  const logos = useMemo(() => new Map(fileState.customers.flatMap((customer) => customer.logo ? [[customer.id, customer.logo] as const] : [])), [fileState.customers]);

  // The choice lives in the address: a project, or a customer (its first project).
  const linkedProject = projects.find((project) => project.id === params.get("project")) ?? null;
  const entry = linkedProject ? entries.find((item) => item.key === entryKey(linkedProject)) ?? null : entries.find((item) => item.key === params.get("customer")) ?? null;
  const project = entry ? linkedProject ?? entry.projects.find((item) => item.status !== "Abgeschlossen") ?? entry.projects[0] : null;
  const [paneOpen, setPaneOpen] = useState(Boolean(entry));

  function choose(next: { customer?: string; project?: string } | null) {
    const url = new URL(window.location.href);
    url.searchParams.delete("customer");
    url.searchParams.delete("project");
    if (next?.project) url.searchParams.set("project", next.project);
    else if (next?.customer) url.searchParams.set("customer", next.customer);
    // replaceState keeps the page as it is: no new request, the search params update in place.
    window.history.replaceState(null, "", url);
    setPaneOpen(true);
    setTabQuery("");
    setNotice("");
  }

  const term = query.trim().toLocaleLowerCase("de");
  const counts = { all: entries.length, active: entries.filter((item) => item.projects.some((p) => matchesShow("active", p))).length, done: entries.filter((item) => item.projects.some((p) => matchesShow("done", p))).length };
  const listed = entries
    .filter((item) => item.projects.some((p) => matchesShow(show, p)))
    .filter((item) => tableHit(term, item.company, item.customer?.customerNumber, item.customer?.website, ...item.projects.flatMap((p) => [p.name, p.liveUrl, p.testUrl]), ...(item.customer?.domains.map((domain) => domain.display) ?? [])));

  /* ---------- Customers ---------- */
  const list = (
    <div className="chat-list">
      <div className="chat-list-head"><h2>Kunden<span>{entries.length}</span></h2></div>
      <label className="chat-search"><Search size={15} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kunde, Projekt oder Adresse" aria-label="Kunden und Projekte durchsuchen" /></label>
      <div className="chat-filter" role="group" aria-label="Kunden zeigen">
        <button type="button" aria-pressed={show === "all"} onClick={() => setShow("all")}>Alle</button>
        <button type="button" aria-pressed={show === "active"} onClick={() => setShow("active")}>Aktiv{counts.active > 0 && <span>{counts.active}</span>}</button>
        <button type="button" aria-pressed={show === "done"} onClick={() => setShow("done")}>Abgeschlossen{counts.done > 0 && <span>{counts.done}</span>}</button>
      </div>
      <ul className="chat-convs" role="list">
        {!term && (
          <li>
            <button type="button" className="chat-conv" aria-current={!entry ? "true" : undefined} onClick={() => choose(null)}>
              <span className="am-tile pp-tile-icon"><LayoutGrid size={20} aria-hidden="true" /></span>
              <span className="chat-conv-main"><span className="chat-conv-top"><strong>Überblick</strong></span><span className="chat-conv-sub"><span className="chat-conv-last">Alle Projekte, Termine und Fortschritt</span></span></span>
            </button>
          </li>
        )}
        <li className="am-list-label">Kunden von A bis Z</li>
        {listed.map((item) => {
          const running = item.projects.filter((p) => p.status !== "Abgeschlossen");
          const waiting = item.projects.some((p) => p.status === "Dein Feedback");
          const sub = item.projects.length === 1 ? `${item.projects[0].name} · ${item.projects[0].progress} %` : `${plural(item.projects.length, "Projekt", "Projekte")} · ${running.length} laufen`;
          return (
            <li key={item.key}>
              <button type="button" className="chat-conv" aria-current={entry?.key === item.key ? "true" : undefined} onClick={() => choose({ customer: item.key })}>
                <CustomerSign customer={{ id: item.key, company: item.company }} logo={logos.get(item.key) ?? null} />
                <span className="chat-conv-main">
                  <span className="chat-conv-top"><strong>{item.company}</strong>{waiting && <span className="chat-pill tone-todo">Feedback</span>}</span>
                  <span className="chat-conv-sub"><span className="chat-conv-last">{sub}</span></span>
                </span>
              </button>
            </li>
          );
        })}
        {!listed.length && <li className="chat-empty">{term ? `Nichts passt zu „${query.trim()}“.` : "Keine Kunden für diesen Filter."}</li>}
      </ul>
    </div>
  );

  const back = <button type="button" className="chat-back" onClick={() => setPaneOpen(false)} aria-label="Zurück zu den Kunden"><ChevronLeft size={24} aria-hidden="true" /></button>;

  /* ---------- Overview ---------- */
  if (!entry || !project) {
    return (
      <div className="sheet section-first am pp" data-open={paneOpen ? "" : undefined}>
        <div className="am-grid">
          {list}
          <section className="am-pane" aria-label="Überblick">
            <header className="am-pane-head">
              {back}
              <span className="am-tile is-lg pp-tile-icon"><LayoutGrid size={22} aria-hidden="true" /></span>
              <div className="am-pane-title"><strong>Überblick</strong><span>{plural(projects.length, "Projekt", "Projekte")} · {plural(entries.length, "Kunde", "Kunden")}</span></div>
            </header>
            <ProjectTable projects={projects} admin asOf={asOf} preview={preview} onOpen={(next) => choose({ project: next.id })} scrollClass="am-scroll" />
          </section>
        </div>
      </div>
    );
  }

  /* ---------- One customer ---------- */
  const customer = entry.customer;
  const tabTerm = tabQuery.trim().toLocaleLowerCase("de");
  const jumps = quickLinks(project, preview, true).filter((link) => link.id !== "date");
  const live = project.liveUrl ?? null;
  const fallback = !live && customer?.website ? customer.website : null;
  const addresses = [
    live && { key: "live", url: live, label: "Live", tone: "live", sub: "Die fertige Website, öffentlich erreichbar" },
    fallback && { key: "customer", url: fallback, label: "Kundendaten", tone: "customer", sub: "Aus den Kundendaten, noch nicht als Live-Adresse des Projekts eingetragen" },
    project.testUrl && { key: "test", url: project.testUrl, label: "Test", tone: "test", sub: "Vorschau: jede Änderung erscheint zuerst hier" },
  ].filter((row): row is { key: string; url: string; label: string; tone: string; sub: string } => Boolean(row)).filter((row) => tableHit(tabTerm, row.url, row.label));
  const domains = (customer?.domains ?? []).filter((domain) => tableHit(tabTerm, domain.display, domain.domain));
  const tasks = (project.tasks ?? []).filter((task) => tableHit(tabTerm, task.title, taskStatus[task.status].label));
  const milestone = currentMilestone(project, asOf);
  const done = project.status === "Abgeschlossen";
  const finishedTasks = (project.tasks ?? []).filter((task) => task.status === "done").length;
  const basis = project.progressBasis === "tasks" ? `${finishedTasks} von ${plural(project.tasks?.length ?? 0, "Aufgabe", "Aufgaben")} erledigt`
    : project.progressBasis === "requests" ? `${project.requests?.done ?? 0} von ${(project.requests?.done ?? 0) + (project.requests?.open ?? 0)} Anfragen erledigt`
    : "Noch keine Aufgaben oder Anfragen";
  const stateRows = ([
    { key: "progress", icon: <FolderOpen size={16} aria-hidden="true" />, title: <span className="pp-progress"><MiniProgress value={project.progress} color={categories.projects.fill} /><b className="numeric">{project.progress} %</b></span>, sub: basis, kind: <span className="status-cell"><StatusGlyph kind={projectGlyph[project.status]} />{project.status}</span>, date: null, text: `${project.progress} ${basis} ${project.status}` },
    { key: "due", icon: <CalendarDays size={16} aria-hidden="true" />, title: project.dueOn ? <Link className="pp-inline-link" href={`${hubHref(preview, "calendar")}?day=${project.dueOn}`}>{formatDeadline(project.dueOn)}</Link> : "Kein Zieltermin", sub: project.startedOn ? `Start ${formatDeadline(project.startedOn)}` : "Zeitraum im Studio festlegen", kind: <span className="file-dot pp-dot-customer"><i aria-hidden="true" />Ziel</span>, date: project.dueOn && !done ? deadlineHint(project.dueOn, done, asOf) : null, text: `${formatDeadline(project.dueOn)} ziel termin start` },
    milestone && { key: "milestone", icon: <Flag size={16} aria-hidden="true" />, title: milestone.title, sub: milestone.description || `am ${formatDeadline(milestone.at)}`, kind: <span className="file-dot pp-dot-customer"><i aria-hidden="true" />Meilenstein</span>, date: formatDeadline(milestone.at), text: `${milestone.title} meilenstein` },
    project.description && !restatesSite(project.description, [live, fallback, project.testUrl]) && { key: "about", icon: <FileText size={16} aria-hidden="true" />, title: "Worum es geht", sub: project.description, kind: null, date: null, text: project.description },
  ] as (StateRow | false | "" | null | undefined)[]).filter((row): row is StateRow => Boolean(row)).filter((row) => tableHit(tabTerm, row.text));

  const head = (
    <header className="am-pane-head">
      {back}
      <CustomerSign customer={{ id: entry.key, company: entry.company }} logo={logos.get(entry.key) ?? null} size="lg" />
      <div className="am-pane-title"><strong>{entry.company}</strong><span>{[customer?.customerNumber, plural(entry.projects.length, "Projekt", "Projekte"), customer ? "" : "kein Kunde im Hub zugeordnet"].filter(Boolean).join(" · ")}</span></div>
      <PaneJumps links={jumps} />
    </header>
  );

  return (
    <>
      {notice && <p className="calendar-notice section-first" role="status"><Check size={18} aria-hidden="true" />{notice}</p>}
      <div className="sheet section-first am pp" data-open={paneOpen ? "" : undefined}>
        <div className="am-grid">
          {list}
          <section className="am-pane" aria-label={`${entry.company}: ${project.name}`}>
            {head}
            <SheetToolbar
              leading={<SegmentedControl label="Projekt" value={project.id} onChange={(id) => choose({ project: id })} options={entry.projects.map((item) => ({ id: item.id, label: item.name, name: `${item.name}, ${item.status}` }))} />}
              query={tabQuery}
              onQuery={setTabQuery}
              placeholder="Suchen …"
              label={`In ${project.name} suchen`}
              trailing={manageUsers && <button type="button" className="sheet-action" onClick={() => askAboutProject({ id: project.id, name: project.name })}><Sparkles size={15} aria-hidden="true" />Assistent</button>}
            />
            <div className="am-scroll">
              <table className="file-table cdm-table cdm-admin-table pp-table">
                <caption className="visually-hidden">Website, Domains, Stand und Aufgaben von {project.name}</caption>
                <TableGroup
                  colSpan={ADMIN_COLUMNS}
                  label="Website"
                  count={addresses.length}
                  glyph={<Globe size={16} aria-hidden="true" />}
                  collapsed={groups.isCollapsed("website")}
                  onToggle={() => groups.toggle("website")}
                  actions={<button type="button" className="table-group-action is-accent" onClick={() => setDialog("urls")} data-tip={live || project.testUrl ? "Adressen bearbeiten" : "Adressen eintragen"} aria-label={live || project.testUrl ? "Adressen bearbeiten" : "Adressen eintragen"}>{live || project.testUrl ? <Pencil size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}</button>}
                  empty={tabTerm ? "Keine Adresse passt zur Suche." : "Noch keine Live- oder Test-Adresse. Über ＋ eintragen; sie gilt dann auch im Studio und für den Kunden."}
                >
                  {addresses.map((row) => (
                    <tr key={row.key} className="file-row">
                      <td className="cell-file">
                        <a className="am-file pp-url" href={row.url} target="_blank" rel="noopener noreferrer" data-tip={row.url}>
                          <span className={`am-file-icon cdm-file-icon pp-icon-${row.tone}`}><Globe size={16} aria-hidden="true" /></span>
                          <span className="am-file-text"><strong>{shortUrl(row.url)}</strong><small>{row.sub}</small></span>
                        </a>
                      </td>
                      <td className="cell-category"><span className={`file-dot pp-dot-${row.tone}`}><i aria-hidden="true" />{row.label}</span></td>
                      <td className="cell-date">{row.key === "customer" && <AdoptButton project={project} url={row.url} onSaved={setNotice} />}</td>
                      <td className="cell-action">
                        <CopyButton value={row.url} label="Adresse" />
                        <a className="am-icon-btn is-accent" href={row.url} target="_blank" rel="noopener noreferrer" aria-label={`${shortUrl(row.url)} öffnen (neuer Tab)`} data-tip="Im neuen Tab öffnen"><ArrowUpRight size={16} aria-hidden="true" /></a>
                      </td>
                    </tr>
                  ))}
                </TableGroup>
                <TableGroup
                  colSpan={ADMIN_COLUMNS}
                  label="Domains"
                  count={domains.length}
                  glyph={<CircleDot size={16} aria-hidden="true" />}
                  collapsed={groups.isCollapsed("domains")}
                  onToggle={() => groups.toggle("domains")}
                  actions={customer && <button type="button" className="table-group-action is-accent" onClick={() => setDialog("domain")} data-tip="Domain eintragen" aria-label="Domain eintragen"><Plus size={15} aria-hidden="true" /></button>}
                  empty={!customer ? "Diesem Projekt ist kein Kunde im Hub zugeordnet; Domains gehören zum Kunden." : tabTerm ? "Keine Domain passt zur Suche." : "Noch keine Domain eingetragen. Über ＋ eintragen; sie erscheint auch unter Vertrag & Domain."}
                >
                  {domains.map((domain) => {
                    const status = isDomainStatus(domain.status) ? domain.status : "active";
                    return (
                      <tr key={domain.id} className="file-row">
                        <td className="cell-file">
                          <Link className="am-file" href={`${hubHref(preview, "contracts")}?customer=${encodeURIComponent(customer!.id)}&tab=domains`} data-tip="In Vertrag & Domain öffnen">
                            <span className="am-file-icon cdm-file-icon is-domain"><CircleDot size={16} aria-hidden="true" /></span>
                            <span className="am-file-text"><strong>{domain.display}</strong><small>Anbieter, Mail und Prüfungen unter Vertrag & Domain</small></span>
                          </Link>
                        </td>
                        <td className="cell-category"><span className="status-cell"><StatusGlyph kind={domainGlyph[status]} />{domainStatuses[status].label}</span></td>
                        <td className="cell-date numeric">{domain.renewsOn && <time dateTime={domain.renewsOn}>{formatDay(domain.renewsOn)}</time>}</td>
                        <td className="cell-action">
                          <a className="am-icon-btn is-accent" href={`https://${domain.domain}`} target="_blank" rel="noopener noreferrer" aria-label={`${domain.display} öffnen (neuer Tab)`} data-tip="Im neuen Tab öffnen"><ArrowUpRight size={16} aria-hidden="true" /></a>
                        </td>
                      </tr>
                    );
                  })}
                </TableGroup>
                <TableGroup
                  colSpan={ADMIN_COLUMNS}
                  label="Stand"
                  count={stateRows.length}
                  glyph={<StatusGlyph kind={projectGlyph[project.status]} />}
                  collapsed={groups.isCollapsed("state")}
                  onToggle={() => groups.toggle("state")}
                  empty="Nichts passt zur Suche."
                >
                  {stateRows.map((row) => (
                    <tr key={row.key} className={`file-row${row.key === "about" ? " pp-about" : ""}`}>
                      <td className="cell-file" colSpan={row.key === "about" ? ADMIN_COLUMNS : undefined}>
                        <span className="am-file"><span className="am-file-icon cdm-file-icon pp-icon-state">{row.icon}</span><span className="am-file-text"><strong>{row.title}</strong><small>{row.sub}</small></span></span>
                      </td>
                      {row.key !== "about" && <>
                        <td className="cell-category">{row.kind}</td>
                        <td className="cell-date numeric">{row.date && <small className={row.date.endsWith("überfällig") ? "is-overdue" : undefined}>{row.date}</small>}</td>
                        <td className="cell-action">{row.key === "due" && project.dueOn && <Link className="am-icon-btn" href={`${hubHref(preview, "calendar")}?day=${project.dueOn}`} aria-label="Im Kalender zeigen" data-tip="Im Kalender zeigen"><ArrowRight size={16} aria-hidden="true" /></Link>}</td>
                      </>}
                    </tr>
                  ))}
                </TableGroup>
                <TableGroup
                  colSpan={ADMIN_COLUMNS}
                  label="Aufgaben"
                  count={tasks.length}
                  glyph={<ListChecks size={16} aria-hidden="true" />}
                  collapsed={groups.isCollapsed("tasks")}
                  onToggle={() => groups.toggle("tasks")}
                  actions={manageUsers && <button type="button" className="table-group-action" onClick={() => askAboutProject({ id: project.id, name: project.name })} data-tip="Aufgaben mit dem Assistenten planen" aria-label="Aufgaben mit dem Assistenten planen"><Sparkles size={15} aria-hidden="true" /></button>}
                  empty={tabTerm ? "Keine Aufgabe passt zur Suche." : "Noch keine Aufgaben. Der Assistent schlägt welche vor, angelegt werden sie im Studio."}
                >
                  {tasks.map((task) => (
                    <tr key={task.id} className={`file-row${task.status === "done" ? " is-done" : ""}`}>
                      <td className="cell-file">
                        <span className="am-file"><span className="am-file-icon cdm-file-icon pp-icon-task"><ListChecks size={16} aria-hidden="true" /></span>
                          <span className="am-file-text"><strong>{task.title}</strong><small>{[`#${task.number}`, task.customer ? "Kunde ist dran" : "oalab", task.visible ? "" : "intern"].filter(Boolean).join(" · ")}</small></span>
                        </span>
                      </td>
                      <td className="cell-category"><span className="status-cell"><StatusGlyph kind={taskStatus[task.status].glyph} />{taskStatus[task.status].label}</span></td>
                      <td className="cell-date numeric">{task.dueOn && <time dateTime={task.dueOn}>{formatDeadline(task.dueOn)}</time>}</td>
                      <td className="cell-action" />
                    </tr>
                  ))}
                </TableGroup>
              </table>
            </div>
            <SheetFooter hint="Adressen gelten auch im Studio und für den Kunden">
              {[plural(addresses.length, "Adresse", "Adressen"), plural(customer?.domains.length ?? 0, "Domain", "Domains"), plural(project.tasks?.length ?? 0, "Aufgabe", "Aufgaben")].join(" · ")}
            </SheetFooter>
          </section>
        </div>
      </div>
      {dialog === "urls" && <UrlDialog project={project} suggestion={fallback} onClose={() => setDialog(null)} onSaved={(message) => { setNotice(message); setDialog(null); }} />}
      {dialog === "domain" && customer && <DomainDialog customer={{ id: customer.id, company: customer.company, customerNumber: customer.customerNumber, logo: null, packages: [] }} onClose={() => setDialog(null)} onSaved={(message) => { setNotice(message); router.refresh(); }} />}
    </>
  );
}

/** Jumps to everything around the customer, as quiet icons in the pane's head; digits 1–5 open them too. */
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

/** The customer data hold a website the project does not know yet: one click makes it the project's live address. */
function AdoptButton({ project, url, onSaved }: { project: Project; url: string; onSaved: (message: string) => void }) {
  const { busy, error, run } = useContractAction();
  return (
    <button type="button" className="pp-adopt" disabled={busy !== null} data-tip={error || "Als Live-Adresse des Projekts eintragen"}
      onClick={() => run("adopt", () => saveProjectUrls({ projectId: project.id, liveUrl: url, testUrl: project.testUrl ?? "" }), () => onSaved("Live-Adresse eingetragen."))}>
      {busy ? <MiniLoader size={14} /> : <Check size={14} aria-hidden="true" />}Als Live übernehmen
    </button>
  );
}

/** Live and test address of a project; both count in Studio and for the customer as well. */
function UrlDialog({ project, suggestion, onClose, onSaved }: { project: Project; suggestion: string | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [draft, setDraft] = useState({ live: project.liveUrl ?? suggestion ?? "", test: project.testUrl ?? "" });
  const { busy, error, run } = useContractAction();
  const disabled = busy !== null;
  return (
    <Modal title="Adressen der Website" onClose={onClose} className="users-modal">
      <form className="cdm-dialog" onSubmit={(event) => {
        event.preventDefault();
        run("save", () => saveProjectUrls({ projectId: project.id, liveUrl: draft.live, testUrl: draft.test }), () => onSaved("Adressen gespeichert."));
      }}>
        <p className="field-hint">{project.company ? `${project.company} · ` : ""}{project.name}</p>
        <div className="upload-fields">
          <label className="upload-field upload-field-wide"><span>Live-Adresse</span><input value={draft.live} onChange={(event) => setDraft({ ...draft, live: event.target.value })} placeholder="kunde.de" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url" maxLength={2048} disabled={disabled} autoFocus /></label>
          <label className="upload-field upload-field-wide"><span>Test-Adresse</span><input value={draft.test} onChange={(event) => setDraft({ ...draft, test: event.target.value })} placeholder="kunde-git-test.vercel.app" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url" maxLength={2048} disabled={disabled} /></label>
        </div>
        <p className="field-hint">Live ist die fertige Website, Test die Vorschau, auf der jede Änderung zuerst erscheint. Beide gelten auch im Studio, und der Kunde sieht sie in seinem Projekt. Ein leeres Feld entfernt die Adresse.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="sheet-button sheet-button-primary" disabled={disabled}>{busy ? <MiniLoader size={16} /> : <Save size={18} aria-hidden="true" />}Speichern</button>
      </form>
    </Modal>
  );
}
