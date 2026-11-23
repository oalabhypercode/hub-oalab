"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowUpRight, Bell, Building2, CalendarDays, Check, Files, FolderOpen, ListTodo, MessageSquare, NotebookPen, type LucideIcon } from "lucide-react";
import { markNoticesRead, markNoticesUnread } from "@/lib/hub-notify/actions";
import { bellTime, noticeColumns } from "@/lib/hub-notify/columns";
import { appointmentNotice, chatNotice, fileNotice, noteNotice, taskNotice, taskNoticePrefix } from "@/lib/hub-notify/rules";
import type { InboxItem } from "@/lib/hub-notify/server";
import { categories } from "@/lib/categories";
import { hubHref } from "@/lib/hub-data";

function symbolOf(kind: string): { icon: LucideIcon; color: string } {
  if (kind === "task.customer" || kind === "task.created" || kind === "task.changed") return { icon: ListTodo, color: categories.projects.fill };
  if (kind === "project.changed") return { icon: FolderOpen, color: categories.projects.fill };
  if (kind === "file.shared") return { icon: Files, color: categories.files.fill };
  // A release for a freelancer under „Kunden“ (18.11.2026): the page has no category colour, so the accent.
  if (kind === "share.granted") return { icon: Building2, color: "var(--accent-text)" };
  if (kind === "note.shared" || kind === "note.changed") return { icon: NotebookPen, color: categories.projects.fill };
  if (kind === "chat.message" || kind === "chat.reply") return { icon: MessageSquare, color: categories.messages.fill };
  return { icon: CalendarDays, color: categories.calendar.fill };
}

/** What the empty bell promises, per role. */
const EMPTY_TEXT = {
  admin: "Hier erscheint, wenn dir ein Kunde im privaten Chat unter Nachrichten schreibt oder ein Freelancer eine Aufgabe anlegt, ändert oder kommentiert.",
  freelancer: "Hier erscheint, wenn jemand eine Aufgabe in deinen Projekten anlegt, ändert oder kommentiert, eine Datei für dich dazukommt oder oalab dir bei einem Kunden etwas freigibt.",
  customer: "Hier erscheint, wenn oalab dir im Chat antwortet, eine Aufgabe für dich dazukommt, sich ändert oder bei dir liegt, sich ein Projekt ändert oder eine Datei oder ein Termin für dich dazukommt.",
};

/**
 * Fictional lines for the design preview (/preview, dev only), written by the same rules as real notices. Their times
 * count from a fixed moment, which the preview's bell also takes as „now“, so it always shows „Heute“, „Gestern“, a
 * weekday and a date.
 */
const PREVIEW_NOW = Date.parse("2026-11-22T09:00:00Z");
const previewAt = (minutes: number) => new Date(PREVIEW_NOW - minutes * 60_000).toISOString();
export const previewNotices: InboxItem[] = [
  { ...taskNotice({ kind: "task.changed", taskTitle: "Startseite überarbeiten", prefix: taskNoticePrefix("Website-Relaunch", 12), parts: ["Status: Review", "Fällig: 27. November 2026"], href: hubHref(true, "projects") }), id: -1, createdAt: previewAt(18), read: false },
  { kind: "task.customer", title: "Du bist am Zug: Texte für „Über uns“ liefern", body: "Website-Relaunch · Aufgabe #14", href: hubHref(true, "projects"), id: -2, createdAt: previewAt(42), read: false },
  { ...fileNotice("logo-final.svg", "preview"), href: hubHref(true, "files"), id: -3, createdAt: previewAt(95), read: false },
  { ...appointmentNotice({ id: "preview", title: "Abstimmung Texte", startsAt: "2026-11-24T09:00:00Z", before: { status: "requested", startsAt: "2026-11-24T09:00:00Z" }, status: "confirmed" })!, href: hubHref(true, "calendar"), id: -4, createdAt: previewAt(60 * 20), read: false },
  { ...chatNotice({ kind: "chat.reply", customerId: "preview", company: "Nordlicht Studio", author: "Mara Klein", body: "Die neuen Fotos sind eingebaut, schau gern mal rein." }), href: hubHref(true, "messages"), id: -5, createdAt: previewAt(60 * 26), read: true },
  { ...noteNotice("note.shared", "Styleguide", "preview", "preview"), href: hubHref(true, "projects"), id: -6, createdAt: previewAt(60 * 74), read: false },
  { kind: "project.changed", title: "Projekt aktualisiert: Website-Relaunch", body: "Status: In Arbeit", href: hubHref(true, "projects"), id: -7, createdAt: previewAt(60 * 24 * 15), read: false },
];

/** A marked line slides out for this long; with „Bewegung reduzieren“ it goes at once (like × in the overview). */
const LEAVE_MS = 220;
/** How long „Rückgängig“ stays after marking. */
const UNDO_MS = 6000;

// The time column counts days from „now“, which moves on once a minute while the bell is open.
const subscribeMinute = (change: () => void) => {
  const timer = window.setInterval(change, 30_000);
  return () => window.clearInterval(timer);
};
const currentMinute = () => Math.floor(Date.now() / 60_000) * 60_000;
const noMinute = () => 0;

// The hub's own switch „Bewegung reduzieren“ decides, never the device's setting (tests/appearance.test.mjs).
const reducedMotion = () => document.documentElement.dataset.reduceMotion === "true";
const without = (set: ReadonlySet<number>, ids: readonly number[]) => new Set([...set].filter((id) => !ids.includes(id)));

/**
 * The bell of a real login: only its unread notices, newest first (plan docs/planung/chat-ereignisse-und-glocke.md,
 * stage 1, 23.11.2026). Opening a line, its tick or „Alle als gelesen markieren“ marks it read and it leaves;
 * „Rückgängig“ brings it back for a few seconds. Each line stands in columns without headings (design „Glocke V3“):
 * the time, where (symbol, customer or area, path), the message and who it came from. Read lines stay in the
 * overview under „Früher“. In the design preview nothing reaches the server.
 */
export function NotificationsPanel({ items, unreadCount, role, onClose, preview = false }: { items: InboxItem[]; unreadCount: number; role: keyof typeof EMPTY_TEXT; onClose: () => void; preview?: boolean }) {
  const clock = useSyncExternalStore(subscribeMinute, currentMinute, noMinute);
  const now = preview ? PREVIEW_NOW : clock;
  // What this window changed before the page's data caught up: lines marked read, lines sliding out, lines brought back.
  const [marked, setMarked] = useState<ReadonlySet<number>>(() => new Set());
  const [leaving, setLeaving] = useState<ReadonlySet<number>>(() => new Set());
  const [restored, setRestored] = useState<ReadonlySet<number>>(() => new Set());
  const [undo, setUndo] = useState<{ ids: number[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const lines = items.filter((item) => leaving.has(item.id) || restored.has(item.id) || (!item.read && !marked.has(item.id)));
  const open = lines.filter((item) => !leaving.has(item.id));
  // Unread notices beyond the lines the page loaded (lib/hub-notify/rules.ts INBOX_UNREAD).
  const more = Math.max(0, unreadCount - items.filter((item) => !item.read).length);

  // „Rückgängig“ goes after a few seconds; a newer marking starts the time anew.
  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [undo]);

  /** The lines leave the list at once for the eye, slide out, and stay away until the page's data says they are read. */
  function hide(ids: number[]) {
    setMarked((current) => new Set([...current, ...ids]));
    setRestored((current) => without(current, ids));
    setLeaving((current) => new Set([...current, ...ids]));
    window.setTimeout(() => setLeaving((current) => without(current, ids)), reducedMotion() ? 0 : LEAVE_MS);
  }

  /** Back into the list: after „Rückgängig“, or when saving the marking failed. */
  function bringBack(ids: number[], wasRead: boolean) {
    setMarked((current) => without(current, ids));
    setLeaving((current) => without(current, ids));
    // A line the server already counts as read needs this window's word to show until „Rückgängig“ arrives there.
    if (wasRead) setRestored((current) => new Set([...current, ...ids]));
  }

  async function markRead(ids: number[], all = false) {
    if (!ids.length) return;
    setError("");
    hide(ids);
    setUndo({ ids });
    if (preview) return;
    setBusy(true);
    const result = await (all ? markNoticesRead() : markNoticesRead(ids));
    setBusy(false);
    if (result.ok) return;
    setError(result.error);
    setUndo(null);
    bringBack(ids, false);
  }

  async function undoLast() {
    if (!undo) return;
    const { ids } = undo;
    setUndo(null);
    setError("");
    bringBack(ids, true);
    if (preview) return;
    const result = await markNoticesUnread(ids);
    if (result.ok) return;
    setError(result.error);
    hide(ids);
  }

  // Opening a line is reading it; the window closes on the way to its page.
  function openLine(item: InboxItem) {
    setMarked((current) => new Set(current).add(item.id));
    if (!preview) void markNoticesRead([item.id]);
    onClose();
  }

  const undoBar = (
    <div className="notice-undo" role="status" aria-live="polite">
      {undo && <>
        <span>{undo.ids.length === 1 ? "Als gelesen markiert" : `${undo.ids.length} Benachrichtigungen als gelesen markiert`}</span>
        <button type="button" onClick={() => void undoLast()}>Rückgängig</button>
      </>}
    </div>
  );

  if (!lines.length) {
    return <>
      <div className="modal-empty">
        <Bell size={30} aria-hidden="true" />
        <h3>Du bist auf dem neuesten Stand.</h3>
        <p>{EMPTY_TEXT[role]}</p>
        {/* Read notices stay in the overview under „Früher“. */}
        {items.length > 0 && <Link href={hubHref(preview)} className="text-link notice-earlier" onClick={onClose}>Frühere Benachrichtigungen in der Übersicht<ArrowUpRight size={16} aria-hidden="true" /></Link>}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {undoBar}
    </>;
  }

  return <>
    <ul className="notice-list">
      {lines.map((item) => {
        const { icon: Icon, color } = symbolOf(item.kind);
        const columns = noticeColumns(item, role);
        const time = bellTime(item.createdAt, now);
        const gone = leaving.has(item.id);
        return (
          <li key={item.id} className={`notice-item${gone ? " is-leaving" : ""}`}>
            <Link href={item.href} className="notice-row is-unread" onClick={() => openLine(item)} tabIndex={gone ? -1 : undefined}>
              <time className="notice-time" dateTime={item.createdAt} data-tip={time.full}>
                <span className="notice-day">{time.day}</span>
                <span className="notice-clock">{time.clock}</span>
              </time>
              <span className="notice-where">
                <span className="notification-symbol" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }}><Icon size={19} color={color} aria-hidden="true" /></span>
                <span className="notice-place">
                  <strong>{columns.where}</strong>
                  {columns.path && <span>{columns.path}</span>}
                </span>
              </span>
              <span className="notice-text">
                <strong>{columns.title}</strong>
                {columns.body && <span>{columns.body}</span>}
              </span>
              <span className="notice-from">
                {columns.from && <strong><span className="visually-hidden">von </span>{columns.from}</strong>}
                {columns.fromDetail && <span>{columns.fromDetail}</span>}
              </span>
            </Link>
            <button type="button" className="glass notice-check" onClick={() => void markRead([item.id])} disabled={gone}
              aria-label={`Als gelesen markieren: ${columns.title}`} data-tip="Als gelesen markieren"><Check size={16} aria-hidden="true" /></button>
          </li>
        );
      })}
    </ul>
    {more > 0 && <p className="notice-more">und {more} weitere ungelesene</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {undoBar}
    {open.length > 0 && <button type="button" className="sheet-button" onClick={() => void markRead(open.map((item) => item.id), true)} disabled={busy}><Check size={17} aria-hidden="true" />Alle als gelesen markieren</button>}
  </>;
}
