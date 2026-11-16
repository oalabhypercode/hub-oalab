"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Building2, CalendarCheck, CalendarPlus, CalendarX, Check, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Clock, Flag, FolderOpen, Hand, Hourglass, Inbox, Lock, Repeat, Send, SquareKanban, Timer, Trash2, Undo2, Video, X } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import {
  addDays, addMonths, APPOINTMENT_DURATIONS, appointmentStatuses, calendarWindow, clockOf, dayOf, formatDayLong, formatDayShort, formatDuration, formatMonth, formatTimeRange,
  isClock, isDay, mondayOf, monthOf, monthWeeks, overlaps, REQUEST_DURATIONS, slotStarts, timeOf, wallTimeToUtc, workWindow, WORKDAY, type AppointmentStatus,
} from "@/lib/hub-calendar/rules";
import type { HubAppointment } from "@/lib/hub-calendar/types";
import { hubHref } from "@/lib/hub-data";
import { PRIORITY_NAMES, STATUS_NAMES, TASK_PRIORITIES, TASK_STATUSES } from "@/lib/hub-tasks/rules";
import type { TaskPriority, TaskStatus } from "@/lib/hub-tasks/types";
import { SegmentedControl } from "../controls";
import { useInfo } from "../info-box";
import { Select } from "../select";
import { customerOption } from "../select-options";
import { AssetPanel } from "./asset-panel";
import { TaskGlyph } from "./tasks-parts";
import { Field, FieldGrid, PanelSection } from "./users-panel";
import { appointmentSlot, type CalendarGoal, type CalendarStore, type CalendarTask } from "./calendar-store";

/*
 * The calendar's side panels (16.11.2026): instead of the windows of before, a panel at the right edge like on the other
 * „je Kunde“ pages; the calendar stays usable next to it. Admins create, change, move, cancel and answer requests here,
 * and see and change the tasks with a date; customers see their appointments and request a free time.
 */

const MINUTE = 60_000;
const statusTone: Record<AppointmentStatus, string> = { requested: "todo", confirmed: "ok", declined: "bad", cancelled: "off" };
const statusIcon: Record<AppointmentStatus, typeof CalendarCheck> = { requested: Inbox, confirmed: CalendarCheck, declined: CalendarX, cancelled: CalendarX };
const taskTone: Record<TaskStatus, string> = { backlog: "off", todo: "info", progress: "ok", review: "todo", done: "off" };

const Glyph = ({ tone, children }: { tone: string; children: React.ReactNode }) => <span className={`cal-panel-glyph tone-${tone}`}>{children}</span>;
const Check2 = ({ tone, children }: { tone: "ok" | "warn" | "bad"; children: React.ReactNode }) => (
  <p className={`cal-check is-${tone}`}>{tone === "ok" ? <CircleCheck size={15} aria-hidden="true" /> : <CircleAlert size={15} aria-hidden="true" />}<span>{children}</span></p>
);
const Note = ({ icon: Icon, tone, children }: { icon: typeof Clock; tone?: "todo" | "off"; children: React.ReactNode }) => (
  <p className={`cal-panel-note${tone ? ` is-${tone}` : ""}`}><Icon size={15} aria-hidden="true" /><span>{children}</span></p>
);

/** Start times every quarter hour from 6 to 21 o'clock; "frei" where the appointment would fit into the working hours. */
function startOptions(day: string, minutes: number, busy: { start: number; end: number }[]) {
  const options = [];
  for (let value = 6 * 60; value <= 21 * 60; value += 15) {
    const time = clockOf(value);
    const start = isDay(day) ? wallTimeToUtc(day, time) : 0;
    const window = isDay(day) ? workWindow(day) : null;
    const fits = Boolean(window && start >= window.start && start + minutes * MINUTE <= window.end && !busy.some((item) => overlaps(item, { start, end: start + minutes * MINUTE })));
    options.push({ value: time, label: `${time} Uhr`, group: value < 12 * 60 ? "Vormittag" : value < 17 * 60 ? "Nachmittag" : "Abend", meta: fits ? "frei" : undefined, lead: <Clock size={15} aria-hidden="true" /> });
  }
  return options;
}
const durationOptions = (minutes: number) => [...new Set([...APPOINTMENT_DURATIONS, minutes])].sort((a, b) => a - b).map((value) => ({ value: String(value), label: formatDuration(value), lead: <Timer size={15} aria-hidden="true" /> }));

/** What a time means: free, outside the working hours, or overlapping. */
function SlotChecks({ store, day, start, minutes, exceptId }: { store: CalendarStore; day: string; start: string; minutes: number; exceptId?: string }) {
  if (!isDay(day) || !isClock(start)) return null;
  const interval = { start: wallTimeToUtc(day, start), end: wallTimeToUtc(day, start) + minutes * MINUTE };
  const clash = store.appointments.filter((item) => item.id !== exceptId && (item.status === "confirmed" || item.status === "requested") && overlaps(item, interval));
  const window = workWindow(day);
  const inside = Boolean(window && interval.start >= window.start && interval.end <= window.end);
  return (
    <div className="cal-checks">
      {clash.length > 0 && <Check2 tone="bad">Überschneidet sich mit {clash.map((item) => `${timeOf(item.start)} „${item.title}“${item.status === "requested" ? " (Anfrage)" : ""}`).join(", ")}.</Check2>}
      {!inside && <Check2 tone="warn">Außerhalb der Termintage (Mo–Fr, {WORKDAY.start}–{WORKDAY.end} Uhr). Du kannst trotzdem eintragen, Kunden könnten diese Zeit nicht anfragen.</Check2>}
      {!clash.length && inside && <Check2 tone="ok">Frei und in den Termintagen.</Check2>}
    </div>
  );
}

/* ---------- Admins: create or change an appointment ---------- */

export function AppointmentPanel({ store, appointment, initial, onClose, onDone }: {
  store: CalendarStore;
  appointment?: HubAppointment;
  /** A new appointment's start: the clicked day and time, the chosen customer, maybe a title ("Blockiert"). */
  initial?: { day: string; start: string; customerId: string | null; title?: string };
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const slot = appointment ? appointmentSlot(appointment) : null;
  const [title, setTitle] = useState(appointment?.title ?? initial?.title ?? "");
  const [customerId, setCustomerId] = useState(appointment?.customer?.id ?? initial?.customerId ?? "");
  const [day, setDay] = useState(slot?.day ?? initial?.day ?? store.today);
  const [start, setStart] = useState(slot?.start ?? initial?.start ?? "10:00");
  const [minutes, setMinutes] = useState(slot?.minutes ?? 60);
  const [teamsUrl, setTeamsUrl] = useState(appointment?.teamsUrl ?? "");
  const [description, setDescription] = useState(appointment?.description ?? "");
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const info = useInfo("Termin und Teams-Link", {
    steps: [
      <><b>Teams-Link</b> aus Teams oder Outlook einfügen.</>,
      <><b>Intern</b> heißt ohne Kunde; für Kunden ist die Zeit belegt.</>,
      <><b>Der Kunde</b> bekommt eine Meldung mit Kalenderknöpfen.</>,
    ],
    ask: "Wie lege ich einen Termin mit Teams-Link an?",
  });
  const status = appointment?.status ?? "confirmed";
  const upcoming = !appointment || appointment.end > store.now;
  const customer = store.customers.find((item) => item.id === customerId);
  const busyTimes = store.appointments.filter((item) => item.id !== appointment?.id && item.status === "confirmed");
  const Icon = statusIcon[status];

  async function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, message: string) {
    setBusy(true);
    setError("");
    const result = await action();
    setBusy(false);
    if (result.ok) onDone(message); else setError(result.error);
  }
  const save = () => run(() => store.save(appointment?.id ?? null, { title, description, customerId: customerId || null, day, start, minutes, teamsUrl }),
    !appointment ? `„${title.trim()}“ steht am ${formatDayShort(day)} um ${start} im Kalender.${customer ? ` ${customer.company} bekommt eine Meldung.` : ""}`
      : `„${title.trim()}“ gespeichert.${customer && (slot?.day !== day || slot?.start !== start) ? ` ${customer.company} bekommt eine Meldung zur neuen Zeit.` : ""}`);

  const footer = closing ? null : appointment ? <>
    {status === "confirmed" && upcoming && <button type="button" className="sheet-action" onClick={() => setClosing(true)} disabled={busy}><CalendarX size={15} aria-hidden="true" />Absagen</button>}
    <button type="button" className={`sheet-action${confirmDelete ? " is-danger" : ""}`} onClick={() => confirmDelete ? run(() => store.remove(appointment.id), `„${appointment.title}“ gelöscht.`) : setConfirmDelete(true)} disabled={busy}>
      {busy && confirmDelete ? <MiniLoader size={15} /> : <Trash2 size={15} aria-hidden="true" />}{confirmDelete ? "Endgültig löschen" : "Löschen"}
    </button>
    <span className="pj-spacer" />
    <button type="button" className="sheet-action" onClick={onClose} disabled={busy}>Abbrechen</button>
    <button type="button" className="sheet-action is-primary" onClick={save} disabled={busy || !title.trim()}>{busy && !confirmDelete ? <MiniLoader size={15} /> : <Check size={15} aria-hidden="true" />}{status === "confirmed" ? "Speichern" : "Neu planen"}</button>
  </> : <>
    <button type="button" className="sheet-action" onClick={onClose} disabled={busy}>Abbrechen</button>
    <span className="pj-spacer" />
    <button type="button" className="sheet-action is-primary" onClick={save} disabled={busy || !title.trim()}>{busy ? <MiniLoader size={15} /> : <Check size={15} aria-hidden="true" />}Termin anlegen</button>
  </>;

  return (
    <AssetPanel className="um-panel cal-panel" label={appointment ? appointment.title : "Neuer Termin"} onClose={onClose}
      icon={<Glyph tone={statusTone[status]}><Icon size={19} aria-hidden="true" /></Glyph>}
      title={appointment ? appointment.title : "Neuer Termin"}
      subtitle={appointment ? `${appointment.customer ? `${appointment.customer.company} · ${appointment.customer.customerNumber}` : "Intern"} · ${appointmentStatuses[status]}` : "Wird sofort als bestätigt eingetragen"}
      actions={info.button} footer={footer}>
      {info.box}
      {appointment && !upcoming && <Note icon={Hourglass}>Dieser Termin liegt in der Vergangenheit.</Note>}
      {appointment?.responseNote && <Note icon={CalendarX} tone="off">{appointmentStatuses[status]}: {appointment.responseNote}</Note>}
      <PanelSection title="Termin">
        <FieldGrid>
          <Field label="Titel" wide><input className="am-input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="z. B. Abstimmung Website-Inhalte" disabled={busy} autoFocus={!appointment} /></Field>
          <Field label="Datum"><input className="am-input" type="date" value={day} onChange={(event) => setDay(event.target.value)} disabled={busy} /></Field>
          <div className="um-field"><span className="am-label">Beginn</span><Select label="Beginn" value={start} onChange={setStart} options={startOptions(day, minutes, busyTimes)} disabled={busy} searchPlaceholder="Uhrzeit, z. B. 14" /></div>
          <div className="um-field"><span className="am-label">Dauer</span><Select label="Dauer" value={String(minutes)} onChange={(value) => setMinutes(Number(value))} options={durationOptions(minutes)} disabled={busy} /></div>
          <div className="um-field"><span className="am-label">Ende</span><span className="cal-static numeric">{isClock(start) ? clockOf(Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + minutes) : "–"} Uhr</span></div>
        </FieldGrid>
        <SlotChecks store={store} day={day} start={start} minutes={minutes} exceptId={appointment?.id} />
      </PanelSection>
      <PanelSection title="Kunde">
        <Select label="Kunde" value={customerId} onChange={setCustomerId} disabled={busy || appointment?.status === "requested"} searchPlaceholder="Kunde oder Nummer suchen …"
          options={[{ value: "", label: "Intern (kein Kunde)", lead: <Building2 size={15} aria-hidden="true" />, meta: "Für Kunden belegt, ohne Titel" }, ...store.customers.map((item) => customerOption(item, "Kunden"))]} />
      </PanelSection>
      <PanelSection title="Microsoft Teams">
        <label className="um-field"><span className="pj-url"><Video size={16} aria-hidden="true" /><input value={teamsUrl} onChange={(event) => setTeamsUrl(event.target.value)} inputMode="url" maxLength={2048} placeholder="https://teams.microsoft.com/l/meetup-join/…" aria-label="Teams-Link" disabled={busy} spellCheck={false} /></span>
          <small className="pj-form-hint">In Teams oder Outlook ein Meeting anlegen und den Link „An der Besprechung teilnehmen“ hier einfügen.</small></label>
      </PanelSection>
      <PanelSection title="Beschreibung">
        <textarea className="am-textarea" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} placeholder="Agenda oder Vorbereitung für den Termin" disabled={busy} />
      </PanelSection>
      {customer && <Note icon={CalendarCheck}>{customer.company} bekommt {appointment ? "bei einer neuen Zeit" : ""} eine Meldung in der Glocke und per E-Mail, mit Kalenderknöpfen.</Note>}
      {closing && appointment && (
        <div className="cal-decline">
          <label className="um-field"><span className="am-label">Hinweis zur Absage an den Kunden (optional)</span><textarea className="am-textarea" rows={2} value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} placeholder="z. B. Wir melden uns mit einem neuen Termin." disabled={busy} autoFocus /></label>
          <div className="cal-decline-acts">
            <button type="button" className="sheet-action" onClick={() => setClosing(false)} disabled={busy}>Zurück</button>
            <button type="button" className="sheet-action is-danger" onClick={() => run(() => store.close(appointment.id, "cancelled", note), `„${appointment.title}“ abgesagt.${appointment.customer ? ` ${appointment.customer.company} bekommt eine Meldung.` : ""}`)} disabled={busy}>{busy ? <MiniLoader size={15} /> : <X size={15} aria-hidden="true" />}Termin absagen</button>
          </div>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </AssetPanel>
  );
}

/* ---------- Admins: answer a customer's request, at the wished or another free time ---------- */

export function RequestPanel({ store, appointment, related, onClose, onDone, onOpenTask }: {
  store: CalendarStore;
  appointment: HubAppointment;
  /** Tasks of the same customer due around the wished day: what the request is probably about. */
  related: CalendarTask[];
  onClose: () => void;
  onDone: (message: string) => void;
  onOpenTask: (id: string) => void;
}) {
  const wish = appointmentSlot(appointment);
  const [day, setDay] = useState(wish.day);
  const [start, setStart] = useState(wish.start);
  const [minutes, setMinutes] = useState(wish.minutes);
  const [teamsUrl, setTeamsUrl] = useState("");
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const info = useInfo("Anfrage beantworten", {
    steps: [
      <><b>Bestätigen</b> trägt den Termin fest ein.</>,
      <><b>Zeit ändern</b> geht vorher, nur in freier Zeit.</>,
      <><b>Ablehnen</b> mit Grund, gern mit Gegenvorschlag.</>,
    ],
    ask: "Wie beantworte ich eine Terminanfrage?",
  });
  const customer = appointment.customer;
  const busyTimes = store.appointments.filter((item) => item.id !== appointment.id && item.status === "confirmed").map(({ start: a, end: b }) => ({ start: a, end: b }));
  const starts = useMemo(() => {
    const free = isDay(day) ? slotStarts(day, busyTimes, minutes, store.now) : [];
    return [...new Set([...free, ...(day === wish.day ? [wish.start] : [])])].sort();
  }, [day, minutes, busyTimes, store.now, wish.day, wish.start]);
  const moved = day !== wish.day || start !== wish.start || minutes !== wish.minutes;

  async function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, message: string) {
    setBusy(true);
    setError("");
    const result = await action();
    setBusy(false);
    if (result.ok) onDone(message); else setError(result.error);
  }
  const accept = () => run(() => store.save(appointment.id, { title: appointment.title, description: appointment.description, customerId: customer?.id ?? null, day, start, minutes, teamsUrl }),
    `Bestätigt: „${appointment.title}“ am ${formatDayShort(day)}, ${start}. ${customer?.company ?? "Der Kunde"} bekommt eine Meldung${teamsUrl.trim() ? " mit Teams-Link" : ""} und Kalenderknöpfen.`);

  const footer = declining ? null : <>
    <button type="button" className="sheet-action" onClick={() => setDeclining(true)} disabled={busy}><X size={15} aria-hidden="true" />Ablehnen</button>
    <span className="pj-spacer" />
    <button type="button" className="sheet-action" onClick={onClose} disabled={busy}>Später</button>
    <button type="button" className="sheet-action is-primary" onClick={accept} disabled={busy || !starts.includes(start)}>{busy ? <MiniLoader size={15} /> : <Check size={15} aria-hidden="true" />}{moved ? "Mit neuer Zeit bestätigen" : "Bestätigen"}</button>
  </>;

  return (
    <AssetPanel className="um-panel cal-panel" label={appointment.title} onClose={onClose} icon={<Glyph tone="todo"><Inbox size={19} aria-hidden="true" /></Glyph>}
      title={appointment.title} subtitle={`Anfrage von ${customer ? `${customer.company} · ${customer.customerNumber}` : "einem Kunden"}`} actions={info.button} footer={footer}>
      {info.box}
      <PanelSection title="Anfrage">
        <div className="cal-summary is-request"><span className="cal-summary-day"><CalendarCheck size={16} aria-hidden="true" /><b>Wunsch: {formatDayLong(wish.day)}</b></span><span className="cal-summary-time numeric">{formatTimeRange(appointment)} · {formatDuration(wish.minutes)}</span></div>
        <dl className="file-details cal-details"><div className="file-details-block"><dt>Nachricht</dt><dd>{appointment.description || "Keine Nachricht."}</dd></div></dl>
        {related.length > 0 && (
          <div className="cal-related"><span className="am-label">Passt vielleicht zu</span>
            {related.map((task) => <button key={task.id} type="button" className="cal-related-item" onClick={() => onOpenTask(task.id)}><TaskGlyph status={task.status} size={13} /><span><span className="numeric">#{task.number}</span> {task.title}</span><small>fällig {task.dueOn ? formatDayShort(task.dueOn) : "–"}</small></button>)}
          </div>
        )}
      </PanelSection>
      <PanelSection title="Zeit vor dem Bestätigen ändern">
        <FieldGrid>
          <Field label="Datum"><input className="am-input" type="date" value={day} onChange={(event) => setDay(event.target.value)} disabled={busy} /></Field>
          <div className="um-field"><span className="am-label">Dauer</span><Select label="Dauer" value={String(minutes)} onChange={(value) => setMinutes(Number(value))} options={durationOptions(minutes)} disabled={busy} /></div>
        </FieldGrid>
        <div className="cal-slots" role="radiogroup" aria-label="Freie Zeiten">
          {starts.length ? starts.map((value) => (
            <button key={value} type="button" role="radio" aria-checked={value === start} className={`cal-slot${value === start ? " is-on" : ""}`} onClick={() => setStart(value)} disabled={busy}>
              {value}{day === wish.day && value === wish.start && <small>Wunsch</small>}
            </button>
          )) : <span className="t-secondary cal-slots-empty">An diesem Tag ist in den Termintagen nichts mehr frei.</span>}
        </div>
        <SlotChecks store={store} day={day} start={start} minutes={minutes} exceptId={appointment.id} />
        {moved && customer && <Note icon={CalendarCheck}>{customer.company} sieht die neue Zeit in der Bestätigung: {formatDayShort(day)}, {start} Uhr.</Note>}
      </PanelSection>
      <PanelSection title="Microsoft Teams" meta="optional">
        <span className="pj-url"><Video size={16} aria-hidden="true" /><input value={teamsUrl} onChange={(event) => setTeamsUrl(event.target.value)} inputMode="url" maxLength={2048} placeholder="https://teams.microsoft.com/l/meetup-join/…" aria-label="Teams-Link" disabled={busy} spellCheck={false} /></span>
      </PanelSection>
      {declining && (
        <div className="cal-decline">
          <label className="um-field"><span className="am-label">Grund für die Absage an den Kunden (optional)</span><textarea className="am-textarea" rows={3} value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} placeholder="z. B. Leider schon verplant. Wie wäre Dienstag, 10 Uhr?" disabled={busy} autoFocus /></label>
          <div className="cal-decline-acts">
            <button type="button" className="sheet-action" onClick={() => setDeclining(false)} disabled={busy}>Zurück</button>
            <button type="button" className="sheet-action is-danger" onClick={() => run(() => store.close(appointment.id, "declined", note), `Anfrage „${appointment.title}“ abgelehnt. ${customer?.company ?? "Der Kunde"} bekommt eine Meldung${note.trim() ? " mit deinem Grund" : ""}.`)} disabled={busy}>{busy ? <MiniLoader size={15} /> : <X size={15} aria-hidden="true" />}Anfrage ablehnen</button>
          </div>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </AssetPanel>
  );
}

/* ---------- Customers (and freelancers): an own appointment or request ---------- */

export function CustomerAppointmentPanel({ store, appointment, canWithdraw, onClose, onDone }: { store: CalendarStore; appointment: HubAppointment; canWithdraw: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const status = appointment.status;
  const Icon = statusIcon[status];
  const upcoming = appointment.end > store.now;
  async function withdraw() {
    if (!confirm) { setConfirm(true); return; }
    setBusy(true);
    const result = await store.withdraw(appointment.id);
    setBusy(false);
    if (result.ok) onDone(`Deine Anfrage „${appointment.title}“ ist zurückgezogen.`); else setError(result.error);
  }
  const footer = <>
    {canWithdraw && status === "requested" && upcoming && <button type="button" className={`sheet-action${confirm ? " is-danger" : ""}`} onClick={withdraw} disabled={busy}>{busy ? <MiniLoader size={15} /> : <Undo2 size={15} aria-hidden="true" />}{confirm ? "Wirklich zurückziehen" : "Anfrage zurückziehen"}</button>}
    <span className="pj-spacer" />
    <button type="button" className="sheet-action is-primary" onClick={onClose}>Fertig</button>
  </>;
  return (
    <AssetPanel className="um-panel cal-panel" label={appointment.title} onClose={onClose} icon={<Glyph tone={statusTone[status]}><Icon size={19} aria-hidden="true" /></Glyph>}
      title={appointment.title} subtitle={`${appointmentStatuses[status]} · ${formatDayShort(dayOf(appointment.start))}, ${timeOf(appointment.start)}`} footer={footer}>
      <div className="cal-summary"><span className="cal-summary-day"><CalendarCheck size={16} aria-hidden="true" /><b>{formatDayLong(dayOf(appointment.start))}</b></span><span className="cal-summary-time numeric">{formatTimeRange(appointment)}</span></div>
      {status === "requested" && <Note icon={Hourglass} tone="todo">Angefragt. Dein oalab-Team bestätigt den Termin oder schlägt eine andere Zeit vor. Erst dann ist er fest.</Note>}
      <dl className="file-details cal-details">
        <div className="file-details-block"><dt>{status === "requested" ? "Deine Nachricht" : "Beschreibung"}</dt><dd>{appointment.description || "Keine Beschreibung hinterlegt."}</dd></div>
        {appointment.responseNote && <div className="file-details-block"><dt>Hinweis von oalab</dt><dd>{appointment.responseNote}</dd></div>}
      </dl>
      {status === "confirmed" && (appointment.teamsUrl
        ? appointment.sample
          ? <span className="teams-join is-sample cal-teams" data-tip="Beispiel-Link aus der Vorschau, kein echtes Meeting"><Video size={18} aria-hidden="true" /><span className="teams-join-label">Teams-Meeting beitreten</span><small>Beispiel</small></span>
          : <a className="teams-join cal-teams" href={appointment.teamsUrl} target="_blank" rel="noopener noreferrer"><Video size={18} aria-hidden="true" /><span className="teams-join-label">Teams-Meeting beitreten</span></a>
        : <Note icon={Video}>Den Teams-Link ergänzt dein oalab-Team.</Note>)}
      {error && <p className="form-error" role="alert">{error}</p>}
    </AssetPanel>
  );
}

/* ---------- Tasks with a date: the same Studio rows as the board ---------- */

export function TaskPanel({ store, task, preview, confirmHref, nextAppointment, onClose, onDone, onOpenAppointment }: {
  store: CalendarStore;
  task: CalendarTask;
  preview: boolean;
  /** The way to the code page while the session is unconfirmed; null otherwise. */
  confirmHref: string | null;
  nextAppointment: HubAppointment | null;
  onClose: () => void;
  onDone: (message: string) => void;
  onOpenAppointment: (id: string) => void;
}) {
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [dueOn, setDueOn] = useState(task.dueOn ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const admin = store.canManage;
  const editable = admin && store.canEditTasks;
  const late = Boolean(dueOn && dueOn < store.today && status !== "done");
  const quick: [string, string][] = [["Heute", store.today], ["Morgen", addDays(store.today, 1)], ["Nächste Woche", addDays(mondayOf(store.today), 7)], ["Kein Datum", ""]];
  const boardHref = `${hubHref(preview, "projects")}/tasks?project=${encodeURIComponent(task.projectId)}&task=${task.number}`;

  async function save() {
    setBusy(true);
    setError("");
    const result = await store.saveTask(task, { status, priority, dueOn: dueOn || null });
    setBusy(false);
    if (result.ok) onDone(`#${task.number} gespeichert${(dueOn || null) !== task.dueOn ? ` · ${dueOn ? `fällig ${formatDayShort(dueOn)}` : "ohne Datum"}` : ""}. Gilt auch im Board und im Studio.`); else setError(result.error);
  }

  if (!admin) {
    return (
      <AssetPanel className="um-panel cal-panel" label={task.title} onClose={onClose} icon={<Glyph tone={taskTone[task.status]}><TaskGlyph status={task.status} size={19} /></Glyph>}
        title={task.title} subtitle={`Aufgabe · ${task.projectName}`}
        footer={<><Link className="sheet-action" href={`${hubHref(preview, "projects")}?project=${encodeURIComponent(task.projectId)}`}><FolderOpen size={15} aria-hidden="true" />Im Projekt ansehen</Link><span className="pj-spacer" /><button type="button" className="sheet-action is-primary" onClick={onClose}>Fertig</button></>}>
        <div className="cal-summary"><span className="cal-summary-day"><TaskGlyph status={task.status} size={15} /><b>{STATUS_NAMES[task.status]}</b></span><span className="cal-summary-time">{task.dueOn ? `fällig ${formatDayLong(task.dueOn)}` : "ohne Datum"}</span></div>
        <dl className="file-details cal-details">
          <div><dt>Projekt</dt><dd>{task.projectName}</dd></div>
          {task.customerTurn && <div><dt>Wer ist dran</dt><dd><b>Du</b> – oalab wartet auf dich</dd></div>}
        </dl>
        <Note icon={Hand}>Diese Aufgabe hat dein oalab-Team für dich freigegeben. Alles Weitere steht im Projekt.</Note>
      </AssetPanel>
    );
  }

  const footer = confirmHref && !editable ? (
    <div className="kb-locked" role="status"><Lock size={15} aria-hidden="true" /><span><b>Nur lesen.</b> Ändern geht nach einem Code aus der Mail.</span><a className="sheet-action is-primary" href={confirmHref}>Mit Code bestätigen</a></div>
  ) : <>
    <Link className="sheet-action" href={boardHref}><SquareKanban size={15} aria-hidden="true" />Im Board öffnen</Link>
    <span className="pj-spacer" />
    <button type="button" className="sheet-action" onClick={onClose} disabled={busy}>Abbrechen</button>
    <button type="button" className="sheet-action is-primary" onClick={save} disabled={busy || !editable}>{busy ? <MiniLoader size={15} /> : <Check size={15} aria-hidden="true" />}Speichern</button>
  </>;

  return (
    <AssetPanel className="um-panel cal-panel" label={`#${task.number} ${task.title}`} onClose={onClose} icon={<Glyph tone={taskTone[status]}><TaskGlyph status={status} size={19} /></Glyph>}
      title={`#${task.number} ${task.title}`} subtitle={[task.company, task.projectName].filter(Boolean).join(" · ")} footer={footer}>
      <PanelSection title="Aufgabe" meta="dieselbe wie im Board und im Studio">
        <FieldGrid>
          <div className="um-field"><span className="am-label">Status <small>Spalte im Board</small></span>
            <Select label="Status" value={status} onChange={(value) => setStatus(value as TaskStatus)} disabled={busy || !editable} options={TASK_STATUSES.map((value) => ({ value, label: STATUS_NAMES[value], lead: <TaskGlyph status={value} size={14} /> }))} />
          </div>
          <div className="um-field"><span className="am-label">Priorität</span>
            <Select label="Priorität" value={priority} onChange={(value) => setPriority(value as TaskPriority)} disabled={busy || !editable} options={TASK_PRIORITIES.map((value) => ({ value, label: PRIORITY_NAMES[value] }))} />
          </div>
          <Field label="Fällig am" wide><input className={`am-input${late ? " is-overdue" : ""}`} type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} disabled={busy || !editable} /></Field>
        </FieldGrid>
        <div className="cal-quick" role="group" aria-label="Datum schnell setzen">
          {quick.map(([label, value]) => <button key={label} type="button" className={`cal-quick-btn${dueOn === value ? " is-on" : ""}`} aria-pressed={dueOn === value} onClick={() => setDueOn(value)} disabled={busy || !editable}>{label}</button>)}
        </div>
        {dueOn ? <Check2 tone={late ? "bad" : "ok"}>{late ? "Überfällig." : `Steht am ${formatDayLong(dueOn)} in der Zeile „ganztägig“.`}</Check2> : <Check2 tone="warn">Ohne Datum steht die Aufgabe nur im Board, nicht im Kalender.</Check2>}
        <Note icon={Repeat}>Ein neues Datum gilt sofort auch im Board und im Studio.</Note>
      </PanelSection>
      <PanelSection title="Beteiligt">
        <dl className="file-details cal-details">
          <div><dt>Zuständig</dt><dd>{task.assigneeIds.length ? task.assigneeIds.map((id) => store.people.find((person) => person.id === id)?.name ?? "Unbekannt").join(", ") : "Niemand zugewiesen"}</dd></div>
          <div><dt>Kunde</dt><dd>{task.company || "–"}{task.customerTurn ? " · liegt beim Kunden" : ""}</dd></div>
          <div><dt>Für den Kunden</dt><dd>{task.visible ? "freigegeben, steht auch in seinem Kalender" : "nur für das oalab-Team"}</dd></div>
        </dl>
      </PanelSection>
      {nextAppointment && (
        <PanelSection title="Termin mit diesem Kunden">
          <button type="button" className="cal-related-item is-appt" onClick={() => onOpenAppointment(nextAppointment.id)}><CalendarCheck size={14} aria-hidden="true" /><span>{nextAppointment.title}</span><small>{formatDayShort(dayOf(nextAppointment.start))}, {timeOf(nextAppointment.start)}{nextAppointment.status === "requested" ? " · Anfrage" : ""}</small></button>
        </PanelSection>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </AssetPanel>
  );
}

/* ---------- A project's target date ---------- */

export function GoalPanel({ goal, tasks, preview, today, onClose, onOpenTask }: { goal: CalendarGoal; tasks: CalendarTask[]; preview: boolean; today: string; onClose: () => void; onOpenTask: (id: string) => void }) {
  const open = tasks.filter((task) => task.status !== "done" && task.dueOn && task.dueOn <= goal.day).sort((a, b) => (a.dueOn ?? "").localeCompare(b.dueOn ?? ""));
  const days = Math.round((Date.parse(`${goal.day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const hint = goal.done ? "abgeschlossen" : days === 0 ? "heute" : days === 1 ? "morgen" : days > 1 ? `in ${days} Tagen` : `${-days} ${days === -1 ? "Tag" : "Tage"} überfällig`;
  return (
    <AssetPanel className="um-panel cal-panel" label={`Zieltermin: ${goal.name}`} onClose={onClose} icon={<Glyph tone="bad"><Flag size={19} aria-hidden="true" /></Glyph>}
      title={`Zieltermin: ${goal.name}`} subtitle={goal.company || undefined}
      footer={<><Link className="sheet-action" href={`${hubHref(preview, "projects")}?project=${encodeURIComponent(goal.id)}`}><FolderOpen size={15} aria-hidden="true" />Projekt öffnen</Link><span className="pj-spacer" /><button type="button" className="sheet-action is-primary" onClick={onClose}>Fertig</button></>}>
      <div className="cal-summary"><span className="cal-summary-day"><Flag size={16} aria-hidden="true" /><b>{formatDayLong(goal.day)}</b></span><span className="cal-summary-time">{hint}</span></div>
      {open.length > 0 && (
        <div className="cal-related"><span className="am-label">Bis dahin fällig</span>
          {open.map((task) => <button key={task.id} type="button" className="cal-related-item" onClick={() => onOpenTask(task.id)}><TaskGlyph status={task.status} size={13} /><span><span className="numeric">#{task.number}</span> {task.title}</span><small>{task.dueOn ? formatDayShort(task.dueOn) : ""}</small></button>)}
        </div>
      )}
      <Note icon={FolderOpen}>Den Zieltermin änderst du im Projekt. Der Kalender zeigt ihn an.</Note>
    </AssetPanel>
  );
}

/* ---------- Admins: a new task with a date ---------- */

export type TaskProjectOption = { id: string; name: string; company: string; done: boolean };

export function NewTaskPanel({ store, projects, day, confirmHref, onClose, onDone }: { store: CalendarStore; projects: TaskProjectOption[]; day: string; confirmHref: string | null; onClose: () => void; onDone: (message: string) => void }) {
  const running = projects.filter((project) => !project.done);
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState((running[0] ?? projects[0])?.id ?? "");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [dueOn, setDueOn] = useState(day);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const options = [...running].sort((a, b) => a.company.localeCompare(b.company, "de") || a.name.localeCompare(b.name, "de")).map((project) => ({ value: project.id, label: project.name, group: project.company || "Ohne Kunde", lead: <FolderOpen size={15} aria-hidden="true" /> }));
  async function create() {
    setBusy(true);
    setError("");
    const result = await store.newTask({ projectId, title, status, dueOn: dueOn || null });
    setBusy(false);
    if (result.ok) onDone(`#${result.data.number} angelegt · steht im Board unter „${STATUS_NAMES[status]}“${dueOn ? ` und hier am ${formatDayShort(dueOn)}` : ""}.`); else setError(result.error);
  }
  const footer = confirmHref && !store.canEditTasks ? (
    <div className="kb-locked" role="status"><Lock size={15} aria-hidden="true" /><span><b>Nur lesen.</b> Anlegen geht nach einem Code aus der Mail.</span><a className="sheet-action is-primary" href={confirmHref}>Mit Code bestätigen</a></div>
  ) : <>
    <button type="button" className="sheet-action" onClick={onClose} disabled={busy}>Abbrechen</button>
    <span className="pj-spacer" />
    <button type="button" className="sheet-action is-primary" onClick={create} disabled={busy || !title.trim() || !projectId}>{busy ? <MiniLoader size={15} /> : <Check size={15} aria-hidden="true" />}Aufgabe anlegen</button>
  </>;
  return (
    <AssetPanel className="um-panel cal-panel" label="Neue Aufgabe" onClose={onClose} icon={<Glyph tone="info"><SquareKanban size={19} aria-hidden="true" /></Glyph>} title="Neue Aufgabe" subtitle="mit Datum, im Board in der gewählten Spalte" footer={footer}>
      <PanelSection title="Aufgabe">
        <FieldGrid>
          <Field label="Titel" wide><input className="am-input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={240} placeholder="z. B. Texte für die Startseite prüfen" disabled={busy} autoFocus /></Field>
          <div className="um-field is-wide"><span className="am-label">Projekt</span>{options.length ? <Select label="Projekt" value={projectId} onChange={setProjectId} options={options} disabled={busy} searchPlaceholder="Projekt oder Kunde" /> : <span className="cal-static t-secondary">Kein laufendes Projekt</span>}</div>
          <div className="um-field"><span className="am-label">Spalte</span><Select label="Spalte" value={status} onChange={(value) => setStatus(value as TaskStatus)} disabled={busy} options={TASK_STATUSES.filter((value) => value !== "done").map((value) => ({ value, label: STATUS_NAMES[value], lead: <TaskGlyph status={value} size={14} /> }))} /></div>
          <Field label="Fällig am"><input className="am-input" type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} disabled={busy} /></Field>
        </FieldGrid>
        <Note icon={Repeat}>Die Aufgabe steht danach im Board und im Studio, hier im Kalender am Fälligkeitstag.</Note>
      </PanelSection>
      {error && <p className="form-error" role="alert">{error}</p>}
    </AssetPanel>
  );
}

/* ---------- Customers: request a free time ---------- */

export function AskPanel({ store, initialDay, initialStart, onClose, onSent }: { store: CalendarStore; initialDay: string; initialStart?: string; onClose: () => void; onSent: (message: string) => void }) {
  const range = calendarWindow(store.today);
  const firstFree = (from: string, minutes: number) => {
    for (let day = from < store.today ? store.today : from, index = 0; index < 120; day = addDays(day, 1), index += 1) {
      if (monthOf(day) > range.lastMonth) break;
      if (slotStarts(day, store.blocked, minutes, store.now).length) return day;
    }
    return from;
  };
  const [minutes, setMinutes] = useState<number>(60);
  const [day, setDay] = useState(() => slotStarts(initialDay, store.blocked, 60, store.now).length ? initialDay : firstFree(initialDay, 60));
  const [month, setMonth] = useState(monthOf(day));
  const [start, setStart] = useState(initialStart ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const info = useInfo("Termin anfragen", {
    steps: [
      <><b>Mo–Fr, {WORKDAY.start}–{WORKDAY.end} Uhr,</b> nur freie Zeiten.</>,
      <><b>Fest</b> ist der Termin, wenn oalab bestätigt.</>,
      <><b>Die Antwort</b> kommt per Glocke und E-Mail.</>,
    ],
    ask: "Wie frage ich einen Termin an?",
  });
  const starts = isDay(day) ? slotStarts(day, store.blocked, minutes, store.now) : [];
  const chosen = starts.includes(start) ? start : starts[0] ?? "";
  const morning = starts.filter((value) => value < "12:00");
  const afternoon = starts.filter((value) => value >= "12:00");

  async function send() {
    setSending(true);
    setError("");
    const result = await store.request({ title, description, day, start: chosen, minutes });
    setSending(false);
    if (result.ok) onSent(`Deine Anfrage „${title.trim()}“ für ${formatDayShort(day)}, ${chosen} Uhr ist bei oalab. Du bekommst eine Meldung, sobald sie bestätigt ist.`); else setError(result.error);
  }
  const slotGroup = (label: string, list: string[]) => list.length > 0 && (
    <div className="cal-slot-group"><span className="am-label">{label}</span>
      <div className="cal-slots" role="radiogroup" aria-label={label}>{list.map((value) => <button key={value} type="button" role="radio" aria-checked={value === chosen} className={`cal-slot${value === chosen ? " is-on" : ""}`} onClick={() => setStart(value)} disabled={sending}>{value}</button>)}</div>
    </div>
  );

  return (
    <AssetPanel className="um-panel cal-panel" label="Termin anfragen" onClose={onClose} icon={<Glyph tone="info"><CalendarPlus size={19} aria-hidden="true" /></Glyph>} title="Termin anfragen" subtitle="bei oalab · nur freie Zeiten" actions={info.button}
      footer={<><button type="button" className="sheet-action" onClick={onClose} disabled={sending}>Abbrechen</button><span className="pj-spacer" /><button type="button" className="sheet-action is-primary" onClick={send} disabled={sending || !title.trim() || !chosen}>{sending ? <MiniLoader size={15} /> : <Send size={15} aria-hidden="true" />}Anfrage senden</button></>}>
      {info.box}
      <PanelSection title="Worum geht es?">
        <FieldGrid>
          <Field label="Thema" wide><input className="am-input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="z. B. Website-Texte besprechen" disabled={sending} autoFocus /></Field>
          <div className="um-field is-wide"><span className="am-label">Dauer</span>
            <SegmentedControl label="Dauer" value={String(minutes)} onChange={(value) => { setMinutes(Number(value)); setStart(""); }} options={REQUEST_DURATIONS.map((value) => ({ id: String(value), label: formatDuration(value), name: formatDuration(value) }))} />
          </div>
        </FieldGrid>
      </PanelSection>
      <PanelSection title="Tag">
        <div className="cal-mini">
          <div className="cal-mini-head">
            <button type="button" className="cal-nav-btn" onClick={() => setMonth(addMonths(month, -1))} disabled={month <= monthOf(store.today)} aria-label="Vorheriger Monat"><ChevronLeft size={16} aria-hidden="true" /></button>
            <strong>{formatMonth(month)}</strong>
            <button type="button" className="cal-nav-btn" onClick={() => setMonth(addMonths(month, 1))} disabled={month >= range.lastMonth} aria-label="Nächster Monat"><ChevronRight size={16} aria-hidden="true" /></button>
          </div>
          <div className="cal-mini-wd" aria-hidden="true">{["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((name) => <span key={name}>{name}</span>)}</div>
          <div className="cal-mini-grid">
            {monthWeeks(month).flat().map((value) => {
              const outside = monthOf(value) !== month;
              const count = !outside && value >= store.today ? slotStarts(value, store.blocked, minutes, store.now).length : 0;
              return (
                <button key={value} type="button" className={`cal-mini-day${outside ? " is-outside" : ""}${value === day ? " is-on" : ""}${value === store.today ? " is-today" : ""}${count ? " has-free" : ""}`}
                  disabled={!count || sending} aria-pressed={value === day} aria-label={`${formatDayLong(value)}${count ? `, ${count} freie Zeiten` : ", nichts frei"}`} onClick={() => { setDay(value); setStart(""); }}>
                  <span className="numeric">{Number(value.slice(8))}</span>
                </button>
              );
            })}
          </div>
          <p className="cal-mini-key"><span className="cal-mini-dot" aria-hidden="true" />Tage mit freier Zeit für {formatDuration(minutes)}</p>
        </div>
      </PanelSection>
      <PanelSection title="Uhrzeit" meta={isDay(day) ? formatDayShort(day) : undefined}>
        {starts.length ? <>{slotGroup("Vormittag", morning)}{slotGroup("Nachmittag", afternoon)}</> : <p className="t-secondary cal-slots-empty">An diesem Tag ist nichts mehr frei. Nimm einen Tag mit grünem Punkt.</p>}
      </PanelSection>
      <PanelSection title="Nachricht" meta="optional">
        <textarea className="am-textarea" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} placeholder="Worum geht es, was sollen wir vorbereiten?" disabled={sending} />
      </PanelSection>
      {chosen && <div className="cal-summary is-ask"><span className="cal-summary-day"><CalendarCheck size={16} aria-hidden="true" /><b>{formatDayLong(day)}</b></span><span className="cal-summary-time numeric">{chosen}–{clockOf(Number(chosen.slice(0, 2)) * 60 + Number(chosen.slice(3)) + minutes)} Uhr</span></div>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </AssetPanel>
  );
}
