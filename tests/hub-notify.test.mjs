import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MAIL_WAIT_MINUTES, appointmentNotice, describeProjectChange, detectStudioNotices, dueDigests, fileNotice, mailsWanted, nextCursor, projectState, readFrom, taskState,
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
  const notice = (patch) => appointmentNotice({ title: "Abstimmung", startsAt, status: "confirmed", before: null, ...patch });
  assert.equal(notice({}).kind, "appointment.created");
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
