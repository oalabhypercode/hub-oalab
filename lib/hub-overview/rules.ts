/**
 * The overview's notifications (design „V5“, user 18.11.2026): the bell's notices like a phone's notification centre.
 * New ones (unread) and earlier ones (read), each grouped into one stack per area in the order of the area's newest
 * notice; once the page runs in the browser, times read relative to now. Pure and without imports at run time, so the
 * tests load this file directly.
 */

export type NoticeLike = { id: number; createdAt: string; read: boolean };
export type NoticeStack<T> = { area: string; items: T[] };

/** How many read notices „Früher“ shows at most; older ones stay in the bell. */
export const EARLIER_LIMIT = 8;

const newestFirst = (a: NoticeLike, b: NoticeLike) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id;

/**
 * New and earlier notices without the hidden ones, newest first. A notice counts as read when the server says so or this
 * page just marked it; „Früher“ keeps the newest EARLIER_LIMIT and says whether there are more.
 */
export function splitNotices<T extends NoticeLike>(items: readonly T[], read: ReadonlySet<number>, hidden: ReadonlySet<number>) {
  const visible = items.filter((item) => !hidden.has(item.id)).sort(newestFirst);
  const isRead = (item: T) => item.read || read.has(item.id);
  const earlier = visible.filter(isRead);
  return { fresh: visible.filter((item) => !isRead(item)), earlier: earlier.slice(0, EARLIER_LIMIT), more: earlier.length > EARLIER_LIMIT };
}

/** One stack per area, like the phone groups by app: the stacks in the order of their newest notice, newest first inside. */
export function stackByArea<T extends NoticeLike>(items: readonly T[], areaOf: (item: T) => string): NoticeStack<T>[] {
  const stacks = new Map<string, T[]>();
  for (const item of [...items].sort(newestFirst)) {
    const area = areaOf(item);
    stacks.set(area, [...(stacks.get(area) ?? []), item]);
  }
  return [...stacks].map(([area, list]) => ({ area, items: list }));
}

const berlinDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" });
const weekday = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", weekday: "short" });
const dayMonth = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "numeric", month: "short" });
const dayNumber = (time: number) => Date.parse(`${berlinDay.format(time)}T00:00:00Z`) / 86_400_000;

/**
 * When a notice came, as the phone says it, in German time: „jetzt“, „vor 12 Min.“, „vor 3 Std.“ (the same day),
 * „gestern“, the weekday within a week („Mo.“), else the day („3. Nov.“).
 */
export function relativeWhen(iso: string, now: number): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return "jetzt";
  if (minutes < 60) return `vor ${minutes} Min.`;
  const days = dayNumber(now) - dayNumber(time);
  if (days <= 0) return `vor ${Math.floor(minutes / 60)} Std.`;
  if (days === 1) return "gestern";
  // „Mo.“ everywhere: some engines write the short weekday without the point.
  if (days < 7) return `${weekday.format(time).replace(/\.$/, "")}.`;
  return dayMonth.format(time);
}

/** Notices this browser hid from the overview (×), as stored: ids only, the newest last, at most `limit`. */
export function readHiddenIds(raw: string | null): number[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is number => Number.isSafeInteger(id) && id > 0) : [];
  } catch {
    return [];
  }
}

export const HIDDEN_LIMIT = 120;

/** The stored list after hiding `ids`: each id once, the oldest dropped beyond HIDDEN_LIMIT (the bell keeps 30 anyway). */
export const addHiddenIds = (stored: readonly number[], ids: readonly number[]) => [...new Set([...stored, ...ids])].slice(-HIDDEN_LIMIT);
