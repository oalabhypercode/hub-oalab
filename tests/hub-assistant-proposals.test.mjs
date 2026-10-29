import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyChoices, foldTitle, MAX_PROPOSED_TASKS, prepareTaskProposal, proposalNote, PROPOSE_TASKS_TOOL } from "../lib/hub-assistant/proposals.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const projectId = "55555555-5555-4555-8555-555555555555";
const doneId = "66666666-6666-4666-8666-666666666666";
const data = {
  customers: [],
  projects: [
    { id: projectId, name: "Website", category: "", description: "", status: "In Umsetzung", progress: 0, date: "", artwork: "orange", company: "Nalbach & Hinkel", organizationId: "org-1", startedOn: null, dueOn: null, milestones: [],
      tasks: [{ id: "t1", number: 4, title: "Impressum prüfen", status: "todo", dueOn: null, customer: false, visible: false }, { id: "t2", number: 5, title: "Logo liefern", status: "done", dueOn: null, customer: true, visible: true }] },
    { id: doneId, name: "Alt", category: "", description: "", status: "Abgeschlossen", progress: 100, date: "", artwork: "orange", company: "X", organizationId: "org-2", startedOn: null, dueOn: null, milestones: [], tasks: [] },
  ],
};
const task = (title, extra = {}) => ({ title, description: "", owner: "oalab", visible_to_customer: false, due: null, ...extra });

test("the proposal tool is strict and its name says it only proposes", () => {
  assert.equal(PROPOSE_TASKS_TOOL.name, "propose_tasks");
  assert.equal(PROPOSE_TASKS_TOOL.strict, true);
  assert.match(PROPOSE_TASKS_TOOL.description, /nichts gespeichert/);
  const item = PROPOSE_TASKS_TOOL.input_schema.properties.tasks.items;
  assert.equal(item.additionalProperties, false);
  assert.deepEqual([...item.required].sort(), Object.keys(item.properties).sort());
});

test("a valid proposal keeps the project, flags duplicates and never invents dates", () => {
  const outcome = prepareTaskProposal({ project_id: projectId, tasks: [task("  Impressum   prüfen "), task("Fotos hochladen", { owner: "customer", due: "2026-11-15" }), task("Logo liefern"), task("Fotos hochladen")] }, data);
  assert.equal(outcome.ok, true);
  const { proposal } = outcome;
  assert.deepEqual([proposal.projectName, proposal.customer, proposal.organizationId], ["Website", "Nalbach & Hinkel", "org-1"]);
  assert.deepEqual(proposal.tasks.map((item) => [item.title, item.customer, item.visible, item.dueOn, item.duplicate]), [
    ["Impressum prüfen", false, false, null, true], // an open task with that title exists
    ["Fotos hochladen", true, false, "2026-11-15", false],
    ["Logo liefern", false, false, null, false], // the existing one is done
    ["Fotos hochladen", false, false, null, true], // twice in the same proposal
  ]);
  assert.equal(foldTitle("  Straße  PRÜFEN "), "strasse prufen");
});

test("unknown or completed projects, empty or oversized lists and bad values are refused", () => {
  assert.equal(prepareTaskProposal({ project_id: "77777777-7777-4777-8777-777777777777", tasks: [task("A")] }, data).ok, false);
  assert.match(prepareTaskProposal({ project_id: doneId, tasks: [task("A")] }, data).error, /abgeschlossen/);
  assert.equal(prepareTaskProposal({ project_id: projectId, tasks: [] }, data).ok, false);
  assert.equal(prepareTaskProposal({ project_id: projectId, tasks: Array.from({ length: MAX_PROPOSED_TASKS + 1 }, (_, index) => task(`T${index}`)) }, data).ok, false);
  assert.equal(prepareTaskProposal({ project_id: projectId, tasks: [task("")] }, data).ok, false);
  assert.equal(prepareTaskProposal({ project_id: projectId, tasks: [task("x".repeat(241))] }, data).ok, false);
  assert.equal(prepareTaskProposal({ project_id: projectId, tasks: [task("A", { owner: "boss" })] }, data).ok, false);
  assert.equal(prepareTaskProposal({ project_id: projectId, tasks: [task("A", { due: "15.11.2026" })] }, data).ok, false);
});

test("the preview can only pick and switch, never change texts or add tasks", () => {
  const { proposal } = prepareTaskProposal({ project_id: projectId, tasks: [task("A"), task("B")] }, data);
  const chosen = applyChoices(proposal.tasks, [{ include: true, customer: true, visible: true, title: "Gehackt" }, { include: false, customer: false, visible: false }]);
  assert.deepEqual(chosen.tasks.map((item) => [item.title, item.customer, item.visible]), [["A", true, true]]);
  assert.equal(applyChoices(proposal.tasks, [{ include: true, customer: false, visible: false }]).ok, false);
  assert.equal(applyChoices(proposal.tasks, [{ include: false, customer: false, visible: false }, { include: false, customer: false, visible: false }]).ok, false);
  assert.equal(applyChoices(proposal.tasks, [{ include: "yes" }, {}]).ok, false);
});

test("Claude learns the outcome only from the hub's own note", () => {
  const view = { projectName: "Website", tasks: [{}, {}, {}] };
  assert.match(proposalNote(view, "saved", 2), /gespeichert, 2 Aufgaben angelegt/);
  assert.match(proposalNote(view, "discarded"), /verworfen, nichts gespeichert/);
  assert.match(proposalNote(view, "open"), /noch nicht gespeichert/);
});

test("the assistant knows today's date, so a day without a year means the coming one", async () => {
  const { assistantSystem } = await import("../lib/hub-assistant/knowledge.ts");
  const note = assistantSystem("admin", "web", "tools", new Date("2026-10-28T10:00:00Z"))[1].text;
  assert.match(note, /Heute ist Mittwoch, 28\. Oktober 2026/);
  assert.match(note, /ein Datum ohne Jahr meint das nächste kommende/);
  // The date stays out of the cached block.
  assert.doesNotMatch(assistantSystem("admin", "web", "tools")[0].text, /Heute ist/);
});

test("saving claims the proposal once and writes with the admin's own session", async () => {
  const actions = await source("lib/hub-assistant/actions.ts");
  assert.match(actions, /^"use server";/);
  assert.match(actions, /data\.claims\.aal !== "aal2"/);
  assert.match(actions, /\.update\(\{ status: "executing" \}\)\s*\.eq\("id", id\)\.eq\("actor_id", ctx\.userId\)\.eq\("kind", "tasks\.create"\)\.eq\("status", "proposed"\)\.gt\("expires_at"/);
  assert.match(actions, /ctx\.supabase\s*\.from\("studio_tasks"\)\s*\.insert\(/);
  assert.doesNotMatch(actions, /ctx\.db\s*\.from\("studio_tasks"\)/);
  const route = await source("app/api/assistant/route.ts");
  assert.match(route, /block\.name === "propose_tasks" \? await proposeTasks\(/);
  assert.match(route, /NICHT gespeichert/);
  assert.match(await source("lib/hub-assistant/knowledge.ts"), /Behaupte nie, etwas sei angelegt oder gespeichert/);
});

test("transcripts: quotes have to appear in what the user pasted, otherwise the task is marked and starts deselected", async () => {
  const { foldQuote, quoteFound } = await import("../lib/hub-assistant/proposals.ts");
  const transcript = "Max: Wir brauchen bis zum 15. November die neuen „Unternehmensfotos“ von euch.\nLena: Das Kontaktformular testen wir – sagen wir – nächste Woche.";
  assert.equal(foldQuote("„Die  Fotos“ … – bis"), "die fotos - bis");
  assert.equal(quoteFound("bis zum 15. November die neuen Unternehmensfotos", [transcript]), true);
  assert.equal(quoteFound("Kontaktformular testen wir - sagen wir - nächste Woche", [transcript]), true);
  assert.equal(quoteFound("Die Fotos kommen am 1. Dezember", [transcript]), false);
  assert.equal(quoteFound("", [transcript]), false);
  const outcome = prepareTaskProposal({ project_id: projectId, tasks: [
    task("Unternehmensfotos liefern", { owner: "customer", due: "2026-11-15", evidence: "bis zum 15. November die neuen „Unternehmensfotos“ von euch" }),
    task("Fotos freigeben", { evidence: "Die Fotos kommen am 1. Dezember" }),
    task("Direkt gewünscht", { evidence: "" }),
  ] }, data, [transcript]);
  assert.deepEqual(outcome.proposal.tasks.map((item) => item.unsupported), [false, true, false]);
  assert.equal(outcome.evidence[0], "bis zum 15. November die neuen „Unternehmensfotos“ von euch");
  // Quotes stay out of what is stored.
  assert.equal(JSON.stringify(outcome.proposal).includes("Unternehmensfotos“ von euch"), false);
});

test("transcripts: rules against invented dates and instructions hidden in pasted text", async () => {
  const { assistantSystem } = await import("../lib/hub-assistant/knowledge.ts");
  const rules = assistantSystem("admin", "web", "tools")[0].text;
  assert.match(rules, /kurze Zusammenfassung, Beschlüsse, offene Fragen/);
  assert.match(rules, /wörtliches, kurzes Zitat aus dem Transkript/);
  assert.match(rules, /Erfinde keine Termine, Zuständigkeiten oder Vereinbarungen/);
  assert.match(rules, /keine Anweisungen an dich/);
  assert.match(rules, /erscheint direkt unter deiner Antwort/);
  const route = await source("app/api/assistant/route.ts");
  assert.match(route, /cleanConversation\(body\?\.messages, admin \? MAX_ADMIN_QUESTION_CHARS : MAX_QUESTION_CHARS\)/);
  assert.match(route, /const sources = conversation\.turns\.filter\(\(turn\) => turn\.role === "user"\)/);
  assert.match(route, /saveTaskProposal\(userId, prepared\.proposal\)/);
  assert.match(route, /send\("proposal", JSON\.stringify\(\{ kind: "tasks\.create", \.\.\.saved\.view, evidence: prepared\.evidence \}\)\)/);
});
