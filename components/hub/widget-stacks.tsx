"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { Activity, ArrowUpRight, CalendarClock, CalendarDays, ChevronDown, ChevronRight, ChevronUp, FolderOpen, Gauge, ListChecks, Settings, Video, type LucideIcon } from "lucide-react";
import { formatDeadline, hubHref, type Project } from "@/lib/hub-data";
import { addDays, dayOf, formatDayShort, timeOf } from "@/lib/hub-calendar/rules";
import { activityByDay, dueByDay, openRequests, progressRows, quotaView, serviceRows, serviceSummary, taskCounts } from "@/lib/hub-insights/rules";
import { DEFAULT_STACKS, WIDGET_IDS, moveWidget, openingIndex, readStacks, toggleWidget, type StackConfig, type StackSlot, type StacksConfig, type WidgetId } from "@/lib/hub-overview/rules";
import type { OverviewWidgetsData } from "@/lib/hub-overview/types";
import { quotaMonth } from "@/lib/hub-service-quota/rules";
import { STATUS_NAMES } from "@/lib/hub-tasks/rules";
import { SERVICE_PLATFORM_URL, packageCatalog, serviceRequestLimits, type ServicePackageId } from "@/lib/service-packages";
import { StatusGlyph, type GlyphKind } from "./sheet";
import { TaskGlyph } from "./screens/tasks-parts";

/**
 * The two widget stacks beside the notifications (design „V5“, user 18.11.2026), like the phone's widget stacks: each
 * field shows one widget; the dots, a swipe or the arrow keys switch, the gear chooses which widgets a field stacks, in
 * which order, and whether it opens on the one that needs attention. The choice stays in this browser, per login.
 */

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const SLOT_NAMES: Record<StackSlot, string> = { top: "oben", bottom: "unten" };
const STATUS_ORDER = ["backlog", "todo", "progress", "review", "done"] as const;

// ---------- the stored choice (per login, this browser) ----------
const STACKS_EVENT = "oalab-hub-widgets";
const stacksKey = (userKey: string) => `oalab-hub-widgets:${userKey}`;
const subscribeStacks = (change: () => void) => {
  window.addEventListener(STACKS_EVENT, change);
  window.addEventListener("storage", change);
  return () => { window.removeEventListener(STACKS_EVENT, change); window.removeEventListener("storage", change); };
};
const readStored = (key: string) => { try { return localStorage.getItem(key) ?? ""; } catch { return ""; } };
const noStored = () => "";

// ---------- rings with rounded ends ----------
type Part = { key: string; value: number; color: string; tip: string };
type Segment = { key: string; color: string; tip: string } & ({ kind: "full" } | { kind: "arc"; d: string } | { kind: "dot"; cx: number; cy: number });
const SIZE = 156, C = SIZE / 2, R = SIZE / 2 - 14, STROKE = 18, CAP = STROKE / 2 / R, GAP = 4 / R;
const point = (angle: number) => `${(C + R * Math.cos(angle)).toFixed(2)} ${(C + R * Math.sin(angle)).toFixed(2)}`;
const arc = (from: number, to: number) => `M ${point(from)} A ${R} ${R} 0 ${to - from > Math.PI ? 1 : 0} 1 ${point(to)}`;

/** The parts of a ring: each shortened by its caps so 4 px stay between two; one too small for two caps becomes a dot. */
function ringSegments(parts: readonly Part[]): Segment[] {
  const shown = parts.filter((part) => part.value > 0);
  const total = shown.reduce((sum, part) => sum + part.value, 0);
  if (shown.length === 1) return [{ ...shown[0], kind: "full" }];
  const segments: Segment[] = [];
  let angle = -Math.PI / 2;
  for (const part of shown) {
    const sweep = (part.value / total) * Math.PI * 2;
    const from = angle + GAP / 2 + CAP, to = angle + sweep - GAP / 2 - CAP, mid = angle + sweep / 2;
    angle += sweep;
    segments.push(to - from <= 0.005
      ? { key: part.key, color: part.color, tip: part.tip, kind: "dot", cx: C + R * Math.cos(mid), cy: C + R * Math.sin(mid) }
      : { key: part.key, color: part.color, tip: part.tip, kind: "arc", d: arc(from, to) });
  }
  return segments;
}

/** One value against its whole, from the top, clockwise, with rounded ends (the customer's quota). */
function gaugeSegment(share: number, color: string): Segment | null {
  const sweep = Math.max(0, Math.min(1, share)) * Math.PI * 2;
  if (share >= 0.999) return { key: "value", color, tip: "", kind: "full" };
  if (sweep <= 0) return null;
  const from = -Math.PI / 2 + CAP, to = -Math.PI / 2 + sweep - CAP;
  return to - from <= 0.005 ? { key: "value", color, tip: "", kind: "dot", cx: C, cy: C - R } : { key: "value", color, tip: "", kind: "arc", d: arc(from, to) };
}

function Ring({ segments, label, highlight = null }: { segments: Segment[]; label: string; highlight?: string | null }) {
  return (
    <svg className="ch-donut" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={label} data-hl={highlight ?? undefined}>
      <circle className="ch-track" cx={C} cy={C} r={R} />
      {segments.map((segment) => {
        const hl = highlight === segment.key ? " is-hl" : "";
        const tip = segment.tip || undefined;
        return segment.kind === "full" ? <circle key={segment.key} className={`ch-part${hl}`} cx={C} cy={C} r={R} style={{ stroke: segment.color }} data-tip={tip} />
          : segment.kind === "dot" ? <circle key={segment.key} className={`ch-dot${hl}`} cx={segment.cx.toFixed(2)} cy={segment.cy.toFixed(2)} r={STROKE / 2} style={{ fill: segment.color }} data-tip={tip} />
            : <path key={segment.key} className={`ch-part${hl}`} d={segment.d} style={{ stroke: segment.color }} data-tip={tip} />;
      })}
    </svg>
  );
}

function Empty({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return <div className="ch-empty"><strong>{title}</strong><span>{text}</span>{children}</div>;
}

type LegendRow = { key: string; name: string; value: number; color: string; glyph: ReactNode; tip?: string };

/** A ring with its figure in the middle and a legend that highlights its part on hover. */
function RingWithLegend({ rows, label, center, scope }: { rows: LegendRow[]; label: string; center: ReactNode; scope: string }) {
  const [highlight, setHighlight] = useState<string | null>(null);
  return (
    <div className="ch-donut-body">
      <div className="ch-donut-wrap"><Ring segments={ringSegments(rows.map((row) => ({ key: row.key, value: row.value, color: row.color, tip: row.tip ?? `${row.name}: ${row.value}` })))} label={label} highlight={highlight} />{center}</div>
      <div className="ch-side">
        <ul className="ch-legend">{rows.map((row) => (
          <li key={row.key} className={`${row.value ? "" : "is-zero"}${highlight === row.key ? " is-hl" : ""}`} onPointerEnter={() => setHighlight(row.value ? row.key : null)} onPointerLeave={() => setHighlight(null)} data-tip={row.tip}>
            <span className="ch-swatch" style={{ "--c": row.color } as CSSProperties} />{row.glyph}<span>{row.name}</span><b>{row.value}</b>
          </li>
        ))}</ul>
        <p className="ch-scope">{scope}</p>
      </div>
    </div>
  );
}

// ---------- the six widgets ----------
type Widget = { name: string; icon: LucideIcon; link?: { href: string; label: string; external?: boolean }; attention: boolean; body: ReactNode };
type WidgetInput = { admin: boolean; preview: boolean; data: OverviewWidgetsData; projects: Project[]; stamps: string[]; servicePackage: ServicePackageId | null };

function statusWidget({ admin, preview, projects }: WidgetInput): Widget {
  const counts = taskCounts(projects, admin);
  const total = STATUS_ORDER.reduce((sum, key) => sum + counts[key], 0);
  const percent = (n: number) => total ? Math.round((n / total) * 100) : 0;
  const rows: LegendRow[] = STATUS_ORDER.map((key) => ({ key, name: STATUS_NAMES[key], value: counts[key], color: `var(--st-${key})`, glyph: <TaskGlyph status={key} />, tip: `${STATUS_NAMES[key]}: ${count(counts[key], "Aufgabe", "Aufgaben")} (${percent(counts[key])} %)` }));
  return {
    name: "Aufgaben nach Status", icon: ListChecks, attention: false,
    link: admin ? { href: `${hubHref(preview, "projects")}/tasks`, label: "Board" } : { href: hubHref(preview, "projects"), label: "Projekte" },
    body: total
      ? <RingWithLegend rows={rows} label={rows.map((row) => `${row.name} ${row.value}`).join(", ")} center={<div className="ch-center"><b>{total - counts.done}</b><span>offen</span><small>von {total}</small></div>} scope={admin ? "Alle laufenden Projekte" : "Für dich freigegeben"} />
      : <div className="ch-donut-body"><div className="ch-donut-wrap"><Ring segments={[]} label="Noch keine Aufgaben" /><div className="ch-center is-empty"><b>0</b><span>Aufgaben</span></div></div><Empty title="Noch keine Aufgaben" text={admin ? "Auf dem Board liegt gerade keine Aufgabe." : "Sobald oalab Aufgaben für dein Projekt freigibt, siehst du hier, wo sie stehen."} /></div>,
  };
}

function dueWidget({ admin, preview, data, projects }: WidgetInput): Widget {
  const due = dueByDay(projects, data.today, admin);
  const total = due.days.reduce((sum, n) => sum + n, 0);
  const days = due.days.map((n, i) => ({ n, day: addDays(data.today, i) }));
  const max = Math.max(1, due.overdue, ...due.days);
  const peak = due.days.indexOf(Math.max(...due.days));
  const height = (n: number) => ({ "--h": `${Math.round((n / max) * 100)}%` }) as CSSProperties;
  const weekend = (day: string) => [0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay());
  const link = admin ? { href: `${hubHref(preview, "projects")}/tasks`, label: "Board" } : { href: hubHref(preview, "calendar"), label: "Kalender" };
  if (!total && !due.overdue) return { name: "Fällig in 2 Wochen", icon: CalendarClock, link, attention: false, body: <div className="ch-bars-body"><Empty title="Keine Fristen in den nächsten zwei Wochen" text={admin ? "Sobald Aufgaben einen Termin haben, siehst du hier, an welchen Tagen es eng wird." : "Sobald etwas mit Termin ansteht, siehst du hier, an welchen Tagen."} /></div> };
  return {
    name: "Fällig in 2 Wochen", icon: CalendarClock, link, attention: due.overdue > 0,
    body: (
      <div className="ch-bars-body">
        <div className="ch-bars" aria-hidden="true">
          <span className="ch-bar is-overdue" style={height(due.overdue)} data-tip={`Überfällig: ${count(due.overdue, "Aufgabe", "Aufgaben")}`}><i />{due.overdue > 0 && <em>{due.overdue}</em>}</span>
          {days.map(({ n, day }, i) => <span key={day} className={`ch-bar${i === 0 ? " is-today" : ""}${weekend(day) ? " is-weekend" : ""}`} style={height(n)} data-tip={`${formatDayShort(day)}${i === 0 ? " (heute)" : ""}: ${n ? `${count(n, "Aufgabe", "Aufgaben")} fällig` : "nichts fällig"}`}><i />{(i === 0 || i === peak) && n > 0 && <em>{n}</em>}</span>)}
        </div>
        <div className="ch-axis" aria-hidden="true"><span className="is-overdue">überf.</span>{days.map(({ day }, i) => <span key={day} className={`${i === 0 ? "is-today" : ""}${weekend(day) ? " is-weekend" : ""}`}>{formatDayShort(day).slice(0, 2)}</span>)}</div>
        <div className="ch-caption">{due.overdue > 0 && <span className="in-state"><StatusGlyph kind="alert" />{due.overdue} überfällig</span>}<span>{total} in den nächsten 14 Tagen</span></div>
        <table className="visually-hidden"><caption>Fällige Aufgaben je Tag</caption><tbody><tr><th scope="row">Überfällig</th><td>{due.overdue}</td></tr>{days.map(({ n, day }) => <tr key={day}><th scope="row">{formatDayShort(day)}</th><td>{n}</td></tr>)}</tbody></table>
      </div>
    ),
  };
}

function quotaWidget({ admin, preview, data, projects, servicePackage }: WidgetInput): Widget {
  const month = data.quota.window ? quotaMonth(data.quota.window) : null;
  if (admin) {
    const rows = serviceRows(data.quota.rows, new Map(Object.entries(data.quota.names)));
    const summary = serviceSummary(rows);
    const open = openRequests(projects);
    const legend: LegendRow[] = [
      { key: "ok", name: "Im Rahmen", value: summary.ok, color: "var(--accent-text)", glyph: <StatusGlyph kind="active" />, tip: `Im Rahmen: ${count(summary.ok, "Kunde", "Kunden")}` },
      { key: "warn", name: "Fast voll", value: summary.warn, color: "var(--tone-todo-bar)", glyph: <StatusGlyph kind="pending" />, tip: `Fast voll: ${count(summary.warn, "Kunde", "Kunden")}` },
      { key: "full", name: "Voll", value: summary.full, color: "var(--tone-bad-bar)", glyph: <StatusGlyph kind="alert" />, tip: `Voll: ${count(summary.full, "Kunde", "Kunden")}` },
    ];
    return {
      name: "Service-Kontingente", icon: Gauge, link: { href: hubHref(preview, "contracts"), label: "Vertrag & Domain" }, attention: summary.full > 0,
      body: !data.quota.ready ? <div className="ch-bars-body"><Empty title="Kontingente gerade nicht verfügbar" text="Die Zahlen der Serviceplattform konnten nicht gelesen werden." /></div>
        : rows.length ? <RingWithLegend rows={legend} label={`Im Rahmen ${summary.ok}, fast voll ${summary.warn}, voll ${summary.full}`} center={<div className="ch-center"><b>{rows.length}</b><span>Kunden</span><small>mit Paket</small></div>} scope={`${month ? `${month.month} · ` : ""}${open ? `${open} in Bearbeitung` : "nichts in Bearbeitung"}`} />
          : <div className="ch-bars-body"><Empty title="Noch keine Servicepakete" text="Sobald Kunden Service Lite oder Max haben, siehst du hier, wie voll ihr Monat ist." /></div>,
    };
  }
  const external = { href: SERVICE_PLATFORM_URL, label: "Serviceplattform", external: true };
  const ask = <a className="sheet-action is-primary" href={SERVICE_PLATFORM_URL} target="_blank" rel="noopener noreferrer">Anfrage stellen<ArrowUpRight size={13} aria-hidden="true" /><span className="visually-hidden"> (öffnet in neuem Tab)</span></a>;
  if (!servicePackage) return { name: "Service-Kontingent", icon: Gauge, attention: false, body: <div className="ch-bars-body"><Empty title="Kein Servicepaket" text="Mit Service Lite oder Max gibst du Änderungen an deiner Website direkt auf der Serviceplattform in Auftrag."><Link className="sheet-action" href={hubHref(preview, "contracts")}>Vertrag & Domain</Link></Empty></div> };
  const open = openRequests(projects);
  const row = data.quota.enforced ? data.quota.rows[0] : undefined;
  const view = row ? quotaView(row) : null;
  const limit = view?.limit ?? serviceRequestLimits[servicePackage];
  const color = view?.tone === "full" ? "var(--tone-bad-bar)" : view?.tone === "warn" ? "var(--tone-todo-bar)" : "var(--accent-text)";
  const segment = view ? gaugeSegment(limit ? view.free / limit : 0, color) : null;
  const state: GlyphKind = view?.tone === "full" ? "alert" : view?.tone === "warn" ? "pending" : "active";
  return {
    name: "Service-Kontingent", icon: Gauge, link: external, attention: Boolean(view && view.tone !== "ok"),
    body: (
      <div className="ch-donut-body">
        <div className="ch-donut-wrap"><Ring segments={segment ? [segment] : []} label={view ? `${view.free} von ${limit} Anfragen frei` : `${limit} Anfragen im Monat inklusive`} /><div className="ch-center"><b>{view ? view.free : limit}</b><span>{view ? "frei" : "im Monat"}</span><small>{view ? `von ${limit}` : "inklusive"}</small></div></div>
        <div className="qt-side">
          <span className="chat-pill tone-info">{packageCatalog[servicePackage].short}</span>
          <strong>{view ? `${view.used} von ${limit}${month ? ` im ${month.month}` : ""} genutzt` : `${limit} neue Anfragen im Monat inklusive`}</strong>
          {view && <span className="in-state"><StatusGlyph kind={state} />{view.tone === "full" ? "aufgebraucht" : view.tone === "warn" ? "fast aufgebraucht" : "im Rahmen"}</span>}
          <span>{open ? `${count(open, "Anfrage", "Anfragen")} in Bearbeitung` : "Keine offene Anfrage"}{view && month ? ` · neu ab ${month.resetDay.replace(/ \d{4}$/, "")}` : ""}</span>
          {ask}
        </div>
      </div>
    ),
  };
}

function progressWidget({ admin, preview, projects }: WidgetInput): Widget {
  const rows = progressRows(projects, admin);
  const projectsHref = hubHref(preview, "projects");
  const more = Math.max(0, rows.length - 4);
  return {
    name: "Projektfortschritt", icon: FolderOpen, link: { href: projectsHref, label: "Projekte" }, attention: admin && rows.some((row) => row.risk),
    body: rows.length ? (
      <div className="pg-body">
        <ul className="pg-list">{rows.slice(0, 4).map((row) => (
          <li key={row.id}>
            <Link href={`${projectsHref}?project=${row.id}`} className="pg-row">
              <span className="pg-name"><strong>{row.name}{row.risk && <span className="in-state"><StatusGlyph kind="alert" />gefährdet</span>}</strong><small>{[admin ? row.company : "", row.dueOn ? `Ziel ${formatDeadline(row.dueOn)}` : "ohne Zieltermin"].filter(Boolean).join(" · ")}</small></span>
              <span className={`pg-meter${row.value === null ? " is-none" : ""}`} role="img" aria-label={row.value === null ? "noch ohne Fortschritt" : `${row.value} Prozent`}><span style={{ width: `${row.value ?? 0}%` }} /></span>
              <b className="numeric">{row.value === null ? "–" : `${row.value} %`}</b>
            </Link>
          </li>
        ))}</ul>
        {more > 0 && <p className="ch-scope pg-more">und {count(more, "weiteres Projekt", "weitere Projekte")}</p>}
      </div>
    ) : <div className="pg-body"><Empty title="Noch kein Projekt" text={admin ? "Laufende Projekte erscheinen hier mit ihrem Fortschritt." : "Sobald oalab ein Projekt für dich anlegt, siehst du hier, wie weit es ist."} /></div>,
  };
}

function weekWidget({ admin, preview, data }: WidgetInput): Widget {
  const calendarHref = hubHref(preview, "calendar");
  const days = Array.from({ length: 7 }, (_, i) => addDays(data.weekStart, i));
  const coming = data.appointments.filter((appointment) => appointment.end > data.now);
  return {
    name: "Diese Woche", icon: CalendarDays, link: { href: calendarHref, label: "Kalender" }, attention: false,
    body: (
      <div className="wk-body">
        <div className="wk-strip">{days.map((day, i) => {
          const n = data.appointments.filter((appointment) => dayOf(appointment.start) === day).length;
          return <Link key={day} href={`${calendarHref}?day=${day}`} className={`wk-day${day === data.today ? " is-today" : ""}${i > 4 ? " is-weekend" : ""}`} data-tip={`${formatDayShort(day)}: ${n ? count(n, "Termin", "Termine") : "keine Termine"}`}><span className="wk-name">{formatDayShort(day).slice(0, 2)}</span><span className="wk-num">{Number(day.slice(8))}</span><span className="wk-dots">{Array.from({ length: Math.min(3, n) }, (_, k) => <i key={k} />)}</span></Link>;
        })}</div>
        {coming.length ? <>
          <ul className="in-list wk-list">{coming.slice(0, 2).map((appointment) => (
            <li key={appointment.id}>
              <Link href={`${calendarHref}?day=${dayOf(appointment.start)}`} className="in-row">
                <span className="in-icon">{appointment.status === "requested" ? <CalendarClock size={16} aria-hidden="true" /> : <Video size={16} aria-hidden="true" />}</span>
                <span className="in-row-text"><strong>{timeOf(appointment.start)} · {appointment.title}</strong><small>{[dayOf(appointment.start) === data.today ? "heute" : formatDayShort(dayOf(appointment.start)), admin ? appointment.customer?.company ?? "intern" : "", appointment.status === "requested" ? "angefragt" : ""].filter(Boolean).join(" · ")}</small></span>
                {appointment.status === "requested" && <StatusGlyph kind="pending" />}
              </Link>
            </li>
          ))}</ul>
          {coming.length > 2 && <p className="ch-scope wk-more">und {count(coming.length - 2, "weiterer Termin", "weitere Termine")} diese Woche</p>}
        </> : <div className="wk-none"><Empty title="Diese Woche keine Termine mehr" text={data.appointmentsError ?? (admin ? "Neue Anfragen von Kunden erscheinen in den Benachrichtigungen." : "Such dir eine freie Zeit für ein Gespräch aus.")}>{!admin && <Link className="sheet-action is-primary" href={calendarHref}>Termin anfragen</Link>}</Empty></div>}
      </div>
    ),
  };
}

function activityWidget({ admin, data, stamps }: WidgetInput): Widget {
  const values = activityByDay(stamps, data.today);
  const total = values.reduce((sum, n) => sum + n, 0);
  const name = "Aktivität";
  if (total <= 1) return { name, icon: Activity, attention: false, body: <div className="ac-body"><Empty title="Noch wenig los" text={admin ? "Meldungen und Dateien der letzten zwei Wochen erscheinen hier als Verlauf." : "Neue Dateien, Antworten, Aufgaben und Termine der letzten zwei Wochen erscheinen hier als Verlauf."} /></div> };
  const width = 320, height = 104, top = 16, bottom = 88, left = 6, right = 314;
  const max = Math.max(1, ...values);
  const x = (i: number) => left + (i * (right - left)) / (values.length - 1);
  const y = (v: number) => bottom - (v / max) * (bottom - top);
  const line = values.map((v, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const last = values.length - 1;
  const step = (right - left) / last;
  const day = (i: number) => addDays(data.today, i - last);
  const peak = values.indexOf(max);
  return {
    name, icon: Activity, attention: false,
    body: (
      <div className="ac-body">
        <div className="ac-figure"><b>{total}</b><span>{admin ? "Meldungen und Dateien" : "Neuigkeiten"} in 14 Tagen</span></div>
        <svg className="ac-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`Aktivität der letzten 14 Tage, zusammen ${total}`}>
          <line className="ac-base" x1={left} x2={right} y1={bottom} y2={bottom} />
          <path className="ac-area" d={`${line} L ${x(last).toFixed(1)} ${bottom} L ${x(0).toFixed(1)} ${bottom} Z`} />
          <path className="ac-line" d={line} />
          <circle className="ac-end" cx={x(last).toFixed(1)} cy={y(values[last]).toFixed(1)} r="4.5" />
          {values.map((v, i) => <rect key={i} x={(x(i) - step / 2).toFixed(1)} y="0" width={step.toFixed(1)} height={height} fill="transparent" data-tip={`${formatDayShort(day(i))}${i === last ? " (heute)" : ""}: ${v}`} />)}
        </svg>
        <div className="ac-axis"><span>{formatDayShort(day(0)).slice(5)}</span><span>heute</span></div>
        <div className="ch-caption"><span>heute {values[last]} · am meisten am {formatDayShort(day(peak))} ({max})</span></div>
      </div>
    ),
  };
}

const BUILDERS: Record<WidgetId, (input: WidgetInput) => Widget> = { status: statusWidget, due: dueWidget, quota: quotaWidget, progress: progressWidget, week: weekWidget, activity: activityWidget };

// ---------- a stack ----------
function StackSheet({ slot, config, widgets, onChange, onDone }: { slot: StackSlot; config: StackConfig; widgets: Record<WidgetId, Widget>; onChange: (next: StackConfig) => void; onDone: () => void }) {
  const rank = (id: WidgetId) => { const i = config.items.indexOf(id); return i < 0 ? 99 : i; };
  const rows = [...WIDGET_IDS].sort((a, b) => rank(a) - rank(b) || WIDGET_IDS.indexOf(a) - WIDGET_IDS.indexOf(b));
  return (
    <div className="sheet-pop is-end stk-pop" role="dialog" aria-label={`Widgets ${SLOT_NAMES[slot]} anpassen`}>
      <p className="stk-pop-title">Widgets in diesem Feld</p>
      <div className="stk-rows">{rows.map((id) => {
        const on = config.items.includes(id);
        const index = config.items.indexOf(id);
        const { icon: Icon, name } = widgets[id];
        return (
          <div key={id} className={`stk-row${on ? " is-on" : ""}`}>
            <button type="button" className="sheet-choice" role="checkbox" aria-checked={on} disabled={on && config.items.length === 1} onClick={() => onChange(toggleWidget(config, id))}>
              <span className="stk-ico"><Icon size={15} aria-hidden="true" /></span><span>{name}</span>
            </button>
            {on && <span className="stk-order">
              <button type="button" onClick={() => onChange(moveWidget(config, id, -1))} disabled={index === 0} aria-label={`${name} nach oben`} data-tip="Nach oben"><ChevronUp size={14} aria-hidden="true" /></button>
              <button type="button" onClick={() => onChange(moveWidget(config, id, 1))} disabled={index === config.items.length - 1} aria-label={`${name} nach unten`} data-tip="Nach unten"><ChevronDown size={14} aria-hidden="true" /></button>
            </span>}
          </div>
        );
      })}</div>
      <div className="stk-switch-row">
        <span><strong>Wichtigstes zuerst</strong><small>Zeigt beim Öffnen das Widget, das gerade Aufmerksamkeit braucht.</small></span>
        <button type="button" role="switch" className="switch" aria-checked={config.smart} aria-label="Wichtigstes zuerst" onClick={() => onChange({ ...config, smart: !config.smart })}><span className="switch-knob" /></button>
      </div>
      <div className="stk-pop-foot"><span>Wische oder tippe auf die Punkte, um zu wechseln.</span><button type="button" className="sheet-action is-primary" onClick={onDone}>Fertig</button></div>
    </div>
  );
}

function Stack({ slot, config, widgets, onChange }: { slot: StackSlot; config: StackConfig; widgets: Record<WidgetId, Widget>; onChange: (next: StackConfig) => void }) {
  const [chosen, setChosen] = useState<number | null>(null);
  const [moves, setMoves] = useState(0);
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; done: boolean } | null>(null);
  const index = Math.min(chosen ?? openingIndex(config, (id) => widgets[id].attention), config.items.length - 1);
  const widget = widgets[config.items[index]];
  const Icon = widget.icon;
  const go = (next: number) => { setChosen((next + config.items.length) % config.items.length); setMoves((value) => value + 1); };

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  function keys(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next = (index + (event.key === "ArrowRight" ? 1 : -1) + config.items.length) % config.items.length;
    go(next);
    (event.currentTarget.children[next] as HTMLElement | undefined)?.focus();
  }

  return (
    <section className={`sheet in-tile ch-tile stk${open ? " is-open" : ""}`} data-stack={slot} aria-label={`Widgets ${SLOT_NAMES[slot]}: ${widget.name}`}>
      <header className="in-head">
        <h2><Icon size={16} aria-hidden="true" />{widget.name}</h2>
        {widget.link && (widget.link.external
          ? <a className="in-link" href={widget.link.href} target="_blank" rel="noopener noreferrer">{widget.link.label}<ArrowUpRight size={13} aria-hidden="true" /></a>
          : <Link className="in-link" href={widget.link.href}>{widget.link.label}<ChevronRight size={14} aria-hidden="true" /></Link>)}
        <div className="stk-menu" ref={menu}>
          <button type="button" className="stk-gear" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="dialog" aria-label={`Widgets ${SLOT_NAMES[slot]} anpassen`} data-tip="Widgets anpassen"><Settings size={15} aria-hidden="true" /></button>
          {open && <StackSheet slot={slot} config={config} widgets={widgets} onChange={(next) => { onChange(next); setChosen(null); }} onDone={() => setOpen(false)} />}
        </div>
      </header>
      {/* A swipe switches like the dots; links inside neither drag along nor open when the swipe ends on them. */}
      <div key={moves} className={`stk-body${moves ? " is-switching" : ""}`}
        onPointerDown={(event) => { swipe.current = { x: event.clientX, done: false }; }}
        onPointerUp={(event) => { const start = swipe.current; if (start && Math.abs(event.clientX - start.x) > 40 && config.items.length > 1) { start.done = true; go(index + (event.clientX < start.x ? 1 : -1)); } }}
        onClickCapture={(event) => { if (swipe.current?.done) { event.preventDefault(); event.stopPropagation(); } swipe.current = null; }}
        onDragStart={(event) => event.preventDefault()}>
        {widget.body}
      </div>
      {config.items.length > 1 && <div className="stk-dots" role="tablist" aria-label={`Widgets ${SLOT_NAMES[slot]}`} onKeyDown={keys}>{config.items.map((id, i) => (
        <button key={id} type="button" role="tab" aria-selected={i === index} tabIndex={i === index ? 0 : -1} aria-label={widgets[id].name} data-tip={widgets[id].name} onClick={() => go(i)} />
      ))}</div>}
    </section>
  );
}

/** The widget column beside the notifications: two stacks, each one field of the phone's widget stack. */
export function WidgetStacks({ userKey, ...input }: WidgetInput & { userKey: string }) {
  const key = stacksKey(userKey);
  const stored = useSyncExternalStore(subscribeStacks, () => readStored(key), noStored);
  // Without storage (blocked) the choice still applies here until the page reloads.
  const [local, setLocal] = useState<StacksConfig | null>(null);
  const stacks: StacksConfig = local ?? (stored ? readStacks(stored) : DEFAULT_STACKS);
  const widgets = Object.fromEntries(WIDGET_IDS.map((id) => [id, BUILDERS[id](input)])) as Record<WidgetId, Widget>;
  const save = (slot: StackSlot, next: StackConfig) => {
    setLocal({ ...stacks, [slot]: next });
    try { localStorage.setItem(key, JSON.stringify({ ...stacks, [slot]: next })); } catch { /* kept in `local` above */ }
    window.dispatchEvent(new Event(STACKS_EVENT));
  };
  return (
    <aside className="ch-col" aria-label="Widgets">
      <Stack slot="top" config={stacks.top} widgets={widgets} onChange={(next) => save("top", next)} />
      <Stack slot="bottom" config={stacks.bottom} widgets={widgets} onChange={(next) => save("bottom", next)} />
    </aside>
  );
}
