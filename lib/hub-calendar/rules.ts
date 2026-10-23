/**
 * Shared rules for the hub calendar: time zone math, working hours, occupancy,
 * free slots and Teams links. Self-contained (no imports) so client, server and tests use the same rules.
 * Days are "YYYY-MM-DD" and times "HH:MM" in Europe/Berlin; instants are epoch milliseconds.
 */

export const CALENDAR_TIME_ZONE = "Europe/Berlin";

/** Bookable hours of the OALAB calendar on weekdays; customers request appointments inside them. */
export const WORKDAY = { start: "09:00", end: "17:00" } as const;
export const SLOT_STEP_MINUTES = 30;
export const REQUEST_DURATIONS = [30, 45, 60, 90] as const;
export const APPOINTMENT_DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240, 480] as const;
export const MAX_OPEN_REQUESTS = 5;

export const appointmentStatuses = {
  requested: "Angefragt",
  confirmed: "Bestätigt",
  declined: "Abgelehnt",
  cancelled: "Abgesagt",
} as const;

export type AppointmentStatus = keyof typeof appointmentStatuses;
export const appointmentStatusIds = Object.keys(appointmentStatuses) as AppointmentStatus[];
export const isAppointmentStatus = (value: unknown): value is AppointmentStatus => typeof value === "string" && value in appointmentStatuses;

const MINUTE = 60_000;
const DAY_MS = 86_400_000;
const isoDay = /^(\d{4})-(\d{2})-(\d{2})$/;
const clock = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isDay = (value: unknown): value is string => typeof value === "string" && isoDay.test(value) && toDayUtc(value) !== null;
export const isClock = (value: unknown): value is string => typeof value === "string" && clock.test(value);

function toDayUtc(day: string) {
  const match = isoDay.exec(day);
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(time).toISOString().slice(0, 10) === day ? time : null;
}

const pad = (value: number) => String(value).padStart(2, "0");
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export const clockOf = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

const partsFormat = new Intl.DateTimeFormat("en-US", { timeZone: CALENDAR_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Wall clock in Berlin for an instant. */
export function zonedParts(time: number) {
  const parts = Object.fromEntries(partsFormat.formatToParts(time).map((part) => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Offset of Berlin from UTC at an instant, in milliseconds (+1 h in winter, +2 h in summer). */
function offsetAt(time: number) {
  const { day, time: wall } = zonedParts(time);
  return toDayUtc(day)! + minutesOf(wall) * MINUTE - Math.floor(time / MINUTE) * MINUTE;
}

/** Instant of a Berlin wall time; correct on both sides of the DST switches. */
export function wallTimeToUtc(day: string, time: string) {
  const guess = toDayUtc(day)! + minutesOf(time) * MINUTE;
  return guess - offsetAt(guess - offsetAt(guess));
}

export const dayOf = (time: number) => zonedParts(time).day;
export const timeOf = (time: number) => zonedParts(time).time;

export function addDays(day: string, days: number) {
  return new Date(toDayUtc(day)! + days * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday. */
export const weekdayIndex = (day: string) => (new Date(toDayUtc(day)!).getUTCDay() + 6) % 7;
export const isWorkday = (day: string) => weekdayIndex(day) < 5;

export const monthOf = (day: string) => day.slice(0, 7);
export function addMonths(month: string, months: number) {
  const [year, index] = [Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + months];
  return `${year + Math.floor(index / 12)}-${pad(((index % 12) + 12) % 12 + 1)}`;
}

/** Monday-first weeks covering a month ("YYYY-MM"), each with seven days. */
export function monthWeeks(month: string) {
  const first = `${month}-01`;
  const weeks: string[][] = [];
  for (let start = addDays(first, -weekdayIndex(first)); monthOf(start) <= month; start = addDays(start, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, index) => addDays(start, index)));
  }
  return weeks;
}

/** Months the calendar loads and lets you browse: the previous one up to five ahead. */
export function calendarWindow(today: string) {
  const firstMonth = addMonths(monthOf(today), -1);
  const lastMonth = addMonths(monthOf(today), 5);
  return {
    firstMonth,
    lastMonth,
    from: wallTimeToUtc(`${firstMonth}-01`, "00:00"),
    to: wallTimeToUtc(`${addMonths(lastMonth, 1)}-01`, "00:00"),
  };
}

export type Interval = { start: number; end: number };

/** Sorted, merged intervals clipped to [from, to]. */
export function mergeIntervals(intervals: Interval[], from = -Infinity, to = Infinity) {
  const clipped = intervals
    .map(({ start, end }) => ({ start: Math.max(start, from), end: Math.min(end, to) }))
    .filter(({ start, end }) => end > start)
    .sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const item of clipped) {
    const last = merged.at(-1);
    if (last && item.start <= last.end) last.end = Math.max(last.end, item.end);
    else merged.push({ ...item });
  }
  return merged;
}

export function workWindow(day: string): Interval | null {
  return isWorkday(day) ? { start: wallTimeToUtc(day, WORKDAY.start), end: wallTimeToUtc(day, WORKDAY.end) } : null;
}

export type OccupancyLevel = "closed" | "free" | "some" | "busy" | "full";

export const occupancyLabels: Record<OccupancyLevel, string> = {
  closed: "Kein Termintag",
  free: "Frei",
  some: "Gut verfügbar",
  busy: "Stark belegt",
  full: "Ausgebucht",
};

/** How much of a day's working hours is booked. */
export function occupancy(day: string, busy: Interval[]) {
  const window = workWindow(day);
  if (!window) return { bookedMinutes: 0, totalMinutes: 0, ratio: 0, level: "closed" as OccupancyLevel };
  const totalMinutes = (window.end - window.start) / MINUTE;
  const bookedMinutes = mergeIntervals(busy, window.start, window.end).reduce((sum, item) => sum + (item.end - item.start) / MINUTE, 0);
  const ratio = bookedMinutes / totalMinutes;
  const level: OccupancyLevel = ratio >= 0.999 ? "full" : ratio >= 0.6 ? "busy" : ratio > 0 ? "some" : "free";
  return { bookedMinutes, totalMinutes, ratio, level };
}

/** Free parts of a day's working hours, from `now` on. */
export function freeIntervals(day: string, busy: Interval[], now: number) {
  const window = workWindow(day);
  if (!window || window.end <= now) return [];
  const from = Math.max(window.start, now);
  const free: Interval[] = [];
  let cursor = from;
  for (const item of mergeIntervals(busy, from, window.end)) {
    if (item.start > cursor) free.push({ start: cursor, end: item.start });
    cursor = Math.max(cursor, item.end);
  }
  if (cursor < window.end) free.push({ start: cursor, end: window.end });
  return free;
}

/** Start times ("HH:MM", on the slot grid) at which an appointment of `minutes` fits into the free time. */
export function slotStarts(day: string, busy: Interval[], minutes: number, now: number) {
  const window = workWindow(day);
  if (!window) return [];
  const starts: string[] = [];
  for (const free of freeIntervals(day, busy, now)) {
    const offset = Math.ceil((free.start - window.start) / (SLOT_STEP_MINUTES * MINUTE)) * SLOT_STEP_MINUTES * MINUTE;
    for (let start = window.start + offset; start + minutes * MINUTE <= free.end; start += SLOT_STEP_MINUTES * MINUTE) starts.push(timeOf(start));
  }
  return starts;
}

export const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/** Hosts of Microsoft Teams meeting links (work, personal, new cloud domain, US government clouds). */
export const teamsHosts = ["teams.microsoft.com", "teams.live.com", "teams.cloud.microsoft", "gov.teams.microsoft.us", "dod.teams.microsoft.us"] as const;
export const MAX_TEAMS_URL_LENGTH = 2048;

export function isTeamsUrl(value: string) {
  if (value.length > MAX_TEAMS_URL_LENGTH) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && (teamsHosts as readonly string[]).includes(url.hostname) && url.pathname.length > 1;
  } catch {
    return false;
  }
}

/** Empty input clears the link; anything else must be a Teams meeting link. */
export function cleanTeamsUrl(value: unknown): { ok: true; url: string | null } | { ok: false; error: string } {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return { ok: true, url: null };
  return isTeamsUrl(text) ? { ok: true, url: text } : { ok: false, error: "Bitte einen Microsoft-Teams-Link einfügen (https://teams.microsoft.com/…)." };
}

export type SlotInput = { day: unknown; start: unknown; minutes: unknown };
export type SlotCheck = { ok: true; interval: Interval } | { ok: false; error: string };

function readSlot(input: SlotInput, durations: readonly number[]): SlotCheck {
  if (!isDay(input.day) || !isClock(input.start)) return { ok: false, error: "Bitte Datum und Uhrzeit angeben." };
  const minutes = Number(input.minutes);
  if (!durations.includes(minutes)) return { ok: false, error: "Bitte eine gültige Dauer wählen." };
  const start = wallTimeToUtc(input.day, input.start);
  return { ok: true, interval: { start, end: start + minutes * MINUTE } };
}

/** Admin appointments: any day and time, at most twelve hours long. */
export function checkAppointmentSlot(input: SlotInput): SlotCheck {
  return readSlot(input, APPOINTMENT_DURATIONS);
}

/** Customer requests: in the future, inside the working hours, not overlapping a booked appointment. */
export function checkRequestSlot(input: SlotInput, busy: Interval[], now: number): SlotCheck {
  const slot = readSlot(input, REQUEST_DURATIONS);
  if (!slot.ok) return slot;
  const window = workWindow(input.day as string);
  if (!window) return { ok: false, error: "Termine sind montags bis freitags möglich." };
  if (slot.interval.start < window.start || slot.interval.end > window.end) return { ok: false, error: `Termine sind zwischen ${WORKDAY.start} und ${WORKDAY.end} Uhr möglich.` };
  if (slot.interval.start <= now) return { ok: false, error: "Dieser Zeitpunkt liegt in der Vergangenheit." };
  if (busy.some((item) => overlaps(item, slot.interval))) return { ok: false, error: "Zu dieser Zeit ist der Kalender schon belegt. Bitte einen freien Zeitraum wählen." };
  return slot;
}

const text = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

export type AppointmentFields = { title: string; description: string; customerId: string | null; interval: Interval; teamsUrl: string | null };
export type FieldsCheck = { ok: true; value: AppointmentFields } | { ok: false; error: string };
type FormInput = { title?: unknown; description?: unknown; customerId?: unknown; day?: unknown; start?: unknown; minutes?: unknown; teamsUrl?: unknown };

/** Admin appointment form: title, slot, optional customer and Teams link. */
export function readAppointmentInput(input: FormInput): FieldsCheck {
  const title = text(input?.title, 200);
  if (!title) return { ok: false, error: "Bitte einen Titel angeben." };
  const slot = checkAppointmentSlot({ day: input?.day, start: input?.start, minutes: input?.minutes });
  if (!slot.ok) return slot;
  const teams = cleanTeamsUrl(input?.teamsUrl);
  if (!teams.ok) return teams;
  const customerId = typeof input?.customerId === "string" && input.customerId ? input.customerId : null;
  return { ok: true, value: { title, description: text(input?.description, 2000), customerId, interval: slot.interval, teamsUrl: teams.url } };
}

/** Customer request form: topic, optional message and a free slot inside the working hours. */
export function readRequestInput(input: FormInput, busy: Interval[], now: number): FieldsCheck {
  const title = text(input?.title, 200);
  if (!title) return { ok: false, error: "Bitte ein Thema angeben." };
  const slot = checkRequestSlot({ day: input?.day, start: input?.start, minutes: input?.minutes }, busy, now);
  if (!slot.ok) return slot;
  return { ok: true, value: { title, description: text(input?.description, 2000), customerId: null, interval: slot.interval, teamsUrl: null } };
}

export const cleanNote = (value: unknown) => text(value, 1000);

const dayLong = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
const dayShort = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const monthLong = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", month: "long", year: "numeric" });

export const formatDayLong = (day: string) => dayLong.format(toDayUtc(day)!);
export const formatDayShort = (day: string) => dayShort.format(toDayUtc(day)!);
export const formatMonth = (month: string) => monthLong.format(toDayUtc(`${month}-01`)!);
export const formatTimeRange = ({ start, end }: Interval) => `${timeOf(start)}–${timeOf(end)} Uhr`;

export function formatHours(minutes: number) {
  const hours = minutes / 60;
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(hours)} Std.`;
}
