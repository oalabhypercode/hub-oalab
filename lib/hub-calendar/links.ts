import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * "In deinen Kalender eintragen" in the notification mails: Apple Kalender and every other calendar app get an .ics
 * file, Google and Outlook a filled-in new event. The mail only carries signed links into the hub
 * (app/api/calendar/[id]/[target]); the hub reads the appointment when a link is opened, so a moved appointment
 * lands with its new time and a cancelled one not at all. Self-contained (only node:crypto), so `node --test` checks
 * it directly.
 */

export type CalendarTarget = "ics" | "google" | "outlook";
export type CalendarLinks = Record<CalendarTarget, string>;

/** An appointment row as the links read it. */
export type CalendarAppointment = {
  id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  teams_url: string | null;
  updated_at: string;
};

export type CalendarEvent = {
  uid: string;
  summary: string;
  description: string;
  location: string;
  /** UTC, "2026-11-06T10:00:00Z": every calendar app shows it in its own time zone. */
  start: string;
  end: string;
  url: string;
  sequence: number;
  stamp: string;
};

/** The .ics link ends in the file name, so phones and browsers recognise the file from the address as well. */
export const ICS_FILE = "oalab-termin.ics";
const targets = new Map<string, CalendarTarget>([[ICS_FILE, "ics"], ["google", "google"], ["outlook", "outlook"]]);
export const calendarTarget = (segment: string) => targets.get(segment) ?? null;

/** The links are signed with the notification token: they belong to the notification mails, no further key needed. */
export const calendarLinkSecret = () => process.env.HUB_NOTIFY_TOKEN?.trim() || null;

/** 132 bits of an HMAC over the appointment; the prefix keeps it apart from any other use of the token. */
export function calendarSignature(appointmentId: string, secret: string) {
  return createHmac("sha256", secret).update(`hub-calendar-link:${appointmentId}`).digest("base64url").slice(0, 22);
}

export function validCalendarSignature(appointmentId: string, signature: string, secret: string) {
  const expected = Buffer.from(calendarSignature(appointmentId, secret));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function calendarLinks(origin: string, appointmentId: string, secret: string): CalendarLinks {
  const base = `${origin}/api/calendar/${appointmentId}`;
  const query = `?sig=${calendarSignature(appointmentId, secret)}`;
  return { ics: `${base}/${ICS_FILE}${query}`, google: `${base}/google${query}`, outlook: `${base}/outlook${query}` };
}

const utc = (value: string) => new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");
const clip = (value: string, length: number) => value.length > length ? `${value.slice(0, length - 1).trimEnd()}…` : value;
/** Notes stay short enough for the address of the Google and Outlook links; the whole text is in the hub. */
const NOTE_LENGTH = 1000;

/** What lands in the private calendar: title with "oalab", the time, the Teams link and the way back into the hub. */
export function calendarEvent(appointment: CalendarAppointment, origin: string, now: Date): CalendarEvent {
  const url = `${origin}/dashboard/calendar`;
  const notes = [
    appointment.teams_url ? `Teams-Besprechung beitreten:\n${appointment.teams_url}` : "",
    clip(appointment.description.trim(), NOTE_LENGTH),
    `Termin im oalab Client Hub:\n${url}`,
  ];
  // A later save gives a higher number, so calendar apps can tell an update of the same appointment.
  const changed = Math.floor(Date.parse(appointment.updated_at) / 1000);
  return {
    uid: `${appointment.id}@hub.oalab.de`,
    summary: `${appointment.title} · oalab`,
    description: notes.filter(Boolean).join("\n\n"),
    location: appointment.teams_url ? "Microsoft Teams" : "",
    start: utc(appointment.starts_at),
    end: utc(appointment.ends_at),
    url,
    sequence: Number.isFinite(changed) && changed > 0 ? changed : 0,
    stamp: utc(now.toISOString()),
  };
}

/** 2026-11-06T10:00:00Z → 20261106T100000Z */
const compact = (value: string) => value.replace(/[-:]/g, "");

export function googleCalendarUrl(event: CalendarEvent) {
  const query = [
    "action=TEMPLATE", `text=${encodeURIComponent(event.summary)}`, `dates=${compact(event.start)}/${compact(event.end)}`,
    `details=${encodeURIComponent(event.description)}`, `location=${encodeURIComponent(event.location)}`, "ctz=Europe%2FBerlin",
  ];
  return `https://calendar.google.com/calendar/render?${query.join("&")}`;
}

/** Outlook in the browser (Microsoft 365); its notes are HTML, so line breaks become <br>. */
export function outlookCalendarUrl(event: CalendarEvent) {
  const body = event.description.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  const query = [
    "rru=addevent", `subject=${encodeURIComponent(event.summary)}`, `startdt=${encodeURIComponent(event.start)}`,
    `enddt=${encodeURIComponent(event.end)}`, `body=${encodeURIComponent(body)}`, `location=${encodeURIComponent(event.location)}`,
  ];
  return `https://outlook.office.com/calendar/action/compose?${query.join("&")}`;
}

/** Text values of an .ics file: backslash, semicolon, comma and line breaks are escaped. */
const icsText = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines longer than 75 bytes continue on the next line after a space (RFC 5545), never inside a character. */
function fold(line: string) {
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = Buffer.byteLength(char);
    if (size + bytes > 75) {
      parts.push(current);
      current = " ";
      size = 1;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n");
}

/** One event to add (METHOD:PUBLISH, so no invitation and no reply), with a reminder 15 minutes before. */
export function icsCalendar(event: CalendarEvent) {
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//oalab//Client Hub//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`, `DTSTAMP:${compact(event.stamp)}`, `SEQUENCE:${event.sequence}`,
    `DTSTART:${compact(event.start)}`, `DTEND:${compact(event.end)}`,
    `SUMMARY:${icsText(event.summary)}`,
    ...(event.location ? [`LOCATION:${icsText(event.location)}`] : []),
    `DESCRIPTION:${icsText(event.description)}`, `URL:${event.url}`,
    "STATUS:CONFIRMED", "TRANSP:OPAQUE",
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(event.summary)}`, "TRIGGER:-PT15M", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR", "",
  ].map(fold).join("\r\n");
}
