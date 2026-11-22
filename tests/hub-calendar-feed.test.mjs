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

const feed = await import("../lib/hub-calendar/feed.ts");
const rules = await import("../lib/hub-calendar/feed-rules.ts");
// Windows checkouts may carry CRLF line endings; the source checks below compare LF text.
const source = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

const origin = "https://hub.oalab.de";
const now = Date.parse("2026-11-22T12:00:00Z");
const viewerId = "8d4f1c2e-1111-4a6b-9c0d-2e3f4a5b6c7d";
const appointment = (patch = {}) => ({
  id: "0b6f4f0e-2c1a-4d7e-9a51-3f2e8d7c6b5a", title: "Abstimmung Website", description: "Agenda: Texte, Bilder; Ablauf",
  startsAt: "2026-11-24T09:00:00+00:00", endsAt: "2026-11-24T10:00:00+00:00", status: "confirmed",
  teamsUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0", updatedAt: "2026-11-20T13:12:05.123+00:00", company: "Sommer Studio", ...patch,
});
const request = (patch = {}) => appointment({ id: "1b6f4f0e-2c1a-4d7e-9a51-3f2e8d7c6b5a", title: "Logo-Feedback", status: "requested", teamsUrl: null, startsAt: "2026-11-26T13:00:00Z", endsAt: "2026-11-26T13:30:00Z", ...patch });
const options = (patch = {}) => ({ ...rules.DEFAULT_FEED_OPTIONS, ...patch });
const events = (role, patch = {}, input = {}) => feed.feedEvents({ role, options: options(patch), origin, now, viewerId, appointments: [appointment(), request()], ...input });
const goal = (patch = {}) => ({ projectId: "p-1", name: "Website-Relaunch", company: "Sommer Studio", day: "2026-11-25", done: false, ...patch });
const task = (patch = {}) => ({ id: "t-1", number: 214, title: "Bilder liefern", day: "2026-11-26", projectName: "Website-Relaunch", company: "Sommer Studio", done: false, customerTurn: true, visible: true, assigneeIds: [viewerId], ...patch });

test("keys: 32 random bytes as base64url, the database keeps only their SHA-256", async () => {
  const token = feed.newFeedToken();
  assert.match(token, rules.FEED_TOKEN);
  assert.notEqual(feed.newFeedToken(), token);
  assert.match(feed.feedTokenHash(token), /^[0-9a-f]{64}$/);
  assert.equal(feed.feedTokenHash(token), feed.feedTokenHash(token));
  assert.notEqual(feed.feedTokenHash(token), token);
  // The store writes the checksum, never the key; the key leaves createFeed once.
  const store = await source("lib/hub-calendar/feed-store.ts");
  assert.match(store, /\[userId, HUB_ROLES\[role\], feedTokenHash\(token\), JSON\.stringify/);
  assert.match(store, /where f\.token_hash = \$1 and f\.revoked_at is null/);
  assert.doesNotMatch(store, /token\s*:\s*token|insert into[^;]*\btoken\b,/);
});

test("addresses: https for copying, webcal for Apple, Google and Outlook with the address filled in", () => {
  const url = rules.feedUrl(origin, "A".repeat(43));
  assert.equal(url, `https://hub.oalab.de/api/calendar/feed/${"A".repeat(43)}/oalab.ics`);
  assert.equal(rules.webcalUrl(url), `webcal://hub.oalab.de/api/calendar/feed/${"A".repeat(43)}/oalab.ics`);
  const google = new URL(rules.googleSubscribeUrl(url));
  assert.equal(`${google.origin}${google.pathname}`, "https://calendar.google.com/calendar/render");
  assert.equal(google.searchParams.get("cid"), rules.webcalUrl(url));
  const outlook = new URL(rules.outlookSubscribeUrl(url));
  assert.equal(outlook.origin, "https://outlook.office.com");
  assert.equal(outlook.searchParams.get("url"), url);
  assert.equal(outlook.searchParams.get("name"), "oalab");
});

test("choices: standard confirmed and requests, freelancers never goals or tasks, the task scope only for admins", () => {
  assert.deepEqual(rules.feedOptionsFor("customer", null), { requests: true, goals: false, tasks: false, taskScope: "mine" });
  assert.deepEqual(rules.feedOptionsFor("admin", { requests: false, goals: true, tasks: true, taskScope: "all" }), { requests: false, goals: true, tasks: true, taskScope: "all" });
  assert.deepEqual(rules.feedOptionsFor("freelancer", { requests: true, goals: true, tasks: true, taskScope: "all" }), { requests: true, goals: false, tasks: false, taskScope: "mine" });
  assert.deepEqual(rules.feedOptionsFor("customer", { tasks: true, taskScope: "all", goals: "ja" }), { requests: true, goals: false, tasks: true, taskScope: "mine" });
  assert.deepEqual(rules.feedOptionsFor("admin", ["requests"]), rules.DEFAULT_FEED_OPTIONS);
  assert.equal(rules.feedRoleOf("oalab_admin"), "admin");
  assert.equal(rules.feedRoleOf("oalab_customer"), "customer");
  assert.equal(rules.feedRoleOf("oalab_freelancer"), "freelancer");
  assert.equal(rules.feedRoleOf("oalab_operator"), null);
  assert.equal(rules.feedContents("admin", rules.feedOptionsFor("admin", { goals: true, tasks: true })), "Bestätigte Termine, offene Anfragen, Projektziele, deine Aufgaben mit Fälligkeit");
  assert.equal(rules.feedContents("customer", rules.feedOptionsFor("customer", { requests: false, tasks: true })), "Bestätigte Termine, Aufgaben, bei denen du am Zug bist");
});

test("entries per role: admins with the customer in front, customers and freelancers with „· oalab“", () => {
  const [admin, adminRequest] = events("admin");
  assert.equal(admin.summary, "Sommer Studio: Abstimmung Website");
  assert.equal(adminRequest.summary, "Anfrage: Sommer Studio: Logo-Feedback");
  const internal = feed.feedEvents({ role: "admin", options: options(), origin, now, viewerId, appointments: [appointment({ company: null, title: "Wochenplanung" })] });
  assert.equal(internal[0].summary, "Wochenplanung");
  for (const role of ["customer", "freelancer"]) {
    const [own, ownRequest] = events(role);
    assert.equal(own.summary, "Abstimmung Website · oalab");
    assert.equal(ownRequest.summary, "Anfrage: Logo-Feedback · oalab");
  }
});

test("an appointment: UID as in the mail files, UTC, Teams link as place and in the notes, the way back, a reminder", () => {
  const [event] = events("customer");
  assert.equal(event.uid, "0b6f4f0e-2c1a-4d7e-9a51-3f2e8d7c6b5a@hub.oalab.de");
  assert.equal(event.start, "2026-11-24T09:00:00Z");
  assert.equal(event.end, "2026-11-24T10:00:00Z");
  assert.equal(event.status, "CONFIRMED");
  assert.equal(event.location, "https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0");
  assert.equal(event.url, "https://hub.oalab.de/dashboard/projects/calendar?appointment=0b6f4f0e-2c1a-4d7e-9a51-3f2e8d7c6b5a");
  assert.equal(event.description, "Teams-Besprechung beitreten:\nhttps://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0\n\nAgenda: Texte, Bilder; Ablauf\n\nTermin im oalab Client Hub:\nhttps://hub.oalab.de/dashboard/projects/calendar?appointment=0b6f4f0e-2c1a-4d7e-9a51-3f2e8d7c6b5a");
  assert.equal(event.sequence, Math.floor(Date.parse("2026-11-20T13:12:05.123Z") / 1000));
  assert.equal(event.alarm, true);
  const long = feed.feedEvents({ role: "customer", options: options(), origin, now, viewerId, appointments: [appointment({ description: "x".repeat(5000) })] });
  assert.ok(long[0].description.length < 1300);
});

test("requests only while open and wanted; declined and cancelled never, they vanish with the next fetch", () => {
  const [, pending] = events("customer");
  assert.equal(pending.status, "TENTATIVE");
  assert.equal(pending.alarm, false);
  assert.match(pending.description, /^Anfrage: noch nicht bestätigt\./);
  assert.equal(events("customer", { requests: false }).length, 1);
  const past = feed.feedEvents({ role: "customer", options: options(), origin, now, viewerId, appointments: [request({ startsAt: "2026-11-20T09:00:00Z", endsAt: "2026-11-20T09:30:00Z" })] });
  assert.equal(past.length, 0);
  const closed = feed.feedEvents({ role: "admin", options: options(), origin, now, viewerId, appointments: [appointment({ status: "cancelled" }), appointment({ id: "x", status: "declined" })] });
  assert.equal(closed.length, 0);
});

test("the window: 90 days back to 12 months ahead, at most 2000 entries with the oldest dropping out", () => {
  const at = (start) => appointment({ id: start, startsAt: start, endsAt: new Date(Date.parse(start) + 3_600_000).toISOString() });
  const window = feed.feedWindow(now);
  assert.equal(new Date(window.from).toISOString(), "2026-08-24T12:00:00.000Z");
  assert.equal(new Date(window.to).toISOString(), "2027-11-22T12:00:00.000Z");
  const list = feed.feedEvents({ role: "customer", options: options(), origin, now, viewerId, appointments: [at("2026-08-20T10:00:00Z"), at("2026-08-25T10:00:00Z"), at("2027-11-20T10:00:00Z"), at("2027-11-23T10:00:00Z")] });
  assert.deepEqual(list.map((event) => event.start), ["2026-08-25T10:00:00Z", "2027-11-20T10:00:00Z"]);
  const many = Array.from({ length: 2050 }, (_, index) => at(new Date(now + index * 3_600_000).toISOString()));
  const capped = feed.feedEvents({ role: "admin", options: options(), origin, now, viewerId, appointments: many });
  assert.equal(capped.length, 2000);
  assert.equal(capped[0].start, many[50].startsAt.replace(/\.\d{3}Z$/, "Z"));
});

test("goals and tasks: all day, only when switched on, by role", () => {
  assert.equal(events("customer", {}, { goals: [goal()], tasks: [task()] }).length, 2);
  const customer = events("customer", { goals: true, tasks: true }, { goals: [goal(), goal({ projectId: "p-2", done: true })], tasks: [task(), task({ id: "t-2", customerTurn: false }), task({ id: "t-3", visible: false }), task({ id: "t-4", done: true })] });
  const goalEntry = customer.find((event) => event.uid === "goal-p-1@hub.oalab.de");
  assert.equal(goalEntry.summary, "Ziel: Website-Relaunch · oalab");
  assert.equal(goalEntry.allDay, true);
  assert.equal(goalEntry.start, "2026-11-25");
  assert.equal(goalEntry.end, "2026-11-26");
  assert.equal(goalEntry.alarm, false);
  assert.deepEqual(customer.filter((event) => event.uid.startsWith("task-")).map((event) => event.summary), ["Aufgabe: Bilder liefern · oalab"]);
  assert.equal(customer.filter((event) => event.uid.startsWith("goal-")).length, 1);

  const admin = (scope) => events("admin", { goals: true, tasks: true, taskScope: scope }, { goals: [goal()], tasks: [task(), task({ id: "t-2", number: 219, title: "Impressum prüfen", assigneeIds: ["someone-else"], customerTurn: false, visible: false })] });
  assert.deepEqual(admin("mine").filter((event) => event.uid.startsWith("task-")).map((event) => event.summary), ["Sommer Studio: #214 Bilder liefern"]);
  assert.equal(admin("all").filter((event) => event.uid.startsWith("task-")).length, 2);
  assert.equal(admin("mine").find((event) => event.uid.startsWith("goal-")).summary, "Ziel: Sommer Studio: Website-Relaunch");

  const freelancer = feed.feedEvents({ role: "freelancer", options: { requests: true, goals: true, tasks: true, taskScope: "all" }, origin, now, viewerId, appointments: [], goals: [goal()], tasks: [task()] });
  assert.equal(freelancer.length, 0);
});

test("the calendar text: header, CRLF, folding, escaping, UTC and all-day dates", () => {
  const list = events("admin", { goals: true }, { goals: [goal()], appointments: [appointment({ title: "Abnahme, Teil 2; mit Ü", description: "Zeile 1\nZeile 2 \\ Ende" }), request()] });
  const text = feed.feedCalendar(list);
  assert.ok(text.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/(?<!\r)\n/.test(text), "every line ends in CRLF");
  for (const line of text.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, `line too long: ${line}`);
  const unfolded = text.replace(/\r\n /g, "");
  for (const header of ["BEGIN:VCALENDAR", "VERSION:2.0", "METHOD:PUBLISH", "NAME:oalab", "X-WR-CALNAME:oalab", "X-WR-TIMEZONE:Europe/Berlin", "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M"]) {
    assert.ok(unfolded.includes(`\r\n${header}\r\n`) || unfolded.startsWith(`${header}\r\n`), header);
  }
  assert.match(unfolded, /SUMMARY:Sommer Studio: Abnahme\\, Teil 2\\; mit Ü\r\n/);
  assert.match(unfolded, /DESCRIPTION:Teams-Besprechung beitreten:\\nhttps:\/\/teams[^\r]*\\n\\nZeile 1\\nZeile 2 \\\\ Ende\\n\\nTermin im oalab Client Hub/);
  assert.match(unfolded, /DTSTART:20261124T090000Z\r\nDTEND:20261124T100000Z/);
  assert.match(unfolded, /DTSTART;VALUE=DATE:20261125\r\nDTEND;VALUE=DATE:20261126/);
  assert.match(unfolded, /UID:goal-p-1@hub\.oalab\.de[\s\S]*?TRANSP:TRANSPARENT\r\nEND:VEVENT/);
  assert.match(unfolded, /STATUS:TENTATIVE\r\nTRANSP:OPAQUE\r\nEND:VEVENT/);
  assert.equal([...unfolded.matchAll(/BEGIN:VALARM\r\nACTION:DISPLAY\r\n[^\r]*\r\nTRIGGER:-PT15M\r\nEND:VALARM/g)].length, 1, "a reminder for the confirmed appointment only");
  assert.equal([...unfolded.matchAll(/BEGIN:VEVENT/g)].length, 3);
});

test("ETag: the same content gives the same tag, any change a new one; If-None-Match also weak or in a list", () => {
  const one = feed.feedCalendar(events("customer"));
  assert.equal(feed.feedCalendar(events("customer")), one, "an unchanged feed is byte for byte the same");
  const tag = feed.feedEtag(one);
  assert.match(tag, /^"[0-9a-f]{32}"$/);
  assert.notEqual(feed.feedEtag(feed.feedCalendar(events("customer", { requests: false }))), tag);
  assert.equal(feed.etagMatches(tag, tag), true);
  assert.equal(feed.etagMatches(`W/${tag}`, tag), true);
  assert.equal(feed.etagMatches(`"abc", ${tag}`, tag), true);
  assert.equal(feed.etagMatches("*", tag), true);
  assert.equal(feed.etagMatches('"abc"', tag), false);
  assert.equal(feed.etagMatches(null, tag), false);
});

test("the program, never more of the User-Agent, and how long ago it fetched", () => {
  assert.equal(rules.feedClient("macOS/26.1 (25B78) CalendarAgent/1004"), "apple");
  assert.equal(rules.feedClient("iOS/26.1 (23B85) dataaccessd/1.0"), "apple");
  assert.equal(rules.feedClient("Google-Calendar-Importer"), "google");
  assert.equal(rules.feedClient("Microsoft Office/16.0 (Macintosh; Mac OS X 15.1; Microsoft Outlook 16.91)"), "microsoft");
  assert.equal(rules.feedClient("Thunderbird/128"), "other");
  assert.equal(rules.feedClient(null), "other");
  assert.equal(rules.fetchedAgo(null, now), "noch nie");
  assert.equal(rules.fetchedAgo(new Date(now - 20_000).toISOString(), now), "gerade eben");
  assert.equal(rules.fetchedAgo(new Date(now - 6 * 60_000).toISOString(), now), "vor 6 Minuten");
  assert.equal(rules.fetchedAgo(new Date(now - 60_000).toISOString(), now), "vor 1 Minute");
  assert.equal(rules.fetchedAgo(new Date(now - 2 * 3_600_000).toISOString(), now), "vor 2 Stunden");
  assert.equal(rules.fetchedAgo(new Date(now - 3 * 86_400_000).toISOString(), now), "vor 3 Tagen");
});

test("the address answers: 404 for a wrong, ended or malformed key, 429 over the limit, the calendar with ETag and 304", async () => {
  const key = feed.newFeedToken();
  const body = feed.feedCalendar(events("customer"));
  const seen = [];
  const sources = (take, read = async () => body) => ({ ready: true, take: async (token, client) => { seen.push(client); return take(token); }, body: read });
  const known = async (token) => token === key ? { ok: true, userId: viewerId, role: "customer", options: options() } : { ok: false, reason: "unknown" };
  const call = (token, init = {}, file = "oalab.ics", head = false, src = sources(known)) =>
    feed.feedResponse(new Request(`https://hub.oalab.de/api/calendar/feed/${token}/${file}`, { method: head ? "HEAD" : "GET", ...init }), token, file, head, src);

  for (const response of [await call(feed.newFeedToken()), await call("kurz"), await call(key, {}, "andere.ics"), await call(key, {}, "oalab.ics", false, { ...sources(known), ready: false })]) {
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "Nicht gefunden.");
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const ended = await call(key, {}, "oalab.ics", false, sources(async () => ({ ok: false, reason: "unknown" })));
  assert.equal(ended.status, 404, "an ended key answers like one that never existed");

  const ok = await call(key, { headers: { "user-agent": "iOS/26.1 (23B85) dataaccessd/1.0" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "text/calendar; charset=utf-8");
  assert.equal(ok.headers.get("referrer-policy"), "no-referrer");
  assert.equal(ok.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(ok.headers.get("etag"), feed.feedEtag(body));
  assert.equal(await ok.text(), body);
  assert.equal(seen.at(-1), "apple");

  const again = await call(key, { headers: { "if-none-match": feed.feedEtag(body) } });
  assert.equal(again.status, 304);
  assert.equal(await again.text(), "");
  const head = await call(key, {}, "oalab.ics", true);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  const limited = await call(key, {}, "oalab.ics", false, sources(async () => ({ ok: false, reason: "limited", retryAfter: 1200 })));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "1200");
  const down = await call(key, {}, "oalab.ics", false, sources(known, async () => null));
  assert.equal(down.status, 503);
  const broken = await call(key, {}, "oalab.ics", false, sources(async () => { throw new Error("db"); }));
  assert.equal(broken.status, 503);
});

test("the route reads with the person's rights and creating needs a confirmed code for admins and freelancers", async () => {
  const route = await source("app/api/calendar/feed/[token]/[file]/route.ts");
  assert.match(route, /export async function GET\(/);
  assert.match(route, /export async function HEAD\(/);
  assert.match(route, /feedResponse\(request, token, file, (false|true), sources\(request\)\)/);
  const server = await source("lib/hub-calendar/feed-server.ts");
  assert.match(server, /^import "server-only";/);
  assert.match(server, /const claims = await connectorClaims\(input\.userId\)/);
  assert.match(server, /const viewer = createOwnClaimsClient\(claims\)/);
  assert.match(server, /viewer\.from\("hub_appointments"\)/);
  assert.doesNotMatch(server, /db\.from\("hub_appointments"\)/, "appointments never with the server key");
  const actions = await source("lib/hub-calendar/actions.ts");
  assert.match(actions, /if \(login\.role !== "customer" && !login\.confirmed\) return needsCode;/);
  assert.match(actions, /confirmed: session\.aal === "aal2"/);
  const store = await source("lib/hub-calendar/feed-store.ts");
  assert.match(store, /coalesce\(u\.raw_app_meta_data ->> 'app_role', ''\) = f\.role/);
  assert.match(store, /p\.status = 'active'/);
  assert.match(store, /make_interval\(days => \$\{FEED_IDLE_DAYS\}\)/);
  assert.equal(rules.FEED_IDLE_DAYS, 180);
  assert.equal(rules.FEED_FETCHES_PER_HOUR, 60);
});
