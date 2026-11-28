/**
 * The calendar subscription („Kalender-Abo“, plan „Kalender des Hubs mit Apple Kalender synchron halten“, stage 1,
 * 22.11.2026): the rules and words the hub's pages share with the server, what each role may put into a feed, its
 * addresses and how its status reads. No imports, so the browser loads it without node:crypto and `node --test` checks
 * it directly. What the address answers is built in lib/hub-calendar/feed.ts.
 */

export type FeedRole = "admin" | "customer" | "freelancer";
export type TaskScope = "mine" | "all";
/** What is in the feed besides the confirmed appointments, which always are. */
export type FeedOptions = { requests: boolean; goals: boolean; tasks: boolean; taskScope: TaskScope };
/** The kind of program that fetched last, from its User-Agent (nothing else of it is kept). */
export type FeedClient = "apple" | "google" | "microsoft" | "other";

/** Standard when a feed is created (decision 2): confirmed appointments and open requests. */
export const DEFAULT_FEED_OPTIONS: FeedOptions = { requests: true, goals: false, tasks: false, taskScope: "mine" };
export const FEED_FILE = "oalab.ics";
/** 32 random bytes as base64url. */
export const FEED_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const FEED_PAST_DAYS = 90;
export const FEED_FUTURE_MONTHS = 12;
export const FEED_LIMIT = 2000;
export const FEED_FETCHES_PER_HOUR = 60;
/** A feed nobody fetched for this long ends by itself. */
export const FEED_IDLE_DAYS = 180;
/** The wish for how often to fetch (RFC 7986 and the older X-PUBLISHED-TTL); Apple does not document whether it listens. */
export const FEED_REFRESH = "PT15M";

export const feedRoleOf = (hubRole: unknown): FeedRole | null =>
  hubRole === "oalab_admin" ? "admin" : hubRole === "oalab_freelancer" ? "freelancer" : hubRole === "oalab_customer" ? "customer" : null;

/** A stored or sent choice, cleaned for the role: freelancers get only appointments and requests (4.1). */
export function feedOptionsFor(role: FeedRole, value: unknown): FeedOptions {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const flag = (key: "requests" | "goals" | "tasks", fallback: boolean) => typeof raw[key] === "boolean" ? raw[key] as boolean : fallback;
  return {
    requests: flag("requests", DEFAULT_FEED_OPTIONS.requests),
    goals: role !== "freelancer" && flag("goals", false),
    tasks: role !== "freelancer" && flag("tasks", false),
    taskScope: role === "admin" && raw.taskScope === "all" ? "all" : "mine",
  };
}

/** „Bestätigte Termine, offene Anfragen, Projektziele“ for the profile card. */
export function feedContents(role: FeedRole, options: FeedOptions) {
  const parts = ["Bestätigte Termine"];
  if (options.requests) parts.push("offene Anfragen");
  if (role !== "freelancer" && options.goals) parts.push("Projektziele");
  if (role === "admin" && options.tasks) parts.push(options.taskScope === "all" ? "alle Aufgaben mit Fälligkeit" : "deine Aufgaben mit Fälligkeit");
  if (role === "customer" && options.tasks) parts.push("Aufgaben, bei denen du am Zug bist");
  return parts.join(", ");
}

/* ---------- Keys and addresses ---------- */


export const feedPath = (token: string) => `/api/calendar/feed/${token}/${FEED_FILE}`;
export const feedUrl = (origin: string, token: string) => `${origin}${feedPath(token)}`;
/** The same address for „Kalenderabo hinzufügen“: Apple's apps open webcal:// links themselves. */
export const webcalUrl = (url: string) => url.replace(/^https?:\/\//i, "webcal://");
/** Google Kalender's „Per URL hinzufügen“ with the address filled in (undocumented but long-standing `cid`). */
export const googleSubscribeUrl = (url: string) => `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl(url))}`;
/** Outlook (Microsoft 365) „Aus dem Web abonnieren“ with the address and the name filled in. */
export const outlookSubscribeUrl = (url: string) => `https://outlook.office.com/calendar/0/addfromweb?url=${encodeURIComponent(url)}&name=oalab`;

/** Only the kind of program, from its User-Agent; Microsoft and Google first, since Outlook on a Mac names the Mac too. */
export function feedClient(userAgent: string | null | undefined): FeedClient {
  const agent = (userAgent ?? "").toLowerCase();
  if (/google/.test(agent)) return "google";
  if (/microsoft|outlook|exchange|office/.test(agent)) return "microsoft";
  if (/calendaragent|dataaccessd|icloud|ical|apple|mac ?os|macintosh|iphone|ipad|ios\//.test(agent)) return "apple";
  return "other";
}

export const FEED_CLIENT_NAMES: Record<FeedClient, string> = { apple: "Apple Kalender", google: "Google Kalender", microsoft: "Outlook", other: "anderes Programm" };

/** „gerade eben“, „vor 6 Minuten“, „vor 2 Stunden“, „vor 3 Tagen“; „noch nie“ without a fetch. */
export function fetchedAgo(at: string | null, now: number) {
  if (!at) return "noch nie";
  const minutes = Math.max(0, Math.floor((now - Date.parse(at)) / 60_000));
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} ${minutes === 1 ? "Minute" : "Minuten"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} ${hours === 1 ? "Stunde" : "Stunden"}`;
  const days = Math.floor(hours / 24);
  return `vor ${days} ${days === 1 ? "Tag" : "Tagen"}`;
}
