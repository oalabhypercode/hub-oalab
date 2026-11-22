/**
 * Other calendars that block time in the hub's calendar (plan „Kalender des Hubs mit Apple Kalender synchron halten“,
 * stage 2, decisions 7 and 9 of 22.11.2026): admins add, under Kalender › Verfügbarkeit, the public link of a calendar
 * in iCloud (or, as a fallback, one published in Outlook) or a mailbox in Microsoft 365, whose free/busy the hub reads
 * through Microsoft Graph. Only start and end of busy times reach the hub, never titles, places or attendees.
 * The rules the panel and the server share; no imports, so the browser loads it and `node --test` checks it directly.
 */

export type SourceKind = "ics" | "microsoft";
export type SourceProvider = "icloud" | "outlook" | "microsoft";
export type SourceRules = { ignoreAllDay: boolean; ignoreFree: boolean };
export const DEFAULT_SOURCE_RULES: SourceRules = { ignoreAllDay: true, ignoreFree: true };

/** A source as the panel shows it: never its link. */
export type SourceView = {
  id: string;
  kind: SourceKind;
  provider: SourceProvider;
  name: string;
  /** Microsoft 365 only: the mailbox. */
  mailbox: string | null;
  rules: SourceRules;
  createdAt: string;
  lastSuccessAt: string | null;
  /** Since when it cannot be read; null while it works. */
  failingSince: string | null;
  /** The last error as a short code (FETCH_ERRORS), null while it works. */
  lastError: string | null;
  /** Busy times in the next twelve weeks after the last good read. */
  busyCount: number;
  /** Added by another admin: their name for the list. */
  ownerName: string | null;
};

/** How often the schedule reads a source (it runs every five minutes) and how far ahead. */
export const SOURCE_EVERY_MINUTES = 10;
export const SOURCE_WEEKS = 12;
/** After this long without a good read the owner gets a notice in the bell; the last times keep blocking until then. */
export const SOURCE_ALERT_HOURS = 24;
/** At most this many busy times per source (the database takes 5000). */
export const SOURCE_SPANS = 2000;

export const PROVIDER_NAMES: Record<SourceProvider, string> = { icloud: "iCloud", outlook: "Outlook", microsoft: "Microsoft 365" };
/** „iCloud · Privat“, „Microsoft 365 · Postfach Team“. */
export const sourceLabel = (source: { provider: SourceProvider; name: string }) => `${PROVIDER_NAMES[source.provider]} · ${source.name}`;

/**
 * The hosts a link may lead to: iCloud's public calendars and calendars published in Outlook. Nothing else, so a link
 * can never make the hub's server call into its own network.
 */
const ALLOWED_HOSTS: { test: (host: string) => boolean; provider: "icloud" | "outlook" }[] = [
  { test: (host) => host === "icloud.com" || host.endsWith(".icloud.com"), provider: "icloud" },
  { test: (host) => host === "outlook.office365.com" || host === "outlook.office.com" || host === "outlook.live.com", provider: "outlook" },
];
export const providerOfHost = (host: string) => ALLOWED_HOSTS.find((item) => item.test(host.toLowerCase()))?.provider ?? null;

export type LinkCheck = { ok: true; url: string; provider: "icloud" | "outlook" } | { ok: false; error: string };

/**
 * A pasted calendar link as the hub reads it: webcal:// becomes https://, only https to iCloud or Outlook, no
 * credentials in it, at most 2000 characters.
 */
export function readCalendarLink(input: unknown): LinkCheck {
  const text = typeof input === "string" ? input.trim() : "";
  if (!text) return { ok: false, error: "Bitte den Link des öffentlichen Kalenders einfügen." };
  if (text.length > 2000) return { ok: false, error: "Dieser Link ist zu lang für einen Kalender-Link." };
  let url: URL;
  try {
    url = new URL(text.replace(/^webcals?:\/\//i, "https://"));
  } catch {
    return { ok: false, error: "Das ist kein Link. Er beginnt mit webcal:// oder https://." };
  }
  if (url.protocol !== "https:") return { ok: false, error: "Der Link muss mit webcal:// oder https:// beginnen." };
  if (url.username || url.password) return { ok: false, error: "Der Link darf keine Anmeldedaten enthalten." };
  if (url.port && url.port !== "443") return { ok: false, error: "Diesen Link kann der Hub nicht lesen." };
  const provider = providerOfHost(url.hostname);
  if (!provider) return { ok: false, error: "Der Hub liest nur öffentliche Kalender aus iCloud und aus Outlook. Für Microsoft 365 nimm „Microsoft 365“." };
  url.hash = "";
  return { ok: true, url: url.toString(), provider };
}

/** Names are short and plain: „Privat“, „Familie“. */
export function readSourceName(input: unknown, fallback: string) {
  const text = typeof input === "string" ? input.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  return text || fallback;
}

export function readSourceRules(input: unknown): SourceRules {
  const raw = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return {
    ignoreAllDay: typeof raw.ignoreAllDay === "boolean" ? raw.ignoreAllDay : DEFAULT_SOURCE_RULES.ignoreAllDay,
    ignoreFree: typeof raw.ignoreFree === "boolean" ? raw.ignoreFree : DEFAULT_SOURCE_RULES.ignoreFree,
  };
}

const MAILBOX = /^[^\s@<>"'(),;:\\]+@[^\s@<>"'(),;:\\]+\.[^\s@<>"'(),;:\\]+$/;
export const readMailbox = (input: unknown) => {
  const text = typeof input === "string" ? input.trim().toLowerCase() : "";
  return text.length <= 254 && MAILBOX.test(text) ? text : null;
};

/* ---------- Microsoft 365 ---------- */

export type RuntimeEnv = Readonly<Record<string, string | undefined>>;
export type MicrosoftConfig = { tenant: string; client: string; secret: string };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/**
 * The app registration in Microsoft Entra ID that reads free/busy (Calendars.ReadBasic, limited to the team's mailboxes
 * in Exchange Online): tenant, client and secret from the server's environment, entered by an admin. Null while any is
 * missing or malformed; the source „Microsoft 365“ then stays off and the hub says so.
 */
export function microsoftConfig(env: RuntimeEnv): MicrosoftConfig | null {
  const tenant = env.HUB_MS365_TENANT_ID?.trim() ?? "";
  const client = env.HUB_MS365_CLIENT_ID?.trim() ?? "";
  const secret = env.HUB_MS365_CLIENT_SECRET?.trim() ?? "";
  if (!(GUID.test(tenant) || TENANT_DOMAIN.test(tenant)) || !GUID.test(client) || secret.length < 8) return null;
  return { tenant, client, secret };
}

/** The mailboxes to choose from: the admin's own address first, then the team's from HUB_MS365_MAILBOXES. */
export function microsoftMailboxes(env: RuntimeEnv, own: string | null) {
  const listed = (env.HUB_MS365_MAILBOXES ?? "").split(/[,;\s]+/).map(readMailbox).filter((value): value is string => Boolean(value));
  const ownBox = readMailbox(own);
  return [...new Set([...(ownBox ? [ownBox] : []), ...listed])].map((address) => ({ address, own: address === ownBox }));
}

/* ---------- What went wrong, in words ---------- */

/** The short codes a failed read leaves in last_error, and what the panel says about them. */
export const FETCH_ERRORS: Record<string, string> = {
  timeout: "Der Kalender hat nicht rechtzeitig geantwortet.",
  network: "Der Kalender war nicht erreichbar.",
  gone: "Den Kalender gibt es unter diesem Link nicht mehr. Ist er noch öffentlich?",
  denied: "Der Kalender lässt sich unter diesem Link nicht mehr lesen. Ist er noch öffentlich?",
  server: "Der Kalender-Dienst hatte einen Fehler.",
  "too-large": "Der Kalender ist zu groß zum Lesen.",
  "not-calendar": "Unter dem Link steht kein Kalender.",
  redirect: "Der Link leitet woandershin um, als der Hub lesen darf.",
  "no-key": "Auf dem Server fehlt der Schlüssel für die Verschlüsselung (HUB_VAULT_KEY).",
  "no-config": "Die Verbindung zu Microsoft 365 ist auf dem Server noch nicht eingerichtet.",
  "graph-auth": "Microsoft 365 hat die Anmeldung des Hubs abgelehnt. Stimmen Mandant, Client-ID und Geheimnis noch?",
  "graph-mailbox": "Microsoft 365 gibt dieses Postfach nicht frei. Liegt es im Bereich, den die App lesen darf?",
  graph: "Microsoft 365 hat die Abfrage nicht beantwortet.",
};
export const fetchErrorText = (code: string | null) => (code ? FETCH_ERRORS[code] ?? "Der Kalender konnte nicht gelesen werden." : "");

/** Where a source stands: new (never read yet), active, or failing. */
export function sourceState(source: Pick<SourceView, "lastSuccessAt" | "failingSince">): "new" | "ok" | "failing" {
  if (source.failingSince) return "failing";
  return source.lastSuccessAt ? "ok" : "new";
}

/** „seit 26 Stunden“, „seit 3 Tagen“, „seit wenigen Minuten“. */
export function failingFor(since: string, now: number) {
  const hours = Math.floor((now - Date.parse(since)) / 3_600_000);
  if (hours < 1) return "seit wenigen Minuten";
  if (hours < 48) return `seit ${hours} ${hours === 1 ? "Stunde" : "Stunden"}`;
  return `seit ${Math.floor(hours / 24)} Tagen`;
}
