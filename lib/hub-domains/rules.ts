/**
 * Rules of „Domain & Mail“ and „Zugangsdaten“ in the area „Vertrag & Domain“ (stage 2): statuses, checks and kinds, and
 * what an admin may save as a domain, mail server, mailbox, provider login or password. Pure functions without imports
 * at run time, so the tests load this file directly. The database checks the same formats again (migration
 * 202611050002 in service-oalab).
 */

export type DomainStatus = "setup" | "active" | "transfer" | "cancelled" | "ended";
/** Label and pill tone (glass.css) of each status; the order is the one of the form. */
export const domainStatuses: Record<DomainStatus, { label: string; tone: "ok" | "todo" | "info" | "off" }> = {
  active: { label: "Aktiv", tone: "ok" },
  setup: { label: "In Einrichtung", tone: "todo" },
  transfer: { label: "Umzug läuft", tone: "info" },
  cancelled: { label: "Gekündigt", tone: "todo" },
  ended: { label: "Beendet", tone: "off" },
};
export const domainStatusIds = Object.keys(domainStatuses) as DomainStatus[];
export const isDomainStatus = (value: unknown): value is DomainStatus => typeof value === "string" && Object.hasOwn(domainStatuses, value);

export type DomainCheck = "website" | "ssl" | "mx" | "spf" | "dkim" | "dmarc";
export const domainChecks: Record<DomainCheck, { label: string; hint: string }> = {
  website: { label: "Website", hint: "A- oder CNAME-Eintrag zeigt auf die Website" },
  ssl: { label: "SSL", hint: "Gültiges Zertifikat für die Website" },
  mx: { label: "MX", hint: "MX-Eintrag zeigt auf den Mail-Server" },
  spf: { label: "SPF", hint: "SPF-Eintrag erlaubt den Mail-Server" },
  dkim: { label: "DKIM", hint: "DKIM-Schlüssel steht im DNS" },
  dmarc: { label: "DMARC", hint: "DMARC-Eintrag ist gesetzt" },
};
export const domainCheckIds = Object.keys(domainChecks) as DomainCheck[];

export type DomainOwner = "oalab" | "customer";
export const domainOwners: Record<DomainOwner, string> = { customer: "Kunde", oalab: "oalab" };
export const isDomainOwner = (value: unknown): value is DomainOwner => value === "oalab" || value === "customer";

export type MailboxKind = "mailbox" | "forward" | "alias";
export const mailboxKinds: Record<MailboxKind, { label: string; target: string }> = {
  mailbox: { label: "Postfach", target: "" },
  forward: { label: "Weiterleitung", target: "Leitet weiter an" },
  alias: { label: "Alias", target: "Alias von" },
};
export const mailboxKindIds = Object.keys(mailboxKinds) as MailboxKind[];
export const isMailboxKind = (value: unknown): value is MailboxKind => typeof value === "string" && Object.hasOwn(mailboxKinds, value);

export type MailSecurity = "ssl" | "starttls";
/** Encryption of a mail server with its usual ports. Unencrypted servers are not offered. */
export const mailSecurities: Record<MailSecurity, { label: string; ports: { imap: number; smtp: number } }> = {
  ssl: { label: "SSL/TLS", ports: { imap: 993, smtp: 465 } },
  starttls: { label: "STARTTLS", ports: { imap: 143, smtp: 587 } },
};
export const isMailSecurity = (value: unknown): value is MailSecurity => value === "ssl" || value === "starttls";

export type LoginKind = "registrar" | "dns" | "hosting" | "other";
export const loginKinds: Record<LoginKind, string> = { registrar: "Domain-Anbieter", dns: "DNS", hosting: "Hosting", other: "Sonstiges" };
export const loginKindIds = Object.keys(loginKinds) as LoginKind[];
export const isLoginKind = (value: unknown): value is LoginKind => typeof value === "string" && Object.hasOwn(loginKinds, value);

/** Providers the forms suggest; anything else may be typed. */
export const providerSuggestions = ["netcup", "IONOS", "Strato", "Hetzner", "All-Inkl", "united-domains", "INWX", "Cloudflare", "Vercel", "Netlify", "GoDaddy"];

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && uuid.test(value);

/** A real calendar day as YYYY-MM-DD (as in lib/hub-contracts/rules.ts). */
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().startsWith(value);
}

function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const cleanLine = (value: unknown, max: number) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
const cleanText = (value: unknown, max: number) => typeof value === "string"
  ? value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max)
  : "";

/* ---------- Host names, domains, addresses, links ---------- */

const LABEL = "[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?";
const DOMAIN = new RegExp(`^(${LABEL}\\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$`);
const HOST = new RegExp(`^(${LABEL}\\.)*${LABEL}$`);
const LOCAL_PART = /^[a-z0-9._%+-]{1,64}$/;

/** A host name as typed (also with https://, a path or a port), in lower case and with umlauts as xn--…; "" if none. */
function asciiHost(value: string) {
  const text = value.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d*$/, "").replace(/\.$/, "");
  if (!text || /[\s@\\[\]]/.test(text)) return "";
  try {
    return new URL(`http://${text}`).hostname;
  } catch {
    return "";
  }
}

/** „https://www.Müller.de/“ → „www.xn--mller-kva.de“; null when it is no domain. */
export function normalizeDomain(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const host = asciiHost(value);
  return host.length >= 3 && host.length <= 253 && DOMAIN.test(host) ? host : null;
}

/** A server name such as mail.kunde.de; null when it is none. */
export function normalizeHost(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const host = asciiHost(value);
  return host && host.length <= 253 && HOST.test(host) ? host : null;
}

/** „Info@Kunde.de“ → „info@kunde.de“, umlaut domains as xn--…; null when it is no address. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  const at = text.lastIndexOf("@");
  if (at < 1 || /[\s/:?#]/.test(text)) return null;
  const local = text.slice(0, at);
  const domain = normalizeDomain(text.slice(at + 1));
  if (!domain || !LOCAL_PART.test(local) || /^\.|\.$|\.\./.test(local)) return null;
  const address = `${local}@${domain}`;
  return address.length <= 254 ? address : null;
}

/** A link as typed; without a scheme it gets https://. Only http(s), with a real host name, without spaces. */
export function normalizeUrl(value: unknown, httpsOnly: boolean): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return "";
  if (/\s/.test(text) || text.length > 300) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && (httpsOnly || url.protocol !== "http:")) return null;
  if (url.username || url.password || !HOST.test(url.hostname)) return null;
  return url.href.length <= 300 ? url.href : null;
}

type Read<T> = { ok: true; value: T } | { ok: false; error: string };

/* ---------- Domains ---------- */

export const MAX_PROVIDER = 100;
export const MAX_NOTE = 2000;

export type DomainInput = {
  domain: string;
  registrar: string;
  dnsProvider: string;
  websiteHost: string;
  owner: DomainOwner;
  renewsOn: string | null;
  status: DomainStatus;
  checks: Record<DomainCheck, boolean>;
  note: string;
};

/** A domain as an admin saves it. */
export function readDomain(input: Record<string, unknown>): Read<DomainInput> {
  const domain = normalizeDomain(input.domain);
  if (!domain) return { ok: false, error: "Bitte die Domain angeben, zum Beispiel kunde.de." };
  if (!isDomainStatus(input.status)) return { ok: false, error: "Bitte einen Status wählen." };
  if (!isDomainOwner(input.owner)) return { ok: false, error: "Bitte angeben, wem die Domain gehört." };
  const renewsOn = input.renewsOn ? input.renewsOn : null;
  if (renewsOn !== null && !isIsoDay(renewsOn)) return { ok: false, error: "Bitte ein gültiges Datum für die Verlängerung angeben." };
  const checks = (input.checks && typeof input.checks === "object" ? input.checks : {}) as Record<string, unknown>;
  return {
    ok: true,
    value: {
      domain,
      registrar: cleanLine(input.registrar, MAX_PROVIDER),
      dnsProvider: cleanLine(input.dnsProvider, MAX_PROVIDER),
      websiteHost: cleanLine(input.websiteHost, MAX_PROVIDER),
      owner: input.owner,
      renewsOn: renewsOn as string | null,
      status: input.status,
      checks: Object.fromEntries(domainCheckIds.map((id) => [id, checks[id] === true])) as Record<DomainCheck, boolean>,
      note: cleanText(input.note, MAX_NOTE),
    },
  };
}

/** Domains that renew or run out within the next `days` days (from today on), soonest first; ended ones never. */
export function renewingSoon<D extends { status: DomainStatus; renewsOn: string | null }>(domains: readonly D[], today: string, days = 60): (D & { renewsOn: string })[] {
  const last = addDays(today, days);
  return domains
    .filter((domain): domain is D & { renewsOn: string } => domain.status !== "ended" && domain.renewsOn !== null && domain.renewsOn >= today && domain.renewsOn <= last)
    .sort((a, b) => a.renewsOn.localeCompare(b.renewsOn));
}

/** A running domain whose renewal day has passed: its date needs updating. */
export const renewalPassed = (domain: { status: DomainStatus; renewsOn: string | null }, today: string) =>
  domain.renewsOn !== null && domain.renewsOn < today && (domain.status === "active" || domain.status === "setup" || domain.status === "transfer");

/* ---------- Mail server ---------- */

export type MailServerInput = {
  provider: string;
  imapHost: string;
  imapPort: number | null;
  imapSecurity: MailSecurity;
  smtpHost: string;
  smtpPort: number | null;
  smtpSecurity: MailSecurity;
  webmailUrl: string;
};

function readPort(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d{1,5}$/.test(text)) return null;
  const port = Number(text);
  return port >= 1 && port <= 65535 ? port : null;
}

/** The mail server as an admin saves it: each server name with its port and an encryption, webmail over https. */
export function readMailServer(input: Record<string, unknown>): Read<MailServerInput> {
  const value: MailServerInput = {
    provider: cleanLine(input.provider, MAX_PROVIDER),
    imapHost: "", imapPort: null, imapSecurity: "ssl",
    smtpHost: "", smtpPort: null, smtpSecurity: "ssl",
    webmailUrl: "",
  };
  for (const [side, name] of [["imap", "Posteingang"], ["smtp", "Postausgang"]] as const) {
    const security = input[`${side}Security`];
    if (!isMailSecurity(security)) return { ok: false, error: `Bitte die Verschlüsselung für den ${name} wählen.` };
    value[`${side}Security`] = security;
    const typed = typeof input[`${side}Host`] === "string" ? (input[`${side}Host`] as string).trim() : "";
    if (!typed) continue;
    const host = normalizeHost(typed);
    if (!host) return { ok: false, error: `Bitte den Server für den ${name} als Namen angeben, zum Beispiel mail.kunde.de.` };
    const port = readPort(input[`${side}Port`]);
    if (port === null) return { ok: false, error: `Bitte den Port für den ${name} angeben, zum Beispiel ${mailSecurities[security].ports[side]}.` };
    value[`${side}Host`] = host;
    value[`${side}Port`] = port;
  }
  const webmail = normalizeUrl(input.webmailUrl, true);
  if (webmail === null) return { ok: false, error: "Bitte die Webmail-Adresse mit https:// angeben, zum Beispiel https://webmail.kunde.de." };
  value.webmailUrl = webmail;
  return { ok: true, value };
}

/* ---------- Mailboxes ---------- */

export const MAX_PERSON = 120;
export const MAX_TARGETS = 10;

export type MailboxInput = { address: string; person: string; kind: MailboxKind; target: string };

/** A mailbox, forward or alias as an admin saves it. Several forward targets are kept as „a@x.de, b@y.de“. */
export function readMailbox(input: Record<string, unknown>): Read<MailboxInput> {
  const address = normalizeEmail(input.address);
  if (!address) return { ok: false, error: "Bitte eine gültige E-Mail-Adresse angeben, zum Beispiel info@kunde.de." };
  if (!isMailboxKind(input.kind)) return { ok: false, error: "Bitte die Art wählen: Postfach, Weiterleitung oder Alias." };
  const person = cleanLine(input.person, MAX_PERSON);
  if (input.kind === "mailbox") return { ok: true, value: { address, person, kind: "mailbox", target: "" } };
  const typed = typeof input.target === "string" ? input.target.split(/[\s,;]+/).filter(Boolean) : [];
  const targets = [...new Set(typed.map(normalizeEmail))];
  if (!typed.length) return { ok: false, error: input.kind === "forward" ? "Bitte angeben, wohin weitergeleitet wird." : "Bitte das Postfach angeben, zu dem der Alias gehört." };
  if (targets.some((target) => target === null)) return { ok: false, error: "Bitte nur gültige E-Mail-Adressen als Ziel angeben." };
  if (targets.includes(address)) return { ok: false, error: "Eine Adresse kann nicht an sich selbst weiterleiten." };
  if (input.kind === "alias" && targets.length > 1) return { ok: false, error: "Ein Alias gehört zu genau einem Postfach." };
  if (targets.length > MAX_TARGETS) return { ok: false, error: `Höchstens ${MAX_TARGETS} Ziele je Weiterleitung.` };
  return { ok: true, value: { address, person, kind: input.kind, target: targets.join(", ") } };
}

/* ---------- Provider logins and passwords ---------- */

export const MAX_LABEL = 100;
export const MAX_USERNAME = 200;
export const MAX_SECRET = 500;

export type LoginInput = { kind: LoginKind; label: string; loginUrl: string; username: string };

/** A provider login as an admin saves it (without the password, which goes to the vault). */
export function readLogin(input: Record<string, unknown>): Read<LoginInput> {
  if (!isLoginKind(input.kind)) return { ok: false, error: "Bitte die Art wählen: Domain-Anbieter, DNS, Hosting oder Sonstiges." };
  const label = cleanLine(input.label, MAX_LABEL);
  if (!label) return { ok: false, error: "Bitte den Anbieter nennen, zum Beispiel „netcup Kundenbereich“." };
  const loginUrl = normalizeUrl(input.loginUrl, false);
  if (loginUrl === null) return { ok: false, error: "Bitte die Login-Adresse als Link angeben, zum Beispiel https://login.anbieter.de." };
  return { ok: true, value: { kind: input.kind, label, loginUrl, username: cleanLine(input.username, MAX_USERNAME) } };
}

/** A password exactly as typed: never trimmed, one line, at most 500 characters. */
export function readSecret(value: unknown): Read<string> {
  if (typeof value !== "string" || !value.length) return { ok: false, error: "Bitte das Passwort eingeben." };
  if ([...value].length > MAX_SECRET) return { ok: false, error: `Das Passwort ist zu lang (höchstens ${MAX_SECRET} Zeichen).` };
  if (/[\u0000-\u001f\u007f]/.test(value)) return { ok: false, error: "Das Passwort darf keine Zeilenumbrüche oder Steuerzeichen enthalten." };
  return { ok: true, value };
}

export type VaultOwnerKind = "mailbox" | "login";
/** What a password belongs to: a mailbox or a provider login. */
export type VaultOwner = { kind: VaultOwnerKind; id: string };

export function readVaultOwner(input: unknown): VaultOwner | null {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : null;
  return value && (value.kind === "mailbox" || value.kind === "login") && isUuid(value.id) ? { kind: value.kind, id: value.id } : null;
}

/** How long a shown password stays visible. */
export const REVEAL_SECONDS = 30;
/** At most this many looks (show or copy) per admin within LOOK_WINDOW_MINUTES. */
export const LOOK_LIMIT = 30;
export const LOOK_WINDOW_MINUTES = 10;
