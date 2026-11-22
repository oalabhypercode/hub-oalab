import { Bell, Building2, CalendarCheck, CalendarClock, CalendarDays, CalendarX, CalendarX2, Files, Flag, FolderOpen, Hourglass, LifeBuoy, ListTodo, MessageSquare, SquareKanban, TriangleAlert, UserCheck, type LucideIcon } from "lucide-react";
import { categories } from "@/lib/categories";

/** The area a notice of the bell belongs to, with its symbol and colour (the colour of the hub's category). */
export type NoticeSymbol = { icon: LucideIcon; color: string; area: string };

export function noticeSymbol(kind: string): NoticeSymbol {
  if (kind === "task.customer") return { icon: Flag, color: categories.projects.fill, area: "Du bist am Zug" };
  if (kind === "task.created" || kind === "task.changed") return { icon: ListTodo, color: categories.projects.fill, area: "Aufgaben" };
  if (kind === "project.changed") return { icon: FolderOpen, color: categories.projects.fill, area: "Projekte" };
  if (kind === "file.shared") return { icon: Files, color: categories.files.fill, area: "Dateien" };
  // A release for a freelancer under „Kunden“: that page has no category colour, so the accent (as in the bell).
  if (kind === "share.granted") return { icon: Building2, color: "var(--accent-text)", area: "Kunden" };
  // What waits for admins (derived on the Übersicht, components/hub/admin-notices.ts).
  if (kind === "todo.registrations") return { icon: UserCheck, color: "var(--accent-text)", area: "User Management" };
  if (kind === "todo.request") return { icon: CalendarClock, color: categories.calendar.fill, area: "Kalender" };
  if (kind === "todo.overdue") return { icon: SquareKanban, color: categories.projects.fill, area: "Aufgaben" };
  if (kind === "todo.quota") return { icon: LifeBuoy, color: "#30B0C7", area: "Serviceplattform" };
  if (kind === "todo.risk") return { icon: TriangleAlert, color: categories.projects.fill, area: "Projekte" };
  if (kind === "todo.waiting") return { icon: Hourglass, color: categories.projects.fill, area: "Projekte" };
  if (kind === "chat.message" || kind === "chat.reply") return { icon: MessageSquare, color: categories.messages.fill, area: "Nachrichten" };
  if (kind === "appointment.confirmed") return { icon: CalendarCheck, color: categories.calendar.fill, area: "Kalender" };
  if (kind === "appointment.cancelled" || kind === "appointment.declined") return { icon: CalendarX, color: categories.calendar.fill, area: "Kalender" };
  if (kind.startsWith("appointment.")) return { icon: CalendarDays, color: categories.calendar.fill, area: "Kalender" };
  // A calendar of the availability that cannot be read for 24 hours (admins, 22.11.2026).
  if (kind === "calendar.source") return { icon: CalendarX2, color: categories.calendar.fill, area: "Kalender" };
  return { icon: Bell, color: categories.projects.fill, area: "Hub" };
}

const when = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** "25. Nov., 08:10" in German time: the same on the server and in the browser. */
export const noticeWhen = (iso: string) => {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? "" : when.format(time);
};
