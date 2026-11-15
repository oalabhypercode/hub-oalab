"use client";

import { KeyRound, UserCog } from "lucide-react";
import type { CategoryId } from "@/lib/categories";
import { formatDeadline, hubHref, type HubSection, type Project } from "@/lib/hub-data";
import { CategoryIcon } from "./glass";

export type QuickLink = { id: string; label: string; href: string; icon: React.ReactNode; external?: boolean; tip: string };

/**
 * Everything around the project in one click: its chat, files, next date, contract, accesses and customer entry (the
 * website has its own rows, see `projectSites`). Each target opens with this customer already chosen; a target that does not exist is left out instead
 * of leading to an empty page. On a keyboard the digits 1–9 open them too.
 */
export function quickLinks(project: Project, preview: boolean, admin: boolean): QuickLink[] {
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
  ];
  return links.filter((link): link is QuickLink => Boolean(link));
}
