import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MAIL_WAIT_MINUTES, appointmentNotice, calendarRows, describeProjectChange, detectStudioNotices, dueDigests, fileNotice, mailsWanted, nextCursor, noticeAppointment,
  projectState, readFrom, taskState,
} from "../lib/hub-notify/rules.ts";
import { noticeDigestMail } from "../lib/hub-mail/templates.ts";

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
  assert.equal(notice({}).href, `/dashboard/calendar?appointment=${appointmentId}`);
  assert.equal(noticeAppointment(notice({ status: "cancelled" }).href), appointmentId);
  for (const href of ["/dashboard/calendar", "/dashboard/files", `/dashboard/calendar?appointment=${appointmentId}&x=1`, "/dashboard/calendar?appointment=1"]) assert.equal(noticeAppointment(href), null, href);
  // ICU writes "Fr., 6. November um 10:00"; older versions put a comma instead of "um".
  assert.match(notice({}).body, /^Fr\., 6\. November(,| um) 10:00 Uhr$/);
  assert.equal(notice({ before: { status: "requested", startsAt } }).kind, "appointment.confirmed");
  assert.equal(notice({ before: { status: "confirmed", startsAt: "2026-11-05T09:00:00.000Z" } }).kind, "appointment.changed");
  assert.equal(notice({ before: { status: "confirmed", startsAt } }), null);
  assert.equal(notice({ status: "cancelled", note: "Krank" }).title, "Termin abgesagt: Abstimmung");
  assert.match(notice({ status: "cancelled", note: "Krank" }).body, / · Krank$/);
  assert.equal(notice({ status: "declined" }).kind, "appointment.declined");
  assert.deepEqual(fileNotice("Servicevertrag"), { kind: "file.shared", title: "Neue Datei: Servicevertrag", body: "Im Bereich Dateien", href: "/dashboard/files" });
});

test("the digest mail lists the notices, escapes them and points to the profile switch", () => {
  const one = noticeDigestMail({ firstName: "Jana", items: [{ title: "Du bist am Zug: <Logo>", body: "Website · Aufgabe #12" }], more: 0, hubUrl: "https://hub.oalab.de/dashboard" });
  assert.equal(one.subject, "Neu im Client Hub: Du bist am Zug: <Logo>");
  assert.match(one.html, /Du bist am Zug: &lt;Logo&gt;/);
  assert.doesNotMatch(one.html, /<Logo>/);
  assert.match(one.text, /Im Client Hub ansehen: https:\/\/hub\.oalab\.de\/dashboard/);
  assert.match(one.text, /Profil & Zugang/);
  const many = noticeDigestMail({ firstName: "", items: [{ title: "A", body: "" }, { title: "B", body: "" }], more: 3, hubUrl: "https://hub.oalab.de/dashboard" });
  assert.equal(many.subject, "Neu im Client Hub: 5 Neuigkeiten");
  assert.match(many.text, /3 weitere Neuigkeiten findest du im Hub\./);
  assert.doesNotMatch(many.html, /In deinen Kalender eintragen/);
});

test("new, confirmed and moved appointments get calendar buttons once, while still confirmed and not over", () => {
  const a = "0b6f4f0e-2c1a-4d7e-9a51-3f2e8d7c6b5a";
  const b = "1c7a5e1f-3d2b-4e8f-8b62-4a3f9e8d7c6b";
  const c = "2d8b6f2a-4e3c-4f9a-9c73-5b4a0f9e8d7c";
  const href = (id) => `/dashboard/calendar?appointment=${id}`;
  const rows = [
    { id: 1, kind: "appointment.created", href: href(a) },
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

test("the digest mail shows the calendar buttons under an appointment, as links and in the text version", () => {
  const calendar = {
    ics: "https://hub.oalab.de/api/calendar/x/oalab-termin.ics?sig=abc",
    google: "https://hub.oalab.de/api/calendar/x/google?sig=abc",
    outlook: "https://hub.oalab.de/api/calendar/x/outlook?sig=abc",
  };
  const mail = noticeDigestMail({ firstName: "Jana", items: [{ title: "Neuer Termin: Kickoff", body: "Di., 10. November um 14:00 Uhr", calendar }, { title: "Neue Datei: Vertrag", body: "Im Bereich Dateien" }], more: 0, hubUrl: "https://hub.oalab.de/dashboard" });
  assert.equal((mail.html.match(/In deinen Kalender eintragen/g) ?? []).length, 1);
  for (const label of ["Apple Kalender", "Google Kalender", "Outlook", "Andere (.ics)"]) assert.match(mail.html, new RegExp(`>${label.replace(/[().]/g, "\\$&")}</a>`));
  assert.equal((mail.html.match(/href="https:\/\/hub\.oalab\.de\/api\/calendar\/x\/oalab-termin\.ics\?sig=abc"/g) ?? []).length, 2);
  assert.match(mail.html, /href="https:\/\/hub\.oalab\.de\/api\/calendar\/x\/google\?sig=abc"/);
  assert.doesNotMatch(mail.html, /alten Eintrag/);
  assert.match(mail.text, /Neuer Termin: Kickoff\nIn deinen Kalender eintragen:\nApple Kalender und andere Apps \(\.ics\): https:\/\/hub\.oalab\.de\/api\/calendar\/x\/oalab-termin\.ics\?sig=abc\nGoogle Kalender: https:\/\/hub\.oalab\.de\/api\/calendar\/x\/google\?sig=abc\nOutlook \(Microsoft 365\): https:\/\/hub\.oalab\.de\/api\/calendar\/x\/outlook\?sig=abc\n/);
  const moved = noticeDigestMail({ firstName: "", items: [{ title: "Termin verschoben: Kickoff", body: "", calendar: { ...calendar, moved: true } }], more: 0, hubUrl: "https://hub.oalab.de/dashboard" });
  assert.match(moved.html, /Schon in deinem Kalender\? Lösch dort den alten Eintrag/);
  assert.match(moved.text, /Schon in deinem Kalender\? Lösch dort den alten Eintrag/);
  const unsafe = noticeDigestMail({ firstName: "", items: [{ title: "Neuer Termin", body: "", calendar: { ics: "javascript:alert(1)", google: "javascript:x", outlook: "data:x" } }], more: 0, hubUrl: "https://hub.oalab.de/dashboard" });
  assert.doesNotMatch(unsafe.html, /In deinen Kalender eintragen|javascript:|data:x/);
  assert.doesNotMatch(unsafe.text, /In deinen Kalender eintragen/);
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
  for (const file of ["lib/hub-calendar/actions.ts", "lib/hub-files/actions.ts"]) assert.match(await source(file), /await notifyCustomers\(/, file);
});
