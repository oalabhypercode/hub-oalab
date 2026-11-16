import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  addMonths, appointmentStatusIds, calendarWindow, checkRequestSlot, cleanTeamsUrl, dayOf, formatDuration, freeIntervals, isCalendarView,
  isoWeek, isTeamsUrl, layoutLanes, LIST_DAYS, minutesOn, mondayOf, monthWeeks, occupancy, slotStarts, stepDay, teamsHosts, timeOf, viewDays,
  wallTimeToUtc, weekDays,
} from "../lib/hub-calendar/rules.ts";
import { CALENDAR_PATH, movedCalendarPath } from "../lib/hub-calendar/paths.ts";
import { deadlineHint, formatDeadline, hubHref } from "../lib/hub-data.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const at = (day, time) => wallTimeToUtc(day, time);
const HOUR = 3_600_000;

test("Berlin wall times convert correctly on both sides of the October DST switch", () => {
  assert.equal(new Date(at("2026-10-23", "10:00")).toISOString(), "2026-10-23T08:00:00.000Z");
  assert.equal(new Date(at("2026-10-27", "10:00")).toISOString(), "2026-10-27T09:00:00.000Z");
  assert.equal(new Date(at("2026-03-30", "09:00")).toISOString(), "2026-03-30T07:00:00.000Z");
  assert.equal(new Date(at("2026-01-01", "00:00")).toISOString(), "2025-12-31T23:00:00.000Z");
  assert.equal(dayOf(at("2026-10-25", "23:30")), "2026-10-25");
  assert.equal(timeOf(at("2026-10-25", "23:30")), "23:30");
});

test("month grids start on Monday and cover the whole month", () => {
  const october = monthWeeks("2026-10");
  assert.equal(october[0][0], "2026-09-28");
  assert.equal(october.at(-1).at(-1), "2026-11-01");
  assert.ok(october.every((week) => week.length === 7));
  assert.equal(monthWeeks("2027-02").length, 4);
  assert.equal(addMonths("2026-12", 1), "2027-01");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  const window = calendarWindow("2026-10-22");
  assert.deepEqual([window.firstMonth, window.lastMonth], ["2026-09", "2027-03"]);
});

test("occupancy counts booked minutes inside the working hours only", () => {
  const day = "2026-10-20";
  const busy = [
    { start: at(day, "08:00"), end: at(day, "10:00") },
    { start: at(day, "09:30"), end: at(day, "11:00") },
    { start: at(day, "13:00"), end: at(day, "18:00") },
  ];
  const result = occupancy(day, busy);
  assert.equal(result.bookedMinutes, 6 * 60);
  assert.equal(result.level, "busy");
  assert.equal(occupancy(day, []).level, "free");
  assert.equal(occupancy("2026-10-24", busy).level, "closed");
  assert.equal(occupancy(day, [{ start: at(day, "09:00"), end: at(day, "17:00") }]).level, "full");
});

test("free slots skip booked times, the past and the end of the working day", () => {
  const day = "2026-10-21";
  const busy = [{ start: at(day, "10:00"), end: at(day, "11:00") }, { start: at(day, "14:00"), end: at(day, "16:30") }];
  const morning = at(day, "08:00");
  assert.deepEqual(freeIntervals(day, busy, morning).map(({ start, end }) => [timeOf(start), timeOf(end)]), [["09:00", "10:00"], ["11:00", "14:00"], ["16:30", "17:00"]]);
  assert.deepEqual(slotStarts(day, busy, 60, morning), ["09:00", "11:00", "11:30", "12:00", "12:30", "13:00"]);
  assert.deepEqual(slotStarts(day, busy, 30, at(day, "16:40")), []);
  assert.deepEqual(slotStarts(day, busy, 30, at(day, "11:10")).slice(0, 2), ["11:30", "12:00"]);
});

test("requests must be in the future, inside working hours and not overlap booked times", () => {
  const day = "2026-10-21";
  const busy = [{ start: at(day, "10:00"), end: at(day, "11:00") }];
  const now = at("2026-10-20", "12:00");
  assert.equal(checkRequestSlot({ day, start: "09:00", minutes: 60 }, busy, now).ok, true);
  assert.equal(checkRequestSlot({ day, start: "09:30", minutes: 60 }, busy, now).ok, false);
  assert.equal(checkRequestSlot({ day, start: "16:30", minutes: 60 }, busy, now).ok, false);
  assert.equal(checkRequestSlot({ day: "2026-10-24", start: "10:00", minutes: 60 }, busy, now).ok, false);
  assert.equal(checkRequestSlot({ day, start: "09:00", minutes: 60 }, busy, at(day, "09:30")).ok, false);
  assert.equal(checkRequestSlot({ day, start: "09:00", minutes: 25 }, busy, now).ok, false);
  assert.equal(checkRequestSlot({ day: "2026-02-30", start: "09:00", minutes: 60 }, busy, now).ok, false);
  const slot = checkRequestSlot({ day, start: "11:00", minutes: 90 }, busy, now);
  assert.equal(slot.ok && slot.interval.end - slot.interval.start, 1.5 * HOUR);
});

test("only Microsoft Teams meeting links are accepted", () => {
  for (const url of [
    "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%7d",
    "https://teams.microsoft.com/meet/3412345678901?p=AbCdEf",
    "https://teams.live.com/meet/9876543210",
    "https://teams.cloud.microsoft/meet/123?p=x",
  ]) assert.equal(isTeamsUrl(url), true, url);
  for (const url of [
    "http://teams.microsoft.com/l/meetup-join/x",
    "https://teams.microsoft.com.evil.example/l/meetup-join/x",
    "https://evil.example/?q=teams.microsoft.com",
    "https://user:pass@teams.microsoft.com/l/x",
    "https://teams.microsoft.com/",
    "javascript:alert(1)",
  ]) assert.equal(isTeamsUrl(url), false, url);
  assert.deepEqual(cleanTeamsUrl("  "), { ok: true, url: null });
  assert.equal(cleanTeamsUrl("https://zoom.us/j/1").ok, false);
});

test("the calendar migration matches the code and guards the table with RLS", async () => {
  const sql = await source("supabase/migrations/20261022120000_hub_calendar.sql");
  const statuses = sql.match(/status in \(([^)]+)\)/)[1].match(/'([a-z]+)'/g).map((value) => value.slice(1, -1));
  assert.deepEqual([...statuses].sort(), [...appointmentStatusIds].sort());
  for (const host of teamsHosts) assert.ok(sql.includes(host.replaceAll(".", "\\.")), host);
  assert.match(sql, /alter table public\.hub_appointments enable row level security/);
  assert.match(sql, /revoke all on public\.hub_appointments from anon/);
  assert.match(sql, /for insert to authenticated with check \(\s*status = 'requested'\s*and teams_url is null/);
  // Customers get busy times only: no titles, customers or links leave hub_calendar_busy().
  const busy = sql.match(/function public\.hub_calendar_busy[\s\S]+?\$\$;/)[0];
  assert.match(busy, /returns table \(starts_at timestamptz, ends_at timestamptz\)/);
  assert.match(busy, /security definer\s+set search_path = ''/);
  assert.doesNotMatch(busy.split("as $$")[1], /title|customer_id|teams_url|description/);
  assert.match(sql, /revoke execute on function public\.hub_calendar_busy\(timestamptz, timestamptz\), public\.hub_withdraw_appointment_request\(uuid\) from public, anon/);
});

test("project deadlines read as dates and as distance to today", () => {
  assert.equal(formatDeadline("2026-10-30"), "30. Okt. 2026");
  assert.equal(deadlineHint("2026-10-30", false, "2026-10-15"), "in 15 Tagen");
  assert.equal(deadlineHint("2026-10-16", false, "2026-10-15"), "morgen");
  assert.equal(deadlineHint("2026-10-15", false, "2026-10-15"), "heute");
  assert.equal(deadlineHint("2026-10-14", false, "2026-10-15"), "1 Tag überfällig");
  assert.equal(deadlineHint("2026-10-09", false, "2026-10-15"), "6 Tage überfällig");
  // Across the DST switch the day count stays whole.
  assert.equal(deadlineHint("2026-10-26", false, "2026-10-24"), "in 2 Tagen");
  assert.equal(deadlineHint("2026-10-09", true, "2026-10-15"), "abgeschlossen");
});

test("project deadlines and tasks with a date appear in the calendar, which opens where a link points", async () => {
  const store = await source("components/hub/screens/calendar-store.ts");
  // Studio projects without a target date are left out; customers see the tasks released to them, nothing else.
  assert.match(store, /projects\.flatMap\(\(project\): CalendarGoal\[\] => project\.dueOn\s*\?/);
  assert.match(store, /day: project\.dueOn/);
  assert.match(store, /\(project\.tasks \?\? \[\]\)\.filter\(\(task\) => task\.visible\)/);
  // Admins see the board's own rows: a task moved here carries the board's version, like a move in the board.
  assert.match(store, /export function boardTasks\(board: TaskBoardState/);
  const calendar = await source("components/hub/screens/calendar.tsx");
  assert.match(calendar, /admin \? \(board && !board\.error \? boardTasks\(board, projects, calendar\.customers\) : \[\]\) : projectTasks\(projects\)/);
  // A deadline links to its day; a notice links its appointment, which opens on its day.
  assert.match(calendar, /const params = useSearchParams\(\);/);
  assert.match(calendar, /const linked = store\.appointments\.find\(\(item\) => item\.id === params\.get\("appointment"\)\);/);
  assert.match(calendar, /const startDay = linked \? dayOf\(linked\.start\) : params\.get\("day"\);/);
  assert.match(calendar, /useState<Panel \| null>\(\(\) => linked \? \{ kind: "appointment", id: linked\.id \} : null\)/);
  // Tasks are Studio's rows: without a session confirmed by a code they stay read-only, with the way to the code.
  assert.match(calendar, /const confirmHref = admin && store\.live && !calendar\.confirmed \? confirmSessionHref\(hubHref\(false, "calendar"\)\) : null;/);
  assert.match(await source("lib/hub-calendar/server.ts"), /confirmed: canManage && claims\?\.claims\.aal === "aal2"/);
  const table = await source("components/hub/screens/projects-table.tsx");
  assert.match(table, /hubHref\(preview, "calendar"\)\}\?day=\$\{project\.dueOn\}/);
});

test("the calendar lives under Projekte; its old address forwards with the query", async () => {
  assert.equal(CALENDAR_PATH, "/dashboard/projects/calendar");
  assert.equal(hubHref(false, "calendar"), CALENDAR_PATH);
  assert.equal(hubHref(true, "calendar"), "/preview/projects/calendar");
  assert.equal(hubHref(false, "projects"), "/dashboard/projects");
  assert.equal(movedCalendarPath("/dashboard/calendar"), CALENDAR_PATH);
  assert.equal(movedCalendarPath("/preview/calendar"), "/preview/projects/calendar");
  for (const path of ["/dashboard/projects/calendar", "/dashboard/calendar/x", "/dashboard", "/calendar", "/dashboard/files"]) assert.equal(movedCalendarPath(path), null, path);
  // The proxy forwards before anything else (308 keeps the query), the page itself forwards as well.
  const proxy = await source("lib/supabase/proxy.ts");
  assert.match(proxy, /const moved = movedCalendarPath\(pathname\);\s+if \(moved\) \{\s+const url = request\.nextUrl\.clone\(\);\s+url\.pathname = moved;\s+return NextResponse\.redirect\(url, 308\);/);
  assert.match(await source("app/dashboard/[section]/page.tsx"), /if \(validSection === "calendar"\) redirect\(hubHref\(false, "calendar"\)\);/);
  assert.match(await source("app/preview/[section]/page.tsx"), /if \(validSection === "calendar"\) redirect\(hubHref\(true, "calendar"\)\);/);
  // The page is a detail of Projekte, but the navigation marks the calendar.
  const routes = await source("lib/hub-routes.ts");
  assert.match(routes, /\{ section: "projects", detail: "calendar" \}/);
  assert.match(routes, /if \(section === "projects" && detail === "calendar"\) return "calendar";/);
  assert.match(routes, /if \(segment === "projects" && detail === "calendar"\) return "calendar";/);
  assert.match(await source("components/hub/app-shell.tsx"), /const section: HubSection = pathSection\(pathname\);/);
  const detail = await source("app/dashboard/[section]/[detail]/page.tsx");
  assert.match(detail, /tasks \|\| \(calendar && admin\) \? loadTaskBoard\(\) : undefined,\s+calendar \? loadHubCalendar\(todayIso\(\)\) : undefined,/);
  // In the sidebar it hangs under Projekte, next to Aufgaben.
  const sidebar = await source("components/hub/glass-sidebar.tsx");
  assert.match(sidebar, /<Link href=\{hubHref\(preview, "calendar"\)\} className=\{`sidebar-item sidebar-sub\$\{onCalendar \? " is-active" : ""\}`\}/);
});

test("the views: weeks from Monday with their ISO number, a step per view, four weeks of list", () => {
  assert.equal(mondayOf("2026-11-16"), "2026-11-16");
  assert.equal(mondayOf("2026-11-22"), "2026-11-16");
  assert.deepEqual(weekDays("2026-11-19"), ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]);
  assert.equal(isoWeek("2026-11-16"), 47);
  assert.equal(isoWeek("2026-11-22"), 47);
  // 2026 starts on a Thursday: it has 53 weeks, and 3 January 2027 still belongs to week 53.
  assert.equal(isoWeek("2026-01-01"), 1);
  assert.equal(isoWeek("2027-01-03"), 53);
  assert.equal(isoWeek("2027-01-04"), 1);
  const month = viewDays("month", "2026-11-16");
  assert.equal(month.length, 42);
  assert.deepEqual([month[0], month.at(-1)], ["2026-10-26", "2026-12-06"]);
  assert.deepEqual(viewDays("week", "2026-11-18"), weekDays("2026-11-16"));
  assert.deepEqual(viewDays("day", "2026-11-18"), ["2026-11-18"]);
  const list = viewDays("list", "2026-11-16");
  assert.equal(list.length, LIST_DAYS);
  assert.equal(list.at(-1), "2026-12-13");
  // A month step lands on the 1st, back in the current month on today.
  assert.equal(stepDay("month", "2026-11-16", 1, "2026-11-16"), "2026-12-01");
  assert.equal(stepDay("month", "2026-12-01", -1, "2026-11-16"), "2026-11-16");
  assert.equal(stepDay("week", "2026-11-16", 1, "2026-11-16"), "2026-11-23");
  assert.equal(stepDay("day", "2026-11-16", -1, "2026-11-16"), "2026-11-15");
  assert.equal(stepDay("list", "2026-11-16", 1, "2026-11-16"), "2026-12-14");
  assert.ok(isCalendarView("week") && isCalendarView("list"));
  assert.ok(!isCalendarView("agenda") && !isCalendarView(null));
  assert.deepEqual([30, 45, 60, 90, 480].map(formatDuration), ["30 Min.", "45 Min.", "1 Std.", "1,5 Std.", "8 Std."]);
});

test("appointments find their place in the time grid, side by side where they overlap", () => {
  // Wall-clock minutes, clamped to the day: an appointment over midnight ends at 24:00 and starts at 0:00 the next day.
  assert.equal(minutesOn("2026-11-16", at("2026-11-16", "10:30")), 630);
  assert.equal(minutesOn("2026-11-16", at("2026-11-17", "01:00")), 24 * 60);
  assert.equal(minutesOn("2026-11-17", at("2026-11-16", "23:00")), 0);
  const day = "2026-11-16";
  const item = (id, from, to) => ({ id, start: at(day, from), end: at(day, to) });
  const placed = layoutLanes([item("d", "12:00", "13:00"), item("b", "09:30", "11:00"), item("a", "09:00", "10:00"), item("c", "10:00", "10:30")]);
  assert.deepEqual(placed.map(({ id, lane, lanes }) => [id, lane, lanes]), [["a", 0, 2], ["b", 1, 2], ["c", 0, 2], ["d", 0, 1]]);
  assert.deepEqual(layoutLanes([]), []);
});
