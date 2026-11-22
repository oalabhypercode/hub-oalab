"use client";

import { useEffect, useState } from "react";
import { Check, Cloud, LockKeyhole, Mail, Plus, SlidersHorizontal, Trash2, TriangleAlert } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { addCalendarSource, loadCalendarSources, removeCalendarSource, replaceCalendarSourceLink, saveCalendarSourceRules, type CalendarSourcesState } from "@/lib/hub-calendar/actions";
import { fetchedAgo } from "@/lib/hub-calendar/feed-rules";
import {
  DEFAULT_SOURCE_RULES, failingFor, fetchErrorText, readCalendarLink, SOURCE_ALERT_HOURS, SOURCE_EVERY_MINUTES, SOURCE_WEEKS, sourceLabel, sourceState,
  type SourceRules, type SourceView,
} from "@/lib/hub-calendar/sources-rules";
import type { CalendarActionResult } from "@/lib/hub-calendar/types";
import { Switch } from "../controls";
import { useMinute } from "./calendar-feed";
import { PanelSection } from "./users-panel";

/*
 * „Andere Kalender berücksichtigen“ in Kalender › Verfügbarkeit (stage 2 of the plan, approved preview „Kalender-Abo“,
 * 22.11.2026): calendars in iCloud and mailboxes in Microsoft 365 whose busy times block requests. Each with its state,
 * its two rules and „Entfernen“; a link that stopped working gets „Link neu einfügen“. The hub reads only start and end.
 * The preview shows three example sources and keeps every change in this browser window.
 */

const tryAgain = "Das hat gerade nicht geklappt. Bitte versuche es erneut.";
const failed = { ok: false as const, error: tryAgain };
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const RULE_ROWS: { key: keyof SourceRules; label: string; sub: string }[] = [
  { key: "ignoreAllDay", label: "Ganztägige Einträge ignorieren", sub: "sonst sperren Geburtstage ganze Tage" },
  { key: "ignoreFree", label: "Freie und abgesagte Einträge ignorieren", sub: "was nicht belegt, sperrt auch nichts" },
];

/** The preview's sources, like the approved preview: two working, one that has not answered for 26 hours. */
function exampleState(now: number): CalendarSourcesState {
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  const base = { kind: "ics" as const, mailbox: null, rules: DEFAULT_SOURCE_RULES, createdAt: ago(60 * 24 * 7), ownerName: null };
  return {
    vault: true,
    microsoft: { configured: true, mailboxes: [{ address: "du@example.test", own: true }, { address: "team@example.test", own: false }] },
    sources: [
      { ...base, id: "preview-1", provider: "icloud", name: "Privat", lastSuccessAt: ago(4), failingSince: null, lastError: null, busyCount: 6 },
      { ...base, id: "preview-2", kind: "microsoft", provider: "microsoft", name: "Dein Postfach", mailbox: "du@example.test", lastSuccessAt: ago(6), failingSince: null, lastError: null, busyCount: 14 },
      { ...base, id: "preview-3", provider: "icloud", name: "Familie", lastSuccessAt: ago(60 * 26), failingSince: ago(60 * 26), lastError: "gone", busyCount: 3 },
    ],
  };
}

function RuleSwitches({ rules, disabled, onChange }: { rules: SourceRules; disabled: boolean; onChange: (next: SourceRules) => void }) {
  return (
    <div className="cal-feed-rows">
      {RULE_ROWS.map((row) => (
        <div key={row.key} className="cal-feed-row-wrap">
          <div className="cal-feed-row">
            <span className="cal-feed-row-text"><strong>{row.label}</strong><small>{row.sub}</small></span>
            <Switch checked={rules[row.key]} label={row.label} disabled={disabled} onChange={(on) => onChange({ ...rules, [row.key]: on })} />
          </div>
        </div>
      ))}
    </div>
  );
}

type Form =
  | { kind: "ics"; link: string; name: string; rules: SourceRules }
  | { kind: "microsoft"; mailbox: string; other: string; rules: SourceRules }
  | { kind: "relink"; id: string; link: string };

export function CalendarSourcesSection({ preview }: { preview: boolean }) {
  const now = useMinute();
  const [state, setState] = useState<CalendarSourcesState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    if (preview) {
      const timer = window.setTimeout(() => { if (active) setState(exampleState(Date.now())); }, 0);
      return () => { active = false; window.clearTimeout(timer); };
    }
    loadCalendarSources().then((result) => {
      if (!active) return;
      if (result.ok) setState(result.data); else setLoadError(result.error);
    }).catch(() => { if (active) setLoadError(tryAgain); });
    return () => { active = false; };
  }, [preview]);

  async function run(action: () => Promise<CalendarActionResult<CalendarSourcesState>>, message: string, after?: () => void) {
    setBusy(true);
    setError("");
    setNotice("");
    const result = await action().catch(() => failed);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setState(result.data);
    setNotice(message);
    after?.();
  }

  /** The preview changes its own copy only. */
  const local = (change: (sources: SourceView[]) => SourceView[]) => async (): Promise<CalendarActionResult<CalendarSourcesState>> =>
    state ? { ok: true, data: { ...state, sources: change(state.sources) } } : failed;

  function add() {
    if (!form || form.kind === "relink") return;
    if (form.kind === "ics") {
      const link = readCalendarLink(form.link);
      if (!link.ok) { setError(link.error); return; }
      const name = form.name.trim() || (link.provider === "icloud" ? "iCloud-Kalender" : "Outlook-Kalender");
      void run(
        preview
          ? local((sources) => [...sources, { id: `preview-${sources.length + 4}`, kind: "ics", provider: link.provider, name, mailbox: null, rules: form.rules, createdAt: new Date().toISOString(), lastSuccessAt: null, failingSince: null, lastError: null, busyCount: 0, ownerName: null }])
          : () => addCalendarSource({ kind: "ics", link: form.link, name: form.name, rules: form.rules }),
        `„${sourceLabel({ provider: link.provider, name })}“ hinzugefügt. Belegte Zeiten kommen mit dem nächsten Abruf, spätestens in ${SOURCE_EVERY_MINUTES} Minuten.`,
        () => setForm(null),
      );
      return;
    }
    const mailbox = (form.mailbox === "other" ? form.other : form.mailbox).trim().toLowerCase();
    if (!mailbox) { setError("Bitte ein Postfach wählen oder seine Adresse eingeben."); return; }
    void run(
      preview
        ? local((sources) => [...sources, { id: `preview-${sources.length + 4}`, kind: "microsoft", provider: "microsoft", name: mailbox, mailbox, rules: form.rules, createdAt: new Date().toISOString(), lastSuccessAt: null, failingSince: null, lastError: null, busyCount: 0, ownerName: null }])
        : () => addCalendarSource({ kind: "microsoft", mailbox, rules: form.rules }),
      `Microsoft 365 · ${mailbox} hinzugefügt. Belegte Zeiten kommen mit dem nächsten Abruf, spätestens in ${SOURCE_EVERY_MINUTES} Minuten.`,
      () => setForm(null),
    );
  }

  function saveRules(source: SourceView, rules: SourceRules) {
    void run(
      preview ? local((sources) => sources.map((item) => (item.id === source.id ? { ...item, rules } : item))) : () => saveCalendarSourceRules(source.id, rules),
      "Gespeichert. Die Regeln gelten ab dem nächsten Abruf, gleich jetzt.",
    );
  }

  function relink() {
    if (!form || form.kind !== "relink") return;
    const link = readCalendarLink(form.link);
    if (!link.ok) { setError(link.error); return; }
    void run(
      preview ? local((sources) => sources.map((item) => (item.id === form.id ? { ...item, provider: link.provider, failingSince: null, lastError: null, lastSuccessAt: null } : item))) : () => replaceCalendarSourceLink(form.id, form.link),
      "Neuer Link gespeichert, verschlüsselt. Der alte ist ersetzt.",
      () => setForm(null),
    );
  }

  function remove(source: SourceView) {
    void run(
      preview ? local((sources) => sources.filter((item) => item.id !== source.id)) : () => removeCalendarSource(source.id),
      `„${sourceLabel(source)}“ entfernt. Seine Zeiten sperren ab sofort nichts mehr.`,
      () => setOpen(null),
    );
  }

  const meta = (source: SourceView) => {
    const status = sourceState(source);
    if (status === "new") return `wird gelesen … die ersten Zeiten kommen spätestens in ${SOURCE_EVERY_MINUTES} Minuten`;
    if (status === "failing") return `nicht erreichbar ${now ? failingFor(source.failingSince!, now) : ""} · es gelten die zuletzt gelesenen Zeiten`;
    return `zuletzt gelesen ${now ? fetchedAgo(source.lastSuccessAt, now) : ""} · ${plural(source.busyCount, "belegte Zeit", "belegte Zeiten")} in den nächsten ${SOURCE_WEEKS} Wochen`;
  };
  const broken = state?.sources.find((source) => sourceState(source) === "failing");
  const long = broken?.failingSince && now ? now - Date.parse(broken.failingSince) >= SOURCE_ALERT_HOURS * 3_600_000 : false;

  return (
    <PanelSection title={<>Andere Kalender berücksichtigen <span className="cal-src-new">Neu</span></>}>
      <p className="cal-feed-lead">Termine aus diesen Kalendern sperren Zeiten für alle Anfragen. Der Hub liest nur Beginn und Ende, nie Titel, Orte oder Teilnehmer.</p>
      {!state && !loadError && <p className="cal-panel-note"><MiniLoader size={15} /><span>Wird geladen …</span></p>}
      {loadError && <p className="cal-panel-note is-warn"><TriangleAlert size={15} aria-hidden="true" /><span>{loadError}</span></p>}

      {state && state.sources.length > 0 && (
        <div className="cal-feed-rows cal-src-list">
          {state.sources.map((source) => {
            const status = sourceState(source);
            const expanded = open === source.id;
            return (
              <div key={source.id} className="cal-feed-row-wrap">
                <div className="cal-feed-row">
                  <span className={`cal-src-ico ${source.kind === "microsoft" ? "is-ms" : "is-icloud"}`}>{source.kind === "microsoft" ? <Mail size={16} aria-hidden="true" /> : <Cloud size={16} aria-hidden="true" />}</span>
                  <span className="cal-feed-row-text">
                    <strong>{sourceLabel(source)}</strong>
                    <small>{meta(source)}{source.ownerName ? ` · hinterlegt von ${source.ownerName}` : ""}</small>
                  </span>
                  <span className={`chat-pill ${status === "failing" ? "tone-todo" : status === "new" ? "tone-info" : "tone-ok"}`}>{status === "failing" ? "Störung" : status === "new" ? "Neu" : "Aktiv"}</span>
                  <button type="button" className="row-action" aria-expanded={expanded} aria-label={`Regeln für ${sourceLabel(source)}`} data-tip="Regeln" onClick={() => { setOpen(expanded ? null : source.id); setForm(null); }}>
                    <SlidersHorizontal size={16} aria-hidden="true" />
                  </button>
                </div>
                {expanded && (
                  <div className="cal-feed-row-sub cal-src-rules">
                    {status === "failing" && <p className="cal-panel-note is-warn"><TriangleAlert size={15} aria-hidden="true" /><span>{fetchErrorText(source.lastError)}</span></p>}
                    <RuleSwitches rules={source.rules} disabled={busy} onChange={(rules) => saveRules(source, rules)} />
                    {form?.kind === "relink" && form.id === source.id ? (
                      <div className="cal-src-relink">
                        <label className="am-label" htmlFor={`relink-${source.id}`}>Neuer Link des öffentlichen Kalenders</label>
                        <input id={`relink-${source.id}`} className="am-input" value={form.link} placeholder="webcal://p…-caldav.icloud.com/published/2/…" autoComplete="off" spellCheck={false}
                          onChange={(event) => setForm({ ...form, link: event.target.value })} disabled={busy} />
                        <div className="cal-decline-acts">
                          <button type="button" className="sheet-action" onClick={() => setForm(null)} disabled={busy}>Abbrechen</button>
                          <button type="button" className="sheet-action is-primary" onClick={relink} disabled={busy || !form.link.trim()}>{busy ? <MiniLoader size={15} /> : <Check size={15} aria-hidden="true" />}Speichern</button>
                        </div>
                      </div>
                    ) : (
                      <div className="cal-feed-actions">
                        {source.kind === "ics" && status === "failing" && <button type="button" className="sheet-action" onClick={() => setForm({ kind: "relink", id: source.id, link: "" })} disabled={busy}>Link neu einfügen</button>}
                        <button type="button" className="sheet-action is-danger" onClick={() => remove(source)} disabled={busy}><Trash2 size={15} aria-hidden="true" />Entfernen</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {state && !state.sources.length && !form && <p className="cal-x-empty">Noch kein anderer Kalender. Termine aus iCloud oder Microsoft 365 sperren dann die Zeiten, die Kunden anfragen können.</p>}

      {broken && (
        <p className="cal-panel-note is-warn"><TriangleAlert size={15} aria-hidden="true" /><span><b>„{sourceLabel(broken)}“ ist {now ? failingFor(broken.failingSince!, now) : ""} nicht erreichbar.</b> Bis er wieder geht, gelten die zuletzt gelesenen Zeiten.{long ? " Die Glocke hat darauf hingewiesen." : ""}</span></p>
      )}

      {state && !form?.kind && (
        <div className="cal-x-add">
          <button type="button" className="cal-add-line" onClick={() => { setForm({ kind: "ics", link: "", name: "", rules: DEFAULT_SOURCE_RULES }); setOpen(null); setError(""); }}><Plus size={15} aria-hidden="true" />iCloud-Kalender</button>
          <button type="button" className="cal-add-line" onClick={() => { setForm({ kind: "microsoft", mailbox: state.microsoft.mailboxes[0]?.address ?? "other", other: "", rules: DEFAULT_SOURCE_RULES }); setOpen(null); setError(""); }}><Plus size={15} aria-hidden="true" />Microsoft 365</button>
        </div>
      )}
      {state && form?.kind === "relink" && (
        <div className="cal-x-add">
          <button type="button" className="cal-add-line" onClick={() => { setForm({ kind: "ics", link: "", name: "", rules: DEFAULT_SOURCE_RULES }); setOpen(null); }}><Plus size={15} aria-hidden="true" />iCloud-Kalender</button>
        </div>
      )}

      {state && form?.kind === "ics" && (
        <div className="cal-x-form cal-src-form">
          <strong className="cal-src-form-title">iCloud-Kalender hinzufügen</strong>
          <ol className="cal-feed-steps">
            <li>Auf iCloud.com unter Kalender beim gewünschten Kalender auf das Info-Symbol klicken.</li>
            <li>„Öffentlicher Kalender“ einschalten und „Link kopieren“ wählen.</li>
            <li>Den Link hier einfügen.</li>
          </ol>
          <label className="am-label" htmlFor="src-link">Link des öffentlichen Kalenders</label>
          <input id="src-link" className="am-input" value={form.link} placeholder="webcal://p…-caldav.icloud.com/published/2/…" autoComplete="off" spellCheck={false}
            onChange={(event) => setForm({ ...form, link: event.target.value })} disabled={busy} />
          <label className="am-label" htmlFor="src-name">Name im Hub</label>
          <input id="src-name" className="am-input" value={form.name} placeholder="z. B. Privat" maxLength={80} onChange={(event) => setForm({ ...form, name: event.target.value })} disabled={busy} />
          <p className="cal-panel-note is-box"><LockKeyhole size={15} aria-hidden="true" /><span>Wer diesen Link kennt, sieht alle Einträge des Kalenders. Der Hub speichert ihn verschlüsselt und zeigt ihn danach nie wieder an. Auch ein in Outlook veröffentlichter Kalender geht hier.</span></p>
          {!state.vault && <p className="cal-panel-note is-warn"><TriangleAlert size={15} aria-hidden="true" /><span>Auf dem Server fehlt der Schlüssel für die Verschlüsselung (HUB_VAULT_KEY). Bis er eingetragen ist, speichert der Hub keinen Kalender-Link.</span></p>}
          <RuleSwitches rules={form.rules} disabled={busy} onChange={(rules) => setForm({ ...form, rules })} />
          <div className="cal-decline-acts">
            <button type="button" className="sheet-action" onClick={() => setForm(null)} disabled={busy}>Abbrechen</button>
            <button type="button" className="sheet-action is-primary" onClick={add} disabled={busy || !form.link.trim() || !state.vault}>{busy ? <MiniLoader size={15} /> : <Plus size={15} aria-hidden="true" />}Hinzufügen</button>
          </div>
        </div>
      )}

      {state && form?.kind === "microsoft" && (
        <div className="cal-x-form cal-src-form">
          <strong className="cal-src-form-title">Microsoft 365 hinzufügen</strong>
          <p className="cal-feed-lead">Der Hub fragt nur Frei/Belegt ab, über die App-Registrierung von oalab in Microsoft 365. Titel und Inhalte kommen nie in den Hub.</p>
          {state.microsoft.configured ? <>
            <span className="am-label">Postfach</span>
            <div className="cal-src-choice" role="group" aria-label="Postfach">
              {state.microsoft.mailboxes.map((box) => (
                <button key={box.address} type="button" className={`cal-src-opt${form.mailbox === box.address ? " is-on" : ""}`} aria-pressed={form.mailbox === box.address} onClick={() => setForm({ ...form, mailbox: box.address })} disabled={busy}>
                  {box.own ? "Dein Postfach" : box.address.split("@")[0]}<small>{box.address}</small>
                </button>
              ))}
              <button type="button" className={`cal-src-opt${form.mailbox === "other" ? " is-on" : ""}`} aria-pressed={form.mailbox === "other"} onClick={() => setForm({ ...form, mailbox: "other" })} disabled={busy}>
                Anderes Postfach<small>Adresse eingeben</small>
              </button>
            </div>
            {form.mailbox === "other" && <input className="am-input" value={form.other} placeholder="z. B. termine@…" aria-label="Adresse des Postfachs" autoComplete="off" onChange={(event) => setForm({ ...form, other: event.target.value })} disabled={busy} />}
            <RuleSwitches rules={form.rules} disabled={busy} onChange={(rules) => setForm({ ...form, rules })} />
            <p className="cal-src-ms"><span className="chat-pill tone-ok">Eingerichtet</span><span>Die Verbindung zu Microsoft 365 liest nur die Postfächer des Teams.</span></p>
          </> : (
            <p className="cal-panel-note is-box"><TriangleAlert size={15} aria-hidden="true" /><span><b>Noch nicht eingerichtet.</b> Dafür trägt ein Admin Mandanten-ID, Client-ID und Geheimnis der App-Registrierung in die Umgebung des Hubs ein. Danach wählst du hier nur noch das Postfach.</span></p>
          )}
          <div className="cal-decline-acts">
            <button type="button" className="sheet-action" onClick={() => setForm(null)} disabled={busy}>Abbrechen</button>
            <button type="button" className="sheet-action is-primary" onClick={add} disabled={busy || !state.microsoft.configured || (form.mailbox === "other" && !form.other.trim())}>{busy ? <MiniLoader size={15} /> : <Plus size={15} aria-hidden="true" />}Hinzufügen</button>
          </div>
        </div>
      )}
      {notice && <p className="cal-panel-note is-box" role="status"><Check size={15} aria-hidden="true" /><span>{notice}</span></p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </PanelSection>
  );
}
