"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, CalendarPlus, Search } from "lucide-react";
import type { NoteAppointmentView, NoteRequestSlots, NoteResult } from "@/lib/hub-notes/types";
import { Modal } from "../modal";
import { Select } from "../select";

// The notes and the calendar (plan 5, step 3): „/Termin“ picks an appointment of the customer, and selected text
// becomes an appointment: the team enters it right away, customers and freelancers ask for a free time, with the same
// rules as the calendar's request window.

export type AppointmentDraft = { title: string; description: string; day: string; start: string; minutes: number; teamsUrl: string };
export type NoteCalendarUi = {
  /** „anlegen“ for the team, „anfragen“ for customers and freelancers, null where neither goes (the preview's customer?). */
  mode: "create" | "request" | null;
  today: string;
  loadAppointments: () => Promise<NoteAppointmentView[]>;
  loadSlots: (day: string, minutes?: number) => Promise<NoteResult<NoteRequestSlots>>;
  submit: (draft: AppointmentDraft) => Promise<NoteResult<NoteAppointmentView>>;
  /** Says what happened (entered, or asked for), once it worked. */
  notify: (appointment: NoteAppointmentView, onPage: boolean) => void;
};

const STATUS_LABEL: Record<NoteAppointmentView["status"], string> = { requested: "angefragt", confirmed: "bestätigt", declined: "abgelehnt", cancelled: "abgesagt" };
const dayFormat = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Berlin" });
const timeFormat = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const durationLabel = (minutes: number) => minutes < 60 ? `${minutes} Minuten` : minutes === 60 ? "1 Stunde" : `${String(minutes / 60).replace(".", ",")} Stunden`;
const TEAM_DURATIONS = [15, 30, 45, 60, 90, 120, 180];
const TEAM_STARTS = Array.from({ length: (21 - 7) * 4 + 1 }, (_, index) => {
  const minutes = 7 * 60 + index * 15;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

/** „/Termin“: the customer's appointments, upcoming ones first. */
export function AppointmentPicker({ anchor, load, onPick, onClose }: { anchor: DOMRect; load: () => Promise<NoteAppointmentView[]>; onPick: (appointment: NoteAppointmentView) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<NoteAppointmentView[] | null>(null);
  const [query, setQuery] = useState("");
  const [place, setPlace] = useState({ left: anchor.left, top: anchor.bottom + 6 });
  useLayoutEffect(() => {
    const height = box.current?.offsetHeight ?? 300;
    setPlace({ left: Math.max(8, Math.min(anchor.left, window.innerWidth - 348)), top: anchor.bottom + 6 + height > window.innerHeight - 8 ? Math.max(8, anchor.top - height - 6) : anchor.bottom + 6 });
    field.current?.focus();
  }, [anchor, items]);
  useEffect(() => {
    let live = true;
    void load().then((found) => { if (live) setItems(found); });
    return () => { live = false; };
  }, [load]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    const onPointer = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) onClose(); };
    window.addEventListener("keydown", onKey, true);
    const timer = window.setTimeout(() => document.addEventListener("pointerdown", onPointer), 0);
    return () => { window.removeEventListener("keydown", onKey, true); window.clearTimeout(timer); document.removeEventListener("pointerdown", onPointer); };
  }, [onClose]);
  const term = query.trim().toLowerCase();
  const shown = (items ?? []).filter((item) => !term || item.title.toLowerCase().includes(term));
  return createPortal(
    <div ref={box} className="nz-menu nz-glass nz-picker" role="dialog" aria-label="Termin einfügen" style={{ left: place.left, top: place.top }}>
      <div className="nz-menu-caption">Termin einfügen</div>
      <label className="nz-tsearch is-picker"><Search size={14} aria-hidden="true" />
        <input ref={field} value={query} placeholder="Termin suchen" onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && shown[0]) { event.preventDefault(); onPick(shown[0]); } }} />
      </label>
      {items === null && <p className="nz-menu-empty">Lädt …</p>}
      {shown.map((item) => (
        <button key={item.id} type="button" className="nz-menu-item" onClick={() => onPick(item)}>
          <span className="nz-menu-icon"><CalendarDays size={15} aria-hidden="true" /></span>
          <span className="nz-menu-text"><strong>{item.title}</strong><span>{dayFormat.format(new Date(item.start))}, {timeFormat.format(new Date(item.start))} Uhr · {STATUS_LABEL[item.status]}</span></span>
        </button>
      ))}
      {items !== null && !shown.length && <p className="nz-menu-empty">Kein Termin dieses Kunden, den du sehen darfst.</p>}
      <div className="nz-menu-foot">Tag, Uhrzeit und Stand kommen aus dem Kalender</div>
    </div>,
    document.body,
  );
}

/**
 * „Termin anlegen“ (team: with the page's customer, confirmed at once, the customer hears of it) or „Termin anfragen“
 * (customers and freelancers: a free time of oalab's calendar, oalab confirms).
 */
export function AppointmentDialog({ ui, title: initialTitle, onDone, onClose }: { ui: NoteCalendarUi; title: string; onDone: (appointment: NoteAppointmentView) => void; onClose: () => void }) {
  const request = ui.mode === "request";
  const [title, setTitle] = useState(initialTitle.slice(0, 200));
  const [day, setDay] = useState(ui.today);
  const [start, setStart] = useState("10:00");
  const [minutes, setMinutes] = useState(60);
  const [teamsUrl, setTeamsUrl] = useState("");
  const [description, setDescription] = useState("");
  const [slots, setSlots] = useState<NoteRequestSlots | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(request);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!request) return;
    let live = true;
    void ui.loadSlots(day, minutes).then((result) => {
      if (!live) return;
      setLoadingSlots(false);
      if (result.ok) { setSlots(result.data); setStart((current) => result.data.starts.includes(current) ? current : result.data.starts[0] ?? ""); setError(""); }
      else setError(result.error);
    });
    return () => { live = false; };
  }, [request, ui, day, minutes]);
  const valid = Boolean(title.trim()) && /^\d{4}-\d{2}-\d{2}$/.test(day) && Boolean(start) && (!request || Boolean(slots?.starts.includes(start)));
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    const result = await ui.submit({ title: title.trim(), description: description.trim(), day, start, minutes, teamsUrl: teamsUrl.trim() });
    setBusy(false);
    if (result.ok) onDone(result.data); else setError(result.error);
  };
  const changeDay = (value: string) => { setDay(value); if (request) setLoadingSlots(true); };
  const changeMinutes = (value: number) => { setMinutes(value); if (request) setLoadingSlots(true); };
  return (
    <Modal title={request ? "Termin anfragen" : "Termin anlegen"} onClose={onClose} className="nz-dialog">
      <label className="nz-field is-flat"><span>{request ? "Thema" : "Titel"}</span><input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} data-autofocus /></label>
      {request && (
        <div className="nz-field is-flat"><span>Dauer</span>
          <span className="nz-seg" role="group" aria-label="Dauer">{(slots?.durations ?? [30, 60]).map((value) => <button key={value} type="button" className={`nz-seg-btn${minutes === value ? " is-on" : ""}`} aria-pressed={minutes === value} onClick={() => changeMinutes(value)}>{durationLabel(value)}</button>)}</span>
        </div>
      )}
      <label className="nz-field is-flat"><span>Tag</span><input type="date" value={day} min={ui.today} max={slots?.lastDay} onChange={(event) => changeDay(event.target.value)} /></label>
      {request ? (
        <div className="nz-field is-flat"><span>Freie Zeiten</span>
          <span className="nz-slots" role="radiogroup" aria-label="Freie Zeiten">
            {loadingSlots && <small className="nz-muted">Lädt …</small>}
            {!loadingSlots && slots?.starts.map((value) => <button key={value} type="button" role="radio" aria-checked={value === start} className={`nz-slot${value === start ? " is-on" : ""}`} onClick={() => setStart(value)}>{value}</button>)}
            {!loadingSlots && slots && !slots.starts.length && <small className="nz-muted">An diesem Tag ist nichts frei. Wähle einen anderen Tag.</small>}
          </span>
        </div>
      ) : (
        <>
          <div className="nz-field is-flat"><span>Beginn</span><Select value={start} onChange={setStart} label="Beginn" options={TEAM_STARTS.map((value) => ({ value, label: `${value} Uhr` }))} /></div>
          <div className="nz-field is-flat"><span>Dauer</span><Select value={String(minutes)} onChange={(value) => setMinutes(Number(value))} label="Dauer" options={TEAM_DURATIONS.map((value) => ({ value: String(value), label: durationLabel(value) }))} /></div>
        </>
      )}
      {request
        ? <label className="nz-field is-flat"><span>Nachricht</span><textarea rows={2} value={description} maxLength={2000} placeholder="Worum es gehen soll (optional)" onChange={(event) => setDescription(event.target.value)} /></label>
        : <label className="nz-field is-flat"><span>Meeting-Link</span><input value={teamsUrl} inputMode="url" maxLength={2048} placeholder="Link aus Teams, Zoom oder Google Meet (optional)" onChange={(event) => setTeamsUrl(event.target.value)} spellCheck={false} /></label>}
      <p className="nz-pop-note">{request ? "oalab bestätigt den Termin oder schlägt eine andere Zeit vor; die Antwort kommt in die Glocke und per E-Mail." : "Der Termin steht sofort fest; der Kunde bekommt eine Meldung in der Glocke und per E-Mail."}</p>
      {error && <p className="nz-pop-note is-warn" role="alert">{error}</p>}
      <div className="nz-dialog-actions">
        <button type="button" className="nz-btn" onClick={onClose}>Abbrechen</button>
        <button type="button" className="nz-btn is-primary" disabled={!valid || busy} onClick={() => void submit()}><CalendarPlus size={15} aria-hidden="true" />{busy ? (request ? "Sendet …" : "Legt an …") : request ? "Anfrage senden" : "Termin anlegen"}</button>
      </div>
    </Modal>
  );
}

/** On a page one may only read: selected text offers „Termin anfragen“ (customers and freelancers). */
export function ReadSelectionBar({ host, onRequest }: { host: React.RefObject<HTMLDivElement | null>; onRequest: (text: string) => void }) {
  const [state, setState] = useState<{ text: string; rect: DOMRect } | null>(null);
  useEffect(() => {
    const update = () => {
      const selection = window.getSelection();
      const root = host.current;
      if (!selection || selection.isCollapsed || !root || !selection.rangeCount) { setState(null); return; }
      const range = selection.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) { setState(null); return; }
      const text = selection.toString().replace(/\s+/g, " ").trim();
      setState(text ? { text: text.slice(0, 200), rect: range.getBoundingClientRect() } : null);
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [host]);
  if (!state) return null;
  const top = state.rect.top - 44 > 8 ? state.rect.top - 44 : state.rect.bottom + 8;
  return createPortal(
    <div className="nz-toolbar nz-glass nz-read-bar" role="toolbar" aria-label="Markierten Text verwenden" style={{ left: Math.max(8, Math.min(state.rect.left, window.innerWidth - 200)), top }}
      onMouseDown={(event) => event.preventDefault()}>
      <button type="button" className="nz-tb nz-tb-wide" onClick={() => { const text = state.text; setState(null); onRequest(text); }}><CalendarPlus size={15} aria-hidden="true" /><span>Termin anfragen</span></button>
    </div>,
    document.body,
  );
}
