"use client";

import { KeyRound, NotebookPen, SquareKanban, UserCog } from "lucide-react";
import { categories, type CategoryId } from "@/lib/categories";
import { formatDeadline, hubHref, type HubSection, type Project } from "@/lib/hub-data";
import { CategoryIcon } from "./glass";

export type QuickLink = { id: string; label: string; href: string; icon: React.ReactNode; external?: boolean; tip: string };

/** The task board of one project under Projekte › Aufgaben (it picks its board by ?project=). */
export const taskBoardHref = (preview: boolean, projectId: string) => `${hubHref(preview, "projects")}/tasks?project=${encodeURIComponent(projectId)}`;

/**
 * Everything around the project in one click: its chat, files, next date, contract, accesses, customer entry and, for
 * admins, its task board (the website has its own rows, see `projectSites`). Each target opens with this customer already
 * chosen; a target that does not exist is left out instead of leading to an empty page. On a keyboard the digits 1–9
 * open them too. The board comes last, so the digits of the other targets stay where they were. Without a project id
 * (the customer's head on „Projekte“) the links stay with the customer and the board is left out.
 */
export function quickLinks(project: Pick<Project, "customerId" | "company" | "dueOn"> & { id?: string }, preview: boolean, admin: boolean): QuickLink[] {
  const customer = project.customerId;
  // Real projects without a hub customer have nothing to filter by; the preview shows the pages with its examples.
  const known = Boolean(customer) || preview;
  const withCustomer = (section: HubSection, key: string) => `${hubHref(preview, section)}${customer ? `?${key}=${encodeURIComponent(customer)}` : ""}`;
  const icon = (category: CategoryId) => <CategoryIcon category={category} size={18} />;
  const links: (QuickLink | false)[] = [
    known && { id: "chat", label: "Chat", href: withCustomer("messages", "chat"), icon: icon("messages"), tip: admin ? `Chat mit ${project.company ?? "dem Kunden"}` : "Chat mit OALab" },
    known && { id: "files", label: "Dateien", href: withCustomer("files", "customer"), icon: icon("files"), tip: admin ? `Dateien von ${project.company ?? "diesem Kunden"}` : "Deine Dateien" },
    project.dueOn
      ? { id: "date", label: formatDeadline(project.dueOn), href: `${hubHref(preview, "calendar")}?day=${project.dueOn}`, icon: icon("calendar"), tip: "Nächsten Termin im Kalender zeigen" }
      : { id: "date", label: "Kalender", href: hubHref(preview, "calendar"), icon: icon("calendar"), tip: "Kalender öffnen" },
    known && { id: "contract", label: "Vertrag", href: withCustomer("contracts", "customer"), icon: icon("contracts"), tip: "Vertrag, Domain und Postfächer" },
    admin && known && { id: "keychain", label: "Zugänge", href: withCustomer("keychain", "customer"), icon: <KeyRound size={18} color="var(--accent-text)" aria-hidden="true" />, tip: "Zugänge im Schlüsselbund" },
    admin && known && { id: "customer", label: "Kunde", href: withCustomer("users", "customer"), icon: <UserCog size={18} color="var(--accent-text)" aria-hidden="true" />, tip: "Kundeneintrag in der Nutzerverwaltung" },
    // The board picks its project by id, so it needs no hub customer.
    admin && Boolean(project.id) && { id: "tasks", label: "Aufgaben", href: taskBoardHref(preview, project.id!), icon: <SquareKanban className="category-icon" size={18} color={categories.projects.fill} strokeWidth={2.2} aria-hidden="true" />, tip: "Aufgaben-Board dieses Projekts" },
    // Notizen (22.11.2026) come last, so the digits of the others stay where they were.
    known && { id: "notes", label: "Notizen", href: withCustomer("projects", "customer").replace(/\/projects(?=\?|$)/, "/projects/notes"), icon: <NotebookPen className="category-icon" size={18} color={categories.projects.fill} strokeWidth={2.2} aria-hidden="true" />, tip: admin ? `Notizen von ${project.company ?? "diesem Kunden"}` : "Notizen von oalab" },
  ];
  return links.filter((link): link is QuickLink => Boolean(link));
}
