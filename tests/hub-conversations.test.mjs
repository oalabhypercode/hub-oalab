import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { clockTime, conversationState, dayLabel, isUnread, listTime, messageSide, previewText, readMessage, replyError, requestReference, senderLabel, threadItems } from "../lib/hub-conversations/rules.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8").then((text) => text.replace(/\r\n/g, "\n"));
const now = new Date("2026-11-02T12:00:00+01:00");

test("the states read as on the service platform, and finished requests take no more messages", () => {
  assert.deepEqual(conversationState("awaiting_client"), { label: "Du bist dran", tone: "todo", group: "waiting", canReply: true });
  assert.equal(conversationState("triage_needed").label, "Eingegangen");
  assert.equal(conversationState("running").label, "In Bearbeitung");
  assert.equal(conversationState("beta_ready").label, "Deine Freigabe");
  assert.equal(conversationState("blocked").label, "Wir kümmern uns");
  // Resolved requests open again with a client message; released and closed ones do not.
  assert.deepEqual(conversationState("resolved"), { label: "Gelöst", tone: "ok", group: "done", canReply: true });
  assert.deepEqual(conversationState("released"), { label: "Live", tone: "ok", group: "done", canReply: false });
  for (const state of ["rejected", "cancelled", "superseded", "archived"]) {
    assert.deepEqual(conversationState(state), { label: "Abgeschlossen", tone: "off", group: "done", canReply: false }, state);
  }
  assert.equal(requestReference(1024), "OA-1024");
});

test("a conversation is unread while the newest answer from oalab came after the last look", () => {
  assert.equal(isUnread(null, null), false);
  assert.equal(isUnread("2026-11-02T09:40:00Z", null), true);
  assert.equal(isUnread("2026-11-02T09:40:00Z", "2026-11-02T09:41:00Z"), false);
  assert.equal(isUnread("2026-11-02T09:40:00Z", "2026-11-02T09:39:59Z"), true);
});

test("clients read Du and the oalab team; admins read along from oalab's side", () => {
  assert.equal(senderLabel("client", true, null), "Du");
  assert.equal(senderLabel("client", false, "Paul Brandt"), "Paul Brandt");
  assert.equal(senderLabel("oalab", false, null), "oalab-Team");
  assert.equal(senderLabel("assistant", false, null), "oalab-Assistent");
  assert.equal(senderLabel("system", false, null), "");
  assert.equal(messageSide("client", true, false), "out");
  assert.equal(messageSide("client", false, false), "in");
  assert.equal(messageSide("oalab", false, false), "in");
  assert.equal(messageSide("oalab", false, true), "out");
  assert.equal(messageSide("assistant", false, true), "out");
  assert.equal(messageSide("client", false, true), "in");
  assert.equal(messageSide("system", false, false), "center");
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

test("a reply is text up to the service platform's limit, and its errors read as sentences", () => {
  assert.deepEqual(readMessage("  Passt so, danke!\r\n "), { ok: true, value: "Passt so, danke!" });
  assert.equal(readMessage("   ").ok, false);
  assert.equal(readMessage(42).ok, false);
  assert.equal(readMessage("x".repeat(5001)).ok, false);
  assert.match(replyError(409, "STALE_VERSION"), /Inzwischen kam etwas Neues/);
  assert.match(replyError(429, "RATE_LIMITED"), /eine Minute/);
  assert.match(replyError(401, undefined), /Sitzung ist abgelaufen/);
  assert.match(replyError(0, undefined), /nicht angekommen/);
});

test("customers read only their company's conversations, without oalab's internal notes; admins only read along", async () => {
  const server = await source("lib/hub-conversations/server.ts");
  // Who reads is decided first: admins pass the user management's check, customers name their company with their own session.
  assert.match(server, /if \(await verifyHubAdmin\(\)\) return \{ userId: data\.claims\.sub, admin: true/);
  assert.match(server, /supabase\.from\("hub_customer_members"\)\.select\("customer:hub_customers\(organization_id\)"\)\.eq\("user_id", data\.claims\.sub\)/);
  assert.match(server, /if \(!viewer\.admin\) query = query\.in\("organization_id", viewer\.organizationIds\)/);
  assert.match(server, /if \(!viewer\.admin && !viewer\.organizationIds\.includes\(request\.data\.organization_id\)\) return null;/);
  // Only what the client may see, never internal notes or drafts, and nothing from the bin.
  assert.equal((server.match(/\.eq\("visibility", "client"\)/g) ?? []).length, 2);
  assert.equal((server.match(/\.is\("trashed_at", null\)/g) ?? []).length, 2);
  // Admins leave no mark and get no count; their reading must not suppress a customer's reply e-mail.
  assert.match(server, /export async function markThreadSeen[\s\S]*?if \(viewer\.admin\) return;/);
  assert.match(server, /canReply: !viewer\.admin && state\.canReply/);
});

test("a client's reply goes to the service platform with the person's own token, never as an admin", async () => {
  const actions = await source("lib/hub-conversations/actions.ts");
  assert.match(actions, /^"use server";/);
  const send = actions.slice(actions.indexOf("export async function sendConversationMessage"));
  assert.match(send, /if \(!uuid\.test\(String\(input\?\.id\)\) \|\| !uuid\.test\(String\(input\?\.clientGeneratedId\)\)\) return notFound;/);
  assert.match(send, /const message = readMessage\(input\.body\);/);
  assert.match(send, /if \(read\.viewer\.admin\) return \{ ok: false/);
  assert.match(send, /const thread = await loadThread\(read\.db, read\.viewer, input\.id\);\n {2}if \(!thread\) return notFound;/);
  assert.match(actions, /`\$\{SERVICE_PLATFORM_URL\}\/api\/hub\/requests\/\$\{encodeURIComponent\(reference\)\}\/messages`/);
  assert.match(actions, /authorization: `Bearer \$\{token\}`/);
  // A retry after an internal change uses a fresh client id, because the first try wrote nothing.
  assert.match(send, /clientGeneratedId: randomUUID\(\), expectedVersion: latest\.conversation\.version/);
});

test("the Nachrichten page is the chat, with unread counts in the sidebar and the tab bar", async () => {
  assert.match(await source("app/dashboard/[section]/page.tsx"), /validSection === "messages" \? loadConversationsForIdentity\(identity\) : undefined/);
  assert.match(await source("app/dashboard/layout.tsx"), /countUnreadConversations\(identity\)/);
  assert.match(await source("components/hub/app-shell.tsx"), /messages: unreadConversations \?\? \(hasDemo \? 1 : 0\)/);
  assert.match(await source("components/hub/hub-view.tsx"), /section === "messages" \? <ConversationsScreen \{\.\.\.screen\} conversations=\{populated \? undefined : conversations\} \/>/);
  const screen = await source("components/hub/screens/conversations.tsx");
  assert.match(screen, /<h2>Gespräche<\/h2>/);
  // News without reloading, but only while the page is visible.
  assert.match(screen, /const POLL_MS = 15_000;/);
  assert.match(screen, /if \(document\.visibilityState !== "visible"\) return;/);
  // Enter sends, Shift + Enter makes a new line; admins get a note instead of the field.
  assert.match(screen, /event\.key === "Enter" && !event\.shiftKey && !event\.nativeEvent\.isComposing/);
  assert.match(screen, /Du liest mit\. Antworten und interne Notizen von oalab entstehen in NoteTree Business\./);
  const css = await source("app/glass.css");
  assert.match(css, /\.chat-msg\.is-out \.chat-bubble \{ background: var\(--accent-text\); color: var\(--on-accent\); \}/);
  // On phones an open conversation fills the screen and the tab bar steps aside.
  assert.match(css, /\.chat\[data-open\] \.chat-pane \{ position: fixed; z-index: 60; inset: 0;/);
  assert.match(css, /:root:has\(\.chat\[data-open\]\) :is\(\.tab-bar-wrap, \.scroll-edge\) \{ display: none; \}/);
});

test("the arrow opens the conversation on the service platform, at the address its e-mails use", async () => {
  const screen = await source("components/hub/screens/conversations.tsx");
  assert.match(screen, /href=\{`\$\{SERVICE_PLATFORM_URL\}\/requests\/\$\{conversation\.reference\}\/received`\}/);
  // /workspace is oalab's studio; customers who open it land back in the hub.
  assert.doesNotMatch(screen, /SERVICE_PLATFORM_URL\}\/workspace/);
});
