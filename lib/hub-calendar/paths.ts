/**
 * Where the calendar lives. Since 16.11.2026 it hangs under Projekte next to the task board; the old address forwards
 * there with its query (?appointment=, ?day=), so links in notices and mails sent before keep working.
 * No imports: the proxy and the tests load this file directly.
 */
export const CALENDAR_PATH = "/dashboard/projects/calendar";

/** The new address for the calendar's old one (/dashboard/calendar, /preview/calendar); null for every other path. */
export function movedCalendarPath(pathname: string): string | null {
  return pathname === "/dashboard/calendar" || pathname === "/preview/calendar" ? pathname.replace(/\/calendar$/, "/projects/calendar") : null;
}
