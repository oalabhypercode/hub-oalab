import { createHash, randomBytes } from "node:crypto";
import { clip, compact, fold, icsText, meetingName, utc } from "./links";
import { FEED_FILE, FEED_FUTURE_MONTHS, FEED_LIMIT, FEED_PAST_DAYS, FEED_REFRESH, FEED_TOKEN, feedClient, type FeedClient, type FeedOptions, type FeedRole } from "./feed-rules";

export * from "./feed-rules";

/**
 * What the calendar subscription's address answers (app/api/calendar/feed/[token]/[file]) and its keys: every entry of
 * one feed for its role and choice, the calendar text with header, and the ETag. lib/hub-calendar/feed-store.ts keeps
 * the keys (only their SHA-256). Self-contained (node:crypto, links.ts and feed-rules.ts), so `node --test` checks it.
 */

const DAY = 86_400_000;
/** Descriptions stay short; the whole text is in the hub. */
const NOTE_LENGTH = 1000;

export const newFeedToken = () => randomBytes(32).toString("base64url");
/** What the database keeps of a key: its SHA-256 as hex. */
export const feedTokenHash = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

/* ---------- What the feed holds ---------- */

/** An appointment as the feed reads it with the person's rights; `company` only for admins (their entries say whose). */
export type FeedAppointment = {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  status: string;
  teamsUrl: string | null;
  updatedAt: string;
  company: string | null;
};
/** A project's target date. */
export type FeedGoal = { projectId: string; name: string; company: string; day: string; done: boolean };
/** A task with a due date; `customerTurn` for the label „Kunde“, `visible` when released to the customer. */
export type FeedTask = {
  id: string;
  number: number;
  title: string;
  day: string;
  projectName: string;
  company: string;
  done: boolean;
  customerTurn: boolean;
  visible: boolean;
  assigneeIds: string[];
};

export type FeedEvent = {
  uid: string;
  summary: string;
  description: string;
  location: string;
  url: string;
  /** UTC instants ("2026-11-06T10:00:00Z") or, all day, the days ("2026-11-06", end exclusive). */
  start: string;
  end: string;
  allDay: boolean;
  status: "CONFIRMED" | "TENTATIVE";
  sequence: number;
  /** When the entry last changed; it also stands as DTSTAMP, so an unchanged feed stays byte for byte the same. */
  stamp: string;
  alarm: boolean;
};

export type FeedInput = {
  role: FeedRole;
  options: FeedOptions;
  origin: string;
  now: number;
  /** The login the feed belongs to: „mir zugewiesen“. */
  viewerId: string;
  appointments: FeedAppointment[];
  goals?: FeedGoal[];
  tasks?: FeedTask[];
};

/** 90 days back to 12 months ahead. */
export function feedWindow(now: number) {
  const to = new Date(now);
  to.setUTCMonth(to.getUTCMonth() + FEED_FUTURE_MONTHS);
  return { from: now - FEED_PAST_DAYS * DAY, to: to.getTime() };
}

const isoDay = (instant: number) => new Date(instant).toISOString().slice(0, 10);
const nextDay = (day: string) => isoDay(Date.parse(`${day}T00:00:00Z`) + DAY);
const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
const changedAt = (value: string | null | undefined) => {
  const at = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(at) && at > 0 ? at : 0;
};

/** The calendar of the hub, where every entry links back. */
export const feedCalendarUrl = (origin: string, query: string) => `${origin}/dashboard/projects/calendar?${query}`;

/**
 * Every entry of one feed, earliest first and at most FEED_LIMIT (the oldest drop out first): confirmed appointments,
 * open requests (tentative, „Anfrage: …“) if wanted, project target dates and due tasks as all-day entries if wanted.
 * Cancelled and declined appointments are never in it, so they disappear with the next fetch. Customers and
 * freelancers read their entries with „· oalab“ as in the mail files, admins with the customer in front.
 */
export function feedEvents(input: FeedInput): FeedEvent[] {
  const { role, options, origin, now } = input;
  const admin = role === "admin";
  const window = feedWindow(now);
  const fromDay = isoDay(window.from);
  const toDay = isoDay(window.to);
  const named = (title: string, company: string | null | undefined) => admin ? (company ? `${company}: ${title}` : title) : `${title} · oalab`;
  const events: FeedEvent[] = [];

  for (const item of input.appointments) {
    const start = Date.parse(item.startsAt);
    const end = Date.parse(item.endsAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end <= window.from || start >= window.to) continue;
    const confirmed = item.status === "confirmed";
    // Open requests only while they lie ahead: a past one was never answered and means nothing any more.
    if (!confirmed && !(item.status === "requested" && options.requests && end > now)) continue;
    const url = feedCalendarUrl(origin, `appointment=${item.id}`);
    const notes = [
      confirmed ? "" : "Anfrage: noch nicht bestätigt.",
      item.teamsUrl ? `${meetingName(item.teamsUrl).meeting} beitreten:\n${item.teamsUrl}` : "",
      clip(item.description.trim(), NOTE_LENGTH),
      `Termin im oalab Client Hub:\n${url}`,
    ];
    const changed = changedAt(item.updatedAt);
    events.push({
      uid: `${item.id}@hub.oalab.de`,
      summary: `${confirmed ? "" : "Anfrage: "}${named(item.title, item.company)}`,
      description: notes.filter(Boolean).join("\n\n"),
      // The meeting link as the place too (decision 3): phones offer to join right from the entry.
      location: item.teamsUrl ?? "",
      url,
      start: utc(item.startsAt),
      end: utc(item.endsAt),
      allDay: false,
      status: confirmed ? "CONFIRMED" : "TENTATIVE",
      sequence: Math.floor(changed / 1000),
      stamp: utc(new Date(changed || start).toISOString()),
      alarm: confirmed,
    });
  }

  if (options.goals && role !== "freelancer") {
    for (const goal of input.goals ?? []) {
      if (goal.done || !validDay(goal.day) || goal.day < fromDay || goal.day > toDay) continue;
      const url = feedCalendarUrl(origin, `day=${goal.day}`);
      events.push(allDay({
        uid: `goal-${goal.projectId}@hub.oalab.de`,
        summary: admin ? `Ziel: ${goal.company ? `${goal.company}: ` : ""}${goal.name}` : `Ziel: ${goal.name} · oalab`,
        description: `Zieltermin des Projekts „${goal.name}“.\n\nIm oalab Client Hub:\n${url}`,
        url,
        day: goal.day,
      }));
    }
  }

  if (options.tasks && role !== "freelancer") {
    for (const task of input.tasks ?? []) {
      if (task.done || !validDay(task.day) || task.day < fromDay || task.day > toDay) continue;
      // Customers: only released tasks where they are to act. Admins: theirs, or all of them.
      if (role === "customer" && !(task.visible && task.customerTurn)) continue;
      if (admin && options.taskScope === "mine" && !task.assigneeIds.includes(input.viewerId)) continue;
      const url = feedCalendarUrl(origin, `day=${task.day}`);
      events.push(allDay({
        uid: `task-${task.id}@hub.oalab.de`,
        summary: admin ? `${task.company ? `${task.company}: ` : ""}#${task.number} ${task.title}` : `Aufgabe: ${task.title} · oalab`,
        description: `${admin ? `Fällig: #${task.number} in „${task.projectName}“.` : `Du bist am Zug: fällig in „${task.projectName}“.`}\n\nIm oalab Client Hub:\n${url}`,
        url,
        day: task.day,
      }));
    }
  }

  events.sort((a, b) => (a.allDay ? Date.parse(`${a.start}T00:00:00Z`) : Date.parse(a.start)) - (b.allDay ? Date.parse(`${b.start}T00:00:00Z`) : Date.parse(b.start)) || a.uid.localeCompare(b.uid));
  return events.length > FEED_LIMIT ? events.slice(events.length - FEED_LIMIT) : events;
}

/** All-day entries block no time (TRANSP:TRANSPARENT) and carry no reminder. */
function allDay(entry: { uid: string; summary: string; description: string; url: string; day: string }): FeedEvent {
  return {
    ...entry,
    location: "",
    start: entry.day,
    end: nextDay(entry.day),
    allDay: true,
    status: "CONFIRMED",
    sequence: 0,
    stamp: `${entry.day}T00:00:00Z`,
    alarm: false,
  };
}

const date = (day: string) => day.replace(/-/g, "");

/** One VEVENT: times in UTC, all-day entries as dates, a reminder 15 minutes before confirmed appointments. */
function vevent(event: FeedEvent) {
  return [
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${compact(event.stamp)}`,
    ...(event.allDay ? [] : [`LAST-MODIFIED:${compact(event.stamp)}`, `SEQUENCE:${event.sequence}`]),
    ...(event.allDay ? [`DTSTART;VALUE=DATE:${date(event.start)}`, `DTEND;VALUE=DATE:${date(event.end)}`] : [`DTSTART:${compact(event.start)}`, `DTEND:${compact(event.end)}`]),
    `SUMMARY:${icsText(event.summary)}`,
    ...(event.location ? [`LOCATION:${icsText(event.location)}`] : []),
    `DESCRIPTION:${icsText(event.description)}`,
    `URL:${event.url}`,
    `STATUS:${event.status}`,
    `TRANSP:${event.allDay ? "TRANSPARENT" : "OPAQUE"}`,
    ...(event.alarm ? ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(event.summary)}`, "TRIGGER:-PT15M", "END:VALARM"] : []),
    "END:VEVENT",
  ];
}

/** The whole feed: the calendar „oalab“ in Berlin time with the wish to be fetched every 15 minutes. */
export function feedCalendar(events: FeedEvent[]) {
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//oalab//Client Hub Kalender-Abo//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "NAME:oalab", "X-WR-CALNAME:oalab", "X-WR-CALDESC:Termine bei oalab aus dem Client Hub", "X-WR-TIMEZONE:Europe/Berlin",
    `REFRESH-INTERVAL;VALUE=DURATION:${FEED_REFRESH}`, `X-PUBLISHED-TTL:${FEED_REFRESH}`,
    ...events.flatMap(vevent),
    "END:VCALENDAR", "",
  ].map(fold).join("\r\n");
}

/** A strong ETag over the content: an unchanged feed answers 304. */
export const feedEtag = (body: string) => `"${createHash("sha256").update(body, "utf8").digest("hex").slice(0, 32)}"`;

/** Whether the client's If-None-Match names this ETag (also as a weak one, or `*`). */
export function etagMatches(header: string | null, etag: string) {
  if (!header) return false;
  return header.split(",").map((value) => value.trim().replace(/^W\//, "")).some((value) => value === etag || value === "*");
}

/* ---------- The answer of the feed's address ---------- */

/** One fetch as lib/hub-calendar/feed-store.ts takes it: whose feed, or why not. */
export type FeedFetch =
  | { ok: true; userId: string; role: FeedRole; options: FeedOptions }
  | { ok: false; reason: "unknown" }
  | { ok: false; reason: "limited"; retryAfter: number };

/** What the answer needs from the server: kept apart, so `node --test` checks the answer with stand-ins. */
export type FeedSources = {
  ready: boolean;
  take: (token: string, client: FeedClient) => Promise<FeedFetch>;
  body: (fetch: Extract<FeedFetch, { ok: true }>) => Promise<string | null>;
};

const BASE_HEADERS = { "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" };
const plainText = (status: number, body: string, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { ...BASE_HEADERS, "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8", ...extra } });

/**
 * GET and HEAD of /api/calendar/feed/<key>/oalab.ics without a session. A wrong, ended or malformed key gets the same
 * 404 as one that never existed; more than 60 fetches an hour 429; a database that cannot be read 503. Otherwise the
 * calendar with an ETag over its content, and 304 while the client already has it.
 */
export async function feedResponse(request: Request, token: string, file: string, head: boolean, sources: FeedSources): Promise<Response> {
  const notFound = () => plainText(404, "Nicht gefunden.");
  const unavailable = () => plainText(503, "Gerade nicht erreichbar. Bitte später erneut versuchen.", { "Retry-After": "300" });
  if (file !== FEED_FILE || !FEED_TOKEN.test(token) || !sources.ready) return notFound();
  const fetched = await sources.take(token, feedClient(request.headers.get("user-agent"))).catch(() => null);
  if (!fetched) return unavailable();
  if (!fetched.ok) return fetched.reason === "limited" ? plainText(429, "Zu viele Abrufe. Bitte später erneut versuchen.", { "Retry-After": String(fetched.retryAfter) }) : notFound();
  const body = await sources.body(fetched).catch(() => null);
  if (body === null) return unavailable();
  const etag = feedEtag(body);
  // Calendars keep their own copy: they ask again each time (no-cache) and get 304 while nothing changed.
  const cache = { "Cache-Control": "private, no-cache", ETag: etag };
  if (etagMatches(request.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers: { ...BASE_HEADERS, ...cache } });
  return new Response(head ? null : body, {
    headers: { ...BASE_HEADERS, ...cache, "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `inline; filename="${FEED_FILE}"` },
  });
}
