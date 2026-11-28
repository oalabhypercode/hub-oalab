import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CHAT_MAIL_WAIT_MINUTES, SERVICE_APPROVAL_CURSOR, SERVICE_KINDS, isReadInHub, isServiceKind, mailWaitMinutes, noticeRequest, serviceApprovalMark,
  serviceApprovalNotice, serviceHref, skipsMail,
} from "../lib/hub-notify/rules.ts";
import { noticeColumns } from "../lib/hub-notify/columns.ts";
import { noticeDigestMail } from "../lib/hub-mail/templates.ts";
import { telegramServiceApproval } from "../lib/hub-telegram/rules.ts";

// „Gefällt mir“ on the service platform reaches the team in the hub (27.11.2026).

const source = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const input = { requestId: "c0ffee00-0000-4000-8000-0000000b0014", reference: "OA-14", title: "Gutscheinaktion", company: "BS CarCare GmbH", author: "André Bosse" };

test("a customer's „Gefällt mir“ becomes one line for the team that leads to the request", () => {
  const notice = serviceApprovalNotice(input);
  assert.deepEqual(notice, {
    kind: "service.approved",
    title: "Gefällt mir von BS CarCare GmbH: OA-14 Gutscheinaktion",
    body: "André Bosse: Änderung auf der Testseite passt, bereit für live",
    href: serviceHref(input.requestId),
  });
  assert.equal(noticeRequest(notice.href), input.requestId);
  // Without a name or company the line still reads.
  assert.deepEqual(serviceApprovalNotice({ ...input, company: " ", author: "" }), { ...notice, title: "Gefällt mir von Kunde: OA-14 Gutscheinaktion", body: "Änderung auf der Testseite passt, bereit für live" });
  assert.equal(serviceApprovalMark("e1"), "service-approval:e1");
  assert.equal(SERVICE_APPROVAL_CURSOR, "cursor:service_approvals");
});

test("the bell's columns: the company, the request, „Gefällt mir“ and who pressed it", () => {
  assert.deepEqual(noticeColumns(serviceApprovalNotice(input), "admin"), {
    where: "BS CarCare GmbH", path: "Serviceplattform › OA-14 Gutscheinaktion", title: "Gefällt mir",
    body: "Änderung auf der Testseite passt, bereit für live", from: "André Bosse", fromDetail: "Kunde",
  });
});

test("read in the hub it needs no mail; unread the mail comes after a few minutes, like a customer's message", () => {
  assert.deepEqual([...SERVICE_KINDS], ["service.message", "service.approved"]);
  assert.ok(isServiceKind("service.approved") && isServiceKind("service.message") && !isServiceKind("chat.message"));
  assert.equal(isReadInHub("service.approved"), true);
  assert.equal(skipsMail({ kind: "service.approved", read_at: "2026-11-27T17:00:00Z" }), true);
  assert.equal(skipsMail({ kind: "service.approved", read_at: null }), false);
  assert.equal(mailWaitMinutes("service.approved"), CHAT_MAIL_WAIT_MINUTES);
});

test("mail: alone it says the change can go live; with messages the lead names both", () => {
  const notice = serviceApprovalNotice(input);
  const single = noticeDigestMail({ items: [{ kind: notice.kind, title: notice.title, body: notice.body, url: "https://hub.oalab.de/x" }], more: 0, hubUrl: "https://hub.oalab.de/dashboard" });
  assert.equal(single.subject, notice.title);
  assert.match(single.html, /Einem Kunden gefällt die Änderung/);
  assert.match(single.html, /Bereit für live/);
  assert.match(single.html, /Live schalten geht in NoteTree Business/);
  const two = noticeDigestMail({ items: [{ kind: notice.kind, title: notice.title, body: notice.body }, { kind: notice.kind, title: notice.title, body: notice.body }], more: 0, hubUrl: "https://hub.oalab.de/dashboard" });
  assert.match(two.html, /2 Kunden haben „Gefällt mir“ gedrückt, die Änderungen können live\./);
  assert.doesNotMatch(two.html, /Alles hier ist zur Info/);
  const mixed = noticeDigestMail({ items: [{ kind: "service.message", title: "Neue Nachricht von Nordlicht Studio: OA-12 Texte", body: "Jana: Hallo" }, { kind: notice.kind, title: notice.title, body: notice.body }], more: 0, hubUrl: "https://hub.oalab.de/dashboard" });
  assert.match(mixed.html, /wartet ein Kunde auf eine Antwort\. Ein Kunde hat „Gefällt mir“ gedrückt, die Änderung kann live\./);
});

test("telegram: „Gefällt mir · OA-14 · Firma · Name“ in bold, the request below, a button into the hub", () => {
  const url = "https://hub.oalab.de/dashboard/messages?tab=service&conversation=x";
  const message = telegramServiceApproval({ ...input, url });
  assert.equal(message.text, "Gefällt mir · OA-14 · BS CarCare GmbH · André Bosse\nGutscheinaktion\nÄnderung auf der Testseite passt, bereit für live.");
  assert.deepEqual(message.entities, [{ type: "bold", offset: 0, length: "Gefällt mir · OA-14 · BS CarCare GmbH · André Bosse".length }]);
  assert.deepEqual(message.reply_markup, { inline_keyboard: [[{ text: "Im Hub öffnen", url }]] });
});

test("the schedule reads approvals from a cursor, writes the line before Telegram, and marks what it told", async () => {
  const collector = await source("lib/hub-notify/service-approvals.ts");
  assert.match(collector, /\.from\("audit_events"\)\.select\("id, organization_id, actor_id, occurred_at, safe_metadata"\)\s+\.eq\("action", "client\.preview_approved"\)\.eq\("result", "success"\)/);
  assert.match(collector, /if \(!request \|\| request\.organization_id !== approval\.organization_id \|\| customer\?\.archived_at\) continue;/);
  // A run that cannot write the line returns before Telegram, so a repeat never posts the same approval twice.
  const insert = collector.indexOf("await deps.insert(admins, serviceApprovalNotice(input));");
  const telegram = collector.indexOf("await sendTelegram(telegramServiceApproval(");
  assert.ok(insert > 0 && telegram > insert);
  assert.ok(collector.indexOf("if (written < 0) return { error: \"inbox\" };") < telegram);
  // Marks and cursor only after the lines.
  assert.ok(collector.lastIndexOf("serviceApprovalMark(row.id)") > telegram);
  const server = await source("lib/hub-notify/server.ts");
  assert.match(server, /const approvals = await collectServiceApprovals\(db, origin, \{[\s\S]*?\}\)\.catch\(\(\) => \(\{ error: "approvals" \}\)\);/);
  // The list of requests marks one with an unread approval, as one with an unread message.
  const conversations = await source("lib/hub-conversations/server.ts");
  assert.match(conversations, /\.from\("hub_inbox"\)\.select\("href"\)\.in\("kind", \[\.\.\.SERVICE_KINDS\]\)\.is\("read_at", null\)/);
});

test("the open request shows „Gefällt dem Kunden“ under the approved result", async () => {
  const site = await source("lib/hub-conversations/test-site.ts");
  assert.match(site, /\.from\("audit_events"\)\.select\("target_id, occurred_at"\)\.eq\("action", "client\.preview_approved"\)\s+\.eq\("result", "success"\)\.eq\("safe_metadata->>requestId", requestId\)/);
  const screen = await source("components/hub/screens/conversations.tsx");
  assert.match(screen, /\{message\.result && thread\.approvals\?\.\[message\.id\] && <ApprovedLine at=\{thread\.approvals\[message\.id\]\} now=\{labelNow\} \/>\}/);
  assert.match(screen, /<b>Gefällt dem Kunden<\/b>/);
});
