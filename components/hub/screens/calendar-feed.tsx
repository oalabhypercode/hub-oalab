"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { CalendarDays, CalendarSync, Check, CircleCheck, Info, LockKeyhole, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { createCalendarFeed, endCalendarFeed, loadCalendarFeed, saveCalendarFeedOptions } from "@/lib/hub-calendar/actions";
import {
  DEFAULT_FEED_OPTIONS, FEED_CLIENT_NAMES, feedOptionsFor, fetchedAgo, googleSubscribeUrl, outlookSubscribeUrl, webcalUrl,
  type FeedOptions, type FeedRole,
} from "@/lib/hub-calendar/feed-rules";
import type { CalendarActionResult, CalendarFeedState } from "@/lib/hub-calendar/types";
import { SegmentedControl, Switch } from "../controls";
import { useInfo } from "../info-box";
import { AssetPanel } from "./asset-panel";
import { PanelSection } from "./users-panel";

/*
 * „Kalender abonnieren“ (plan „Kalender des Hubs mit Apple Kalender synchron halten“, stage 1, approved preview
 * „Kalender-Abo“ of 22.11.2026): what goes into the feed, then the link once with Apple, Google, Outlook, copying, the
 * QR code and how it works per device, afterwards the state with „Neuen Link erzeugen“ and „Abo beenden“. Opened from
 * the calendar's head and from the profile card. The preview keeps everything in this browser window with an example
 * link that leads nowhere.
 */

type HowTo = "iphone" | "mac" | "google" | "outlook";
export type FeedIntent = "renew" | "end";

const HOW_TO: { id: HowTo; label: string; name: string }[] = [
  { id: "iphone", label: "iPhone", name: "iPhone und iPad" }, { id: "mac", label: "Mac", name: "Mac" }, { id: "google", label: "Google", name: "Google Kalender" },
  { id: "outlook", label: "Outlook", name: "Outlook" },
];
/** Two sentences per device (plan 4.5); the names may differ slightly between system versions. */
const HOW_STEPS: Record<HowTo, string[]> = {
  iphone: [
    "Auf iPhone oder iPad „Mit Apple Kalender abonnieren“ tippen und bestätigen.",
    "Als Account „iCloud“ wählen, dann steht der Kalender auf allen deinen Apple-Geräten. Von Hand: Kalender-App › Kalender › Kalender hinzufügen › Kalenderabo hinzufügen.",
    "Fertig. Neue, verschobene und abgesagte Termine kommen von selbst, meist nach Minuten bis etwa einer Stunde.",
  ],
  mac: [
    "„Mit Apple Kalender abonnieren“ klicken, oder in Kalender › Ablage › Neues Kalenderabonnement den Link einfügen.",
    "Ort „iCloud“ wählen und „Automatisch aktualisieren“ auf die kürzeste Stufe stellen.",
    "Wer die Erinnerung 15 Minuten vorher möchte, nimmt den Haken bei „Entfernen: Hinweise“ heraus.",
  ],
  google: [
    "„Google Kalender“ wählen, oder in Google Kalender bei „Weitere Kalender“ auf „Per URL“ gehen und den Link einfügen.",
    "Hinzufügen bestätigen.",
    "Google holt Abos nur alle paar Stunden; für schnelle Änderungen ist Apple Kalender besser.",
  ],
  outlook: [
    "„Outlook“ wählen, oder in Outlook „Kalender hinzufügen“ und „Aus dem Web abonnieren“ wählen und den Link einfügen.",
    "Als „oalab“ speichern.",
    "Auch Outlook holt Abos langsamer als Apple Kalender.",
  ],
};

const day = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" });
const tryAgain = "Das hat gerade nicht geklappt. Bitte versuche es erneut.";
const failed = { ok: false as const, error: tryAgain };

// The status reads relative to now once the page runs in the browser; the value changes every half minute.
const subscribeMinute = (change: () => void) => {
  const timer = window.setInterval(change, 30_000);
  return () => window.clearInterval(timer);
};
const currentMinute = () => Math.floor(Date.now() / 60_000) * 60_000;
const noMinute = () => 0;
export const useMinute = () => useSyncExternalStore(subscribeMinute, currentMinute, noMinute);

/** The device a page runs on, for the first tab of „So geht’s“. */
function guessHowTo(): HowTo {
  if (typeof navigator === "undefined") return "mac";
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return "iphone";
  if (/Android/i.test(navigator.userAgent)) return "google";
  return "mac";
}

/** A link that leads nowhere, for the preview: 43 characters like a real key. */
function exampleLink() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const key = Array.from({ length: 43 }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
  return `https://hub.oalab.de/api/calendar/feed/${key}/oalab.ics`;
}

/** The preview's subscription, fetched a few minutes ago by Apple Kalender. */
const exampleFeed = (options: FeedOptions) => ({ id: "preview", options, createdAt: new Date().toISOString(), lastFetchedAt: new Date(Date.now() - 6 * 60_000).toISOString(), lastClient: "apple" as const });

/** The rows of „Was im Abo steht“ for a role (plan 4.1). */
function feedRows(role: FeedRole, options: FeedOptions) {
  type Key = "confirmed" | "requests" | "goals" | "tasks";
  const rows: { key: Key; label: string; sub: string; on: boolean; locked?: boolean; scope?: boolean }[] = [
    { key: "confirmed", label: "Bestätigte Termine", sub: role === "admin" ? "alle Kunden, als „Firma: Titel“" : "immer dabei, mit Meeting-Link", on: true, locked: true },
    { key: "requests", label: "Offene Anfragen", sub: "vorläufig markiert, als „Anfrage: …“", on: options.requests },
  ];
  if (role !== "freelancer") rows.push({ key: "goals", label: "Projektziele", sub: "ganztägig, blockieren keine Zeit", on: options.goals });
  if (role === "customer") rows.push({ key: "tasks", label: "Aufgaben, bei denen du am Zug bist", sub: "ganztägig am Tag der Fälligkeit", on: options.tasks });
  if (role === "admin") rows.push({ key: "tasks", label: "Aufgaben mit Fälligkeit", sub: "ganztägig am Tag der Fälligkeit", on: options.tasks, scope: true });
  return rows;
}

function FeedSwitches({ role, options, disabled, onChange }: { role: FeedRole; options: FeedOptions; disabled: boolean; onChange: (next: FeedOptions) => void }) {
  return (
    <div className="cal-feed-rows">
      {feedRows(role, options).map((row) => (
        <div key={row.key} className="cal-feed-row-wrap">
          <div className="cal-feed-row">
            <span className="cal-feed-row-text"><strong>{row.label}</strong><small>{row.sub}</small></span>
            <Switch checked={row.on} label={row.label} disabled={disabled || row.locked} onChange={(on) => { if (row.key !== "confirmed") onChange({ ...options, [row.key]: on }); }} />
          </div>
          {row.scope && row.on && (
            <div className="cal-feed-row-sub">
              <SegmentedControl label="Welche Aufgaben" value={options.taskScope} onChange={(taskScope) => onChange({ ...options, taskScope })}
                options={[{ id: "mine", label: "Mir zugewiesen", name: "Mir zugewiesen" }, { id: "all", label: "Alle", name: "Alle" }]} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function CalendarFeedPanel({ preview, active = false, role: pageRole, confirmHref, intent = null, onClose, onActive }: {
  preview: boolean;
  /** The preview only: whether its example subscription is active, so the panel opens where it was left. */
  active?: boolean;
  /** The role the page knows; a real login's comes from the server. */
  role: FeedRole;
  /** Where admins and freelancers confirm their code first, back to this page with the panel open. */
  confirmHref: string;
  /** Opened from the profile card's „Neuen Link erzeugen“ or „Abo beenden“: that question is asked at once. */
  intent?: FeedIntent | null;
  onClose: () => void;
  /** The calendar's head and the profile card follow: whether a feed is active now. */
  onActive?: (active: boolean) => void;
}) {
  const [state, setState] = useState<CalendarFeedState | null>(() => preview ? { ready: true, role: pageRole, needsCode: false, feed: active ? exampleFeed(feedOptionsFor(pageRole, DEFAULT_FEED_OPTIONS)) : null } : null);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState<FeedOptions>(() => feedOptionsFor(pageRole, DEFAULT_FEED_OPTIONS));
  const [link, setLink] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [howTo, setHowTo] = useState<HowTo>(guessHowTo);
  const [ask, setAsk] = useState<FeedIntent | null>(intent);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const now = useMinute();
  const role = state?.role ?? pageRole;
  const feed = state?.feed ?? null;
  const step = link ? "link" : feed ? "active" : "start";
  const info = useInfo("Kalender-Abo", {
    steps: [
      <><b>Einmal abonnieren</b>, dann kommen neue, verschobene und abgesagte Termine von selbst.</>,
      <><b>Den Link</b> zeigt der Hub nur beim Anlegen. Behandle ihn wie ein Passwort.</>,
      <><b>Wie oft</b> abgerufen wird, bestimmt dein Kalender: meist Minuten bis etwa eine Stunde.</>,
    ],
    ask: "Wie abonniere ich den Kalender des Hubs in Apple Kalender?",
  });

  useEffect(() => {
    if (preview) return;
    let active = true;
    loadCalendarFeed().then((result) => {
      if (!active) return;
      if (result.ok) setState(result.data); else setLoadError(result.error);
    }).catch(() => { if (active) setLoadError(tryAgain); });
    return () => { active = false; };
  }, [preview]);

  // The QR code for the phone: the webcal address, made in the browser only while the link is shown.
  useEffect(() => {
    if (!link) return;
    let gone = false;
    import("qrcode")
      .then((module) => (module.default ?? module).toString(webcalUrl(link), { type: "svg", margin: 1, errorCorrectionLevel: "M" }))
      .then((svg) => { if (!gone) setQr(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`); })
      .catch(() => undefined);
    return () => { gone = true; };
  }, [link]);

  async function run<T>(action: () => Promise<CalendarActionResult<T>>, done: (data: T) => void) {
    setBusy(true);
    setError("");
    setNotice("");
    const result = await action().catch(() => failed);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    done(result.data);
  }

  /** „Abo anlegen“, and „Neuen Link erzeugen“ with what the feed had (`renew`). */
  function create(renew: boolean) {
    const options = renew && feed ? feed.options : draft;
    void run(
      () => preview
        ? Promise.resolve({ ok: true as const, data: { url: exampleLink(), state: { ready: true, role, needsCode: false, feed: { ...exampleFeed(options), lastFetchedAt: null, lastClient: null } } } })
        : createCalendarFeed(renew ? null : options),
      (data) => {
        setState(data.state);
        setQr(null);
        setLink(data.url);
        setCopied(false);
        setAsk(null);
        onActive?.(true);
      },
    );
  }

  function end() {
    void run(() => preview ? Promise.resolve({ ok: true as const, data: { ready: true, role, needsCode: false, feed: null } }) : endCalendarFeed(), (data) => {
      setState(data);
      setLink(null);
      setAsk(null);
      onActive?.(false);
      setNotice("Abo beendet. Der Link geht ab sofort nicht mehr. Lösch den Kalender „oalab“ in deinen Apps, wenn du ihn nicht mehr brauchst.");
    });
  }

  /** The switches of an active feed apply from the next fetch on; shown at once, rolled back if the server refuses. */
  function saveOptions(next: FeedOptions) {
    if (!state?.feed) return;
    const before = state;
    setState({ ...state, feed: { ...state.feed, options: next } });
    if (preview) return;
    setBusy(true);
    setError("");
    setNotice("");
    void saveCalendarFeedOptions(next).catch(() => failed).then((result) => {
      setBusy(false);
      if (result.ok) { setState(result.data); return; }
      setState(before);
      setError(result.error);
    });
  }

  async function copy() {
    if (!link) return false;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      return true;
    } catch {
      setError("Kopieren ging nicht. Markiere den Link und kopiere ihn selbst.");
      return false;
    }
  }
  /** Google and Outlook get the link filled in where they can; it is copied too, in case they ask for it. */
  async function openWith(url: string) {
    void copy();
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const needsCode = Boolean(state?.needsCode);
  const subtitle = step === "active" ? "Abo aktiv · Kalender „oalab“" : step === "link" ? "Dein Abo ist angelegt" : "In Apple Kalender, Google oder Outlook, immer aktuell";
  const lead = role === "admin"
    ? "Einmal abonnieren, dann stehen alle Termine des Hubs in deinem Kalender und bleiben von selbst aktuell, auf iPhone, iPad und Mac."
    : role === "freelancer"
      ? "Einmal abonnieren, dann stehen deine Termine und Anfragen bei oalab in deinem Kalender und bleiben von selbst aktuell."
      : "Einmal abonnieren, dann stehen deine Termine bei oalab von selbst in deinem Kalender: neue, verschobene und abgesagte, ohne Mail und ohne Löschen von Hand.";

  const footer = step === "start" ? <>
    <span className="pj-spacer" />
    <button type="button" className="sheet-action" onClick={onClose} disabled={busy}>Abbrechen</button>
    {needsCode
      ? <Link className="sheet-action is-primary" href={confirmHref}><ShieldCheck size={15} aria-hidden="true" />Mit Code bestätigen</Link>
      : <button type="button" className="sheet-action is-primary" onClick={() => create(false)} disabled={busy || !state}>{busy ? <MiniLoader size={15} /> : <CalendarSync size={15} aria-hidden="true" />}Abo anlegen</button>}
  </> : step === "link" ? <>
    <span className="cal-foot-hint"><LockKeyhole size={14} aria-hidden="true" />Den Link zeigt der Hub nur jetzt.</span>
    <span className="pj-spacer" />
    <button type="button" className="sheet-action is-primary" onClick={() => setLink(null)}><Check size={15} aria-hidden="true" />Fertig</button>
  </> : <>
    <span className="cal-foot-hint"><Check size={14} aria-hidden="true" />Jede Änderung gilt ab dem nächsten Abruf.</span>
    <span className="pj-spacer" />
    <button type="button" className="sheet-action is-primary" onClick={onClose}>Fertig</button>
  </>;

  const confirmBox = ask && (
    <div className={`cal-feed-confirm${ask === "end" ? " is-end" : ""}`} role="group" aria-label={ask === "renew" ? "Neuen Link erzeugen?" : "Abo beenden?"}>
      <strong>{ask === "renew" ? "Neuen Link erzeugen?" : "Abo beenden?"}</strong>
      <p>{ask === "renew"
        ? "Der alte Link hört sofort auf zu gehen. Danach abonnierst du einmal neu; der Kalender mit dem alten Link bekommt nichts mehr."
        : "Der Link geht ab sofort nicht mehr. Der Kalender „oalab“ bleibt in deinen Apps stehen, bekommt aber nichts Neues; lösch ihn dort selbst."}</p>
      <div className="cal-decline-acts">
        <button type="button" className="sheet-action" onClick={() => setAsk(null)} disabled={busy}>Abbrechen</button>
        {ask === "renew"
          ? <button type="button" className="sheet-action is-primary" onClick={() => create(true)} disabled={busy}>{busy ? <MiniLoader size={15} /> : <RefreshCw size={15} aria-hidden="true" />}Neuen Link erzeugen</button>
          : <button type="button" className="sheet-action is-danger" onClick={end} disabled={busy}>{busy ? <MiniLoader size={15} /> : <TriangleAlert size={15} aria-hidden="true" />}Abo beenden</button>}
      </div>
    </div>
  );

  return (
    <AssetPanel className="um-panel cal-panel cal-feed-panel" label="Kalender abonnieren" onClose={onClose} closeDisabled={busy}
      icon={<span className="cal-panel-glyph cal-feed-glyph"><CalendarSync size={19} aria-hidden="true" /></span>}
      title="Kalender abonnieren" subtitle={subtitle} footer={footer}>
      {!state && !loadError && <p className="cal-panel-note"><MiniLoader size={15} /><span>Wird geladen …</span></p>}
      {loadError && <p className="form-error" role="alert">{loadError}</p>}
      {preview && <p className="cal-panel-note is-off"><Info size={15} aria-hidden="true" /><span>Vorschau: Der Link ist ein Beispiel und führt nirgendwohin.</span></p>}

      {state && step === "start" && <>
        <PanelSection title="Was im Abo steht" info={info.button}>
          {info.box}
          <p className="cal-feed-lead">{lead}</p>
          <FeedSwitches role={role} options={draft} disabled={busy} onChange={setDraft} />
          <p className="cal-panel-note is-box"><Info size={15} aria-hidden="true" /><span><b>Mit Meeting-Link:</b> Am Handy trittst du direkt aus dem Termin bei. Abgesagte Termine verschwinden beim nächsten Abruf von selbst.</span></p>
          {needsCode && <p className="cal-panel-note is-box"><LockKeyhole size={15} aria-hidden="true" /><span>Zum Anlegen bestätigst du einmal deinen Code, weil der Link danach ohne Anmeldung liest.</span></p>}
        </PanelSection>
      </>}

      {step === "link" && link && <>
        <div className="cal-feed-ready" role="status">
          <CircleCheck size={20} aria-hidden="true" />
          <span><strong>Dein Kalender „oalab“ ist bereit.</strong><small>Den Link zeigt der Hub nur jetzt. Behandle ihn wie ein Passwort.</small></span>
        </div>
        <a className="cal-feed-big" href={webcalUrl(link)}>
          <CalendarDays size={22} aria-hidden="true" />
          <span><strong>Mit Apple Kalender abonnieren</strong><small>iPhone, iPad und Mac</small></span>
        </a>
        <div className="cal-feed-alt">
          <button type="button" className="cal-feed-alt-btn" onClick={() => void openWith(googleSubscribeUrl(link))}>Google Kalender<small>Android und Web</small></button>
          <button type="button" className="cal-feed-alt-btn" onClick={() => void openWith(outlookSubscribeUrl(link))}>Outlook<small>Microsoft 365</small></button>
          <button type="button" className="cal-feed-alt-btn" onClick={() => void copy()}>{copied ? "Kopiert" : "Link kopieren"}<small>für andere Apps</small></button>
        </div>
        <p className="cal-feed-link" translate="no">{link}</p>
        <div className="cal-feed-qr">
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL made right here, nothing to optimise */}
          {qr ? <img src={qr} alt="QR-Code mit dem Abo-Link" width={104} height={104} /> : <span className="cal-feed-qr-wait"><MiniLoader size={18} /></span>}
          <p><strong>Mit dem iPhone scannen</strong>Die Kamera öffnet „Kalenderabo hinzufügen“. So kommt das Abo ohne Mail aufs Handy.</p>
        </div>
        <PanelSection title="So geht’s">
          <SegmentedControl label="Gerät" value={howTo} onChange={setHowTo} options={HOW_TO} />
          <ol className="cal-feed-steps">{HOW_STEPS[howTo].map((text) => <li key={text}>{text}</li>)}</ol>
          <p className="cal-panel-note is-box"><Info size={15} aria-hidden="true" /><span><b>Einmal reicht:</b> Mit iCloud als Ort genügt ein Abo für alle Geräte. Termine, die du früher über die Mail-Knöpfe eingetragen hast, kannst du löschen.</span></p>
        </PanelSection>
      </>}

      {step === "active" && feed && <>
        <div className="cal-feed-status">
          <div className="cal-feed-status-top">
            <span className="cal-feed-live" aria-hidden="true" />
            <strong>Abo aktiv</strong>
            <span className={`chat-pill ${feed.lastClient ? "tone-ok" : "tone-off"}`}>{feed.lastClient ? FEED_CLIENT_NAMES[feed.lastClient] : "Noch nicht abgerufen"}</span>
          </div>
          <small>{feed.lastFetchedAt ? `Zuletzt abgerufen ${now ? fetchedAgo(feed.lastFetchedAt, now) : day.format(new Date(feed.lastFetchedAt))}` : "Noch nicht abgerufen"} · angelegt am {day.format(new Date(feed.createdAt))}</small>
          <small>Wie oft abgerufen wird, bestimmt dein Kalender: meist alle paar Minuten bis etwa einmal pro Stunde.</small>
        </div>
        <PanelSection title="Was im Abo steht" meta="gilt ab dem nächsten Abruf" info={info.button}>
          {info.box}
          <FeedSwitches role={role} options={feed.options} disabled={busy} onChange={saveOptions} />
        </PanelSection>
        <PanelSection title="Link">
          <p className="cal-feed-lead">Den Link zeigt der Hub nicht noch einmal. Ist er verloren oder weitergegeben, erzeugst du einen neuen; der alte geht dann sofort nicht mehr.</p>
          {confirmBox || (
            <div className="cal-feed-actions">
              <button type="button" className="sheet-action" onClick={() => setAsk("renew")} disabled={busy}><RefreshCw size={15} aria-hidden="true" />Neuen Link erzeugen</button>
              <button type="button" className="sheet-action is-danger" onClick={() => setAsk("end")} disabled={busy}>Abo beenden</button>
            </div>
          )}
        </PanelSection>
      </>}

      {notice && <p className="cal-panel-note is-box" role="status"><Check size={15} aria-hidden="true" /><span>{notice}</span></p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {step === "link" && <span className="visually-hidden" aria-live="polite">{copied ? "Link kopiert" : ""}</span>}
      {busy && step !== "start" && <span className="visually-hidden" role="status">Speichert …</span>}
    </AssetPanel>
  );
}
