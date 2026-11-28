/**
 * Rules of the freelancers' area „Kunden“ and of the admins' tab „Freelancer“ under „Vertrag & Domain“ (approved
 * 18.11.2026): what can be released, how a release and a note are read, and how the database's cards are read back.
 * Pure functions with type-only imports, so the tests load this file directly. The database checks the same again
 * (migration 202611180001 in service-oalab).
 */
import type { CardContact, CardDomain, CardMailbox, CardMailServer, CardPackage, CustomerNameRow, FreelancerCustomerCard, FreelancerCustomerRow, ShareTimes } from "./types";

export type ShareArea = "domains" | "mail" | "packages" | "contact";

/** The areas an admin releases per freelancer and customer; the order is the one of the tab. */
export const shareAreas: Record<ShareArea, { label: string; hint: string }> = {
  domains: { label: "Domains & Hosting", hint: "wo Website, Domain und DNS liegen, Status und Ablauf" },
  mail: { label: "E-Mail", hint: "Adressen und Mail-Server, ohne Passwörter" },
  packages: { label: "Pakete", hint: "Paketnamen und seit wann, ohne Preise" },
  contact: { label: "Kontaktdaten", hint: "E-Mail, Telefon und Anschrift der Firma" },
};
export const shareAreaIds = Object.keys(shareAreas) as ShareArea[];
export const isShareArea = (value: unknown): value is ShareArea => typeof value === "string" && Object.hasOwn(shareAreas, value);

export const MAX_SHARE_NOTE = 2000;
export const emptyShares = (): ShareTimes => ({ domains: null, mail: null, packages: null, contact: null });
export const releasedAreas = (shares: ShareTimes) => shareAreaIds.filter((area) => Boolean(shares[area]));

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && uuid.test(value);

/** A note as stored: line breaks kept (at most one empty line), no control characters, at most 2000 characters. */
export const cleanShareNote = (value: unknown) => typeof value === "string"
  ? value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_SHARE_NOTE)
  : "";

type Read<T> = { ok: true; value: T } | { ok: false; error: string };
const pair = (input: Record<string, unknown>): Read<{ customerId: string; freelancerId: string }> =>
  isUuid(input.customerId) && isUuid(input.freelancerId)
    ? { ok: true, value: { customerId: input.customerId, freelancerId: input.freelancerId } }
    : { ok: false, error: "Diese Zuordnung gibt es nicht mehr." };

/** One switch of the tab: which freelancer, which customer, which area, on or off. */
export function readShareToggle(input: unknown): Read<{ customerId: string; freelancerId: string; area: ShareArea; on: boolean }> {
  const value = (input ?? {}) as Record<string, unknown>;
  const who = pair(value);
  if (!who.ok) return who;
  if (!isShareArea(value.area)) return { ok: false, error: "Diesen Bereich gibt es nicht." };
  if (typeof value.on !== "boolean") return { ok: false, error: "Bitte an oder aus wählen." };
  return { ok: true, value: { ...who.value, area: value.area, on: value.on } };
}

/** The note for one freelancer at one customer; empty removes it. */
export function readShareNote(input: unknown): Read<{ customerId: string; freelancerId: string; note: string }> {
  const value = (input ?? {}) as Record<string, unknown>;
  const who = pair(value);
  if (!who.ok) return who;
  if (typeof value.note !== "string") return { ok: false, error: "Bitte einen Text eingeben oder das Feld leeren." };
  if (value.note.trim().length > MAX_SHARE_NOTE) return { ok: false, error: `Höchstens ${MAX_SHARE_NOTE} Zeichen.` };
  return { ok: true, value: { ...who.value, note: cleanShareNote(value.note) } };
}

/* ---------- Reading the database's cards (hub_freelancer_customer_cards()) ---------- */

const text = (value: unknown) => (typeof value === "string" ? value : "");
const textOrNull = (value: unknown) => (typeof value === "string" && value ? value : null);
const port = (value: unknown) => (typeof value === "number" && Number.isInteger(value) ? value : null);
const object = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null);
const list = (value: unknown) => (Array.isArray(value) ? value : null);
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? value as T : fallback);

const STATUSES = ["setup", "active", "transfer", "cancelled", "ended"] as const;
const CHECKS = ["website", "ssl", "mx", "spf", "dkim", "dmarc"] as const;
const KINDS = ["mailbox", "forward", "alias"] as const;
const SECURITIES = ["ssl", "starttls"] as const;
const PACKAGES = ["domain", "domain-mail", "service-lite", "service-max"] as const;

/** „info@xn--mller-kva.de“ → „info@müller.de“ with the given converter for the domain part; lists stay „a, b“. */
export const readableAddresses = (value: string, readable: (domain: string) => string) => value.split(", ").map((address) => {
  const at = address.lastIndexOf("@");
  return at > 0 ? `${address.slice(0, at)}@${readable(address.slice(at + 1))}` : address;
}).join(", ");

function readShares(value: unknown): ShareTimes {
  const shares = object(value) ?? {};
  return { domains: textOrNull(shares.domains), mail: textOrNull(shares.mail), packages: textOrNull(shares.packages), contact: textOrNull(shares.contact) };
}

function readDomain(value: unknown, readable: (domain: string) => string): CardDomain | null {
  const row = object(value);
  if (!row || !isUuid(row.id) || !text(row.domain)) return null;
  const checks = object(row.checks) ?? {};
  return {
    id: row.id, domain: text(row.domain), display: readable(text(row.domain)), status: oneOf(row.status, STATUSES, "active"), owner: row.owner === "oalab" ? "oalab" : "customer",
    registrar: text(row.registrar), dnsProvider: text(row.dnsProvider), websiteHost: text(row.websiteHost), renewsOn: textOrNull(row.renewsOn),
    checks: Object.fromEntries(CHECKS.map((id) => [id, checks[id] === true])) as CardDomain["checks"],
  };
}

function readMailServer(value: unknown): CardMailServer | null {
  const row = object(value);
  if (!row) return null;
  return {
    imapHost: text(row.imapHost), imapPort: port(row.imapPort), imapSecurity: oneOf(row.imapSecurity, SECURITIES, "ssl"),
    smtpHost: text(row.smtpHost), smtpPort: port(row.smtpPort), smtpSecurity: oneOf(row.smtpSecurity, SECURITIES, "ssl"),
    webmailUrl: text(row.webmailUrl).startsWith("https://") ? text(row.webmailUrl) : "", provider: text(row.provider),
  };
}

function readMailbox(value: unknown, readable: (domain: string) => string): CardMailbox | null {
  const row = object(value);
  if (!row || !isUuid(row.id) || !text(row.address)) return null;
  const target = text(row.target);
  return {
    id: row.id, address: text(row.address), display: readableAddresses(text(row.address), readable), person: text(row.person), kind: oneOf(row.kind, KINDS, "mailbox"),
    target, targetDisplay: target ? readableAddresses(target, readable) : "",
  };
}

function readPackage(value: unknown): CardPackage | null {
  const row = object(value);
  if (!row || !PACKAGES.includes(row.packageId as typeof PACKAGES[number])) return null;
  return { group: row.group === "service" ? "service" : "domain", packageId: row.packageId as CardPackage["packageId"], since: textOrNull(row.since), until: textOrNull(row.until) };
}

function readContact(value: unknown): CardContact | null {
  const row = object(value);
  if (!row) return null;
  return { email: text(row.email), phone: text(row.phone), website: text(row.website), street: text(row.street), postalCode: text(row.postalCode), city: text(row.city), country: text(row.country) };
}

/**
 * The cards as the database returns them, checked field by field: an area that is off stays null, unknown values fall
 * back to safe ones, broken rows are dropped. A customer looked after through two freelancer entries of the same login
 * appears once (the first one wins).
 */
export function parseCards(raw: unknown, readable: (domain: string) => string = (domain) => domain): FreelancerCustomerCard[] {
  const seen = new Set<string>();
  return (list(raw) ?? []).flatMap((value): FreelancerCustomerCard[] => {
    const row = object(value);
    if (!row || !isUuid(row.customerId) || !isUuid(row.freelancerId) || seen.has(row.customerId)) return [];
    seen.add(row.customerId);
    const domains = list(row.domains);
    const mailboxes = list(row.mailboxes);
    const packages = list(row.packages);
    return [{
      customerId: row.customerId, freelancerId: row.freelancerId, company: text(row.company), customerNumber: text(row.customerNumber),
      organizationId: isUuid(row.organizationId) ? row.organizationId : null, assignedAt: textOrNull(row.assignedAt),
      shares: readShares(row.shares), note: textOrNull(row.note), noteUpdatedAt: textOrNull(row.noteUpdatedAt),
      domains: domains ? domains.flatMap((item) => readDomain(item, readable) ?? []) : null,
      mailServer: readMailServer(row.mailServer),
      mailboxes: mailboxes ? mailboxes.flatMap((item) => readMailbox(item, readable) ?? []) : null,
      packages: packages ? packages.flatMap((item) => readPackage(item) ?? []) : null,
      contact: readContact(row.contact),
    }];
  });
}

/* ---------- What the freelancer reads first: where everything runs ---------- */

export type HostingRow = { kind: "website" | "registrar" | "dns" | "mail"; provider: string; detail: string };

/**
 * „Wo liegt was?“ from the released areas: one row per provider, so nobody has to read it out of the domain rows.
 * Websites by host (a domain that only forwards has none), registrars and DNS once each, the mail provider last.
 */
export function hostingOf(card: Pick<FreelancerCustomerCard, "domains" | "mailServer">): HostingRow[] {
  const rows: HostingRow[] = [];
  const domains = card.domains ?? [];
  for (const domain of domains) if (domain.websiteHost) rows.push({ kind: "website", provider: domain.websiteHost, detail: `Website ${domain.display}` });
  const count = (pick: (domain: CardDomain) => string, value: string) => domains.filter((domain) => pick(domain) === value).length;
  for (const registrar of [...new Set(domains.map((domain) => domain.registrar).filter(Boolean))]) {
    const n = count((domain) => domain.registrar, registrar);
    rows.push({ kind: "registrar", provider: registrar, detail: `${n} ${n === 1 ? "Domain" : "Domains"} registriert` });
  }
  for (const dns of [...new Set(domains.map((domain) => domain.dnsProvider).filter(Boolean))]) rows.push({ kind: "dns", provider: dns, detail: "DNS-Einträge der Domains" });
  if (card.mailServer?.provider) rows.push({ kind: "mail", provider: card.mailServer.provider, detail: "Postfächer und Mail-Server" });
  return rows;
}

/** A row of hub_freelancer_customer_list() with the columns the hub reads; anything else is dropped. */
export function isFreelancerCustomerRow(row: unknown): row is FreelancerCustomerRow {
  if (!row || typeof row !== "object") return false;
  const value = row as Record<string, unknown>;
  return typeof value.id === "string" && typeof value.company === "string" && typeof value.customer_number === "string";
}

/**
 * The rows a freelancer's session read in hub_customers (their own entry; before migration 202611200001 their customers
 * too), with the customers of their list added once each, ordered by customer number as the database ordered them.
 * Without a list (`null`: the database does not have the function yet) the rows stay as they are.
 */
export function withFreelancerCustomers(rows: readonly CustomerNameRow[], theirs: readonly FreelancerCustomerRow[] | null): CustomerNameRow[] {
  if (!theirs) return [...rows];
  const known = new Set(rows.map((row) => row.id));
  const added = theirs.filter((row) => !known.has(row.id)).map((row): CustomerNameRow => ({ id: row.id, customer_number: row.customer_number, company: row.company, kind: "customer" }));
  return [...rows, ...added].sort((a, b) => a.customer_number.localeCompare(b.customer_number, "de"));
}

/** How many rows „Vertrag & Domain“ shows for a card: the count on its tab. */
export function releasedCount(card: FreelancerCustomerCard) {
  const server = card.mailServer ? [card.mailServer.imapHost, card.mailServer.smtpHost, card.mailServer.webmailUrl].filter(Boolean).length : 0;
  return hostingOf(card).length + (card.domains?.length ?? 0) + (card.mailboxes?.length ?? 0) + server + (card.packages?.length ?? 0) + (card.contact ? 1 : 0);
}
