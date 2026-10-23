"use client";

import { useState } from "react";
import { Check, Loader2, Pencil, Send, Trash2, Undo2, Video, X } from "lucide-react";
import {
  addDays, addMonths, APPOINTMENT_DURATIONS, appointmentStatuses, calendarWindow, dayOf, formatDayLong, formatTimeRange, isClock, isDay, overlaps,
  REQUEST_DURATIONS, slotStarts, timeOf, wallTimeToUtc, WORKDAY, type AppointmentStatus,
} from "@/lib/hub-calendar/rules";
import type { HubAppointment } from "@/lib/hub-calendar/types";
import { Modal } from "../modal";
import type { CalendarStore } from "./calendar-store";

const MINUTE = 60_000;

export function StatusPill({ status }: { status: AppointmentStatus }) {
  return <span className={`appointment-status appointment-status-${status}`}><i aria-hidden="true" />{appointmentStatuses[status]}</span>;
}

/** Join link of a confirmed appointment; fixture links are examples and stay inactive. */
export function TeamsJoin({ appointment, compact = false }: { appointment: HubAppointment; compact?: boolean }) {
  if (!appointment.teamsUrl) return null;
  const label = compact ? "Teams" : "Teams-Meeting beitreten";
  if (appointment.sample) {
    return <span className={`teams-join is-sample${compact ? " is-compact" : ""}`} title="Beispiel-Link aus der Demo, kein echtes Meeting"><Video size={18} aria-hidden="true" /><span className="teams-join-label">{label}</span>{!compact && <small>Beispiel</small>}</span>;
  }
  return <a className={`teams-join${compact ? " is-compact" : ""}`} href={appointment.teamsUrl} target="_blank" rel="noopener noreferrer" aria-label={`${appointment.title}: Teams-Meeting beitreten (öffnet Microsoft Teams)`}><Video size={18} aria-hidden="true" /><span className="teams-join-label">{label}</span></a>;
}

const customerLabel = (appointment: HubAppointment) => appointment.customer ? `${appointment.customer.customerNumber} · ${appointment.customer.company}` : "Intern (kein Kunde)";

/** Everything about one appointment; admins answer requests and manage appointments here, customers can withdraw open requests. */
export function AppointmentDetailDialog({ appointment, store, onClose, onEdit }: { appointment: HubAppointment; store: CalendarStore; onClose: () => void; onEdit: (accept: boolean) => void }) {
  const [closing, setClosing] = useState<"declined" | "cancelled" | null>(null);
  const [note, setNote] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { canManage } = store;
  const upcoming = appointment.end > store.now;

  async function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setBusy(true);
    setError("");
    const result = await action();
    setBusy(false);
    if (result.ok) onClose(); else setError(result.error);
  }

  return (
    <Modal title={appointment.title} onClose={onClose}>
      <div className="appointment-detail-head">
        <StatusPill status={appointment.status} />
        <span>{formatDayLong(dayOf(appointment.start))} · {formatTimeRange(appointment)}</span>
      </div>
      <dl className="file-details">
        {canManage && <div><dt>Kunde</dt><dd>{customerLabel(appointment)}</dd></div>}
        <div className="file-details-block"><dt>{appointment.status === "requested" && !canManage ? "Deine Nachricht" : "Beschreibung"}</dt><dd>{appointment.description || "Keine Beschreibung hinterlegt."}</dd></div>
        {appointment.responseNote && <div className="file-details-block"><dt>Hinweis von OALAB</dt><dd>{appointment.responseNote}</dd></div>}
        {appointment.status === "confirmed" && (
          <div className="file-details-block"><dt>Microsoft Teams</dt><dd>{appointment.teamsUrl ? <TeamsJoin appointment={appointment} /> : canManage ? "Noch kein Teams-Link hinterlegt." : "Den Teams-Link ergänzt dein OALAB-Team."}</dd></div>
        )}
      </dl>
      {appointment.status === "requested" && !canManage && <p className="t-footnote t-secondary appointment-note">Dein OALAB-Team bestätigt die Anfrage oder schlägt eine andere Zeit vor. Erst dann ist der Termin fest.</p>}
      {appointment.sample && <p className="t-footnote t-secondary appointment-note">Fiktiver Beispieltermin für die Demo.</p>}

      {closing && (
        <div className="appointment-close">
          <label className="upload-field"><span>{closing === "declined" ? "Grund für die Absage an den Kunden (optional)" : "Hinweis zur Absage (optional)"}</span>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={3} placeholder={closing === "declined" ? "z. B. Leider schon verplant. Wie wäre Dienstag, 10 Uhr?" : "z. B. Wir melden uns mit einem neuen Termin."} disabled={busy} />
          </label>
          <div className="file-assign-actions">
            <button type="button" className="sheet-button" onClick={() => setClosing(null)} disabled={busy}>Zurück</button>
            <button type="button" className="sheet-button sheet-button-danger" onClick={() => run(() => store.close(appointment.id, closing, note))} disabled={busy}>{busy ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <X size={18} aria-hidden="true" />}{closing === "declined" ? "Anfrage ablehnen" : "Termin absagen"}</button>
          </div>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}

      {!closing && canManage && (
        <div className="file-detail-actions">
          {appointment.status === "requested" && <>
            <button type="button" className="sheet-button" onClick={() => setClosing("declined")}><X size={18} aria-hidden="true" />Ablehnen</button>
            <button type="button" className="sheet-button sheet-button-primary" onClick={() => onEdit(true)}><Check size={18} aria-hidden="true" />Annehmen</button>
          </>}
          {appointment.status === "confirmed" && <>
            <button type="button" className="sheet-button" onClick={() => onEdit(false)}><Pencil size={18} aria-hidden="true" />Bearbeiten</button>
            {upcoming && <button type="button" className="sheet-button" onClick={() => setClosing("cancelled")}><X size={18} aria-hidden="true" />Absagen</button>}
          </>}
          {(appointment.status === "declined" || appointment.status === "cancelled") && upcoming && <button type="button" className="sheet-button" onClick={() => onEdit(false)}><Undo2 size={18} aria-hidden="true" />Neu planen</button>}
          {appointment.status !== "requested" && (
            <button type="button" className={`sheet-button${confirmDelete ? " sheet-button-danger" : ""}`} onClick={() => confirmDelete ? run(() => store.remove(appointment.id)) : setConfirmDelete(true)} disabled={busy}>
              {busy ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <Trash2 size={18} aria-hidden="true" />}{confirmDelete ? "Endgültig löschen" : "Löschen"}
            </button>
          )}
        </div>
      )}
      {!canManage && appointment.status === "requested" && upcoming && (
        <div className="file-detail-actions">
          <button type="button" className={`sheet-button${confirmWithdraw ? " sheet-button-danger" : ""}`} onClick={() => confirmWithdraw ? run(() => store.withdraw(appointment.id)) : setConfirmWithdraw(true)} disabled={busy}>
            {busy ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <Undo2 size={18} aria-hidden="true" />}{confirmWithdraw ? "Wirklich zurückziehen" : "Anfrage zurückziehen"}
          </button>
        </div>
      )}
    </Modal>
  );
}

const durationLabel = (minutes: number) => minutes < 60 ? `${minutes} Min.` : `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(minutes / 60)} Std.`;

/** Admin: create or edit an appointment; with `accept` it answers a customer's request. */
export function AppointmentFormDialog({ store, appointment, day: initialDay, start: initialStart, accept = false, onClose, onSaved }: { store: CalendarStore; appointment?: HubAppointment; day: string; start?: string; accept?: boolean; onClose: () => void; onSaved: (message: string) => void }) {
  const [title, setTitle] = useState(appointment?.title ?? "");
  const [customerId, setCustomerId] = useState(appointment?.customer?.id ?? "");
  const [day, setDay] = useState(appointment ? dayOf(appointment.start) : initialDay);
  const [start, setStart] = useState(appointment ? timeOf(appointment.start) : initialStart ?? "10:00");
  const [minutes, setMinutes] = useState(appointment ? Math.round((appointment.end - appointment.start) / MINUTE) : 60);
  const [teamsUrl, setTeamsUrl] = useState(appointment?.teamsUrl ?? "");
  const [description, setDescription] = useState(appointment?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const durations = (APPOINTMENT_DURATIONS as readonly number[]).includes(minutes) ? APPOINTMENT_DURATIONS : [...APPOINTMENT_DURATIONS, minutes].sort((a, b) => a - b);

  const interval = isDay(day) && isClock(start) ? { start: wallTimeToUtc(day, start), end: wallTimeToUtc(day, start) + minutes * MINUTE } : null;
  const conflicts = interval ? store.appointments.filter((item) => item.id !== appointment?.id && item.status === "confirmed" && overlaps(item, interval)) : [];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const result = await store.save(appointment?.id ?? null, { title, description, customerId: customerId || null, day, start, minutes, teamsUrl });
    setSaving(false);
    if (!result.ok) { setError(result.error); return; }
    onSaved(accept ? `„${title.trim()}“ ist bestätigt.` : appointment ? `„${title.trim()}“ wurde gespeichert.` : `„${title.trim()}“ steht im Kalender.`);
  }

  return (
    <Modal title={accept ? "Anfrage annehmen" : appointment ? "Termin bearbeiten" : "Neuer Termin"} onClose={onClose}>
      {accept && appointment?.customer && <p className="modal-description">Anfrage von {appointment.customer.company} ({appointment.customer.customerNumber}). Du kannst Zeit und Angaben anpassen, bevor du bestätigst.</p>}
      <form onSubmit={submit} className="upload-form">
        <div className="upload-fields">
          <label className="upload-field upload-field-wide"><span>Titel</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="z. B. Abstimmung Website-Inhalte" required disabled={saving} /></label>
          <label className="upload-field upload-field-wide"><span>Kunde</span>
            <select value={customerId} onChange={(event) => setCustomerId(event.target.value)} disabled={saving || (accept && Boolean(appointment?.customer))}>
              <option value="">Intern (kein Kunde)</option>
              {store.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.customerNumber} · {customer.company}</option>)}
            </select>
          </label>
          <div className="appointment-time-fields">
            <label className="upload-field"><span>Datum</span><input type="date" value={day} onChange={(event) => setDay(event.target.value)} required disabled={saving} /></label>
            <label className="upload-field"><span>Beginn</span><input type="time" value={start} step={900} onChange={(event) => setStart(event.target.value)} required disabled={saving} /></label>
            <label className="upload-field"><span>Dauer</span>
              <select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} disabled={saving}>{durations.map((value) => <option key={value} value={value}>{durationLabel(value)}</option>)}</select>
            </label>
          </div>
          <label className="upload-field upload-field-wide"><span>Microsoft-Teams-Link (optional)</span>
            <input type="url" inputMode="url" value={teamsUrl} onChange={(event) => setTeamsUrl(event.target.value)} maxLength={2048} placeholder="https://teams.microsoft.com/l/meetup-join/…" disabled={saving} />
            <small className="field-hint">In Teams oder Outlook ein Meeting anlegen und den Link „An der Besprechung teilnehmen“ hier einfügen.</small>
          </label>
          <label className="upload-field upload-field-wide"><span>Beschreibung</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={3} placeholder="Agenda oder Vorbereitung für den Termin" disabled={saving} /></label>
        </div>
        {conflicts.length > 0 && <p className="appointment-conflict" role="status">Überschneidet sich mit {conflicts.map((item) => `${formatTimeRange(item)} „${item.title}“`).join(", ")}.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="file-assign-actions">
          <button type="button" className="sheet-button" onClick={onClose} disabled={saving}>Abbrechen</button>
          <button type="submit" className="sheet-button sheet-button-primary" disabled={saving}>{saving ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}{accept ? "Bestätigen" : appointment ? "Speichern" : "Termin anlegen"}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Customer: request an appointment in a free slot; only free start times inside the working hours are offered. */
export function RequestDialog({ store, day: initialDay, start: initialStart, onClose, onSent }: { store: CalendarStore; day: string; start?: string; onClose: () => void; onSent: (message: string) => void }) {
  const [day, setDay] = useState(initialDay);
  const [minutes, setMinutes] = useState<number>(60);
  const [start, setStart] = useState(initialStart ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const lastDay = addDays(`${addMonths(calendarWindow(store.today).lastMonth, 1)}-01`, -1);
  const slots = isDay(day) ? slotStarts(day, store.blocked, minutes, store.now) : [];
  const chosen = slots.includes(start) ? start : slots[0] ?? "";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setError("");
    const result = await store.request({ title, description, day, start: chosen, minutes });
    setSending(false);
    if (!result.ok) { setError(result.error); return; }
    onSent(`Deine Anfrage „${title.trim()}“ ist bei OALAB. Du siehst hier, sobald sie bestätigt ist.`);
  }

  return (
    <Modal title="Termin anfragen" onClose={onClose}>
      <p className="modal-description">Wähle einen freien Zeitraum. Dein OALAB-Team bestätigt den Termin und hinterlegt den Teams-Link.</p>
      <form onSubmit={submit} className="upload-form">
        <div className="upload-fields">
          <label className="upload-field"><span>Datum</span><input type="date" value={day} min={dayOf(store.now)} max={lastDay} onChange={(event) => setDay(event.target.value)} required disabled={sending} /></label>
          <label className="upload-field"><span>Dauer</span>
            <select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} disabled={sending}>{REQUEST_DURATIONS.map((value) => <option key={value} value={value}>{durationLabel(value)}</option>)}</select>
          </label>
          <label className="upload-field upload-field-wide"><span>Freie Uhrzeit</span>
            {slots.length
              ? <select value={chosen} onChange={(event) => setStart(event.target.value)} disabled={sending}>{slots.map((slot) => <option key={slot} value={slot}>{slot} Uhr</option>)}</select>
              : <span className="appointment-no-slots" role="status">{isDay(day) ? `An diesem Tag ist kein passender Zeitraum frei. Termine sind montags bis freitags von ${WORKDAY.start} bis ${WORKDAY.end} Uhr möglich.` : "Bitte ein Datum wählen."}</span>}
          </label>
          <label className="upload-field upload-field-wide"><span>Thema</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="z. B. Website-Texte besprechen" required disabled={sending} /></label>
          <label className="upload-field upload-field-wide"><span>Nachricht (optional)</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={3} placeholder="Worum geht es, was sollen wir vorbereiten?" disabled={sending} /></label>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="file-assign-actions">
          <button type="button" className="sheet-button" onClick={onClose} disabled={sending}>Abbrechen</button>
          <button type="submit" className="sheet-button sheet-button-primary" disabled={sending || !chosen}>{sending ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}Anfrage senden</button>
        </div>
      </form>
    </Modal>
  );
}
