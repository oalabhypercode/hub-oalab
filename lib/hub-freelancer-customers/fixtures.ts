/**
 * Fictional examples for the design preview of „Kunden“ (/preview/customers) and of the admins' tab „Freelancer“: the
 * customers of the preview's other areas (KD-24017 …) looked after by the fictional freelancer „Studio Kranich“.
 * Nothing here is real; type-only imports, so the tests load this file directly.
 */
import type { FreelancerAssignment, FreelancerCustomerCard, FreelancerCustomersState } from "./types";

const FREELANCER = { id: "FL-31420", name: "Studio Kranich" };
const NOTE = "Die Website läuft mit WordPress. Änderungen bitte zuerst auf der Testseite, live erst nach Freigabe durch oalab.\nAnsprechpartnerin beim Kunden ist Jana Sommer, am besten vormittags.\nBilder nur aus dem Ordner „Freigegeben“ im Asset Management.";
const off = { domains: null, mail: null, packages: null, contact: null };
const checks = (count: number) => ({ website: count > 0, ssl: count > 1, mx: count > 2, spf: count > 3, dkim: count > 4, dmarc: count > 5 });

const cards: FreelancerCustomerCard[] = [
  {
    customerId: "KD-24023", freelancerId: FREELANCER.id, company: "Form & Feld", customerNumber: "KD-24023", organizationId: null, assignedAt: "2026-10-01T09:00:00Z",
    shares: { ...off, domains: "2026-10-01T09:05:00Z" }, note: null, noteUpdatedAt: null,
    domains: [{ id: "dom-formfeld", domain: "formundfeld.example", display: "formundfeld.example", status: "setup", owner: "customer", registrar: "united-domains", dnsProvider: "united-domains", websiteHost: "Hetzner", renewsOn: "2027-05-02", checks: checks(1) }],
    mailServer: null, mailboxes: null, packages: null, contact: null,
  },
  {
    customerId: "KD-24017", freelancerId: FREELANCER.id, company: "Nordlicht Studio", customerNumber: "KD-24017", organizationId: null, assignedAt: "2026-09-01T09:00:00Z",
    shares: { ...off, domains: "2026-10-12T10:00:00Z", mail: "2026-10-12T10:00:00Z" }, note: NOTE, noteUpdatedAt: "2026-10-12T10:00:00Z",
    domains: [
      { id: "dom-nordlicht", domain: "nordlicht.example", display: "nordlicht.example", status: "active", owner: "customer", registrar: "INWX", dnsProvider: "Cloudflare", websiteHost: "netcup", renewsOn: "2027-03-15", checks: checks(6) },
      { id: "dom-nordlicht-studio", domain: "nordlicht-studio.example", display: "nordlicht-studio.example", status: "active", owner: "customer", registrar: "INWX", dnsProvider: "Cloudflare", websiteHost: "", renewsOn: "2027-03-15", checks: checks(4) },
    ],
    mailServer: { imapHost: "mail.nordlicht.example", imapPort: 993, imapSecurity: "ssl", smtpHost: "mail.nordlicht.example", smtpPort: 465, smtpSecurity: "ssl", webmailUrl: "https://webmail.nordlicht.example", provider: "netcup" },
    mailboxes: [
      { id: "mb-info", address: "info@nordlicht.example", display: "info@nordlicht.example", person: "Jana Sommer", kind: "mailbox", target: "", targetDisplay: "" },
      { id: "mb-jana", address: "jana@nordlicht.example", display: "jana@nordlicht.example", person: "Jana Sommer", kind: "mailbox", target: "", targetDisplay: "" },
      { id: "mb-kontakt", address: "kontakt@nordlicht.example", display: "kontakt@nordlicht.example", person: "", kind: "alias", target: "info@nordlicht.example", targetDisplay: "info@nordlicht.example" },
    ],
    packages: null, contact: null,
  },
  {
    customerId: "KD-24031", freelancerId: FREELANCER.id, company: "Studio Horizont", customerNumber: "KD-24031", organizationId: null, assignedAt: "2026-09-15T09:00:00Z",
    shares: off, note: null, noteUpdatedAt: null, domains: null, mailServer: null, mailboxes: null, packages: null, contact: null,
  },
];

export const freelancerCustomerFixtures = (): FreelancerCustomersState => ({ source: "fixtures", ready: true, cards });

/** The example projects of the preview per customer, as the task board would give them. */
export const freelancerProjectFixtures: Record<string, { id: string; name: string; status: string; open: number; nextDue: string | null }[]> = {
  "KD-24017": [
    { id: "proj-relaunch", name: "Website-Relaunch", status: "active", open: 4, nextDue: "2026-10-20" },
    { id: "proj-newsletter", name: "Newsletter-Vorlage", status: "planning", open: 1, nextDue: "2026-10-28" },
  ],
  "KD-24023": [{ id: "proj-shop", name: "Shop-Anbindung", status: "active", open: 2, nextDue: "2026-10-23" }],
  "KD-24031": [{ id: "proj-logo", name: "Logo-Feinschliff", status: "hold", open: 0, nextDue: null }],
};

/** The admins' view of the same examples: who looks after which customer and what they see. */
export const freelancerShareFixtures = (): FreelancerAssignment[] => cards.map((card) => ({
  freelancerId: FREELANCER.id, freelancerName: FREELANCER.name, freelancerNumber: FREELANCER.id, customerId: card.customerId, assignedAt: card.assignedAt,
  shares: card.shares, note: card.note ?? "", noteUpdatedAt: card.noteUpdatedAt,
}));
