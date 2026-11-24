import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import {
  AREA_LABELS, CHAT_AREAS, DEFAULT_SUBSCRIPTIONS, SYSTEM_EVENT_KINDS, appointmentBadge, areaDescription, areaOf, areaSubject, cardAppointmentHref, cardFileHref,
  cardNoteHref, cardProjectHref, cardTaskHref, cardView, eventKey, eventLine, eventListLine, isSystemEvent, mergeEvents, mergeGroup, readChatEvent, shortWhen,
  subjectArea, subscriptionsOf, systemLine,
} from "../lib/hub-chat-events/rules.ts";
import { SYSTEM_LINE_KINDS, chatActivity, chatUnread, isCardRow, isSystemRow } from "../lib/hub-private-chat/rules.ts";
import { appointmentHref, appointmentRequestNotice, contractNotice, isReadInHub, mergeContractNotice, notePageHref, projectHref, taskBoardHref, fileNotice } from "../lib/hub-notify/rules.ts";
import { noticeColumns } from "../lib/hub-notify/columns.ts";
import { telegramAppointmentRequest } from "../lib/hub-telegram/rules.ts";

// Windows checkouts may carry CRLF line endings; the source checks below compare LF text.
const source = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

const A = "00000000-0000-4000-8000-0000000000a1";
const P = "00000000-0000-4000-8000-0000000000b1";
const C = "00000000-0000-4000-8000-0000000000c1";
const N = "00000000-0000-4000-8000-0000000000c2";
const F1 = "00000000-0000-4000-8000-0000000000d1";
const F2 = "00000000-0000-4000-8000-0000000000d2";
const F3 = "00000000-0000-4000-8000-0000000000d3";
const facts = { id: A, title: "Abstimmung Texte", startsAt: "2026-11-24T09:00:00.000Z", endsAt: "2026-11-24T09:30:00.000Z", teams: true };
const at = Date.parse("2026-11-20T10:00:00.000Z");
const ctx = (viewer, appointment) => ({ viewer, company: "Nordlicht Studio", customerId: C, appointment, at });

test("every chat starts with everything on except Aufgaben; stored switches win, unknown rows are ignored", () => {
  assert.deepEqual(CHAT_AREAS, ["appointments", "files", "notes", "tasks", "projects", "contract"]);
  assert.deepEqual(DEFAULT_SUBSCRIPTIONS, { appointments: true, files: true, notes: true, tasks: false, projects: true, contract: true });
  assert.deepEqual(subscriptionsOf([]), DEFAULT_SUBSCRIPTIONS);
  assert.deepEqual(subscriptionsOf([{ subject: "area:tasks", enabled: true }, { subject: "area:files", enabled: false }, { subject: "project:x", enabled: true }, { subject: "area:service", enabled: true }]),
    { ...DEFAULT_SUBSCRIPTIONS, tasks: true, files: false });
  assert.equal(areaSubject("contract"), "area:contract");
  assert.equal(subjectArea("area:notes"), "notes");
  assert.equal(subjectArea("area:service"), null);
  assert.equal(AREA_LABELS.contract, "Vertrag & Domain");
  assert.equal(areaDescription("files", "oalab", "Nordlicht Studio"), "Neue Dateien für Nordlicht Studio");
  assert.equal(areaDescription("files", "customer", "Nordlicht Studio"), "Neue Dateien für euch");
});

test("each change belongs to one area; subscription lines to none", () => {
  const expected = {
    "appointment.created": "appointments", "appointment.requested": "appointments", "appointment.withdrawn": "appointments", "file.shared": "files",
    "note.shared": "notes", "note.changed": "notes", "task.customer": "tasks", "task.changed": "tasks", "project.changed": "projects", "contract.changed": "contract", subscription: null,
  };
  for (const [kind, area] of Object.entries(expected)) assert.equal(areaOf(kind), area, kind);
  assert.deepEqual(SYSTEM_EVENT_KINDS, ["subscription", "appointment.withdrawn"]);
  // The chat's own rules know the same grey lines.
  assert.deepEqual(SYSTEM_LINE_KINDS, SYSTEM_EVENT_KINDS);
  assert.ok(isSystemEvent({ kind: "subscription" }) && !isSystemEvent({ kind: "file.shared" }));
});

test("cards are read defensively: broken or unknown events are no card", () => {
  assert.deepEqual(readChatEvent({ v: 1, kind: "appointment.created", appointment: { ...facts, title: "  Abstimmung   Texte " } }), { v: 1, kind: "appointment.created", appointment: { ...facts, title: "Abstimmung Texte" } });
  assert.equal(readChatEvent({ v: 1, kind: "appointment.created", appointment: { ...facts, id: "nope" } }), null);
  assert.equal(readChatEvent({ v: 1, kind: "appointment.created", appointment: { ...facts, startsAt: "morgen" } }), null);
  assert.equal(readChatEvent({ v: 1, kind: "service.message" }), null);
  assert.equal(readChatEvent(null), null);
  assert.equal(readChatEvent("text"), null);
  assert.equal(readChatEvent({ v: 1, kind: "file.shared", files: [] }), null);
  assert.deepEqual(readChatEvent({ v: 1, kind: "file.shared", files: [{ id: F1, name: "a.pdf" }, { id: "x", name: "b" }], total: 1 }), { v: 1, kind: "file.shared", files: [{ id: F1, name: "a.pdf" }], total: 1 });
  assert.equal(readChatEvent({ v: 1, kind: "subscription", area: "service", on: true }), null);
  assert.deepEqual(readChatEvent({ v: 1, kind: "subscription", area: "tasks", on: false }), { v: 1, kind: "subscription", area: "tasks", on: false });
  assert.deepEqual(readChatEvent({ v: 1, kind: "contract.changed", items: [{ what: "password", label: "x" }, { what: "domain", label: "nordlicht.example", change: "changed" }] }),
    { v: 1, kind: "contract.changed", items: [{ what: "domain", label: "nordlicht.example", change: "changed" }] });
});

test("a card in one line for the list and Claude, and its heading as each side reads it", () => {
  const turn = { v: 1, kind: "task.customer", task: { projectId: P, number: 14, title: "Texte", project: "Website", parts: [] } };
  assert.equal(eventLine({ v: 1, kind: "appointment.created", appointment: facts }), `Neuer Termin: Abstimmung Texte, ${shortWhen(facts.startsAt)}`);
  assert.match(shortWhen(facts.startsAt), /^Di\., 24\. Nov\., 10:00$/);
  assert.equal(eventLine(turn), "Am Zug: Website › #14 Texte");
  assert.equal(eventListLine(turn, "customer", "Nordlicht Studio"), "Du bist am Zug: Website › #14 Texte");
  assert.equal(eventListLine(turn, "oalab", "Nordlicht Studio"), "Nordlicht Studio ist am Zug: Website › #14 Texte");
  assert.equal(eventLine({ v: 1, kind: "file.shared", files: [{ id: F1, name: "a.pdf" }, { id: F2, name: "b.pdf" }], total: 5 }), "5 neue Dateien: a.pdf, b.pdf und 3 weitere");
  assert.equal(eventLine({ v: 1, kind: "contract.changed", items: [{ what: "mailbox", label: "info@nordlicht.example", change: "new" }] }), "Vertrag & Domain: E-Mail-Adresse angelegt: info@nordlicht.example");
  assert.equal(eventLine({ v: 1, kind: "subscription", area: "tasks", on: true }), "Aufgaben abonniert");
});

test("grey lines say who switched what, never as news", () => {
  const sub = { v: 1, kind: "subscription", area: "tasks", on: true };
  assert.equal(systemLine(sub, { own: true, who: "Du" }), "Du hast Aufgaben abonniert");
  assert.equal(systemLine({ ...sub, on: false }, { own: false, who: "Jana Sommer" }), "Jana Sommer hat Aufgaben abbestellt");
  assert.equal(systemLine({ v: 1, kind: "appointment.withdrawn", appointment: facts }, { own: false, who: "Tim Berger" }), "Tim Berger hat die Terminanfrage „Abstimmung Texte“ zurückgezogen");
  assert.equal(cardView(sub, ctx("customer")), null);
});

test("appointment cards wear today's state and lead on as each side may", () => {
  const created = { v: 1, kind: "appointment.created", appointment: facts };
  const confirmed = { status: "confirmed", startsAt: facts.startsAt, endsAt: facts.endsAt };
  const fresh = cardView(created, ctx("customer", confirmed));
  assert.equal(fresh.heading, "Neuer Termin");
  assert.equal(fresh.badge, null);
  assert.deepEqual(fresh.lines, ["Di., 24. Nov. · 10:00–10:30 · Teams"]);
  assert.deepEqual(fresh.actions.map((action) => action.kind), ["open", "calendar"]);
  assert.equal(fresh.actions[0].href, cardAppointmentHref(A));
  // Admins open it in the calendar; only customers put it into their own calendar app.
  assert.deepEqual(cardView(created, ctx("oalab", confirmed)).actions.map((action) => action.kind), ["open"]);
  // Moved since: the older card says so and offers no calendar file for the old time.
  const later = { ...confirmed, startsAt: "2026-11-25T13:00:00.000Z", endsAt: "2026-11-25T13:30:00.000Z" };
  assert.deepEqual(cardView(created, ctx("customer", later)).badge, { label: "verschoben", tone: "info" });
  assert.deepEqual(cardView(created, ctx("customer", later)).actions.map((action) => action.kind), ["open"]);
  assert.deepEqual(appointmentBadge(created, { ...confirmed, status: "cancelled" }, at), { label: "abgesagt", tone: "off" });
  assert.deepEqual(appointmentBadge(created, null, at), { label: "entfernt", tone: "off" });
  assert.equal(appointmentBadge(created, undefined, at), null);
  // The move itself names the old time.
  const moved = cardView({ v: 1, kind: "appointment.changed", appointment: { ...facts, before: "2026-11-23T09:00:00.000Z" } }, ctx("customer", confirmed));
  assert.equal(moved.heading, "Termin verschoben");
  assert.equal(moved.was, "Mo., 23. Nov., 10:00");
  const cancelled = cardView({ v: 1, kind: "appointment.cancelled", appointment: { ...facts, note: "Neuer Vorschlag folgt" } }, ctx("customer", { ...confirmed, status: "cancelled" }));
  assert.deepEqual([cancelled.heading, cancelled.lines[1], cancelled.badge, cancelled.actions.length], ["Termin abgesagt", "Neuer Vorschlag folgt", null, 0]);
});

test("a request stays „offen“ until the team answers; admins confirm it in the card", () => {
  const request = { v: 1, kind: "appointment.requested", appointment: facts };
  const open = { status: "requested", startsAt: facts.startsAt, endsAt: facts.endsAt };
  const admin = cardView(request, ctx("oalab", open));
  assert.deepEqual(admin.badge, { label: "offen", tone: "todo" });
  assert.deepEqual(admin.actions.map((action) => [action.kind, action.label]), [["confirm", "Bestätigen"], ["open", "Im Kalender beantworten"]]);
  const customer = cardView(request, ctx("customer", open));
  assert.deepEqual(customer.actions.map((action) => action.kind), ["open"]);
  assert.deepEqual(cardView(request, ctx("oalab", { ...open, status: "confirmed" })).badge, { label: "bestätigt", tone: "ok" });
  assert.deepEqual(cardView(request, ctx("oalab", { ...open, status: "confirmed" })).actions.map((action) => action.kind), ["open"]);
  assert.deepEqual(appointmentBadge(request, { ...open, status: "declined" }, at), { label: "abgelehnt", tone: "off" });
  assert.deepEqual(appointmentBadge(request, { ...open, status: "cancelled" }, at), { label: "zurückgezogen", tone: "off" });
  assert.deepEqual(appointmentBadge(request, open, Date.parse("2026-11-30T00:00:00Z")), { label: "abgelaufen", tone: "off" });
  assert.deepEqual(cardView(request, { ...ctx("oalab", open), at: Date.parse("2026-11-30T00:00:00Z") }).actions.map((action) => action.kind), ["open"]);
});

test("the other cards: files, notes, tasks, projects and Vertrag & Domain with their links", () => {
  const files = cardView({ v: 1, kind: "file.shared", files: [{ id: F1, name: "a.pdf" }], total: 1 }, ctx("customer"));
  assert.deepEqual([files.heading, files.subject, files.actions[0].href], ["Neue Datei", "a.pdf", `/dashboard/files?file=${F1}`]);
  const many = cardView({ v: 1, kind: "file.shared", files: [{ id: F1, name: "a.pdf" }, { id: F2, name: "b.pdf" }, { id: F3, name: "c.pdf" }], total: 3 }, ctx("customer"));
  assert.deepEqual([many.heading, many.lines, many.actions[0].href], ["3 neue Dateien", ["a.pdf, b.pdf, c.pdf"], "/dashboard/files"]);
  const note = cardView({ v: 1, kind: "note.shared", note: { customerId: C, pageId: N, title: "Styleguide", edit: "with" } }, ctx("customer"));
  assert.deepEqual([note.heading, note.subject, note.lines], ["Neue Notiz zum Mitschreiben", "Styleguide", ["Unter Projekte › Notizen"]]);
  const task = { v: 1, kind: "task.changed", task: { projectId: P, number: 14, title: "Texte", project: "Website", parts: ["Status: In Arbeit → Erledigt"] } };
  assert.equal(cardView(task, ctx("customer")).actions[0].href, cardProjectHref(P));
  assert.equal(cardView(task, ctx("oalab")).actions[0].href, cardTaskHref(task.task));
  const turn = cardView({ v: 1, kind: "task.customer", task: { ...task.task, parts: [] } }, ctx("customer"));
  assert.deepEqual([turn.heading, turn.lines], ["Du bist am Zug", ["Die Aufgabe liegt jetzt bei dir"]]);
  assert.equal(cardView({ v: 1, kind: "task.customer", task: { ...task.task, parts: [] } }, ctx("oalab")).heading, "Nordlicht Studio ist am Zug");
  const contract = cardView({ v: 1, kind: "contract.changed", items: [{ what: "domain", label: "nordlicht.example", change: "new" }] }, ctx("customer"));
  assert.deepEqual([contract.heading, contract.lines, contract.actions[0].href], ["Neu unter Vertrag & Domain", ["Domain eingetragen: nordlicht.example"], "/dashboard/contracts"]);
  assert.equal(cardView({ v: 1, kind: "contract.changed", items: [{ what: "domain", label: "x", change: "changed" }] }, ctx("oalab")).actions[0].href, `/dashboard/contracts?customer=${C}`);
});

test("the cards' links are the bell's links", () => {
  assert.equal(cardAppointmentHref(A), appointmentHref(A));
  assert.equal(cardProjectHref(P), projectHref(P));
  assert.equal(cardNoteHref({ customerId: C, pageId: N, title: "x" }), notePageHref(C, N));
  assert.equal(cardTaskHref({ projectId: P, number: 14, title: "x", project: "y", parts: [] }), taskBoardHref(P, 14));
  assert.equal(cardFileHref([{ id: F1, name: "a" }], 1), fileNotice("a", F1).href);
});

test("files, one task and Vertrag & Domain grow one card; other changes never merge", () => {
  const one = { v: 1, kind: "file.shared", files: [{ id: F1, name: "a.pdf" }], total: 1 };
  const two = { v: 1, kind: "file.shared", files: [{ id: F2, name: "b.pdf" }, { id: F1, name: "a.pdf" }], total: 2 };
  assert.deepEqual(mergeEvents(one, two), { v: 1, kind: "file.shared", files: [{ id: F2, name: "b.pdf" }, { id: F1, name: "a.pdf" }], total: 2 });
  const task = (kind, parts, number = 14) => ({ v: 1, kind, task: { projectId: P, number, title: "Texte", project: "Website", parts } });
  assert.deepEqual(mergeEvents(task("task.created", ["Status: Offen"]), task("task.changed", ["Status: In Arbeit", "Fällig: 25. Nov."])),
    task("task.created", ["Status: In Arbeit", "Fällig: 25. Nov."]));
  assert.equal(mergeEvents(task("task.changed", ["a"]), task("task.changed", ["b"], 15)), null);
  assert.equal(mergeGroup({ v: 1, kind: "task.customer", task: task("task.customer", []).task }), null);
  const domain = { v: 1, kind: "contract.changed", items: [{ what: "domain", label: "nordlicht.example", change: "new" }] };
  const mailbox = { v: 1, kind: "contract.changed", items: [{ what: "mailbox", label: "info@nordlicht.example", change: "new" }] };
  assert.deepEqual(mergeEvents(domain, mailbox).items.map((item) => item.what), ["mailbox", "domain"]);
  // A change to something the card names as new keeps it new.
  assert.deepEqual(mergeEvents(domain, { v: 1, kind: "contract.changed", items: [{ what: "domain", label: "nordlicht.example", change: "changed" }] }).items, domain.items);
  assert.equal(mergeEvents(one, domain), null);
  assert.equal(mergeEvents({ v: 1, kind: "appointment.created", appointment: facts }, { v: 1, kind: "appointment.created", appointment: facts }), null);
  assert.equal(eventKey("file.shared", F1, "t"), `file.shared:${F1}:t`);
  assert.ok(eventKey("x", "y".repeat(400), "z").length <= 200);
});

test("the chat list: grey lines never count, a card is news for the other side but never an answer", () => {
  const row = (side, created_at, event = null) => ({ side, created_at, event });
  const card = { kind: "file.shared" };
  const grey = { kind: "subscription" };
  assert.ok(isSystemRow(row("oalab", "x", grey)) && !isSystemRow(row("oalab", "x", card)));
  assert.ok(isCardRow(row("oalab", "x", card)) && !isCardRow(row("oalab", "x")) && !isCardRow(row("oalab", "x", grey)));
  // Newest first: a customer wrote, then a card from oalab came: for admins the chat stays new.
  const rows = [row("oalab", "2026-11-20T10:05:00Z", card), row("customer", "2026-11-20T10:00:00Z")];
  const admin = chatActivity(rows, "oalab");
  assert.equal(admin.lastOwnSideAt, null);
  assert.equal(chatUnread({ ...admin, readAt: null }), true);
  // For the customer the card is news.
  const customer = chatActivity(rows, "customer");
  assert.equal(customer.lastOtherAt, "2026-11-20T10:05:00Z");
  assert.equal(chatUnread({ ...customer, readAt: "2026-11-20T10:01:00Z" }), true);
  // A grey line on top changes nothing.
  const withGrey = [row("customer", "2026-11-20T10:09:00Z", grey), ...rows];
  assert.equal(chatActivity(withGrey, "customer").last.created_at, "2026-11-20T10:05:00Z");
  assert.equal(chatActivity(withGrey, "customer").lastOwnSideAt, "2026-11-20T10:00:00Z");
});

test("the team hears of requests in the bell and in Telegram; Vertrag & Domain reaches the customer", () => {
  const notice = appointmentRequestNotice({ id: A, title: "Abstimmung", startsAt: facts.startsAt, company: "Nordlicht Studio", author: "Jana Sommer" });
  assert.deepEqual(notice, { kind: "appointment.requested", title: "Neue Terminanfrage von Nordlicht Studio", body: "Abstimmung · Di., 24. November um 10:00 Uhr · Jana Sommer", href: appointmentHref(A) });
  assert.equal(appointmentRequestNotice({ id: A, title: "x", startsAt: facts.startsAt, company: "Max Muster", author: "Max Muster", freelancer: true }).title, "Neue Terminanfrage von Max Muster (Freelancer)");
  assert.ok(isReadInHub("appointment.requested"));
  assert.deepEqual(noticeColumns(notice, "admin"), { where: "Nordlicht Studio", path: "Kalender › Anfrage", title: "Neue Terminanfrage", body: "Abstimmung · Di., 24. November um 10:00 Uhr", from: "Jana Sommer", fromDetail: "Kunde" });
  const contract = contractNotice(["Domain eingetragen: nordlicht.example"]);
  assert.deepEqual(contract, { kind: "contract.changed", title: "Neu unter Vertrag & Domain", body: "Domain eingetragen: nordlicht.example", href: "/dashboard/contracts" });
  const merged = mergeContractNotice(contract, "E-Mail-Adresse angelegt: info@nordlicht.example");
  assert.deepEqual([merged.title, merged.body], ["2 Änderungen unter Vertrag & Domain", "E-Mail-Adresse angelegt: info@nordlicht.example · Domain eingetragen: nordlicht.example"]);
  assert.equal(mergeContractNotice(merged, "Domain eingetragen: nordlicht.example").title, "2 Änderungen unter Vertrag & Domain");
  assert.equal(noticeColumns(contract, "customer").where, "Vertrag & Domain");
  const telegram = telegramAppointmentRequest({ company: "Nordlicht Studio", author: "Jana Sommer", title: "Abstimmung", when: "Di., 24. November um 10:00 Uhr", url: "https://hub.oalab.de/dashboard/projects/calendar?appointment=x" });
  assert.equal(telegram.text, "Neue Terminanfrage · Nordlicht Studio · Jana Sommer\nAbstimmung\nDi., 24. November um 10:00 Uhr");
  assert.equal(telegram.reply_markup.inline_keyboard[0][0].text, "Im Hub öffnen");
});

test("hub chat and service stay apart: the cards' modules use nothing of the service platform", async () => {
  const files = (await readdir(new URL("../lib/hub-chat-events/", import.meta.url))).filter((name) => name.endsWith(".ts"));
  assert.deepEqual(files.sort(), ["rules.ts", "server.ts"]);
  for (const name of files) {
    const text = await source(`lib/hub-chat-events/${name}`);
    assert.doesNotMatch(text, /hub-conversations|service-packages|SERVICE_PLATFORM|service_requests|request_messages|service_quota|serviceplattform\.|oalab-service/i, name);
  }
  // Nothing of the service platform becomes a card: the service sweep writes no chat rows.
  const notify = await source("lib/hub-notify/server.ts");
  const service = notify.slice(notify.indexOf("async function collectServiceNotices"), notify.indexOf("async function customersOfOrganizations"));
  assert.doesNotMatch(service, /postChatEvent|hub_private_messages/);
});

test("only the server writes cards, never throwing, once per key, as the chat's subscriptions say", async () => {
  const server = await source("lib/hub-chat-events/server.ts");
  assert.match(server, /^import "server-only";/);
  assert.match(server, /const db = createAdminClient\(\);/);
  assert.match(server, /if \(area && !\(await subscribed\(db, post\.customerId, area\)\)\) return;/);
  assert.match(server, /return data \? data\.enabled === true : DEFAULT_SUBSCRIPTIONS\[area\];/);
  assert.match(server, /\(data\?\.kind \?\? "customer"\) === "customer" && !data\?\.archived_at/);
  assert.match(server, /event: post\.event, event_key: post\.key/);
  assert.match(server, /if \(error && error\.code !== "23505"\) logFailure/);
  assert.match(server, /\} catch \(error\) \{\n {4}logFailure\(post\.event\.kind, error\);\n {2}\}/);
  // A card grows only while nobody of the other side looked since.
  assert.match(server, /\.neq\("side", post\.side\)\.gte\("read_at", last\.data\.created_at\)/);
  // The reader's session reads the switches (Row Level Security).
  assert.match(server, /export async function loadChatSubscriptions\(supabase: SupabaseClient, customerId: string\)/);
});

test("cards hang on the customer's notices: nothing only the team or freelancers see reaches the chat", async () => {
  const notify = await source("lib/hub-notify/server.ts");
  assert.match(notify, /export async function notifyCustomers\(customerIds: string\[\], notice: Notice, card\?: CardOf\)/);
  assert.match(notify, /if \(card && to\.customer\) await postChatEvents\(oalabCards\(\[customerId\], card, notice\.href\)\);/);
  assert.match(notify, /\/\/ A file only for the freelancers never comes into the customer's chat\.\n {4}await postChatEvents\(fileCards\(forCustomers, file, actor\)\);/);
  const task = notify.slice(notify.indexOf("export async function notifyTaskChange"), notify.indexOf("/** Admins who can sign in and act"));
  assert.match(task, /if \(audience\.customers\) \{[\s\S]*?postChatEvents\(oalabCards\(customerIds/);
  assert.equal((task.match(/postChatEvents/g) ?? []).length, 1);
  assert.match(notify, /authorId: null, event, key: eventKey\(event\.kind, item\.key, "studio"\)/);
  // Opening the chat still clears only the message notices (decision 8: bell and chat stay apart).
  const chat = await source("lib/hub-private-chat/server.ts");
  assert.match(chat, /viewer\.side === "oalab" \? notices\.eq\("kind", "chat\.message"\) : notices\.eq\("kind", "chat\.reply"\)\.eq\("user_id", viewer\.userId\)/);
});

test("requests reach the team and the chat; answering or withdrawing takes the team's line away", async () => {
  const write = await source("lib/hub-calendar/write.ts");
  assert.match(write, /after\(\(\) => notifyAppointmentRequest\(\{ appointment: factsOf\(data\), customerId, authorId: userId, origin \}\)\);/);
  assert.match(write, /after\(\(\) => notifyRequestWithdrawn\(\{ appointment: factsOf\(row\), customerId, authorId: userId \}\)\);/);
  assert.match(write, /if \(before\?\.status === "requested"\) await settleAppointmentRequest\(data\.id\);/);
  assert.match(write, /await settleAppointmentRequest\(data\.id\);\n {2}return \{ ok: true, data: null \};/);
  const notify = await source("lib/hub-notify/server.ts");
  const request = notify.slice(notify.indexOf("export async function notifyAppointmentRequest"), notify.indexOf("export async function settleAppointmentRequest"));
  assert.match(request, /await sendTelegram\(telegramAppointmentRequest\(/);
  assert.match(request, /insertNotices\(db, admins\.filter\(\(id\) => id !== input\.authorId\), appointmentRequestNotice\(/);
  assert.match(request, /side: "customer", authorId: input\.authorId, event: \{ v: 1, kind: "appointment\.requested", appointment: facts \}/);
  assert.match(await source("lib/hub-calendar/actions.ts"), /await settleAppointmentRequest\(id\);/);
});

test("Abos and „Bestätigen“: checked, written with the person's session, then the grey line or the card", async () => {
  const actions = await source("lib/hub-private-chat/actions.ts");
  const sub = actions.slice(actions.indexOf("export async function setChatSubscription"), actions.indexOf("type RequestRow"));
  assert.match(sub, /isChatArea\(input\?\.area\)/);
  assert.match(sub, /const supabase = await createClient\(\);\n {2}const \{ error \} = await supabase\.from\("hub_chat_subscriptions"\)/);
  assert.match(sub, /\{ onConflict: "customer_id,subject" \}/);
  assert.match(sub, /await postSubscriptionLine\(\{ customerId: input\.customerId, side: viewer\.side, authorId: viewer\.userId, area: input\.area, on: input\.enabled \}\);/);
  const confirm = actions.slice(actions.indexOf("export async function confirmChatRequest"));
  assert.match(confirm, /if \(viewer\.side !== "oalab"\) return \{ ok: false, error: "Anfragen bestätigt das oalab-Team\." \};/);
  assert.match(confirm, /if \(data\.status !== "requested"\) return/);
  assert.match(confirm, /const saved = await writeAppointment\(supabase, data\.id, \{/);
  assert.match(confirm, /\}, viewer\.userId\);/);
});

test("the chat shows cards, grey lines and „Abos“ with one switch per area", async () => {
  const screen = await source("components/hub/screens/private-chat.tsx");
  assert.match(screen, /<strong id=\{`\$\{id\}-title`\}>Im Chat mitteilen<\/strong>/);
  assert.match(screen, /\{CHAT_AREAS\.map\(\(area\) => \(/);
  assert.match(screen, /<Switch checked=\{subscriptions\[area\]\} onChange=\{\(on\) => onToggle\(area, on\)\}/);
  assert.match(screen, /<BellPlus size=\{18\} aria-hidden="true" \/>/);
  assert.match(screen, /popover="auto" className="glass glass-float chat-abos"/);
  assert.match(screen, /\{thread\.subscriptions && \(\n {10}<ChatAbos /);
  assert.match(screen, /<p className="chat-system is-event"><span>\{systemLine\(event, \{ own: message\.own, who: sender \}\)\}<\/span>/);
  assert.match(screen, /const view = event \? cardView\(event, \{ viewer, company: chat\.company, customerId: chat\.customerId/);
  assert.match(screen, /className="chat-card-action is-primary" disabled=\{busy\} onClick=\{\(\) => onConfirm\(action\.appointmentId\)\}/);
  const css = await source("app/glass.css");
  assert.match(css, /\.chat-abos\[popover\]::backdrop \{ background: rgba\(0, 0, 0, 0\.38\); \}/);
  assert.match(css, /:root\[data-reduce-motion="true"\] \.chat-abos\[popover\]:popover-open \{ animation: none; \}/);
  // The preview shows the same: cards, a grey line and an open request.
  const fixtures = await source("lib/hub-private-chat/fixtures.ts");
  for (const kind of ["appointment.created", "appointment.changed", "file.shared", "subscription", "task.customer", "contract.changed", "appointment.requested"]) assert.ok(fixtures.includes(`kind: "${kind}"`), kind);
});

test("Claude reads cards as lines marked [Hub]", async () => {
  const areas = await source("lib/hub-mcp/areas.ts");
  assert.match(areas, /const chatText = \(row: ChatRow\) => \(row\.event \? `\[Hub\] \$\{row\.body\}` : row\.body\);/);
  assert.match(areas, /const \{ last, lastOtherAt: lastCustomer, lastOwnSideAt: lastTeam \} = chatActivity\(rows, "oalab"\);/);
  assert.match(areas, /text: chatText\(row\)/);
});
