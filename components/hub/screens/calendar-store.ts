"use client";

import { useMemo, useState } from "react";
import {
  addAvailabilityException, closeAppointment, deleteAppointment, removeAvailabilityException, requestAppointment, saveAppointment, saveAvailabilityRules,
  saveAvailabilityWeek, withdrawRequest,
} from "@/lib/hub-calendar/actions";
import {
  cleanNote, cleanRules, cleanWeek, dayOf, MAX_OPEN_REQUESTS, readAppointmentInput, readAvailabilityRequest, readException, timeOf,
  type Availability, type AvailabilityRules, type ExceptionInput, type Interval, type WeekPlan,
} from "@/lib/hub-calendar/rules";
import type { AppointmentInput, CalendarActionResult, HubAppointment, HubCalendarState, RequestInput } from "@/lib/hub-calendar/types";
import type { Project } from "@/lib/hub-data";
import { createTask, moveTask, updateTask } from "@/lib/hub-tasks/actions";
import type { BoardPerson, BoardTask, TaskBoardState, TaskPriority, TaskResult, TaskStatus } from "@/lib/hub-tasks/types";

export type CalendarStore = ReturnType<typeof useCalendarStore>;

/** A task with a date as the calendar shows it: Studio's row with its project and the hub customer it belongs to. */
export type CalendarTask = {
  id: string;
  number: number;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueOn: string | null;
  projectId: string;
  projectName: string;
  /** The hub customer of the project's organization; null when the hub knows none. */
  customerId: string | null;
  company: string;
  /** Carries the label „Kunde“: the customer has to act. */
  customerTurn: boolean;
  /** Released to the customer (client_visible). */
  visible: boolean;
  assigneeIds: string[];
  /** Studio's row version for the optimistic lock; null where the hub cannot write (the customer's view). */
  version: number | null;
  order: number;
};

/** A project's target date ("Zieltermin"), shown all day; it never counts as booked time. */
export type CalendarGoal = { id: string; day: string; name: string; customerId: string | null; company: string; done: boolean };

export type TaskChange = { status?: TaskStatus; priority?: TaskPriority; dueOn?: string | null };
export type NewTask = { projectId: string; title: string; status: TaskStatus; dueOn: string | null };

const done = <T,>(data: T): CalendarActionResult<T> => ({ ok: true, data });
/** Studio writes a task only for a session confirmed with a code; the calendar asks for it before trying. */
export const NEEDS_CODE = "Aufgaben ändern geht nach einem Code aus der Mail („Mit Code bestätigen“). Nichts wurde gespeichert.";

/**
 * The board's tasks for the calendar: every task with its project; the hub customer comes from the projects page's
 * reading (Studio project → organization → hub customer), in the preview from the company's name.
 */
export function boardTasks(board: TaskBoardState, projects: readonly Project[], customers: readonly { id: string; company: string }[]): CalendarTask[] {
  const customerOf = new Map(projects.flatMap((project) => project.customerId ? [[project.id, project.customerId] as const] : []));
  const byCompany = new Map(customers.map((customer) => [customer.company.toLowerCase(), customer.id]));
  const projectOf = new Map(board.projects.map((project) => [project.id, project]));
  return board.tasks.map((task) => {
    const project = projectOf.get(task.projectId);
    const company = project?.company ?? "";
    return {
      id: task.id, number: task.number, title: task.title, status: task.status, priority: task.priority, dueOn: task.dueOn,
      projectId: task.projectId, projectName: project?.name ?? "", customerId: customerOf.get(task.projectId) ?? byCompany.get(company.toLowerCase()) ?? null, company,
      customerTurn: task.labels.some((label) => label.toLowerCase() === "kunde"), visible: task.visible, assigneeIds: task.assigneeIds, version: task.version, order: task.order,
    };
  });
}

/** A customer's released tasks from their projects (they never receive the others). */
export function projectTasks(projects: readonly Project[]): CalendarTask[] {
  return projects.flatMap((project) => (project.tasks ?? []).filter((task) => task.visible).map((task): CalendarTask => ({
    id: task.id, number: task.number, title: task.title, status: task.status, priority: "none", dueOn: task.dueOn,
    projectId: project.id, projectName: project.name, customerId: project.customerId ?? null, company: project.company ?? "",
    customerTurn: task.customer, visible: true, assigneeIds: [], version: null, order: 0,
  })));
}

/** Target dates of the projects this login sees; Studio projects without one have no place in the calendar. */
export function projectGoals(projects: readonly Project[]): CalendarGoal[] {
  return projects.flatMap((project): CalendarGoal[] => project.dueOn
    ? [{ id: project.id, day: project.dueOn, name: project.name, customerId: project.customerId ?? null, company: project.company ?? "", done: project.status === "Abgeschlossen" }]
    : []);
}

/**
 * Real logins change appointments through server actions, and the page refreshes with the new data. Tasks are Studio's
 * rows: a change is written with the version the card had, and shows at once until the server's row is newer. The
 * preview applies the same rules to a copy that never leaves this browser tab.
 */
export function useCalendarStore(state: HubCalendarState, taskList: CalendarTask[], people: BoardPerson[] = []) {
  const live = state.source === "supabase";
  const [local, setLocal] = useState(state.appointments);
  const appointments = live ? state.appointments : local;
  // Admins see every appointment, so their busy times come from the list itself.
  const busy = useMemo<Interval[]>(() => state.canManage
    ? appointments.filter((item) => item.status === "confirmed").map(({ start, end }) => ({ start, end }))
    : state.busy, [state.canManage, state.busy, appointments]);
  // A customer's own open requests: they block that time for a second request of theirs.
  const own = useMemo<Interval[]>(() => state.canManage ? []
    : appointments.filter((item) => item.status === "requested" && item.end > state.now).map(({ start, end }) => ({ start, end })), [state.canManage, appointments, state.now]);

  /* ---------- Availability: shown at once, rolled back when the server refuses ---------- */
  // A local change counts until the server sends a new availability (after its refresh) or the change fails.
  const [pending, setPending] = useState<{ base: Availability; value: Availability } | null>(null);
  const availability = pending && pending.base === state.availability ? pending.value : state.availability;
  const availabilityReady = !live || state.availabilityReady;

  async function changeAvailability(next: Availability, action: () => Promise<CalendarActionResult<unknown>>): Promise<CalendarActionResult> {
    if (!state.canManage) return { ok: false, error: "Die Verfügbarkeit legt dein oalab-Team fest." };
    if (!availabilityReady) return { ok: false, error: "Die Verfügbarkeit ist in der Datenbank noch nicht eingerichtet. Die Migration steht noch aus." };
    const before = pending;
    setPending({ base: state.availability, value: next });
    if (!live) return done(null);
    const result = await action();
    if (!result.ok) { setPending(before); return result; }
    return done(null);
  }

  /** The weekly plan, Monday to Sunday. */
  function saveWeek(week: WeekPlan) {
    const clean = cleanWeek(week);
    if (!clean) return Promise.resolve({ ok: false as const, error: "Der Wochenplan passt nicht: Zeiten im Viertelstunden-Raster, von vor bis, höchstens acht Zeiträume am Tag." });
    return changeAvailability({ ...availability, week: clean }, () => saveAvailabilityWeek(clean));
  }

  /** Lead time, buffer, horizon and durations. */
  function saveRules(rules: AvailabilityRules) {
    const clean = cleanRules(rules);
    if (!clean) return Promise.resolve({ ok: false as const, error: "Diese Regeln passen nicht. Bitte mindestens eine Dauer wählen." });
    return changeAvailability({ ...availability, rules: clean }, () => saveAvailabilityRules(clean));
  }

  /** An absence (one or more days) or extra time on one day. */
  function addException(input: ExceptionInput) {
    const read = readException(input, state.today);
    if (!read.ok) return Promise.resolve(read);
    if (!read.rows.length) return Promise.resolve({ ok: false as const, error: "Diese Tage liegen in der Vergangenheit." });
    const stamp = Date.now();
    const added = read.rows.map((row, index) => ({ ...row, id: `local-x-${stamp}-${index}` }));
    const exceptions = [...availability.exceptions, ...added].sort((a, b) => a.day.localeCompare(b.day) || (a.from ?? -1) - (b.from ?? -1));
    return changeAvailability({ ...availability, exceptions }, () => addAvailabilityException(input));
  }

  /** Removes an absence or extra time. */
  function removeException(id: string) {
    return changeAvailability({ ...availability, exceptions: availability.exceptions.filter((item) => item.id !== id) }, () => removeAvailabilityException(id));
  }

  const change = (id: string, update: Partial<HubAppointment>) => setLocal((list) => list.map((item) => item.id === id ? { ...item, ...update } : item));

  async function save(id: string | null, input: AppointmentInput) {
    if (live) return saveAppointment(id, input);
    const read = readAppointmentInput(input);
    if (!read.ok) return read;
    const { title, description, customerId, interval, teamsUrl } = read.value;
    const previous = local.find((item) => item.id === id);
    const next: HubAppointment = {
      id: id ?? `local-${Date.now()}`, title, description, start: interval.start, end: interval.end, status: "confirmed", teamsUrl, responseNote: "",
      customer: state.customers.find((customer) => customer.id === customerId) ?? null,
      sample: Boolean(previous?.sample && teamsUrl === previous.teamsUrl),
    };
    setLocal((list) => id ? list.map((item) => item.id === id ? next : item) : [...list, next]);
    return done({ id: next.id });
  }

  /** Moves an appointment to another day or time; the customer gets the notice „verschoben“ (saveAppointment). */
  async function move(appointment: HubAppointment, day: string, start: string) {
    return save(appointment.id, {
      title: appointment.title, description: appointment.description, customerId: appointment.customer?.id ?? null,
      day, start, minutes: Math.round((appointment.end - appointment.start) / 60_000), teamsUrl: appointment.teamsUrl ?? "",
    });
  }

  async function close(id: string, status: "declined" | "cancelled", note: string) {
    if (live) return closeAppointment(id, status, note);
    change(id, { status, responseNote: cleanNote(note) });
    return done(null);
  }

  async function remove(id: string) {
    if (live) return deleteAppointment(id);
    setLocal((list) => list.filter((item) => item.id !== id));
    return done(null);
  }

  async function request(input: RequestInput) {
    if (live) return requestAppointment(input);
    const customer = state.customers[0];
    if (!customer) return { ok: false as const, error: "Dein Konto ist noch keinem Kunden zugeordnet." };
    const read = readAvailabilityRequest(input, availability, busy, own, state.now, state.today);
    if (!read.ok) return read;
    if (local.filter((item) => item.status === "requested" && item.end > state.now).length >= MAX_OPEN_REQUESTS) {
      return { ok: false as const, error: `Du hast schon ${MAX_OPEN_REQUESTS} offene Anfragen. Bitte warte auf eine Antwort oder ziehe eine zurück.` };
    }
    const { title, description, interval } = read.value;
    const id = `local-${Date.now()}`;
    setLocal((list) => [...list, { id, title, description, start: interval.start, end: interval.end, status: "requested", teamsUrl: null, responseNote: "", customer }]);
    return done({ id });
  }

  async function withdraw(id: string) {
    if (live) return withdrawRequest(id);
    change(id, { status: "cancelled" });
    return done(null);
  }

  /* ---------- Tasks: Studio's rows, written with the admin's own session ---------- */
  const [overrides, setOverrides] = useState<Record<string, Partial<CalendarTask> & { base: number }>>({});
  const [added, setAdded] = useState<CalendarTask[]>([]);
  const tasks = useMemo(() => {
    const known = new Set(taskList.map((task) => task.id));
    return [...taskList, ...added.filter((task) => !known.has(task.id))].map((task) => {
      const patch = overrides[task.id];
      // Once the server lists a newer version, its row wins over the local change.
      if (!patch || (task.version !== null && task.version > patch.base)) return task;
      const values: Partial<CalendarTask> & { base?: number } = { ...patch };
      delete values.base;
      return { ...task, ...values };
    });
  }, [taskList, added, overrides]);
  const canEditTasks = state.canManage && (!live || state.confirmed === true);

  const fromBoard = (row: BoardTask): Partial<CalendarTask> => ({ status: row.status, priority: row.priority, dueOn: row.dueOn, version: row.version, order: row.order, title: row.title });
  /** Puts back what a task showed before a change Studio refused. */
  const restore = (id: string, before: (Partial<CalendarTask> & { base: number }) | undefined) => setOverrides((current) => {
    const next = { ...current };
    if (before) next[id] = before; else delete next[id];
    return next;
  });

  /** Changes status, priority or date of a task; shown at once, rolled back when Studio refuses. */
  async function saveTask(task: CalendarTask, patch: TaskChange): Promise<TaskResult<null>> {
    if (!state.canManage) return { ok: false, error: "Aufgaben ändert dein oalab-Team." };
    if (!canEditTasks) return { ok: false, error: NEEDS_CODE };
    const before = overrides[task.id];
    setOverrides((current) => ({ ...current, [task.id]: { ...(current[task.id] ?? {}), ...patch, base: task.version ?? 0 } }));
    if (!live) return { ok: true, data: null };
    let version = task.version ?? 0;
    let row: BoardTask | null = null;
    if (patch.status && patch.status !== task.status) {
      const moved = await moveTask({ taskId: task.id, status: patch.status, order: task.order, expectedVersion: version });
      if (!moved.ok) { restore(task.id, before); return moved; }
      row = moved.data;
      version = moved.data.version;
    }
    const rest: { priority?: TaskPriority; dueOn?: string | null } = {};
    if (patch.priority !== undefined && patch.priority !== task.priority) rest.priority = patch.priority;
    if (patch.dueOn !== undefined && patch.dueOn !== task.dueOn) rest.dueOn = patch.dueOn;
    if (Object.keys(rest).length) {
      const updated = await updateTask({ taskId: task.id, expectedVersion: version, patch: rest });
      if (!updated.ok) { restore(task.id, before); return updated; }
      row = updated.data;
    }
    const saved = row;
    if (saved) setOverrides((current) => ({ ...current, [task.id]: { ...fromBoard(saved), base: saved.version } }));
    return { ok: true, data: null };
  }

  /** A new task with a date in a project's column; it shows on the board and in Studio as well. */
  async function newTask(input: NewTask): Promise<TaskResult<CalendarTask>> {
    if (!canEditTasks) return { ok: false, error: NEEDS_CODE };
    const project = taskList.find((task) => task.projectId === input.projectId);
    const base = { projectName: project?.projectName ?? "", customerId: project?.customerId ?? null, company: project?.company ?? "" };
    if (!live) {
      const number = Math.max(0, ...tasks.map((task) => task.number)) + 1;
      const created: CalendarTask = { id: `local-task-${number}`, number, title: input.title.trim(), status: input.status, priority: "none", dueOn: input.dueOn, projectId: input.projectId, ...base, customerTurn: false, visible: false, assigneeIds: [], version: 1, order: 0 };
      setAdded((current) => [...current, created]);
      return { ok: true, data: created };
    }
    const result = await createTask({ projectId: input.projectId, title: input.title, status: input.status, patch: { dueOn: input.dueOn } });
    if (!result.ok) return result;
    const row = result.data;
    const created: CalendarTask = { id: row.id, number: row.number, title: row.title, status: row.status, priority: row.priority, dueOn: row.dueOn, projectId: row.projectId, ...base, customerTurn: false, visible: row.visible, assigneeIds: row.assigneeIds, version: row.version, order: row.order };
    setAdded((current) => [...current, created]);
    return { ok: true, data: created };
  }

  return {
    live, appointments, busy, own, customers: state.customers, canManage: state.canManage, today: state.today, now: state.now,
    save, move, close, remove, request, withdraw,
    availability, availabilityReady, saveWeek, saveRules, addException, removeException,
    tasks, people, canEditTasks, saveTask, newTask,
  };
}

/** Start time ("HH:MM") and day of an appointment, for forms that edit it. */
export const appointmentSlot = (appointment: HubAppointment) => ({ day: dayOf(appointment.start), start: timeOf(appointment.start), minutes: Math.round((appointment.end - appointment.start) / 60_000) });
