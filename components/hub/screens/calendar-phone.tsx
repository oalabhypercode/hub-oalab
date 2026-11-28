"use client";

import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Flag, Hand, NotebookPen, Plus, TriangleAlert } from "lucide-react";
import {
  addDays, clockOf, formatDayLong, formatDayShort, formatMonth, isoWeek, meetingProvider, mergeIntervals, minutesOn, monthOf, monthWeeks, timeOf, weekdayIndex, WEEKDAY_LONG, WEEKDAY_SHORT,
  type CalendarView,
} from "@/lib/hub-calendar/rules";
import type { CalendarNote } from "@/lib/hub-notes/types";
import { STATUS_NAMES } from "@/lib/hub-tasks/rules";
import { SegmentedControl } from "../controls";
import { JoinButton } from "../meeting";
import type { CalendarGoal, CalendarTask } from "./calendar-store";
import type { CalendarViewProps, ViewAppointment } from "./calendar-views";
import { TaskGlyph } from "./tasks-parts";

/*
 * The calendar on the phone (27.11.2026, preview „Version 3“ approved): below 768 px the pane shows views of its own
 * instead of the time grid, which there only scrolled sideways.
 * - Tag, the phone's start: a day card in the style of Apple's calendar widgets. The weekday in the accent over a large
 *   date, a small month at the right to pick another day, then the day's entries with a colour bar.
 * - Woche, Monat, Liste: rows like the Patch Notes on the phone, in small type: time | entry | status as a dot | the
 *   meeting's join button. Days are folder rows that fold. A running meeting or a request tints the whole row.
 * The screen (calendar.tsx) hands in the same data as to the desktop views and opens the same panels.
 */

type Entry =
  | { kind: "appt"; key: string; at: number; item: ViewAppointment }
  | { kind: "free"; key: string; at: number; to: number }
  | { kind: "goal"; key: string; goal: CalendarGoal }
  | { kind: "note"; key: string; note: CalendarNote }
  | { kind: "task"; key: string; task: CalendarTask }
  | { kind: "overdue"; key: string; tasks: CalendarTask[] };
type Timed = Extract<Entry, { at: number }>;
/** One row: what the four columns show, what a screen reader hears and what a tap opens. */
type Line = { tone: string; time: string; allDay?: boolean; title: React.ReactNode; dot: React.ReactNode; act?: React.ReactNode; label: string; onPress: () => void };

export type PhoneCalendarProps = CalendarViewProps & {
  view: CalendarView;
  /** The chosen day: the day card's day, the anchor of week, month and list. */
  day: string;
  /** What the range holds, like the desktop's footer. */
  summary: string;
  onView: (view: CalendarView) => void;
  /** Choose another day inside the view (the small month, the month grid). */
  onPick: (day: string) => void;
  onStep: (direction: 1 | -1) => void;
  onToday: () => void;
};

const VIEWS: { id: CalendarView; label: string; name: string }[] = [
  { id: "month", label: "Monat", name: "Monat" },
  { id: "week", label: "Woche", name: "Woche" },
  { id: "day", label: "Tag", name: "Tag" },
  { id: "list", label: "Liste", name: "Liste" },
];
const WEEKDAY_INITIAL = ["M", "D", "M", "D", "F", "S", "S"];
const monthName = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", month: "long" });
const dayMonth = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", day: "numeric", month: "short" });
const atDay = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** The range in the phone's narrow head: „Fr., 27. Nov.“, „23.–29. November“ with „KW 48“, „November 2026“, „27. Nov. – 24. Dez.“ */
function rangeTitle(view: CalendarView, day: string, days: string[]) {
  if (view === "day") return { title: formatDayShort(day), sub: "" };
  if (view === "month") return { title: formatMonth(monthOf(day)), sub: "" };
  const first = days[0];
  const last = days[days.length - 1];
  const span = `${dayMonth.format(atDay(first))} – ${dayMonth.format(atDay(last))}`;
  if (view === "list") return { title: span, sub: "" };
  return { title: monthOf(first) === monthOf(last) ? `${Number(first.slice(8))}.–${Number(last.slice(8))}. ${monthName.format(atDay(last))}` : span, sub: `KW ${isoWeek(first)}` };
}
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const restDay = (date: string) => weekdayIndex(date) >= 5;
/** „12.11.“ for the overdue tasks' days in the narrow time column. */
const shortDate = (day: string) => `${Number(day.slice(8))}.${Number(day.slice(5, 7))}.`;
/** „40 Min.“ or „1 Std. 10 Min.“ */
function timeLeft(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return minutes < 60 ? `${minutes} Min.` : `${Math.floor(minutes / 60)} Std.${minutes % 60 ? ` ${minutes % 60} Min.` : ""}`;
}
const closedName = (item: ViewAppointment) => item.status === "cancelled" ? "abgesagt" : "abgelehnt";

export function PhoneCalendar(props: PhoneCalendarProps) {
  const { view, day, days, today, now, admin, apptsOn, tasksOn, goalsOn, notesOn, hasNote, overdue, dayLabel, freeOn, showCompany, onOpen, onDay, onOverdue, onFree } = props;
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (key: string) => setFolded((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  /* ---------- What a day holds ---------- */
  // Customers (and freelancers) see the free time they may request; admins none.
  const freeSpans = (date: string): [number, number][] => admin || date < today ? []
    : mergeIntervals(freeOn(date)).map((interval): [number, number] => [minutesOn(date, interval.start), minutesOn(date, interval.end)]).filter(([from, to]) => to - from >= 30);
  // Appointments of other customers stay out while one customer is chosen, like in the desktop's list.
  const apptsShown = (date: string) => apptsOn(date).filter((item) => !item.faded);
  function entriesOf(date: string, { free = false, overdueRow = true } = {}): Entry[] {
    const allDay: Entry[] = [
      ...(overdueRow && date === today && overdue.length ? [{ kind: "overdue", key: "overdue", tasks: overdue } as const] : []),
      ...goalsOn(date).map((goal) => ({ kind: "goal", key: `g-${goal.id}`, goal }) as const),
      ...(notesOn?.(date) ?? []).map((note) => ({ kind: "note", key: `n-${note.id}`, note }) as const),
      ...tasksOn(date).map((task) => ({ kind: "task", key: `t-${task.id}`, task }) as const),
    ];
    const timed: Timed[] = [
      ...apptsShown(date).map((item) => ({ kind: "appt", key: `a-${item.id}`, at: minutesOn(date, item.start), item }) as const),
      ...(free ? freeSpans(date).map(([from, to]) => ({ kind: "free", key: `f-${from}`, at: from, to }) as const) : []),
    ];
    timed.sort((a, b) => a.at - b.at || Number(a.kind === "free") - Number(b.kind === "free"));
    return [...allDay, ...timed];
  }
  const relative = (date: string) => date === today ? "Heute" : date === addDays(today, 1) ? "Morgen" : "";
  /** „Heute · 2 Termine · 1 Anfrage · frei ab 09:00“; admins see how much time is left („3 Std. frei“). */
  function dayInfo(date: string) {
    const items = apptsShown(date);
    const confirmed = items.filter((item) => item.status === "confirmed").length;
    const requests = items.filter((item) => item.status === "requested" && item.end > now).length;
    const free = freeSpans(date);
    const parts = [
      relative(date) || (date < today ? "Vorbei" : ""),
      confirmed ? plural(confirmed, "Termin", "Termine") : "",
      requests ? plural(requests, "Anfrage", "Anfragen") : "",
      free.length ? `frei ab ${clockOf(free[0][0])}` : admin ? dayLabel(date).text : "",
    ];
    return parts.filter(Boolean).join(" · ") || (restDay(date) ? "Wochenende" : "Keine Termine");
  }
  /** The next day with free time, for „Heute ist nichts mehr frei“. */
  function nextFree(from: string) {
    for (let step = 1; step <= 21; step += 1) {
      const date = addDays(from, step);
      const free = freeSpans(date);
      if (free.length) return { date, at: free[0][0] };
    }
    return null;
  }

  /* ---------- Rows ---------- */
  function lineOf(date: string, entry: Entry, inOverdueGroup = false): Line {
    if (entry.kind === "appt") {
      const { item } = entry;
      const past = item.end <= now;
      const closed = item.status === "cancelled" || item.status === "declined";
      const live = item.status === "confirmed" && item.start <= now && now < item.end;
      const meeting = item.status === "confirmed" && !past && meetingProvider(item.teamsUrl) ? item.teamsUrl : null;
      const tone = closed ? "closed" : live ? "live" : past ? "past" : item.status === "requested" ? "req" : item.customer ? "appt" : "internal";
      const said = { closed: closedName(item), live: "läuft gerade", past: "vorbei", req: "Anfrage, wartet auf Bestätigung", appt: "bestätigt", internal: "intern" }[tone];
      const who = admin && showCompany ? item.customer?.company ?? "Intern" : "";
      return {
        tone,
        time: clockOf(entry.at),
        title: <span className="fl-title">{item.title}{who && <small> · {who}</small>}</span>,
        dot: <i className={`is-${tone}`} />,
        act: meeting ? <span className="cal-pr-join"><JoinButton url={meeting} variant="icon" live={live} sample={item.sample} /></span>
          : hasNote?.(item.id) ? <span className="cal-pr-mark" data-tip="Mit Besprechungsnotiz"><NotebookPen size={14} aria-label="Mit Besprechungsnotiz" /></span> : null,
        label: `${item.title}${who ? `, ${who}` : ""}, ${timeOf(item.start)} bis ${timeOf(item.end)} Uhr, ${said}`,
        onPress: () => onOpen({ kind: "appointment", id: item.id }),
      };
    }
    if (entry.kind === "free") {
      return {
        tone: "free",
        time: clockOf(entry.at),
        title: <span className="fl-title">Frei bis {clockOf(entry.to)}</span>,
        dot: <i className="is-free" />,
        act: <span className="cal-pr-plus" aria-hidden="true"><Plus size={15} /></span>,
        label: `Frei ${clockOf(entry.at)} bis ${clockOf(entry.to)} Uhr, hier anfragen`,
        onPress: () => onFree(date, entry.at),
      };
    }
    if (entry.kind === "task") {
      const { task } = entry;
      const late = Boolean(task.dueOn && task.dueOn < today && task.status !== "done");
      return {
        tone: late ? "late" : task.status === "done" ? "done" : "task",
        time: inOverdueGroup && task.dueOn ? shortDate(task.dueOn) : "ganztägig",
        allDay: !inOverdueGroup,
        title: <span className="fl-title">{admin && <span className="cal-pr-num numeric">#{task.number} </span>}{task.title}{showCompany && task.company && <small> · {task.company}</small>}</span>,
        dot: <TaskGlyph status={task.status} size={12} />,
        act: task.customerTurn ? <span className="cal-pr-mark is-turn" data-tip="Liegt beim Kunden"><Hand size={14} aria-label="Liegt beim Kunden" /></span> : null,
        label: `Aufgabe${admin ? ` #${task.number}` : ""} ${task.title}, ${STATUS_NAMES[task.status]}${late ? ", überfällig" : ""}`,
        onPress: () => onOpen({ kind: "task", id: task.id }),
      };
    }
    if (entry.kind === "goal") {
      const { goal } = entry;
      return {
        tone: goal.done ? "done" : "goal",
        time: "ganztägig",
        allDay: true,
        title: <span className="fl-title">Zieltermin: {goal.name}{showCompany && goal.company && <small> · {goal.company}</small>}</span>,
        dot: <i className="is-goal" />,
        label: `Zieltermin ${goal.name}${goal.done ? ", erreicht" : ""}`,
        onPress: () => onOpen({ kind: "goal", id: goal.id }),
      };
    }
    if (entry.kind === "note") {
      const { note } = entry;
      return {
        tone: "note",
        time: "ganztägig",
        allDay: true,
        title: <span className="fl-title">Notiz: {note.title}</span>,
        dot: <i className="is-note" />,
        label: `Notiz ${note.title}, öffnet die Seite in den Notizen`,
        onPress: () => onOpen({ kind: "note", id: note.id, customerId: note.customerId }),
      };
    }
    return {
      tone: "late",
      time: "heute",
      allDay: true,
      title: <span className="fl-title">{plural(entry.tasks.length, "Aufgabe", "Aufgaben")} überfällig</span>,
      dot: <i className="is-late" />,
      act: <span className="cal-pr-mark" aria-hidden="true"><ChevronRight size={15} /></span>,
      label: `${plural(entry.tasks.length, "Aufgabe ist", "Aufgaben sind")} überfällig, in der Liste ansehen`,
      onPress: onOverdue,
    };
  }
  const row = (line: Line, key: string, alt: boolean) => (
    <li key={key} className={`fl-row cal-pr is-${line.tone}${alt ? " is-alt" : ""}`}>
      <button type="button" className="cal-pr-hit" aria-label={line.label} onClick={line.onPress} />
      <span className={`fl-cell cal-pr-time numeric${line.allDay ? " is-allday" : ""}`}>{line.time}</span>
      <span className="fl-cell cal-pr-title">{line.title}</span>
      <span className="fl-cell cal-pr-dot" aria-hidden="true">{line.dot}</span>
      <span className="fl-cell cal-pr-act">{line.act}</span>
    </li>
  );
  const head = (
    <div className="fl-head" aria-hidden="true">
      <span className="fl-col cal-pr-time">Zeit</span><span className="fl-col cal-pr-title">Eintrag</span><span className="fl-col cal-pr-dot" /><span className="fl-col cal-pr-act" />
    </div>
  );

  /** Days as folder rows with their entries, like the patches; the week keeps empty days, the list leaves them out. */
  function dayRows(dates: string[], week: boolean) {
    const groups: React.ReactNode[] = [];
    let index = 0;
    const group = (key: string, folder: React.ReactNode, lines: { key: string; line: Line }[]) => {
      const open = !folded.has(key);
      groups.push(
        <li key={key} className="cal-pg">
          {folder}
          {open && lines.length > 0 && <ul className="cal-pr-list" role="list">{lines.map(({ key: lineKey, line }) => row(line, lineKey, index++ % 2 === 1))}</ul>}
        </li>,
      );
    };
    const folder = (key: string, { name, label, glyph, note, tone = "", className = "", count, openDay }: { name: string; label: React.ReactNode; glyph: React.ReactNode; note: string; tone?: string; className?: string; count: number; openDay?: string }) => {
      const open = !folded.has(key);
      return (
        <div className={`fl-row is-folder cal-pd${className}${open ? " is-open" : ""}${index++ % 2 === 1 ? " is-alt" : ""}`}>
          {count ? <button type="button" className="fl-twist" aria-expanded={open} aria-label={`${name} ${open ? "zuklappen" : "aufklappen"}`} onClick={() => toggle(key)}><ChevronRight size={13} aria-hidden="true" /></button>
            : <span className="fl-twist is-none" aria-hidden="true" />}
          <span className="fl-icon cal-pd-icon" aria-hidden="true">{glyph}</span>
          <span className="fl-title">{label}</span>
          <span className={`cal-pd-note${tone ? ` tone-${tone}` : ""}`}>{note}</span>
          {openDay && <button type="button" className="cal-pd-open" onClick={() => onDay(openDay)} aria-label={`${formatDayLong(openDay)} als Tag öffnen`}><ChevronRight size={16} aria-hidden="true" /></button>}
        </div>
      );
    };
    // The list starts with the overdue tasks, as on the desktop.
    if (!week && overdue.length && dates[0] <= today) {
      const lines = overdue.map((task) => ({ key: `o-${task.id}`, line: lineOf(today, { kind: "task", key: task.id, task }, true) }));
      group("overdue", folder("overdue", { name: "Überfällig", label: "Überfällig", glyph: <TriangleAlert size={15} />, note: String(overdue.length), className: " is-late", count: lines.length }), lines);
    }
    for (const date of dates) {
      const entries = entriesOf(date, { overdueRow: week });
      if (!week && !entries.length) continue;
      const lines = entries.map((entry) => ({ key: entry.key, line: lineOf(date, entry) }));
      let note = entries.length ? String(entries.length) : "";
      let tone = "";
      if (week) {
        const free = freeSpans(date);
        const label = dayLabel(date);
        if (free.length) { note = `frei ab ${clockOf(free[0][0])}`; tone = "ok"; }
        else if (admin && label.text) { note = label.text; tone = label.tone; }
        else if (!entries.length) note = restDay(date) ? "Wochenende" : "keine Termine";
      }
      const rel = relative(date);
      const label = <>{rel && <b>{rel}</b>}{formatDayShort(date)}</>;
      group(date, folder(date, {
        name: formatDayLong(date), label, glyph: <CalendarDays size={15} />, note, tone, count: lines.length, openDay: week || view === "list" ? date : undefined,
        className: `${date === today ? " is-today" : ""}${date < today ? " is-past" : ""}`,
      }), lines);
    }
    return groups;
  }

  /* ---------- The views ---------- */
  const running = apptsShown(today).find((item) => item.status === "confirmed" && item.start <= now && now < item.end && meetingProvider(item.teamsUrl));
  const liveBar = (view === "day" || view === "month") && day !== today && running ? (
    <div className="cal-livebar" role="status">
      <span className="cal-livebar-dot" aria-hidden="true" />
      <span className="cal-livebar-text"><b>Läuft gerade</b><span>{running.title}</span></span>
      <JoinButton url={running.teamsUrl!} variant="list" live sample={running.sample} />
    </div>
  ) : null;

  let body: React.ReactNode;
  if (view === "day") {
    body = <DayCard {...{ day, today, now, admin, showCompany }} entries={entriesOf(day, { free: true })} info={dayInfo(day)} next={!admin && day >= today && !freeSpans(day).length ? nextFree(day) : null}
      onPick={props.onPick} onOpen={onOpen} onFree={onFree} onOverdue={onOverdue} />;
  } else if (view === "month") {
    const month = monthOf(day);
    const entries = entriesOf(day, { free: true });
    body = (
      <>
        <MonthGrid month={month} day={day} today={today} dots={dotsOf} onPick={props.onPick} />
        <section className="cal-pm-day" aria-label={formatDayLong(day)}>
          <header className="cal-pm-day-head">
            <span><strong>{formatDayLong(day)}</strong><span>{dayInfo(day)}</span></span>
            <button type="button" className="cal-pm-day-open" onClick={() => onDay(day)}>Tag<ChevronRight size={15} aria-hidden="true" /></button>
          </header>
          <div className="fl cal-pn">
            {head}
            <ul className="cal-pr-list" role="list">
              {entries.length ? entries.map((entry, index) => row(lineOf(day, entry), entry.key, index % 2 === 1))
                : <li className="fl-row cal-pr is-empty"><span className="fl-cell cal-pr-time" /><span className="fl-cell cal-pr-title"><span className="fl-title">{restDay(day) ? "Wochenende" : "Keine Termine"}</span></span><span className="fl-cell" /><span className="fl-cell" /></li>}
            </ul>
          </div>
        </section>
      </>
    );
  } else {
    const groups = dayRows(days, view === "week");
    body = groups.length
      ? <div className="fl cal-pn">{head}<ul className="cal-pg-list" role="list">{groups}</ul></div>
      : <p className="cal-pm-empty">In diesen vier Wochen steht nichts im Kalender.</p>;
  }

  /** Up to three dots under a day of the month: appointments, a request, target dates, tasks, notes, free time. */
  function dotsOf(date: string) {
    const items = apptsShown(date).filter((item) => item.status === "confirmed" || item.status === "requested");
    const dots: string[] = items.filter((item) => item.status === "confirmed").slice(0, 2).map((item) => item.end <= now ? "is-past" : "is-appt");
    if (items.some((item) => item.status === "requested")) dots.push("is-req");
    if (goalsOn(date).length) dots.push("is-goal");
    if (tasksOn(date).length) dots.push("is-task");
    if (notesOn?.(date).length) dots.push("is-note");
    if (freeSpans(date).length) dots.push("is-free");
    return dots.slice(0, 3);
  }

  const current = view === "day" ? day === today : view === "month" ? monthOf(day) === monthOf(today) : days.includes(today);
  const range = rangeTitle(view, day, days);
  const legend: [string, string][] = admin
    ? [["is-appt", "Termin"], ["is-req", "Anfrage"], ["is-task", "Aufgabe"], ["is-goal", "Zieltermin"], ["is-note", "Notiz"]]
    : [["is-appt", "Dein Termin"], ["is-req", "Anfrage"], ["is-free", "Frei"], ["is-task", "Aufgabe"], ["is-goal", "Zieltermin"]];
  return (
    <div className="cal-pm">
      <div className="cal-pm-controls">
        <SegmentedControl label="Ansicht" value={view} onChange={props.onView} options={VIEWS} />
        <div className="cal-pm-nav">
          <h2 className="cal-pm-range" aria-live="polite"><span>{range.title}</span>{range.sub && <small>{range.sub}</small>}</h2>
          <button type="button" className={`cal-today${current ? " is-current" : ""}`} onClick={props.onToday}>Heute</button>
          <button type="button" className="cal-nav-btn" onClick={() => props.onStep(-1)} aria-label="Zurück"><ChevronLeft size={18} aria-hidden="true" /></button>
          <button type="button" className="cal-nav-btn" onClick={() => props.onStep(1)} aria-label="Weiter"><ChevronRight size={18} aria-hidden="true" /></button>
        </div>
      </div>
      {liveBar}
      <div className={`cal-pm-body is-${view}`}>{body}</div>
      <div className="cal-pm-foot">
        <span>{props.summary}</span>
        <span className="cal-pm-legend">{legend.map(([cls, text]) => <span key={cls}><i className={cls} aria-hidden="true" />{text}</span>)}</span>
      </div>
    </div>
  );
}

/* ---------- Tag: the day card ---------- */

function DayCard({ day, today, now, admin, showCompany, entries, info, next, onPick, onOpen, onFree, onOverdue }: {
  day: string;
  today: string;
  now: number;
  admin: boolean;
  showCompany: boolean;
  entries: Entry[];
  info: string;
  /** For customers on a day without free time: the next day with some. */
  next: { date: string; at: number } | null;
  onPick: (day: string) => void;
  onOpen: CalendarViewProps["onOpen"];
  onFree: CalendarViewProps["onFree"];
  onOverdue: () => void;
}) {
  const hit = (label: string, onClick: () => void) => <button type="button" className="cal-pr-hit" aria-label={label} onClick={onClick} />;
  const item = (entry: Entry) => {
    if (entry.kind === "appt") {
      const { item: appt } = entry;
      const past = appt.end <= now;
      const closed = appt.status === "cancelled" || appt.status === "declined";
      const live = appt.status === "confirmed" && appt.start <= now && now < appt.end;
      const meeting = appt.status === "confirmed" && !past && meetingProvider(appt.teamsUrl) ? appt.teamsUrl : null;
      const tone = closed ? "closed" : live ? "live" : past ? "past" : appt.status === "requested" ? "req" : appt.customer ? "appt" : "internal";
      const who = admin && showCompany ? appt.customer?.company ?? "Intern" : "";
      const extra = live ? ` · noch ${timeLeft(appt.end - now)}` : tone === "req" ? " · wartet auf Bestätigung" : closed ? ` · ${closedName(appt)}` : "";
      return (
        <li key={entry.key} className={`cal-aw-ev is-${tone}`}>
          {hit(`${appt.title}${who ? `, ${who}` : ""}, ${timeOf(appt.start)} bis ${timeOf(appt.end)} Uhr${live ? ", läuft gerade" : tone === "req" ? ", Anfrage" : past ? ", vorbei" : ""}`, () => onOpen({ kind: "appointment", id: appt.id }))}
          <span className="cal-aw-bar" aria-hidden="true" />
          <span className="cal-aw-text"><b>{appt.title}</b><span className="numeric">{timeOf(appt.start)}–{timeOf(appt.end)}{extra}{who && ` · ${who}`}</span></span>
          {meeting && <span className="cal-aw-join"><JoinButton url={meeting} variant="icon" live={live} sample={appt.sample} /></span>}
        </li>
      );
    }
    if (entry.kind === "free") {
      return (
        <li key={entry.key} className="cal-aw-ev is-free">
          {hit(`Frei ${clockOf(entry.at)} bis ${clockOf(entry.to)} Uhr, hier anfragen`, () => onFree(day, entry.at))}
          <span className="cal-aw-bar" aria-hidden="true" />
          <span className="cal-aw-text"><b>Frei</b><span className="numeric">{clockOf(entry.at)}–{clockOf(entry.to)}</span></span>
          <span className="cal-aw-ask" aria-hidden="true">Anfragen<ChevronRight size={14} /></span>
        </li>
      );
    }
    // All-day entries: tinted bars at the top of the card.
    const bar = (tone: string, glyph: React.ReactNode, text: string, label: string, onClick: () => void) => (
      <li key={entry.key} className={`cal-aw-allday is-${tone}`}>{hit(label, onClick)}{glyph}<span>{text}</span></li>
    );
    if (entry.kind === "goal") return bar(entry.goal.done ? "done" : "goal", <Flag size={14} aria-hidden="true" />, `Zieltermin: ${entry.goal.name}`, `Zieltermin ${entry.goal.name}`, () => onOpen({ kind: "goal", id: entry.goal.id }));
    if (entry.kind === "note") return bar("note", <NotebookPen size={14} aria-hidden="true" />, `Notiz: ${entry.note.title}`, `Notiz ${entry.note.title}, öffnet die Seite in den Notizen`, () => onOpen({ kind: "note", id: entry.note.id, customerId: entry.note.customerId }));
    if (entry.kind === "task") {
      const { task } = entry;
      const late = Boolean(task.dueOn && task.dueOn < today && task.status !== "done");
      return bar(late ? "late" : task.status === "done" ? "done" : "task", <TaskGlyph status={task.status} size={13} />, `${admin ? `#${task.number} ` : ""}${task.title}`,
        `Aufgabe ${task.title}, ${STATUS_NAMES[task.status]}`, () => onOpen({ kind: "task", id: task.id }));
    }
    return bar("late", <TriangleAlert size={14} aria-hidden="true" />, `${plural(entry.tasks.length, "Aufgabe", "Aufgaben")} überfällig`, "Überfällige Aufgaben in der Liste ansehen", onOverdue);
  };
  const empty = restDay(day) ? "Wochenende – keine Termine." : day < today ? "An diesem Tag gab es keine Termine." : "Keine Termine.";
  return (
    <div className="cal-aw">
      <div className="cal-aw-top">
        <div className="cal-aw-date">
          <span className="cal-aw-wd">{WEEKDAY_LONG[weekdayIndex(day)]}</span>
          <span className="cal-aw-num numeric">{Number(day.slice(8))}</span>
          <span className="cal-aw-sub">{info}</span>
        </div>
        <MiniMonth day={day} today={today} onPick={onPick} />
      </div>
      {entries.length > 0 && <ul className="cal-aw-list" role="list">{entries.map(item)}</ul>}
      {(!entries.length || next) && (
        <p className="cal-aw-note">
          {next ? <>{day === today ? "Heute ist nichts mehr frei" : "An diesem Tag ist nichts frei"} · <button type="button" className="cal-link" onClick={() => onPick(next.date)}>{next.date === addDays(today, 1) ? "morgen" : formatDayShort(next.date)} ab {clockOf(next.at)}</button></> : empty}
        </p>
      )}
    </div>
  );
}

/** The day card's small month: today in the accent, the chosen day filled. */
function MiniMonth({ day, today, onPick }: { day: string; today: string; onPick: (day: string) => void }) {
  const month = monthOf(day);
  return (
    <div className="cal-awm" role="group" aria-label={formatMonth(month)}>
      <span className="cal-awm-title">{monthName.format(Date.parse(`${month}-01T00:00:00Z`))}</span>
      <div className="cal-awm-grid">
        {WEEKDAY_INITIAL.map((initial, index) => <span key={index} className="cal-awm-wd" aria-hidden="true">{initial}</span>)}
        {monthWeeks(month).flat().map((date) => monthOf(date) !== month
          ? <span key={date} className="cal-awm-gap" aria-hidden="true" />
          : <button key={date} type="button" className={`cal-awm-day numeric${date === today ? " is-today" : ""}${date < today ? " is-past" : ""}`} aria-pressed={date === day}
            aria-label={`${formatDayLong(date)}${date === today ? ", heute" : ""}`} onClick={() => onPick(date)}>{Number(date.slice(8))}</button>)}
      </div>
    </div>
  );
}

/* ---------- Monat: the grid with dots; the chosen day's rows stand under it ---------- */

function MonthGrid({ month, day, today, dots, onPick }: { month: string; day: string; today: string; dots: (date: string) => string[]; onPick: (day: string) => void }) {
  return (
    <div className="cal-pm-month">
      <div className="cal-pm-mo-head" aria-hidden="true">{WEEKDAY_SHORT.map((name) => <span key={name}>{name}</span>)}</div>
      <div className="cal-pm-mo-grid" role="group" aria-label={`Tage im ${formatMonth(month)}`}>
        {monthWeeks(month).flat().map((date) => (
          <button key={date} type="button" className={`cal-pm-mc${monthOf(date) !== month ? " is-outside" : ""}${date === today ? " is-today" : ""}${date < today ? " is-past" : ""}`}
            aria-pressed={date === day} aria-label={`${formatDayLong(date)}${date === today ? ", heute" : ""}`} onClick={() => onPick(date)}>
            <span className="cal-pm-mc-num numeric">{Number(date.slice(8))}</span>
            <span className="cal-pm-dots" aria-hidden="true">{dots(date).map((cls, index) => <i key={index} className={cls} />)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
