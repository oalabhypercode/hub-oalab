"use client";

import Link from "next/link";
import { ArrowUpRight, Bell, Building2, CalendarClock, CalendarDays, ChevronRight, Files, Flag, FolderOpen, LifeBuoy, MessageSquare, SquareKanban, UserCheck, Video, type LucideIcon } from "lucide-react";
import { formatDeadline, deadlineHint, hubHref, type Project } from "@/lib/hub-data";
import { customerSteps, projectSites } from "@/lib/hub-projects/map";
import { boardCustomers, boardProgress, cardCustomers, dueTasks, hasProgress, myTasks, openRequests, orderProjects, quotaView, serviceRows, watchProjects, type CardCustomer, type WatchReason } from "@/lib/hub-insights/rules";
import type { InsightsData } from "@/lib/hub-insights/types";
import { previewInsights, previewNotices } from "@/lib/hub-insights/fixtures";
import { dayOf, formatDayShort, formatTimeRange, timeOf } from "@/lib/hub-calendar/rules";
import { quotaMonth } from "@/lib/hub-service-quota/rules";
import { SERVICE_PLATFORM_URL, isServicePackageId, packageCatalog, serviceRequestLimits } from "@/lib/service-packages";
import type { InboxItem } from "@/lib/hub-notify/server";
import type { HubAppointment } from "@/lib/hub-calendar/types";
import { formatFileDay } from "@/lib/hub-files/catalog";
import type { HubFilesState } from "@/lib/hub-files/types";
import type { ShareArea } from "@/lib/hub-freelancer-customers/rules";
import type { FreelancerCustomersState } from "@/lib/hub-freelancer-customers/types";
import type { TaskBoardState } from "@/lib/hub-tasks/types";
import { HeaderActions } from "../app-shell";
import { TitleIcon } from "../glass";
import { LargeTitleHeader } from "../large-title-header";
import { sectionIcons } from "../navigation";
import { noticeSymbol, noticeWhen } from "../notice-symbols";
import { StatusGlyph, type GlyphKind } from "../sheet";
import { useHubShell } from "../shell-context";
import { CustomerSign } from "./customer-sign";
import { FileIcon } from "./files-parts";
import { TaskGlyph } from "./tasks-parts";
import type { ScreenProps } from "./types";

/**
 * Insights (design „V5“, user 18.11.2026): tiles on white sheets. Customers see where their project stands and what
 * they can do next; admins see in numbers and short lists what needs attention today. Freelancers (19.11.2026) see
 * their tasks, customers and projects.
 */
export function InsightsScreen({ model, preview, admin, freelancer, projects, fileState, asOf, insights, board, cards }: ScreenProps & { insights?: InsightsData; board?: TaskBoardState; cards?: FreelancerCustomersState }) {
  const { inbox } = useHubShell();
  const header = <LargeTitleHeader title="Insights" date={model.dateLine} icon={<TitleIcon icon={sectionIcons.insights!} />} actions={<HeaderActions />} />;
  const data = insights ?? previewInsights(asOf, admin);
  const notices = preview ? previewNotices(asOf, admin) : inbox?.items ?? [];
  if (freelancer) return <>{header}<FreelancerInsights preview={preview} data={data} board={board ?? null} cards={cards ?? null} notices={notices} fileState={fileState} /></>;
  return <>{header}{admin
    ? <AdminInsights preview={preview} projects={projects} data={data} notices={notices} />
    : <CustomerInsights preview={preview} projects={projects} data={data} notices={notices} />}</>;
}

type TileProps = { title: string; icon: LucideIcon; link?: { href: string; label: string; external?: boolean }; wide?: boolean; children: React.ReactNode };

function Tile({ title, icon: Icon, link, wide = false, children }: TileProps) {
  return (
    <section className={`sheet in-tile${wide ? " is-wide" : ""}`} aria-label={title}>
      <header className="in-head">
        <h2><Icon size={16} aria-hidden="true" />{title}</h2>
        {link && (link.external
          ? <a className="in-link" href={link.href} target="_blank" rel="noopener noreferrer">{link.label}<ArrowUpRight size={13} aria-hidden="true" /></a>
          : <Link className="in-link" href={link.href}>{link.label}<ChevronRight size={14} aria-hidden="true" /></Link>)}
      </header>
      {children}
    </section>
  );
}

function Empty({ glyph, title, text, children }: { glyph?: GlyphKind; title: string; text: string; children?: React.ReactNode }) {
  return <div className="in-empty"><strong>{glyph && <StatusGlyph kind={glyph} />}{title}</strong><span>{text}</span>{children}</div>;
}

function NoticeRows({ items }: { items: InboxItem[] }) {
  return (
    <ul className="in-list">
      {items.map((item) => {
        const { icon: Icon, color } = noticeSymbol(item.kind);
        return (
          <li key={item.id}>
            <Link href={item.href} className="in-row">
              <span className="in-icon" style={{ color }}><Icon size={16} aria-hidden="true" /></span>
              <span className="in-row-text"><strong>{item.title}</strong>{item.body && <small>{item.body}</small>}</span>
              <time className={item.read ? undefined : "is-new"} dateTime={item.createdAt}>{noticeWhen(item.createdAt)}</time>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

const newestFirst = (items: InboxItem[]) => [...items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
const dayNumber = (time: number) => Number(dayOf(time).slice(8));
const monthShort = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", month: "short" });
const statusGlyph = (status: Project["status"]): GlyphKind => status === "Dein Feedback" ? "feedback" : status === "Abgeschlossen" ? "done" : "progress";

// ---------- customers ----------

function CustomerInsights({ preview, projects, data, notices }: { preview: boolean; projects: Project[]; data: InsightsData; notices: InboxItem[] }) {
  const { account, unreadConversations } = useHubShell();
  const projectsHref = hubHref(preview, "projects");
  const ordered = orderProjects(projects);
  const main = ordered[0];
  const steps = customerSteps(projects);
  const servicePackage = account.packages.find(isServicePackageId) ?? null;
  const appointment = data.appointments[0];
  const fresh = newestFirst(notices).slice(0, 3);
  const reply = newestFirst(notices).find((item) => item.kind === "chat.reply");
  const ask = <a className="sheet-action is-primary" href={SERVICE_PLATFORM_URL} target="_blank" rel="noopener noreferrer">Anfrage stellen<ArrowUpRight size={13} aria-hidden="true" /><span className="visually-hidden"> (öffnet in neuem Tab)</span></a>;

  const projectBody = main ? (() => {
    const sites = projectSites(main);
    const others = ordered.slice(1);
    return (
      <div className="in-body">
        <div className="in-line"><Link className="in-name" href={`${projectsHref}?project=${main.id}`}>{main.category || main.name}</Link><span className="in-state"><StatusGlyph kind={statusGlyph(main.status)} />{main.status}</span></div>
        {hasProgress(main) ? <>
          <p className="in-figure"><b className="numeric">{main.progress} %</b><span>fertig{main.dueOn ? ` · Ziel ${formatDeadline(main.dueOn)}, ${deadlineHint(main.dueOn, main.status === "Abgeschlossen", data.today)}` : ""}</span></p>
          <div className="in-meter" role="img" aria-label={`${main.progress} Prozent fertig`}><span style={{ width: `${main.progress}%` }} /></div>
        </> : <p className="in-muted">oalab arbeitet daran. Den Fortschritt siehst du, sobald Aufgaben angelegt sind.{main.dueOn ? ` Ziel: ${formatDeadline(main.dueOn)}.` : ""}</p>}
        {sites.length > 0 && <div className="in-sites">{sites.map((site) => <a key={site.key} className={`in-site is-${site.key}`} href={site.url} target="_blank" rel="noopener noreferrer" data-tip={site.sub}><i aria-hidden="true" />{site.label}<ArrowUpRight size={12} aria-hidden="true" /></a>)}</div>}
        {others.length > 0 && <p className="in-also">Außerdem: <b>{others[0].category || others[0].name}</b> · {others[0].status}{others.length > 1 ? ` und ${others.length - 1} ${others.length === 2 ? "weiteres" : "weitere"}` : ""}</p>}
      </div>
    );
  })() : <Empty title="Noch kein Projekt" text="Sobald oalab ein Projekt für dich anlegt, siehst du hier, wo es steht.">{servicePackage ? ask : <Link className="sheet-action" href={hubHref(preview, "messages")}>Nachricht schreiben</Link>}</Empty>;

  const quotaRow = data.quota.enforced ? data.quota.rows[0] : undefined;
  const serviceBody = !servicePackage
    ? <Empty title="Kein Servicepaket" text="Mit Service Lite oder Max gibst du Änderungen an deiner Website direkt auf der Serviceplattform in Auftrag."><Link className="sheet-action" href={hubHref(preview, "contracts")}>Vertrag & Domain</Link></Empty>
    : (() => {
      const open = openRequests(projects);
      const month = data.quota.window ? quotaMonth(data.quota.window) : null;
      const view = quotaRow ? quotaView(quotaRow) : null;
      return (
        <div className="in-body">
          <span className="chat-pill tone-info in-pkg">{packageCatalog[servicePackage].short}</span>
          {view ? <>
            <p className="in-figure"><b className="numeric">{view.free}</b><span>von {view.limit} Anfragen{month ? ` im ${month.month}` : ""} noch frei</span></p>
            <div className={`in-meter${view.tone === "ok" ? "" : ` is-${view.tone}`}`} role="img" aria-label={`${view.used} von ${view.limit} Anfragen genutzt`}><span style={{ width: `${Math.round(view.share * 100)}%` }} /></div>
            <p className="in-meta"><span>{view.used} genutzt{month ? ` · neues Kontingent ab ${month.resetDay.replace(/ \d{4}$/, "")}` : ""}</span>{view.tone !== "ok" && <span className="in-state"><StatusGlyph kind={view.tone === "full" ? "alert" : "pending"} />{view.tone === "full" ? "aufgebraucht" : "fast aufgebraucht"}</span>}</p>
          </> : <p className="in-figure"><b className="numeric">{serviceRequestLimits[servicePackage]}</b><span>neue Anfragen im Monat inklusive</span></p>}
          <p className="in-meta"><span className="in-state"><StatusGlyph kind={open ? "progress" : "active"} />{open ? `${open} ${open === 1 ? "Anfrage" : "Anfragen"} in Bearbeitung` : "Keine offene Anfrage"}</span></p>
          {ask}
        </div>
      );
    })();

  const todoBody = steps.length
    ? <ul className="in-list">{steps.slice(0, 4).map(({ task, project }) => {
      const hint = task.dueOn ? deadlineHint(task.dueOn, false, data.today) : "";
      return (
        <li key={task.id}>
          <Link href={`${projectsHref}?project=${project.id}`} className="in-row">
            <span className="in-icon"><Flag size={16} aria-hidden="true" /></span>
            <span className="in-row-text"><strong>{task.title}</strong><small>{project.category || project.name}</small></span>
            {hint && <time className={hint.includes("überfällig") ? "is-bad" : hint === "heute" ? "is-new" : undefined}>{hint}</time>}
          </Link>
        </li>
      );
    })}</ul>
    : <Empty glyph="active" title="Gerade nichts zu tun" text="Sobald du etwas freigeben oder liefern kannst, steht es hier, und du bekommst eine Nachricht." />;

  const appointmentBody = <NextAppointment appointment={appointment} preview={preview} emptyText="Such dir eine freie Zeit für ein Gespräch aus." />;

  const messagesBody = reply || unreadConversations
    ? <>
      {reply ? <NoticeRows items={[reply]} /> : null}
      {unreadConversations > 0 && <p className="in-meta in-pad"><span className="in-state"><StatusGlyph kind="feedback" />{unreadConversations === 1 ? "1 Gespräch mit neuer Nachricht" : `${unreadConversations} Gespräche mit neuen Nachrichten`}</span></p>}
    </>
    : <Empty title="Keine neuen Nachrichten" text="Frag uns direkt hier im Hub, wir antworten dir hier."><Link className="sheet-action" href={hubHref(preview, "messages")}>Nachricht schreiben</Link></Empty>;

  return (
    <div className="in-grid is-customer section-first">
      <Tile title="Dein Projekt" icon={FolderOpen} wide link={main ? { href: projectsHref, label: ordered.length > 1 ? `Alle Projekte (${ordered.length})` : "Projekte" } : undefined}>{projectBody}</Tile>
      <Tile title="Service-Anfragen" icon={LifeBuoy} link={servicePackage ? { href: SERVICE_PLATFORM_URL, label: "Serviceplattform", external: true } : undefined}>{serviceBody}</Tile>
      <Tile title="Du bist am Zug" icon={Flag} wide>{todoBody}</Tile>
      <Tile title="Nächster Termin" icon={CalendarDays} link={{ href: hubHref(preview, "calendar"), label: "Kalender" }}>{appointmentBody}</Tile>
      <Tile title="Neu für dich" icon={Bell} wide link={{ href: hubHref(preview), label: "Übersicht" }}>{fresh.length ? <NoticeRows items={fresh} /> : <Empty title="Noch nichts Neues" text="Neue Dateien, Antworten, Aufgaben und Termine erscheinen hier und in der Glocke." />}</Tile>
      <Tile title="Nachrichten" icon={MessageSquare} link={{ href: hubHref(preview, "messages"), label: "Öffnen" }}>{messagesBody}</Tile>
    </div>
  );
}

// ---------- admins ----------

const reasonText: Record<WatchReason, string> = { risk: "gefährdet", late: "Zieltermin überschritten", waiting: "wartet auf den Kunden", hold: "pausiert" };
const reasonGlyph: Record<WatchReason, GlyphKind> = { risk: "alert", late: "alert", waiting: "feedback", hold: "pending" };

function Kpi({ label, icon: Icon, value, context, glyph, href }: { label: string; icon: LucideIcon; value: number; context: string; glyph?: GlyphKind; href: string }) {
  return (
    <Link href={href} className="sheet in-kpi">
      <span className="in-kpi-label"><Icon size={15} aria-hidden="true" />{label}</span>
      <span className={`in-kpi-value${value ? "" : " is-zero"}`}>{value}</span>
      <span className="in-kpi-ctx">{glyph && <StatusGlyph kind={glyph} />}{context}</span>
    </Link>
  );
}

function AdminInsights({ preview, projects, data, notices }: { preview: boolean; projects: Project[]; data: InsightsData; notices: InboxItem[] }) {
  const { pendingRegistrations, unreadConversations } = useHubShell();
  const projectsHref = hubHref(preview, "projects");
  const boardHref = `${projectsHref}/tasks`;
  const today = data.appointments.filter((appointment) => dayOf(appointment.start) === data.today);
  const requests = data.appointments.filter((appointment) => appointment.status === "requested" && dayOf(appointment.start) > data.today);
  const due = dueTasks(projects, data.today);
  const overdue = due.filter((item) => item.overdue).length;
  const watch = watchProjects(projects, data.today);
  const atRisk = watch.filter((item) => item.reason === "risk").length;
  const chats = newestFirst(notices.filter((item) => item.kind === "chat.message"));
  const rows = serviceRows(data.quota.rows, new Map(Object.entries(data.quota.names)));
  const month = data.quota.window ? quotaMonth(data.quota.window).month : "";
  // The server's clock, so the page reads the same on the server and in the browser.
  const next = today.find((appointment) => appointment.end > data.now);

  const appointmentRow = (appointment: InsightsData["appointments"][number], withDay: boolean) => (
    <li key={appointment.id}>
      <Link href={`${hubHref(preview, "calendar")}?day=${dayOf(appointment.start)}`} className="in-row">
        <span className="in-icon">{appointment.status === "requested" ? <CalendarClock size={16} aria-hidden="true" /> : <Video size={16} aria-hidden="true" />}</span>
        <span className="in-row-text"><strong>{withDay ? `${formatDayShort(dayOf(appointment.start))}, ${timeOf(appointment.start)}` : formatTimeRange(appointment)} · {appointment.title}</strong><small>{appointment.customer?.company ?? "intern"}{appointment.status === "requested" ? " · angefragt" : ""}</small></span>
        <StatusGlyph kind={appointment.status === "requested" ? "pending" : "active"} />
      </Link>
    </li>
  );

  return <>
    <div className="in-kpis section-first">
      <Kpi label="Freigaben" icon={UserCheck} value={pendingRegistrations} context={pendingRegistrations ? "warten auf Prüfung" : "keine offen"} glyph={pendingRegistrations ? "pending" : undefined} href={hubHref(preview, "users")} />
      <Kpi label="Nachrichten" icon={MessageSquare} value={unreadConversations} context={unreadConversations ? "Gespräche ungelesen" : "alles gelesen"} href={hubHref(preview, "messages")} />
      <Kpi label="Termine heute" icon={CalendarDays} value={today.length} context={next ? `nächster um ${timeOf(next.start)}` : requests.length ? `${requests.length} ${requests.length === 1 ? "Anfrage" : "Anfragen"} offen` : "keine"} href={hubHref(preview, "calendar")} />
      <Kpi label="Aufgaben fällig" icon={SquareKanban} value={due.length} context={overdue ? `${overdue} überfällig` : due.length ? "heute fällig" : "nichts fällig"} glyph={overdue ? "alert" : undefined} href={boardHref} />
      <Kpi label="Projekte im Blick" icon={FolderOpen} value={watch.length} context={atRisk ? `${atRisk} gefährdet` : watch.length ? "brauchen einen Blick" : "alles im Plan"} glyph={atRisk ? "alert" : undefined} href={projectsHref} />
    </div>
    <div className="in-grid is-admin">
      <Tile title="Termine heute" icon={CalendarDays} link={{ href: hubHref(preview, "calendar"), label: "Kalender" }}>
        {today.length || requests.length
          ? <ul className="in-list">{today.slice(0, 3).map((appointment) => appointmentRow(appointment, false))}{requests.slice(0, Math.max(0, 3 - Math.min(3, today.length))).map((appointment) => appointmentRow(appointment, true))}</ul>
          : data.appointmentsError ? <Empty title="Kalender gerade nicht verfügbar" text={data.appointmentsError} /> : <Empty glyph="active" title="Heute keine Termine" text="Neue Terminanfragen von Kunden erscheinen hier und in der Glocke." />}
      </Tile>
      <Tile title="Nachrichten" icon={MessageSquare} link={{ href: hubHref(preview, "messages"), label: "Alle" }}>
        {chats.length ? <NoticeRows items={chats.slice(0, 3)} /> : <Empty glyph="active" title="Alles beantwortet" text="Schreibt dir ein Kunde im privaten Chat, steht es hier." />}
      </Tile>
      <Tile title="Aufgaben fällig" icon={SquareKanban} link={{ href: boardHref, label: "Board" }}>
        {due.length
          ? <ul className="in-list">{due.slice(0, 3).map(({ task, project, overdue: late }) => (
            <li key={task.id}>
              <Link href={`${boardHref}?project=${project.id}`} className="in-row">
                <span className="in-icon"><SquareKanban size={16} aria-hidden="true" /></span>
                <span className="in-row-text"><strong>#{task.number} {task.title}</strong><small>{[project.company, project.category || project.name, task.dueOn ? deadlineHint(task.dueOn, false, data.today) : ""].filter(Boolean).join(" · ")}</small></span>
                <StatusGlyph kind={late ? "alert" : "pending"} />
              </Link>
            </li>
          ))}</ul>
          : <Empty glyph="active" title="Nichts fällig" text="Überfällige und heute fällige Aufgaben aus dem Board erscheinen hier." />}
      </Tile>
      <Tile title="Projekte im Blick" icon={FolderOpen} link={{ href: projectsHref, label: "Projekte" }}>
        {watch.length
          ? <ul className="in-list">{watch.slice(0, 3).map(({ project, reason, waiting }) => (
            <li key={project.id}>
              <Link href={`${projectsHref}?project=${project.id}`} className="in-row">
                <span className="in-icon"><FolderOpen size={16} aria-hidden="true" /></span>
                <span className="in-row-text"><strong>{project.category || project.name}</strong><small>{[project.company, reason === "waiting" && waiting ? `${waiting} ${waiting === 1 ? "Aufgabe" : "Aufgaben"} beim Kunden` : reason === "late" && project.dueOn ? `Ziel ${formatDeadline(project.dueOn)} überschritten` : reasonText[reason]].filter(Boolean).join(" · ")}</small></span>
                <StatusGlyph kind={reasonGlyph[reason]} />
              </Link>
            </li>
          ))}</ul>
          : <Empty glyph="active" title="Alles im Plan" text="Kein Projekt ist gefährdet, pausiert, über dem Zieltermin oder wartet auf einen Kunden." />}
      </Tile>
      <Tile title={month ? `Service-Anfragen im ${month}` : "Service-Anfragen"} icon={LifeBuoy} wide link={{ href: hubHref(preview, "contracts"), label: "Vertrag & Domain" }}>
        {!data.quota.ready
          ? <Empty title="Kontingente gerade nicht verfügbar" text="Die Zahlen der Serviceplattform konnten nicht gelesen werden." />
          : rows.length
            ? <>
              <ul className="in-svc">{rows.slice(0, 6).map((row) => (
                <li key={row.customerId} className="in-svc-row">
                  <span className="in-svc-name"><CustomerSign customer={{ id: row.customerId, company: row.company }} size="sm" /><span>{row.company}</span></span>
                  <span className="chat-pill tone-info">{row.packageId === "service-max" ? "Service Max" : "Service Lite"}</span>
                  <span className={`in-meter${row.tone === "ok" ? "" : ` is-${row.tone}`}`} role="img" aria-label={`${row.used} von ${row.limit} Anfragen genutzt`}><span style={{ width: `${Math.round(row.share * 100)}%` }} /></span>
                  <span className="in-svc-count numeric">{row.used} von {row.limit}</span>
                  <span className="in-state">{row.tone === "full" ? <><StatusGlyph kind="alert" />voll</> : row.tone === "warn" ? <><StatusGlyph kind="pending" />fast voll</> : null}</span>
                </li>
              ))}</ul>
              <div className="sheet-footer"><span>{rows.length} {rows.length === 1 ? "Kunde" : "Kunden"} mit Servicepaket{rows.length > 6 ? `, die ${6} meistgenutzten` : ""}</span><span>Sperre bei vollem Kontingent: {data.quota.enforced ? "an" : "aus"}</span></div>
            </>
            : <Empty glyph="active" title="Noch keine Servicepakete" text="Sobald Kunden Service Lite oder Max haben, siehst du hier, wie viel sie im Monat schon angefragt haben." />}
      </Tile>
    </div>
  </>;
}

// ---------- the next appointment (customers and freelancers) ----------

function NextAppointment({ appointment, preview, emptyText }: { appointment?: HubAppointment; preview: boolean; emptyText: string }) {
  return appointment
    ? <div className="in-appt">
      <span className="in-date" aria-hidden="true"><small>{monthShort.format(appointment.start).replace(".", "")}</small><b>{dayNumber(appointment.start)}</b></span>
      <span className="in-appt-text">
        <strong>{appointment.title}</strong>
        <span>{formatDayShort(dayOf(appointment.start))} · {formatTimeRange(appointment)}</span>
        {appointment.status === "requested" && <span className="chat-pill tone-todo">Angefragt</span>}
        {appointment.teamsUrl && <a className="sheet-action" href={appointment.teamsUrl} target="_blank" rel="noopener noreferrer">Teams-Link<ArrowUpRight size={13} aria-hidden="true" /></a>}
      </span>
    </div>
    : <Empty title="Kein Termin geplant" text={emptyText}><Link className="sheet-action is-primary" href={hubHref(preview, "calendar")}>Termin anfragen</Link></Empty>;
}

// ---------- freelancers ----------

const SHARE_SHORT: Record<ShareArea, string> = { domains: "Domains", mail: "E-Mail", packages: "Pakete", contact: "Kontaktdaten" };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The board as Insights needs it: a freelancer's projects and tasks, or why they did not load. */
export type InsightsBoard = Pick<TaskBoardState, "projects" | "tasks" | "viewerId" | "error">;

/**
 * A freelancer's Insights (design „Kacheln“, user 19.11.2026): the tasks assigned to them, overdue first; their next
 * appointment; the customers they look after with open tasks, the team's note and what oalab released; news from the
 * bell; how far their projects are (the tasks they see); their newest files.
 */
export function FreelancerInsights({ preview, data, board, cards, notices, fileState }: { preview: boolean; data: InsightsData; board: InsightsBoard | null; cards: FreelancerCustomersState | null; notices: InboxItem[]; fileState: HubFilesState }) {
  const boardHref = `${hubHref(preview, "projects")}/tasks`;
  const customersHref = hubHref(preview, "customers");
  const filesHref = hubHref(preview, "files");
  const boardError = board ? board.error : "Dein Board konnte gerade nicht geladen werden. Bitte versuche es erneut.";
  const projects = board && !board.error ? board.projects : [];
  const allTasks = board && !board.error ? board.tasks : [];
  const tasks = board && !board.error ? myTasks(allTasks, board.viewerId) : [];
  const projectOf = new Map(projects.map((project) => [project.id, project]));
  const looksAfter = fileState.customers.filter((customer) => customer.kind !== "freelancer");
  // The cards carry the team's note and the releases; without them (not loaded) the customers come from the files.
  const customers: CardCustomer[] = cards && !cards.error && cards.cards.length
    ? cardCustomers(cards.cards, projects, allTasks)
    : boardCustomers(looksAfter, projects, allTasks).flatMap((row) => row.customerId ? [{ customerId: row.customerId, company: row.company, open: row.open, note: "", shares: [] }] : []);
  const logoOf = new Map(looksAfter.map((customer) => [customer.id, customer.logo ?? null]));
  const progress = boardProgress(projects, allTasks);
  const fresh = newestFirst(notices).slice(0, 3);
  const files = fileState.files.slice(0, 3);
  const ownId = fileState.freelancer?.ownId ?? null;
  const where = (customerIds: string[]) => ownId && customerIds.includes(ownId) ? "Meine Dateien" : looksAfter.find((customer) => customerIds.includes(customer.id))?.company ?? "";

  const tasksBody = boardError ? <Empty title="Board gerade nicht verfügbar" text={boardError} />
    : tasks.length ? <>
      <ul className="in-list">{tasks.slice(0, 4).map((task) => {
        const project = projectOf.get(task.projectId);
        const hint = task.dueOn ? deadlineHint(task.dueOn, false, data.today) : "";
        return (
          <li key={task.id}>
            <Link href={`${boardHref}?task=${task.number}`} className="in-row">
              <span className="in-icon"><TaskGlyph status={task.status} /></span>
              <span className="in-row-text"><strong>#{task.number} {task.title}</strong><small>{[project?.company, project?.name].filter(Boolean).join(" · ")}</small></span>
              {hint && <time className={hint.includes("überfällig") ? "is-bad" : hint === "heute" ? "is-new" : undefined}>{hint}</time>}
            </Link>
          </li>
        );
      })}</ul>
      {tasks.length > 4 && <p className="in-meta in-pad">und {plural(tasks.length - 4, "weitere Aufgabe", "weitere Aufgaben")} für dich im Board</p>}
    </>
      : <Empty glyph="active" title="Dir ist gerade nichts zugewiesen" text="Sobald dir das Team eine Aufgabe zuweist, steht sie hier mit ihrer Frist, die überfälligen zuerst."><Link className="sheet-action" href={boardHref}>Zum Board</Link></Empty>;

  const customersBody = customers.length ? <>
    <ul className="in-list">{customers.slice(0, 4).map((row) => (
      <li key={row.customerId}>
        <Link href={`${customersHref}?customer=${encodeURIComponent(row.customerId)}`} className="in-row">
          <CustomerSign customer={{ id: row.customerId, company: row.company }} logo={logoOf.get(row.customerId) ?? null} size="sm" />
          <span className="in-row-text"><strong>{row.company}</strong><small>{[row.open ? plural(row.open, "offene Aufgabe", "offene Aufgaben") : "keine offene Aufgabe", row.note ? `Hinweis: ${row.note.split("\n")[0]}` : ""].filter(Boolean).join(" · ")}</small></span>
          {row.shares.length > 0 && <span className="in-shares" data-tip="Für dich freigegeben">{row.shares.map((area) => <span key={area} className="chat-pill tone-info">{SHARE_SHORT[area]}</span>)}</span>}
        </Link>
      </li>
    ))}</ul>
    {customers.length > 4 && <p className="in-meta in-pad">und {plural(customers.length - 4, "weiterer Kunde", "weitere Kunden")}</p>}
  </> : <Empty title="Noch keine Kunden" text="Sobald oalab dir Kunden zuordnet, stehen sie hier mit ihren offenen Aufgaben." />;

  const projectsBody = boardError ? <Empty title="Board gerade nicht verfügbar" text={boardError} />
    : progress.length ? <div className="pg-body">
      <ul className="pg-list">{progress.slice(0, 4).map((row) => (
        <li key={row.id}>
          <Link href={`${boardHref}?project=${row.id}`} className="pg-row" data-tip={row.total ? `${row.done} von ${row.total} Aufgaben erledigt` : "noch ohne Aufgaben"}>
            <span className="pg-name"><strong>{row.name}</strong><small>{[row.company, row.dueOn ? `Ziel ${formatDeadline(row.dueOn)}` : "ohne Zieltermin"].filter(Boolean).join(" · ")}</small></span>
            <span className={`pg-meter${row.share === null ? " is-none" : ""}`} role="img" aria-label={row.share === null ? "noch ohne Aufgaben" : `${row.share} Prozent erledigt`}><span style={{ width: `${row.share ?? 0}%` }} /></span>
            <b className="numeric">{row.share === null ? "–" : `${row.share} %`}</b>
          </Link>
        </li>
      ))}</ul>
      {progress.length > 4 && <p className="ch-scope pg-more">und {plural(progress.length - 4, "weiteres Projekt", "weitere Projekte")}</p>}
    </div>
      : <Empty title="Noch kein Projekt" text="Sobald dich das Team in ein Projekt einträgt, siehst du hier, wie weit es ist." />;

  const filesBody = files.length
    ? <ul className="in-list">{files.map((file) => (
      <li key={file.id}>
        <Link href={`${filesHref}?file=${encodeURIComponent(file.id)}`} className="in-row">
          <span className="in-icon"><FileIcon file={file} size={16} /></span>
          <span className="in-row-text"><strong>{file.title}</strong><small>{[where(file.customers.map((customer) => customer.id)), formatFileDay(file.createdAt, data.today)].filter(Boolean).join(" · ")}</small></span>
        </Link>
      </li>
    ))}</ul>
    : <Empty title="Noch keine Dateien" text="Dateien deiner Kunden und von oalab für dich erscheinen hier und im Asset Management." />;

  return (
    <div className="in-grid is-customer section-first">
      <Tile title="Deine Aufgaben" icon={SquareKanban} wide link={{ href: boardHref, label: "Board" }}>{tasksBody}</Tile>
      <Tile title="Nächster Termin" icon={CalendarDays} link={{ href: hubHref(preview, "calendar"), label: "Kalender" }}><NextAppointment appointment={data.appointments[0]} preview={preview} emptyText="Brauchst du eine Abstimmung mit dem Team? Such dir eine freie Zeit aus." /></Tile>
      <Tile title="Deine Kunden" icon={Building2} wide link={{ href: customersHref, label: "Kunden" }}>{customersBody}</Tile>
      <Tile title="Neu für dich" icon={Bell} link={{ href: hubHref(preview), label: "Übersicht" }}>{fresh.length ? <NoticeRows items={fresh} /> : <Empty title="Noch nichts Neues" text="Neue Aufgaben, Dateien, Freigaben und Termine erscheinen hier und in der Glocke." />}</Tile>
      <Tile title="Deine Projekte" icon={FolderOpen} wide link={{ href: boardHref, label: "Board" }}>{projectsBody}</Tile>
      <Tile title="Neue Dateien" icon={Files} link={{ href: filesHref, label: "Asset Management" }}>{filesBody}</Tile>
    </div>
  );
}
