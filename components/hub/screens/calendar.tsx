"use client";

import { useMemo, useState } from "react";
import { CalendarPlus, Check, ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import {
  addDays, addMonths, calendarWindow, clockOf, dayOf, formatDayLong, formatDayShort, formatHours, formatMonth, formatTimeRange,
  freeIntervals, isWorkday, mergeIntervals, monthOf, monthWeeks, occupancy, occupancyLabels, slotStarts, timeOf, wallTimeToUtc, WORKDAY,
  type OccupancyLevel,
} from "@/lib/hub-calendar/rules";
import type { HubAppointment } from "@/lib/hub-calendar/types";
import { HeaderActions } from "../app-shell";
import { GlassCard, SectionHeader } from "../glass";
import { LargeTitleHeader } from "../large-title-header";
import { CategoryTitle } from "./workspace";
import { AppointmentDetailDialog, AppointmentFormDialog, RequestDialog, StatusPill, TeamsJoin } from "./calendar-dialogs";
import { useCalendarStore, type CalendarStore } from "./calendar-store";
import type { ScreenProps } from "./types";

const weekdays = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const HOUR_PX = 48;
const MINUTE = 60_000;
const legendLevels: OccupancyLevel[] = ["free", "some", "busy", "full"];
const monthShort = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", month: "short" });

type Dialog =
  | { kind: "detail"; id: string }
  | { kind: "form"; id?: string; day: string; start?: string; accept?: boolean }
  | { kind: "request"; day: string; start?: string };

const clockMinutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
const byStart = (a: HubAppointment, b: HubAppointment) => a.start - b.start;

/** First weekday on or after `from`, never before today. */
function firstWorkday(from: string, today: string) {
  let day = from < today ? today : from;
  while (!isWorkday(day)) day = addDays(day, 1);
  return day;
}

export function CalendarScreen({ calendar }: ScreenProps) {
  const store = useCalendarStore(calendar);
  const { canManage, appointments, busy, now, today } = store;
  const range = useMemo(() => calendarWindow(today), [today]);
  const [month, setMonth] = useState(() => monthOf(today));
  const [selected, setSelected] = useState(today);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState("");

  // Declined and cancelled appointments stay in the lists but leave the grid and the timeline.
  const active = useMemo(() => appointments.filter((item) => item.status === "requested" || item.status === "confirmed").sort(byStart), [appointments]);
  const byDay = useMemo(() => {
    const days = new Map<string, HubAppointment[]>();
    for (const item of active) days.set(dayOf(item.start), [...(days.get(dayOf(item.start)) ?? []), item]);
    return days;
  }, [active]);
  const requests = canManage ? active.filter((item) => item.status === "requested" && item.end > now) : [];
  const upcoming = canManage ? active.filter((item) => item.status === "confirmed" && item.end > now).slice(0, 8) : [...appointments].filter((item) => item.end > now).sort(byStart);
  const canRequest = !canManage && store.customers.length > 0;
  const dialogAppointment = dialog && dialog.kind !== "request" && dialog.id ? appointments.find((item) => item.id === dialog.id) : undefined;

  const open = (next: Dialog) => { setNotice(""); setDialog(next); };
  const finish = (message: string) => { setDialog(null); setNotice(message); };
  function showMonth(next: string) {
    setMonth(next);
    setSelected(next === monthOf(today) ? today : `${next}-01`);
  }
  function select(day: string) {
    setSelected(day);
    if (monthOf(day) !== month) setMonth(monthOf(day));
  }
  function create(day: string, start?: string) {
    const planned = day < today ? today : day;
    open({ kind: "form", day: planned, start: start ?? slotStarts(planned, busy, 60, now)[0] });
  }

  if (calendar.error) {
    return <><LargeTitleHeader title="Kalender" icon={<CategoryTitle category="calendar" />} actions={<HeaderActions />} /><GlassCard className="section-first"><p className="t-headline">Kalender nicht verfügbar</p><p className="t-subheadline t-secondary">{calendar.error}</p></GlassCard></>;
  }

  return (
    <>
      <LargeTitleHeader title="Kalender" icon={<CategoryTitle category="calendar" />} actions={<HeaderActions />} />
      {!store.live && <GlassCard className="section-first file-demo-note"><Inbox size={18} color="var(--accent-text)" aria-hidden="true" /><p className="t-subheadline">{canManage ? "Beispieltermine der drei Demo-Kunden. Was du hier anlegst oder beantwortest, bleibt nur in diesem Browserfenster." : "Beispieltermine für die Demo. Anfragen bleiben in diesem Browserfenster und gehen nicht an OALAB."}</p></GlassCard>}
      {store.live && !canManage && !store.customers.length && <GlassCard className="section-first file-demo-note"><Inbox size={18} color="var(--accent-text)" aria-hidden="true" /><p className="t-subheadline">Dein Konto ist noch keinem Kunden zugeordnet. Die Auslastung siehst du schon, Termine anfragen kannst du nach der Zuordnung.</p></GlassCard>}

      <div className="calendar-toolbar">
        <div className="calendar-month-nav glass glass-float">
          <button type="button" onClick={() => showMonth(addMonths(month, -1))} disabled={month <= range.firstMonth} aria-label="Vorheriger Monat"><ChevronLeft size={20} aria-hidden="true" /></button>
          <h2 className="calendar-month-title" aria-live="polite">{formatMonth(month)}</h2>
          <button type="button" onClick={() => showMonth(addMonths(month, 1))} disabled={month >= range.lastMonth} aria-label="Nächster Monat"><ChevronRight size={20} aria-hidden="true" /></button>
        </div>
        <button type="button" className="glass glass-float glass-button glass-button-text" onClick={() => { setMonth(monthOf(today)); setSelected(today); }}>Heute</button>
        {canManage && <button type="button" className="calendar-primary" onClick={() => create(selected)}><CalendarPlus size={18} aria-hidden="true" />Neuer Termin</button>}
        {canRequest && <button type="button" className="calendar-primary" onClick={() => open({ kind: "request", day: firstWorkday(selected, today) })}><CalendarPlus size={18} aria-hidden="true" />Termin anfragen</button>}
      </div>
      {notice && <p className="calendar-notice glass" role="status"><Check size={18} aria-hidden="true" />{notice}</p>}

      <div className="calendar-layout">
        <GlassCard className="calendar-month-card">
          <MonthGrid month={month} range={range} today={today} selected={selected} busy={busy} byDay={byDay} canManage={canManage} onSelect={select} />
          <ul className="occupancy-legend" aria-label="Auslastung">
            {legendLevels.map((level) => <li key={level}><span className={`occupancy-swatch occupancy-${level}`} aria-hidden="true" />{occupancyLabels[level]}</li>)}
          </ul>
        </GlassCard>
        <DayPanel
          day={selected}
          store={store}
          items={byDay.get(selected) ?? []}
          onOpen={(id) => open({ kind: "detail", id })}
          onCreate={() => create(selected)}
          onRequest={canRequest ? (start) => open({ kind: "request", day: selected, start }) : undefined}
        />
      </div>

      {canManage && <>
        <SectionHeader title="Offene Anfragen" />
        {requests.length ? <AppointmentList label="Offene Anfragen" items={requests} showCustomer onOpen={(id) => open({ kind: "detail", id })} />
          : <GlassCard><p className="t-subheadline t-secondary">Keine offenen Anfragen.</p></GlassCard>}
      </>}
      <SectionHeader title={canManage ? "Nächste Termine" : "Deine Termine"} />
      {upcoming.length ? <AppointmentList label={canManage ? "Nächste Termine" : "Deine Termine und Anfragen"} items={upcoming} showCustomer={canManage} onOpen={(id) => open({ kind: "detail", id })} />
        : <GlassCard><p className="t-subheadline t-secondary">{canManage ? "Keine anstehenden Termine." : "Du hast noch keine Termine. Frag einfach einen freien Zeitraum an."}</p></GlassCard>}

      {dialog?.kind === "detail" && dialogAppointment && (
        <AppointmentDetailDialog key={dialogAppointment.id} appointment={dialogAppointment} store={store} onClose={() => setDialog(null)} onEdit={(accept) => open({ kind: "form", id: dialogAppointment.id, day: dayOf(dialogAppointment.start), accept })} />
      )}
      {dialog?.kind === "form" && <AppointmentFormDialog store={store} appointment={dialogAppointment} day={dialog.day} start={dialog.start} accept={dialog.accept} onClose={() => setDialog(null)} onSaved={finish} />}
      {dialog?.kind === "request" && <RequestDialog store={store} day={dialog.day} start={dialog.start} onClose={() => setDialog(null)} onSent={finish} />}
    </>
  );
}

type GridProps = {
  month: string;
  range: { firstMonth: string; lastMonth: string };
  today: string;
  selected: string;
  busy: CalendarStore["busy"];
  byDay: Map<string, HubAppointment[]>;
  canManage: boolean;
  onSelect: (day: string) => void;
};

/** Month grid: every working day shows how much of it is booked; admins see their appointments, customers only their own. */
function MonthGrid({ month, range, today, selected, busy, byDay, canManage, onSelect }: GridProps) {
  return (
    <div className="calendar-grid">
      <div className="calendar-weekdays" aria-hidden="true">{weekdays.map((name) => <span key={name}>{name}</span>)}</div>
      {monthWeeks(month).map((week) => (
        <div key={week[0]} className="calendar-week">
          {week.map((day) => {
            const items = byDay.get(day) ?? [];
            const load = occupancy(day, busy);
            const outside = monthOf(day) !== month;
            const className = `calendar-cell${outside ? " is-outside" : ""}${day < today ? " is-past" : ""}${load.level === "closed" ? " is-closed" : ""}`;
            const count = items.length ? `, ${items.length} ${canManage ? (items.length === 1 ? "Termin" : "Termine") : (items.length === 1 ? "eigener Termin" : "eigene Termine")}` : "";
            return (
              <button
                key={day}
                type="button"
                className={className}
                aria-pressed={day === selected}
                aria-current={day === today ? "date" : undefined}
                aria-label={`${formatDayLong(day)}: ${occupancyLabels[load.level]}${count}`}
                onClick={() => onSelect(day)}
                disabled={monthOf(day) < range.firstMonth || monthOf(day) > range.lastMonth}
              >
                <span className="calendar-day-number numeric">{Number(day.slice(8))}</span>
                {load.level !== "closed" && <span className={`occupancy-track occupancy-${load.level}`} aria-hidden="true"><span style={{ width: `${Math.round(load.ratio * 100)}%` }} /></span>}
                {items.length > 0 && (
                  <span className="calendar-cell-items" aria-hidden="true">
                    {items.slice(0, 2).map((item) => <span key={item.id} className={`calendar-chip calendar-chip-${item.status}`}><span className="numeric">{timeOf(item.start)}</span> {canManage && item.customer ? item.customer.company : item.title}</span>)}
                    {items.length > 2 && <span className="calendar-more">+{items.length - 2}</span>}
                    <span className="calendar-dots">{items.slice(0, 3).map((item) => <i key={item.id} className={`calendar-dot calendar-chip-${item.status}`} />)}</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

type DayPanelProps = { day: string; store: CalendarStore; items: HubAppointment[]; onOpen: (id: string) => void; onCreate: () => void; onRequest?: (start: string) => void };

/** The selected day: occupancy, a timeline of booked times and, for customers, the free times to request. */
function DayPanel({ day, store, items, onOpen, onCreate, onRequest }: DayPanelProps) {
  const load = occupancy(day, store.busy);
  const starts = onRequest ? slotStarts(day, store.blocked, 30, store.now) : [];
  // One button per free interval that fits at least half an hour; it opens the request at the first possible start.
  const free = onRequest ? freeIntervals(day, store.blocked, store.now).flatMap((interval) => {
    const start = starts.find((slot) => wallTimeToUtc(day, slot) >= interval.start && wallTimeToUtc(day, slot) + 30 * MINUTE <= interval.end);
    return start ? [{ interval, start }] : [];
  }) : [];

  return (
    <GlassCard as="section" className="calendar-day-card" aria-labelledby="calendar-day-title">
      <div className="calendar-day-head">
        <h2 className="t-headline" id="calendar-day-title">{formatDayLong(day)}</h2>
        <p className="t-subheadline t-secondary">{load.level === "closed" ? "Kein Termintag" : `${formatHours(load.bookedMinutes)} von ${formatHours(load.totalMinutes)} belegt · ${occupancyLabels[load.level]}`}</p>
      </div>
      <DayTimeline day={day} store={store} items={items} onOpen={onOpen} />
      {onRequest && load.level !== "closed" && (
        free.length ? (
          <div className="free-slots">
            <h3 className="t-footnote">Frei für deine Anfrage</h3>
            <ul>{free.map(({ interval, start }) => <li key={interval.start}><button type="button" className="free-slot" onClick={() => onRequest(start)}>{formatTimeRange(interval)}</button></li>)}</ul>
          </div>
        ) : <p className="t-footnote t-secondary free-slots-empty">{day < dayOf(store.now) ? "Dieser Tag liegt in der Vergangenheit." : "An diesem Tag ist nichts mehr frei."}</p>
      )}
      {store.canManage && <button type="button" className="sheet-button calendar-day-create" onClick={onCreate}><CalendarPlus size={18} aria-hidden="true" />Termin an diesem Tag</button>}
    </GlassCard>
  );
}

/** Wall-clock minutes of an instant on `day` (clamped to the day). */
function minutesOn(day: string, time: number) {
  const other = dayOf(time);
  return other < day ? 0 : other > day ? 24 * 60 : clockMinutes(timeOf(time));
}

function DayTimeline({ day, store, items, onOpen }: { day: string; store: CalendarStore; items: HubAppointment[]; onOpen: (id: string) => void }) {
  const workStart = clockMinutes(WORKDAY.start);
  const workEnd = clockMinutes(WORKDAY.end);
  const blocks = items.map((item) => ({ item, from: minutesOn(day, item.start), to: minutesOn(day, item.end) }));
  const first = Math.floor(Math.min(workStart, ...blocks.map((block) => block.from)) / 60) * 60;
  const last = Math.ceil(Math.max(workEnd, ...blocks.map((block) => block.to)) / 60) * 60;
  const y = (minutes: number) => ((minutes - first) / 60) * HOUR_PX;
  const closed = !isWorkday(day);

  // Customers see the whole calendar's booked times as anonymous blocks; their own appointments lie on top.
  const busyBlocks = store.canManage ? [] : mergeIntervals(store.busy).filter((interval) => dayOf(interval.start) === day || dayOf(interval.end) === day)
    .map((interval) => ({ from: minutesOn(day, interval.start), to: minutesOn(day, interval.end), interval }));
  const laneEnds: number[] = [];
  const placed = blocks.map((block) => {
    let lane = laneEnds.findIndex((end) => end <= block.from);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(block.to); } else laneEnds[lane] = block.to;
    return { ...block, lane };
  });
  const lanes = Math.max(1, laneEnds.length);
  const nowMinutes = dayOf(store.now) === day ? minutesOn(day, store.now) : null;

  return (
    <div className={`timeline${closed ? " is-closed" : ""}`} style={{ height: y(last) + 1 }}>
      {Array.from({ length: (last - first) / 60 + 1 }, (_, index) => first + index * 60).map((minutes) => (
        <div key={minutes} className="timeline-hour" style={{ top: y(minutes) }}><span className="numeric">{clockOf(minutes)}</span></div>
      ))}
      <div className="timeline-lanes">
        {!closed && first < workStart && <div className="timeline-off" style={{ top: 0, height: y(workStart) }} aria-hidden="true" />}
        {!closed && last > workEnd && <div className="timeline-off" style={{ top: y(workEnd), height: y(last) - y(workEnd) }} aria-hidden="true" />}
        {closed && <div className="timeline-off timeline-closed" style={{ top: 0, height: y(last) }}><span>Wochenende · keine Termine</span></div>}
        {busyBlocks.map(({ from, to, interval }) => <div key={interval.start} className="timeline-busy" style={{ top: y(from), height: Math.max(y(to) - y(from), 20) }}><span>Belegt · {formatTimeRange(interval)}</span></div>)}
        {placed.map(({ item, from, to, lane }) => (
          <button
            key={item.id}
            type="button"
            className={`timeline-block timeline-block-${item.status}`}
            style={{ top: y(from), height: Math.max(y(to) - y(from), 24), left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}
            onClick={() => onOpen(item.id)}
          >
            <strong>{item.title}</strong>
            <span>{formatTimeRange(item)}{store.canManage ? ` · ${item.customer ? item.customer.company : "Intern"}` : ""}{item.status === "requested" ? " · angefragt" : ""}</span>
          </button>
        ))}
        {nowMinutes !== null && nowMinutes >= first && nowMinutes <= last && <div className="timeline-now" style={{ top: y(nowMinutes) }} aria-hidden="true" />}
      </div>
    </div>
  );
}

function AppointmentList({ items, showCustomer, onOpen, label }: { items: HubAppointment[]; showCustomer: boolean; onOpen: (id: string) => void; label: string }) {
  return (
    <ul className="glass inset-list appointment-list" aria-label={label}>
      {items.map((item) => {
        const day = dayOf(item.start);
        return (
          <li key={item.id} className="list-item appointment-item">
            <button type="button" className="appointment-open" onClick={() => onOpen(item.id)}>
              <span className="appointment-date" aria-hidden="true"><strong className="numeric">{Number(day.slice(8))}</strong><small>{monthShort.format(Date.parse(`${day}T00:00:00Z`))}</small></span>
              <span className="list-row-text">
                <span className="list-row-title">{item.title}</span>
                <span className="list-row-subtitle">{formatDayShort(day)} · {formatTimeRange(item)}{showCustomer ? ` · ${item.customer ? `${item.customer.customerNumber} ${item.customer.company}` : "Intern"}` : ""}</span>
              </span>
              <StatusPill status={item.status} />
            </button>
            {item.status === "confirmed" && <TeamsJoin appointment={item} compact />}
          </li>
        );
      })}
    </ul>
  );
}
