"use client";

import { useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import Link from "next/link";
import { Check, Sparkles, X } from "lucide-react";
import { markNoticesRead } from "@/lib/hub-notify/actions";
import type { InboxItem } from "@/lib/hub-notify/server";
import { addHiddenIds, readHiddenIds, relativeWhen, splitNotices, stackByArea, type NoticeStack } from "@/lib/hub-overview/rules";
import { noticeSymbol, noticeWhen } from "./notice-symbols";

// The time of each notice reads relative to now once the page runs in the browser („vor 12 Min.“); the server and the
// first render show the clock time, so both render the same. The value changes once a minute.
const subscribeMinute = (change: () => void) => {
  const timer = window.setInterval(change, 30_000);
  return () => window.clearInterval(timer);
};
const currentMinute = () => Math.floor(Date.now() / 60_000) * 60_000;
const noMinute = () => 0;

// What × hid stays hidden in this browser (per login); the bell keeps every notice, read.
const HIDDEN_EVENT = "oalab-hub-notices-hidden";
const hiddenKey = (userKey: string) => `oalab-hub-notices-hidden:${userKey}`;
const subscribeHidden = (change: () => void) => {
  window.addEventListener(HIDDEN_EVENT, change);
  window.addEventListener("storage", change);
  return () => { window.removeEventListener(HIDDEN_EVENT, change); window.removeEventListener("storage", change); };
};
const readStored = (key: string) => { try { return localStorage.getItem(key) ?? ""; } catch { return ""; } };
const noStored = () => "";

/** A fading card leaves after this long; with „Bewegung reduzieren“ at once. */
const LEAVE_MS = 220;

/**
 * The overview's notifications (design „V5“, user 18.11.2026): the bell's notices like a phone's notification centre.
 * „Neu“ holds the unread ones, „Früher“ the read ones, both stacked per area; a stack opens on click. A card opens its
 * page and counts as read; × marks it read and hides it here; „Alle gelesen“ moves everything new to „Früher“. The
 * preview shows fictional notices and stores nothing on the server.
 */
export function NotificationCenter({ items, preview, admin, insightsHref, userKey }: { items: InboxItem[]; preview: boolean; admin: boolean; insightsHref: string; userKey: string }) {
  const now = useSyncExternalStore(subscribeMinute, currentMinute, noMinute);
  const key = hiddenKey(userKey);
  const stored = useSyncExternalStore(subscribeHidden, () => readStored(key), noStored);
  const [read, setRead] = useState<Set<number>>(() => new Set());
  const [gone, setGone] = useState<Set<number>>(() => new Set());
  const [leaving, setLeaving] = useState<Set<number>>(() => new Set());
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState("");
  const hidden = useMemo(() => new Set([...readHiddenIds(stored || null), ...gone]), [stored, gone]);
  const { fresh, earlier, more } = splitNotices(items, read, hidden);
  const areaOf = (item: InboxItem) => noticeSymbol(item.kind).area;
  const when = (iso: string) => now ? relativeWhen(iso, now) : noticeWhen(iso);
  const isRead = (id: number) => read.has(id) || items.some((item) => item.id === id && item.read);

  function markRead(ids: number[]) {
    const unread = ids.filter((id) => !isRead(id));
    if (!unread.length) return;
    setRead((current) => new Set([...current, ...unread]));
    if (preview) return;
    void markNoticesRead(unread).then((result) => setError(result.ok ? "" : result.error));
  }

  function dismiss(ids: number[]) {
    markRead(ids);
    setLeaving((current) => new Set([...current, ...ids]));
    const reduced = document.documentElement.dataset.reduceMotion === "true";
    window.setTimeout(() => {
      setGone((current) => new Set([...current, ...ids]));
      setLeaving((current) => new Set([...current].filter((id) => !ids.includes(id))));
      try { localStorage.setItem(key, JSON.stringify(addHiddenIds(readHiddenIds(localStorage.getItem(key)), ids))); } catch { /* hidden until the page reloads */ }
      window.dispatchEvent(new Event(HIDDEN_EVENT));
    }, reduced ? 0 : LEAVE_MS);
  }

  function readAll() {
    setRead((current) => new Set([...current, ...fresh.map((item) => item.id)]));
    if (preview) return;
    void markNoticesRead().then((result) => setError(result.ok ? "" : result.error));
  }

  const toggle = (stackKey: string) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(stackKey)) next.delete(stackKey); else next.add(stackKey);
    return next;
  });

  function card(item: InboxItem, early: boolean, stack?: { more: number; ids: number[]; onOpen: () => void }) {
    const { icon: Icon, color, area } = noticeSymbol(item.kind);
    const content = <>
      <span className="nt-icon" style={{ "--c": color } as CSSProperties} aria-hidden="true"><Icon size={20} /></span>
      <span className="nt-text">
        <span className="nt-top"><strong>{item.title}</strong><time dateTime={item.createdAt}>{when(item.createdAt)}</time></span>
        {item.body && <span className="nt-body">{item.body}</span>}
        {stack && <span className="nt-more">{stack.more} weitere</span>}
      </span>
    </>;
    return (
      <li key={item.id} className={`nt-item${stack ? " is-stack" : ""}${early ? " nt-early" : ""}${leaving.has(item.id) ? " is-gone" : ""}`}>
        <button type="button" className="glass nt-close" onClick={() => dismiss(stack ? stack.ids : [item.id])} aria-label={`${stack ? `${area}: alle` : item.title} ausblenden`} data-tip="Ausblenden"><X size={12} aria-hidden="true" /></button>
        {stack
          ? <button type="button" className="glass nt-card" onClick={stack.onOpen} aria-expanded="false">{content}</button>
          : <Link href={item.href} className="glass nt-card" onClick={() => markRead([item.id])}>{content}</Link>}
      </li>
    );
  }

  function stack({ area, items: list }: NoticeStack<InboxItem>, early: boolean) {
    const stackKey = `${early ? "earlier" : "new"}:${area}`;
    if (list.length === 1) return card(list[0], early);
    const ids = list.map((item) => item.id);
    if (!open.has(stackKey)) return card(list[0], early, { more: list.length - 1, ids, onOpen: () => toggle(stackKey) });
    return (
      <li key={stackKey} className={`nt-group${early ? " nt-early" : ""}`}>
        <div className="nt-group-head">
          <strong>{area}</strong>
          <button type="button" className="glass nt-pill" onClick={() => toggle(stackKey)} aria-expanded="true">Weniger anzeigen</button>
          <button type="button" className="glass nt-pill nt-round" onClick={() => dismiss(ids)} aria-label={`${area}: alle ausblenden`} data-tip="Alle ausblenden"><X size={13} aria-hidden="true" /></button>
        </div>
        <ol className="nt-list">{list.map((item) => card(item, early))}</ol>
      </li>
    );
  }

  return (
    <section className="nt" aria-labelledby="nt-title">
      <div className="nt-head">
        <h2 className="nt-title" id="nt-title">Benachrichtigungen</h2>
        {fresh.length > 0 && <button type="button" className="glass nt-pill" onClick={readAll}><Check size={14} aria-hidden="true" />Alle gelesen</button>}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {fresh.length
        ? <><p className="nt-label">Neu</p><ol className="nt-list">{stackByArea(fresh, areaOf).map((group) => stack(group, false))}</ol></>
        : <div className="nt-quiet">
          <strong>Keine neuen Benachrichtigungen</strong>
          <span>{admin ? "Alles erledigt. Schreibt dir ein Kunde im privaten Chat oder ändert ein Freelancer eine Aufgabe, steht es hier." : "Neue Dateien, Termine, Antworten und Aufgaben erscheinen hier, sobald es sie gibt."}</span>
          <Link href={insightsHref} className="glass nt-pill"><Sparkles size={14} aria-hidden="true" />{admin ? "Zahlen und Listen in Insights" : "Stand deiner Projekte in Insights"}</Link>
        </div>}
      {earlier.length > 0 && <><p className="nt-label">Früher</p><ol className="nt-list">{stackByArea(earlier, areaOf).map((group) => stack(group, true))}</ol></>}
      {(fresh.length > 0 || earlier.length > 0) && <p className="nt-none">{more ? "Ältere Benachrichtigungen findest du in der Glocke oben rechts." : "Keine älteren Benachrichtigungen"}</p>}
    </section>
  );
}
