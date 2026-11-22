import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

// lib/hub-calendar imports its neighbours without extension, as the bundler resolves them; Node needs the ".ts".
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.includes("/lib/")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const busy = await import("../lib/hub-calendar/external-busy.ts");
const rules = await import("../lib/hub-calendar/sources-rules.ts");
const source = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

const DEFAULT = rules.DEFAULT_SOURCE_RULES;
const ALL = { ignoreAllDay: false, ignoreFree: false };
const window = { from: Date.parse("2026-11-22T00:00:00Z"), to: Date.parse("2027-02-14T00:00:00Z") };
const iso = (instant) => new Date(instant).toISOString().replace(/\.000Z$/, "Z");
const calendar = (...events) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//DE", ...events.flat(), "END:VCALENDAR", ""].join("\r\n");
const event = (...lines) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"];
const spansOf = (text, chosen = DEFAULT, range = window) => {
  const result = busy.icsBusy(text, chosen, range);
  assert.equal(result.ok, true);
  return result.spans.map((span) => [iso(span.start), iso(span.end)]);
};

test("times: UTC, a named zone in winter and summer, floating as German time, Windows and Mozilla names", () => {
  assert.deepEqual(spansOf(calendar(event("UID:a", "DTSTART:20261124T090000Z", "DTEND:20261124T100000Z"))), [["2026-11-24T09:00:00Z", "2026-11-24T10:00:00Z"]]);
  assert.deepEqual(spansOf(calendar(event("UID:b", "DTSTART;TZID=Europe/Berlin:20261124T100000", "DTEND;TZID=Europe/Berlin:20261124T113000"))), [["2026-11-24T09:00:00Z", "2026-11-24T10:30:00Z"]]);
  const summer = { from: Date.parse("2026-06-01T00:00:00Z"), to: Date.parse("2026-07-01T00:00:00Z") };
  assert.deepEqual(spansOf(calendar(event("UID:c", "DTSTART;TZID=Europe/Berlin:20260610T100000", "DTEND;TZID=Europe/Berlin:20260610T110000")), DEFAULT, summer), [["2026-06-10T08:00:00Z", "2026-06-10T09:00:00Z"]]);
  assert.deepEqual(spansOf(calendar(event("UID:d", "DTSTART:20261125T140000", "DTEND:20261125T150000"))), [["2026-11-25T13:00:00Z", "2026-11-25T14:00:00Z"]]);
  assert.deepEqual(spansOf(calendar(event("UID:e", 'DTSTART;TZID="W. Europe Standard Time":20261126T080000', 'DTEND;TZID="W. Europe Standard Time":20261126T090000'))), [["2026-11-26T07:00:00Z", "2026-11-26T08:00:00Z"]]);
  assert.deepEqual(spansOf(calendar(event("UID:f", "DTSTART;TZID=/mozilla.org/20050126_1/America/New_York:20261127T090000", "DURATION:PT2H"))), [["2026-11-27T14:00:00Z", "2026-11-27T16:00:00Z"]]);
  assert.deepEqual(spansOf(calendar(event("UID:g", "DTSTART;TZID=Mars/Olympus:20261127T090000", "DTEND;TZID=Mars/Olympus:20261127T093000"))), [["2026-11-27T08:00:00Z", "2026-11-27T08:30:00Z"]], "an unknown zone counts as German time");
  assert.equal(busy.resolveZone("W. Europe Standard Time"), "Europe/Berlin");
  assert.equal(busy.resolveZone("Etc/UTC"), "UTC");
  assert.equal(busy.durationMs("P1W2DT3H4M5S"), (9 * 86_400 + 3 * 3600 + 4 * 60 + 5) * 1000);
  assert.equal(busy.durationMs("PT"), null);
});

test("lines: folded lines, quoted parameters with colons, CRLF, LF or CR, and junk around them", () => {
  const folded = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:fold", 'DTSTART;X-NOTE="a:b;c";TZID=Europe/Berlin:2026112', " 8T090000", "DTEND;TZID=Europe/Berlin:20261128T100000", "SUMMARY:Arzt, privat", "END:VEVENT", "kaputte Zeile", "END:VCALENDAR"];
  for (const separator of ["\r\n", "\n", "\r"]) {
    assert.deepEqual(spansOf(folded.join(separator)), [["2026-11-28T08:00:00Z", "2026-11-28T09:00:00Z"]], JSON.stringify(separator));
  }
  assert.deepEqual(busy.icsBusy("<html>Not found</html>", DEFAULT, window), { ok: false, error: "not-calendar" });
});

test("rules: all-day, free and cancelled entries block nothing by default; the hub's own copies never", () => {
  const text = calendar(
    event("UID:birthday", "DTSTART;VALUE=DATE:20261201", "DTEND;VALUE=DATE:20261202", "SUMMARY:Geburtstag"),
    event("UID:free", "DTSTART:20261202T090000Z", "DTEND:20261202T100000Z", "TRANSP:TRANSPARENT"),
    event("UID:outlook-free", "DTSTART:20261203T090000Z", "DTEND:20261203T100000Z", "X-MICROSOFT-CDO-BUSYSTATUS:FREE"),
    event("UID:cancelled", "DTSTART:20261204T090000Z", "DTEND:20261204T100000Z", "STATUS:CANCELLED"),
    event("UID:0b6f4f0e-2c1a-4d7e-9a51-3f2e8d7c6b5a@hub.oalab.de", "DTSTART:20261205T090000Z", "DTEND:20261205T100000Z", "SUMMARY:Abstimmung · oalab"),
    event("UID:real", "DTSTART:20261206T090000Z", "DTEND:20261206T100000Z"),
  );
  assert.deepEqual(spansOf(text), [["2026-12-06T09:00:00Z", "2026-12-06T10:00:00Z"]]);
  // With the rules off: the day from midnight to midnight German time, the free and the cancelled entries; never the copy.
  assert.deepEqual(spansOf(text, ALL), [
    ["2026-11-30T23:00:00Z", "2026-12-01T23:00:00Z"],
    ["2026-12-02T09:00:00Z", "2026-12-02T10:00:00Z"],
    ["2026-12-03T09:00:00Z", "2026-12-03T10:00:00Z"],
    ["2026-12-04T09:00:00Z", "2026-12-04T10:00:00Z"],
    ["2026-12-06T09:00:00Z", "2026-12-06T10:00:00Z"],
  ]);
  // Outlook marks all-day entries also as times from midnight with its own flag.
  const flagged = calendar(event("UID:x", "DTSTART;TZID=Europe/Berlin:20261207T000000", "DTEND;TZID=Europe/Berlin:20261208T000000", "X-MICROSOFT-CDO-ALLDAYEVENT:TRUE"));
  assert.deepEqual(spansOf(flagged), []);
});

test("repetition: weekly on two days with COUNT keeps the wall clock over the change to summer time", () => {
  const range = { from: Date.parse("2027-03-20T00:00:00Z"), to: Date.parse("2027-04-10T00:00:00Z") };
  const text = calendar(event("UID:weekly", "DTSTART;TZID=Europe/Berlin:20270322T100000", "DTEND;TZID=Europe/Berlin:20270322T110000", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4"));
  assert.deepEqual(spansOf(text, DEFAULT, range), [
    ["2027-03-22T09:00:00Z", "2027-03-22T10:00:00Z"],
    ["2027-03-24T09:00:00Z", "2027-03-24T10:00:00Z"],
    ["2027-03-29T08:00:00Z", "2027-03-29T09:00:00Z"],
    ["2027-03-31T08:00:00Z", "2027-03-31T09:00:00Z"],
  ]);
});

test("repetition: every other week, the last Friday, the 31st, the last weekday and a yearly day", () => {
  const every2 = calendar(event("UID:w2", "DTSTART:20261123T080000Z", "DTEND:20261123T090000Z", "RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20261222T000000Z"));
  assert.deepEqual(spansOf(every2).map(([start]) => start), ["2026-11-23T08:00:00Z", "2026-12-07T08:00:00Z", "2026-12-21T08:00:00Z"]);
  const lastFriday = calendar(event("UID:lf", "DTSTART;TZID=Europe/Berlin:20261127T150000", "DTEND;TZID=Europe/Berlin:20261127T160000", "RRULE:FREQ=MONTHLY;BYDAY=-1FR"));
  assert.deepEqual(spansOf(lastFriday).map(([start]) => start), ["2026-11-27T14:00:00Z", "2026-12-25T14:00:00Z", "2027-01-29T14:00:00Z"]);
  const thirtyFirst = calendar(event("UID:31", "DTSTART:20261031T120000Z", "DTEND:20261031T130000Z", "RRULE:FREQ=MONTHLY;BYMONTHDAY=31"));
  assert.deepEqual(spansOf(thirtyFirst).map(([start]) => start), ["2026-12-31T12:00:00Z", "2027-01-31T12:00:00Z"], "November has no 31st");
  const lastWeekday = calendar(event("UID:lw", "DTSTART:20261130T160000Z", "DTEND:20261130T170000Z", "RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1"));
  assert.deepEqual(spansOf(lastWeekday).map(([start]) => start), ["2026-11-30T16:00:00Z", "2026-12-31T16:00:00Z", "2027-01-29T16:00:00Z"]);
  const yearly = calendar(event("UID:y", "DTSTART;VALUE=DATE:20200105", "DTEND;VALUE=DATE:20200106", "RRULE:FREQ=YEARLY"));
  assert.deepEqual(spansOf(yearly), [], "a yearly all-day entry blocks nothing by default");
  assert.deepEqual(spansOf(yearly, ALL), [["2027-01-04T23:00:00Z", "2027-01-05T23:00:00Z"]]);
  const daily = calendar(event("UID:d", "DTSTART:20150101T060000Z", "DTEND:20150101T063000Z", "RRULE:FREQ=DAILY"));
  assert.equal(spansOf(daily).length, 84, "a daily entry for years still reaches the window, once a day");
});

test("repetition: excluded dates, a moved single date and extra dates", () => {
  const text = calendar(
    event("UID:standup", "DTSTART;TZID=Europe/Berlin:20261123T093000", "DTEND;TZID=Europe/Berlin:20261123T094500", "RRULE:FREQ=DAILY;COUNT=5",
      "EXDATE;TZID=Europe/Berlin:20261124T093000", "EXDATE;VALUE=DATE:20261126", "RDATE;TZID=Europe/Berlin:20261129T120000"),
    event("UID:standup", "RECURRENCE-ID;TZID=Europe/Berlin:20261125T093000", "DTSTART;TZID=Europe/Berlin:20261125T140000", "DTEND;TZID=Europe/Berlin:20261125T141500"),
  );
  assert.deepEqual(spansOf(text), [
    ["2026-11-23T08:30:00Z", "2026-11-23T08:45:00Z"],
    ["2026-11-25T13:00:00Z", "2026-11-25T13:15:00Z"],
    ["2026-11-27T08:30:00Z", "2026-11-27T08:45:00Z"],
    ["2026-11-29T11:00:00Z", "2026-11-29T11:15:00Z"],
  ]);
  // A single date cancelled in the series: gone with the default rules.
  const cancelled = calendar(
    event("UID:s", "DTSTART:20261123T100000Z", "DTEND:20261123T110000Z", "RRULE:FREQ=DAILY;COUNT=2"),
    event("UID:s", "RECURRENCE-ID:20261124T100000Z", "DTSTART:20261124T100000Z", "DTEND:20261124T110000Z", "STATUS:CANCELLED"),
  );
  assert.deepEqual(spansOf(cancelled), [["2026-11-23T10:00:00Z", "2026-11-23T11:00:00Z"]]);
});

test("the window: clipped to the next twelve weeks, overlapping entries merged, free/busy blocks read", () => {
  const text = calendar(
    event("UID:old", "DTSTART:20261101T090000Z", "DTEND:20261101T100000Z"),
    event("UID:edge", "DTSTART:20261121T230000Z", "DTEND:20261122T010000Z"),
    event("UID:one", "DTSTART:20261130T090000Z", "DTEND:20261130T110000Z"),
    event("UID:two", "DTSTART:20261130T100000Z", "DTEND:20261130T120000Z"),
    event("UID:late", "DTSTART:20270301T090000Z", "DTEND:20270301T100000Z"),
    ["BEGIN:VFREEBUSY", "FREEBUSY;FBTYPE=BUSY:20261201T090000Z/20261201T100000Z,20261202T090000Z/PT30M", "FREEBUSY;FBTYPE=FREE:20261203T090000Z/20261203T100000Z", "END:VFREEBUSY"],
  );
  assert.deepEqual(spansOf(text), [
    ["2026-11-22T00:00:00Z", "2026-11-22T01:00:00Z"],
    ["2026-11-30T09:00:00Z", "2026-11-30T12:00:00Z"],
    ["2026-12-01T09:00:00Z", "2026-12-01T10:00:00Z"],
    ["2026-12-02T09:00:00Z", "2026-12-02T09:30:00Z"],
  ]);
  const many = calendar(event("UID:m", "DTSTART:20261122T000000Z", "DTEND:20261122T000100Z", "RRULE:FREQ=DAILY;COUNT=5000", "DURATION:PT1M"));
  assert.ok(busy.icsBusy(many, DEFAULT, window).spans.length <= rules.SOURCE_SPANS);
});

test("Microsoft 365: windows of six weeks, the request in UTC, answers per mailbox and only status, start and end", () => {
  const twelveWeeks = { from: Date.parse("2026-11-22T12:00:00Z"), to: Date.parse("2027-02-14T12:00:00Z") };
  const parts = busy.scheduleWindows(twelveWeeks);
  assert.deepEqual(parts.map((part) => [iso(part.from), iso(part.to)]), [["2026-11-22T12:00:00Z", "2027-01-03T12:00:00Z"], ["2027-01-03T12:00:00Z", "2027-02-14T12:00:00Z"]]);
  assert.deepEqual(busy.scheduleBody(["team@example.test"], parts[0]), {
    schedules: ["team@example.test"], startTime: { dateTime: "2026-11-22T12:00:00", timeZone: "UTC" }, endTime: { dateTime: "2027-01-03T12:00:00", timeZone: "UTC" }, availabilityViewInterval: 60,
  });
  const answer = { value: [
    { scheduleId: "Team@Example.test", scheduleItems: [
      { status: "busy", subject: "Geheim", location: "Raum 1", start: { dateTime: "2026-11-24T09:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-11-24T10:00:00.0000000", timeZone: "UTC" } },
      { status: "tentative", start: { dateTime: "2026-11-24T09:30:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-11-24T11:00:00.0000000", timeZone: "UTC" } },
      { status: "free", start: { dateTime: "2026-11-25T09:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-11-25T10:00:00.0000000", timeZone: "UTC" } },
      { status: "workingElsewhere", start: { dateTime: "2026-11-25T11:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-11-25T12:00:00.0000000", timeZone: "UTC" } },
      { status: "oof", start: { dateTime: "2026-11-26T23:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-11-27T23:00:00.0000000", timeZone: "UTC" } },
      { status: "busy", start: { dateTime: "2026-11-28T10:00:00.0000000", timeZone: "W. Europe Standard Time" }, end: { dateTime: "2026-11-28T11:00:00.0000000", timeZone: "W. Europe Standard Time" } },
    ] },
    { scheduleId: "boss@example.test", error: { message: "Access denied", responseCode: "ErrorAccessDenied" } },
  ] };
  const outcomes = busy.scheduleOutcomes(answer, ["team@example.test", "boss@example.test", "missing@example.test"]);
  assert.deepEqual(outcomes.get("boss@example.test"), { ok: false, error: "graph-mailbox" });
  assert.deepEqual(outcomes.get("missing@example.test"), { ok: false, error: "graph" });
  const team = outcomes.get("team@example.test");
  assert.equal(team.ok, true);
  const spans = busy.graphBusy(team.items, DEFAULT, twelveWeeks).map((span) => [iso(span.start), iso(span.end)]);
  assert.deepEqual(spans, [["2026-11-24T09:00:00Z", "2026-11-24T11:00:00Z"], ["2026-11-28T09:00:00Z", "2026-11-28T10:00:00Z"]], "busy and tentative merged; free, elsewhere and the whole day out");
  assert.equal(busy.graphBusy(team.items, ALL, twelveWeeks).length, 5, "with the rules off the free ones and the whole day count too");
  assert.ok(!JSON.stringify(spans).includes("Geheim") && !JSON.stringify(spans).includes("Raum"));
  assert.deepEqual([...busy.scheduleOutcomes({ error: { code: "x" } }, ["a@example.test"]).values()], [{ ok: false, error: "graph" }]);
});

test("links: webcal becomes https, only iCloud and Outlook, no credentials", () => {
  const icloud = rules.readCalendarLink("  webcal://p68-caldav.icloud.com/published/2/MTIzNDU2Nzg5MDEyMzQ1Ng#x ");
  assert.deepEqual(icloud, { ok: true, url: "https://p68-caldav.icloud.com/published/2/MTIzNDU2Nzg5MDEyMzQ1Ng", provider: "icloud" });
  assert.equal(rules.readCalendarLink("https://outlook.office365.com/owa/calendar/abc@example.test/def/reachcalendar.ics").provider, "outlook");
  for (const bad of ["", "keine Adresse", "http://p68-caldav.icloud.com/published/2/x", "https://calendar.google.com/calendar/ical/x/basic.ics", "https://icloud.com.evil.example/x",
    "https://user:pass@p68-caldav.icloud.com/x", "https://p68-caldav.icloud.com:8443/x", "https://127.0.0.1/x", "webcal://localhost/x", `https://p68-caldav.icloud.com/${"x".repeat(2000)}`]) {
    assert.equal(rules.readCalendarLink(bad).ok, false, bad.slice(0, 60));
  }
  assert.equal(rules.providerOfHost("P68-CALDAV.ICLOUD.COM"), "icloud");
  assert.equal(rules.readSourceName("  Privat   Termine ", "iCloud-Kalender"), "Privat Termine");
  assert.equal(rules.readSourceName("", "iCloud-Kalender"), "iCloud-Kalender");
  assert.deepEqual(rules.readSourceRules({ ignoreAllDay: false }), { ignoreAllDay: false, ignoreFree: true });
  assert.equal(rules.readMailbox(" Team@Example.Test "), "team@example.test");
  assert.equal(rules.readMailbox("kein postfach"), null);
});

test("Microsoft 365 settings: off without all three values, the mailboxes to choose from, words for every failure", () => {
  const tenant = "0b6f4f0e-2c1a-4d7e-9a51-3f2e8d7c6b5a";
  const client = "1b6f4f0e-2c1a-4d7e-9a51-3f2e8d7c6b5a";
  assert.equal(rules.microsoftConfig({}), null);
  assert.equal(rules.microsoftConfig({ HUB_MS365_TENANT_ID: tenant, HUB_MS365_CLIENT_ID: client }), null);
  assert.equal(rules.microsoftConfig({ HUB_MS365_TENANT_ID: "kaputt mit leerzeichen", HUB_MS365_CLIENT_ID: client, HUB_MS365_CLIENT_SECRET: "geheim-12345" }), null);
  assert.deepEqual(rules.microsoftConfig({ HUB_MS365_TENANT_ID: ` ${tenant} `, HUB_MS365_CLIENT_ID: client, HUB_MS365_CLIENT_SECRET: "geheim-12345" }), { tenant, client, secret: "geheim-12345" });
  assert.equal(rules.microsoftConfig({ HUB_MS365_TENANT_ID: "contoso.onmicrosoft.com", HUB_MS365_CLIENT_ID: client, HUB_MS365_CLIENT_SECRET: "geheim-12345" }).tenant, "contoso.onmicrosoft.com");
  assert.deepEqual(rules.microsoftMailboxes({ HUB_MS365_MAILBOXES: "team@example.test, Termine@example.test;kaputt" }, "Me@Example.test"), [
    { address: "me@example.test", own: true }, { address: "team@example.test", own: false }, { address: "termine@example.test", own: false },
  ]);
  assert.deepEqual(rules.microsoftMailboxes({}, null), []);
  for (const code of Object.keys(rules.FETCH_ERRORS)) assert.ok(rules.fetchErrorText(code).length > 10, code);
  assert.equal(rules.fetchErrorText("neu"), "Der Kalender konnte nicht gelesen werden.");
  assert.equal(rules.sourceState({ lastSuccessAt: null, failingSince: null }), "new");
  assert.equal(rules.sourceState({ lastSuccessAt: "2026-11-22T10:00:00Z", failingSince: null }), "ok");
  assert.equal(rules.sourceState({ lastSuccessAt: "2026-11-22T10:00:00Z", failingSince: "2026-11-22T11:00:00Z" }), "failing");
  const now = Date.parse("2026-11-23T13:00:00Z");
  assert.equal(rules.failingFor("2026-11-22T11:00:00Z", now), "seit 26 Stunden");
  assert.equal(rules.failingFor("2026-11-19T11:00:00Z", now), "seit 4 Tagen");
  assert.equal(rules.failingFor("2026-11-23T12:30:00Z", now), "seit wenigen Minuten");
  assert.equal(rules.sourceLabel({ provider: "icloud", name: "Privat" }), "iCloud · Privat");
  assert.equal(rules.sourceLabel({ provider: "microsoft", name: "Postfach Team" }), "Microsoft 365 · Postfach Team");
});

test("the server: links sealed and never read back for the panel, every hop checked, only admins, the schedule reads them", async () => {
  const store = await source("lib/hub-calendar/sources-store.ts");
  assert.match(store, /^import "server-only";/);
  assert.match(store, /const COLUMNS = "id, owner_id, kind, provider, name, mailbox, ignore_all_day, ignore_free, created_at, last_fetched_at, last_success_at, last_error, failing_since, alerted_at, busy_count";/);
  assert.match(store, /listSources[\s\S]*?\.select\(COLUMNS\)/, "the list for the panel never selects the sealed link");
  assert.match(store, /const ownerOf = \(id: string\) => \(\{ kind: "calendar-source" as const, id \}\);/);
  assert.match(store, /sealSecret\(key, ownerOf\(id\), input\.url\)/);
  assert.match(store, /redirect: "manual"/);
  assert.match(store, /for \(let hop = 0; hop < 4; hop\+\+\) \{\n\s+const checked = readCalendarLink\(url\);/, "every redirect passes the same host check");
  assert.match(store, /kind: "calendar\.source", mail_state: "skipped"/, "the notice is bell only");
  assert.match(store, /href: `\$\{CALENDAR_PATH\}\?avail=1`/);
  assert.match(store, /Prefer: 'outlook\.timezone="UTC"'/);
  const view = await source("lib/hub-calendar/sources-rules.ts");
  const fields = /export type SourceView = \{([\s\S]*?)\n\};/.exec(view)[1];
  assert.doesNotMatch(fields, /\b(link|url|ciphertext)\b/i, "the panel's view of a source has no link");
  const actions = await source("lib/hub-calendar/actions.ts");
  assert.match(actions, /async function sourcesAdmin\(\) \{\n\s+const admin = await verifyHubAdmin\(\);/);
  assert.match(actions, /export async function loadCalendarSources\(\)[^{]*\{\n\s+const admin = await sourcesAdmin\(\);\n\s+return admin \? sourcesState\(admin\) : sourcesDenied;/);
  for (const name of ["addCalendarSource", "saveCalendarSourceRules", "replaceCalendarSourceLink", "removeCalendarSource"]) {
    assert.match(actions, new RegExp(`export async function ${name}\\([^)]*\\)[^{]*\\{\\n\\s+const admin = await sourcesAdmin\\(\\);\\n\\s+if \\(!admin\\) return sourcesDenied;`), name);
  }
  assert.match(await source("app/api/notifications/sweep/route.ts"), /await syncCalendarSources\(\)\.then\(/);
});

test("the calendar: grey „Privat“ blocks for admins only, customers just see busy; the bell knows the notice", async () => {
  const server = await source("lib/hub-calendar/server.ts");
  assert.match(server, /canManage \? loadPrivateBlocks\(from, to\)\.catch\(\(\) => \[\]\) : \[\]/);
  const calendar = await source("components/hub/screens/calendar.tsx");
  assert.match(calendar, /const privateOn = useCallback\(\(date: string\) => admin \? /);
  assert.match(calendar, /admin && params\.get\("avail"\) === "1" \? \{ kind: "avail" \}/);
  const views = await source("components/hub/screens/calendar-views.tsx");
  assert.match(views, /className=\{`cal-ev is-private/);
  assert.match(views, /<span className="cal-ev-title">Privat<\/span>/);
  const store = await source("components/hub/screens/calendar-store.ts");
  assert.match(store, /\.\.\.\(state\.privateBusy \?\? \[\]\)\.map\(\(\{ start, end \}\) => \(\{ start, end \}\)\)/);
  const { noticeColumns } = await import("../lib/hub-notify/columns.ts");
  assert.equal(noticeColumns({ kind: "calendar.source", title: "Kalender nicht erreichbar: iCloud · Privat", body: "Seit mehr als 24 Stunden." }, "admin").where, "Kalender");
  assert.match(await source("components/hub/notice-symbols.ts"), /if \(kind === "calendar\.source"\) return \{ icon: CalendarX2, color: categories\.calendar\.fill, area: "Kalender" \};/);
});
