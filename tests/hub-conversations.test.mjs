import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { clockTime, conversationState, dayLabel, listTime, messageSide, previewText, readMessage, requestReference, senderLabel, threadItems } from "../lib/hub-conversations/rules.ts";
import { chatListSender, chatMessageSide, chatSender, chatUnread, peopleLine, readByOtherSide } from "../lib/hub-private-chat/rules.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8").then((text) => text.replace(/\r\n/g, "\n"));
const now = new Date("2026-11-02T12:00:00+01:00");

// ---------------------------------------------------------------- service conversations (admins read along)

test("the states read as on the service platform", () => {
  assert.deepEqual(conversationState("awaiting_client"), { label: "Du bist dran", tone: "todo", group: "waiting" });
  assert.equal(conversationState("triage_needed").label, "Eingegangen");
  assert.equal(conversationState("running").label, "In Bearbeitung");
  assert.equal(conversationState("beta_ready").label, "Deine Freigabe");
  assert.equal(conversationState("blocked").label, "Wir kümmern uns");
  assert.deepEqual(conversationState("resolved"), { label: "Gelöst", tone: "ok", group: "done" });
  assert.deepEqual(conversationState("released"), { label: "Live", tone: "ok", group: "done" });
  for (const state of ["rejected", "cancelled", "superseded", "archived"]) {
    assert.deepEqual(conversationState(state), { label: "Abgeschlossen", tone: "off", group: "done" }, state);
  }
  assert.equal(requestReference(1024), "OA-1024");
});

test("admins read the service conversations from oalab's side, with names", () => {
  assert.equal(senderLabel("client", "Paul Brandt"), "Paul Brandt");
  assert.equal(senderLabel("client", null), "Kunde");
  assert.equal(senderLabel("oalab", null), "oalab-Team");
  assert.equal(senderLabel("oalab", "Lena Schneider"), "Lena Schneider");
  assert.equal(senderLabel("assistant", null), "oalab-Assistent");
  assert.equal(senderLabel("system", null), "");
  assert.equal(messageSide("client"), "in");
  assert.equal(messageSide("oalab"), "out");
  assert.equal(messageSide("assistant"), "out");
  assert.equal(messageSide("system"), "center");
});

test("the list shows one plain line per conversation", () => {
  assert.equal(previewText("**Fertig!** Die [Brand Direction](https://example.org/x) liegt\n\nbei den Dateien."), "Fertig! Die Brand Direction liegt bei den Dateien.");
  assert.equal(previewText("## Stand\n> Zitat"), "Stand Zitat");
  assert.equal(previewText("a".repeat(130)), `${"a".repeat(119)}…`);
});

test("days and times read like a messenger, in German time", () => {
  assert.equal(dayLabel("2026-11-02T08:00:00Z", now), "Heute");
  assert.equal(dayLabel("2026-11-01T20:00:00Z", now), "Gestern");
  assert.equal(dayLabel("2026-10-13T14:12:00Z", now), "Dienstag, 13. Oktober");
  assert.equal(dayLabel("2025-12-24T10:00:00Z", now), "24. Dezember 2025");
  assert.equal(listTime("2026-11-02T08:40:00Z", now), "09:40");
  assert.equal(listTime("2026-11-01T08:40:00Z", now), "Gestern");
  assert.equal(listTime("2026-10-30T08:40:00Z", now), "Fr");
  assert.equal(listTime("2026-10-02T08:40:00Z", now), "02.10.");
  assert.equal(listTime("2025-10-02T08:40:00Z", now), "02.10.25");
  assert.equal(clockTime("2026-10-14T07:40:00Z"), "09:40");
});

test("messages in a row by the same writer form a run, and each new day gets its divider", () => {
  const items = threadItems([
    { at: "2026-10-13T14:12:00Z", author: "me" },
    { at: "2026-10-13T14:30:00Z", author: "team" },
    { at: "2026-10-14T07:39:00Z", author: "team" },
    { at: "2026-10-14T07:40:00Z", author: "team" },
  ], now);
  assert.deepEqual(items.map(({ day, first, last }) => ({ day, first, last })), [
    { day: "Dienstag, 13. Oktober", first: true, last: true },
    { day: null, first: true, last: true },
    { day: "Mittwoch, 14. Oktober", first: true, last: false },
    { day: null, first: false, last: true },
  ]);
});

test("a chat message is text up to 5000 characters, never only spaces", () => {
  assert.deepEqual(readMessage("  Passt so, danke!\r\n "), { ok: true, value: "Passt so, danke!" });
  assert.equal(readMessage("   ").ok, false);
  assert.equal(readMessage(42).ok, false);
  assert.equal(readMessage("x".repeat(5001)).ok, false);
});

test("only active admins read service conversations in the hub, client-visible ones, and nothing is written to them", async () => {
  const server = await source("lib/hub-conversations/server.ts");
  assert.match(server, /export const conversationReader = cache\(async \(\): Promise<\{ readonly userId: string \} \| null> => verifyHubAdmin\(\)\);/);
  assert.match(server, /if \(!\(await conversationReader\(\)\)\) return failed\(unavailable\);/);
  assert.match(server, /if \(identity\.publicDemo \|\| identity\.demoAccess \|\| identity\.account\?\.role !== "oalab_admin"\) return undefined;/);
  // Only what the client may see, never internal notes or drafts, and nothing from the bin.
  assert.equal((server.match(/\.eq\("visibility", "client"\)/g) ?? []).length, 2);
  assert.equal((server.match(/\.is\("trashed_at", null\)/g) ?? []).length, 2);
  // Reading only: no mark that would hold back a customer's reply e-mail, no write into a request.
  assert.doesNotMatch(server, /request_seen|\.insert\(|\.upsert\(|\.update\(/);
  const actions = await source("lib/hub-conversations/actions.ts");
  assert.match(actions, /^"use server";/);
  assert.match(actions, /if \(!db \|\| !\(await conversationReader\(\)\)\) return unavailable;/);
  assert.doesNotMatch(actions, /fetch\(|api\/hub\/requests|sendConversationMessage|access_token/);
});

test("service conversations carry the customer's logo from the Asset Management", async () => {
  const server = await source("lib/hub-conversations/server.ts");
  assert.match(server, /db\.from\("hub_customers"\)\.select\("id, organization_id"\)\.in\("organization_id", ids\)/);
  assert.match(server, /const logos = await loadCustomerLogos\(await createClient\(\), \[\.\.\.customerOf\.values\(\)\]\);/);
  const screen = await source("components/hub/screens/conversations.tsx");
  assert.match(screen, /<CustomerSign customer=\{\{ id: conversation\.customerId \?\? company, company \}\} logo=\{conversation\.logo\} \/>/);
  // The regular look for news keeps the signed links of the page, so the logos do not load again every 15 seconds.
  assert.match(screen, /const \[logos\] = useState\(\(\) => new Map\(initial\.conversations\.map\(\(item\) => \[item\.id, item\.logo\]\)\)\);/);
});

// ---------------------------------------------------------------- private chat

test("a chat is new while the other side wrote after the last look and after the own side's last message", () => {
  assert.equal(chatUnread({ lastOtherAt: null, lastOwnSideAt: null, readAt: null }), false);
  assert.equal(chatUnread({ lastOtherAt: "2026-11-04T09:12:00Z", lastOwnSideAt: null, readAt: null }), true);
  assert.equal(chatUnread({ lastOtherAt: "2026-11-04T09:12:00Z", lastOwnSideAt: null, readAt: "2026-11-04T09:13:00Z" }), false);
  // A colleague (or another admin) answered: settled for the whole side.
  assert.equal(chatUnread({ lastOtherAt: "2026-11-04T09:12:00Z", lastOwnSideAt: "2026-11-04T09:20:00Z", readAt: null }), false);
  assert.equal(chatUnread({ lastOtherAt: "2026-11-04T09:30:00Z", lastOwnSideAt: "2026-11-04T09:20:00Z", readAt: "2026-11-04T09:21:00Z" }), true);
  assert.equal(readByOtherSide("2026-11-04T09:12:00Z", ["2026-11-04T09:11:00Z"]), false);
  assert.equal(readByOtherSide("2026-11-04T09:12:00Z", ["2026-11-04T09:11:00Z", "2026-11-04T09:12:00Z"]), true);
});

test("customers read oalab's people as „Lena von oalab“, admins read everybody by name", () => {
  assert.equal(chatSender({ side: "oalab", own: false, name: "Lena Schneider", viewer: "customer" }), "Lena von oalab");
  assert.equal(chatSender({ side: "oalab", own: false, name: null, viewer: "customer" }), "oalab-Team");
  assert.equal(chatSender({ side: "customer", own: false, name: "Tim Berger", viewer: "customer" }), "Tim Berger");
  assert.equal(chatSender({ side: "oalab", own: false, name: "Tom Weber", viewer: "oalab" }), "Tom Weber");
  assert.equal(chatSender({ side: "customer", own: false, name: "Jana Sommer", viewer: "oalab" }), "Jana Sommer");
  assert.equal(chatSender({ side: "customer", own: true, name: "Jana Sommer", viewer: "customer" }), "Du");
  assert.equal(chatListSender({ side: "oalab", own: false, name: "Lena Schneider" }), "Lena");
  assert.equal(chatListSender({ side: "customer", own: false, name: "Paul Brandt" }), "Paul Brandt");
  assert.equal(chatListSender({ side: "oalab", own: true, name: "Lena Schneider" }), "Du");
  // Right side: customers only their own messages (colleagues write like in a group), admins all of oalab.
  assert.equal(chatMessageSide({ side: "customer", own: true, viewer: "customer" }), "out");
  assert.equal(chatMessageSide({ side: "customer", own: false, viewer: "customer" }), "in");
  assert.equal(chatMessageSide({ side: "oalab", own: false, viewer: "customer" }), "in");
  assert.equal(chatMessageSide({ side: "oalab", own: false, viewer: "oalab" }), "out");
  assert.equal(chatMessageSide({ side: "customer", own: false, viewer: "oalab" }), "in");
  assert.equal(peopleLine([]), "");
  assert.equal(peopleLine(["Jana Sommer"]), "Jana Sommer");
  assert.equal(peopleLine(["Jana Sommer", "Tim Berger", "Mia Roth"]), "Jana Sommer, Tim Berger und Mia Roth");
});

test("the examples: customers have their company's chat, admins several customers and one without a chat yet", async () => {
  const fixtures = await source("lib/hub-private-chat/fixtures.ts");
  assert.match(fixtures, /\{ id: "demo-chat-own", company: customer,/);
  assert.match(fixtures, /\{ id: "demo-chat-hansen", company: "Bäckerei Hansen", customerNumber: "OA-4417", readAt: null, messages: \[\] \}/);
  assert.match(fixtures, /const state: PrivateChatState = \{ source: "fixtures", viewer, chats: summaries, error: null \};/);
});

test("private chats are read and written with the person's own session; names and read marks after the access check", async () => {
  const server = await source("lib/hub-private-chat/server.ts");
  assert.match(server, /^import "server-only";/);
  assert.match(server, /if \(await verifyHubAdmin\(\)\) return \{ userId: data\.claims\.sub, side: "oalab", customerIds: \[\] \};/);
  assert.match(server, /supabase\.from\("hub_customer_members"\)\.select\("customer_id"\)\.eq\("user_id", data\.claims\.sub\)/);
  assert.match(server, /if \(viewer\.side === "customer" && !viewer\.customerIds\.includes\(customerId\)\) return \{ ok: false, error: NOT_FOUND \};/);
  // Messages and read marks of the reader's chats come through the session (RLS), the server key only names people.
  assert.match(server, /supabase\.from\("hub_private_messages"\)\.select\(MESSAGES\)\.eq\("customer_id", customerId\)/);
  assert.doesNotMatch(server.slice(0, server.indexOf("export async function markPrivateRead")), /db\.from\("hub_private/);
  // The read mark and the bell: for admins the whole team counts as having read the chat.
  const mark = server.slice(server.indexOf("export async function markPrivateRead"));
  assert.match(mark, /db\.from\("hub_private_reads"\)\.upsert\(\{ customer_id: customerId, user_id: viewer\.userId, side: viewer\.side, read_at: at \}, \{ onConflict: "customer_id,user_id" \}\)/);
  assert.match(mark, /viewer\.side === "oalab" \? notices\.eq\("kind", "chat\.message"\) : notices\.eq\("kind", "chat\.reply"\)\.eq\("user_id", viewer\.userId\)/);
  // The layout's count costs no signed links; the page adds the logos.
  assert.match(server, /export async function loadPrivateChatPage\(\)[\s\S]*?loadCustomerLogos\(await createClient\(\)\)/);
  assert.match(server, /export async function countUnreadPrivateChats[\s\S]*?const state = await loadPrivateChats\(\);/);
});

test("sending a private message: checked, written as the person, once per draft, then the other side hears of it", async () => {
  const actions = await source("lib/hub-private-chat/actions.ts");
  assert.match(actions, /^"use server";/);
  const send = actions.slice(actions.indexOf("export async function sendPrivateMessage"));
  assert.match(send, /if \(!uuid\.test\(String\(input\?\.customerId\)\) \|\| !uuid\.test\(String\(input\?\.clientId\)\)\) return notFound;/);
  assert.match(send, /const message = readMessage\(input\.body\);/);
  assert.match(send, /const before = await loadPrivateThread\(viewer, input\.customerId\);\n {2}if \(!before\.ok\) return before;/);
  assert.match(send, /supabase\.from\("hub_private_messages"\)\.insert\(\{ customer_id: input\.customerId, side: viewer\.side, body: message\.value, client_id: input\.clientId \}\)/);
  assert.match(send, /const repeated = error\?\.code === "23505";/);
  assert.match(send, /after\(\(\) => notifyChat\(\{ side: viewer\.side, customerId: input\.customerId, company, authorId: viewer\.userId, body: message\.value \}\)\)/);
  assert.doesNotMatch(actions, /createAdminClient/);
});

test("Nachrichten: customers get their private chat and the way to the service platform, admins the tabs Privat and Service", async () => {
  assert.match(await source("app/dashboard/[section]/page.tsx"), /validSection === "messages" \? loadPrivateChatsForIdentity\(identity\) : undefined/);
  assert.match(await source("app/dashboard/layout.tsx"), /countUnreadPrivateChats\(identity\)/);
  assert.match(await source("components/hub/app-shell.tsx"), /messages: unreadConversations \?\? \(hasDemo \? 1 : 0\)/);
  assert.match(await source("components/hub/hub-view.tsx"), /<ConversationsScreen \{\.\.\.screen\} conversations=\{populated \? undefined : conversations\} privateChats=\{populated \? undefined : privateChats\} \/>/);
  const entry = await source("components/hub/screens/conversations.tsx");
  assert.match(entry, /const tab: ChatTab = admin && params\.get\("tab"\) === "service" \? "service" : "private";/);
  assert.match(entry, /Du liest mit\. Antworten und interne Notizen von oalab entstehen in NoteTree Business\./);
  const screen = await source("components/hub/screens/private-chat.tsx");
  assert.match(screen, /<button type="button" aria-pressed=\{tab === "private"\}/);
  assert.match(screen, /href=\{`\$\{SERVICE_PLATFORM_URL\}\/requests\/new`\} target="_blank" rel="noopener noreferrer">Anfrage stellen/);
  // Ali keeps thinking along at the bottom of the customer's column.
  assert.match(screen, /\{!admin && <MessagesHost \/>\}/);
  // Admins see every customer with the logo from the Asset Management, also when writing to one first.
  assert.match(screen, /<CustomerSign customer=\{\{ id: item\.customerId, company: item\.company \}\} logo=\{logoOf\(item\.customerId\)\} \/>/);
  assert.match(screen, /<Modal title="Kunden anschreiben" onClose=\{onClose\}>/);
  // News without reloading, only while the page is visible; Enter sends, Shift + Enter makes a new line.
  assert.match(screen, /const POLL_MS = 15_000;/);
  assert.match(screen, /if \(document\.visibilityState !== "visible"\) return;/);
  assert.match(screen, /event\.key === "Enter" && !event\.shiftKey && !event\.nativeEvent\.isComposing/);
  const css = await source("app/glass.css");
  assert.match(css, /\.chat-msg\.is-out \.chat-bubble \{ background: var\(--accent-text\); color: var\(--on-accent\); \}/);
  assert.match(css, /\.chat-tabs button\[aria-pressed="true"\] \{/);
  // On phones an open chat fills the screen and the tab bar steps aside.
  assert.match(css, /\.chat\[data-open\] \.chat-pane \{ position: fixed; z-index: 60; inset: 0;/);
  assert.match(css, /:root:has\(\.chat\[data-open\]\) :is\(\.tab-bar-wrap, \.scroll-edge\) \{ display: none; \}/);
});
