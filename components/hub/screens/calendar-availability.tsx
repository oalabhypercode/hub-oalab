"use client";

import { useState } from "react";
import { CalendarOff, CalendarPlus, Check, Clock, Copy, Eye, Hourglass, Plus, Trash2, X } from "lucide-react";
import {
  addDays, BUFFER_OPTIONS, clockOf, customerFree, DURATION_CHOICES, formatDayShort, formatDuration, formatHours, formatNotice, HORIZON_OPTIONS, isDay,
  lastRequestDay, mergeSpans, mondayOf, NOTICE_OPTIONS, spanMinutes, startsIn, WEEKDAY_LONG, WEEKDAY_SHORT,
  type AvailabilityException, type AvailabilityRules, type DaySpan, type WeekPlan,
} from "@/lib/hub-calendar/rules";
import { SegmentedControl, Switch } from "../controls";
import { useInfo } from "../info-box";
import { Select } from "../select";
import { AssetPanel } from "./asset-panel";
import { CalendarSourcesSection } from "./calendar-sources";
import { Field, FieldGrid, PanelSection } from "./users-panel";
import type { CalendarStore } from "./calendar-store";

/*
 * „Verfügbarkeit“ (Kalender, Schritt 2, 16.11.2026): when oalab offers appointments. The weekly plan, exceptions on
 * single days and the rules for customer requests, as in the approved preview. Every change applies at once; customers
 * request only inside the green times, and the database checks the same rules.
 */

/** Quarter hours from 06:00 to 23:00 for the beginning of a span, up to 24:00 for its end. */
const timeOptions = (from: number, to: number) => {
  const options = [];
  for (let value = from; value <= to; value += 15) options.push({ value: String(value), label: value === 1440 ? "24:00" : clockOf(value) });
  return options;
};
const STARTS = timeOptions(6 * 60, 23 * 60);
const ENDS = timeOptions(6 * 60 + 15, 24 * 60);
const label = (minutes: number) => minutes === 1440 ? "24:00" : clockOf(minutes);

const noticeLabel = (minutes: number) => minutes === 0 ? "Kein Vorlauf" : `mind. ${formatNotice(minutes)}`;
const bufferLabel = (minutes: number) => minutes === 0 ? "Kein Puffer" : `${minutes} Min.`;
const horizonLabel = (weeks: number) => `${weeks} Wochen im Voraus`;

/** How an exception reads in the list: „ganztägig nicht verfügbar“, „09:00–12:00 nicht verfügbar“, „10:00–13:00 zusätzlich“. */
export function exceptionText(item: Pick<AvailabilityException, "kind" | "from" | "to">) {
  if (item.kind === "off") return item.from === null || item.to === null ? "ganztägig nicht verfügbar" : `${label(item.from)}–${label(item.to)} nicht verfügbar`;
  return `${label(item.from ?? 0)}–${label(item.to ?? 0)} zusätzlich`;
}

type Draft = { kind: "off" | "extra"; from: string; until: string; allDay: boolean; start: number; end: number; note: string };
export type ExceptionPreset = { kind: "off" | "extra"; day?: string };

export function AvailabilityPanel({ store, preset, onClose, onNotice }: {
  store: CalendarStore;
  /** Opened with „Abwesenheit eintragen“: the form for a new absence is already open. */
  preset?: ExceptionPreset | null;
  onClose: () => void;
  onNotice: (message: string) => void;
}) {
  const { availability, today } = store;
  const ready = store.availabilityReady;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const start = (kind: "off" | "extra", day = today): Draft => ({ kind, from: day < today ? today : day, until: day < today ? today : day, allDay: kind === "off", start: 9 * 60, end: kind === "off" ? 12 * 60 : 13 * 60, note: "" });
  const [draft, setDraft] = useState<Draft | null>(() => preset ? start(preset.kind, preset.day) : null);
  const info = useInfo("Verfügbarkeit", {
    steps: [
      <><b>Grüne Zeiten</b> können Kunden anfragen, sonst keine.</>,
      <><b>Ausnahmen</b> gehen dem Wochenplan vor.</>,
      <><b>Regeln</b> legen Vorlauf, Puffer und Dauern fest.</>,
    ],
    ask: "Wie lege ich meine Verfügbarkeit im Kalender fest?",
  });

  async function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, message?: string) {
    setBusy(true);
    setError("");
    const result = await action();
    setBusy(false);
    if (!result.ok) setError(result.error);
    else if (message) onNotice(message);
    return result.ok;
  }

  /* ---------- Weekly plan ---------- */
  const setDay = (index: number, spans: DaySpan[]) => {
    const week: WeekPlan = availability.week.map((day, position) => position === index ? mergeSpans(spans) : day);
    void run(() => store.saveWeek(week));
  };
  const changeSpan = (index: number, position: number, edge: 0 | 1, value: number) => {
    const spans = availability.week[index].map((span): DaySpan => [...span]);
    spans[position][edge] = value;
    // Keep the span sensible: the other end follows by half an hour when they would cross.
    if (spans[position][0] >= spans[position][1]) {
      if (edge === 0) spans[position][1] = Math.min(1440, value + 30);
      else spans[position][0] = Math.max(0, value - 30);
    }
    setDay(index, spans);
  };
  const addSpan = (index: number) => {
    const spans = availability.week[index];
    const last = spans.at(-1);
    const from = last ? Math.min(last[1] + 60, 22 * 60) : 9 * 60;
    setDay(index, [...spans, [from, Math.min(from + 120, 1440)]]);
  };
  const copyMonday = () => {
    const monday = availability.week[0];
    void run(() => store.saveWeek(availability.week.map((day, index) => index > 0 && index < 5 ? monday.map((span): DaySpan => [...span]) : day)), "Montag gilt jetzt für alle Werktage.");
  };

  /* ---------- Exceptions ---------- */
  const upcoming = availability.exceptions.filter((item) => item.day >= today);
  async function addException() {
    if (!draft) return;
    const ok = await run(() => store.addException({
      kind: draft.kind, from: draft.from, until: draft.kind === "off" ? draft.until : draft.from, allDay: draft.kind === "off" && draft.allDay,
      start: clockOf(draft.start), end: draft.end === 1440 ? "24:00" : clockOf(draft.end), note: draft.note,
    }), draft.kind === "off" ? "Abwesenheit eingetragen. Kunden können dann nicht anfragen." : "Zusätzliche Zeit eingetragen.");
    if (ok) setDraft(null);
  }

  /* ---------- Rules ---------- */
  const rules = availability.rules;
  const setRules = (patch: Partial<AvailabilityRules>) => void run(() => store.saveRules({ ...rules, ...patch }));
  const toggleDuration = (minutes: number) => {
    const durations = rules.durations.includes(minutes) ? rules.durations.filter((item) => item !== minutes) : [...rules.durations, minutes].sort((a, b) => a - b);
    if (!durations.length) { setError("Mindestens eine Dauer muss bleiben."); return; }
    setRules({ durations });
  };

  // What a customer without open requests sees in the week of today: start times for an hour (or the shortest duration).
  const sample = rules.durations.includes(60) ? 60 : rules.durations[0] ?? 60;
  const weekStart = mondayOf(today);
  const starts = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
    .filter((day) => day >= today)
    .reduce((sum, day) => sum + startsIn(day, customerFree(availability, day, store.busy, [], store.now, today), sample).length, 0);

  const footer = <>
    <span className="cal-foot-hint">{busy ? "Speichert …" : <><Check size={14} aria-hidden="true" />Jede Änderung gilt sofort.</>}</span>
    <span className="pj-spacer" />
    <button type="button" className="sheet-action is-primary" onClick={onClose}>Fertig</button>
  </>;

  return (
    <AssetPanel className="um-panel cal-panel cal-avail-panel" label="Verfügbarkeit" onClose={onClose}
      icon={<span className="cal-panel-glyph tone-ok"><Clock size={19} aria-hidden="true" /></span>}
      title="Verfügbarkeit" subtitle="Wann Kunden Termine anfragen können" footer={footer}>
      {!ready && <p className="cal-panel-note is-warn"><Hourglass size={15} aria-hidden="true" /><span>Die Datenbank-Erweiterung für die Verfügbarkeit fehlt noch. Bis dahin gelten montags bis freitags 9 bis 17 Uhr; ändern lässt sich das erst danach.</span></p>}
      <PanelSection title="Wochenplan" info={info.button} meta={`${formatHours(availability.week.reduce((sum, day) => sum + spanMinutes(day), 0))} pro Woche`}>
        {info.box}
        <div className="cal-wp">
          {availability.week.map((spans, index) => (
            <div key={WEEKDAY_SHORT[index]} className={`cal-wp-row${spans.length ? "" : " is-off"}`}>
              <Switch checked={spans.length > 0} label={`${WEEKDAY_LONG[index]} verfügbar`} disabled={!ready || busy} onChange={(on) => setDay(index, on ? [[9 * 60, 17 * 60]] : [])} />
              <span className="cal-wp-day">{WEEKDAY_SHORT[index]}</span>
              <div className="cal-wp-spans">
                {spans.length ? spans.map(([from, to], position) => (
                  <span key={`${from}-${to}`} className="cal-wp-span">
                    <Select variant="bare" label={`${WEEKDAY_LONG[index]} von`} value={String(from)} options={STARTS} disabled={!ready || busy} onChange={(value) => changeSpan(index, position, 0, Number(value))} />
                    <span className="cal-wp-dash" aria-hidden="true">–</span>
                    <Select variant="bare" label={`${WEEKDAY_LONG[index]} bis`} value={String(to)} options={ENDS} disabled={!ready || busy} onChange={(value) => changeSpan(index, position, 1, Number(value))} />
                    <button type="button" className="row-action" aria-label={`${label(from)}–${label(to)} entfernen`} data-tip="Zeitraum entfernen" disabled={!ready || busy} onClick={() => setDay(index, spans.filter((_, item) => item !== position))}><X size={15} aria-hidden="true" /></button>
                  </span>
                )) : <span className="cal-wp-none">Nicht verfügbar</span>}
                {spans.length > 0 && spans.length < 8 && <button type="button" className="row-action" aria-label={`${WEEKDAY_LONG[index]}: Zeitraum hinzufügen`} data-tip="Zeitraum hinzufügen" disabled={!ready || busy} onClick={() => addSpan(index)}><Plus size={16} aria-hidden="true" /></button>}
              </div>
            </div>
          ))}
        </div>
        <button type="button" className="cal-add-line" onClick={copyMonday} disabled={!ready || busy}><Copy size={15} aria-hidden="true" />Montag auf alle Werktage übertragen</button>
      </PanelSection>

      <PanelSection title="Ausnahmen" meta="gehen dem Wochenplan vor">
        {upcoming.length > 0 ? (
          <ul className="cal-x-list">
            {upcoming.map((item) => (
              <li key={item.id} className={`cal-x is-${item.kind}`}>
                <span className="cal-x-icon">{item.kind === "off" ? <CalendarOff size={15} aria-hidden="true" /> : <CalendarPlus size={15} aria-hidden="true" />}</span>
                <span className="cal-x-text"><strong>{formatDayShort(item.day)}</strong><small>{exceptionText(item)}{item.note ? ` · ${item.note}` : ""}</small></span>
                <button type="button" className="row-action" aria-label={`Ausnahme am ${formatDayShort(item.day)} entfernen`} data-tip="Entfernen" disabled={!ready || busy}
                  onClick={() => void run(() => store.removeException(item.id), `Ausnahme am ${formatDayShort(item.day)} entfernt.`)}><Trash2 size={15} aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
        ) : !draft && <p className="cal-x-empty">Keine Ausnahmen geplant.</p>}
        {draft ? (
          <div className="cal-x-form">
            <SegmentedControl label="Art" value={draft.kind} onChange={(kind) => setDraft(start(kind, draft.from))}
              options={[{ id: "off", label: "Nicht verfügbar", name: "Nicht verfügbar" }, { id: "extra", label: "Zusätzliche Zeit", name: "Zusätzliche Zeit" }]} />
            <FieldGrid>
              <Field label={draft.kind === "off" ? "Von" : "Am"}><input className="am-input" type="date" min={today} value={draft.from} disabled={busy}
                onChange={(event) => { const value = event.target.value; if (isDay(value)) setDraft({ ...draft, from: value, until: draft.until < value ? value : draft.until }); }} /></Field>
              {draft.kind === "off" ? <Field label="Bis"><input className="am-input" type="date" min={draft.from} value={draft.until} disabled={busy}
                onChange={(event) => { const value = event.target.value; if (isDay(value)) setDraft({ ...draft, until: value }); }} /></Field> : <span />}
              {draft.kind === "off" && (
                <div className="um-field is-wide cal-x-allday">
                  <span className="pj-switch-text"><strong>Ganztägig</strong><small>{draft.allDay ? "Der ganze Tag ist nicht buchbar." : "Nur eine Zeitspanne sperren."}</small></span>
                  <Switch checked={draft.allDay} label="Ganztägig" disabled={busy} onChange={(allDay) => setDraft({ ...draft, allDay })} />
                </div>
              )}
              {(draft.kind === "extra" || !draft.allDay) && <>
                <div className="um-field"><span className="am-label">Von</span><Select label="Von" value={String(draft.start)} options={STARTS} disabled={busy}
                  onChange={(value) => { const from = Number(value); setDraft({ ...draft, start: from, end: draft.end <= from ? Math.min(1440, from + 60) : draft.end }); }} /></div>
                <div className="um-field"><span className="am-label">Bis</span><Select label="Bis" value={String(draft.end)} options={ENDS} disabled={busy}
                  onChange={(value) => { const to = Number(value); setDraft({ ...draft, end: to, start: draft.start >= to ? Math.max(0, to - 60) : draft.start }); }} /></div>
              </>}
              <Field label="Notiz" note="nur für dich, Kunden sehen sie nie" wide><input className="am-input" value={draft.note} maxLength={80} disabled={busy}
                placeholder={draft.kind === "off" ? "z. B. Urlaub, Messe, privat" : "z. B. Samstag für den Livegang"} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></Field>
            </FieldGrid>
            <div className="cal-decline-acts">
              <button type="button" className="sheet-action" onClick={() => setDraft(null)} disabled={busy}>Abbrechen</button>
              <button type="button" className="sheet-action is-primary" onClick={() => void addException()} disabled={!ready || busy}><Check size={15} aria-hidden="true" />Hinzufügen</button>
            </div>
          </div>
        ) : (
          <div className="cal-x-add">
            <button type="button" className="cal-add-line" onClick={() => setDraft(start("off"))} disabled={!ready}><CalendarOff size={15} aria-hidden="true" />Abwesenheit eintragen</button>
            <button type="button" className="cal-add-line" onClick={() => setDraft(start("extra"))} disabled={!ready}><CalendarPlus size={15} aria-hidden="true" />Zusätzliche Zeit</button>
          </div>
        )}
      </PanelSection>

      {/* Busy times from the team's calendars in iCloud and Microsoft 365 (stage 2 of the Apple calendar plan, 22.11.2026). */}
      <CalendarSourcesSection preview={!store.live} />

      <PanelSection title="Regeln für Anfragen">
        <FieldGrid>
          <div className="um-field"><span className="am-label">Vorlauf</span>
            <Select label="Vorlauf" value={String(rules.notice)} disabled={!ready || busy} onChange={(value) => setRules({ notice: Number(value) })}
              options={NOTICE_OPTIONS.map((value) => ({ value: String(value), label: noticeLabel(value) }))} /></div>
          <div className="um-field"><span className="am-label">Puffer zwischen Terminen</span>
            <Select label="Puffer zwischen Terminen" value={String(rules.buffer)} disabled={!ready || busy} onChange={(value) => setRules({ buffer: Number(value) })}
              options={BUFFER_OPTIONS.map((value) => ({ value: String(value), label: bufferLabel(value) }))} /></div>
          <div className="um-field is-wide"><span className="am-label">Buchbar bis</span>
            <Select label="Buchbar bis" value={String(rules.horizon)} disabled={!ready || busy} onChange={(value) => setRules({ horizon: Number(value) })}
              options={HORIZON_OPTIONS.map((value) => ({ value: String(value), label: horizonLabel(value) }))} /></div>
          <div className="um-field is-wide"><span className="am-label">Dauer zur Auswahl</span>
            <div className="cal-quick" role="group" aria-label="Dauer zur Auswahl">
              {DURATION_CHOICES.map((minutes) => (
                <button key={minutes} type="button" className={`cal-quick-btn${rules.durations.includes(minutes) ? " is-on" : ""}`} aria-pressed={rules.durations.includes(minutes)} disabled={!ready || busy} onClick={() => toggleDuration(minutes)}>{formatDuration(minutes)}</button>
              ))}
            </div>
          </div>
        </FieldGrid>
        <p className="cal-panel-note"><Eye size={15} aria-hidden="true" /><span>Kunden fragen {rules.notice ? `frühestens ${formatNotice(rules.notice)} vorher` : "ohne Vorlauf"} und höchstens {rules.horizon} Wochen im Voraus an (bis {formatDayShort(lastRequestDay(availability, today))}). Vor und nach jedem Termin bleiben {rules.buffer ? `${rules.buffer} Min.` : "keine Minuten"} frei.</span></p>
      </PanelSection>

      <PanelSection title="So sieht es der Kunde">
        <p className="cal-preview-line"><b className="numeric">{starts}</b> freie Startzeiten für {formatDuration(sample)} in dieser Woche. Gründe wie „Urlaub“ sieht der Kunde nie, nur dass die Zeit nicht frei ist.</p>
      </PanelSection>
      {error && <p className="form-error" role="alert">{error}</p>}
    </AssetPanel>
  );
}
