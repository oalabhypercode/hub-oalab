"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, Building2, CalendarDays, CalendarX2, Check, Files, FolderOpen, ListTodo, MessageSquare, type LucideIcon } from "lucide-react";
import { markNoticesRead } from "@/lib/hub-notify/actions";
import { noticeColumns } from "@/lib/hub-notify/columns";
import { appointmentNotice, chatNotice, fileNotice, taskNotice, taskNoticePrefix } from "@/lib/hub-notify/rules";
import type { InboxItem } from "@/lib/hub-notify/server";
import { categories } from "@/lib/categories";
import { hubHref } from "@/lib/hub-data";

const when = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function symbolOf(kind: string): { icon: LucideIcon; color: string } {
  if (kind === "task.customer" || kind === "task.created" || kind === "task.changed") return { icon: ListTodo, color: categories.projects.fill };
  if (kind === "project.changed") return { icon: FolderOpen, color: categories.projects.fill };
  if (kind === "file.shared") return { icon: Files, color: categories.files.fill };
  // A release for a freelancer under „Kunden“ (18.11.2026): the page has no category colour, so the accent.
  if (kind === "share.granted") return { icon: Building2, color: "var(--accent-text)" };
  if (kind === "chat.message" || kind === "chat.reply") return { icon: MessageSquare, color: categories.messages.fill };
  // A calendar of the availability that cannot be read for 24 hours (admins, 22.11.2026).
  if (kind === "calendar.source") return { icon: CalendarX2, color: categories.calendar.fill };
  return { icon: CalendarDays, color: categories.calendar.fill };
}

/** What the empty bell promises, per role. */
const EMPTY_TEXT = {
  admin: "Hier erscheint, wenn dir ein Kunde im privaten Chat unter Nachrichten schreibt oder ein Freelancer eine Aufgabe anlegt, ändert oder kommentiert.",
  freelancer: "Hier erscheint, wenn jemand eine Aufgabe in deinen Projekten anlegt, ändert oder kommentiert, eine Datei für dich dazukommt oder oalab dir bei einem Kunden etwas freigibt.",
  customer: "Hier erscheint, wenn oalab dir im Chat antwortet, eine Aufgabe für dich dazukommt, sich ändert oder bei dir liegt, sich ein Projekt ändert oder eine Datei oder ein Termin für dich dazukommt.",
};

/** Fictional lines for the design preview (/preview, dev only), written by the same rules as real notices. */
const previewAt = (minutes: number) => new Date(Date.parse("2026-11-22T09:00:00Z") - minutes * 60_000).toISOString();
export const previewNotices: InboxItem[] = [
  { ...taskNotice({ kind: "task.changed", taskTitle: "Startseite überarbeiten", prefix: taskNoticePrefix("Website-Relaunch", 12), parts: ["Status: Review", "Fällig: 27. November 2026"], href: hubHref(true, "projects") }), id: -1, createdAt: previewAt(18), read: false },
  { kind: "task.customer", title: "Du bist am Zug: Texte für „Über uns“ liefern", body: "Website-Relaunch · Aufgabe #14", href: hubHref(true, "projects"), id: -2, createdAt: previewAt(42), read: false },
  { ...fileNotice("logo-final.svg", "preview"), href: hubHref(true, "files"), id: -3, createdAt: previewAt(95), read: false },
  { ...appointmentNotice({ id: "preview", title: "Abstimmung Texte", startsAt: "2026-11-24T09:00:00Z", before: { status: "requested", startsAt: "2026-11-24T09:00:00Z" }, status: "confirmed" })!, href: hubHref(true, "calendar"), id: -4, createdAt: previewAt(60 * 20), read: true },
  { ...chatNotice({ kind: "chat.reply", customerId: "preview", company: "Nordlicht Studio", author: "Mara Klein", body: "Die neuen Fotos sind eingebaut, schau gern mal rein." }), href: hubHref(true, "messages"), id: -5, createdAt: previewAt(60 * 26), read: true },
];

/**
 * The bell of a real login: its notices, newest first; opening one marks it read. Each line stands in three columns
 * without headings (design „Glocke V3“, user 21.11.2026): where (symbol, customer or area, path), the message with its
 * time, and who it came from. In the design preview nothing reaches the server.
 */
export function NotificationsPanel({ items, role, onClose, preview = false }: { items: InboxItem[]; role: keyof typeof EMPTY_TEXT; onClose: () => void; preview?: boolean }) {
  const [read, setRead] = useState(() => new Set(items.filter((item) => item.read).map((item) => item.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const unread = items.filter((item) => !read.has(item.id));

  if (!items.length) {
    return <div className="modal-empty"><Bell size={30} aria-hidden="true" /><h3>Du bist auf dem neuesten Stand.</h3><p>{EMPTY_TEXT[role]}</p></div>;
  }

  function open(item: InboxItem) {
    if (!read.has(item.id)) {
      setRead((current) => new Set(current).add(item.id));
      if (!preview) void markNoticesRead([item.id]);
    }
    onClose();
  }

  async function markAll() {
    if (preview) { setRead(new Set(items.map((item) => item.id))); return; }
    setBusy(true);
    const result = await markNoticesRead();
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setError("");
    setRead(new Set(items.map((item) => item.id)));
  }

  return <>
    <ul className="notice-list">
      {items.map((item) => {
        const { icon: Icon, color } = symbolOf(item.kind);
        const isRead = read.has(item.id);
        const columns = noticeColumns(item, role);
        return (
          <li key={item.id}>
            <Link href={item.href} className={`notice-row${isRead ? "" : " is-unread"}`} onClick={() => open(item)}>
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
                <time dateTime={item.createdAt}>{when.format(new Date(item.createdAt))}{isRead ? "" : " · neu"}</time>
              </span>
              <span className="notice-from">
                {columns.from && <strong><span className="visually-hidden">von </span>{columns.from}</strong>}
                {columns.fromDetail && <span>{columns.fromDetail}</span>}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
    {error && <p className="form-error" role="alert">{error}</p>}
    {unread.length > 0 && <button type="button" className="sheet-button" onClick={markAll} disabled={busy}><Check size={17} aria-hidden="true" />Alle als gelesen markieren</button>}
  </>;
}
