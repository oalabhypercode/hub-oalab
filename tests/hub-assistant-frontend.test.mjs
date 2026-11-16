import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CHAT_VERSION, MAX_STORED_CHARS, MAX_STORED_TURNS, applyProposalStatus, chatKey, isExpired, openProposalIds, parseChat, serializeChat,
} from "../lib/hub-assistant/chat-storage.ts";
import { actionOutcome, actionSummary, actionTarget, kindLabels, outcomeLabels } from "../lib/hub-assistant/log-rules.ts";
import {
  chosenMic, DICTATION_LANG, dictationError, formatDictationTime, joinDictation, MAX_DICTATION_MS, micChoices, micErrorCode, MIC_STORAGE_KEY, SILENCE_STOP_MS, storedMic,
} from "../lib/hub-assistant/dictation.ts";

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
  assert.match(shell, /const chatStore = !preview && userId \? chatKey\(userId\) : null;/);
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
  assert.match(await source("lib/hub-data.ts"), /adminSections: readonly HubSection\[\] = \["users", "ai-log", "keychain"\]/);
  assert.match(await source("components/hub/glass-sidebar.tsx"), /\{manageUsers && <>[^]*?item\("ai-log"\)[^]*?<\/>\}/);
  assert.match(await source("app/dashboard/[section]/page.tsx"), /validSection === "ai-log" \? loadAssistantLog\(\) : undefined/);
  const log = await source("lib/hub-assistant/log.ts");
  assert.match(log, /^import "server-only";/);
  assert.ok(log.indexOf("verifyHubAdmin()") < log.indexOf("createAdminClient()"));
});

test("dictated words join the field with one space; a sentence starts with a capital letter", () => {
  assert.equal(joinDictation("", "  drei   aufgaben anlegen "), "Drei aufgaben anlegen");
  assert.equal(joinDictation("Bitte", "zwei aufgaben"), "Bitte zwei aufgaben");
  assert.equal(joinDictation("Lege an:", "texte prüfen"), "Lege an: Texte prüfen");
  assert.equal(joinDictation("Fertig?  ", "ja"), "Fertig? Ja");
  assert.equal(joinDictation("Erstens.\n", "zweitens"), "Erstens.\nZweitens");
  assert.equal(joinDictation("Text", "   "), "Text");
  assert.equal(joinDictation("   ", "über die startseite"), "Über die startseite");
});

test("dictation explains its stops in German; a stop on purpose says nothing", () => {
  assert.match(dictationError("not-allowed"), /gesperrt.*Adresszeile/);
  assert.equal(dictationError("service-not-allowed"), dictationError("not-allowed"));
  assert.match(dictationError("audio-capture"), /Kein Mikrofon/);
  assert.match(dictationError("no-speech"), /nichts gehört/);
  assert.match(dictationError("network"), /Internetverbindung/);
  assert.match(dictationError("language-not-supported"), /Deutsch/);
  assert.equal(dictationError("aborted"), "");
  assert.match(dictationError("something-new"), /abgebrochen/);
  assert.equal(micErrorCode("NotAllowedError"), "not-allowed");
  assert.equal(micErrorCode("NotReadableError"), "audio-capture");
  assert.equal(micErrorCode("AbortError"), "unknown");
  assert.deepEqual([formatDictationTime(0), formatDictationTime(7400), formatDictationTime(84_000)], ["0:00", "0:07", "1:24"]);
  assert.equal(DICTATION_LANG, "de-DE");
  assert.equal(SILENCE_STOP_MS, 6000);
  assert.equal(MAX_DICTATION_MS, 5 * 60_000);
});

test("microphones: Chromium's aliases are left out, the remembered one counts only while the browser has it", () => {
  const devices = [
    { kind: "audioinput", deviceId: "default", label: "Standard - Headset" },
    { kind: "audioinput", deviceId: "communications", label: "Kommunikation - Headset" },
    { kind: "audioinput", deviceId: "a1", label: "Headset" },
    { kind: "audioinput", deviceId: "b2", label: "" },
    { kind: "videoinput", deviceId: "c3", label: "Kamera" },
  ];
  const mics = micChoices(devices);
  assert.deepEqual(mics, [{ deviceId: "a1", label: "Headset" }, { deviceId: "b2", label: "Mikrofon 2" }]);
  assert.deepEqual(chosenMic(mics, storedMic(mics[0])), { known: true, mic: mics[0] });
  assert.deepEqual(chosenMic(mics, storedMic(null)), { known: true, mic: null }, "the standard microphone is a choice too");
  assert.deepEqual(chosenMic(mics, JSON.stringify({ id: "gone" })), { known: false, mic: null }, "an unplugged microphone asks again");
  assert.deepEqual(chosenMic(mics, null), { known: false, mic: null });
  assert.deepEqual(chosenMic(mics, "{kaputt"), { known: false, mic: null });
  assert.equal(MIC_STORAGE_KEY, "oalab-hub-mic");
});

test("the chat offers dictation to admins only; German, continuous, the microphone's track only on desktop Chrome and Edge", async () => {
  const panel = await source("components/hub/assistant-panel.tsx");
  assert.match(panel, /const canDictate = admin && dictation\.supported;/);
  assert.match(panel, /\{available && canDictate && <DictationBar dictation=\{dictation\} \/>\}/);
  assert.match(panel, /\{canDictate && <DictationButton dictation=\{dictation\} disabled=\{busy\} \/>\}\n\s+<button type="submit" className="assistant-send"/);
  // Sending while listening takes the words in progress along and ends the dictation; nothing is sent by itself.
  assert.match(panel, /const text = pendingWords \? joinDictation\(draft, pendingWords\) : draft;\n\s+if \(dictation\.state !== "idle"\) dictation\.cancel\(\);\n\s+ask\(text\);/);
  const hook = await source("components/hub/use-dictation.ts");
  assert.match(hook, /recognition\.lang = DICTATION_LANG;\n\s+recognition\.continuous = true;\n\s+recognition\.interimResults = true;/);
  assert.match(hook, /data\.mobile === false && data\.brands\?\.some\(\(item\) => item\.brand === "Chromium"\)/);
  assert.match(hook, /if \(track\) recognition\.start\(track\); else recognition\.start\(\);/);
  // Without desktop Chromium the page opens no microphone of its own (Safari and phones pick theirs).
  assert.match(hook, /if \(!desktopChromium\(\)\) \{\n\s+setState\("starting"\);\n\s+void begin\(null, false, null, token\);/);
  assert.match(hook, /useSyncExternalStore\(noSubscription, canDictate, \(\) => false\)/);
  // No audio ever leaves the page through the hub: nothing in the dictation talks to a server.
  assert.doesNotMatch(hook, /fetch\(|\/api\//);
  const knowledge = await source("lib/hub-assistant/knowledge.ts");
  assert.ok(knowledge.includes(`Nach ${SILENCE_STOP_MS / 1000} Sekunden ohne neue Wörter`));
  assert.ok(knowledge.includes(`höchstens ${MAX_DICTATION_MS / 60_000} Minuten am Stück`));
  assert.match(knowledge, /Firefox kann nicht diktieren/);
});
