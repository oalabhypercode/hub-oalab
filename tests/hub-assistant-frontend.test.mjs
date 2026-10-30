import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CHAT_VERSION, MAX_STORED_CHARS, MAX_STORED_TURNS, applyProposalStatus, chatKey, isExpired, openProposalIds, parseChat, serializeChat,
} from "../lib/hub-assistant/chat-storage.ts";
import { actionOutcome, actionSummary, actionTarget, kindLabels, outcomeLabels } from "../lib/hub-assistant/log-rules.ts";

// Windows checkouts may carry CRLF line endings; the source checks below compare LF text.
const source = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

const proposal = (id, state = "open", expiresAt = "2026-10-30T12:30:00.000Z") => ({ view: { id, expiresAt }, state });

test("the stored chat keeps the newest turns, never a half-done answer or a proposal being saved", () => {
  const turns = Array.from({ length: MAX_STORED_TURNS + 5 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `Nachricht ${index}` }));
  const kept = JSON.parse(serializeChat(turns)).turns;
  assert.equal(kept.length, MAX_STORED_TURNS);
  assert.equal(kept[0].content, "Nachricht 5");
  const running = JSON.parse(serializeChat([{ role: "user", content: "Frage" }, { role: "assistant", content: "" }])).turns;
  assert.deepEqual(running, [{ role: "user", content: "Frage" }]);
  const saving = JSON.parse(serializeChat([{ role: "assistant", content: "", proposals: [proposal("p1", "saving")] }])).turns;
  assert.equal(saving[0].proposals[0].state, "open");
  assert.equal(serializeChat([]), null);
  assert.equal(chatKey("u1"), "hub-assistant-chat:u1");
});

test("pasted transcripts are kept, but the stored text stays below the limit by dropping the oldest turns", () => {
  const transcript = "x".repeat(60_000);
  const turns = Array.from({ length: 40 }, () => ({ role: "user", content: transcript }));
  const text = serializeChat(turns);
  assert.ok(text.length <= MAX_STORED_CHARS);
  const kept = JSON.parse(text).turns;
  assert.ok(kept.length < 40 && kept.length > 1);
  assert.equal(kept.at(-1).content, transcript);
});

test("an unreadable or foreign stored chat starts empty instead of breaking the panel", () => {
  const stored = serializeChat([{ role: "user", content: "Hallo" }, { role: "assistant", content: "Hi", proposals: [proposal("p1")] }]);
  assert.equal(parseChat(stored).length, 2);
  assert.deepEqual(parseChat(null), []);
  assert.deepEqual(parseChat("{kaputt"), []);
  assert.deepEqual(parseChat(JSON.stringify({ v: CHAT_VERSION + 1, turns: [] })), []);
  assert.deepEqual(parseChat(JSON.stringify({ v: CHAT_VERSION, turns: [{ role: "system", content: "x" }] })), []);
  assert.deepEqual(parseChat(JSON.stringify({ v: CHAT_VERSION, turns: [{ role: "assistant", content: "x", proposals: [{ state: "open" }] }] })), []);
});

test("restored open proposals follow the server: saved, discarded, failed, expired or still open", () => {
  const turns = [{ role: "assistant", content: "", proposals: [proposal("a"), proposal("b"), proposal("c"), proposal("d"), proposal("e"), proposal("f", "saved")] }];
  assert.deepEqual(openProposalIds(turns), ["a", "b", "c", "d", "e"]);
  const updated = applyProposalStatus(turns, { a: "done", b: "discarded", c: "expired", d: "proposed", e: "missing", f: "discarded" })[0].proposals;
  assert.deepEqual(updated.map((item) => item.state), ["saved", "discarded", "expired", "open", "expired", "saved"]);
  assert.match(updated[2].message, /Abgelaufen \(30 Minuten\)/);
  assert.equal(applyProposalStatus(turns, {})[0], turns[0]);
  const now = Date.parse("2026-10-30T12:30:00.000Z");
  assert.equal(isExpired(proposal("x"), now), true);
  assert.equal(isExpired(proposal("x"), now - 1), false);
  assert.equal(isExpired(proposal("x", "saved"), now + 1), false);
});

test("the KI-Protokoll names outcome, kind, target and content of each proposal", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  assert.equal(actionOutcome("proposed", "2026-10-30T12:10:00Z", now), "open");
  assert.equal(actionOutcome("proposed", "2026-10-30T11:59:00Z", now), "expired");
  for (const status of ["executing", "done", "discarded", "failed"]) assert.equal(actionOutcome(status, "2026-10-30T11:00:00Z", now), status);
  assert.equal(outcomeLabels.done, "Gespeichert");
  assert.equal(kindLabels["customer.create"], "Neuer Kunde");

  const tasks = { projectName: "Website", customer: "Nalbach & Hinkel", tasks: [{ title: "Logo freigeben" }, { title: "Texte liefern" }, { title: "Bilder" }, { title: "Impressum" }] };
  assert.equal(actionSummary("tasks.create", tasks), "4 Aufgaben: Logo freigeben, Texte liefern, Bilder …");
  assert.equal(actionTarget("tasks.create", tasks, null), "Nalbach & Hinkel · Website");
  assert.equal(actionSummary("tasks.update", { tasks: [{ number: 12 }, { number: 13 }] }), "2 Aufgaben: #12, #13");
  assert.equal(actionSummary("project.update", { changes: [{ field: "status", before: "active", after: "hold" }, { field: "dueOn", before: null, after: "2026-12-04" }, { field: "description", before: "", after: "x", note: "x" }] }),
    "Status: Aktiv → Pausiert · Zieltermin: 4. Dez. 2026 · Notiz");
  const customer = { company: "TEST GmbH", login: { firstName: "Erika", lastName: "Probe", email: "e@example.com", taken: false } };
  assert.equal(actionSummary("customer.create", customer), "TEST GmbH · Login für Erika Probe");
  assert.equal(actionTarget("customer.create", customer, { customer_number: "OA-12345" }), "TEST GmbH · OA-12345");
  assert.equal(actionSummary("tasks.create", null), "0 Aufgaben");
});

test("the chat lives per login in this browser, ends with signing out and docks without a dialog", async () => {
  const shell = await source("components/hub/app-shell.tsx");
  assert.match(shell, /const chatStore = !preview && !publicDemo && userId \? chatKey\(userId\) : null;/);
  const signOut = shell.slice(shell.indexOf("async function signOut()"));
  assert.ok(signOut.indexOf("localStorage.removeItem(chatStore)") > 0 && signOut.indexOf("localStorage.removeItem(chatStore)") < signOut.indexOf('window.location.replace("/auth/login")'));
  assert.match(shell, /proposalStatuses\(\{ ids: restoredIds \}\)/);
  assert.match(await source("app/dashboard/layout.tsx"), /<AppShell key=\{identity\.userId\} userId=\{identity\.userId\}/);
  const panel = await source("components/hub/assistant-panel.tsx");
  assert.match(panel, /Der Hub speichert sie nicht auf seinem Server; der Chatverlauf bleibt in diesem Browser, bis du „Neu starten“ klickst oder dich abmeldest\./);
  assert.match(panel, /return mode === "dock" \? \(\n    <aside className="assistant-dock glass"/);
  assert.match(panel, /onClick=\{\(\) => \{ setTurns\(\[\]\); setError\(""\); onClearProject\(\); \}\}/);
  // The project stays the reference when docked, where the project dialog has to close.
  assert.match(panel, /projectId: url\.searchParams\.get\("project"\) \?\? project\?\.id \?\? null/);
  assert.match(await source("components/hub/hub-view.tsx"), /askAboutProject\(\{ id: project\.id, name: project\.category \|\| project\.name \}\); if \(assistantDocked\) onClose\(\);/);
  const actions = await source("lib/hub-assistant/actions.ts");
  assert.match(actions, /export async function proposalStatuses\(input: \{ ids: unknown \}\)[^]*?const ctx = await actor\(\);\n  if \(!ctx\) return denied;[^]*?\.eq\("actor_id", ctx\.userId\)/);
});

test("the KI-Protokoll is an admin section read with the server key only after the admin check", async () => {
  assert.match(await source("lib/hub-data.ts"), /adminSections: readonly HubSection\[\] = \["users", "ai-log"\]/);
  assert.match(await source("components/hub/glass-sidebar.tsx"), /\{manageUsers && <>[^]*?item\("ai-log"\)[^]*?<\/>\}/);
  assert.match(await source("app/dashboard/[section]/page.tsx"), /validSection === "ai-log" \? loadAssistantLog\(\) : undefined/);
  const log = await source("lib/hub-assistant/log.ts");
  assert.match(log, /^import "server-only";/);
  assert.ok(log.indexOf("verifyHubAdmin()") < log.indexOf("createAdminClient()"));
});
