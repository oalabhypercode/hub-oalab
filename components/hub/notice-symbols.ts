import { Bell, Building2, CalendarCheck, CalendarClock, CalendarDays, CalendarX, FileBadge, Files, Flag, FolderOpen, Hourglass, LifeBuoy, ListTodo, MessageSquare, NotebookPen, SquareKanban, ThumbsUp, TriangleAlert, UserCheck, type LucideIcon } from "lucide-react";
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
  if (kind === "note.shared" || kind === "note.changed" || kind === "note.edited" || kind === "note.team") return { icon: NotebookPen, color: categories.projects.fill, area: "Notizen" };
  // A customer's request or message on the service platform (23.11.2026), to the team.
  if (kind === "service.message") return { icon: LifeBuoy, color: "#30B0C7", area: "Serviceplattform" };
  // A customer's „Gefällt mir“ on a result (27.11.2026): the change can go live.
  if (kind === "service.approved") return { icon: ThumbsUp, color: "#30B0C7", area: "Serviceplattform" };
  // What waits for admins (derived on the Übersicht, components/hub/admin-notices.ts).
  if (kind === "todo.registrations") return { icon: UserCheck, color: "var(--accent-text)", area: "User Management" };
  if (kind === "todo.request") return { icon: CalendarClock, color: categories.calendar.fill, area: "Kalender" };
  if (kind === "todo.overdue") return { icon: SquareKanban, color: categories.projects.fill, area: "Aufgaben" };
  if (kind === "todo.quota") return { icon: LifeBuoy, color: "#30B0C7", area: "Serviceplattform" };
  if (kind === "todo.risk") return { icon: TriangleAlert, color: categories.projects.fill, area: "Projekte" };
  if (kind === "todo.waiting") return { icon: Hourglass, color: categories.projects.fill, area: "Projekte" };
  if (kind === "chat.message" || kind === "chat.reply") return { icon: MessageSquare, color: categories.messages.fill, area: "Nachrichten" };
  // To the team (24.11.2026): a customer asked for an appointment, like „Neu“ on the overview.
  if (kind === "appointment.requested") return { icon: CalendarClock, color: categories.calendar.fill, area: "Kalender" };
  // To the customer (24.11.2026): something new under Vertrag & Domain.
  if (kind === "contract.changed") return { icon: FileBadge, color: categories.contracts.fill, area: "Vertrag & Domain" };
  if (kind === "appointment.confirmed") return { icon: CalendarCheck, color: categories.calendar.fill, area: "Kalender" };
  if (kind === "appointment.cancelled" || kind === "appointment.declined") return { icon: CalendarX, color: categories.calendar.fill, area: "Kalender" };
  if (kind.startsWith("appointment.")) return { icon: CalendarDays, color: categories.calendar.fill, area: "Kalender" };
  return { icon: Bell, color: categories.projects.fill, area: "Hub" };
}

const when = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** "25. Nov., 08:10" in German time: the same on the server and in the browser. */
export const noticeWhen = (iso: string) => {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? "" : when.format(time);
};
