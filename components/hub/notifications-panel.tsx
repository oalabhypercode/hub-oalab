"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, Building2, CalendarDays, Check, Files, FolderOpen, ListTodo, MessageSquare, type LucideIcon } from "lucide-react";
import { markNoticesRead } from "@/lib/hub-notify/actions";
import type { InboxItem } from "@/lib/hub-notify/server";
import { categories } from "@/lib/categories";

const when = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function symbolOf(kind: string): { icon: LucideIcon; color: string } {
  if (kind === "task.customer" || kind === "task.created" || kind === "task.changed") return { icon: ListTodo, color: categories.projects.fill };
  if (kind === "project.changed") return { icon: FolderOpen, color: categories.projects.fill };
  if (kind === "file.shared") return { icon: Files, color: categories.files.fill };
  // A release for a freelancer under „Kunden“ (18.11.2026): the page has no category colour, so the accent.
  if (kind === "share.granted") return { icon: Building2, color: "var(--accent-text)" };
  if (kind === "chat.message" || kind === "chat.reply") return { icon: MessageSquare, color: categories.messages.fill };
  return { icon: CalendarDays, color: categories.calendar.fill };
}

/** What the empty bell promises, per role. */
const EMPTY_TEXT = {
  admin: "Hier erscheint, wenn dir ein Kunde im privaten Chat unter Nachrichten schreibt oder ein Freelancer eine Aufgabe anlegt, ändert oder kommentiert.",
  freelancer: "Hier erscheint, wenn jemand eine Aufgabe in deinen Projekten anlegt, ändert oder kommentiert, eine Datei für dich dazukommt oder oalab dir bei einem Kunden etwas freigibt.",
  customer: "Hier erscheint, wenn oalab dir im Chat antwortet, eine Aufgabe für dich dazukommt, sich ändert oder bei dir liegt, sich ein Projekt ändert oder eine Datei oder ein Termin für dich dazukommt.",
};

/** The bell of a real login: its notices, newest first; opening one marks it read. */
export function NotificationsPanel({ items, role, onClose }: { items: InboxItem[]; role: keyof typeof EMPTY_TEXT; onClose: () => void }) {
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
      void markNoticesRead([item.id]);
    }
    onClose();
  }

  async function markAll() {
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
        return (
          <li key={item.id}>
            <Link href={item.href} className={`notice-row${isRead ? "" : " is-unread"}`} onClick={() => open(item)}>
              <span className="notification-symbol" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }}><Icon size={19} color={color} aria-hidden="true" /></span>
              <span className="notice-text">
                <strong>{item.title}</strong>
                {item.body && <span>{item.body}</span>}
                <time dateTime={item.createdAt}>{when.format(new Date(item.createdAt))}{isRead ? "" : " · neu"}</time>
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
