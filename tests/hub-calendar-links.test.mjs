import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ICS_FILE, calendarEvent, calendarLinks, calendarSignature, calendarTarget, googleCalendarUrl, icsCalendar, outlookCalendarUrl, validCalendarSignature,
} from "../lib/hub-calendar/links.ts";

// Windows checkouts may carry CRLF line endings; the source checks below compare LF text.
const source = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

const id = "0b6f4f0e-2c1a-4d7e-9a51-3f2e8d7c6b5a";
const appointment = (patch = {}) => ({
  id, title: "Abstimmung Website-Inhalte", description: "Agenda: Texte, Bilder; Ablauf",
  starts_at: "2026-11-06T10:00:00+00:00", ends_at: "2026-11-06T11:00:00+00:00",
  teams_url: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0", updated_at: "2026-10-30T13:12:05.123+00:00", ...patch,
});
const now = new Date("2026-10-30T14:00:00Z");

test("calendar links are signed per appointment and only the exact signature opens them", () => {
  const signature = calendarSignature(id, "secret");
  assert.match(signature, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(validCalendarSignature(id, signature, "secret"), true);
  assert.equal(validCalendarSignature(id, signature, "other"), false);
  assert.equal(validCalendarSignature("0b6f4f0e-2c1a-4d7e-9a51-3f2e8d7c6b5b", signature, "secret"), false);
  assert.equal(validCalendarSignature(id, signature.slice(1), "secret"), false);
  assert.equal(validCalendarSignature(id, "", "secret"), false);
  assert.deepEqual(calendarLinks("https://hub.oalab.de", id, "secret"), {
    ics: `https://hub.oalab.de/api/calendar/${id}/${ICS_FILE}?sig=${signature}`,
    google: `https://hub.oalab.de/api/calendar/${id}/google?sig=${signature}`,
    outlook: `https://hub.oalab.de/api/calendar/${id}/outlook?sig=${signature}`,
  });
  assert.equal(calendarTarget(ICS_FILE), "ics");
  assert.equal(calendarTarget("google"), "google");
  assert.equal(calendarTarget("constructor"), null);
  assert.equal(calendarTarget("termin.ics"), null);
});

test("the event carries title with oalab, UTC times, the Teams link and the way back into the hub", () => {
  const event = calendarEvent(appointment(), "https://hub.oalab.de", now);
  assert.equal(event.uid, `${id}@hub.oalab.de`);
  assert.equal(event.summary, "Abstimmung Website-Inhalte · oalab");
  assert.equal(event.start, "2026-11-06T10:00:00Z");
  assert.equal(event.end, "2026-11-06T11:00:00Z");
  assert.equal(event.location, "Microsoft Teams");
  assert.equal(event.description, "Teams-Besprechung beitreten:\nhttps://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0\n\nAgenda: Texte, Bilder; Ablauf\n\nTermin im oalab Client Hub:\nhttps://hub.oalab.de/dashboard/calendar");
  assert.equal(event.sequence, Math.floor(Date.parse("2026-10-30T13:12:05.123Z") / 1000));
  const bare = calendarEvent(appointment({ teams_url: null, description: "  ", updated_at: "kaputt" }), "https://hub.oalab.de", now);
  assert.equal(bare.location, "");
  assert.equal(bare.description, "Termin im oalab Client Hub:\nhttps://hub.oalab.de/dashboard/calendar");
  assert.equal(bare.sequence, 0);
  assert.ok(calendarEvent(appointment({ description: "x".repeat(2000) }), "https://hub.oalab.de", now).description.length < 1300);
});

test("Google and Outlook open a filled-in new event", () => {
  const event = calendarEvent(appointment(), "https://hub.oalab.de", now);
  const google = new URL(googleCalendarUrl(event));
  assert.equal(`${google.origin}${google.pathname}`, "https://calendar.google.com/calendar/render");
  assert.equal(google.searchParams.get("action"), "TEMPLATE");
  assert.equal(google.searchParams.get("text"), event.summary);
  assert.equal(google.searchParams.get("dates"), "20261106T100000Z/20261106T110000Z");
  assert.equal(google.searchParams.get("details"), event.description);
  assert.equal(google.searchParams.get("location"), "Microsoft Teams");
  assert.equal(google.searchParams.get("ctz"), "Europe/Berlin");
  const outlook = new URL(outlookCalendarUrl(event));
  assert.equal(`${outlook.origin}${outlook.pathname}`, "https://outlook.office.com/calendar/action/compose");
  assert.equal(outlook.searchParams.get("rru"), "addevent");
  assert.equal(outlook.searchParams.get("subject"), event.summary);
  assert.equal(outlook.searchParams.get("startdt"), "2026-11-06T10:00:00Z");
  assert.equal(outlook.searchParams.get("enddt"), "2026-11-06T11:00:00Z");
  assert.match(outlook.searchParams.get("body"), /^Teams-Besprechung beitreten:<br>https:\/\/teams\.microsoft\.com\/.+<br><br>Agenda: Texte, Bilder; Ablauf<br><br>Termin im oalab Client Hub:<br>https:\/\/hub\.oalab\.de\/dashboard\/calendar$/);
  const tricky = calendarEvent(appointment({ description: "<b>fett</b> & mehr" }), "https://hub.oalab.de", now);
  assert.match(new URL(outlookCalendarUrl(tricky)).searchParams.get("body"), /&lt;b&gt;fett&lt;\/b&gt; &amp; mehr/);
});

test("the .ics file is valid: CRLF, folded lines, escaped text, a stable id and a reminder", () => {
  const ics = icsCalendar(calendarEvent(appointment(), "https://hub.oalab.de", now));
  assert.ok(ics.endsWith("\r\n"));
  assert.doesNotMatch(ics, /[^\r]\n/);
  const lines = ics.split("\r\n");
  assert.ok(lines.every((line) => Buffer.byteLength(line) <= 75), "lines are folded at 75 bytes");
  const unfolded = ics.replace(/\r\n /g, "");
  for (const line of [
    "METHOD:PUBLISH", `UID:${id}@hub.oalab.de`, "DTSTART:20261106T100000Z", "DTEND:20261106T110000Z", "DTSTAMP:20261030T140000Z",
    "SUMMARY:Abstimmung Website-Inhalte · oalab", "LOCATION:Microsoft Teams", "URL:https://hub.oalab.de/dashboard/calendar", "STATUS:CONFIRMED", "TRIGGER:-PT15M",
  ]) assert.ok(unfolded.split("\r\n").includes(line), line);
  assert.match(unfolded, /\r\nDESCRIPTION:Teams-Besprechung beitreten:\\nhttps:\/\/teams\.microsoft\.com\/\S+\\n\\nAgenda: Texte\\, Bilder\\; Ablauf\\n\\nTermin im oalab Client Hub:\\nhttps:\/\/hub\.oalab\.de\/dashboard\/calendar\r\n/);
  assert.doesNotMatch(unfolded, /ORGANIZER|ATTENDEE|METHOD:REQUEST/);
  const umlauts = icsCalendar(calendarEvent(appointment({ title: "Größere Überprüfung äöü ".repeat(6).trim() }), "https://hub.oalab.de", now));
  assert.ok(umlauts.split("\r\n").every((line) => Buffer.byteLength(line) <= 75));
  assert.equal(umlauts.replace(/\r\n /g, "").split("\r\n").find((line) => line.startsWith("SUMMARY:")), `SUMMARY:${"Größere Überprüfung äöü ".repeat(6).trim()} · oalab`);
  assert.doesNotMatch(icsCalendar(calendarEvent(appointment({ teams_url: null }), "https://hub.oalab.de", now)), /LOCATION/);
});

test("the calendar route checks the signature, reads the appointment fresh and serves only confirmed ones", async () => {
  const route = await source("app/api/calendar/[id]/[target]/route.ts");
  assert.match(route, /if \(!secret \|\| !target \|\| !uuid\.test\(id\) \|\| !validCalendarSignature\(id, signature, secret\)\) \{\n    return page\(404,/);
  assert.match(route, /if \(read\.data\.status !== "confirmed"\)/);
  assert.match(route, /"Content-Type": "text\/calendar; charset=utf-8"/);
  assert.match(route, /"Cache-Control": "no-store"/);
  assert.match(await source("lib/supabase/proxy.ts"), /\|\| pathname\.startsWith\("\/api\/calendar\/"\);/);
});
