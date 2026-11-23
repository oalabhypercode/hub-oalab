"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarSync, RefreshCw } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { confirmSessionHref } from "@/lib/auth-redirect";
import { loadCalendarFeed } from "@/lib/hub-calendar/actions";
import { DEFAULT_FEED_OPTIONS, FEED_CLIENT_NAMES, feedContents, fetchedAgo, type FeedRole } from "@/lib/hub-calendar/feed-rules";
import type { CalendarFeedState } from "@/lib/hub-calendar/types";
import { hubHref } from "@/lib/hub-data";
import { GlassCard } from "./glass";
import { CalendarFeedPanel, useMinute, type FeedIntent } from "./screens/calendar-feed";

const day = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" });

/**
 * The profile card „Kalender-Abo“ next to „Verbundene Apps“ (approved preview 22.11.2026): whether the subscription is
 * active, when it was fetched last and with what, what is in it, and the same buttons as in the calendar, which open the
 * panel there. Every role has one; the preview works with an example in this browser window.
 */
export function CalendarFeedCard({ preview, role }: { preview: boolean; role: FeedRole }) {
  const params = useSearchParams();
  const [state, setState] = useState<CalendarFeedState | null>(() => preview ? { ready: true, role, needsCode: false, feed: null } : null);
  const [error, setError] = useState("");
  // ?abo=1 comes back from confirming the code: the panel opens again.
  const [panel, setPanel] = useState<{ intent: FeedIntent | null } | null>(() => params.get("abo") === "1" ? { intent: null } : null);
  const now = useMinute();

  const load = useCallback(() => {
    if (preview) return;
    loadCalendarFeed().then((result) => {
      if (result.ok) { setState(result.data); setError(""); } else setError(result.error);
    }).catch(() => setError("Das Kalender-Abo konnte gerade nicht geladen werden."));
  }, [preview]);
  useEffect(() => { load(); }, [load]);

  const feed = state?.feed ?? null;
  const onActive = (active: boolean) => {
    if (preview) setState({ ready: true, role, needsCode: false, feed: active ? { id: "preview", options: DEFAULT_FEED_OPTIONS, createdAt: new Date().toISOString(), lastFetchedAt: new Date(Date.now() - 6 * 60_000).toISOString(), lastClient: "apple" } : null });
    else load();
  };
  const fetched = feed?.lastFetchedAt
    ? `${now ? fetchedAgo(feed.lastFetchedAt, now) : day.format(new Date(feed.lastFetchedAt))}${feed.lastClient ? ` · ${FEED_CLIENT_NAMES[feed.lastClient]}` : ""}`
    : "noch nicht abgerufen";

  // The panel stands next to the card, not in it: the card's glass would hold the fixed panel inside itself.
  return (<>
    <GlassCard className="settings-card calendar-feed-card">
      <h2 className="t-headline settings-card-title">
        <CalendarSync size={20} color="var(--accent-text)" aria-hidden="true" />Kalender-Abo
        {state && <span className={`chat-pill calendar-feed-chip ${feed ? "tone-ok" : "tone-off"}`}>{feed ? "Aktiv" : "Kein Abo"}</span>}
      </h2>
      {!state && !error && <p className="t-subheadline t-secondary"><MiniLoader size={16} /> Wird geladen …</p>}
      {state && feed && <>
        <p className="t-subheadline t-secondary">Deine Termine stehen im Kalender „oalab“ und bleiben von selbst aktuell, auf allen Geräten mit demselben Konto.</p>
        <dl className="calendar-feed-facts">
          <div><dt>Zuletzt abgerufen</dt><dd>{fetched}</dd></div>
          <div><dt>Angelegt</dt><dd className="numeric">{day.format(new Date(feed.createdAt))}</dd></div>
          <div><dt>Im Abo</dt><dd>{feedContents(state.role, feed.options)}</dd></div>
        </dl>
        <div className="calendar-feed-actions">
          <button type="button" className="sheet-action" onClick={() => setPanel({ intent: null })}>Inhalte ändern</button>
          <button type="button" className="sheet-action" onClick={() => setPanel({ intent: "renew" })}><RefreshCw size={15} aria-hidden="true" />Neuen Link erzeugen</button>
          <button type="button" className="sheet-action is-danger" onClick={() => setPanel({ intent: "end" })}>Abo beenden</button>
        </div>
      </>}
      {state && !feed && <>
        <p className="t-subheadline t-secondary">Mit einem Abo stehen deine Termine bei oalab immer aktuell in Apple Kalender, Google oder Outlook, ohne Mail und ohne Löschen von Hand.</p>
        <div className="calendar-feed-actions">
          <button type="button" className="sheet-action is-primary" onClick={() => setPanel({ intent: null })}><CalendarSync size={15} aria-hidden="true" />Kalender abonnieren</button>
        </div>
      </>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </GlassCard>
    {panel && (
      <CalendarFeedPanel preview={preview} active={Boolean(feed)} role={state?.role ?? role} intent={panel.intent} onActive={onActive}
        onClose={() => { setPanel(null); load(); }} confirmHref={confirmSessionHref(`${hubHref(false, "settings")}?abo=1`)} />
    )}
  </>);
}
