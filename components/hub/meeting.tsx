"use client";

import { useState } from "react";
import { ArrowUpRight, Check, CircleAlert, CircleCheck, Copy, Info, Link2 } from "lucide-react";
import { addDays, dayOf, formatDayShort, MEETING_PROVIDERS, meetingProvider, timeOf, type MeetingProvider } from "@/lib/hub-calendar/rules";

/*
 * Meeting links as buttons (27.11.2026, preview „Version 3“ approved): an appointment's link to Microsoft Teams, Zoom
 * or Google Meet shows as a button with the provider's mark, in the week, the list, the appointment window and on the
 * overview. The marks are drawn after the providers' app icons and only label the link to their meeting.
 */

export function MeetingMark({ provider, size = 16 }: { provider: MeetingProvider; size?: number }) {
  const common = { width: size, height: size, "aria-hidden": true, focusable: false, className: "mlogo" } as const;
  if (provider === "zoom") {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <rect width="24" height="24" rx="6.2" fill="#0B5CFF" />
        <path d="M4.5 8.8c0-.8.6-1.4 1.4-1.4h7c1.2 0 2.2 1 2.2 2.2v5.6c0 .8-.6 1.4-1.4 1.4h-7c-1.2 0-2.2-1-2.2-2.2z" fill="#fff" />
        <path d="M16.1 10.7l2.7-2.1c.5-.4 1.2 0 1.2.6v5.6c0 .6-.7 1-1.2.6l-2.7-2.1z" fill="#fff" />
      </svg>
    );
  }
  if (provider === "meet") {
    return (
      <svg viewBox="0 0 87.5 72" {...common}>
        <path fill="#00832d" d="M49.5 36l8.53 9.75 11.47 7.33 2-17.02-2-16.64-11.69 6.44z" />
        <path fill="#0066da" d="M0 51.5V66c0 3.315 2.685 6 6 6h14.5l3-10.96-3-9.54-9.95-3z" />
        <path fill="#e94235" d="M20.5 0L0 20.5l10.55 3 9.95-3 2.95-9.41z" />
        <path fill="#2684fc" d="M20.5 20.5H0v31h20.5z" />
        <path fill="#00ac47" d="M82.6 8.68L69.5 19.42v33.66l13.16 10.79c1.97 1.54 4.85.135 4.85-2.37V11c0-2.535-2.945-3.925-4.91-2.32zM49.5 36v15.5h-29V72h43c3.315 0 6-2.685 6-6V53.08z" />
        <path fill="#ffba00" d="M63.5 0h-43v20.5h29V36l20-16.57V6c0-3.315-2.685-6-6-6z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" {...common}>
      <circle cx="19.2" cy="6.7" r="2.4" fill="#5059C9" />
      <path d="M15.4 9.7h6.2c.6 0 1 .4 1 1v5.1c0 2.3-1.8 4.1-4.1 4.1-1.8 0-3.1-1.5-3.1-3.4z" fill="#5059C9" />
      <circle cx="12.6" cy="5.1" r="3.2" fill="#7B83EB" />
      <path d="M7.6 9h9.9c.6 0 1 .4 1 1v6.4c0 3.2-2.6 5.8-5.9 5.8s-5.8-2.6-5.8-5.8V9.8c0-.4.4-.8.8-.8z" fill="#7B83EB" />
      <rect x="1.2" y="6.1" width="11.6" height="11.6" rx="1.9" fill="#4B53BC" />
      <path d="M10 9.1H4v1.5h2.25v5.4h1.5v-5.4H10z" fill="#fff" />
    </svg>
  );
}

/** „Läuft seit 08:00 · noch 40 Min.“, „Heute, 11:30 Uhr · in 3 Std. 10 Min.“, „Morgen, 11:00 Uhr“ or „Fr., 16. Okt., 11:00 Uhr“. */
export function meetingWhen(start: number, end: number, now: number) {
  const left = (ms: number) => {
    const minutes = Math.max(1, Math.round(ms / 60_000));
    return minutes < 60 ? `${minutes} Min.` : `${Math.floor(minutes / 60)} Std.${minutes % 60 ? ` ${minutes % 60} Min.` : ""}`;
  };
  if (start <= now && now < end) return `Läuft seit ${timeOf(start)} · noch ${left(end - now)}`;
  const day = dayOf(start);
  const today = dayOf(now);
  if (day === today) return `Heute, ${timeOf(start)} Uhr · in ${left(start - now)}`;
  if (day === addDays(today, 1)) return `Morgen, ${timeOf(start)} Uhr`;
  return `${formatDayShort(day)}, ${timeOf(start)} Uhr`;
}

/** The link as people read it: without https, shortened in the middle by the layout. */
export const shownLink = (url: string) => url.replace(/^https:\/\//i, "");

type JoinVariant = "icon" | "list" | "card";

/**
 * The join button. `icon`: a square with the mark (week and day); `list`: mark, „Beitreten“ and the arrow, one width
 * for every provider (list, overview); `card`: the large button of the appointment window. A running meeting
 * („Jetzt beitreten“) takes the accent. Sample links of the preview lead nowhere and say so.
 */
export function JoinButton({ url, variant, live = false, sample = false, className = "" }: { url: string; variant: JoinVariant; live?: boolean; sample?: boolean; className?: string }) {
  const provider = meetingProvider(url);
  if (!provider) return null;
  const { name } = MEETING_PROVIDERS[provider];
  const cls = ["cal-join", `is-${variant}`, live ? "is-live" : "", className].filter(Boolean).join(" ");
  const label = live ? "Jetzt beitreten" : variant === "card" ? `In ${MEETING_PROVIDERS[provider].short} beitreten` : "Beitreten";
  const inner = variant === "icon"
    ? <MeetingMark provider={provider} size={live ? 18 : 16} />
    : <><MeetingMark provider={provider} size={variant === "card" ? 20 : 17} /><span className="cal-join-label">{label}</span><ArrowUpRight size={14} aria-hidden="true" /></>;
  // Inside a clickable row or event the link only joins; the click does not also open the appointment.
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  if (sample) {
    return <span className={`${cls} is-sample`} data-provider={provider} role="img" aria-label={`${name}: Beispiel-Link aus der Vorschau`} data-tip="Beispiel-Link aus der Vorschau" data-tip-sub="Führt zu keinem echten Meeting" onClick={stop}>{inner}</span>;
  }
  return (
    <a className={cls} data-provider={provider} href={url} target="_blank" rel="noopener noreferrer" aria-label={`${live ? "Jetzt " : ""}in ${name} beitreten`}
      data-tip={live ? "Jetzt beitreten" : `In ${name} beitreten`} data-tip-sub={live ? `${name} · läuft gerade` : shownLink(url)} onClick={stop} onKeyDown={stop}>
      {inner}
    </a>
  );
}

/** The appointment window's meeting: mark, provider, when, the large button and „Link kopieren“. */
export function MeetingCard({ url, live = false, sample = false, when }: { url: string; live?: boolean; sample?: boolean; when: string }) {
  const [copied, setCopied] = useState(false);
  const provider = meetingProvider(url);
  if (!provider) return null;
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="cal-meet">
      <div className={`cal-join-card${live ? " is-live" : ""}`} data-provider={provider}>
        <span className="cal-join-logo"><MeetingMark provider={provider} size={26} /></span>
        <span className="cal-join-text">
          <strong>{MEETING_PROVIDERS[provider].meeting}{live && <span className="chat-pill tone-ok">Läuft gerade</span>}</strong>
          <span>{when}</span>
        </span>
        <JoinButton url={url} variant="card" live={live} sample={sample} />
      </div>
      {!sample && (
        <div className="cal-join-sub">
          <button type="button" className="cal-join-copy" onClick={copy}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? "Kopiert" : "Link kopieren"}</button>
          <span className="cal-join-link">{shownLink(url)}</span>
        </div>
      )}
    </div>
  );
}

/**
 * The admin's field „Meeting-Link“: the mark of the provider the link belongs to, and one line on what the customer
 * gets. Teams, Zoom and Google Meet are allowed (as in the database).
 */
export function MeetingLinkField({ value, onChange, disabled = false, customer }: { value: string; onChange: (value: string) => void; disabled?: boolean; customer?: string | null }) {
  const text = value.trim();
  const provider = text ? meetingProvider(text) : null;
  let state: React.ReactNode;
  if (!text) state = <p className="mlink-state"><Info size={14} aria-hidden="true" /><span>{customer ? `Ohne Link sieht ${customer}: „Den Meeting-Link ergänzt dein oalab-Team.“` : "Ohne Link gibt es im Termin keinen Beitreten-Knopf."}</span></p>;
  else if (provider) state = <p className="mlink-state is-ok" role="status"><CircleCheck size={14} aria-hidden="true" /><span><b>{MEETING_PROVIDERS[provider].name} erkannt.</b> {customer ? `${customer} sieht` : "Im Kalender steht"} den Knopf „In {MEETING_PROVIDERS[provider].short} beitreten“.</span></p>;
  else if (/^https:\/\//i.test(text)) state = <p className="mlink-state is-bad" role="status"><CircleAlert size={14} aria-hidden="true" /><span>Diesen Anbieter kennt der Hub nicht. Erlaubt sind Links von Microsoft Teams, Zoom und Google Meet.</span></p>;
  else state = <p className="mlink-state is-bad" role="status"><CircleAlert size={14} aria-hidden="true" /><span>Das ist kein Link. Bitte den ganzen Link mit https:// einfügen.</span></p>;
  return (
    <div className="mlink">
      <label className="um-field">
        <span className="pj-url">
          <span className="mlink-badge" aria-hidden="true">{provider ? <MeetingMark provider={provider} size={18} /> : <Link2 size={15} />}</span>
          <input value={value} onChange={(event) => onChange(event.target.value)} inputMode="url" maxLength={2048} spellCheck={false} disabled={disabled}
            placeholder="Link aus Teams, Zoom oder Google Meet einfügen" aria-label="Meeting-Link" />
        </span>
      </label>
      {state}
    </div>
  );
}
