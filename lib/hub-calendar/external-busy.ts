import { SOURCE_SPANS, type SourceRules } from "./sources-rules";

/**
 * Busy times from other calendars (stage 2 of the plan „Kalender des Hubs mit Apple Kalender synchron halten“): what a
 * public iCloud calendar (or one published in Outlook) and Microsoft Graph's free/busy answer, turned into start and end
 * only. Titles, places and attendees are read past and never leave this file. Rules per source: all-day entries and
 * entries marked free or cancelled block nothing (both on by default); copies of the hub's own appointments (UID
 * …@hub.oalab.de, from the mail buttons or the subscription) never count twice.
 *
 * The calendar files are read here without a library: lines and parameters (RFC 5545), dates in UTC, in a named time
 * zone (IANA names through Intl, the usual Windows names through a table, unknown ones as German time) or floating,
 * repeating entries (RRULE with DAILY, WEEKLY, MONTHLY and YEARLY, INTERVAL, COUNT, UNTIL, BYDAY with positions,
 * BYMONTHDAY, BYMONTH, BYSETPOS, WKST), EXDATE, RDATE and moved single dates (RECURRENCE-ID), and VFREEBUSY. A rule part
 * it does not know (BYWEEKNO, BYYEARDAY, BYHOUR …) is left out of the repetition. Self-contained apart from the shared
 * rules, so `node --test` checks it directly.
 */

export type BusySpan = { start: number; end: number };
export type BusyWindow = { from: number; to: number };

const DAY = 86_400_000;
/** The team works in German time; floating times and unknown zones count as that. */
export const HOME_ZONE = "Europe/Berlin";
/** At most this many candidate days per repeating entry: daily for decades is still far below. */
const MAX_STEPS = 20_000;

/* ---------- Time zones ---------- */

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterOf(zone: string) {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(zone, formatter);
  }
  return formatter;
}

/** How far the zone's wall clock is ahead of UTC at this instant, in milliseconds. */
function offsetAt(instant: number, zone: string) {
  const parts: Record<string, number> = {};
  for (const part of formatterOf(zone).formatToParts(new Date(instant))) if (part.type !== "literal") parts[part.type] = Number(part.value);
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour === 24 ? 0 : parts.hour, parts.minute, parts.second);
  return wall - Math.floor(instant / 1000) * 1000;
}

/** The instant of a wall-clock time in a zone; a time that the clock skips in spring lands an hour later. */
export function zonedInstant(y: number, m: number, d: number, hh: number, mi: number, ss: number, zone: string) {
  const wall = Date.UTC(y, m - 1, d, hh, mi, ss);
  if (zone === "UTC") return wall;
  const first = offsetAt(wall, zone);
  const second = offsetAt(wall - first, zone);
  return wall - (second === first ? first : second);
}

/** Windows names as Outlook writes them, mapped to IANA zones. */
const WINDOWS_ZONES: Record<string, string> = {
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw",
  "Romance Standard Time": "Europe/Paris",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "E. Europe Standard Time": "Europe/Chisinau",
  "FLE Standard Time": "Europe/Kiev",
  "GTB Standard Time": "Europe/Bucharest",
  "Turkey Standard Time": "Europe/Istanbul",
  "Russian Standard Time": "Europe/Moscow",
  "Israel Standard Time": "Asia/Jerusalem",
  "Arabian Standard Time": "Asia/Dubai",
  "India Standard Time": "Asia/Kolkata",
  "China Standard Time": "Asia/Shanghai",
  "Tokyo Standard Time": "Asia/Tokyo",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles",
  "UTC": "UTC",
  "Coordinated Universal Time": "UTC",
};

/** A TZID as calendars write it: IANA, a Windows name, „/mozilla.org/…/Europe/Berlin“ or quoted; else German time. */
export function resolveZone(tzid: string | null | undefined): string {
  if (!tzid) return HOME_ZONE;
  const name = tzid.trim().replace(/^"(.*)"$/, "$1").replace(/^\/[^/]+\/[^/]+\//, "");
  if (WINDOWS_ZONES[name]) return WINDOWS_ZONES[name];
  if (/^(UTC|GMT|Z|Etc\/UTC|Etc\/GMT)$/i.test(name)) return "UTC";
  try {
    formatterOf(name);
    return name;
  } catch {
    return HOME_ZONE;
  }
}

/* ---------- Day numbers: days since 1970-01-01, weekday 0 = Monday ---------- */

const dayNumber = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / DAY);
const dateOf = (day: number) => {
  const date = new Date(day * DAY);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
};
const weekdayOf = (day: number) => (((day % 7) + 7 + 3) % 7);
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const WEEKDAYS: Record<string, number> = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 };

/* ---------- Content lines (RFC 5545) ---------- */

type Prop = { name: string; params: Record<string, string>; value: string };
type Component = { type: string; props: Prop[]; children: Component[] };

/** Folded lines joined again; CRLF, LF and CR all end a line. */
function contentLines(text: string) {
  const lines: string[] = [];
  for (const line of text.replace(/\r\n|\r/g, "\n").split("\n")) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length) lines[lines.length - 1] += line.slice(1);
    else if (line.trim()) lines.push(line);
  }
  return lines;
}

function parseProp(line: string): Prop | null {
  let quoted = false;
  let colon = -1;
  for (let index = 0; index < line.length; index++) {
    if (line[index] === '"') quoted = !quoted;
    else if (line[index] === ":" && !quoted) { colon = index; break; }
  }
  if (colon < 1) return null;
  const parts: string[] = [];
  let current = "";
  quoted = false;
  for (const char of line.slice(0, colon)) {
    if (char === '"') { quoted = !quoted; current += char; } else if (char === ";" && !quoted) { parts.push(current); current = ""; } else current += char;
  }
  parts.push(current);
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const at = part.indexOf("=");
    if (at > 0) params[part.slice(0, at).trim().toUpperCase()] = part.slice(at + 1).trim().replace(/^"(.*)"$/, "$1");
  }
  return { name: parts[0].trim().toUpperCase(), params, value: line.slice(colon + 1) };
}

function parseComponents(text: string): Component {
  const root: Component = { type: "ROOT", props: [], children: [] };
  const stack = [root];
  for (const line of contentLines(text)) {
    const prop = parseProp(line);
    if (!prop) continue;
    if (prop.name === "BEGIN") {
      const component: Component = { type: prop.value.trim().toUpperCase(), props: [], children: [] };
      stack[stack.length - 1].children.push(component);
      stack.push(component);
    } else if (prop.name === "END") {
      if (stack.length > 1) stack.pop();
    } else {
      stack[stack.length - 1].props.push(prop);
    }
  }
  return root;
}

const propOf = (component: Component, name: string) => component.props.find((prop) => prop.name === name);
const propsOf = (component: Component, name: string) => component.props.filter((prop) => prop.name === name);

/* ---------- Dates, times and durations ---------- */

type When =
  | { date: true; day: number }
  | { date: false; day: number; seconds: number; zone: string };

function readWhen(value: string, params: Record<string, string>): When | null {
  const text = value.trim();
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (date) return { date: true, day: dayNumber(+date[1], +date[2], +date[3]) };
  const time = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/i.exec(text);
  if (!time) return null;
  const seconds = +time[4] * 3600 + +time[5] * 60 + +time[6];
  if (seconds >= 86_400) return null;
  return { date: false, day: dayNumber(+time[1], +time[2], +time[3]), seconds, zone: time[7] ? "UTC" : resolveZone(params.TZID) };
}

const whenOf = (prop: Prop | undefined) => (prop ? readWhen(prop.value, prop.params) : null);
/** EXDATE and RDATE may hold several values, separated by commas. */
const whensOf = (props: Prop[]) => props.flatMap((prop) => prop.value.split(",").map((value) => readWhen(value, prop.params)).filter((when): when is When => Boolean(when)));

/** The instant a value stands for: a day starts at midnight German time. */
function instantOf(when: When) {
  const { y, m, d } = dateOf(when.day);
  if (when.date) return zonedInstant(y, m, d, 0, 0, 0, HOME_ZONE);
  return zonedInstant(y, m, d, Math.floor(when.seconds / 3600), Math.floor((when.seconds % 3600) / 60), when.seconds % 60, when.zone);
}

/** An ISO 8601 duration of RFC 5545 („P1D“, „PT1H30M“, „P2W“) in milliseconds; null when unreadable. */
export function durationMs(value: string): number | null {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value.trim());
  if (!match || value.trim().toUpperCase().endsWith("T")) return null;
  const [, sign, weeks, days, hours, minutes, seconds] = match;
  const total = ((+(weeks ?? 0) * 7 + +(days ?? 0)) * 86_400 + +(hours ?? 0) * 3600 + +(minutes ?? 0) * 60 + +(seconds ?? 0)) * 1000;
  return sign === "-" ? -total : total;
}

/* ---------- Repetition ---------- */

type Rule = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count: number | null;
  until: When | null;
  byDay: { n: number; wd: number }[];
  byMonthDay: number[];
  byMonth: number[];
  bySetPos: number[];
  wkst: number;
};

function readRule(value: string, params: Record<string, string>): Rule | null {
  const parts: Record<string, string> = {};
  for (const part of value.split(";")) {
    const at = part.indexOf("=");
    if (at > 0) parts[part.slice(0, at).trim().toUpperCase()] = part.slice(at + 1).trim();
  }
  const freq = parts.FREQ?.toUpperCase();
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return null;
  const numbers = (text: string | undefined) => (text ?? "").split(",").map((item) => Number.parseInt(item, 10)).filter((item) => Number.isFinite(item) && item !== 0);
  const byDay = (parts.BYDAY ?? "").split(",").flatMap((item) => {
    const match = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/i.exec(item.trim());
    return match ? [{ n: match[1] ? Number.parseInt(match[1], 10) : 0, wd: WEEKDAYS[match[2].toUpperCase()] }] : [];
  });
  const interval = Number.parseInt(parts.INTERVAL ?? "1", 10);
  const count = parts.COUNT ? Number.parseInt(parts.COUNT, 10) : null;
  return {
    freq,
    interval: Number.isFinite(interval) && interval > 0 ? Math.min(interval, 1000) : 1,
    count: count !== null && Number.isFinite(count) && count > 0 ? count : null,
    until: parts.UNTIL ? readWhen(parts.UNTIL, params) : null,
    byDay,
    byMonthDay: numbers(parts.BYMONTHDAY).filter((item) => Math.abs(item) <= 31),
    byMonth: numbers(parts.BYMONTH).filter((item) => item >= 1 && item <= 12),
    bySetPos: numbers(parts.BYSETPOS),
    wkst: WEEKDAYS[(parts.WKST ?? "MO").toUpperCase()] ?? 0,
  };
}

/** Positions of BYSETPOS (1 = first, -1 = last) picked from the ordered candidates of one period. */
function pickPositions(days: number[], positions: number[]) {
  if (!positions.length) return days;
  return [...new Set(positions.map((position) => days[position > 0 ? position - 1 : days.length + position]).filter((day): day is number => day !== undefined))].sort((a, b) => a - b);
}

/** The days of one month that BYMONTHDAY and BYDAY ask for (a weekday with a position counts within the month). */
function monthDays(y: number, m: number, rule: Rule, fallbackDay: number) {
  const length = daysInMonth(y, m);
  const first = dayNumber(y, m, 1);
  let days: number[];
  if (rule.byMonthDay.length) {
    days = rule.byMonthDay.map((n) => (n > 0 ? n : length + n + 1)).filter((n) => n >= 1 && n <= length).map((n) => first + n - 1);
    if (rule.byDay.length) days = days.filter((day) => rule.byDay.some((item) => item.wd === weekdayOf(day)));
  } else if (rule.byDay.length) {
    days = rule.byDay.flatMap((item) => {
      const all = Array.from({ length }, (_, index) => first + index).filter((day) => weekdayOf(day) === item.wd);
      if (!item.n) return all;
      const pick = item.n > 0 ? all[item.n - 1] : all[all.length + item.n];
      return pick === undefined ? [] : [pick];
    });
  } else {
    days = fallbackDay <= length ? [first + fallbackDay - 1] : [];
  }
  return [...new Set(days)].sort((a, b) => a - b);
}

/**
 * The days a repeating entry happens on, from its first day up to `lastDay` (and its UNTIL and COUNT), in order.
 * `untilOk` decides UNTIL for a candidate day, since a date-time UNTIL depends on the time of day.
 */
function repeatDays(rule: Rule, startDay: number, lastDay: number, untilOk: (day: number) => boolean): number[] {
  const out: number[] = [];
  const start = dateOf(startDay);
  let steps = 0;
  const take = (day: number) => {
    if (day < startDay) return true;
    if (day > lastDay || !untilOk(day)) return false;
    out.push(day);
    return rule.count === null || out.length < rule.count;
  };
  const inMonths = (day: number) => !rule.byMonth.length || rule.byMonth.includes(dateOf(day).m);

  if (rule.freq === "DAILY") {
    for (let day = startDay; day <= lastDay && steps < MAX_STEPS; day += rule.interval, steps++) {
      const { y, m, d } = dateOf(day);
      const length = daysInMonth(y, m);
      if (!inMonths(day)) continue;
      if (rule.byMonthDay.length && !rule.byMonthDay.some((n) => (n > 0 ? n : length + n + 1) === d)) continue;
      if (rule.byDay.length && !rule.byDay.some((item) => item.wd === weekdayOf(day))) continue;
      if (!take(day)) break;
    }
    return out;
  }

  if (rule.freq === "WEEKLY") {
    const weekdays = rule.byDay.length ? [...new Set(rule.byDay.map((item) => item.wd))] : [weekdayOf(startDay)];
    const offsets = weekdays.map((wd) => (wd - rule.wkst + 7) % 7).sort((a, b) => a - b);
    const firstWeek = startDay - ((weekdayOf(startDay) - rule.wkst + 7) % 7);
    outer: for (let week = firstWeek; week <= lastDay && steps < MAX_STEPS; week += 7 * rule.interval, steps++) {
      for (const offset of offsets) {
        const day = week + offset;
        if (!inMonths(day)) continue;
        if (!take(day)) break outer;
      }
    }
    return out;
  }

  if (rule.freq === "MONTHLY") {
    let y = start.y;
    let m = start.m;
    while (dayNumber(y, m, 1) <= lastDay && steps < MAX_STEPS) {
      steps++;
      if (!rule.byMonth.length || rule.byMonth.includes(m)) {
        const days = pickPositions(monthDays(y, m, rule, start.d), rule.bySetPos);
        let stop = false;
        for (const day of days) if (!take(day)) { stop = true; break; }
        if (stop) break;
      }
      m += rule.interval;
      while (m > 12) { m -= 12; y += 1; }
    }
    return out;
  }

  // YEARLY: the months of BYMONTH (or the first entry's), a weekday with a position counts within the year when no
  // month is given.
  for (let y = start.y; dayNumber(y, 1, 1) <= lastDay && steps < MAX_STEPS; y += rule.interval, steps++) {
    let days: number[];
    if (!rule.byMonth.length && rule.byDay.length && !rule.byMonthDay.length) {
      const first = dayNumber(y, 1, 1);
      const length = dayNumber(y + 1, 1, 1) - first;
      days = rule.byDay.flatMap((item) => {
        const all = Array.from({ length }, (_, index) => first + index).filter((day) => weekdayOf(day) === item.wd);
        if (!item.n) return all;
        const pick = item.n > 0 ? all[item.n - 1] : all[all.length + item.n];
        return pick === undefined ? [] : [pick];
      });
    } else {
      const months = rule.byMonth.length ? rule.byMonth : [start.m];
      days = months.flatMap((month) => (rule.byMonthDay.length || rule.byDay.length ? monthDays(y, month, rule, start.d) : start.d <= daysInMonth(y, month) ? [dayNumber(y, month, start.d)] : []));
    }
    days = pickPositions([...new Set(days)].sort((a, b) => a - b), rule.bySetPos);
    let stop = false;
    for (const day of days) if (!take(day)) { stop = true; break; }
    if (stop) break;
  }
  return out;
}

/* ---------- From entries to busy times ---------- */

/** Whether an entry counts as free: transparent, or marked free by Outlook (also „working elsewhere“). */
function isFree(event: Component) {
  if ((propOf(event, "TRANSP")?.value.trim().toUpperCase() ?? "") === "TRANSPARENT") return true;
  const status = (propOf(event, "X-MICROSOFT-CDO-BUSYSTATUS") ?? propOf(event, "X-MICROSOFT-CDO-INTENDEDSTATUS"))?.value.trim().toUpperCase();
  return status === "FREE" || status === "WORKINGELSEWHERE";
}

const isHubEntry = (uid: string) => /@hub\.oalab\.de$/i.test(uid.trim());

/** Spans clipped to the window, overlapping and touching ones merged, the earliest SOURCE_SPANS kept. */
export function mergeBusy(spans: BusySpan[], window: BusyWindow): BusySpan[] {
  const clipped = spans
    .map((span) => ({ start: Math.max(span.start, window.from), end: Math.min(span.end, window.to) }))
    .filter((span) => Number.isFinite(span.start) && Number.isFinite(span.end) && span.end > span.start)
    .sort((a, b) => a.start - b.start);
  const merged: BusySpan[] = [];
  for (const span of clipped) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged.slice(0, SOURCE_SPANS);
}

/** The busy times of one event (and its repetitions), before the window is applied. */
function eventSpans(event: Component, rules: SourceRules, window: BusyWindow, moved: Map<string, Set<number>>): BusySpan[] {
  const startProp = propOf(event, "DTSTART");
  const start = whenOf(startProp);
  if (!start || !startProp) return [];
  const allDay = start.date || (propOf(event, "X-MICROSOFT-CDO-ALLDAYEVENT")?.value.trim().toUpperCase() === "TRUE");
  if (allDay && rules.ignoreAllDay) return [];
  const cancelled = propOf(event, "STATUS")?.value.trim().toUpperCase() === "CANCELLED";
  if ((cancelled || isFree(event)) && rules.ignoreFree) return [];

  // How long one occurrence takes: DTEND, else DURATION, else a day (dates) or nothing (times).
  const end = whenOf(propOf(event, "DTEND"));
  const duration = propOf(event, "DURATION");
  let length: number;
  if (start.date) {
    const days = end?.date ? end.day - start.day : duration ? Math.round((durationMs(duration.value) ?? DAY) / DAY) : 1;
    length = Math.max(days, 1);
  } else {
    length = end ? instantOf(end) - instantOf(start) : duration ? durationMs(duration.value) ?? 0 : 0;
    if (length <= 0) return [];
  }
  const spanOf = (day: number): BusySpan => {
    if (start.date) return { start: instantOf({ date: true, day }), end: instantOf({ date: true, day: day + length }) };
    const at = instantOf({ ...start, day });
    return { start: at, end: at + length };
  };

  // Extra dates (RDATE): a day takes the entry's time, a date-time its own start.
  const extra = whensOf(propsOf(event, "RDATE")).map((when): BusySpan => {
    if (when.date) return spanOf(when.day);
    const at = instantOf(when);
    return { start: at, end: at + (start.date ? length * DAY : length) };
  });
  const ruleProp = propOf(event, "RRULE");
  const rule = ruleProp ? readRule(ruleProp.value, ruleProp.params) : null;
  if (!rule) return [spanOf(start.day), ...extra];

  // Excluded and moved dates: a day leaves that day, a date-time that one start.
  const uid = propOf(event, "UID")?.value.trim() ?? "";
  const excluded = whensOf(propsOf(event, "EXDATE"));
  const excludedDays = new Set(excluded.filter((when) => when.date).map((when) => when.day));
  const excludedStarts = new Set(excluded.filter((when) => !when.date).map(instantOf));
  for (const instant of moved.get(uid) ?? []) excludedStarts.add(instant);
  const untilOk = (day: number) => {
    if (!rule.until) return true;
    if (rule.until.date) return day <= rule.until.day;
    return spanOf(day).start <= instantOf(rule.until);
  };
  // The window's last day plus two, so entries late on the last day are not cut early.
  const lastDay = Math.floor(window.to / DAY) + 2;
  const repeated = repeatDays(rule, start.day, lastDay, untilOk).filter((day) => !excludedDays.has(day)).map(spanOf);
  return [...repeated, ...extra].filter((span) => !excludedStarts.has(span.start));
}

export type IcsResult = { ok: true; spans: BusySpan[] } | { ok: false; error: "not-calendar" };

/** The busy times of a calendar file within the window, by the source's rules. */
export function icsBusy(text: string, rules: SourceRules, window: BusyWindow): IcsResult {
  const root = parseComponents(text);
  const calendars = root.children.filter((component) => component.type === "VCALENDAR");
  if (!calendars.length) return { ok: false, error: "not-calendar" };
  const events = calendars.flatMap((calendar) => calendar.children.filter((component) => component.type === "VEVENT"));
  const spans: BusySpan[] = [];

  // Moved or cancelled single dates of a repetition: their original time leaves the repetition, the entry stands alone.
  const moved = new Map<string, Set<number>>();
  for (const event of events) {
    const recurrence = whenOf(propOf(event, "RECURRENCE-ID"));
    const uid = propOf(event, "UID")?.value.trim() ?? "";
    if (!recurrence || !uid) continue;
    const set = moved.get(uid) ?? new Set<number>();
    set.add(instantOf(recurrence));
    moved.set(uid, set);
  }

  for (const event of events) {
    const uid = propOf(event, "UID")?.value.trim() ?? "";
    if (uid && isHubEntry(uid)) continue;
    spans.push(...eventSpans(event, rules, window, moved));
  }

  // Free/busy blocks (VFREEBUSY): busy, tentative and unavailable count, free never.
  for (const calendar of calendars) {
    for (const block of calendar.children.filter((component) => component.type === "VFREEBUSY")) {
      for (const prop of propsOf(block, "FREEBUSY")) {
        if ((prop.params.FBTYPE ?? "BUSY").toUpperCase() === "FREE") continue;
        for (const period of prop.value.split(",")) {
          const [from, to] = period.split("/");
          const begin = from ? readWhen(from, {}) : null;
          if (!begin || begin.date || !to) continue;
          const finish = readWhen(to, {});
          const startAt = instantOf(begin);
          const endAt = finish && !finish.date ? instantOf(finish) : startAt + (durationMs(to) ?? 0);
          if (endAt > startAt) spans.push({ start: startAt, end: endAt });
        }
      }
    }
  }
  return { ok: true, spans: mergeBusy(spans, window) };
}

/* ---------- Microsoft Graph: free/busy of mailboxes ---------- */

/** getSchedule answers at most 62 days at a time: the twelve weeks go in parts of six weeks. */
export function scheduleWindows(window: BusyWindow, days = 42): BusyWindow[] {
  const parts: BusyWindow[] = [];
  for (let from = window.from; from < window.to; from += days * DAY) parts.push({ from, to: Math.min(window.to, from + days * DAY) });
  return parts;
}

const graphTime = (instant: number) => ({ dateTime: new Date(instant).toISOString().slice(0, 19), timeZone: "UTC" });

/** The request body for POST /users/{mailbox}/calendar/getSchedule: up to 20 mailboxes, times in UTC. */
export function scheduleBody(mailboxes: string[], window: BusyWindow) {
  return { schedules: mailboxes.slice(0, 20), startTime: graphTime(window.from), endTime: graphTime(window.to), availabilityViewInterval: 60 };
}

export type ScheduleItem = { status?: unknown; start?: { dateTime?: unknown; timeZone?: unknown }; end?: { dateTime?: unknown; timeZone?: unknown } };
export type ScheduleOutcome = { ok: true; items: ScheduleItem[] } | { ok: false; error: "graph-mailbox" | "graph" };

/**
 * getSchedule's answer per mailbox (lower case): its items, or an error for a mailbox outside what the app may read.
 * Only status, start and end of the items are ever looked at.
 */
export function scheduleOutcomes(json: unknown, mailboxes: string[]): Map<string, ScheduleOutcome> {
  const outcomes = new Map<string, ScheduleOutcome>();
  const value = json && typeof json === "object" && Array.isArray((json as { value?: unknown }).value) ? (json as { value: unknown[] }).value : null;
  for (const mailbox of mailboxes) outcomes.set(mailbox.toLowerCase(), { ok: false, error: "graph" });
  if (!value) return outcomes;
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { scheduleId?: unknown; scheduleItems?: unknown; error?: unknown };
    const id = typeof row.scheduleId === "string" ? row.scheduleId.toLowerCase() : "";
    if (!outcomes.has(id)) continue;
    if (row.error) outcomes.set(id, { ok: false, error: "graph-mailbox" });
    else outcomes.set(id, { ok: true, items: Array.isArray(row.scheduleItems) ? row.scheduleItems as ScheduleItem[] : [] });
  }
  return outcomes;
}

function graphInstant(value: { dateTime?: unknown; timeZone?: unknown } | undefined) {
  const text = typeof value?.dateTime === "string" ? value.dateTime : "";
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(text);
  if (!match) return null;
  const zone = typeof value?.timeZone === "string" ? resolveZone(value.timeZone) : "UTC";
  return zonedInstant(+match[1], +match[2], +match[3], +match[4], +match[5], +match[6], zone);
}

/** A whole-day entry in Graph's answer: from midnight to midnight German time, at least one day. */
function looksAllDay(start: number, end: number) {
  const wallStart = start + offsetAt(start, HOME_ZONE);
  const wallEnd = end + offsetAt(end, HOME_ZONE);
  return wallStart % DAY === 0 && wallEnd % DAY === 0 && wallEnd - wallStart >= DAY;
}

/** Busy times from getSchedule's items: busy, tentative and out of office count; free and working elsewhere by rule. */
export function graphBusy(items: ScheduleItem[], rules: SourceRules, window: BusyWindow): BusySpan[] {
  const spans: BusySpan[] = [];
  for (const item of items) {
    const status = typeof item.status === "string" ? item.status.toLowerCase() : "busy";
    if ((status === "free" || status === "workingelsewhere") && rules.ignoreFree) continue;
    if (status === "unknown") continue;
    const start = graphInstant(item.start);
    const end = graphInstant(item.end);
    if (start === null || end === null || end <= start) continue;
    if (rules.ignoreAllDay && looksAllDay(start, end)) continue;
    spans.push({ start, end });
  }
  return mergeBusy(spans, window);
}
