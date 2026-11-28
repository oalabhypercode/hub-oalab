/**
 * Shared rules for the hub calendar: time zone math, the availability oalab sets (weekly plan, exceptions, rules),
 * free times and meeting links. Self-contained (no imports) so client, server and tests use the same rules; the database
 * checks requests with the same rules again (service-oalab, hub_calendar_request_allowed).
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

export const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/*
 * Meeting links (27.11.2026): an appointment carries a link to Microsoft Teams, Zoom or Google Meet. The link decides
 * the provider, its mark and the name on the join button. The database allows the same hosts
 * (service-oalab 202611270004_hub_meeting_links); the field keeps its first name `teamsUrl` / `teams_url`.
 */
export type MeetingProvider = "teams" | "zoom" | "meet";
export const MEETING_PROVIDERS: Record<MeetingProvider, { name: string; short: string; meeting: string }> = {
  teams: { name: "Microsoft Teams", short: "Teams", meeting: "Teams-Meeting" },
  zoom: { name: "Zoom", short: "Zoom", meeting: "Zoom-Meeting" },
  meet: { name: "Google Meet", short: "Meet", meeting: "Google Meet" },
};

/** Hosts of Microsoft Teams meeting links (work, personal, new cloud domain, US government clouds). */
export const teamsHosts = ["teams.microsoft.com", "teams.live.com", "teams.cloud.microsoft", "gov.teams.microsoft.us", "dod.teams.microsoft.us"] as const;
/** Zoom's domains; meetings come from any subdomain of them (us02web.zoom.us, firma.zoom.us …). */
export const zoomDomains = ["zoom.us", "zoom.com", "zoomgov.com"] as const;
export const meetHosts = ["meet.google.com"] as const;
export const MAX_MEETING_URL_LENGTH = 2048;

/** The provider of a meeting link: https only, a known host, no login or port, and a path behind the host. */
export function meetingProvider(value: string | null | undefined): MeetingProvider | null {
  if (!value || value.length > MAX_MEETING_URL_LENGTH) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname.length <= 1) return null;
    const host = url.hostname;
    if ((teamsHosts as readonly string[]).includes(host)) return "teams";
    if (zoomDomains.some((domain) => host === domain || host.endsWith(`.${domain}`))) return "zoom";
    if ((meetHosts as readonly string[]).includes(host)) return "meet";
    return null;
  } catch {
    return null;
  }
}

export const isMeetingUrl = (value: string) => meetingProvider(value) !== null;

/** The provider's name for a link („Zoom“), or null without a known link. */
export function meetingLabel(value: string | null | undefined) {
  const provider = meetingProvider(value);
  return provider ? MEETING_PROVIDERS[provider].name : null;
}

/** Empty input clears the link; anything else must be a meeting link of Teams, Zoom or Google Meet. */
export function cleanMeetingUrl(value: unknown): { ok: true; url: string | null } | { ok: false; error: string } {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return { ok: true, url: null };
  return meetingProvider(text) ? { ok: true, url: text } : { ok: false, error: "Bitte einen Meeting-Link aus Microsoft Teams, Zoom oder Google Meet einfügen (https://…)." };
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

const text = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

export type AppointmentFields = { title: string; description: string; customerId: string | null; interval: Interval; teamsUrl: string | null };
export type FieldsCheck = { ok: true; value: AppointmentFields } | { ok: false; error: string };
type FormInput = { title?: unknown; description?: unknown; customerId?: unknown; day?: unknown; start?: unknown; minutes?: unknown; teamsUrl?: unknown };

/** Admin appointment form: title, slot, optional customer and meeting link. */
export function readAppointmentInput(input: FormInput): FieldsCheck {
  const title = text(input?.title, 200);
  if (!title) return { ok: false, error: "Bitte einen Titel angeben." };
  const slot = checkAppointmentSlot({ day: input?.day, start: input?.start, minutes: input?.minutes });
  if (!slot.ok) return slot;
  const teams = cleanMeetingUrl(input?.teamsUrl);
  if (!teams.ok) return teams;
  const customerId = typeof input?.customerId === "string" && input.customerId ? input.customerId : null;
  return { ok: true, value: { title, description: text(input?.description, 2000), customerId, interval: slot.interval, teamsUrl: teams.url } };
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

export const formatDuration = (minutes: number) => minutes < 60 ? `${minutes} Min.` : `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(minutes / 60)} Std.`;

/* ---------- The calendar's views (Kalender unter Projekte, 16.11.2026): month, week, day, list ---------- */

export const CALENDAR_VIEWS = ["month", "week", "day", "list"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];
export const isCalendarView = (value: unknown): value is CalendarView => typeof value === "string" && (CALENDAR_VIEWS as readonly string[]).includes(value);
/** How many days the list view shows from its first day. */
export const LIST_DAYS = 28;

export const mondayOf = (day: string) => addDays(day, -weekdayIndex(day));
export const weekDays = (day: string) => Array.from({ length: 7 }, (_, index) => addDays(mondayOf(day), index));

/** ISO week number ("KW 47"): the week belongs to the year of its Thursday. */
export function isoWeek(day: string) {
  const thursday = addDays(day, 3 - weekdayIndex(day));
  const january4 = `${thursday.slice(0, 4)}-01-04`;
  const firstThursday = addDays(january4, 3 - weekdayIndex(january4));
  return 1 + Math.round((toDayUtc(thursday)! - toDayUtc(firstThursday)!) / (7 * DAY_MS));
}

/** The days a view shows around its anchor day: the month's weeks, the week, the day, or four weeks of list. */
export function viewDays(view: CalendarView, day: string): string[] {
  if (view === "month") return monthWeeks(monthOf(day)).flat();
  if (view === "week") return weekDays(day);
  if (view === "day") return [day];
  return Array.from({ length: LIST_DAYS }, (_, index) => addDays(day, index));
}

/** The anchor day one step back or forward: a month, a week, a day or the list's four weeks. */
export function stepDay(view: CalendarView, day: string, direction: 1 | -1, today: string) {
  if (view === "month") {
    const month = addMonths(monthOf(day), direction);
    return month === monthOf(today) ? today : `${month}-01`;
  }
  return addDays(day, direction * (view === "week" ? 7 : view === "day" ? 1 : LIST_DAYS));
}

/** Wall-clock minutes of an instant on `day`, clamped to that day (an appointment over midnight ends at 24:00). */
export function minutesOn(day: string, time: number) {
  const other = dayOf(time);
  return other < day ? 0 : other > day ? 24 * 60 : minutesOf(timeOf(time));
}

/**
 * Side-by-side lanes for overlapping appointments of one day, sorted by start: each gets the first free lane, and every
 * appointment of a group that overlaps knows how many lanes the group needs.
 */
export function layoutLanes<T extends Interval>(items: readonly T[]): (T & { lane: number; lanes: number })[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const placed: (T & { lane: number; lanes: number })[] = [];
  let group: (T & { lane: number; lanes: number })[] = [];
  let groupEnd = -Infinity;
  const close = () => { const lanes = Math.max(1, ...group.map((item) => item.lane + 1)); group.forEach((item) => { item.lanes = lanes; }); group = []; };
  for (const item of sorted) {
    if (group.length && item.start >= groupEnd) close();
    const taken = new Set(group.filter((other) => other.end > item.start).map((other) => other.lane));
    let lane = 0;
    while (taken.has(lane)) lane += 1;
    const entry = { ...item, lane, lanes: 1 };
    group.push(entry);
    placed.push(entry);
    groupEnd = Math.max(groupEnd, item.end);
  }
  if (group.length) close();
  return placed;
}

/* ---------- Availability (Kalender, Schritt 2, 16.11.2026): when oalab offers appointments ---------- */

/** Part of a day in minutes after midnight (Berlin wall time), on the quarter hour; 1440 is the midnight that ends it. */
export type DaySpan = [number, number];
/** Monday … Sunday, each a sorted list of spans. */
export type WeekPlan = DaySpan[][];
export type ExceptionKind = "off" | "extra";
/** One day: absent (the whole day when from is null, else a span) or extra time. The note is for the team only. */
export type AvailabilityException = { id: string; day: string; kind: ExceptionKind; from: number | null; to: number | null; note: string };
/** Lead time and buffer in minutes, the horizon in weeks, the durations customers choose from. */
export type AvailabilityRules = { notice: number; buffer: number; horizon: number; durations: number[] };
export type Availability = { week: WeekPlan; exceptions: AvailabilityException[]; rules: AvailabilityRules };

export const SPAN_STEP = 15;
export const MAX_SPANS_PER_DAY = 8;
export const MAX_EXCEPTION_NOTE = 80;
/** Most days one absence may cover (a holiday of several weeks). */
export const MAX_EXCEPTION_DAYS = 62;
export const NOTICE_OPTIONS = [0, 120, 240, 720, 1440, 2880, 10080] as const;
export const BUFFER_OPTIONS = [0, 10, 15, 30] as const;
export const HORIZON_OPTIONS = [2, 4, 8, 12, 26] as const;
export const DURATION_CHOICES = [15, 30, 45, 60, 90, 120] as const;
export const WEEKDAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;
export const WEEKDAY_LONG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"] as const;

const workdaySpans = (): WeekPlan => WEEKDAY_SHORT.map((_, index) => index < 5 ? [[minutesOf(WORKDAY.start), minutesOf(WORKDAY.end)]] : []);
/** Before the database knows the availability (migration not yet applied): the fixed hours as before, nothing else. */
export const FIXED_AVAILABILITY: Availability = { week: workdaySpans(), exceptions: [], rules: { notice: 0, buffer: 0, horizon: 26, durations: [...REQUEST_DURATIONS] } };
/** What a new database starts with (the migration's defaults): the fixed hours plus the rules of the approved preview. */
export const DEFAULT_AVAILABILITY: Availability = { week: workdaySpans(), exceptions: [], rules: { notice: 1440, buffer: 15, horizon: 8, durations: [...REQUEST_DURATIONS] } };

/** Sorted spans, overlapping and touching ones joined. */
export function mergeSpans(spans: readonly DaySpan[]): DaySpan[] {
  const sorted = spans.filter(([from, to]) => to > from).map(([from, to]): DaySpan => [from, to]).sort((a, b) => a[0] - b[0]);
  const merged: DaySpan[] = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push(span);
  }
  return merged;
}

/** `spans` without `cut`. */
export function subtractSpans(spans: readonly DaySpan[], cut: readonly DaySpan[]): DaySpan[] {
  let result = mergeSpans(spans);
  for (const [from, to] of mergeSpans(cut)) {
    result = result.flatMap(([a, b]): DaySpan[] => b <= from || a >= to ? [[a, b]] : [...(a < from ? [[a, from] as DaySpan] : []), ...(b > to ? [[to, b] as DaySpan] : [])]);
  }
  return result;
}

export const spanMinutes = (spans: readonly DaySpan[]) => mergeSpans(spans).reduce((sum, [from, to]) => sum + to - from, 0);
export const exceptionsOn = (availability: Availability, day: string) => availability.exceptions.filter((item) => item.day === day);
/** The whole-day absence of a day, if there is one. */
export const dayOff = (availability: Availability, day: string) => exceptionsOn(availability, day).find((item) => item.kind === "off" && item.from === null) ?? null;

/** The spans of a day in which oalab offers appointments: the weekly plan plus extra time, minus absences. */
export function availableSpans(availability: Availability, day: string): DaySpan[] {
  if (!isDay(day) || dayOff(availability, day)) return [];
  const list = exceptionsOn(availability, day);
  const span = (item: AvailabilityException): DaySpan[] => item.from === null || item.to === null ? [] : [[item.from, item.to]];
  const base = mergeSpans([...(availability.week[weekdayIndex(day)] ?? []), ...list.filter((item) => item.kind === "extra").flatMap(span)]);
  return subtractSpans(base, list.filter((item) => item.kind === "off").flatMap(span));
}

/** Instant of a wall-clock minute of a day; 1440 is the midnight after it. Right on the days the clocks change. */
export const wallMinuteToUtc = (day: string, minute: number) => minute >= 1440 ? wallTimeToUtc(addDays(day, 1), "00:00") : wallTimeToUtc(day, clockOf(minute));
export const spanInterval = (day: string, [from, to]: DaySpan): Interval => ({ start: wallMinuteToUtc(day, from), end: wallMinuteToUtc(day, to) });
export const availableIntervals = (availability: Availability, day: string) => availableSpans(availability, day).map((span) => spanInterval(day, span));

/** `intervals` without `cut`, both as instants. */
export function subtractIntervals(intervals: readonly Interval[], cut: readonly Interval[]) {
  let result = mergeIntervals([...intervals]);
  for (const item of mergeIntervals([...cut])) {
    result = result.flatMap((free) => free.end <= item.start || free.start >= item.end ? [free]
      : [...(free.start < item.start ? [{ start: free.start, end: item.start }] : []), ...(free.end > item.end ? [{ start: item.end, end: free.end }] : [])]);
  }
  return result;
}

/** What oalab still has free on a day: the availability minus booked appointments, nothing in the past. */
export function adminFree(availability: Availability, day: string, busy: readonly Interval[], now: number) {
  return subtractIntervals(availableIntervals(availability, day), [...busy, { start: -Infinity, end: now }]);
}

/** The last day customers may request: today plus the horizon. */
export const lastRequestDay = (availability: Availability, today: string) => addDays(today, availability.rules.horizon * 7);

/**
 * What a customer may request on a day: the availability minus booked times with the buffer around them and minus
 * their own open requests, not before now plus the lead time and not after the horizon. Pieces under 15 minutes go.
 */
export function customerFree(availability: Availability, day: string, busy: readonly Interval[], own: readonly Interval[], now: number, today: string) {
  if (!isDay(day) || day > lastRequestDay(availability, today)) return [];
  const buffer = availability.rules.buffer * MINUTE;
  const blocked = [...busy.map(({ start, end }) => ({ start: start - buffer, end: end + buffer })), ...own, { start: -Infinity, end: now + availability.rules.notice * MINUTE }];
  return subtractIntervals(availableIntervals(availability, day), blocked).filter((item) => item.end - item.start >= SPAN_STEP * MINUTE);
}

/** Start times ("HH:MM", every half hour on the clock) at which `minutes` fit into the free intervals of a day. */
export function startsIn(day: string, free: readonly Interval[], minutes: number) {
  const starts: string[] = [];
  for (const item of free) {
    const from = minutesOn(day, item.start);
    const to = minutesOn(day, item.end);
    for (let start = Math.ceil(from / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES; start + minutes <= to; start += SLOT_STEP_MINUTES) starts.push(clockOf(start));
  }
  return starts;
}

/** "ohne Vorlauf", "2 Std.", "1 Tag", "7 Tage". */
export function formatNotice(minutes: number) {
  if (minutes <= 0) return "ohne Vorlauf";
  if (minutes % 1440 === 0) return minutes === 1440 ? "1 Tag" : `${minutes / 1440} Tage`;
  return formatHours(minutes);
}

/** "Mo–Fr 09:00–17:00", "Mo–Do 09:00–12:00, 13:00–17:00 · Fr 09:00–13:00", or "Keine festen Zeiten". */
export function weekSummary(week: WeekPlan) {
  const groups: { from: number; to: number; text: string }[] = [];
  week.forEach((spans, index) => {
    const label = mergeSpans(spans).map(([from, to]) => `${clockOf(from)}–${clockOf(to)}`).join(", ");
    const last = groups.at(-1);
    if (last && last.text === label && last.to === index - 1) last.to = index;
    else groups.push({ from: index, to: index, text: label });
  });
  const parts = groups.filter((group) => group.text).map((group) => `${group.from === group.to ? WEEKDAY_SHORT[group.from] : `${WEEKDAY_SHORT[group.from]}–${WEEKDAY_SHORT[group.to]}`} ${group.text}`);
  return parts.length ? parts.join(" · ") : "Keine festen Zeiten";
}

/**
 * Customer requests: a known duration, in the future after the lead time, inside the horizon and inside the free time
 * of that day (availability minus booked times with buffer and the customer's own open requests).
 */
export function checkAvailabilityRequest(availability: Availability, input: SlotInput, busy: readonly Interval[], own: readonly Interval[], now: number, today: string): SlotCheck {
  if (!isDay(input.day) || !isClock(input.start)) return { ok: false, error: "Bitte Datum und Uhrzeit angeben." };
  const minutes = Number(input.minutes);
  if (!availability.rules.durations.includes(minutes)) return { ok: false, error: "Bitte eine der angebotenen Dauern wählen." };
  const start = wallTimeToUtc(input.day, input.start);
  const interval = { start, end: start + minutes * MINUTE };
  if (interval.start <= now) return { ok: false, error: "Dieser Zeitpunkt liegt in der Vergangenheit." };
  if (interval.start < now + availability.rules.notice * MINUTE) return { ok: false, error: `Termine lassen sich nur mit Vorlauf anfragen (${formatNotice(availability.rules.notice)}). Bitte einen späteren Zeitpunkt wählen.` };
  if (input.day > lastRequestDay(availability, today)) return { ok: false, error: `Termine lassen sich höchstens ${availability.rules.horizon} Wochen im Voraus anfragen.` };
  const inside = (list: readonly Interval[]) => list.some((free) => free.start <= interval.start && interval.end <= free.end);
  if (!inside(availableIntervals(availability, input.day))) return { ok: false, error: "Zu dieser Zeit bietet oalab keine Termine an. Bitte eine grüne, freie Zeit wählen." };
  if (!inside(customerFree(availability, input.day, busy, own, now, today))) return { ok: false, error: "Zu dieser Zeit ist der Kalender schon belegt. Bitte einen freien Zeitraum wählen." };
  return { ok: true, interval };
}

/** Customer request form: topic, optional message and a free time inside the availability. */
export function readAvailabilityRequest(input: FormInput, availability: Availability, busy: readonly Interval[], own: readonly Interval[], now: number, today: string): FieldsCheck {
  const title = text(input?.title, 200);
  if (!title) return { ok: false, error: "Bitte ein Thema angeben." };
  const slot = checkAvailabilityRequest(availability, { day: input?.day, start: input?.start, minutes: input?.minutes }, busy, own, now, today);
  if (!slot.ok) return slot;
  return { ok: true, value: { title, description: text(input?.description, 2000), customerId: null, interval: slot.interval, teamsUrl: null } };
}

const onStep = (value: unknown, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max && value % SPAN_STEP === 0;

/** A weekly plan as the database takes it: seven days, quarter-hour spans inside the day, joined, at most eight a day. */
export function cleanWeek(value: unknown): WeekPlan | null {
  if (!Array.isArray(value) || value.length !== 7) return null;
  const week: WeekPlan = [];
  for (const day of value) {
    if (!Array.isArray(day)) return null;
    const spans: DaySpan[] = [];
    for (const span of day) {
      if (!Array.isArray(span) || span.length !== 2 || !onStep(span[0], 1440) || !onStep(span[1], 1440) || span[0] >= span[1]) return null;
      spans.push([span[0], span[1]]);
    }
    const merged = mergeSpans(spans);
    if (merged.length > MAX_SPANS_PER_DAY) return null;
    week.push(merged);
  }
  return week;
}

/** Rules as the database takes them: offered values only, at least one duration. */
export function cleanRules(value: unknown): AvailabilityRules | null {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (!input) return null;
  const { notice, buffer, horizon } = input;
  const durations = Array.isArray(input.durations) ? [...new Set(input.durations)].sort((a, b) => Number(a) - Number(b)) : [];
  if (!(NOTICE_OPTIONS as readonly unknown[]).includes(notice) || !(BUFFER_OPTIONS as readonly unknown[]).includes(buffer) || !(HORIZON_OPTIONS as readonly unknown[]).includes(horizon)) return null;
  if (!durations.length || !durations.every((item) => (DURATION_CHOICES as readonly unknown[]).includes(item))) return null;
  return { notice: notice as number, buffer: buffer as number, horizon: horizon as number, durations: durations as number[] };
}

export type ExceptionInput = { kind?: unknown; from?: unknown; until?: unknown; allDay?: unknown; start?: unknown; end?: unknown; note?: unknown };
export type ExceptionRows = { ok: true; rows: Omit<AvailabilityException, "id">[] } | { ok: false; error: string };

/**
 * A new absence or extra time from the panel: an absence may cover several days (one row per day) and the whole day
 * or a span; extra time is one day with a span. Times on the quarter hour, the note at most 80 characters.
 */
export function readException(input: ExceptionInput, today: string): ExceptionRows {
  const kind = input?.kind === "off" || input?.kind === "extra" ? input.kind : null;
  if (!kind) return { ok: false, error: "Bitte „Nicht verfügbar“ oder „Zusätzliche Zeit“ wählen." };
  if (!isDay(input.from)) return { ok: false, error: "Bitte ein Datum angeben." };
  const until = kind === "off" && isDay(input.until) ? input.until : input.from;
  if (until < input.from) return { ok: false, error: "Das Ende liegt vor dem Anfang." };
  if (until < today) return { ok: false, error: "Dieser Tag liegt in der Vergangenheit." };
  const days: string[] = [];
  for (let day = input.from; day <= until; day = addDays(day, 1)) {
    days.push(day);
    if (days.length > MAX_EXCEPTION_DAYS) return { ok: false, error: `Höchstens ${MAX_EXCEPTION_DAYS} Tage auf einmal.` };
  }
  const allDay = kind === "off" && input.allDay === true;
  const from = allDay ? null : isClock(input.start) ? minutesOf(input.start) : null;
  const to = allDay ? null : input.end === "24:00" ? 1440 : isClock(input.end) ? minutesOf(input.end) : null;
  if (!allDay && (from === null || to === null || !onStep(from, 1425) || !onStep(to, 1440) || from >= to)) return { ok: false, error: "Bitte eine Zeitspanne im Viertelstunden-Raster wählen (von vor bis)." };
  const note = text(input.note, MAX_EXCEPTION_NOTE);
  return { ok: true, rows: days.filter((day) => day >= today).map((day) => ({ day, kind, from, to, note })) };
}

type SettingsRow = { week?: unknown; notice_minutes?: unknown; buffer_minutes?: unknown; horizon_weeks?: unknown; durations?: unknown };
type ExceptionRow = { id?: unknown; day?: unknown; kind?: unknown; from_minute?: unknown; to_minute?: unknown; note?: unknown };

/** The availability from the database's rows (admins) or from hub_calendar_availability() (customers, without notes). */
export function availabilityFrom(settings: SettingsRow | null | undefined, exceptions: readonly ExceptionRow[]): Availability {
  const week = cleanWeek(settings?.week) ?? DEFAULT_AVAILABILITY.week;
  const durations = Array.isArray(settings?.durations) ? settings.durations.filter((item): item is number => typeof item === "number" && Number.isInteger(item) && item > 0) : [];
  const number = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
  const rules: AvailabilityRules = {
    notice: number(settings?.notice_minutes, DEFAULT_AVAILABILITY.rules.notice),
    buffer: number(settings?.buffer_minutes, DEFAULT_AVAILABILITY.rules.buffer),
    horizon: Math.max(1, number(settings?.horizon_weeks, DEFAULT_AVAILABILITY.rules.horizon)),
    durations: durations.length ? durations : DEFAULT_AVAILABILITY.rules.durations,
  };
  const list = exceptions.flatMap((row, index): AvailabilityException[] => {
    if (!isDay(row.day) || (row.kind !== "off" && row.kind !== "extra")) return [];
    const from = typeof row.from_minute === "number" ? row.from_minute : null;
    const to = typeof row.to_minute === "number" ? row.to_minute : null;
    if ((from === null) !== (to === null) || (from === null && row.kind === "extra")) return [];
    return [{ id: typeof row.id === "string" ? row.id : `x-${row.day}-${index}`, day: row.day, kind: row.kind, from, to, note: typeof row.note === "string" ? row.note : "" }];
  });
  return { week, exceptions: list.sort((a, b) => a.day.localeCompare(b.day) || (a.from ?? -1) - (b.from ?? -1)), rules };
}
