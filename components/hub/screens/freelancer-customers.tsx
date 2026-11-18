"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight, ArrowUpRight, AtSign, Building2, ChevronLeft, Contact, Eye, Files, FolderOpen, Forward, Globe, Inbox, Layers, LayoutGrid, LockKeyhole, Mail, MessageSquare,
  Package, Search, Send, Server, SquareKanban, StickyNote, UserRound, type LucideIcon,
} from "lucide-react";
import { hubHref } from "@/lib/hub-data";
import { domainCheckIds, domainChecks, domainStatuses, mailboxKinds, mailSecurities } from "@/lib/hub-domains/rules";
import { freelancerCustomerFixtures, freelancerProjectFixtures } from "@/lib/hub-freelancer-customers/fixtures";
import { hostingOf, releasedAreas, releasedCount, shareAreas, type HostingRow } from "@/lib/hub-freelancer-customers/rules";
import type { FreelancerCustomerCard, FreelancerCustomersState } from "@/lib/hub-freelancer-customers/types";
import type { CustomerLogo } from "@/lib/hub-logos/rules";
import type { TaskBoardState } from "@/lib/hub-tasks/types";
import { packageCatalog } from "@/lib/service-packages";
import { HeaderActions } from "../app-shell";
import { GlassCard, TitleIcon } from "../glass";
import { SegmentedControl } from "../controls";
import { useInfo } from "../info-box";
import { LargeTitleHeader } from "../large-title-header";
import { SheetFooter, SheetToolbar, StatusGlyph, TableGroup, useCollapsedGroups, type GlyphKind } from "../sheet";
import { CopyButton } from "./contracts-domains";
import { CustomerSign } from "./customer-sign";
import type { ScreenProps } from "./types";

/*
 * „Kunden“ for freelancers (approved preview of 18.11.2026): like every page „je Kunde“ the list on the left and the
 * customer on the right, with two tabs. „Überblick“ shows what a freelancer always sees: the website and where it runs
 * (once released), oalab's note, their projects from the task board and their files. „Vertrag & Domain“ shows, read only,
 * exactly what oalab released for this freelancer: hosting, domains, addresses, mail server, packages, contact data.
 * Passwords never come here; they stay with the oalab team.
 */

type Tab = "info" | "vd";
type ProjectLine = { id: string; name: string; glyph: GlyphKind; status: string; open: number; nextDue: string | null };
const COLS = 4;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const dayFormat = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "numeric", month: "short", year: "numeric" });
const shortDay = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "numeric", month: "short" });
const numericDay = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
const formatInstant = (value: string | null) => (value && !Number.isNaN(Date.parse(value)) ? dayFormat.format(new Date(value)) : "");
const formatShort = (value: string | null) => (value && !Number.isNaN(Date.parse(value)) ? shortDay.format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value)) : "");
const formatIsoDay = (value: string | null) => (value ? numericDay.format(new Date(`${value}T00:00:00Z`)) : "");
const projectStatus: Record<string, { glyph: GlyphKind; label: string }> = {
  planning: { glyph: "invited", label: "Planung" },
  active: { glyph: "progress", label: "In Arbeit" },
  risk: { glyph: "pending", label: "Gefährdet" },
  hold: { glyph: "pending", label: "Pausiert" },
  complete: { glyph: "done", label: "Abgeschlossen" },
};
const statusGlyph: Record<string, GlyphKind> = { active: "active", setup: "pending", transfer: "invited", cancelled: "pending", ended: "disabled" };
const hostingIcons: Record<HostingRow["kind"], LucideIcon> = { website: Server, registrar: Globe, dns: Layers, mail: Mail };
const hostingKinds: Record<HostingRow["kind"], { label: string; dot: string }> = {
  website: { label: "Website", dot: "cdm-dot-domain" }, registrar: { label: "Domains", dot: "cdm-dot-off" }, dns: { label: "DNS", dot: "cdm-dot-off" }, mail: { label: "E-Mail", dot: "cdm-dot-mailbox" },
};

function Row({ icon: Icon, title, sub, category, date, action, domain = false }: { icon: LucideIcon; title: React.ReactNode; sub?: React.ReactNode; category?: React.ReactNode; date?: React.ReactNode; action?: React.ReactNode; domain?: boolean }) {
  return (
    <tr className="file-row">
      <td className="cell-file"><span className="am-file"><span className={`am-file-icon cdm-file-icon${domain ? " is-domain" : ""}`}><Icon size={16} aria-hidden="true" /></span><span className="am-file-text"><strong>{title}</strong>{sub && <small>{sub}</small>}</span></span></td>
      <td className="cell-category">{category}</td>
      <td className="cell-date">{date}</td>
      <td className="cell-action">{action}</td>
    </tr>
  );
}
const Dot = ({ className, children }: { className: string; children: React.ReactNode }) => <span className={`file-dot ${className}`}><i aria-hidden="true" />{children}</span>;
const Status = ({ kind, children }: { kind: GlyphKind; children: React.ReactNode }) => <span className="status-cell"><StatusGlyph kind={kind} />{children}</span>;
const OpenLink = ({ href, label }: { href: string; label: string }) => <a className="am-icon-btn is-accent" href={href} target="_blank" rel="noopener noreferrer" aria-label={`${label} (neuer Tab)`} data-tip={label}><ArrowUpRight size={16} aria-hidden="true" /></a>;

function Checks({ checks }: { checks: Record<(typeof domainCheckIds)[number], boolean> }) {
  const done = domainCheckIds.filter((id) => checks[id]).length;
  return (
    <span className="cdm-checks" aria-label={`${done} von ${domainCheckIds.length} Prüfungen erledigt`} data-tip={domainCheckIds.map((id) => `${domainChecks[id].label}: ${checks[id] ? "erledigt" : "offen"}`).join("\n")}>
      {domainCheckIds.map((id) => <i key={id} className={checks[id] ? "is-ok" : undefined} aria-hidden="true" />)}
      <b className="numeric" aria-hidden="true">{done}/{domainCheckIds.length}</b>
    </span>
  );
}

export function FreelancerCustomersScreen({ state, board, fileState, preview }: ScreenProps & { state?: FreelancerCustomersState; board?: TaskBoardState }) {
  const data = useMemo(() => state ?? freelancerCustomerFixtures(), [state]);
  const { cards } = data;
  const params = useSearchParams();
  const [selected, setSelected] = useState<string | null>(() => cards.some((card) => card.customerId === params.get("customer")) ? params.get("customer") : null);
  const [paneOpen, setPaneOpen] = useState(() => Boolean(params.get("customer")));
  const [tab, setTab] = useState<Tab>(() => (params.get("tab") === "vd" ? "vd" : "info"));
  const [listQuery, setListQuery] = useState("");
  const [query, setQuery] = useState("");
  const groups = useCollapsedGroups();
  const vdInfo = useInfo("Vertrag & Domain", {
    steps: [
      <><b>Freigegeben</b> hat oalab, je Kunde und Bereich.</>,
      <><b>Nur lesen:</b> Ändern geht über das oalab-Team.</>,
      <><b>Passwörter</b> stehen hier nie.</>,
    ],
    ask: "Was sehe ich als Freelancer unter Kunden › Vertrag & Domain?",
  });

  // The choice stays in the address (links from the bell, the search and the assistant land there).
  useEffect(() => {
    const next = new URLSearchParams();
    if (selected) next.set("customer", selected);
    if (selected && tab === "vd") next.set("tab", "vd");
    const text = next.toString();
    const url = `${window.location.pathname}${text ? `?${text}` : ""}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", url);
  }, [selected, tab]);

  const logos = useMemo(() => new Map(fileState.customers.flatMap((customer): [string, CustomerLogo][] => (customer.logo ? [[customer.id, customer.logo]] : []))), [fileState.customers]);
  // Their projects from the task board, by the customer's Service organization (or, without one, by the company's name).
  const projectsOf = useMemo(() => (card: FreelancerCustomerCard): ProjectLine[] => {
    if (data.source === "fixtures") return (freelancerProjectFixtures[card.customerId] ?? []).map((project) => ({ ...project, glyph: projectStatus[project.status]?.glyph ?? "invited", status: projectStatus[project.status]?.label ?? "Offen" }));
    if (!board || board.error) return [];
    return board.projects.filter((project) => (card.organizationId ? project.organizationId === card.organizationId : project.company.toLocaleLowerCase("de") === card.company.toLocaleLowerCase("de"))).map((project) => {
      const open = board.tasks.filter((task) => task.projectId === project.id && task.status !== "done");
      const nextDue = open.map((task) => task.dueOn).filter((day): day is string => Boolean(day)).sort()[0] ?? null;
      return { id: project.id, name: project.name, glyph: projectStatus[project.status]?.glyph ?? "invited", status: projectStatus[project.status]?.label ?? "Offen", open: open.length, nextDue };
    });
  }, [board, data.source]);
  const filesOf = (card: FreelancerCustomerCard) => fileState.files.filter((file) => file.customers.some((customer) => customer.id === card.customerId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const openTasks = (card: FreelancerCustomerCard) => projectsOf(card).reduce((sum, project) => sum + project.open, 0);

  const current = selected ? cards.find((card) => card.customerId === selected) ?? null : null;
  const term = listQuery.trim().toLocaleLowerCase("de");
  const listed = cards.filter((card) => !term || [card.company, card.customerNumber, ...(card.domains ?? []).map((domain) => domain.display), ...projectsOf(card).map((project) => project.name)]
    .some((value) => value.toLocaleLowerCase("de").includes(term)));
  const choose = (id: string | null) => { setSelected(id); setPaneOpen(true); setQuery(""); };
  const boardHref = `${hubHref(preview, "projects")}/tasks`;
  const filesHref = hubHref(preview, "files");
  const chatHref = hubHref(preview, "messages");

  /* ---------- The list on the left ---------- */
  const list = (
    <div className="chat-list">
      <div className="chat-list-head"><h2>Kunden<span>{cards.length}</span></h2></div>
      <label className="chat-search"><Search size={15} aria-hidden="true" /><input type="search" value={listQuery} onChange={(event) => setListQuery(event.target.value)} placeholder="Kunde, Domain oder Projekt" aria-label="Kunden durchsuchen" /></label>
      <ul className="chat-convs" role="list">
        {!term && (
          <li>
            <button type="button" className="chat-conv" aria-current={current ? undefined : "true"} onClick={() => choose(null)}>
              <span className="am-tile fc-tile"><LayoutGrid size={20} aria-hidden="true" /></span>
              <span className="chat-conv-main"><span className="chat-conv-top"><strong>Überblick</strong></span><span className="chat-conv-sub"><span className="chat-conv-last">Alle deine Kunden auf einen Blick</span></span></span>
            </button>
          </li>
        )}
        <li className="am-list-label">Kunden von A bis Z</li>
        {listed.map((card) => {
          const open = openTasks(card);
          return (
            <li key={card.customerId}>
              <button type="button" className="chat-conv" aria-current={current?.customerId === card.customerId ? "true" : undefined} onClick={() => choose(card.customerId)}>
                <CustomerSign customer={{ id: card.customerId, company: card.company }} logo={logos.get(card.customerId) ?? null} />
                <span className="chat-conv-main">
                  <span className="chat-conv-top"><strong>{card.company}</strong></span>
                  <span className="chat-conv-sub"><span className="chat-conv-last">{card.customerNumber} · {open ? plural(open, "offene Aufgabe", "offene Aufgaben") : "keine offenen Aufgaben"}</span></span>
                </span>
              </button>
            </li>
          );
        })}
        {!listed.length && <li className="chat-empty">{term ? `Kein Kunde passt zu „${listQuery.trim()}“.` : "Dir ist noch kein Kunde zugeordnet. Das oalab-Team trägt dich bei den Kunden ein, die du betreust."}</li>}
      </ul>
    </div>
  );

  /* ---------- Überblick of all customers ---------- */
  const back = <button type="button" className="chat-back" onClick={() => setPaneOpen(false)} aria-label="Zurück zu den Kunden"><ChevronLeft size={24} aria-hidden="true" /></button>;
  const allOpen = cards.reduce((sum, card) => sum + openTasks(card), 0);
  const overviewTerm = query.trim().toLocaleLowerCase("de");
  const overviewRows = cards.filter((card) => !overviewTerm || [card.company, card.customerNumber, ...(card.domains ?? []).map((domain) => domain.display)].some((value) => value.toLocaleLowerCase("de").includes(overviewTerm)));
  const overview = (
    <section className="am-pane" aria-label="Überblick">
      <header className="am-pane-head">
        {back}
        <span className="am-tile is-lg fc-tile"><LayoutGrid size={22} aria-hidden="true" /></span>
        <div className="am-pane-title"><strong>Überblick</strong><span>{plural(cards.length, "Kunde", "Kunden")} · {plural(allOpen, "offene Aufgabe", "offene Aufgaben")}</span></div>
      </header>
      <SheetToolbar query={query} onQuery={setQuery} placeholder="Kunde oder Domain" label="Im Überblick suchen" />
      <div className="am-scroll">
        <table className="file-table cdm-table cdm-admin-table">
          <caption className="visually-hidden">Deine Kunden</caption>
          <TableGroup colSpan={COLS} label="Deine Kunden" count={overviewRows.length} glyph={<Building2 size={16} aria-hidden="true" />} collapsed={groups.isCollapsed("all")} onToggle={() => groups.toggle("all")}
            empty={overviewTerm ? "Kein Kunde passt zur Suche." : "Dir ist noch kein Kunde zugeordnet."}>
            {overviewRows.map((card) => {
              const site = card.domains?.find((domain) => domain.websiteHost) ?? card.domains?.[0];
              return (
                <tr key={card.customerId} className="file-row">
                  <td className="cell-file"><span className="am-file"><CustomerSign customer={{ id: card.customerId, company: card.company }} logo={logos.get(card.customerId) ?? null} size="sm" /><span className="am-file-text"><strong>{card.company}</strong><small>{card.customerNumber}{card.assignedAt ? ` · betreut seit ${formatInstant(card.assignedAt)}` : ""}</small></span></span></td>
                  <td className="cell-category">{site ? <Dot className="cdm-dot-domain">{site.display}</Dot> : <span className="fc-muted">nicht freigegeben</span>}</td>
                  <td className="cell-date">{site?.websiteHost ? `Website bei ${site.websiteHost}` : ""}</td>
                  <td className="cell-action"><button type="button" className="cdm-row-link" onClick={() => choose(card.customerId)}>Öffnen<ArrowRight size={14} aria-hidden="true" /></button></td>
                </tr>
              );
            })}
          </TableGroup>
        </table>
      </div>
      <SheetFooter hint="Was du je Kunde siehst, gibt oalab frei.">{plural(cards.length, "Kunde", "Kunden")}</SheetFooter>
    </section>
  );

  /* ---------- One customer ---------- */
  let pane = overview;
  if (current) {
    const count = data.ready ? releasedCount(current) : 0;
    const projects = projectsOf(current);
    const files = filesOf(current);
    const released = releasedAreas(current.shares);
    const site = current.domains?.find((domain) => domain.websiteHost) ?? current.domains?.[0];
    const g = (key: string) => `${current.customerId}-${key}`;
    const info = (
      <div className="am-scroll">
        <table className="file-table cdm-table cdm-admin-table">
          <caption className="visually-hidden">Überblick zu {current.company}</caption>
          <TableGroup colSpan={COLS} label="Auf einen Blick" count={2 + (current.packages?.length ? 1 : 0)} glyph={<Building2 size={16} aria-hidden="true" />} collapsed={groups.isCollapsed(g("glance"))} onToggle={() => groups.toggle(g("glance"))}>
            {site
              ? <Row icon={Globe} domain title={site.display} sub={site.websiteHost ? `läuft bei ${site.websiteHost}` : "Website"} category={<Dot className="cdm-dot-domain">Website</Dot>} date={<Status kind={statusGlyph[site.status] ?? "active"}>{domainStatuses[site.status].label}</Status>} action={<OpenLink href={`https://${site.domain}`} label="Website öffnen" />} />
              : <Row icon={Globe} domain title="Website und Hosting" sub="Noch nicht freigegeben" category={<Dot className="cdm-dot-off">Website</Dot>} />}
            {current.packages && current.packages.length > 0 && (
              <Row icon={Package} title={current.packages.map((item) => packageCatalog[item.packageId].short).join(" · ")} sub="Pakete bei oalab" category={<Dot className="cdm-dot-service">Pakete</Dot>}
                date={current.packages[0].since ? <span className="numeric">seit {formatIsoDay(current.packages[0].since)}</span> : null} />
            )}
            <Row icon={UserRound} title={current.assignedAt ? `Betreut von dir seit ${formatInstant(current.assignedAt)}` : "Von dir betreut"} sub={`${current.customerNumber} · zugeordnet vom oalab-Team`} category={<Dot className="cdm-dot-off">Zuordnung</Dot>} />
          </TableGroup>
          <TableGroup colSpan={COLS} label="Hinweise von oalab" count={current.note ? 1 : 0} glyph={<StickyNote size={16} aria-hidden="true" />} collapsed={groups.isCollapsed(g("note"))} onToggle={() => groups.toggle(g("note"))} empty="Noch keine Hinweise vom oalab-Team.">
            <tr className="file-row"><td className="fc-note-cell" colSpan={COLS}><p className="fc-note">{current.note}</p>{current.noteUpdatedAt && <span className="fc-note-meta">Stand {formatInstant(current.noteUpdatedAt)} · vom oalab-Team</span>}</td></tr>
          </TableGroup>
          <TableGroup colSpan={COLS} label="Deine Projekte" count={projects.length} glyph={<FolderOpen size={16} aria-hidden="true" />} collapsed={groups.isCollapsed(g("projects"))} onToggle={() => groups.toggle(g("projects"))}
            empty={board?.error ? "Die Projekte konnten gerade nicht geladen werden." : "Bei diesem Kunden bist du noch in keinem Projekt eingetragen."}>
            {projects.map((project) => (
              <Row key={project.id} icon={SquareKanban} title={project.name} sub={project.nextDue ? `nächste Aufgabe fällig ${formatShort(project.nextDue)}` : "keine Aufgabe mit Datum"}
                category={<Status kind={project.glyph}>{project.status}</Status>} date={project.open ? plural(project.open, "offene Aufgabe", "offene Aufgaben") : "nichts offen"}
                action={<Link className="cdm-row-link" href={`${boardHref}?project=${encodeURIComponent(project.id)}`}>Zum Board<ArrowRight size={14} aria-hidden="true" /></Link>} />
            ))}
          </TableGroup>
          <TableGroup colSpan={COLS} label="Dateien" count={files.length} glyph={<Files size={16} aria-hidden="true" />} collapsed={groups.isCollapsed(g("files"))} onToggle={() => groups.toggle(g("files"))} empty="oalab hat für diesen Kunden noch keine Dateien für dich.">
            {files.length > 0 && (
              <Row icon={FolderOpen} title={plural(files.length, "Datei für dich", "Dateien für dich")} sub={`zuletzt neu: ${files[0].title}`} category={<Dot className="cdm-dot-off">Asset Management</Dot>}
                date={<span className="numeric">{formatShort(files[0].createdAt)}</span>} action={<Link className="cdm-row-link" href={`${filesHref}?customer=${encodeURIComponent(current.customerId)}`}>Öffnen<ArrowRight size={14} aria-hidden="true" /></Link>} />
            )}
          </TableGroup>
        </table>
      </div>
    );
    const hosting = hostingOf(current);
    const server = current.mailServer;
    const vdTerm = query.trim().toLocaleLowerCase("de");
    const hit = (...values: string[]) => !vdTerm || values.some((value) => value.toLocaleLowerCase("de").includes(vdTerm));
    // The ⓘ sits at the first group there is.
    const firstGroup = hosting.length ? "hosting" : current.domains?.length ? "domains" : current.mailboxes?.length ? "boxes" : current.packages?.length ? "packages" : current.contact ? "contact" : null;
    const infoFor = (key: string) => (key === firstGroup ? vdInfo.button : undefined);
    const vd = !data.ready || !count ? (
      <div className="am-scroll">
        <div className="fc-empty">
          <span className="am-tile is-lg fc-tile"><LockKeyhole size={22} aria-hidden="true" /></span>
          <strong>{data.ready ? "Noch nichts freigegeben" : "Noch nicht eingerichtet"}</strong>
          <p>{data.ready ? "oalab gibt dir Domains, Hosting und E-Mail eines Kunden frei, sobald du sie für deine Arbeit brauchst." : "Freigaben für Freelancer sind noch nicht eingerichtet. Bis dahin hilft dir das oalab-Team im Chat."}</p>
          <Link className="sheet-action is-primary" href={chatHref}><MessageSquare size={15} aria-hidden="true" />In Nachrichten fragen</Link>
        </div>
      </div>
    ) : (
      <>
        <div className="cdm-lock" role="status"><Eye size={16} aria-hidden="true" /><p>Nur lesen. Freigegeben hat oalab: {released.map((area) => shareAreas[area].label).join(", ")}. Passwörter bleiben beim oalab-Team.</p></div>
        <div className="am-scroll">
          <table className="file-table cdm-table cdm-admin-table">
            <caption className="visually-hidden">Vertrag und Domain von {current.company}</caption>
            {hosting.length > 0 && (
              <TableGroup colSpan={COLS} label="Hosting" count={hosting.length} glyph={<Server size={16} aria-hidden="true" />} collapsed={groups.isCollapsed(g("hosting"))} onToggle={() => groups.toggle(g("hosting"))} actions={infoFor("hosting")}>
                {hosting.filter((row) => hit(row.provider, row.detail)).map((row) => (
                  <Row key={`${row.kind}-${row.provider}-${row.detail}`} icon={hostingIcons[row.kind]} title={row.provider} sub={row.detail} category={<Dot className={hostingKinds[row.kind].dot}>{hostingKinds[row.kind].label}</Dot>} />
                ))}
              </TableGroup>
            )}
            {current.domains && current.domains.length > 0 && (
              <TableGroup colSpan={COLS} label="Domains" count={current.domains.length} glyph={<Globe size={16} aria-hidden="true" />} collapsed={groups.isCollapsed(g("domains"))} onToggle={() => groups.toggle(g("domains"))} actions={infoFor("domains")}>
                {current.domains.filter((domain) => hit(domain.display, domain.websiteHost, domain.registrar, domain.dnsProvider)).map((domain) => (
                  <Row key={domain.id} icon={Globe} domain title={domain.display} sub={domain.websiteHost ? `Website bei ${domain.websiteHost}` : `Domain bei ${domain.registrar || "–"}`}
                    category={<Status kind={statusGlyph[domain.status] ?? "active"}>{domainStatuses[domain.status].label}</Status>}
                    date={domain.renewsOn ? <span className="numeric">bis {formatIsoDay(domain.renewsOn)}</span> : null}
                    action={<><Checks checks={domain.checks} />{" "}<OpenLink href={`https://${domain.domain}`} label="Website öffnen" /></>} />
                ))}
              </TableGroup>
            )}
            {current.mailboxes && current.mailboxes.length > 0 && (
              <TableGroup colSpan={COLS} label="E-Mail-Adressen" count={current.mailboxes.length} glyph={<Mail size={16} aria-hidden="true" />} collapsed={groups.isCollapsed(g("boxes"))} onToggle={() => groups.toggle(g("boxes"))} actions={infoFor("boxes")}>
                {current.mailboxes.filter((box) => hit(box.display, box.person, box.targetDisplay)).map((box) => (
                  <Row key={box.id} icon={box.kind === "alias" ? AtSign : box.kind === "forward" ? Forward : Inbox} title={box.display}
                    sub={box.kind === "mailbox" ? box.person : `${mailboxKinds[box.kind].target} ${box.targetDisplay}`} category={<Dot className={`cdm-dot-${box.kind}`}>{mailboxKinds[box.kind].label}</Dot>}
                    action={<CopyButton value={box.display} label="Adresse" />} />
                ))}
              </TableGroup>
            )}
            {server && (server.imapHost || server.smtpHost || server.webmailUrl) && (
              <TableGroup colSpan={COLS} label="Mail-Server" count={[server.imapHost, server.smtpHost, server.webmailUrl].filter(Boolean).length} glyph={<Mail size={16} aria-hidden="true" />} collapsed={groups.isCollapsed(g("server"))} onToggle={() => groups.toggle(g("server"))}>
                {server.imapHost && <Row icon={Inbox} title={server.imapHost} sub="Posteingang (IMAP)" category={<Dot className="cdm-dot-off">{mailSecurities[server.imapSecurity].label}</Dot>} date={server.imapPort ? <span className="numeric">Port {server.imapPort}</span> : null} action={<CopyButton value={server.imapHost} label="Server" />} />}
                {server.smtpHost && <Row icon={Send} title={server.smtpHost} sub="Postausgang (SMTP)" category={<Dot className="cdm-dot-off">{mailSecurities[server.smtpSecurity].label}</Dot>} date={server.smtpPort ? <span className="numeric">Port {server.smtpPort}</span> : null} action={<CopyButton value={server.smtpHost} label="Server" />} />}
                {server.webmailUrl && <Row icon={Globe} title={server.webmailUrl.replace(/^https:\/\//, "")} sub="Webmail im Browser" category={<Dot className="cdm-dot-off">Webmail</Dot>} action={<OpenLink href={server.webmailUrl} label="Webmail öffnen" />} />}
              </TableGroup>
            )}
            {current.packages && current.packages.length > 0 && (
              <TableGroup colSpan={COLS} label="Pakete" count={current.packages.length} glyph={<Package size={16} aria-hidden="true" />} collapsed={groups.isCollapsed(g("packages"))} onToggle={() => groups.toggle(g("packages"))} actions={infoFor("packages")}>
                {current.packages.map((item) => (
                  <Row key={item.packageId} icon={item.group === "service" ? MessageSquare : Globe} title={packageCatalog[item.packageId].name} sub={packageCatalog[item.packageId].description}
                    category={<Dot className={item.group === "service" ? "cdm-dot-service" : "cdm-dot-domain"}>{item.group === "service" ? "Service" : "Domain"}</Dot>}
                    date={item.since ? <span className="numeric">seit {formatIsoDay(item.since)}</span> : null} action={<Status kind="active">{item.until ? `bis ${formatIsoDay(item.until)}` : "Aktiv"}</Status>} />
                ))}
              </TableGroup>
            )}
            {current.contact && (
              <TableGroup colSpan={COLS} label="Kontaktdaten" count={[current.contact.email, current.contact.phone, current.contact.street || current.contact.city, current.contact.website].filter(Boolean).length}
                glyph={<Contact size={16} aria-hidden="true" />} collapsed={groups.isCollapsed(g("contact"))} onToggle={() => groups.toggle(g("contact"))} actions={infoFor("contact")} empty="oalab hat für diese Firma noch keine Kontaktdaten eingetragen.">
                {current.contact.email && <Row icon={Mail} title={current.contact.email} sub="E-Mail der Firma" category={<Dot className="cdm-dot-off">E-Mail</Dot>} action={<CopyButton value={current.contact.email} label="Adresse" />} />}
                {current.contact.phone && <Row icon={Contact} title={current.contact.phone} sub="Telefon der Firma" category={<Dot className="cdm-dot-off">Telefon</Dot>} action={<CopyButton value={current.contact.phone} label="Nummer" />} />}
                {(current.contact.street || current.contact.city) && <Row icon={Building2} title={[current.contact.street, [current.contact.postalCode, current.contact.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")} sub={current.contact.country || "Anschrift"} category={<Dot className="cdm-dot-off">Adresse</Dot>} />}
                {current.contact.website && <Row icon={Globe} title={current.contact.website.replace(/^https?:\/\//, "")} sub="Website laut Kundenstamm" category={<Dot className="cdm-dot-off">Website</Dot>} />}
              </TableGroup>
            )}
          </table>
          {vdInfo.box}
        </div>
      </>
    );
    pane = (
      <section className="am-pane" aria-label={current.company}>
        <header className="am-pane-head">
          {back}
          <CustomerSign customer={{ id: current.customerId, company: current.company }} logo={logos.get(current.customerId) ?? null} size="lg" />
          <div className="am-pane-title"><strong>{current.company}</strong><span>{current.customerNumber}{current.assignedAt ? ` · betreut seit ${formatInstant(current.assignedAt)}` : ""}</span></div>
          <div className="am-pane-actions">
            <Link className="sheet-action" href={projects[0] ? `${boardHref}?project=${encodeURIComponent(projects[0].id)}` : boardHref} aria-label="Aufgaben" data-tip-compact="Aufgaben im Board"><SquareKanban size={15} aria-hidden="true" /><span className="am-btn-text" data-tip-label>Aufgaben</span></Link>
            <Link className="sheet-action" href={`${filesHref}?customer=${encodeURIComponent(current.customerId)}`} aria-label="Dateien" data-tip-compact="Dateien im Asset Management"><FolderOpen size={15} aria-hidden="true" /><span className="am-btn-text" data-tip-label>Dateien</span></Link>
          </div>
        </header>
        <SheetToolbar query={query} onQuery={setQuery} placeholder="Suchen …" label={`In ${current.company} suchen`}
          leading={<SegmentedControl label="Ansicht" value={tab} onChange={(next: Tab) => { setTab(next); setQuery(""); }} options={[
            { id: "info", label: "Überblick", name: "Überblick" },
            { id: "vd", label: "Vertrag & Domain", name: "Vertrag & Domain", ...(count ? { count } : {}) },
          ]} />} />
        {tab === "info" ? info : vd}
        <SheetFooter hint={tab === "info" ? "Nur lesen" : "Stimmt etwas nicht? Schreib uns in Nachrichten."}>
          {tab === "info" ? `${plural(projects.length, "Projekt", "Projekte")} · ${plural(files.length, "Datei", "Dateien")}` : count ? plural(count, "Eintrag", "Einträge") : "Nichts freigegeben"}
        </SheetFooter>
      </section>
    );
  }

  return (
    <>
      <LargeTitleHeader title="Kunden" icon={<TitleIcon icon={Building2} />} actions={<HeaderActions />} />
      {data.source === "fixtures" && <p className="calendar-notice section-first file-demo-note"><Inbox size={18} aria-hidden="true" />Fiktive Beispielkunden für die Vorschau.</p>}
      {data.error && <GlassCard className="section-first"><p className="t-headline">Gerade nicht verfügbar</p><p className="t-subheadline t-secondary">{data.error}</p></GlassCard>}
      {!data.error && (
        <div className="sheet section-first am cdm" data-open={paneOpen ? "" : undefined}>
          <div className="am-grid">
            {list}
            {pane}
          </div>
        </div>
      )}
    </>
  );
}
