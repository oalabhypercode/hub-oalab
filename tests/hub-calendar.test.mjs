import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  addDays, addMonths, adminFree, appointmentStatusIds, availabilityFrom, availableSpans, calendarWindow, checkAvailabilityRequest, cleanRules, cleanTeamsUrl,
  cleanWeek, customerFree, dayOf, dayOff, DEFAULT_AVAILABILITY, FIXED_AVAILABILITY, formatDuration, formatNotice, isCalendarView, isoWeek, isTeamsUrl,
  layoutLanes, LIST_DAYS, mergeSpans, minutesOn, mondayOf, monthWeeks, readAvailabilityRequest, readException, spanMinutes, startsIn, stepDay,
  subtractSpans, teamsHosts, timeOf, viewDays, wallMinuteToUtc, wallTimeToUtc, weekDays, weekSummary,
} from "../lib/hub-calendar/rules.ts";
import { CALENDAR_PATH, movedCalendarPath } from "../lib/hub-calendar/paths.ts";
import { deadlineHint, formatDeadline, hubHref } from "../lib/hub-data.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const at = (day, time) => wallTimeToUtc(day, time);
const spans = (list) => list.map(({ start, end }) => `${timeOf(start)}–${timeOf(end)}`);

// An availability like the approved preview (16.11.2026): lunch break on Monday, short Friday, a fair on Wednesday
// morning, Friday the 23rd off, extra Saturday; 24 hours' lead time, 15 minutes' buffer, 8 weeks, four durations.
const plan = {
  week: [[[540, 720], [780, 1020]], [[540, 1020]], [[540, 1020]], [[540, 1020]], [[540, 780]], [], []],
  exceptions: [
    { id: "x1", day: "2026-10-21", kind: "off", from: 540, to: 720, note: "Messe" },
    { id: "x2", day: "2026-10-24", kind: "extra", from: 600, to: 780, note: "" },
    { id: "x3", day: "2026-10-23", kind: "off", from: null, to: null, note: "Urlaub" },
  ],
  rules: { notice: 1440, buffer: 15, horizon: 8, durations: [30, 45, 60, 90] },
};

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

test("availability: the weekly plan plus extra time minus absences, day by day", () => {
  assert.deepEqual(availableSpans(plan, "2026-10-19"), [[540, 720], [780, 1020]]);
  assert.deepEqual(availableSpans(plan, "2026-10-21"), [[720, 1020]], "the fair takes the morning");
  assert.deepEqual(availableSpans(plan, "2026-10-23"), [], "a day off");
  assert.equal(dayOff(plan, "2026-10-23").note, "Urlaub");
  assert.deepEqual(availableSpans(plan, "2026-10-24"), [[600, 780]], "extra time on a Saturday");
  assert.deepEqual(availableSpans(plan, "2026-10-25"), []);
  // Before the migration: the fixed hours of before.
  assert.deepEqual(availableSpans(FIXED_AVAILABILITY, "2026-10-21"), [[540, 1020]]);
  assert.deepEqual(availableSpans(FIXED_AVAILABILITY, "2026-10-24"), []);
  assert.deepEqual(mergeSpans([[600, 660], [540, 600], [700, 720], [710, 800]]), [[540, 660], [700, 800]]);
  assert.deepEqual(subtractSpans([[540, 1020]], [[720, 780], [1000, 1100]]), [[540, 720], [780, 1000]]);
  assert.equal(spanMinutes([[540, 720], [700, 780]]), 240);
  // Wall-clock minutes become instants on the right side of the clock change (25.10.2026); 1440 is the next midnight.
  assert.equal(new Date(wallMinuteToUtc("2026-10-24", 600)).toISOString(), "2026-10-24T08:00:00.000Z");
  assert.equal(new Date(wallMinuteToUtc("2026-10-25", 600)).toISOString(), "2026-10-25T09:00:00.000Z");
  assert.equal(wallMinuteToUtc("2026-10-24", 1440), at("2026-10-25", "00:00"));
  assert.equal(weekSummary(plan.week), "Mo 09:00–12:00, 13:00–17:00 · Di–Do 09:00–17:00 · Fr 09:00–13:00");
  assert.equal(weekSummary(FIXED_AVAILABILITY.week), "Mo–Fr 09:00–17:00");
  assert.equal(weekSummary([[], [], [], [], [], [], []]), "Keine festen Zeiten");
  assert.deepEqual([0, 120, 1440, 2880].map(formatNotice), ["ohne Vorlauf", "2 Std.", "1 Tag", "2 Tage"]);
});

test("customers: free time inside the availability, after the lead time, with buffer, own requests and horizon", () => {
  const today = "2026-10-19";
  const now = at(today, "10:00");
  const busy = [{ start: at("2026-10-20", "10:00"), end: at("2026-10-20", "11:00") }];
  const own = [{ start: at("2026-10-22", "15:00"), end: at("2026-10-22", "16:00") }];
  const free = (day, rules = plan, mine = own) => spans(customerFree(rules, day, busy, mine, now, today));
  assert.deepEqual(free("2026-10-19"), [], "today lies inside the lead time");
  assert.deepEqual(free("2026-10-20"), ["11:15–17:00"], "lead time until 10:00, the booked hour plus 15 minutes on both sides");
  assert.deepEqual(free("2026-10-21"), ["12:00–17:00"]);
  assert.deepEqual(free("2026-10-22"), ["09:00–15:00", "16:00–17:00"], "the own request blocks its hour");
  assert.deepEqual(free("2026-10-23"), []);
  assert.deepEqual(free("2026-10-24"), ["10:00–13:00"]);
  assert.deepEqual(free(addDays(today, 8 * 7 + 1)), [], "beyond the horizon");
  assert.deepEqual(free("2026-10-20", FIXED_AVAILABILITY, []), ["09:00–10:00", "11:00–17:00"], "the fixed hours: no lead time, no buffer");
  assert.deepEqual(startsIn("2026-10-24", customerFree(plan, "2026-10-24", [], [], now, today), 90), ["10:00", "10:30", "11:00", "11:30"]);
  // oalab itself: the availability minus booked times, without buffer or lead time.
  assert.deepEqual(spans(adminFree(plan, "2026-10-20", busy, now)), ["09:00–10:00", "11:00–17:00"]);
  assert.deepEqual(spans(adminFree(plan, "2026-10-19", busy, now)), ["10:00–12:00", "13:00–17:00"], "nothing in the past");
});

test("requests: an offered duration, after the lead time, inside the horizon and the free time", () => {
  const today = "2026-10-19";
  const now = at(today, "10:00");
  const busy = [{ start: at("2026-10-20", "13:00"), end: at("2026-10-20", "14:00") }];
  const ask = (day, start, minutes) => checkAvailabilityRequest(plan, { day, start, minutes }, busy, [], now, today);
  const slot = ask("2026-10-20", "11:00", 90);
  assert.equal(slot.ok && slot.interval.end - slot.interval.start, 90 * 60_000);
  assert.match(ask("2026-10-20", "11:00", 20).error, /angebotenen Dauern/);
  assert.match(ask("2026-10-19", "09:00", 60).error, /Vergangenheit/);
  assert.match(ask("2026-10-19", "15:00", 60).error, /mit Vorlauf anfragen \(1 Tag\)/);
  assert.match(ask(addDays(today, 8 * 7 + 2), "10:00", 60).error, /8 Wochen/);
  assert.match(ask("2026-10-21", "10:00", 60).error, /keine Termine an/, "the fair");
  assert.match(ask("2026-10-25", "10:00", 60).error, /keine Termine an/, "Sunday");
  assert.match(ask("2026-10-20", "12:30", 60).error, /schon belegt/);
  assert.match(ask("2026-10-20", "14:00", 30).error, /schon belegt/, "inside the buffer");
  assert.equal(ask("2026-10-20", "14:15", 30).ok, true);
  assert.equal(ask("2026-10-02-30", "09:00", 60).ok, false);
  const read = readAvailabilityRequest({ title: "  Logo  ", description: "Zwei Varianten", day: "2026-10-20", start: "11:00", minutes: 60 }, plan, busy, [], now, today);
  assert.equal(read.ok && read.value.title, "Logo");
  assert.match(readAvailabilityRequest({ title: " ", day: "2026-10-20", start: "11:00", minutes: 60 }, plan, busy, [], now, today).error, /Thema/);
});

test("availability input: weekly plans, rules and exceptions are cleaned or refused", () => {
  assert.deepEqual(cleanWeek([[[600, 720], [540, 600]], [], [], [], [], [], []])[0], [[540, 720]]);
  for (const week of [
    [],
    [[[540, 1025]], [], [], [], [], [], []],
    [[[600, 540]], [], [], [], [], [], []],
    [[[540, 1500]], [], [], [], [], [], []],
    [[["09:00", 1020]], [], [], [], [], [], []],
    Array.from({ length: 7 }, () => Array.from({ length: 9 }, (_, index) => [index * 60, index * 60 + 30])),
  ]) assert.equal(cleanWeek(week), null, JSON.stringify(week).slice(0, 60));
  assert.deepEqual(cleanRules({ notice: 1440, buffer: 15, horizon: 8, durations: [60, 30, 60] }), { notice: 1440, buffer: 15, horizon: 8, durations: [30, 60] });
  for (const rules of [{ notice: 5, buffer: 15, horizon: 8, durations: [30] }, { notice: 1440, buffer: 15, horizon: 8, durations: [] }, { notice: 1440, buffer: 15, horizon: 8, durations: [20] }, null]) {
    assert.equal(cleanRules(rules), null);
  }
  const today = "2026-10-19";
  const off = readException({ kind: "off", from: "2026-10-20", until: "2026-10-22", allDay: true, note: "Urlaub" }, today);
  assert.deepEqual(off.ok && off.rows.map((row) => [row.day, row.from, row.to, row.note]), [["2026-10-20", null, null, "Urlaub"], ["2026-10-21", null, null, "Urlaub"], ["2026-10-22", null, null, "Urlaub"]]);
  const span = readException({ kind: "off", from: "2026-10-20", allDay: false, start: "09:00", end: "12:00" }, today);
  assert.deepEqual(span.ok && span.rows, [{ day: "2026-10-20", kind: "off", from: 540, to: 720, note: "" }]);
  const extra = readException({ kind: "extra", from: "2026-10-24", until: "2026-10-30", start: "10:00", end: "24:00" }, today);
  assert.deepEqual(extra.ok && extra.rows.map((row) => [row.day, row.from, row.to]), [["2026-10-24", 600, 1440]], "extra time is one day");
  assert.match(readException({ kind: "extra", from: "2026-10-24", allDay: true }, today).error, /Zeitspanne/);
  assert.match(readException({ kind: "off", from: "2026-10-20", allDay: false, start: "09:10", end: "12:00" }, today).error, /Viertelstunden/);
  assert.match(readException({ kind: "off", from: "2026-10-18", allDay: true }, today).error, /Vergangenheit/);
  assert.match(readException({ kind: "off", from: "2026-10-20", until: "2027-01-31", allDay: true }, today).error, /Höchstens 62 Tage/);
  assert.match(readException({ kind: "holiday", from: "2026-10-20" }, today).error, /Nicht verfügbar/);
});

test("availability from the database: notes only where admins read them, broken rows left out", () => {
  const value = availabilityFrom(
    { week: [[[540, 1020]], [], [], [], [], [], []], notice_minutes: 120, buffer_minutes: 0, horizon_weeks: 4, durations: [30, 60] },
    [
      { id: "a", day: "2026-10-20", kind: "off", from_minute: null, to_minute: null, note: "Urlaub" },
      { day: "2026-10-21", kind: "extra", from_minute: 600, to_minute: 660 },
      { day: "2026-10-22", kind: "extra", from_minute: null, to_minute: null },
      { day: "kaputt", kind: "off" },
    ],
  );
  assert.deepEqual(value.rules, { notice: 120, buffer: 0, horizon: 4, durations: [30, 60] });
  assert.deepEqual(value.exceptions.map((item) => [item.day, item.kind, item.from, item.note]), [["2026-10-20", "off", null, "Urlaub"], ["2026-10-21", "extra", 600, ""]]);
  assert.deepEqual(availabilityFrom({ week: "kaputt" }, []).week, DEFAULT_AVAILABILITY.week, "broken settings: the migration's start values");
  assert.deepEqual(DEFAULT_AVAILABILITY.rules, { notice: 1440, buffer: 15, horizon: 8, durations: [30, 45, 60, 90] });
  assert.deepEqual(FIXED_AVAILABILITY.rules, { notice: 0, buffer: 0, horizon: 26, durations: [30, 45, 60, 90] });
});

test("availability: loaded per role, checked on the server and by the database, saved by admins only", async () => {
  const server = await source("lib/hub-calendar/server.ts");
  assert.match(server, /supabase\.from\("hub_calendar_exceptions"\)\.select\("id, day, kind, from_minute, to_minute, note"\)/, "admins: with notes");
  assert.match(server, /supabase\.rpc\("hub_calendar_availability", \{ range_start: from, range_end: to \}\)/, "customers: without notes");
  assert.match(server, /if \(settings\.error \|\| exceptions\.error \|\| !settings\.data\) return fixed;/, "before the migration: the fixed hours");
  // A request is checked in the core the request window and the Claude connector share (since 19.11.2026).
  const core = await source("lib/hub-calendar/write.ts");
  assert.match(core, /const read = readAvailabilityRequest\(input, availability, intervals\(busy\.data\), intervals\(own\.data\), now, dayOf\(now\)\);/);
  assert.match(core, /if \(error\?\.code === "42501"\) return \{ ok: false, error: "Diese Zeit ist gerade nicht mehr frei/, "the database's own check refused");
  const actions = await source("lib/hub-calendar/actions.ts");
  assert.match(actions, /const result = await requestAppointmentAs\(session\.supabase, session\.userId, input\);/);
  for (const name of ["saveAvailabilityWeek", "saveAvailabilityRules", "addAvailabilityException", "removeAvailabilityException"]) {
    const body = actions.slice(actions.indexOf(`export async function ${name}(`));
    assert.match(body, /^export async function \w+\([^)]*\)[^\n]*\{\r?\n {2}const supabase = await adminClient\(\);\r?\n {2}if \(!supabase\) return denied;/, name);
  }
  // The database change lives in service-oalab, the one migration history of the shared database.
  assert.ok(!(await readdir(new URL("../supabase/migrations", import.meta.url))).some((name) => name.includes("availability")));
  const screen = await source("components/hub/screens/calendar.tsx");
  assert.match(screen, /customerFree\(availability, date, store\.busy, store\.own, now, today\)/, "the green times of customers");
  assert.match(screen, /useAvailabilityPaint\(root, admin && editing && \(view === "week" \|\| view === "day"\), onPaint\);/, "painting only for admins in week and day");
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
  // Admins and freelancers (18.11.2026) read the board, customers their released tasks.
  assert.match(calendar, /board \? \(board\.error \? \[\] : boardTasks\(board, projects, calendar\.customers\)\) : projectTasks\(projects\)/);
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
  assert.match(detail, /tasks \|\| \(calendar && \(admin \|\| freelancer\)\) \? loadTaskBoard\(\) : undefined,\s+calendar \? loadHubCalendar\(todayIso\(\)\) : undefined,/);
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
