import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  changeNote, pickChanges, prepareProjectUpdate, prepareTaskUpdates, projectChangeLine, projectColumns,
  PROPOSE_PROJECT_UPDATE_TOOL, PROPOSE_TASK_UPDATES_TOOL, taskChangeLines, taskColumns,
} from "../lib/hub-assistant/updates.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const webId = "55555555-5555-4555-8555-555555555555";
const otherId = "66666666-6666-4666-8666-666666666666";
const task = (number, extra = {}) => ({ id: `t${number}`, number, title: `Aufgabe ${number}`, status: "todo", dueOn: null, customer: false, visible: false, version: 3, ...extra });
const data = {
  customers: [],
  projects: [
    { id: webId, name: "Website", category: "", description: "Relaunch der Website.", status: "In Umsetzung", progress: 0, date: "", artwork: "orange", company: "ABC", organizationId: "org-1",
      startedOn: "2026-09-01", dueOn: "2026-11-15", milestones: [], studio: { status: "active", version: 7 }, tasks: [task(12), task(13, { customer: true, visible: true, dueOn: "2026-11-01" })] },
    { id: otherId, name: "Logo", category: "", description: "", status: "In Umsetzung", progress: 0, date: "", artwork: "orange", company: "XYZ", organizationId: "org-2",
      startedOn: null, dueOn: null, milestones: [], studio: { status: "active", version: null }, tasks: [task(20)] },
  ],
};
const project = (extra = {}) => ({ project_id: webId, due_action: "keep", due: null, start_action: "keep", start: null, status: "keep", note: "", ...extra });
const change = (number, extra = {}) => ({ task_number: number, title: "", status: "keep", due_action: "keep", due: null, owner: "keep", visibility: "keep", ...extra });

test("both change tools are strict and ask for keep instead of guessing", () => {
  for (const tool of [PROPOSE_PROJECT_UPDATE_TOOL, PROPOSE_TASK_UPDATES_TOOL]) {
    assert.equal(tool.strict, true, tool.name);
    assert.match(tool.description, /nichts gespeichert/);
    assert.match(tool.description, /keep/);
  }
  const item = PROPOSE_TASK_UPDATES_TOOL.input_schema.properties.tasks.items;
  assert.deepEqual([...item.required].sort(), Object.keys(item.properties).sort());
});

test("a project change keeps only what really changes and remembers the version it was read at", () => {
  const outcome = prepareProjectUpdate(project({ due_action: "set", due: "2026-11-30", status: "hold", start_action: "set", start: "2026-09-01", note: "Wir warten auf Kundenfeedback." }), data, new Date("2026-10-29T10:00:00Z"));
  assert.equal(outcome.ok, true);
  assert.equal(outcome.proposal.expectedVersion, 7);
  assert.deepEqual(outcome.proposal.changes.map((item) => item.field), ["dueOn", "status", "description"]); // same start is no change
  assert.equal(outcome.proposal.changes.at(-1).after, "Relaunch der Website.\n\n29.10.2026: Wir warten auf Kundenfeedback.");
  assert.deepEqual(projectChangeLine(outcome.proposal.changes[0]), { label: "Zieltermin", before: "15. Nov. 2026", after: "30. Nov. 2026" });
  assert.deepEqual(projectChangeLine(outcome.proposal.changes[1]), { label: "Status", before: "Aktiv", after: "Pausiert" });
  assert.deepEqual(projectColumns(outcome.proposal.changes), { due_date: "2026-11-30", status: "hold", description: "Relaunch der Website.\n\n29.10.2026: Wir warten auf Kundenfeedback." });
  // A project without Studio details: version null, the confirm step creates the row.
  assert.equal(prepareProjectUpdate({ ...project({ status: "planning" }), project_id: otherId }, data).proposal.expectedVersion, null);
});

test("project changes that do nothing, clash or name unknown projects are refused", () => {
  assert.match(prepareProjectUpdate(project(), data).error, /ändert nichts/);
  assert.match(prepareProjectUpdate(project({ due_action: "set", due: "2026-11-15" }), data).error, /ändert nichts/);
  assert.match(prepareProjectUpdate(project({ start_action: "set", start: "2026-12-01" }), data).error, /Start liegt/);
  assert.equal(prepareProjectUpdate(project({ due_action: "set", due: "30.11." }), data).ok, false);
  assert.equal(prepareProjectUpdate(project({ status: "done" }), data).ok, false);
  assert.equal(prepareProjectUpdate({ ...project(), project_id: "77777777-7777-4777-8777-777777777777" }, data).ok, false);
});

test("task changes find tasks by number, keep one project and show old → new", () => {
  const outcome = prepareTaskUpdates({ tasks: [change(12, { status: "done", owner: "customer", visibility: "customer" }), change(13, { due_action: "clear" })] }, data);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.proposal.projectName, "Website");
  assert.deepEqual(outcome.proposal.tasks.map((item) => [item.number, item.expectedVersion, item.after]), [
    [12, 3, { status: "done", customer: true, visible: true }],
    [13, 3, { dueOn: null }],
  ]);
  assert.deepEqual(taskChangeLines(outcome.proposal.tasks[0]).map((line) => `${line.label}: ${line.before} → ${line.after}`), ["Stand: Offen → Erledigt", "Dran ist: OALAB → Kunde", "Freigabe: intern → für Kunde sichtbar"]);
  assert.match(prepareTaskUpdates({ tasks: [change(12, { status: "done" }), change(20, { status: "done" })] }, data).error, /selben Projekt/);
  assert.match(prepareTaskUpdates({ tasks: [change(99, { status: "done" })] }, data).error, /#99/);
  assert.match(prepareTaskUpdates({ tasks: [change(12)] }, data).error, /ändert nichts/);
  assert.match(prepareTaskUpdates({ tasks: [change(12, { status: "done" }), change(12, { title: "Neu" })] }, data).error, /doppelt/);
});

test("switching the owner keeps the task's other labels; only ticked changes are written", () => {
  const [first] = prepareTaskUpdates({ tasks: [change(12, { owner: "customer", title: "Startseite prüfen" })] }, data).proposal.tasks;
  assert.deepEqual(taskColumns(first, ["design", "kunde"], "Kunde"), { title: "Startseite prüfen", labels: ["design", "Kunde"] });
  const [second] = prepareTaskUpdates({ tasks: [change(13, { owner: "oalab" })] }, data).proposal.tasks;
  assert.deepEqual(taskColumns(second, ["Kunde", "content"], "Kunde"), { labels: ["content"] });
  assert.deepEqual(pickChanges(["a", "b", "c"], [true, false, true]), { ok: true, items: ["a", "c"] });
  assert.equal(pickChanges(["a", "b"], [true]).ok, false);
  assert.equal(pickChanges(["a"], [false]).ok, false);
});

test("Claude learns the outcome of a change only from the hub's note", () => {
  const view = { kind: "tasks.update", id: "x", expiresAt: "", projectName: "Website", tasks: [{ number: 12 }, { number: 13 }] };
  assert.match(changeNote(view, "saved", "Gespeichert: #12."), /#12, #13 in „Website“\) wurde vom Nutzer gespeichert\. Gespeichert: #12\./);
  assert.match(changeNote(view, "discarded"), /verworfen, nichts gespeichert/);
});

test("saving writes with the admin's own session and only while the Studio version still matches", async () => {
  const actions = await source("lib/hub-assistant/actions.ts");
  assert.match(actions, /\.update\(columns\)\.eq\("project_id", proposal\.projectId\)\.eq\("version", proposal\.expectedVersion\)/);
  assert.match(actions, /ctx\.supabase\.from\("studio_tasks"\)\.update\(taskColumns\(change, current\.data\.labels \?\? \[\], CUSTOMER_LABEL\)\)\.eq\("id", change\.taskId\)\.eq\("version", change\.expectedVersion\)/);
  assert.doesNotMatch(actions, /ctx\.db\.from\("studio_(tasks|project_details)"\)/);
  assert.match(actions, /error_code: "STALE_VERSION"/);
  const route = await source("app/api/assistant/route.ts");
  assert.match(route, /block\.name === "propose_project_update" \|\| block\.name === "propose_task_updates" \? await proposeChange\(/);
  assert.match(await source("lib/hub-assistant/knowledge.ts"), /propose_project_update/);
});
