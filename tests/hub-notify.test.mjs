import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CHAT_MAIL_WAIT_MINUTES, MAIL_WAIT_MINUTES, appointmentNotice, calendarRows, chatHref, chatNotice, describeProjectChange, detectStudioNotices, dueDigests, fileNotice,
  mailsWanted, mergeTaskNotice, nextCursor, noticeAppointment, noticeChat, projectState, readFrom, skipsMail, taskState,
  TASK_NOTICE_KINDS, hasTaskChange, taskAudience, taskBoardHref, taskChangeParts, taskNotice, taskNoticePrefix, LIVE_LINES, liveVersion,
  mergeShareNotice, shareNotice, sharedAreasOf, fileNoticeCount, fileNoticeLine, filesNotice, mergeFileNotice,
} from "../lib/hub-notify/rules.ts";
import { noticeColumns } from "../lib/hub-notify/columns.ts";
import { noticeDigestMail } from "../lib/hub-mail/templates.ts";
import { TELEGRAM_TEXT_LIMIT, telegramChatMessage, telegramConfig, telegramTestMessage } from "../lib/hub-telegram/rules.ts";

// Windows checkouts may carry CRLF line endings; the source checks below compare LF text.
const source = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

const project = { id: "p1", organization_id: "org1", display_name: "Website", status: "active" };
const details = { project_id: "p1", status: "active", due_date: "2026-11-20", client_visible: true };
const task = (patch = {}) => ({ id: "t1", project_id: "p1", task_number: 12, title: "Logo freigeben", status: "todo", labels: ["Kunde"], client_visible: true, archived: false, ...patch });
const event = (type, patch = {}) => ({ created_at: "2026-10-30T10:00:00.000000+00:00", event_type: type, project_id: "p1", task_id: type.startsWith("task.") ? "t1" : null, ...patch });

test("a task lies with the customer only when released, open, not archived and labelled Kunde", () => {
  assert.equal(taskState(task()), "customer");
  assert.equal(taskState(task({ labels: [" kunde "] })), "customer");
  for (const patch of [{ client_visible: false }, { archived: true }, { status: "done" }, { labels: ["Intern"] }, { labels: null }]) {
    assert.equal(taskState(task(patch)), "other", JSON.stringify(patch));
  }
});

test("moving a task to the customer notifies once; re-reading the same event does not", () => {
  const first = detectStudioNotices({ activity: [event("task.update")], tasks: [task()], details: [details], projects: [project], marks: new Map([["task:t1", "other"]]) });
  assert.equal(first.notices.length, 1);
  assert.deepEqual(first.notices[0], {
    organizationId: "org1",
    notice: { kind: "task.customer", title: "Du bist am Zug: Logo freigeben", body: "Website · Aufgabe #12", href: "/dashboard/projects?project=p1" },
  });
  assert.equal(first.marks.get("task:t1"), "customer");
  const again = detectStudioNotices({ activity: [event("task.update")], tasks: [task()], details: [details], projects: [project], marks: first.marks });
  assert.equal(again.notices.length, 0);
  assert.equal(again.marks.size, 0);
});

test("unknown tasks only get a mark, new tasks at the customer notify, hidden projects never do", () => {
  const unknown = detectStudioNotices({ activity: [event("task.update")], tasks: [task()], details: [details], projects: [project], marks: new Map() });
  assert.equal(unknown.notices.length, 0);
  assert.equal(unknown.marks.get("task:t1"), "customer");
  const created = detectStudioNotices({ activity: [event("task.insert")], tasks: [task()], details: [details], projects: [project], marks: new Map() });
  assert.equal(created.notices.length, 1);
  const hidden = detectStudioNotices({ activity: [event("task.insert")], tasks: [task()], details: [{ ...details, client_visible: false }], projects: [project], marks: new Map() });
  assert.equal(hidden.notices.length, 0);
  const archived = detectStudioNotices({ activity: [event("task.insert")], tasks: [task()], details: [details], projects: [{ ...project, status: "archived" }], marks: new Map() });
  assert.equal(archived.notices.length, 0);
  // Leaving the customer only moves the mark, so the next move back notifies again.
  const left = detectStudioNotices({ activity: [event("task.update")], tasks: [task({ status: "done" })], details: [details], projects: [project], marks: new Map([["task:t1", "customer"]]) });
  assert.equal(left.notices.length, 0);
  assert.equal(left.marks.get("task:t1"), "other");
});

test("project notices name what changed in Studio's status and target date", () => {
  assert.equal(projectState(details), "active|2026-11-20");
  assert.equal(describeProjectChange("active|2026-11-20", "hold|2026-11-20"), "Status: Aktiv → Pausiert");
  assert.equal(describeProjectChange("active|2026-11-20", "active|2026-12-04"), "Zieltermin: 4. Dezember 2026");
  assert.equal(describeProjectChange("active|2026-11-20", "complete|"), "Status: Aktiv → Abgeschlossen · Zieltermin entfernt");
  const changed = detectStudioNotices({ activity: [event("project.update")], tasks: [], details: [{ ...details, status: "risk" }], projects: [project], marks: new Map([["project:p1", "active|2026-11-20"]]) });
  assert.deepEqual(changed.notices.map((item) => item.notice), [{ kind: "project.changed", title: "Projekt aktualisiert: Website", body: "Status: Aktiv → Risiko", href: "/dashboard/projects?project=p1" }]);
  const first = detectStudioNotices({ activity: [event("project.update")], tasks: [], details: [details], projects: [project], marks: new Map() });
  assert.equal(first.notices.length, 0);
  assert.equal(first.marks.get("project:p1"), "active|2026-11-20");
});

test("the cursor reads a little back and only moves forward", () => {
  assert.equal(readFrom("2026-10-30T10:00:00.000Z"), "2026-10-30T09:50:00.000Z");
  assert.equal(readFrom("kaputt"), null);
  const cursor = "2026-10-30T10:00:00.000Z";
  assert.equal(nextCursor(cursor, [{ created_at: "2026-10-30T09:55:00+00:00" }]), cursor);
  assert.equal(nextCursor(cursor, [{ created_at: "2026-10-30T10:02:00.123456+00:00" }, { created_at: "2026-10-30T10:01:00+00:00" }]), "2026-10-30T10:02:00.123456+00:00");
});

test("a mail is due 15 minutes after the first notice and bundles everything pending, read or not", () => {
  const now = new Date("2026-10-30T12:00:00Z");
  const at = (minutes) => new Date(now.getTime() - minutes * 60_000).toISOString();
  const row = (id, user, minutes, read = false) => ({ id, user_id: user, created_at: at(minutes), read_at: read ? at(1) : null, title: `Meldung ${id}`, body: "", href: "/dashboard" });
  assert.equal(MAIL_WAIT_MINUTES, 15);
  const due = dueDigests([row(1, "anna", 16), row(2, "anna", 2), row(3, "anna", 10, true), row(4, "ben", 14)], now);
  assert.deepEqual(due.map((digest) => digest.userId), ["anna"]);
  // Notice 3 was already opened in the bell; it goes into the mail all the same.
  assert.deepEqual(due[0].rows.map((item) => item.id), [1, 3, 2]);
  assert.equal("unread" in due[0], false);
  assert.equal(mailsWanted({}), true);
  assert.equal(mailsWanted(null), true);
  assert.equal(mailsWanted({ hub_mail_notifications: false }), false);
});

test("appointment notices tell new, confirmed, moved, cancelled and declined apart", () => {
  const startsAt = "2026-11-06T09:00:00.000Z";
  const appointmentId = "0b6f4f0e-2c1a-4d7e-9a51-3f2e8d7c6b5a";
  const notice = (patch) => appointmentNotice({ id: appointmentId, title: "Abstimmung", startsAt, status: "confirmed", before: null, ...patch });
  assert.equal(notice({}).kind, "appointment.created");
  // Since 16.11.2026 the calendar lives under Projekte; notices sent before keep their old address and still count.
  assert.equal(notice({}).href, `/dashboard/projects/calendar?appointment=${appointmentId}`);
  assert.equal(noticeAppointment(notice({ status: "cancelled" }).href), appointmentId);
  assert.equal(noticeAppointment(`/dashboard/calendar?appointment=${appointmentId}`), appointmentId, "an older notice");
  for (const href of [
    "/dashboard/calendar", "/dashboard/projects/calendar", "/dashboard/files", `/dashboard/calendar?appointment=${appointmentId}&x=1`,
    `/dashboard/projects/calendar?appointment=${appointmentId}&x=1`, "/dashboard/projects/calendar?appointment=1", `/dashboard/projects/tasks?appointment=${appointmentId}`,
  ]) assert.equal(noticeAppointment(href), null, href);
  // ICU writes "Fr., 6. November um 10:00"; older versions put a comma instead of "um".
  assert.match(notice({}).body, /^Fr\., 6\. November(,| um) 10:00 Uhr$/);
  assert.equal(notice({ before: { status: "requested", startsAt } }).kind, "appointment.confirmed");
  assert.equal(notice({ before: { status: "confirmed", startsAt: "2026-11-05T09:00:00.000Z" } }).kind, "appointment.changed");
  assert.equal(notice({ before: { status: "confirmed", startsAt } }), null);
  assert.equal(notice({ status: "cancelled", note: "Krank" }).title, "Termin abgesagt: Abstimmung");
  assert.match(notice({ status: "cancelled", note: "Krank" }).body, / · Krank$/);
  assert.equal(notice({ status: "declined" }).kind, "appointment.declined");
  // The file's own link opens it in the files page.
  assert.deepEqual(fileNotice("Servicevertrag", "9d2e41c0-1b2c-4d3e-8f40-5a6b7c8d9e0f"), { kind: "file.shared", title: "Neue Datei: Servicevertrag", body: "Im Bereich Dateien", href: "/dashboard/files?file=9d2e41c0-1b2c-4d3e-8f40-5a6b7c8d9e0f" });
});

const HUB = { hubUrl: "https://hub.oalab.de/dashboard", settingsUrl: "https://hub.oalab.de/dashboard/settings" };

test("one notice comes as a mail of its own: headline by kind, the notice escaped, a button to its place", () => {
  const one = noticeDigestMail({ firstName: "Jana", items: [{ kind: "task.customer", title: "Du bist am Zug: <Logo>", body: "Website · Aufgabe #12", url: "https://hub.oalab.de/dashboard/projects?project=p1" }], more: 0, ...HUB });
  assert.equal(one.subject, "Du bist am Zug: <Logo>");
  assert.match(one.html, />Du bist am Zug<\/h1>/);
  // The card leaves out what the headline already says.
  assert.match(one.html, />&lt;Logo&gt;<\/div>/);
  assert.doesNotMatch(one.html, /<Logo>/);
  assert.match(one.html, /Wartet auf dich/);
  assert.match(one.text, /^Aufgabe öffnen: https:\/\/hub\.oalab\.de\/dashboard\/projects\?project=p1$/m);
  assert.match(one.text, /unter „Profil“/);
  assert.match(one.text, /^Benachrichtigungen verwalten: https:\/\/hub\.oalab\.de\/dashboard\/settings$/m);
  assert.ok(["logo", "area-projects"].every((id) => one.images.includes(id)), one.images.join());
  // A link that is not http(s) never makes it in; the button then leads into the hub.
  const unsafe = noticeDigestMail({ items: [{ kind: "file.shared", title: "Neue Datei: x", body: "", url: "javascript:alert(1)" }], more: 0, ...HUB });
  assert.doesNotMatch(unsafe.html, /javascript:/);
  assert.match(unsafe.text, /^Datei ansehen: https:\/\/hub\.oalab\.de\/dashboard$/m);
  // An unknown kind still gets a mail.
  assert.match(noticeDigestMail({ items: [{ kind: "neu", title: "Etwas Neues", body: "" }], more: 0, ...HUB }).html, />Neu im Client Hub<\/h1>/);
});

test("several notices come as a list, each with its own link, and the rest stays in the hub", () => {
  const many = noticeDigestMail({ firstName: "", items: [
    { kind: "task.customer", title: "Du bist am Zug: A", body: "", url: "https://hub.oalab.de/dashboard/projects?project=p1" },
    { kind: "file.shared", title: "Neue Datei: B", body: "Im Bereich Dateien", url: "https://hub.oalab.de/dashboard/files?file=f1" },
  ], more: 3, ...HUB });
  assert.equal(many.subject, "Neu im Client Hub: 5 Neuigkeiten");
  assert.match(many.html, />5 Neuigkeiten für dich<\/h1>/);
  assert.match(many.text, /Eine Aufgabe wartet auf dich, der Rest ist zur Info\./);
  assert.match(many.text, /^Aufgabe öffnen: https:\/\/hub\.oalab\.de\/dashboard\/projects\?project=p1$/m);
  assert.match(many.text, /^Datei ansehen: https:\/\/hub\.oalab\.de\/dashboard\/files\?file=f1$/m);
  assert.match(many.text, /3 weitere Neuigkeiten findest du im Hub\./);
  assert.match(many.text, /^Alles im Client Hub ansehen: https:\/\/hub\.oalab\.de\/dashboard$/m);
  assert.ok(["area-news", "area-projects", "area-files"].every((id) => many.images.includes(id)));
  assert.doesNotMatch(many.html, /In deinen Kalender eintragen/);
});

test("new, confirmed and moved appointments get calendar buttons once, while still confirmed and not over", () => {
  const a = "0b6f4f0e-2c1a-4d7e-9a51-3f2e8d7c6b5a";
  const b = "1c7a5e1f-3d2b-4e8f-8b62-4a3f9e8d7c6b";
  const c = "2d8b6f2a-4e3c-4f9a-9c73-5b4a0f9e8d7c";
  const href = (id) => `/dashboard/projects/calendar?appointment=${id}`;
  const rows = [
    // A notice from before 16.11.2026, with the calendar's old address.
    { id: 1, kind: "appointment.created", href: `/dashboard/calendar?appointment=${a}` },
    { id: 2, kind: "appointment.changed", href: href(a) },
    { id: 3, kind: "appointment.confirmed", href: href(b) },
    { id: 4, kind: "appointment.created", href: href(c) },
    { id: 5, kind: "appointment.cancelled", href: href(b) },
    { id: 6, kind: "file.shared", href: "/dashboard/files" },
  ];
  const now = new Date("2026-10-30T14:00:00Z");
  const appointments = new Map([
    [a, { status: "confirmed", ends_at: "2026-11-06T11:00:00+00:00" }],
    [b, { status: "confirmed", ends_at: "2026-11-12T10:00:00+00:00" }],
    [c, { status: "confirmed", ends_at: "2026-10-30T13:00:00+00:00" }],
  ]);
  // a: only its latest notice; b: the confirmation (the cancel notice gets none); c: over already.
  assert.deepEqual([...calendarRows(rows, appointments, now)], [[2, a], [3, b]]);
  appointments.set(a, { status: "cancelled", ends_at: "2026-11-06T11:00:00+00:00" });
  assert.deepEqual([...calendarRows(rows, appointments, now)], [[3, b]]);
  assert.deepEqual([...calendarRows(rows, new Map(), now)], []);
});

test("appointment mails carry the calendar links: a block in a mail of its own, compact links in a list, and in the text", () => {
  const calendar = {
    ics: "https://hub.oalab.de/api/calendar/x/oalab-termin.ics?sig=abc",
    google: "https://hub.oalab.de/api/calendar/x/google?sig=abc",
    outlook: "https://hub.oalab.de/api/calendar/x/outlook?sig=abc",
  };
  const ics = /href="https:\/\/hub\.oalab\.de\/api\/calendar\/x\/oalab-termin\.ics\?sig=abc"/g;
  const textLinks = /In deinen Kalender eintragen:\nApple Kalender und andere Apps \(\.ics\): https:\/\/hub\.oalab\.de\/api\/calendar\/x\/oalab-termin\.ics\?sig=abc\nGoogle Kalender: https:\/\/hub\.oalab\.de\/api\/calendar\/x\/google\?sig=abc\nOutlook \(Microsoft 365\): https:\/\/hub\.oalab\.de\/api\/calendar\/x\/outlook\?sig=abc\n/;
  const created = { kind: "appointment.created", title: "Neuer Termin: Kickoff", body: "Di., 10. November um 14:00 Uhr", url: "https://hub.oalab.de/dashboard/calendar?appointment=x", calendar };

  // On its own: the block with four buttons, each app with a hint where it is used; Apple and "Andere" get the .ics file.
  const one = noticeDigestMail({ items: [created], more: 0, ...HUB });
  assert.match(one.html, />In deinen Kalender eintragen<\/div>/);
  for (const label of ["Apple Kalender", "Google Kalender", "Outlook", "Andere Kalender-App"]) assert.match(one.html, new RegExp(`>${label}</span>`));
  assert.equal((one.html.match(ics) ?? []).length, 4);
  assert.match(one.html, /href="https:\/\/hub\.oalab\.de\/api\/calendar\/x\/google\?sig=abc"/);
  assert.doesNotMatch(one.html, /alten Eintrag/);
  assert.match(one.text, textLinks);
  assert.ok(["calendar-tile", "brand-apple", "brand-google", "brand-microsoft", "calendar-file"].every((id) => one.images.includes(id)));
  // Each button shows the mark of its calendar, the one for other apps the download symbol.
  for (const [id, label] of [["brand-apple", "Apple Kalender"], ["brand-google", "Google Kalender"], ["brand-microsoft", "Outlook"], ["calendar-file", "Andere Kalender-App"]]) {
    assert.match(one.html, new RegExp(`cid:${id}@hub\\.oalab\\.de"(?:(?!cid:)[^])*>${label}</span>`));
  }

  // In a list: compact links under the appointment.
  const list = noticeDigestMail({ firstName: "Jana", items: [created, { kind: "file.shared", title: "Neue Datei: Vertrag", body: "Im Bereich Dateien" }], more: 0, ...HUB });
  assert.equal((list.html.match(/In deinen Kalender eintragen/g) ?? []).length, 1);
  for (const label of ["Apple", "Google", "Outlook", ".ics-Datei"]) assert.match(list.html, new RegExp(`>${label.replace(/\./g, "\\.")}</a>`));
  assert.equal((list.html.match(ics) ?? []).length, 2);
  assert.match(list.text, new RegExp(`Di\\., 10\\. November um 14:00 Uhr\\n${textLinks.source}`));

  // A moved appointment asks to remove the old private entry, on its own and in a list.
  const moved = { ...created, kind: "appointment.changed", title: "Termin verschoben: Kickoff", calendar: { ...calendar, moved: true } };
  for (const mail of [noticeDigestMail({ items: [moved], more: 0, ...HUB }), noticeDigestMail({ items: [moved, created], more: 0, ...HUB })]) {
    assert.match(mail.html, /Schon in deinem Kalender\? Lösch dort den alten Eintrag/);
    assert.match(mail.text, /Schon in deinem Kalender\? Lösch dort den alten Eintrag/);
  }
  assert.match(noticeDigestMail({ items: [moved], more: 0, ...HUB }).html, />Neue Zeit in deinen Kalender<\/div>/);

  // Links that are not http(s) leave the calendar part out entirely.
  const broken = { ics: "javascript:alert(1)", google: "javascript:x", outlook: "data:x" };
  for (const mail of [noticeDigestMail({ items: [{ ...created, calendar: broken }], more: 0, ...HUB }), noticeDigestMail({ items: [{ ...created, calendar: broken }, created], more: 0, ...HUB })]) {
    assert.doesNotMatch(mail.html, /javascript:|data:x/);
  }
  const unsafe = noticeDigestMail({ items: [{ ...created, calendar: broken }], more: 0, ...HUB });
  assert.doesNotMatch(unsafe.html, /In deinen Kalender eintragen/);
  assert.doesNotMatch(unsafe.text, /In deinen Kalender eintragen/);
});

test("calendar subscribers get one sentence instead of the four buttons; everyone else the way to subscribe", async () => {
  const calendar = {
    ics: "https://hub.oalab.de/api/calendar/x/oalab-termin.ics?sig=abc",
    google: "https://hub.oalab.de/api/calendar/x/google?sig=abc",
    outlook: "https://hub.oalab.de/api/calendar/x/outlook?sig=abc",
    subscribe: "https://hub.oalab.de/dashboard/projects/calendar?abo=1",
  };
  const created = { kind: "appointment.created", title: "Neuer Termin: Kickoff", body: "Di., 10. November um 14:00 Uhr", url: "https://hub.oalab.de/dashboard/calendar?appointment=x", calendar };

  // Without a subscription: the buttons as before, and below them the way to a calendar that stays current.
  const plain = noticeDigestMail({ items: [created], more: 0, ...HUB });
  assert.match(plain.html, />In deinen Kalender eintragen<\/div>/);
  assert.match(plain.html, /Immer aktuell statt einer Kopie: <a class="link" href="https:\/\/hub\.oalab\.de\/dashboard\/projects\/calendar\?abo=1"[^>]*>Kalender abonnieren<\/a>/);
  assert.match(plain.text, /Immer aktuell statt einer Kopie, Kalender abonnieren: https:\/\/hub\.oalab\.de\/dashboard\/projects\/calendar\?abo=1/);

  // With one: the sentence, no button and no link to a copy, on its own, in a list and in the text.
  const subscribed = { ...created, calendar: { ...calendar, subscribed: true } };
  const one = noticeDigestMail({ items: [subscribed], more: 0, ...HUB });
  assert.match(one.html, /Steht automatisch in deinem Kalender „oalab“<\/div>/);
  assert.match(one.html, /Verschiebt oder sagt oalab den Termin ab, ändert sich der Eintrag von selbst\. Du musst nichts tun\./);
  assert.doesNotMatch(one.html, /In deinen Kalender eintragen|api\/calendar\/x\/|Kalender abonnieren/);
  assert.ok(one.images.includes("glyph-badge-check"));
  assert.ok(!one.images.includes("brand-apple"));
  assert.match(one.text, /Steht automatisch in deinem Kalender „oalab“\. Verschiebt oder sagt oalab den Termin ab/);
  assert.doesNotMatch(one.text, /In deinen Kalender eintragen|api\/calendar\/x\//);
  const list = noticeDigestMail({ items: [subscribed, { kind: "file.shared", title: "Neue Datei: Vertrag", body: "Im Bereich Dateien" }], more: 0, ...HUB });
  assert.match(list.html, /Steht automatisch in deinem Kalender „oalab“<\/div>/);
  assert.doesNotMatch(list.html, /In deinen Kalender eintragen|api\/calendar\/x\//);
  // A moved appointment: no request to remove the old entry, the new time comes by itself.
  const moved = noticeDigestMail({ items: [{ ...subscribed, kind: "appointment.changed", title: "Termin verschoben: Kickoff", calendar: { ...calendar, subscribed: true, moved: true } }], more: 0, ...HUB });
  assert.match(moved.html, /Die neue Zeit kommt beim nächsten Abruf von selbst/);
  assert.doesNotMatch(moved.html, /alten Eintrag/);
  // A subscriber's sentence needs no signed links: without the token it stands all the same.
  const unsigned = noticeDigestMail({ items: [{ ...created, calendar: { ics: "", google: "", outlook: "", subscribed: true } }], more: 0, ...HUB });
  assert.match(unsigned.html, /Steht automatisch in deinem Kalender „oalab“/);
  // In dark mode the green box stays readable.
  assert.match(one.html, /\.okbox\{background:#16301D !important\}/);
  assert.match(one.html, /\.okink\{color:#9EE2AE !important\}/);

  const server = await source("lib/hub-notify/server.ts");
  assert.match(server, /await loginsWithFeed\(\[\.\.\.new Set\(digests\.map\(\(digest\) => digest\.userId\)\)\]\)\.catch\(\(\) => new Set<string>\(\)\)/);
  assert.match(server, /subscribed, subscribe: `\$\{origin\}\$\{CALENDAR_PATH\}\?abo=1`/);
});

test("the schedule needs its token, rows are written by the server and read only by their owner", async () => {
  const route = await source("app/api/notifications/sweep/route.ts");
  assert.match(route, /const token = process\.env\.HUB_NOTIFY_TOKEN\?\.trim\(\);\n  if \(!token\) return new Response\([^)]*\{ status: 503 \}\);\n  if \(!authorized\(request\.headers\.get\("authorization"\), token\)\) return new Response\("Unauthorized", \{ status: 401 \}\);/);
  assert.match(route, /timingSafeEqual/);
  assert.match(await source("lib/supabase/proxy.ts"), /pathname === "\/api\/notifications\/sweep"/);
  const server = await source("lib/hub-notify/server.ts");
  assert.match(server, /^import "server-only";/);
  // Only active customer logins hear about their own customers; mails respect the profile switch.
  assert.match(server, /\.from\("hub_profiles"\)\.select\("user_id"\)\.in\("user_id", ids\)\.eq\("status", "active"\)/);
  assert.match(server, /mailsWanted\(login\.data\.user\?\.user_metadata\)/);
  assert.match(server, /update\(\{ mail_state: "sending" \}\)[\s\S]*?\.eq\("mail_state", "pending"\)/);
  const actions = await source("lib/hub-notify/actions.ts");
  assert.match(actions, /^"use server";/);
  assert.doesNotMatch(actions, /createAdminClient/);
  // The appointment window and the Claude connector save through the same code, so both notify (lib/hub-calendar/write.ts).
  assert.match(await source("lib/hub-calendar/write.ts"), /await notifyCustomers\(/);
  assert.match(await source("lib/hub-calendar/actions.ts"), /writeAppointment\(supabase, id, input\)/);
  // Files reach the customers and the freelancers who look after them, each as "Sichtbar für" allows.
  assert.match(await source("lib/hub-files/actions.ts"), /await notifyFileShared\(/);
  assert.match(server, /export async function notifyFileShared\(fileId: string, customerIds: string\[\], notice: Notice/);
  assert.match(server, /const forCustomers = only\.customer \? customerIds\.filter\(\(id\) => audienceOf\.get\(id\) !== "freelancer"\) : \[\];/);
  assert.match(server, /filter\(\(link\) => audienceOf\.get\(link\.customer_id\) !== "customer"\)/);
});

test("new files make one line in the bell: a single file keeps its own, several are counted with the newest names", async () => {
  const id = (n) => `9d2e41c0-1b2c-4d3e-8f40-5a6b7c8d9e0${n}`;
  const logo = fileNotice("Logo", id(1));
  const offer = fileNotice("Angebot", id(2));
  const brief = fileNotice("Briefing", id(3));
  assert.deepEqual(fileNoticeLine([logo]), logo);
  assert.deepEqual(fileNoticeLine([logo, offer]), { kind: "file.shared", title: "2 neue Dateien", body: "Logo und Angebot", href: "/dashboard/files" });
  assert.deepEqual(fileNoticeLine([logo, offer, brief]), { kind: "file.shared", title: "3 neue Dateien", body: "Logo, Angebot und 1 weitere", href: "/dashboard/files" });
  // An unread line takes in the next files: the count grows, the newest names come first, the link leads to the files.
  assert.equal(fileNoticeCount("Neue Datei: Logo"), 1);
  assert.equal(fileNoticeCount("12 neue Dateien"), 12);
  assert.deepEqual(mergeFileNotice("Neue Datei: Logo", [offer]), { kind: "file.shared", title: "2 neue Dateien", body: "Angebot und Logo", href: "/dashboard/files" });
  assert.deepEqual(mergeFileNotice("3 neue Dateien", [brief]), { kind: "file.shared", title: "4 neue Dateien", body: "Briefing und 3 weitere", href: "/dashboard/files" });
  assert.ok(filesNotice(["x".repeat(200), "y".repeat(200)], 5).body.length <= 300, "the body fits the column");
  // Every file notice goes through the one delivery that merges; only unread lines whose mail waits take more files.
  const server = await source("lib/hub-notify/server.ts");
  assert.match(server, /async function deliverFileNotice\(db: SupabaseClient, userIds: string\[\], notices: Notice\[\]\)/);
  assert.match(server, /\.eq\("kind", "file\.shared"\)\.is\("read_at", null\)\.eq\("mail_state", "pending"\)/);
  assert.doesNotMatch(server.split("export async function notifyFileShared(")[1].split("\nexport ")[0], /insertNotices/);
  // Several files at once (Zuordnen) reach each side once, as „Sichtbar für“ allows.
  assert.match(server, /export async function notifyFilesShared\(files: \{ id: string; title: string \}\[\], customerId: string\)/);
  assert.match(server, /noticesOf\(files\.filter\(\(file\) => audienceOf\.get\(file\.id\) !== "freelancer"\)\)/);
  assert.match(server, /noticesOf\(files\.filter\(\(file\) => audienceOf\.get\(file\.id\) !== "customer"\)\)/);
});

test("a file notice opens its file: the link names it and the files page opens what a link names", async () => {
  const actions = await source("lib/hub-files/actions.ts");
  assert.match(actions, /notifyFileShared\(data\.id, customerIds, fileNotice\(title, data\.id\)\)/);
  assert.match(actions, /notifyFileShared\(fileId, added, fileNotice\(file\.data\.title, fileId\)\)/);
  const files = await source("components/hub/screens/files.tsx");
  assert.match(files, /const linkedFile = useSearchParams\(\)\.get\("file"\);\s+const \[openId, setOpenId\] = useState<string \| null>\(\(\) => files\.some\(\(file\) => file\.id === linkedFile\) \? linkedFile : null\);/);
});

test("chat notices: one line per chat and recipient, admins' mails after a few minutes, chats read in time stay out", () => {
  const customerId = "5f0c2a8e-1b7d-4c3e-9a2f-6d8e1b0c7a44";
  const message = chatNotice({ kind: "chat.message", customerId, company: "Nordlicht Studio", author: "Jana Sommer", body: "Dienstag passt.\n\nBringt ihr die Zahlen mit?" });
  assert.deepEqual(message, { kind: "chat.message", title: "Neue Nachricht von Nordlicht Studio", body: "Jana Sommer: Dienstag passt. Bringt ihr die Zahlen mit?", href: `/dashboard/messages?chat=${customerId}` });
  // To the customer: oalab, and its people by first name as in the chat; a second message updates the same notice.
  const reply = chatNotice({ kind: "chat.reply", customerId, company: "Nordlicht Studio", author: "Lena Schneider", body: "Machen wir!", more: true });
  assert.equal(reply.title, "Neue Nachrichten von oalab");
  assert.equal(reply.body, "Lena: Machen wir!");
  assert.equal(chatNotice({ kind: "chat.message", customerId, company: "X", author: "", body: "a".repeat(400) }).body.length, 300);
  assert.equal(noticeChat(chatHref(customerId)), customerId);
  assert.equal(noticeChat("/dashboard/messages?chat=../x"), null);

  const now = new Date("2026-11-04T12:00:00Z");
  const at = (minutes) => new Date(now.getTime() - minutes * 60_000).toISOString();
  const row = (id, user, kind, minutes, read = false) => ({ id, user_id: user, kind, created_at: at(minutes), read_at: read ? at(1) : null, title: "", body: "", href: "/dashboard" });
  assert.equal(CHAT_MAIL_WAIT_MINUTES, 5);
  // The admin's chat message is due after five minutes, a customer's file notice only after fifteen.
  assert.deepEqual(dueDigests([row(1, "admin", "chat.message", 6), row(2, "kunde", "file.shared", 6)], now).map((digest) => digest.userId), ["admin"]);
  assert.deepEqual(dueDigests([row(1, "admin", "chat.message", 4)], now), []);
  // Chat notices read in the hub stay out of the mail; every other notice goes in, read or not.
  assert.equal(skipsMail(row(1, "admin", "chat.message", 6, true)), true);
  assert.equal(skipsMail(row(2, "kunde", "chat.reply", 20, true)), true);
  assert.equal(skipsMail(row(3, "kunde", "chat.reply", 20)), false);
  assert.equal(skipsMail(row(4, "kunde", "file.shared", 20, true)), false);
});

test("chat messages notify the other side, never the writer, and the sweep drops chats read in time", async () => {
  const server = await source("lib/hub-notify/server.ts");
  const notify = server.slice(server.indexOf("export async function notifyChat"));
  assert.match(notify, /input\.side === "customer" \? activeAdminLogins\(db\) : customerLogins\(db, \[input\.customerId\]\)/);
  assert.match(notify, /const to = recipients\.filter\(\(id\) => id !== input\.authorId\);/);
  // A waiting notice of the same chat takes the new line instead of a second one.
  assert.match(notify, /\.in\("user_id", to\)\.is\("read_at", null\)\.eq\("mail_state", "pending"\)/);
  assert.match(server, /filter\(\(user\) => roleOf\(user\) === "oalab_admin"\)/);
  assert.match(server, /const seen = \(pending\.data \?\? \[\]\)\.filter\(skipsMail\)\.map\(\(row\) => row\.id\);/);
  assert.match(server, /update\(\{ mail_state: "skipped" \}\)\.in\("id", seen\)\.eq\("mail_state", "pending"\)/);
});

test("chat notices in the mail: the messages area, a single chat as its own mail, several as customers who wait", () => {
  const single = noticeDigestMail({ firstName: "Lena", items: [{ kind: "chat.message", title: "Neue Nachricht von Nordlicht Studio", body: "Jana Sommer: Dienstag passt.", url: "https://hub.oalab.de/dashboard/messages?chat=1" }], more: 0, hubUrl: "https://hub.oalab.de/dashboard" });
  assert.equal(single.subject, "Neue Nachricht von Nordlicht Studio");
  assert.match(single.html, /Ein Kunde hat geschrieben/);
  assert.match(single.html, /cid:area-messages@hub\.oalab\.de/);
  assert.match(single.html, /Chat öffnen/);
  const several = noticeDigestMail({ items: [
    { kind: "chat.message", title: "Neue Nachricht von Nordlicht Studio", body: "Jana Sommer: …" },
    { kind: "chat.message", title: "Neue Nachrichten von Atelier Brandt", body: "Paul Brandt: …" },
  ], more: 0, hubUrl: "https://hub.oalab.de/dashboard" });
  assert.match(several.html, /Im privaten Chat des Client Hub warten 2 Kunden auf eine Antwort\./);
  const reply = noticeDigestMail({ items: [{ kind: "chat.reply", title: "Neue Nachricht von oalab", body: "Lena: Machen wir!" }], more: 0, hubUrl: "https://hub.oalab.de/dashboard" });
  assert.match(reply.html, /Neue Nachricht von oalab/);
  assert.match(reply.html, /Nachricht lesen/);
});

test("Telegram: only with a real token and group; company and name in bold, the text below, a button into the hub", () => {
  const token = "123456789:AAH8sQ2-xYzAbCdEfGhIjKlMnOpQrStUvWx";
  assert.deepEqual(telegramConfig({ TELEGRAM_BOT_TOKEN: ` ${token} `, TELEGRAM_CHAT_ID: "-1001234567890" }), { token, chatId: "-1001234567890" });
  assert.equal(telegramConfig({ TELEGRAM_BOT_TOKEN: token }), null);
  assert.equal(telegramConfig({ TELEGRAM_BOT_TOKEN: "abc", TELEGRAM_CHAT_ID: "-1001234567890" }), null);
  assert.equal(telegramConfig({ TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: "Gruppe" }), null);
  assert.ok(telegramConfig({ TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: "-5521501477" }), "the number of a plain group");
  const url = "https://hub.oalab.de/dashboard/messages?chat=5f0c2a8e-1b7d-4c3e-9a2f-6d8e1b0c7a44";
  const message = telegramChatMessage({ company: "  Nordlicht\nStudio ", author: "Jana Sommer", body: "Dienstag passt.\r\nBringt ihr die <Zahlen> & *Folien* mit?", url });
  assert.deepEqual(message, {
    text: "Nordlicht Studio · Jana Sommer\nDienstag passt.\nBringt ihr die <Zahlen> & *Folien* mit?",
    entities: [{ type: "bold", offset: 0, length: "Nordlicht Studio · Jana Sommer".length }],
    reply_markup: { inline_keyboard: [[{ text: "Im Hub öffnen", url }]] },
  });
  // The text is never read as formatting: no parse mode, the bold line is an entity.
  assert.equal("parse_mode" in message, false);
  // Long messages are cut below the limit of Telegram, with a note; the head stays.
  const long = telegramChatMessage({ company: "X", author: "", body: "a".repeat(5000), url });
  assert.ok(long.text.length < 4096);
  assert.match(long.text, /^X\na{3500} …\n\n\(gekürzt, die ganze Nachricht steht im Hub\)$/);
  assert.equal(TELEGRAM_TEXT_LIMIT, 3500);
  // Telegram takes no button to a local address; the link then stands in the text.
  const local = telegramChatMessage({ company: "", author: "", body: "Hallo", url: "http://localhost:3006/dashboard/messages?chat=1" });
  assert.equal(local.text, "Kunde\nHallo\n\nhttp://localhost:3006/dashboard/messages?chat=1");
  assert.equal("reply_markup" in local, false);
  assert.match(telegramTestMessage().text, /Testmeldung/);
});

test("every customer message goes to the Telegram group with name and text, answers do not, and the token is never logged", async () => {
  const server = await source("lib/hub-notify/server.ts");
  const notify = server.slice(server.indexOf("export async function notifyChat"));
  assert.match(notify, /if \(kind === "chat\.message"\) await sendTelegram\(telegramChatMessage\(\{ company: input\.company, author: name, body: input\.body, url: `\$\{input\.origin\}\$\{chatHref\(input\.customerId\)\}` \}\)\);/);
  // Sent before the early return, so the group hears of it even without an admin login to notify.
  assert.ok(notify.indexOf("sendTelegram(") < notify.indexOf("if (!to.length) return;"));
  // No longer once per chat: every message goes, read or not.
  assert.doesNotMatch(notify, /\.is\("read_at", null\)\.limit\(1\)/);
  const telegram = await source("lib/hub-telegram/server.ts");
  assert.match(telegram, /^import "server-only";/);
  assert.match(telegram, /fetch\(`https:\/\/api\.telegram\.org\/bot\$\{config\.token\}\/sendMessage`/);
  assert.doesNotMatch(telegram, /console\.\w+\([^)]*(config|token|url|message\b)/);
  const actions = await source("lib/hub-telegram/actions.ts");
  assert.match(actions, /^"use server";/);
  assert.equal((actions.match(/if \(!\(await verifyHubAdmin\(\)\)\) return adminsOnly;/g) ?? []).length, 2);
  // The setup lives in the environment, documented with the other variables.
  assert.match(await source(".env.example"), /# TELEGRAM_BOT_TOKEN=.*\n# TELEGRAM_CHAT_ID=/);
  assert.match(await source("README.md"), /\| `TELEGRAM_BOT_TOKEN` \| Secret \|/);
});

// Task board notices (17.11.2026) ----------------------------------------------------------------------------------

const sight = (patch = {}) => ({ teamOnly: false, clientVisible: false, archived: false, customerState: "other", ...patch });
const boardDraft = (parts, kind = "task.changed") => ({ kind, taskTitle: "Startseite", prefix: taskNoticePrefix("Website", 12), parts, href: taskBoardHref("p1", 12) });

test("task notices name what changed: the team reads everything and who did it, the customer only what they see", () => {
  const change = { status: "In Arbeit", due: "2026-11-20", fields: ["assignees", "title", "description"], comment: "Ist fertig · bitte prüfen\n\nDanke", checklist: { state: "done", title: "Logo" } };
  assert.deepEqual(taskChangeParts(change, "team", "Omed"), [
    "Status: In Arbeit", "Fällig: 20. November 2026", "Geändert: Titel, Beschreibung, Zuständige", "Kommentar: „Ist fertig - bitte prüfen Danke“", "Checkliste: „Logo“ erledigt", "von Omed",
  ]);
  assert.deepEqual(taskChangeParts(change, "customer", "Omed"), ["Status: In Arbeit", "Fällig: 20. November 2026", "Geändert: Titel"]);
  assert.deepEqual(taskChangeParts({ due: null }, "team"), ["Fälligkeit entfernt"]);
  assert.deepEqual(taskChangeParts({ archived: true }, "team", "Ali"), ["Archiviert", "von Ali"]);
  assert.deepEqual(taskChangeParts({ checklist: { state: "removed" } }, "team"), ["Checkliste: ein Punkt entfernt"]);
  assert.equal(taskChangeParts({ comment: "x".repeat(200) }, "team")[0].length, "Kommentar: „“".length + 80);
  assert.equal(hasTaskChange({}), false);
  assert.equal(hasTaskChange({ due: null }), true);
  assert.deepEqual(TASK_NOTICE_KINDS, ["task.created", "task.changed"]);
});

test("task notices go to who sees the card: freelancers unless „Nur Team“, customers when released, new when only now visible", () => {
  const audience = (before, after, change, projectReleased = true) => taskAudience({ before, after, projectReleased, change });
  // A new card: everybody who sees it hears „Neue Aufgabe“.
  assert.deepEqual(audience(null, sight(), { created: true }), { freelancers: "task.created", customers: null });
  assert.deepEqual(audience(null, sight({ clientVisible: true }), { created: true }), { freelancers: "task.created", customers: "task.created" });
  assert.deepEqual(audience(null, sight({ teamOnly: true }), { created: true }), { freelancers: null, customers: null });
  // A released card in a project the customer does not see yet stays with the team.
  assert.deepEqual(audience(null, sight({ clientVisible: true }), { created: true }, false), { freelancers: "task.created", customers: null });
  // Changes: the customer hears only what they see.
  const shared = sight({ clientVisible: true });
  assert.deepEqual(audience(shared, shared, { status: "In Arbeit" }), { freelancers: "task.changed", customers: "task.changed" });
  assert.deepEqual(audience(shared, shared, { comment: "Intern" }), { freelancers: "task.changed", customers: null });
  assert.deepEqual(audience(shared, shared, { fields: ["assignees"] }), { freelancers: "task.changed", customers: null });
  // „Nur Team“ → „+ Freelancer“: new for the freelancers; „+ Kunde“: new for the customer.
  assert.deepEqual(audience(sight({ teamOnly: true }), sight(), { fields: ["audience"] }), { freelancers: "task.created", customers: null });
  assert.deepEqual(audience(sight(), shared, { fields: ["audience"] }), { freelancers: "task.changed", customers: "task.created" });
  // Back to „Nur Team“: the freelancers hear nothing more.
  assert.deepEqual(audience(sight(), sight({ teamOnly: true }), { fields: ["audience"] }), { freelancers: null, customers: null });
  // Handed to the customer: „Du bist am Zug“ from the sweep says it, no second line.
  const waiting = sight({ clientVisible: true, customerState: "customer" });
  assert.deepEqual(audience(shared, waiting, { status: "Offen" }), { freelancers: "task.changed", customers: null });
  assert.deepEqual(audience(null, waiting, { created: true }), { freelancers: "task.created", customers: null });
  assert.deepEqual(audience(waiting, waiting, { fields: ["title"] }), { freelancers: "task.changed", customers: "task.changed" });
  // Archiving tells the freelancers who saw the card, never the customer.
  const archived = sight({ clientVisible: true, archived: true });
  assert.deepEqual(audience(archived, archived, { archived: true }), { freelancers: "task.changed", customers: null });
  const teamArchived = sight({ teamOnly: true, archived: true });
  assert.deepEqual(audience(teamArchived, teamArchived, { archived: true }), { freelancers: null, customers: null });
});

test("task notices: one line per card while unread, newest first, a new card stays new", () => {
  const first = taskNotice(boardDraft(["Status: In Arbeit", "von Omed"]));
  assert.deepEqual(first, { kind: "task.changed", title: "Aufgabe geändert: Startseite", body: "Website · #12 · Status: In Arbeit · von Omed", href: "/dashboard/projects/tasks?project=p1&task=12" });
  // A later status replaces the earlier one, the fields add up, the newest actor is named.
  const second = mergeTaskNotice(first, boardDraft(["Status: In Prüfung", "Geändert: Titel", "von Ali"]));
  assert.equal(second.body, "Website · #12 · Status: In Prüfung · Geändert: Titel · von Ali");
  const third = mergeTaskNotice(second, boardDraft(["Geändert: Beschreibung", "Kommentar: „Passt“", "von Omed"]));
  assert.equal(third.body, "Website · #12 · Geändert: Beschreibung, Titel · Kommentar: „Passt“ · von Omed · Status: In Prüfung");
  // „Neue Aufgabe“ stays until read, whatever follows; the title follows the card's current title.
  const created = taskNotice(boardDraft(["von Omed"], "task.created"));
  assert.equal(created.title, "Neue Aufgabe: Startseite");
  const moved = mergeTaskNotice(created, { ...boardDraft(["Status: In Arbeit", "von Omed"]), taskTitle: "Startseite neu" });
  assert.equal(moved.kind, "task.created");
  assert.equal(moved.title, "Neue Aufgabe: Startseite neu");
  // A line from a renamed project starts over; long lines keep their newest parts and the limit.
  assert.equal(mergeTaskNotice({ kind: "task.changed", body: "Alt · #12 · Status: Offen" }, boardDraft(["Status: Erledigt"])).body, "Website · #12 · Status: Erledigt");
  const long = mergeTaskNotice(first, boardDraft([`Kommentar: „${"x".repeat(290)}“`]));
  assert.equal(long.body.length, 300);
  assert.ok(long.body.startsWith("Website · #12 · Kommentar"));
  assert.equal(taskNotice({ ...boardDraft([]), taskTitle: "t".repeat(400) }).title.length, 200);
});

test("task notices are written by the hub after the response, never to the person who made the change", async () => {
  const server = await source("lib/hub-notify/server.ts");
  const notify = server.slice(server.indexOf("export async function notifyTaskChange"));
  assert.match(notify, /const others = \(ids: string\[\]\) => ids\.filter\(\(id\) => id !== input\.actorId\);/);
  assert.match(notify, /studio_project_freelancers"\)\.select\("freelancer_id"\)\.eq\("project_id", card\.project_id\)/);
  // Admins hear of freelancers' changes in the bell only.
  assert.match(notify, /if \(input\.actorFreelancer\) \{[\s\S]*?activeAdminLogins\(db\)[\s\S]*?"skipped"\);/);
  assert.match(notify, /\.eq\("organization_id", project\.data\.organization_id\)\.eq\("kind", "customer"\)/);
  assert.match(notify, /projectHref\(card\.project_id\)/);
  // One line per card: unread lines whose mail is not on its way take the change.
  assert.match(server, /\.eq\("href", draft\.href\)\.in\("kind", \[\.\.\.TASK_NOTICE_KINDS\]\)\s+\.is\("read_at", null\)\.in\("mail_state", \["pending", "skipped"\]\)/);
  // Failures are logged with the kind and the code, never names or addresses.
  assert.match(server, /console\.error\(`\[hub-notify\] \$\{what\} failed`, code \|\| message \|\| "unknown"\);/);
  assert.doesNotMatch(server, /console\.error\([^)]*(email|first_name|title|body)/);

  const write = await source("lib/hub-tasks/write.ts");
  assert.match(write, /after\(\(\) => notifyTaskChange\(\{ taskId, actorId: ctx\.userId, actorFreelancer: ctx\.freelancer, change, before \}\)\);/);
  for (const call of [
    "tellOthers(ctx, data.id, { created: true });",
    "if (before) tellOthers(ctx, taskId, diffTask(before, data), before);",
    "if (before) tellOthers(ctx, taskId, diffTask(before, { ...data, description }), before);",
    "tellOthers(ctx, taskId, { comment: body });",
    'tellOthers(ctx, taskId, { checklist: { state: "added", title: data.title } });',
  ]) assert.ok(write.includes(call), call);
  const actions = await source("lib/hub-tasks/actions.ts");
  assert.ok(actions.includes("tellOthers(ctx, taskId, { archived: true });"));
  assert.ok(actions.includes('tellOthers(ctx, taskId, { checklist: { state: "removed" } });'));
  const assistant = await source("lib/hub-assistant/actions.ts");
  assert.ok(assistant.includes("for (const row of rows) tellOthers({ userId: ctx.userId, freelancer: false }, row.id, { created: true });"));
  assert.ok(assistant.includes("tellOthers({ userId: ctx.userId, freelancer: false }, change.taskId, diffTask(current.data, write.data[0]), current.data);"));
});

test("task notices in the mail and the bell: their own words and the task symbol", async () => {
  const mail = noticeDigestMail({ firstName: "Lena", items: [{ kind: "task.created", title: "Neue Aufgabe: Startseite", body: "Website · #12", url: "https://hub.example/dashboard/projects?project=p1" }], more: 0, hubUrl: "https://hub.example/dashboard" });
  assert.match(mail.html, /Eine neue Aufgabe/);
  assert.match(mail.html, /Aufgabe öffnen/);
  const changed = noticeDigestMail({ items: [{ kind: "task.changed", title: "Aufgabe geändert: Startseite", body: "Website · #12 · Status: In Arbeit" }], more: 0, hubUrl: "https://hub.example/dashboard" });
  assert.match(changed.html, /Eine Aufgabe wurde geändert/);
  const panel = await source("components/hub/notifications-panel.tsx");
  assert.match(panel, /kind === "task\.customer" \|\| kind === "task\.created" \|\| kind === "task\.changed"\) return \{ icon: ListTodo/);
  assert.match(panel, /freelancer: "Hier erscheint, wenn jemand eine Aufgabe in deinen Projekten anlegt/);
});

test("the bell shows the unread count and rings until it was opened, still with reduced motion", async () => {
  const shell = await source("components/hub/app-shell.tsx");
  assert.match(shell, /const ringing = unreadCount > 0 && newestUnread > \(Number\(bellSeen\) \|\| 0\);/);
  assert.match(shell, /if \(next === "notifications" && newestUnread\) setBellSeen\(String\(newestUnread\)\);/);
  assert.match(shell, /badge=\{unreadCount\}\s+className=\{`bell-button\$\{ringing \? " is-ringing" : ""\}`\}/);
  const glass = await source("components/hub/glass.tsx");
  assert.match(glass, /count > 9 \? "9\+" : count/);
  const css = await source("app/glass.css");
  assert.match(css, /\.bell-button\.is-ringing::after \{[^}]*animation: bell-halo/);
  assert.match(css, /\.bell-button\.is-ringing > svg \{[^}]*animation: bell-swing/);
  assert.match(css, /:root\[data-reduce-motion="true"\] \.bell-button\.is-ringing::after \{ animation: none; opacity: 0\.8; transform: none; \}/);
  assert.match(css, /:root\[data-reduce-motion="true"\] \.bell-button\.is-ringing > svg \{ animation: none; \}/);
});

// Live sync (stage 1 of „Echtzeit“, 18.11.2026) ---------------------------------------------------------------------

test("the live version changes with the bell: new, merged and read lines and waiting registrations, nothing else", () => {
  const line = (id, minute, patch = {}) => ({ id, createdAt: `2026-11-18T10:${String(minute).padStart(2, "0")}:00.000+00:00`, read: false, title: "Aufgabe geändert: Startseite", body: "Website · #12", ...patch });
  const base = { unread: 2, items: [line(2, 5), line(1, 1)], pending: 0 };
  const version = liveVersion(base);
  // Same rows, other order or another spelling of the same time: the same version.
  assert.equal(liveVersion({ ...base, items: [line(1, 1), line(2, 5)] }), version);
  assert.equal(liveVersion({ ...base, items: [line(2, 5, { createdAt: "2026-11-18T10:05:00Z" }), line(1, 1)] }), version);
  // A new line, a merged line (new time or only new words), a read line, a new registration: another version.
  assert.notEqual(liveVersion({ ...base, unread: 3, items: [line(3, 9), ...base.items] }), version);
  assert.notEqual(liveVersion({ ...base, items: [line(2, 7), line(1, 1)] }), version);
  assert.notEqual(liveVersion({ ...base, items: [line(2, 5, { body: "Website · #12 · Kommentar: „Ok“" }), line(1, 1)] }), version);
  assert.notEqual(liveVersion({ ...base, unread: 1, items: [line(2, 5, { read: true }), line(1, 1)] }), version);
  assert.notEqual(liveVersion({ ...base, pending: 1 }), version);
  // Only the newest lines count, like the server reads them.
  const many = Array.from({ length: 30 }, (_, index) => line(index + 1, index));
  assert.equal(liveVersion({ unread: 30, items: many, pending: 0 }), liveVersion({ unread: 30, items: many.slice(-LIVE_LINES), pending: 0 }));
});

test("open tabs ask for the live version every 15 seconds and when they come back, with the person's own session", async () => {
  const route = await source("app/api/live/route.ts");
  assert.match(route, /const supabase = await createClient\(\);/);
  assert.doesNotMatch(route, /createAdminClient|service_role/);
  assert.match(route, /if \(!claims\) return Response\.json\(\{ version: null \}, \{ status: 401, headers: fresh \}\);/);
  assert.match(route, /\.order\("created_at", \{ ascending: false \}\)\.limit\(LIVE_LINES\)/);
  assert.match(route, /const fresh = \{ "Cache-Control": "no-store" \};/);
  const hook = await source("components/hub/use-live-sync.ts");
  assert.match(hook, /export const LIVE_POLL_MS = 15_000;/);
  assert.match(hook, /fetch\("\/api\/live", \{ cache: "no-store"/);
  assert.match(hook, /document\.visibilityState !== "visible"/);
  // Typing waits; a version the page could not catch up with is not chased twice.
  assert.match(hook, /if \(stopped \|\| waiting === null \|\| typing\(\)\) return;/);
  assert.match(hook, /if \(waiting === shown\.current \|\| waiting === refreshedFor\) \{ waiting = null; return; \}/);
  assert.match(hook, /router\.refresh\(\);/);
  const shell = await source("components/hub/app-shell.tsx");
  assert.match(shell, /useLiveSync\(!preview && !pending && Boolean\(userId\) && inbox !== null, liveVersion\(\{ unread: inbox\?\.unread \?\? 0, items: inbox\?\.items \?\? \[\], pending: pendingRegistrations \}\)\);/);
  // The layout counts the registrations the same way as the live check.
  const layout = await source("app/dashboard/layout.tsx");
  assert.match(layout, /identity\.account\?\.role === "oalab_admin" \? countPendingRegistrations\(\) : 0/);
  assert.match(await source("lib/hub-users/server.ts"), /from\("hub_profiles"\)\.select\("user_id", \{ count: "exact", head: true \}\)\.eq\("status", "pending"\)/);
});

test("a release for a freelancer rings the bell once per customer, never by mail (18.11.2026)", async () => {
  const notice = shareNotice("Nordlicht  Studio", ["E-Mail"], "2a000000-0000-4000-8000-000000000001");
  assert.deepEqual(notice, {
    kind: "share.granted",
    title: "Neu freigegeben bei Nordlicht Studio",
    body: "E-Mail · Unter Kunden › Vertrag & Domain",
    href: "/dashboard/customers?customer=2a000000-0000-4000-8000-000000000001&tab=vd",
  });
  // A further release at the same customer joins the unread line, each area once.
  const merged = mergeShareNotice(notice, "Nordlicht Studio", "Pakete", "2a000000-0000-4000-8000-000000000001");
  assert.equal(merged.body, "E-Mail, Pakete · Unter Kunden › Vertrag & Domain");
  assert.deepEqual(sharedAreasOf(mergeShareNotice(merged, "Nordlicht Studio", "E-Mail", "x").body), ["E-Mail", "Pakete"]);
  assert.deepEqual(sharedAreasOf("Irgendein Text"), []);
  const server = await source("lib/hub-notify/server.ts");
  assert.match(server, /export async function notifyFreelancerShare\(/);
  assert.match(server, /await insertNotices\(db, userIds\.filter\(\(id\) => !latest\.has\(id\)\), fresh, "skipped"\);/);
  assert.match(server, /\.eq\("kind", "share\.granted"\)\.eq\("href", fresh\.href\)\s+\.is\("read_at", null\)/);
  const actions = await source("lib/hub-freelancer-customers/actions.ts");
  assert.match(actions, /if \(on\) after\(\(\) => notifyFreelancerShare\(\{ freelancerId, customerId, company: names\.customer, area: shareAreas\[area\]\.label \}\)\);/);
  assert.match(await source("components/hub/notifications-panel.tsx"), /if \(kind === "share\.granted"\) return \{ icon: Building2/);
});

// The bell in three columns (design „Glocke V3“, 22.11.2026) -------------------------------------------------------

test("task lines name the customer for the team and split into where, message and from", () => {
  assert.equal(taskNoticePrefix("Website", 12), "Website · #12");
  assert.equal(taskNoticePrefix("Website", 12, " Bäckerei  Sonnenschein "), "Bäckerei Sonnenschein · Website · #12");
  const team = taskNotice({ kind: "task.changed", taskTitle: "Startseite", prefix: taskNoticePrefix("Website", 12, "Bäckerei Sonnenschein"), parts: ["Status: Review", "Kommentar: „Passt“", "von Lena"], href: taskBoardHref("p1", 12) });
  assert.deepEqual(noticeColumns(team, "admin"), {
    where: "Bäckerei Sonnenschein", path: "Website › #12 Startseite", title: "Aufgabe geändert", body: "Status: Review · Kommentar: „Passt“", from: "Lena", fromDetail: "Freelancer",
  });
  assert.equal(noticeColumns(team, "freelancer").fromDetail, "", "a freelancer hears of anyone in the team");
  // Lines written before the customer was named read as before, and the customer's lines never name anyone.
  assert.deepEqual(noticeColumns({ kind: "task.created", title: "Neue Aufgabe: Startseite", body: "Website · #12 · Status: Offen" }, "customer"), {
    where: "Website", path: "#12 Startseite", title: "Neue Aufgabe", body: "Status: Offen", from: "oalab", fromDetail: "Team",
  });
  assert.deepEqual(noticeColumns({ kind: "task.changed", title: "Aufgabe geändert: Logo", body: "Kaiser · Exposé · Portal · #3 · Archiviert" }, "admin").path, "Exposé · Portal › #3 Logo");
});

test("every kind of notice finds its three columns", () => {
  assert.deepEqual(noticeColumns({ kind: "task.customer", title: "Du bist am Zug: Texte liefern", body: "Website · Aufgabe #14" }, "customer"), {
    where: "Website", path: "#14 Texte liefern", title: "Du bist am Zug", body: "Die Aufgabe liegt jetzt bei dir.", from: "oalab", fromDetail: "Team",
  });
  const project = noticeColumns({ kind: "project.changed", title: "Projekt aktualisiert: Website", body: "Status: In Arbeit → Dein Feedback" }, "customer");
  assert.deepEqual([project.where, project.path, project.title, project.body], ["Website", "Projekt", "Projekt aktualisiert", "Status: In Arbeit → Dein Feedback"]);
  const file = noticeColumns(fileNotice("logo.svg", "f1"), "customer");
  assert.deepEqual([file.where, file.title, file.body], ["Dateien", "Neue Datei", "logo.svg"]);
  const files = noticeColumns(filesNotice(["a.pdf", "b.pdf", "c.pdf"]), "freelancer");
  assert.deepEqual([files.title, files.body], ["3 neue Dateien", "a.pdf, b.pdf und 1 weitere"]);
  const share = noticeColumns(shareNotice("Nordlicht Studio", ["E-Mail", "Pakete"], "c1"), "freelancer");
  assert.deepEqual([share.where, share.path, share.title, share.body], ["Nordlicht Studio", "Kunden › Vertrag & Domain", "Neu freigegeben", "E-Mail, Pakete"]);
  const chat = noticeColumns(chatNotice({ kind: "chat.message", customerId: "c1", company: "Müller Holzbau", author: "Jonas Müller", body: "Geht das: heute?" }), "admin");
  assert.deepEqual([chat.where, chat.path, chat.title, chat.body, chat.from, chat.fromDetail], ["Müller Holzbau", "Nachrichten › Privater Chat", "Neue Nachricht", "Geht das: heute?", "Jonas Müller", "Kunde"]);
  const reply = noticeColumns(chatNotice({ kind: "chat.reply", customerId: "c1", company: "Müller Holzbau", author: "Anna Schulz", body: "Klar", more: true }), "customer");
  assert.deepEqual([reply.where, reply.path, reply.title, reply.body, reply.from], ["Nachrichten", "Chat mit oalab", "Neue Nachrichten", "Klar", "Anna"]);
  const appointment = noticeColumns(appointmentNotice({ id: "a1", title: "Abstimmung: Texte", startsAt: "2026-11-24T09:00:00Z", before: { status: "requested", startsAt: "2026-11-24T09:00:00Z" }, status: "confirmed" }), "customer");
  assert.deepEqual([appointment.where, appointment.path, appointment.title], ["Kalender", "Abstimmung: Texte", "Termin bestätigt"]);
  assert.deepEqual(noticeColumns({ kind: "something.else", title: "Hinweis", body: "Text" }, "admin"), { where: "Hub", path: "", title: "Hinweis", body: "Text", from: "", fromDetail: "" });
});

test("the bell shows its lines in the three columns, in a wider window", async () => {
  const panel = await source("components/hub/notifications-panel.tsx");
  assert.match(panel, /const columns = noticeColumns\(item, role\);/);
  assert.match(panel, /<span className="notice-where">[\s\S]*<span className="notice-text">[\s\S]*<span className="notice-from">/);
  assert.match(await source("components/hub/app-shell.tsx"), /<Modal title="Benachrichtigungen" className="notifications-modal"/);
  assert.match(await source("app/glass.css"), /\.hub-modal\.notifications-modal \{ width: min\(760px, calc\(100% - 32px\)\); \}/);
  const server = await source("lib/hub-notify/server.ts");
  assert.match(server, /prefix: taskNoticePrefix\(project\.data!\.display_name, number, viewer === "team" \? company : ""\)/);
});
