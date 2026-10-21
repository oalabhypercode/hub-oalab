import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  addMonths, appointmentStatusIds, calendarWindow, checkRequestSlot, cleanTeamsUrl, dayOf, freeIntervals, isTeamsUrl,
  monthWeeks, occupancy, slotStarts, teamsHosts, timeOf, wallTimeToUtc,
} from "../lib/hub-calendar/rules.ts";

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
