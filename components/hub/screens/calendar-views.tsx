"use client";

import { CalendarOff, ChevronDown, Flag, Hand, NotebookPen, Plus, TriangleAlert, Video } from "lucide-react";
import {
  availableSpans, clockOf, dayOf, dayOff, exceptionsOn, formatDayLong, formatDayShort, layoutLanes, mergeIntervals, minutesOn, monthOf, monthWeeks, subtractSpans,
  timeOf, weekdayIndex, type Availability, type DaySpan, type Interval,
} from "@/lib/hub-calendar/rules";
import type { HubAppointment } from "@/lib/hub-calendar/types";
import { STATUS_NAMES } from "@/lib/hub-tasks/rules";
import { CustomerSign } from "./customer-sign";
import { TaskGlyph } from "./tasks-parts";
import type { CalendarNote } from "@/lib/hub-notes/types";
import type { CalendarGoal, CalendarTask } from "./calendar-store";

/*
 * The calendar's views (Kalender unter Projekte, 16.11.2026): week and day as a time grid with an all-day row, the
 * month as the classic grid, the list as four weeks grouped by day. Appointments, tasks with a date and the projects'
 * target dates come in from the screen, already narrowed to the chosen customer and the layers shown.
 */

export const HOUR_PX = 46;
const weekdayNames = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const monthLong = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", month: "long" });

/** An appointment as a view draws it; `faded` when a customer is chosen and it belongs to someone else. */
export type ViewAppointment = HubAppointment & { faded: boolean };
export type DayLabel = { text: string; tone: "ok" | "todo" | "bad" | "off" | "" };
export type OpenTarget = { kind: "appointment"; id: string } | { kind: "task"; id: string } | { kind: "goal"; id: string } | { kind: "note"; id: string; customerId: string };
/** A green block while editing the availability: from the weekly plan, or extra time of that one day. */
export type AvailBlock = { day: string; kind: "week"; from: number; to: number } | { day: string; kind: "extra"; id: string; from: number; to: number };

export type CalendarViewProps = {
  days: string[];
  today: string;
  now: number;
  admin: boolean;
  /** Customers' own view: other people's appointments never show, only free time. */
  apptsOn: (day: string) => ViewAppointment[];
  tasksOn: (day: string) => CalendarTask[];
  goalsOn: (day: string) => CalendarGoal[];
  /** Pages of the notes with a date (only those the person sees), all day like the target dates. */
  notesOn?: (day: string) => CalendarNote[];
  /** Appointments with a meeting note the person sees carry a small note mark. */
  hasNote?: (appointmentId: string) => boolean;
  /** Overdue open tasks, shown once on today. */
  overdue: CalendarTask[];
  dayLabel: (day: string) => DayLabel;
  /** Customers: the free time they may request on a day (empty for admins). */
  freeOn: (day: string) => Interval[];
  /** Whether a task can be dragged to another day (admins with a confirmed session). */
  canDragTasks: boolean;
  /** Tasks show their customer only while every customer is shown. */
  showCompany: boolean;
  tasksInfo?: React.ReactNode;
  /** When oalab offers appointments; admins see the rest grey, customers only their free time. */
  availability: Availability;
  /** Admins editing the availability: green blocks, „Tag aus“ per day, painting new time. */
  editing: boolean;
  onOpen: (target: OpenTarget) => void;
  onDay: (day: string) => void;
  onOverdue: () => void;
  onFree: (day: string, start: number) => void;
  onAvailBlock: (block: AvailBlock, event: React.MouseEvent<HTMLElement>) => void;
  onDayOff: (day: string) => void;
};

const taskTip = (task: CalendarTask) => [task.company, task.projectName, STATUS_NAMES[task.status], task.customerTurn ? "liegt beim Kunden" : ""].filter(Boolean).join(" · ");

function TaskChip({ task, today, draggable, showCompany, onOpen }: { task: CalendarTask; today: string; draggable: boolean; showCompany: boolean; onOpen: CalendarViewProps["onOpen"] }) {
  const late = Boolean(task.dueOn && task.dueOn < today && task.status !== "done");
  return (
    <button type="button" className={`cal-chip is-task${late ? " is-overdue" : ""}${task.status === "done" ? " is-done" : ""}`} data-drag={draggable ? `task:${task.id}` : undefined}
      data-tip={`#${task.number} ${task.title}`} data-tip-sub={`${taskTip(task)}${draggable ? " · ziehen ändert das Datum" : ""}`} onClick={() => onOpen({ kind: "task", id: task.id })}>
      <TaskGlyph status={task.status} size={12} />
      <span className="cal-chip-text">{showCompany && task.company ? <span className="cal-chip-num">{task.company} · </span> : null}{task.title}</span>
      {task.customerTurn && <span className="cal-chip-turn"><Hand size={11} aria-hidden="true" /></span>}
    </button>
  );
}

function GoalChip({ goal, today, showCompany, onOpen }: { goal: CalendarGoal; today: string; showCompany: boolean; onOpen: CalendarViewProps["onOpen"] }) {
  const late = goal.day < today && !goal.done;
  return (
    <button type="button" className={`cal-chip is-goal${late ? " is-overdue" : ""}${goal.done ? " is-done" : ""}`} data-tip={`Zieltermin: ${goal.name}`} data-tip-sub={goal.company || undefined} onClick={() => onOpen({ kind: "goal", id: goal.id })}>
      <Flag size={12} aria-hidden="true" /><span className="cal-chip-text">Ziel · {showCompany && goal.company ? goal.company : goal.name}</span>
    </button>
  );
}

function NoteChip({ note, onOpen }: { note: CalendarNote; onOpen: CalendarViewProps["onOpen"] }) {
  return (
    <button type="button" className="cal-chip is-note" data-tip={`Notiz: ${note.title}`} data-tip-sub="Öffnet die Seite in den Notizen" onClick={() => onOpen({ kind: "note", id: note.id, customerId: note.customerId })}>
      <NotebookPen size={12} aria-hidden="true" /><span className="cal-chip-text">Notiz · {note.title}</span>
    </button>
  );
}

function ApptChip({ item, admin, showCompany, note = false, onOpen }: { item: ViewAppointment; admin: boolean; showCompany: boolean; note?: boolean; onOpen: CalendarViewProps["onOpen"] }) {
  const who = item.customer?.company ?? "Intern";
  return (
    <button type="button" className={`cal-chip is-appt is-${item.status}${item.faded ? " is-faded" : ""}${item.customer ? "" : " is-internal"}`} data-tip={item.title}
      data-tip-sub={`${timeOf(item.start)}–${timeOf(item.end)} Uhr${admin ? ` · ${who}` : ""}${item.status === "requested" ? " · angefragt" : ""}${note ? " · mit Besprechungsnotiz" : ""}`} onClick={() => onOpen({ kind: "appointment", id: item.id })}>
      <span className="cal-chip-time numeric">{timeOf(item.start)}</span><span className="cal-chip-text">{admin && showCompany && item.customer ? item.customer.company : item.title}</span>
      {note && <span className="cal-chip-note"><NotebookPen size={11} aria-hidden="true" /></span>}
    </button>
  );
}

function OverdueChip({ tasks, onOverdue }: { tasks: CalendarTask[]; onOverdue: () => void }) {
  if (!tasks.length) return null;
  return (
    <button type="button" className="cal-chip is-overdue-sum" data-tip={tasks.length === 1 ? "1 Aufgabe ist überfällig" : `${tasks.length} Aufgaben sind überfällig`} data-tip-sub="In der Liste ansehen" onClick={onOverdue}>
      <TriangleAlert size={12} aria-hidden="true" /><span className="cal-chip-text">{tasks.length} überfällig</span>
    </button>
  );
}

/* ---------- Week and day: a time grid with an all-day row ---------- */

/** 7:00 to 19:00, wider where an appointment or the availability reaches further; 6:00 to 22:00 while editing it. */
function hourBounds(days: string[], apptsOn: CalendarViewProps["apptsOn"], availability: Availability, editing: boolean) {
  let from = editing ? 6 * 60 : 7 * 60;
  let to = editing ? 22 * 60 : 19 * 60;
  for (const day of days) {
    for (const item of apptsOn(day)) { from = Math.min(from, minutesOn(day, item.start)); to = Math.max(to, minutesOn(day, item.end)); }
    for (const [a, b] of availableSpans(availability, day)) { from = Math.min(from, a); to = Math.max(to, b); }
  }
  return [Math.floor(from / 60) * 60, Math.min(24 * 60, Math.ceil(to / 60) * 60)] as const;
}

export function WeekView(props: CalendarViewProps) {
  const { days, today, now, admin, apptsOn, tasksOn, goalsOn, notesOn, hasNote, overdue, dayLabel, freeOn, canDragTasks, showCompany, tasksInfo, availability, editing, onOpen, onDay, onOverdue, onFree, onAvailBlock, onDayOff } = props;
  const [from, to] = hourBounds(days, apptsOn, availability, editing);
  const y = (minutes: number) => ((minutes - from) / 60) * HOUR_PX;
  const height = y(to);
  const single = days.length === 1;
  const nowDay = dayOf(now);
  const nowMinutes = minutesOn(nowDay, now);
  const hours = Array.from({ length: (to - from) / 60 + 1 }, (_, index) => from + index * 60);

  return (
    <div className={`cal-wk${single ? " is-day" : ""}`} style={{ "--days": days.length, "--hour-px": `${HOUR_PX}px` } as React.CSSProperties}>
      <div className="cal-wk-top">
        <div className="cal-wk-head">
          <div className="cal-gutter" />
          {days.map((day) => {
            const label = dayLabel(day);
            const closed = !availableSpans(availability, day).length;
            const off = dayOff(availability, day);
            return (
              <div key={day} className={`cal-dh${day === today ? " is-today" : ""}${day < today ? " is-past" : ""}${closed ? " is-off" : ""}`}>
                <button type="button" className="cal-dh-btn" onClick={() => onDay(day)} data-tip={single ? formatDayLong(day) : "Tagesansicht"} aria-label={formatDayLong(day)}>
                  <span className="cal-dh-wd">{weekdayNames[weekdayIndex(day)]}</span><span className="cal-dh-num numeric">{Number(day.slice(8))}</span>
                  {single && <span className="cal-dh-long">{monthLong.format(Date.parse(`${day}T00:00:00Z`))}</span>}
                </button>
                {admin && editing && day >= today
                  ? <button type="button" className={`cal-dh-off${off ? " is-on" : ""}`} aria-pressed={Boolean(off)} onClick={() => onDayOff(day)}
                    data-tip={off ? "Abwesenheit entfernen" : "Den ganzen Tag nicht verfügbar"} data-tip-sub={formatDayShort(day)}>
                    <CalendarOff size={12} aria-hidden="true" />{off ? "Abwesend" : "Tag aus"}
                  </button>
                  : label.text && <span className={`cal-dh-free tone-${label.tone}`}>{label.text}</span>}
              </div>
            );
          })}
        </div>
        <div className="cal-wk-allday">
          <div className="cal-gutter cal-gutter-label"><span>ganz&shy;tägig</span>{tasksInfo}</div>
          {days.map((day) => {
            const goals = goalsOn(day);
            const dayTasks = tasksOn(day);
            const max = single ? 12 : 4;
            const chips = [
              ...(day === today && overdue.length ? [<OverdueChip key="overdue" tasks={overdue} onOverdue={onOverdue} />] : []),
              ...goals.map((goal) => <GoalChip key={`g-${goal.id}`} goal={goal} today={today} showCompany={showCompany} onOpen={onOpen} />),
              ...(notesOn?.(day) ?? []).map((note) => <NoteChip key={`n-${note.id}`} note={note} onOpen={onOpen} />),
              ...dayTasks.map((task) => <TaskChip key={`t-${task.id}`} task={task} today={today} draggable={canDragTasks} showCompany={showCompany && single} onOpen={onOpen} />),
            ];
            return (
              <div key={day} className={`cal-ad${day === today ? " is-today" : ""}`} data-drop-day={day} data-cell={day}>
                {chips.slice(0, max)}
                {chips.length > max && <button type="button" className="cal-more" onClick={() => onDay(day)}>+{chips.length - max} weitere</button>}
              </div>
            );
          })}
        </div>
      </div>
      <div className="cal-wk-body" data-start={from} data-end={to}>
        <div className="cal-times" style={{ height }}>
          {hours.map((minutes) => <span key={minutes} className="cal-hour" style={{ top: y(minutes) }}><span className="numeric">{clockOf(minutes)}</span></span>)}
        </div>
        {days.map((day) => {
          // Admins: what customers cannot request is grey; absences carry the team's note (customers never see it).
          const spans = availableSpans(availability, day);
          const absences = exceptionsOn(availability, day).filter((item) => item.kind === "off");
          const wholeDay = dayOff(availability, day);
          const offRanges: { span: DaySpan; label: string; absent: boolean }[] = !admin ? []
            : wholeDay ? [{ span: [from, to], label: wholeDay.note || "Abwesend", absent: true }]
            : subtractSpans([[from, to]], spans).map((span) => {
              const absence = absences.find((item) => item.from !== null && item.to !== null && item.from < span[1] && span[0] < item.to);
              return { span, label: absence ? absence.note || "Nicht verfügbar" : spans.length ? "" : "Kein Termintag", absent: Boolean(absence) };
            });
          // While editing: the bookable time as green blocks, the weekly plan and the extra time of that day apart.
          const canEdit = admin && editing && day >= today && !wholeDay;
          const offSpans = absences.flatMap((item): DaySpan[] => item.from === null || item.to === null ? [] : [[item.from, item.to]]);
          const weekly = canEdit ? subtractSpans(availability.week[weekdayIndex(day)] ?? [], offSpans) : [];
          const extras = canEdit ? exceptionsOn(availability, day).filter((item) => item.kind === "extra" && item.from !== null && item.to !== null) : [];
          const free = admin || day < nowDay ? [] : mergeIntervals(freeOn(day)).map((interval) => [minutesOn(day, interval.start), minutesOn(day, interval.end)] as [number, number]);
          const quiet: [number, number][] = [];
          if (!admin) {
            let cursor = from;
            for (const [a, b] of free) { if (a > cursor) quiet.push([cursor, a]); cursor = Math.max(cursor, b); }
            if (cursor < to) quiet.push([cursor, to]);
          }
          const placed = layoutLanes(apptsOn(day));
          return (
            <div key={day} className={`cal-col${day === today ? " is-today" : ""}${day < today ? " is-past" : ""}${canEdit ? " is-editing" : ""}`} data-col-day={day} data-drop-day={day}
              data-paint-day={canEdit ? day : undefined} style={{ height }}>
              {offRanges.map(({ span: [a, b], label: text, absent }) => (
                <div key={`off-${a}`} className={`cal-off${absent ? " is-absent" : ""}`} style={{ top: y(a), height: y(b) - y(a) }} aria-hidden="true">
                  {text && y(b) - y(a) >= 24 && (a === from || absent) && <span className="cal-off-label">{absent && <CalendarOff size={12} aria-hidden="true" />}{text}</span>}
                </div>
              ))}
              {weekly.map(([a, b]) => (
                <button key={`av-${a}`} type="button" className="cal-av" style={{ top: y(a) + 1, height: y(b) - y(a) - 2 }}
                  data-tip={`${clockOf(a)}–${clockOf(b)} Uhr, jede Woche`} data-tip-sub="Klick: herausnehmen" onClick={(event) => onAvailBlock({ day, kind: "week", from: a, to: b }, event)}>
                  <span className="cal-av-label numeric">{clockOf(a)}–{b === 1440 ? "24:00" : clockOf(b)}</span>
                </button>
              ))}
              {extras.map((item) => (
                <button key={item.id} type="button" className="cal-av is-extra" style={{ top: y(item.from!) + 1, height: y(item.to!) - y(item.from!) - 2 }}
                  data-tip={`${clockOf(item.from!)}–${clockOf(item.to!)} Uhr, nur an diesem Tag`} data-tip-sub={item.note || "Klick: entfernen"}
                  onClick={(event) => onAvailBlock({ day, kind: "extra", id: item.id, from: item.from!, to: item.to! }, event)}>
                  <span className="cal-av-label numeric">{clockOf(item.from!)}–{item.to === 1440 ? "24:00" : clockOf(item.to!)}</span>
                  {item.note && <span className="cal-av-note">{item.note}</span>}
                </button>
              ))}
              {quiet.map(([a, b]) => <div key={`quiet-${a}`} className="cal-off is-quiet" style={{ top: y(a), height: y(b) - y(a) }} aria-hidden="true" />)}
              {free.filter(([a, b]) => b - a >= 30).map(([a, b]) => (
                <button key={`free-${a}`} type="button" className="cal-free" style={{ top: y(a) + 1, height: y(b) - y(a) - 2 }}
                  data-tip="Hier anfragen" data-tip-sub={`${formatDayShort(day)}, frei ${clockOf(a)}–${clockOf(b)} Uhr`}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const at = a + Math.floor(((event.clientY - rect.top) / HOUR_PX) * 2) * 30;
                    onFree(day, Math.min(Math.max(a, at), b - 30));
                  }}>
                  <span className="cal-free-label"><Plus size={13} aria-hidden="true" />Frei</span>
                  {y(b) - y(a) >= 40 && <span className="cal-free-time numeric">{clockOf(a)}–{clockOf(b)}</span>}
                </button>
              ))}
              {placed.map((item) => {
                const top = y(minutesOn(day, item.start));
                const h = Math.max(y(minutesOn(day, item.end)) - top, 20);
                const who = item.customer ? item.customer.company : "Intern";
                const meta = `${timeOf(item.start)}–${timeOf(item.end)}${admin ? ` · ${who}` : ""}`;
                const past = item.end <= now;
                // While the availability is edited, appointments stay where they are.
                const canDrag = admin && !editing && item.status === "confirmed" && !past;
                return (
                  <button key={item.id} type="button"
                    className={`cal-ev is-${item.status}${item.faded ? " is-faded" : ""}${item.customer ? "" : " is-internal"}${past ? " is-past" : ""}${h < 36 ? " is-short" : h < 66 ? " is-compact" : ""}`}
                    style={{ top: top + 1, height: h - 2, left: `calc(${(item.lane / item.lanes) * 100}% + 3px)`, width: `calc(${100 / item.lanes}% - 6px)` }}
                    data-drag={canDrag ? `appt:${item.id}` : undefined} data-length={Math.round((item.end - item.start) / 60_000)} data-tip={item.title} data-tip-sub={`${meta}${item.status === "requested" ? " · angefragt" : ""}${hasNote?.(item.id) ? " · mit Besprechungsnotiz" : ""}`}
                    onClick={() => onOpen({ kind: "appointment", id: item.id })}>
                    {h < 36
                      ? <span className="cal-ev-line"><span className="cal-ev-time numeric">{timeOf(item.start)}</span> {item.title}</span>
                      : <><span className="cal-ev-title">{item.status === "requested" && <span className="cal-ev-tag">Anfrage</span>}{hasNote?.(item.id) && <NotebookPen className="cal-ev-note" size={12} aria-label="Mit Besprechungsnotiz" />}{item.title}</span><span className="cal-ev-meta numeric">{meta}</span></>}
                    {item.teamsUrl && item.status === "confirmed" && h >= 52 && <span className="cal-ev-teams"><Video size={12} aria-hidden="true" />Teams</span>}
                  </button>
                );
              })}
              {day === nowDay && nowMinutes >= from && nowMinutes <= to && <div className="cal-now" style={{ top: y(nowMinutes) }} aria-hidden="true" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Month: the classic grid; "+ weitere" opens the day ---------- */

export function MonthView({ days, today, admin, apptsOn, tasksOn, goalsOn, notesOn, hasNote, overdue, dayLabel, canDragTasks, showCompany, availability, onOpen, onDay, onOverdue, month }: CalendarViewProps & { month: string }) {
  const weeks = monthWeeks(month);
  return (
    <div className="cal-mo" style={{ "--weeks": weeks.length } as React.CSSProperties}>
      <div className="cal-mo-head" aria-hidden="true">{weekdayNames.map((name) => <span key={name}>{name}</span>)}</div>
      <div className="cal-mo-grid">
        {days.map((day) => {
          const label = dayLabel(day);
          const outside = monthOf(day) !== month;
          const chips = [
            ...(day === today && overdue.length ? [<OverdueChip key="overdue" tasks={overdue} onOverdue={onOverdue} />] : []),
            ...goalsOn(day).map((goal) => <GoalChip key={`g-${goal.id}`} goal={goal} today={today} showCompany={showCompany} onOpen={onOpen} />),
            ...(notesOn?.(day) ?? []).map((note) => <NoteChip key={`n-${note.id}`} note={note} onOpen={onOpen} />),
            ...tasksOn(day).map((task) => <TaskChip key={`t-${task.id}`} task={task} today={today} draggable={canDragTasks} showCompany={false} onOpen={onOpen} />),
            ...apptsOn(day).map((item) => <ApptChip key={`a-${item.id}`} item={item} admin={admin} showCompany={showCompany} note={hasNote?.(item.id)} onOpen={onOpen} />),
          ];
          const open = availableSpans(availability, day).length > 0;
          const absent = admin && Boolean(dayOff(availability, day));
          return (
            <div key={day} className={`cal-mc${outside ? " is-outside" : ""}${day === today ? " is-today" : ""}${day < today ? " is-past" : ""}${open ? "" : " is-off"}${absent ? " is-absent" : ""}`} data-drop-day={day} data-cell={day}>
              <div className="cal-mc-top">
                <button type="button" className="cal-mc-num numeric" onClick={() => onDay(day)} aria-label={formatDayLong(day)}>{Number(day.slice(8))}</button>
                {label.text && !outside && (open || absent) && <span className={`cal-mc-free tone-${label.tone}`}>{label.text}</span>}
              </div>
              <div className="cal-mc-items">
                {chips.slice(0, 3)}
                {chips.length > 3 && <button type="button" className="cal-more" onClick={() => onDay(day)}>+{chips.length - 3} weitere</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- List: four weeks as a table, grouped by day; requests and overdue rows carry the veil ---------- */

const statusNames: Record<HubAppointment["status"], string> = { requested: "Anfrage", confirmed: "Bestätigt", declined: "Abgelehnt", cancelled: "Abgesagt" };
const statusTones: Record<HubAppointment["status"], string> = { requested: "todo", confirmed: "ok", declined: "bad", cancelled: "off" };
const taskTones: Record<CalendarTask["status"], string> = { backlog: "off", todo: "info", progress: "ok", review: "todo", done: "off" };

export function ListView({ days, today, admin, apptsOn, tasksOn, goalsOn, notesOn, hasNote, overdue, onOpen, logoOf }: CalendarViewProps & { logoOf: (customerId: string) => Parameters<typeof CustomerSign>[0]["logo"] }) {
  const columns = admin ? 5 : 4;
  const customerCell = (id: string | null, company: string) => !admin ? null : (
    <td className="cal-ag-cust">{id ? <><CustomerSign customer={{ id, company }} logo={logoOf(id)} size="xs" /><span>{company}</span></> : <span className="cell-none">Intern</span>}</td>
  );
  const taskRow = (task: CalendarTask, showDay: boolean) => {
    const late = Boolean(task.dueOn && task.dueOn < today && task.status !== "done");
    return (
      <tr key={`t-${task.id}`} className={`cal-ag-row${late ? " has-veil veil-none" : ""}${task.status === "done" ? " is-done" : ""}`} tabIndex={0} onClick={() => onOpen({ kind: "task", id: task.id })} onKeyDown={(event) => { if (event.key === "Enter") onOpen({ kind: "task", id: task.id }); }}>
        <td className="cal-ag-time">{showDay && task.dueOn ? <><span className="numeric">{formatDayShort(task.dueOn)}</span><small className="is-overdue">überfällig</small></> : "ganztägig"}</td>
        <td className="cal-ag-title"><span className="cell-title"><TaskGlyph status={task.status} size={14} /><span>{admin && <span className="cal-chip-num numeric">#{task.number} </span>}{task.title}<small>{task.projectName}{task.customerTurn ? " · liegt beim Kunden" : ""}</small></span></span></td>
        {customerCell(task.customerId, task.company)}
        <td><span className={`chat-pill tone-${taskTones[task.status]}`}>{STATUS_NAMES[task.status]}</span></td>
        <td className="cal-ag-acts" />
      </tr>
    );
  };
  const bodies: React.ReactNode[] = [];
  const head = (label: React.ReactNode, count: number, glyph: React.ReactNode) => (
    <tr className="table-group"><th colSpan={columns} scope="rowgroup"><span className="table-group-in"><span className="table-group-toggle cal-ag-head"><ChevronDown size={16} className="table-group-chevron" aria-hidden="true" /><span className="table-group-glyph">{glyph}</span><span className="table-group-label">{label}</span><span className="table-group-count numeric">{count}</span></span></span></th></tr>
  );
  if (overdue.length && days[0] <= today) {
    bodies.push(<tbody key="overdue" className="table-group-body">{head("Überfällig", overdue.length, <TriangleAlert size={16} aria-hidden="true" />)}{overdue.map((task) => taskRow(task, true))}</tbody>);
  }
  for (const day of days) {
    const rows = [
      ...goalsOn(day).map((goal) => (
        <tr key={`g-${goal.id}`} className="cal-ag-row" tabIndex={0} onClick={() => onOpen({ kind: "goal", id: goal.id })} onKeyDown={(event) => { if (event.key === "Enter") onOpen({ kind: "goal", id: goal.id }); }}>
          <td className="cal-ag-time">ganztägig</td>
          <td className="cal-ag-title"><span className="cell-title"><Flag size={15} className="cal-ag-icon tone-bad" aria-hidden="true" /><span>Zieltermin: {goal.name}</span></span></td>
          {customerCell(goal.customerId, goal.company)}
          <td><span className="chat-pill tone-bad">Zieltermin</span></td>
          <td className="cal-ag-acts" />
        </tr>
      )),
      ...(notesOn?.(day) ?? []).map((note) => (
        <tr key={`n-${note.id}`} className="cal-ag-row" tabIndex={0} onClick={() => onOpen({ kind: "note", id: note.id, customerId: note.customerId })} onKeyDown={(event) => { if (event.key === "Enter") onOpen({ kind: "note", id: note.id, customerId: note.customerId }); }}>
          <td className="cal-ag-time">ganztägig</td>
          <td className="cal-ag-title"><span className="cell-title"><NotebookPen size={15} className="cal-ag-icon" aria-hidden="true" /><span>Notiz: {note.title}</span></span></td>
          {customerCell(note.customerId, "")}
          <td><span className="chat-pill tone-info">Notiz</span></td>
          <td className="cal-ag-acts" />
        </tr>
      )),
      ...tasksOn(day).map((task) => taskRow(task, false)),
      ...apptsOn(day).filter((item) => !item.faded).map((item) => (
        <tr key={`a-${item.id}`} className={`cal-ag-row${item.status === "requested" ? " has-veil veil-open" : ""}${item.status === "cancelled" || item.status === "declined" ? " is-done" : ""}`} tabIndex={0} onClick={() => onOpen({ kind: "appointment", id: item.id })} onKeyDown={(event) => { if (event.key === "Enter") onOpen({ kind: "appointment", id: item.id }); }}>
          <td className="cal-ag-time numeric">{timeOf(item.start)}–{timeOf(item.end)}</td>
          <td className="cal-ag-title"><span className="cell-title"><span>{item.title}</span></span></td>
          {customerCell(item.customer?.id ?? null, item.customer?.company ?? "")}
          <td><span className={`chat-pill tone-${statusTones[item.status]}`}>{statusNames[item.status]}</span></td>
          <td className="cal-ag-acts">{hasNote?.(item.id) ? <span className="row-action" data-tip="Mit Besprechungsnotiz"><NotebookPen size={15} aria-hidden="true" /></span> : null}{item.teamsUrl && item.status === "confirmed" ? <span className="row-action" data-tip="Teams-Meeting"><Video size={15} aria-hidden="true" /></span> : null}</td>
        </tr>
      )),
    ];
    if (!rows.length) continue;
    const label = `${formatDayLong(day)}${day === today ? " · heute" : ""}`;
    bodies.push(<tbody key={day} className="table-group-body">{head(label, rows.length, <span className="cal-ag-daynum numeric">{Number(day.slice(8))}</span>)}{rows}</tbody>);
  }
  if (!bodies.length) return <div className="sheet-empty"><p>In diesen vier Wochen steht nichts im Kalender.</p></div>;
  return (
    <table className="file-table cal-ag">
      <caption className="visually-hidden">Termine, Anfragen, Aufgaben und Zieltermine der nächsten vier Wochen</caption>
      <thead><tr><th scope="col">Zeit</th><th scope="col">Eintrag</th>{admin && <th scope="col">Kunde</th>}<th scope="col">Art</th><th scope="col" className="cal-ag-acts"><span className="visually-hidden">Mehr</span></th></tr></thead>
      {bodies}
    </table>
  );
}
