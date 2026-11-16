"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  CalendarDays, CalendarOff, CalendarPlus, Check, ChevronLeft, ChevronRight, Clock, Inbox, Layers, MousePointerClick, Paintbrush, Plus, Repeat, Search, SlidersHorizontal,
  SquareKanban, Trash2, type LucideIcon,
} from "lucide-react";
import { confirmSessionHref } from "@/lib/auth-redirect";
import { categories } from "@/lib/categories";
import {
  adminFree, availableSpans, calendarWindow, clockOf, customerFree, dayOf, dayOff, formatDayLong, formatDayShort, formatHours, formatMonth, isCalendarView, isDay,
  isoWeek, LIST_DAYS, mergeSpans, minutesOn, monthOf, stepDay, subtractSpans, timeOf, viewDays, weekdayIndex, weekDays, weekSummary, WEEKDAY_LONG,
  type CalendarView, type DaySpan,
} from "@/lib/hub-calendar/rules";
import type { HubAppointment } from "@/lib/hub-calendar/types";
import { hubHref } from "@/lib/hub-data";
import { taskFixtures } from "@/lib/hub-tasks/fixtures";
import type { TaskBoardState } from "@/lib/hub-tasks/types";
import { useStoredValue } from "@/lib/use-stored-value";
import { HeaderActions } from "../app-shell";
import { GlassCard } from "../glass";
import { SegmentedControl } from "../controls";
import { useInfo } from "../info-box";
import { LargeTitleHeader } from "../large-title-header";
import { SheetActionMenu, ToolbarMenu } from "../sheet";
import { CustomerSign } from "./customer-sign";
import { AvailabilityPanel, type ExceptionPreset } from "./calendar-availability";
import { AppointmentPanel, AskPanel, CustomerAppointmentPanel, GoalPanel, NewTaskPanel, RequestPanel, TaskPanel, type TaskProjectOption } from "./calendar-panels";
import { boardTasks, projectGoals, projectTasks, useCalendarStore, type CalendarTask } from "./calendar-store";
import { HOUR_PX, ListView, MonthView, WeekView, type AvailBlock, type CalendarViewProps, type DayLabel, type OpenTarget, type ViewAppointment } from "./calendar-views";
import type { ScreenProps } from "./types";

/*
 * „Kalender“ under Projekte (user 16.11.2026): like the other „je Kunde“ pages the customers on the left and a normal
 * calendar on the right (month, week, day, list). Every task with a date stands on its day; dragging it changes the
 * date in the board and in Studio as well. Appointments move by dragging, requests are answered in a panel, also at
 * another free time. Customers see their own appointments, released tasks and target dates, and request a free time.
 */

type Panel =
  | { kind: "appointment"; id: string }
  | { kind: "new"; day: string; start: string; customerId: string | null; title?: string }
  | { kind: "task"; id: string }
  | { kind: "goal"; id: string }
  | { kind: "newTask"; day: string }
  | { kind: "ask"; day: string; start?: string }
  | { kind: "avail"; preset?: ExceptionPreset | null };
type Layer = "appts" | "requests" | "tasks" | "goals" | "cancelled" | "done";
type FloatItem = { icon: LucideIcon; label: string; hint?: string; danger?: boolean; run: () => void };
/** The small menu at the pointer: create something in an empty slot, or decide what painted or clicked green time means. */
type Float = { x: number; y: number; title: string; items: FloatItem[] };
type Toast = { text: string; undo?: () => void };

const LAYERS: { id: Layer; label: string; admin?: boolean }[] = [
  { id: "appts", label: "Termine" },
  { id: "requests", label: "Anfragen", admin: true },
  { id: "tasks", label: "Aufgaben mit Datum" },
  { id: "goals", label: "Zieltermine der Projekte" },
  { id: "cancelled", label: "Abgesagte Termine" },
  { id: "done", label: "Erledigte Aufgaben", admin: true },
];
const DEFAULT_LAYERS = "appts,requests,tasks,goals";
const VIEW_NAMES: Record<CalendarView, string> = { month: "Monat", week: "Woche", day: "Tag", list: "Liste" };
const MINUTE = 60_000;
const byStart = (a: HubAppointment, b: HubAppointment) => a.start - b.start;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Dragging tasks to another day and appointments to another time, with the mouse or a finger. */
function useCalendarDrag(root: React.RefObject<HTMLElement | null>, enabled: boolean, onTask: (id: string, day: string) => void, onAppointment: (id: string, day: string, minute: number) => void) {
  const handlers = useRef({ onTask, onAppointment });
  useEffect(() => { handlers.current = { onTask, onAppointment }; });
  useEffect(() => {
    const element = root.current;
    if (!element || !enabled) return;
    let drag: { kind: "task" | "appt"; id: string; source: HTMLElement; x: number; y: number; dx: number; dy: number; ghost: HTMLElement | null; target: { day: string; minute: number | null } | null } | null = null;
    const clear = () => {
      element.querySelectorAll(".is-drop").forEach((node) => node.classList.remove("is-drop"));
      element.querySelectorAll(".cal-drop-mark").forEach((node) => node.remove());
    };
    const minuteAt = (column: HTMLElement, clientY: number) => {
      const body = column.closest<HTMLElement>(".cal-wk-body");
      const start = Number(body?.dataset.start ?? 0);
      return start + ((clientY - column.getBoundingClientRect().top) / HOUR_PX) * 60;
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const source = (event.target as Element | null)?.closest<HTMLElement>("[data-drag]");
      if (!source || !element.contains(source)) return;
      const [kind, id] = (source.dataset.drag ?? "").split(":");
      const rect = source.getBoundingClientRect();
      drag = { kind: kind === "task" ? "task" : "appt", id, source, x: event.clientX, y: event.clientY, dx: event.clientX - rect.left, dy: event.clientY - rect.top, ghost: null, target: null };
    };
    const onMove = (event: PointerEvent) => {
      if (!drag) return;
      if (!drag.ghost) {
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
        const ghost = drag.source.cloneNode(true) as HTMLElement;
        const rect = drag.source.getBoundingClientRect();
        ghost.classList.add("cal-ghost");
        Object.assign(ghost.style, { width: `${rect.width}px`, height: `${rect.height}px`, left: "0px", top: "0px" });
        document.body.append(ghost);
        drag.ghost = ghost;
        drag.source.classList.add("is-drag-source");
        document.documentElement.classList.add("is-dragging");
      }
      event.preventDefault();
      drag.ghost.style.transform = `translate(${event.clientX - drag.dx}px, ${event.clientY - drag.dy}px)`;
      clear();
      drag.target = null;
      const under = document.elementFromPoint(event.clientX, event.clientY);
      if (drag.kind === "task") {
        const cell = under?.closest<HTMLElement>("[data-drop-day]");
        if (cell && element.contains(cell)) {
          const day = cell.dataset.dropDay!;
          (cell.classList.contains("cal-col") ? element.querySelector<HTMLElement>(`.cal-ad[data-drop-day="${day}"]`) ?? cell : cell).classList.add("is-drop");
          drag.target = { day, minute: null };
        }
      } else {
        const column = under?.closest<HTMLElement>(".cal-col");
        const cell = under?.closest<HTMLElement>(".cal-mc");
        const length = Number(drag.source.dataset.length ?? 60);
        if (column && element.contains(column)) {
          const minute = Math.max(0, Math.round(minuteAt(column, event.clientY - drag.dy + 4) / 15) * 15);
          const start = Number(column.closest<HTMLElement>(".cal-wk-body")?.dataset.start ?? 0);
          const mark = document.createElement("div");
          mark.className = "cal-drop-mark";
          mark.style.top = `${((minute - start) / 60) * HOUR_PX}px`;
          mark.style.height = `${(length / 60) * HOUR_PX}px`;
          mark.textContent = `${clockOf(minute)}–${clockOf(Math.min(minute + length, 24 * 60))}`;
          column.append(mark);
          drag.target = { day: column.dataset.colDay!, minute };
        } else if (cell && element.contains(cell)) {
          cell.classList.add("is-drop");
          drag.target = { day: cell.dataset.dropDay!, minute: null };
        }
      }
    };
    const onUp = () => {
      if (!drag) return;
      const current = drag;
      drag = null;
      clear();
      if (!current.ghost) return;
      current.ghost.remove();
      current.source.classList.remove("is-drag-source");
      document.documentElement.classList.remove("is-dragging");
      // The click that follows the drop must not open the item.
      const swallow = (event: Event) => { event.stopPropagation(); event.preventDefault(); };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      if (!current.target) return;
      if (current.kind === "task") handlers.current.onTask(current.id, current.target.day);
      else handlers.current.onAppointment(current.id, current.target.day, current.target.minute ?? -1);
    };
    element.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      element.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [root, enabled]);
}

/**
 * Painting availability: while editing, a drag over an editable day column (not over a block or an appointment) draws
 * a green span on the quarter hour; on release the page asks whether it holds every week or only on that day.
 */
function useAvailabilityPaint(root: React.RefObject<HTMLElement | null>, enabled: boolean, onPaint: (day: string, from: number, to: number, x: number, y: number) => void) {
  const handler = useRef(onPaint);
  useEffect(() => { handler.current = onPaint; });
  useEffect(() => {
    const element = root.current;
    if (!element || !enabled) return;
    let paint: { column: HTMLElement; day: string; start: number; anchor: number; from: number; to: number; ghost: HTMLElement | null } | null = null;
    const minuteAt = (column: HTMLElement, clientY: number) => {
      const start = Number(column.closest<HTMLElement>(".cal-wk-body")?.dataset.start ?? 0);
      const raw = start + ((clientY - column.getBoundingClientRect().top) / HOUR_PX) * 60;
      return Math.min(24 * 60, Math.max(0, Math.round(raw / 15) * 15));
    };
    const draw = () => {
      if (!paint) return;
      if (!paint.ghost) {
        paint.ghost = document.createElement("div");
        paint.ghost.className = "cal-paint";
        paint.column.append(paint.ghost);
      }
      paint.ghost.style.top = `${((paint.from - paint.start) / 60) * HOUR_PX}px`;
      paint.ghost.style.height = `${((paint.to - paint.from) / 60) * HOUR_PX}px`;
      paint.ghost.textContent = `${clockOf(paint.from)}–${paint.to === 1440 ? "24:00" : clockOf(paint.to)}`;
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target as Element | null;
      const column = target?.closest<HTMLElement>("[data-paint-day]");
      if (!column || !element.contains(column) || target?.closest("button, a, .cal-av, .cal-ev")) return;
      const anchor = minuteAt(column, event.clientY);
      paint = { column, day: column.dataset.paintDay!, start: Number(column.closest<HTMLElement>(".cal-wk-body")?.dataset.start ?? 0), anchor, from: anchor, to: anchor, ghost: null };
      event.preventDefault();
    };
    const onMove = (event: PointerEvent) => {
      if (!paint) return;
      event.preventDefault();
      const minute = minuteAt(paint.column, event.clientY);
      paint.from = Math.min(paint.anchor, minute);
      paint.to = Math.max(paint.anchor, minute);
      if (paint.to - paint.from >= 15) draw();
    };
    const onUp = (event: PointerEvent) => {
      if (!paint) return;
      const current = paint;
      paint = null;
      current.ghost?.remove();
      if (current.to - current.from < 15) return;
      // The click that follows the drag must not open anything underneath.
      const swallow = (click: Event) => { click.stopPropagation(); click.preventDefault(); };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      handler.current(current.day, current.from, current.to, event.clientX, event.clientY);
    };
    element.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      element.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [root, enabled]);
}

export function CalendarScreen({ calendar, projects, preview, freelancer, fileState, asOf, taskBoard }: ScreenProps & { taskBoard?: TaskBoardState }) {
  const admin = calendar.canManage;
  const board = useMemo(() => admin ? (preview ? taskFixtures(asOf) : taskBoard) : undefined, [admin, preview, asOf, taskBoard]);
  const taskList = useMemo<CalendarTask[]>(() => admin ? (board && !board.error ? boardTasks(board, projects, calendar.customers) : []) : projectTasks(projects), [admin, board, projects, calendar.customers]);
  const store = useCalendarStore(calendar, taskList, board?.people ?? []);
  const { today, now } = store;
  const goals = useMemo(() => projectGoals(projects), [projects]);
  const logos = useMemo(() => new Map(fileState.customers.flatMap((customer) => customer.logo ? [[customer.id, customer.logo] as const] : [])), [fileState.customers]);
  const range = useMemo(() => calendarWindow(today), [today]);

  // Where the page opens: a notice's appointment (?appointment=), a day (?day=, from the projects page), a customer.
  const params = useSearchParams();
  const linked = store.appointments.find((item) => item.id === params.get("appointment"));
  // The view: from the address, else the last one in this browser, else the week.
  const [storedView, setStoredView] = useStoredValue("oalab-calendar-view", "week");
  const [chosenView, setChosenView] = useState<CalendarView | null>(() => isCalendarView(params.get("view")) ? params.get("view") as CalendarView : null);
  const view: CalendarView = chosenView ?? (isCalendarView(storedView) ? storedView : "week");
  const startDay = linked ? dayOf(linked.start) : params.get("day");
  const [day, setDay] = useState(() => isDay(startDay) ? startDay : today);
  const [selected, setSelected] = useState<string | null>(() => admin && store.customers.some((customer) => customer.id === params.get("customer")) ? params.get("customer") : null);
  const [paneOpen, setPaneOpen] = useState(() => Boolean(params.get("customer")));
  const [panel, setPanel] = useState<Panel | null>(() => linked ? { kind: "appointment", id: linked.id } : null);
  const [storedLayers, setStoredLayers] = useStoredValue("oalab-calendar-layers", DEFAULT_LAYERS);
  const layers = useMemo(() => new Set(storedLayers.split(",").filter(Boolean) as Layer[]), [storedLayers]);
  const on = useCallback((layer: Layer) => layers.has(layer), [layers]);
  const [listQuery, setListQuery] = useState("");
  const [listFilter, setListFilter] = useState<"all" | "appts" | "requests">("all");
  const [float, setFloat] = useState<Float | null>(null);
  // Admins editing the availability right in the week (approved preview 16.11.2026).
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const setView = (next: CalendarView) => { setChosenView(next); setStoredView(next); };
  // The choice stays in the address (shareable, survives a reload) without asking the server again.
  useEffect(() => {
    const query = new URLSearchParams();
    if (selected) query.set("customer", selected);
    if (view !== "week") query.set("view", view);
    if (day !== today) query.set("day", day);
    if (panel?.kind === "appointment") query.set("appointment", panel.id);
    const text = query.toString();
    const next = `${window.location.pathname}${text ? `?${text}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", next);
  }, [selected, view, day, panel, today]);

  const showToast = useCallback((text: string, undo?: () => void) => {
    window.clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = window.setTimeout(() => setToast(null), undo ? 6500 : 3600);
  }, []);
  const finish = (message: string) => { setPanel(null); setNotice(message); };

  /* ---------- What the calendar shows: the chosen customer, the layers ---------- */
  const tasks = store.tasks;
  const inScope = useCallback((customerId: string | null) => !admin || selected === null || customerId === selected, [admin, selected]);
  const apptsOn = useCallback((date: string): ViewAppointment[] => store.appointments
    .filter((item) => dayOf(item.start) === date || (dayOf(item.end - 1) === date && dayOf(item.start) < date))
    .filter((item) => item.status === "requested" ? (admin ? on("requests") : true) : item.status === "confirmed" ? on("appts") : on("cancelled"))
    .map((item) => ({ ...item, faded: admin && selected !== null && item.customer?.id !== selected }))
    .filter((item) => !(item.faded && item.status !== "confirmed" && item.status !== "requested"))
    .sort(byStart), [store.appointments, admin, selected, on]);
  const tasksOn = useCallback((date: string) => on("tasks") ? tasks.filter((task) => task.dueOn === date && inScope(task.customerId) && (task.status !== "done" || (admin && on("done")))).sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || b.number - a.number) : [], [tasks, inScope, admin, on]);
  const goalsOn = useCallback((date: string) => on("goals") ? goals.filter((goal) => goal.day === date && inScope(goal.customerId)) : [], [goals, inScope, on]);
  const overdue = useMemo(() => on("tasks") ? tasks.filter((task) => task.dueOn && task.dueOn < today && task.status !== "done" && inScope(task.customerId)) : [], [tasks, today, inScope, on]);
  // Customers request inside oalab's availability, after the lead time, with the buffer around booked appointments.
  const { availability } = store;
  const freeOn = useCallback((date: string) => admin || freelancer ? [] : customerFree(availability, date, store.busy, store.own, now, today), [admin, freelancer, availability, store.busy, store.own, now, today]);
  const dayLabel = useCallback((date: string): DayLabel => {
    if (admin && dayOff(availability, date)) return { text: "Abwesend", tone: "off" };
    if (!availableSpans(availability, date).length) return { text: admin ? "Kein Termintag" : "", tone: "off" };
    if (date < today) return { text: "", tone: "" };
    if (admin) {
      const free = adminFree(availability, date, store.busy, now).reduce((sum, item) => sum + item.end - item.start, 0) / MINUTE;
      return free > 0 ? { text: `${formatHours(free)} frei`, tone: "ok" } : { text: "Ausgebucht", tone: "todo" };
    }
    if (freelancer) return { text: "", tone: "" };
    return freeOn(date).some((interval) => interval.end - interval.start >= 30 * MINUTE) ? { text: "Frei", tone: "ok" } : { text: "Belegt", tone: "off" };
  }, [admin, freelancer, today, availability, store.busy, now, freeOn]);

  const days = viewDays(view, view === "list" && day < today && monthOf(day) === monthOf(today) ? today : day);
  const rangeDays = new Set(days);
  const counts = {
    confirmed: days.flatMap(apptsOn).filter((item) => !item.faded && item.status === "confirmed").length,
    requested: days.flatMap(apptsOn).filter((item) => !item.faded && item.status === "requested" && item.end > now).length,
    due: tasks.filter((task) => task.dueOn && rangeDays.has(task.dueOn) && task.status !== "done" && inScope(task.customerId)).length,
  };
  const openRequests = store.appointments.filter((item) => item.status === "requested" && item.end > now && inScope(item.customer?.id ?? null)).sort(byStart);

  /* ---------- Writing: moving tasks and appointments by dragging ---------- */
  const moveTaskTo = useCallback(async (id: string, date: string) => {
    const task = tasks.find((item) => item.id === id);
    if (!task || task.dueOn === date) return;
    const before = task.dueOn;
    const result = await store.saveTask(task, { dueOn: date });
    if (!result.ok) { setNotice(""); showToast(result.error); return; }
    showToast(`#${task.number} jetzt fällig am ${formatDayShort(date)} · gilt auch im Board`, () => { void store.saveTask({ ...task, dueOn: date }, { dueOn: before }); });
  }, [tasks, store, showToast]);
  const moveAppointmentTo = useCallback(async (id: string, date: string, minute: number) => {
    const item = store.appointments.find((entry) => entry.id === id);
    if (!item) return;
    const start = minute >= 0 ? clockOf(minute) : timeOf(item.start);
    if (dayOf(item.start) === date && timeOf(item.start) === start) return;
    const before = { day: dayOf(item.start), start: timeOf(item.start) };
    const result = await store.move(item, date, start);
    if (!result.ok) { showToast(result.error); return; }
    showToast(`„${item.title}“ → ${formatDayShort(date)}, ${start}${item.customer ? ` · ${item.customer.company} bekommt eine Meldung` : ""}`, () => { void store.move({ ...item }, before.day, before.start); });
  }, [store, showToast]);
  useCalendarDrag(root, admin, (id, date) => void moveTaskTo(id, date), (id, date, minute) => void moveAppointmentTo(id, date, minute));

  /* ---------- Availability: edited right in the week, every change applies at once ---------- */
  const span = (from: number, to: number) => `${clockOf(from)}–${to === 1440 ? "24:00" : clockOf(to)}`;
  const report = useCallback((result: { ok: true } | { ok: false; error: string }, message: string) => showToast(result.ok ? message : result.error), [showToast]);
  const weekWith = (index: number, spans: DaySpan[]) => availability.week.map((spansOfDay, position) => position === index ? mergeSpans(spans) : spansOfDay);
  const toggleEditing = () => {
    setFloat(null);
    // Painting needs the time grid: month and list switch to the week.
    if (!editing && (view === "month" || view === "list")) setView("week");
    setEditing((current) => !current);
  };
  const onPaint = (date: string, from: number, to: number, x: number, y: number) => {
    const index = weekdayIndex(date);
    setFloat({ x, y, title: `${formatDayShort(date)}, ${span(from, to)} Uhr`, items: [
      { icon: Repeat, label: `Jeden ${WEEKDAY_LONG[index]}`, hint: "Kommt in den Wochenplan",
        run: () => void store.saveWeek(weekWith(index, [...availability.week[index], [from, to]])).then((result) => report(result, `${WEEKDAY_LONG[index]}s ${span(from, to)} Uhr verfügbar.`)) },
      { icon: CalendarPlus, label: `Nur am ${formatDayShort(date)}`, hint: "Zusätzliche Zeit an diesem Tag",
        run: () => void store.addException({ kind: "extra", from: date, start: clockOf(from), end: to === 1440 ? "24:00" : clockOf(to) }).then((result) => report(result, `${formatDayShort(date)}, ${span(from, to)} Uhr zusätzlich verfügbar.`)) },
    ] });
  };
  const onAvailBlock = (block: AvailBlock, event: React.MouseEvent<HTMLElement>) => {
    const title = `${formatDayShort(block.day)}, ${span(block.from, block.to)} Uhr`;
    if (block.kind === "extra") {
      setFloat({ x: event.clientX, y: event.clientY, title, items: [
        { icon: Trash2, label: "Zusätzliche Zeit entfernen", danger: true, run: () => void store.removeException(block.id).then((result) => report(result, "Zusätzliche Zeit entfernt.")) },
      ] });
      return;
    }
    const index = weekdayIndex(block.day);
    setFloat({ x: event.clientX, y: event.clientY, title, items: [
      { icon: CalendarOff, label: `Nur am ${formatDayShort(block.day)} herausnehmen`, hint: "Abwesenheit für diese Zeit",
        run: () => void store.addException({ kind: "off", from: block.day, allDay: false, start: clockOf(block.from), end: block.to === 1440 ? "24:00" : clockOf(block.to) }).then((result) => report(result, `${title}: nicht verfügbar.`)) },
      { icon: Repeat, label: `Jeden ${WEEKDAY_LONG[index]} herausnehmen`, hint: "Aus dem Wochenplan", danger: true,
        run: () => void store.saveWeek(weekWith(index, subtractSpans(availability.week[index], [[block.from, block.to]]))).then((result) => report(result, `${WEEKDAY_LONG[index]}s ${span(block.from, block.to)} Uhr nicht mehr im Wochenplan.`)) },
    ] });
  };
  const onDayOff = (date: string) => {
    const off = dayOff(availability, date);
    if (off) void store.removeException(off.id).then((result) => report(result, `${formatDayShort(date)} ist wieder verfügbar.`));
    else void store.addException({ kind: "off", from: date, allDay: true }).then((result) => report(result, `${formatDayShort(date)}: den ganzen Tag nicht verfügbar.`));
  };
  useAvailabilityPaint(root, admin && editing && (view === "week" || view === "day"), onPaint);

  /* ---------- Opening things ---------- */
  const open = (target: OpenTarget) => { setFloat(null); setNotice(""); setPanel(target.kind === "appointment" ? { kind: "appointment", id: target.id } : target.kind === "task" ? { kind: "task", id: target.id } : { kind: "goal", id: target.id }); };
  // A new appointment starts at the first free hour of the day inside the availability, else at ten.
  const firstStart = (date: string) => {
    const free = adminFree(availability, date, store.busy, now).find((interval) => interval.end - interval.start >= 60 * MINUTE);
    return free ? clockOf(Math.min(Math.ceil(minutesOn(date, free.start) / 30) * 30, 23 * 60)) : "10:00";
  };
  const newAppointment = (date = day < today ? today : day, start?: string, title?: string, customerId: string | null = selected) => { setFloat(null); setNotice(""); setPanel({ kind: "new", day: date, start: start ?? firstStart(date), customerId, title }); };
  const goToday = () => { setDay(today); };
  const step = (direction: 1 | -1) => setDay((current) => {
    const next = stepDay(view, current, direction, today);
    return monthOf(next) < range.firstMonth || monthOf(next) > range.lastMonth ? current : next;
  });

  // Keys: ← → step, T today, N a new appointment (admins) while nobody types and no panel is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || panel) return;
      if ((event.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable='true'], dialog, [role='menu']")) return;
      if (event.key === "Escape" && float) { setFloat(null); return; }
      if (event.key === "Escape" && editing) { setEditing(false); return; }
      if (event.key === "ArrowLeft") step(-1);
      else if (event.key === "ArrowRight") step(1);
      else if (event.key.toLowerCase() === "t") goToday();
      else if (event.key.toLowerCase() === "n" && admin) { event.preventDefault(); newAppointment(); }
      else if (event.key.toLowerCase() === "v" && admin) { event.preventDefault(); toggleEditing(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // A click into empty calendar space: admins get a small menu to create something right there.
  function onEmptyClick(event: React.MouseEvent) {
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input")) return;
    const column = target.closest<HTMLElement>(".cal-col");
    const cell = target.closest<HTMLElement>("[data-cell]");
    const date = column?.dataset.colDay ?? cell?.dataset.cell;
    if (!date) return;
    if (!admin) {
      if (!freelancer && cell && view === "month" && freeOn(date).length) setPanel({ kind: "ask", day: date });
      return;
    }
    // While the availability is edited, a drag paints; a plain click does nothing.
    if (editing) return;
    let minute: number | null = null;
    if (column) {
      const start = Number(column.closest<HTMLElement>(".cal-wk-body")?.dataset.start ?? 0);
      minute = Math.floor((start + ((event.clientY - column.getBoundingClientRect().top) / HOUR_PX) * 60) / 30) * 30;
    }
    const at = minute;
    setFloat({ x: event.clientX, y: event.clientY, title: at !== null ? `${formatDayShort(date)}, ${clockOf(at)} Uhr` : formatDayLong(date), items: [
      { icon: CalendarPlus, label: "Termin anlegen", hint: at !== null ? `${clockOf(at)}–${clockOf(at + 60)} Uhr` : undefined, run: () => newAppointment(date, at !== null ? clockOf(at) : undefined) },
      { icon: SquareKanban, label: "Aufgabe mit diesem Datum", hint: "Steht danach auch im Board", run: () => setPanel({ kind: "newTask", day: date }) },
      ...(at !== null ? [{ icon: Inbox, label: "Zeit blockieren", hint: "Interner Termin, für Kunden belegt", run: () => newAppointment(date, clockOf(at), "Blockiert", null) }] : []),
    ] });
  }
  useEffect(() => {
    if (!float) return;
    const close = (event: PointerEvent) => { if (!(event.target as Element | null)?.closest(".cal-float")) setFloat(null); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [float]);

  /* ---------- Pieces of the page ---------- */
  const tasksInfo = useInfo("Aufgaben im Kalender", {
    steps: [
      <><b>Jede Aufgabe mit Datum</b> steht an ihrem Fälligkeitstag.</>,
      <><b>Ziehen</b> ändert das Datum, auch im Board und im Studio.</>,
      <><b>Ein Klick</b> öffnet die Aufgabe.</>,
    ],
    ask: "Wie hängen Aufgaben und Kalender zusammen?",
  });
  // Tasks are Studio's rows: without a session confirmed by a code they stay read-only, with the way to the code.
  const confirmHref = admin && store.live && !calendar.confirmed ? confirmSessionHref(hubHref(false, "calendar")) : null;
  const facts = useMemo(() => new Map(store.customers.map((customer) => {
    const upcoming = store.appointments.filter((item) => item.customer?.id === customer.id && item.end > now && (item.status === "confirmed" || item.status === "requested")).sort(byStart);
    return [customer.id, {
      upcoming,
      requests: upcoming.filter((item) => item.status === "requested"),
      overdue: tasks.filter((task) => task.customerId === customer.id && task.dueOn && task.dueOn < today && task.status !== "done"),
    }];
  })), [store.customers, store.appointments, tasks, now, today]);
  const chosen = selected ? store.customers.find((customer) => customer.id === selected) ?? null : null;
  const taskProjects: TaskProjectOption[] = (board?.projects ?? []).map((project) => ({ id: project.id, name: project.name, company: project.company, done: project.status === "complete" }));

  const viewProps: CalendarViewProps = {
    days, today, now, admin, apptsOn, tasksOn, goalsOn, overdue, dayLabel, freeOn, canDragTasks: store.canEditTasks,
    showCompany: admin && selected === null, tasksInfo: admin ? tasksInfo.button : undefined,
    availability, editing: admin && editing,
    onOpen: open,
    onDay: (date) => { setDay(date); setView(admin ? "day" : "week"); },
    onOverdue: () => { setEditing(false); setView("list"); setDay(today); },
    onFree: (date, minute) => setPanel({ kind: "ask", day: date, start: clockOf(minute) }),
    onAvailBlock, onDayOff,
  };
  const content = view === "month" ? <MonthView {...viewProps} month={monthOf(day)} />
    : view === "list" ? <ListView {...viewProps} logoOf={(id) => logos.get(id) ?? null} />
    : <WeekView {...viewProps} />;

  const title = view === "month" ? formatMonth(monthOf(day)) : view === "day" ? formatDayLong(day) : view === "week" ? weekTitle(day) : `${formatDayShort(days[0])} – ${formatDayShort(days[days.length - 1])}`;
  const titleSub = view === "week" || view === "day" ? `KW ${isoWeek(day)}` : view === "list" ? `${LIST_DAYS / 7} Wochen` : "";
  const viewOptions = (Object.keys(VIEW_NAMES) as CalendarView[]).filter((id) => admin || id !== "day").map((id) => ({ id, label: VIEW_NAMES[id], name: VIEW_NAMES[id] }));
  const changedLayers = LAYERS.filter((layer) => admin || !layer.admin).filter((layer) => DEFAULT_LAYERS.split(",").includes(layer.id) !== on(layer.id)).length;
  const toggleLayer = (layer: Layer) => { const next = new Set(layers); if (next.has(layer)) next.delete(layer); else next.add(layer); setStoredLayers([...next].join(",")); };

  const toolbar = (
    <div className="sheet-toolbar cal-toolbar">
      <div className="cal-nav" role="group" aria-label="Zeitraum">
        <button type="button" className="cal-nav-btn" onClick={() => step(-1)} aria-label="Zurück" data-tip="Zurück" data-tip-kbd="←"><ChevronLeft size={18} aria-hidden="true" /></button>
        <button type="button" className={`cal-today${days.includes(today) ? " is-current" : ""}`} onClick={goToday} data-tip={formatDayLong(today)} data-tip-kbd="T">Heute</button>
        <button type="button" className="cal-nav-btn" onClick={() => step(1)} aria-label="Weiter" data-tip="Weiter" data-tip-kbd="→"><ChevronRight size={18} aria-hidden="true" /></button>
      </div>
      <h2 className="cal-title" aria-live="polite">{title}{titleSub && <span className="cal-title-sub">{titleSub}</span>}</h2>
      <span className="sheet-spacer" />
      <ToolbarMenu icon={Layers} label="Anzeigen" badge={changedLayers} align="end">
        <div className="sheet-choices" role="group" aria-label="Im Kalender zeigen">
          {LAYERS.filter((layer) => admin || !layer.admin).map((layer) => (
            <button key={layer.id} type="button" role="menuitemcheckbox" aria-checked={on(layer.id)} className="sheet-choice" onClick={() => toggleLayer(layer.id)}>
              {layer.label}<Check className="hub-option-check" size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
      </ToolbarMenu>
      <SegmentedControl label="Ansicht" value={view} onChange={(next: CalendarView) => { if (next === "month" || next === "list") setEditing(false); setView(next); }} options={viewOptions} />
      {admin && <SheetActionMenu label="Kalender" actions={[
        { icon: CalendarPlus, label: "Neuer Termin", hint: "Mit oder ohne Kunde", shortcut: "N", onSelect: () => newAppointment() },
        { icon: SquareKanban, label: "Neue Aufgabe mit Datum", hint: "Steht danach auch im Board", onSelect: () => setPanel({ kind: "newTask", day: day < today ? today : day }) },
        { icon: Clock, label: editing ? "Bearbeiten beenden" : "Verfügbarkeit bearbeiten", hint: "Direkt in der Woche ziehen", shortcut: "V", onSelect: toggleEditing },
        { icon: CalendarOff, label: "Abwesenheit eintragen", hint: "Urlaub, Messe, privat", onSelect: () => setPanel({ kind: "avail", preset: { kind: "off", day: day < today ? today : day } }) },
        { icon: SlidersHorizontal, label: "Wochenplan & Regeln", hint: "Vorlauf, Puffer, Dauern", onSelect: () => setPanel({ kind: "avail" }) },
      ]} />}
    </div>
  );
  const strip = admin && editing && (view === "week" || view === "day")
    ? (
      <div className="cal-strip is-edit" role="status">
        <span className="cal-strip-icon"><Paintbrush size={15} aria-hidden="true" /></span>
        <span className="cal-strip-text">{store.availabilityReady
          ? <><b>Verfügbarkeit bearbeiten.</b> Zieh über eine Zeit, um sie buchbar zu machen. Ein Klick auf einen grünen Block nimmt ihn wieder heraus, „Tag aus“ sperrt den ganzen Tag.</>
          : <><b>Noch nicht speicherbar.</b> Die Datenbank-Erweiterung für die Verfügbarkeit fehlt noch; bis dahin gelten montags bis freitags 9 bis 17 Uhr.</>}</span>
        <span className="cal-strip-acts">
          <button type="button" className="sheet-action" onClick={() => setPanel({ kind: "avail" })}><SlidersHorizontal size={15} aria-hidden="true" /><span className="cal-head-label">Wochenplan & Regeln</span></button>
          <button type="button" className="sheet-action is-primary" onClick={toggleEditing}><Check size={15} aria-hidden="true" />Fertig</button>
        </span>
      </div>
    )
    : admin
    ? openRequests.length > 0 && on("requests") && (
      <div className="cal-strip is-requests">
        <span className="cal-strip-icon"><Inbox size={15} aria-hidden="true" /></span>
        <span className="cal-strip-text"><b>{plural(openRequests.length, "offene Anfrage", "offene Anfragen")}</b></span>
        <span className="cal-strip-items">
          {openRequests.map((item) => (
            <button key={item.id} type="button" className="cal-req" onClick={() => { setDay(dayOf(item.start)); open({ kind: "appointment", id: item.id }); }} data-tip={item.title} data-tip-sub="Anfrage beantworten">
              {item.customer && <CustomerSign customer={item.customer} logo={logos.get(item.customer.id) ?? null} size="xs" />}
              <span className="cal-req-name">{item.customer?.company ?? "Kunde"}</span><span className="cal-req-when numeric">{formatDayShort(dayOf(item.start))}, {timeOf(item.start)}</span><ChevronRight size={14} aria-hidden="true" />
            </button>
          ))}
        </span>
      </div>
    )
    : !freelancer && view !== "list" && (
      <div className="cal-strip is-free">
        <span className="cal-strip-icon"><MousePointerClick size={15} aria-hidden="true" /></span>
        <span className="cal-strip-text"><b>Grün heißt frei.</b> Klick auf eine freie Zeit, um dort einen Termin anzufragen. oalab bestätigt ihn dann.</span>
      </div>
    );
  const legend = (
    <span className="cal-legend">
      {(admin
        ? [["is-confirmed", "Termin"], ["is-requested", "Anfrage"], ["is-task", "Aufgabe"], ["is-goal", "Zieltermin"], ...(editing ? [["is-avail", "Verfügbar"]] : []), ["is-off", "Nicht verfügbar"]]
        : [["is-confirmed", "Dein Termin"], ["is-requested", "Deine Anfrage"], ...(freelancer ? [] : [["is-free", "Frei"]]), ["is-task", "Aufgabe"], ["is-goal", "Zieltermin"]]
      ).map(([cls, label]) => <span key={cls} className="cal-key"><span className={`cal-key-swatch ${cls}`} aria-hidden="true" />{label}</span>)}
    </span>
  );
  const footer = (
    <div className="sheet-footer cal-footer">
      <span>{plural(counts.confirmed, "Termin", "Termine")}{admin ? ` · ${plural(counts.requested, "Anfrage", "Anfragen")}` : ""} · {plural(counts.due, "Aufgabe", "Aufgaben")}</span>
      {legend}
    </div>
  );
  const pane = (
    <section className="am-pane cal-pane" aria-label="Kalender">
      {admin ? (
        <header className="am-pane-head">
          <button type="button" className="chat-back" onClick={() => setPaneOpen(false)} aria-label="Zurück zu den Kunden"><ChevronLeft size={24} aria-hidden="true" /></button>
          {chosen ? <CustomerSign customer={chosen} logo={logos.get(chosen.id) ?? null} size="lg" /> : <span className="am-tile is-lg cal-tile"><CalendarDays size={22} aria-hidden="true" /></span>}
          <div className="am-pane-title">
            <strong>{chosen ? chosen.company : "Alle Kunden"}</strong>
            <span>{chosen
              ? `${chosen.customerNumber} · ${facts.get(chosen.id)?.upcoming[0] ? `nächster Termin ${formatDayShort(dayOf(facts.get(chosen.id)!.upcoming[0].start))}, ${timeOf(facts.get(chosen.id)!.upcoming[0].start)}` : "kein Termin geplant"}`
              : `${titleSub || title}: ${plural(counts.confirmed, "Termin", "Termine")} · ${plural(counts.requested, "Anfrage", "Anfragen")} · ${plural(counts.due, "Aufgabe", "Aufgaben")} fällig`}</span>
          </div>
          <Link className="sheet-action" href={`${hubHref(preview, "projects")}/tasks`} data-tip="Zum Aufgaben-Board"><SquareKanban size={15} aria-hidden="true" /><span className="cal-head-label">Aufgaben</span></Link>
          <button type="button" className={`sheet-action cal-avail-action${editing ? " is-on" : ""}`} aria-pressed={editing} onClick={toggleEditing}
            data-tip={editing ? "Bearbeiten beenden" : "Verfügbarkeit im Kalender bearbeiten"} data-tip-sub={weekSummary(availability.week)} data-tip-kbd="V">
            <Clock size={15} aria-hidden="true" /><span className="cal-head-label">Verfügbarkeit</span>
          </button>
          <button type="button" className="sheet-action is-primary" onClick={() => newAppointment()} data-tip-compact="Neuer Termin" data-tip-kbd="N"><Plus size={15} aria-hidden="true" /><span className="cal-head-label" data-tip-label>Termin</span></button>
        </header>
      ) : (
        <header className="am-pane-head">
          {store.customers[0] ? <CustomerSign customer={store.customers[0]} logo={logos.get(store.customers[0].id) ?? null} size="lg" /> : <span className="am-tile is-lg cal-tile"><CalendarDays size={22} aria-hidden="true" /></span>}
          <div className="am-pane-title">
            <strong>{freelancer ? "Kalender" : "Deine Termine bei oalab"}</strong>
            <span>{(() => { const next = store.appointments.filter((item) => item.status === "confirmed" && item.end > now).sort(byStart)[0]; return next ? `Nächster Termin: ${formatDayShort(dayOf(next.start))}, ${timeOf(next.start)} · ${next.title}` : "Noch kein Termin geplant"; })()}</span>
          </div>
          {!freelancer && store.customers.length > 0 && <button type="button" className="sheet-action is-primary" onClick={() => setPanel({ kind: "ask", day: day < today ? today : day })}><CalendarPlus size={15} aria-hidden="true" /><span className="cal-head-label">Termin anfragen</span></button>}
        </header>
      )}
      {toolbar}
      {strip}
      {tasksInfo.box}
      <div className={`am-scroll cal-scroll is-${view}`} ref={scroller} onClick={onEmptyClick}>{content}</div>
      {footer}
    </section>
  );

  // Week and day open at eight in the morning.
  useEffect(() => {
    const element = scroller.current;
    if (!element || (view !== "week" && view !== "day")) return;
    const start = Number(element.querySelector<HTMLElement>(".cal-wk-body")?.dataset.start ?? 7 * 60);
    element.scrollTop = Math.max(0, ((8 * 60 - start) / 60) * HOUR_PX - 14);
  }, [view, selected]);
  // Where the week is wider than the pane (phones), it opens with today's column right next to the hours; on admins'
  // phones the pane appears only after a customer is picked, so that counts as opening too.
  const firstDay = days[0];
  useEffect(() => {
    const element = scroller.current;
    if (!element || view !== "week" || !firstDay) return;
    const column = element.querySelector<HTMLElement>(".cal-col.is-today");
    const hours = element.querySelector<HTMLElement>(".cal-times")?.offsetWidth ?? 0;
    element.scrollLeft = column && element.scrollWidth - element.clientWidth > 8 ? Math.max(0, column.offsetLeft - hours) : 0;
  }, [view, firstDay, selected, paneOpen]);

  /* ---------- The admins' list on the left ---------- */
  const term = listQuery.trim().toLocaleLowerCase("de");
  const listed = store.customers
    .filter((customer) => listFilter === "all" || (listFilter === "appts" ? facts.get(customer.id)?.upcoming.length : facts.get(customer.id)?.requests.length))
    .filter((customer) => !term || [customer.company, customer.customerNumber, ...(facts.get(customer.id)?.upcoming.map((item) => item.title) ?? [])].some((value) => value.toLocaleLowerCase("de").includes(term)))
    .sort((a, b) => a.company.localeCompare(b.company, "de"));
  const allUpcoming = store.appointments.filter((item) => item.end > now && item.status === "confirmed").length;
  const list = admin && (
    <div className="chat-list">
      <div className="chat-list-head"><h2>Kunden<span>{store.customers.length}</span></h2></div>
      <label className="chat-search"><Search size={15} aria-hidden="true" /><input type="search" value={listQuery} onChange={(event) => setListQuery(event.target.value)} placeholder="Kunde oder Termin" aria-label="Kunden nach Name, Nummer oder Termin durchsuchen" /></label>
      <div className="chat-filter" role="group" aria-label="Kunden zeigen">
        <button type="button" aria-pressed={listFilter === "all"} onClick={() => setListFilter("all")}>Alle</button>
        <button type="button" aria-pressed={listFilter === "appts"} onClick={() => setListFilter("appts")}>Mit Terminen<span>{store.customers.filter((customer) => facts.get(customer.id)?.upcoming.length).length}</span></button>
        <button type="button" aria-pressed={listFilter === "requests"} onClick={() => setListFilter("requests")}>Anfragen<span>{store.customers.filter((customer) => facts.get(customer.id)?.requests.length).length}</span></button>
      </div>
      <ul className="chat-convs" role="list">
        {!term && (
          <li>
            <button type="button" className="chat-conv" aria-current={selected === null ? "true" : undefined} onClick={() => { setSelected(null); setPaneOpen(true); }}>
              <span className="am-tile cal-tile"><CalendarDays size={20} aria-hidden="true" /></span>
              <span className="chat-conv-main"><span className="chat-conv-top"><strong>Alle Kunden</strong></span><span className="chat-conv-sub"><span className="chat-conv-last">{plural(allUpcoming, "Termin", "Termine")} geplant · {plural(openRequests.length, "Anfrage", "Anfragen")}</span></span></span>
            </button>
          </li>
        )}
        <li className="am-list-label">{listFilter === "appts" ? "Mit geplanten Terminen" : listFilter === "requests" ? "Mit offenen Anfragen" : "Kunden von A bis Z"}</li>
        {listed.map((customer) => {
          const fact = facts.get(customer.id);
          const next = fact?.upcoming[0];
          return (
            <li key={customer.id}>
              <button type="button" className="chat-conv" aria-current={selected === customer.id ? "true" : undefined} onClick={() => { setSelected(customer.id); setPaneOpen(true); }}>
                <CustomerSign customer={customer} logo={logos.get(customer.id) ?? null} />
                <span className="chat-conv-main">
                  <span className="chat-conv-top"><strong>{customer.company}</strong>
                    {fact?.requests.length ? <span className="chat-pill tone-todo" data-tip={plural(fact.requests.length, "offene Anfrage", "offene Anfragen")}>{fact.requests.length > 1 ? `${fact.requests.length} Anfragen` : "Anfrage"}</span>
                      : fact?.overdue.length ? <span className="chat-pill tone-bad" data-tip={plural(fact.overdue.length, "Aufgabe überfällig", "Aufgaben überfällig")}>Überfällig</span> : null}
                  </span>
                  <span className="chat-conv-sub"><span className="chat-conv-last">{customer.customerNumber} · {next ? `${formatDayShort(dayOf(next.start))}, ${timeOf(next.start)}${next.status === "requested" ? " angefragt" : ""}` : "Kein Termin geplant"}</span></span>
                </span>
              </button>
            </li>
          );
        })}
        {!listed.length && <li className="chat-empty">{term ? `Kein Kunde passt zu „${listQuery.trim()}“.` : "Keine Kunden in dieser Auswahl."}</li>}
      </ul>
    </div>
  );

  /* ---------- Panels ---------- */
  const panelAppointment = panel?.kind === "appointment" ? store.appointments.find((item) => item.id === panel.id) : undefined;
  const panelTask = panel?.kind === "task" ? tasks.find((task) => task.id === panel.id) : undefined;
  const panelGoal = panel?.kind === "goal" ? goals.find((goal) => goal.id === panel.id) : undefined;
  const close = () => setPanel(null);
  const panelNode = !panel ? null
    : panel.kind === "appointment" && panelAppointment
      ? admin
        ? panelAppointment.status === "requested"
          ? <RequestPanel key={panelAppointment.id} store={store} appointment={panelAppointment} onClose={close} onDone={finish} onOpenTask={(id) => setPanel({ kind: "task", id })}
            related={tasks.filter((task) => task.customerId && task.customerId === panelAppointment.customer?.id && task.dueOn && task.status !== "done" && Math.abs(Date.parse(`${task.dueOn}T00:00:00Z`) - Date.parse(`${dayOf(panelAppointment.start)}T00:00:00Z`)) <= 3 * 86_400_000)} />
          : <AppointmentPanel key={panelAppointment.id} store={store} appointment={panelAppointment} onClose={close} onDone={finish} />
        : <CustomerAppointmentPanel key={panelAppointment.id} store={store} appointment={panelAppointment} canWithdraw={!freelancer} onClose={close} onDone={finish} />
    : panel.kind === "new" ? <AppointmentPanel key={`new-${panel.day}-${panel.start}`} store={store} initial={panel} onClose={close} onDone={finish} />
    : panel.kind === "task" && panelTask
      ? <TaskPanel key={panelTask.id} store={store} task={panelTask} preview={preview} confirmHref={confirmHref} onClose={close} onDone={finish} onOpenAppointment={(id) => setPanel({ kind: "appointment", id })}
        nextAppointment={store.appointments.filter((item) => item.customer?.id && item.customer.id === panelTask.customerId && item.end > now && (item.status === "confirmed" || item.status === "requested")).sort(byStart)[0] ?? null} />
    : panel.kind === "goal" && panelGoal ? <GoalPanel key={panelGoal.id} goal={panelGoal} tasks={tasks.filter((task) => task.projectId === panelGoal.id)} preview={preview} today={today} onClose={close} onOpenTask={(id) => setPanel({ kind: "task", id })} />
    : panel.kind === "newTask" ? <NewTaskPanel key={`task-${panel.day}`} store={store} projects={taskProjects} day={panel.day} confirmHref={confirmHref} onClose={close} onDone={finish} />
    : panel.kind === "ask" ? <AskPanel key={`ask-${panel.day}-${panel.start ?? ""}`} store={store} initialDay={panel.day} initialStart={panel.start} onClose={close} onSent={finish} />
    : panel.kind === "avail" ? <AvailabilityPanel key={`avail-${panel.preset?.kind ?? ""}`} store={store} preset={panel.preset} onClose={close} onNotice={(message) => showToast(message)} />
    : null;

  if (calendar.error) {
    return <><Header preview={preview} /><GlassCard className="section-first"><p className="t-headline">Kalender nicht verfügbar</p><p className="t-subheadline t-secondary">{calendar.error}</p></GlassCard></>;
  }
  return (
    <>
      <Header preview={preview} />
      {!store.live && <p className="calendar-notice section-first file-demo-note"><Inbox size={18} aria-hidden="true" />{admin ? "Beispieltermine und -aufgaben. Was du hier änderst, bleibt nur in diesem Browserfenster." : "Beispieltermine für die Vorschau. Anfragen bleiben in diesem Browserfenster und gehen nicht an oalab."}</p>}
      {store.live && admin && board?.error && <p className="calendar-notice kb-error-note section-first" role="status">{board.error} Termine gehen trotzdem.</p>}
      {notice && <p className="calendar-notice section-first" role="status"><Check size={18} aria-hidden="true" />{notice}</p>}
      <div ref={root} className={`sheet section-first cal-sheet${admin ? " am" : " is-customer"}`} data-open={admin ? (paneOpen ? "" : undefined) : ""}>
        {admin ? <div className="am-grid">{list}{pane}</div> : pane}
      </div>
      {panelNode}
      {float && (
        <div className="sheet-pop cal-float" role="menu" aria-label={float.title} style={{ left: Math.min(float.x - 12, (typeof window === "undefined" ? 1200 : window.innerWidth) - 290), top: float.y + 8 }}>
          <div className="cal-float-title">{float.title}</div>
          {float.items.map((item) => (
            <button key={item.label} type="button" role="menuitem" className={`sheet-action-item${item.danger ? " is-danger" : ""}`} onClick={() => { setFloat(null); item.run(); }}>
              <span className="sheet-action-icon"><item.icon size={16} aria-hidden="true" /></span>
              <span className="sheet-action-text"><strong>{item.label}</strong>{item.hint && <small>{item.hint}</small>}</span>
            </button>
          ))}
        </div>
      )}
      {toast && (
        <div className="kb-toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button type="button" onClick={() => { const undo = toast.undo; setToast(null); undo?.(); }}>Rückgängig</button>}
        </div>
      )}
    </>
  );
}

/** "16.–22. November 2026", across months "30. Nov. – 6. Dez. 2026". */
function weekTitle(day: string) {
  const [monday, , , , , , sunday] = weekDays(day);
  const long = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", month: "long", year: "numeric" });
  const short = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", day: "numeric", month: "short" });
  const at = (value: string) => Date.parse(`${value}T00:00:00Z`);
  if (monthOf(monday) === monthOf(sunday)) return `${Number(monday.slice(8))}.–${Number(sunday.slice(8))}. ${long.format(at(sunday))}`;
  return `${short.format(at(monday))} – ${short.format(at(sunday))} ${sunday.slice(0, 4)}`;
}

/** The title on the background with the way back to Projekte, like the task board. */
function Header({ preview }: { preview: boolean }) {
  return (
    <LargeTitleHeader
      title="Kalender"
      icon={<span className="title-icon"><CalendarDays size={24} color={categories.projects.fill} aria-hidden="true" /></span>}
      leading={<Link href={hubHref(preview, "projects")} className="on-bg-link"><ChevronLeft size={22} strokeWidth={2.5} aria-hidden="true" />Projekte</Link>}
      actions={<HeaderActions />}
    />
  );
}
