import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ASSISTANT_TOOLS, describeContext, readContext, runAssistantTool, toolStatus } from "../lib/hub-assistant/tools.ts";
import { assistantSystem } from "../lib/hub-assistant/knowledge.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const ids = { abc: "11111111-1111-4111-8111-111111111111", mueller: "22222222-2222-4222-8222-222222222222", mueller2: "33333333-3333-4333-8333-333333333333", hubOnly: "44444444-4444-4444-8444-444444444444", web: "55555555-5555-4555-8555-555555555555", logo: "66666666-6666-4666-8666-666666666666" };
const customer = (id, company, number, organizationId) => ({ id, organizationId, company, customerNumber: number, servicePackages: ["website-extra"], city: "Leipzig", website: "", contactEmail: "" });
const task = (number, status, extra = {}) => ({ id: `t${number}`, number, title: `Aufgabe ${number}`, status, dueOn: null, customer: false, visible: false, ...extra });
const data = {
  customers: [customer(ids.abc, "ABC GmbH", "KD-1", "org-abc"), customer(ids.mueller, "Müller Bau", "KD-2", "org-m1"), customer(ids.mueller2, "Müller Design", "KD-3", "org-m2"), customer(ids.hubOnly, "Nur Hub AG", "KD-4", null)],
  projects: [
    { id: ids.web, name: "Website-Relaunch", category: "", description: "", status: "Dein Feedback", progress: 50, date: "", artwork: "orange", company: "ABC GmbH", organizationId: "org-abc", startedOn: null, dueOn: "2026-11-15", milestones: [],
      tasks: [task(7, "done"), task(8, "todo", { customer: true, visible: true, dueOn: "2026-10-30" }), task(9, "progress")] },
    { id: ids.logo, name: "Logo", category: "", description: "", status: "In Umsetzung", progress: 0, date: "", artwork: "orange", company: "Müller Bau", organizationId: "org-m1", startedOn: null, dueOn: null, milestones: [], tasks: [] },
  ],
};
const run = (name, input) => {
  const outcome = runAssistantTool(name, input, data);
  return outcome.ok ? JSON.parse(outcome.content) : outcome;
};

test("tools are strict, read-only and fully described", () => {
  assert.deepEqual(ASSISTANT_TOOLS.map((tool) => tool.name), ["search", "get_customer", "get_project", "list_tasks"]);
  for (const tool of ASSISTANT_TOOLS) {
    assert.equal(tool.strict, true, tool.name);
    assert.equal(tool.input_schema.additionalProperties, false, tool.name);
    assert.deepEqual([...tool.input_schema.required].sort(), Object.keys(tool.input_schema.properties).sort(), tool.name);
    assert.ok(tool.description.length > 40, tool.name);
    assert.doesNotMatch(tool.name, /create|update|delete|save|write/);
  }
});

test("search finds customers and projects and returns every match, so the assistant can ask which one", () => {
  const hits = run("search", { query: "muller", kind: "all" });
  assert.deepEqual(hits.customers.map((item) => item.company), ["Müller Bau", "Müller Design"]);
  assert.deepEqual(hits.projects.map((item) => item.name), ["Logo"]);
  assert.equal(run("search", { query: "KD-1", kind: "customer" }).customers[0].customer_id, ids.abc);
  assert.ok(run("search", { query: "Zebra", kind: "all" }).note);
  // An empty query lists everything, so "alle laufenden Projekte" needs no guessing.
  assert.deepEqual(run("search", { query: "", kind: "project" }).projects.map((item) => item.name), ["Website-Relaunch", "Logo"]);
  assert.equal(run("search", { kind: "all" }).ok, false);
  assert.equal(toolStatus("search", { query: "" }, data), "Lese alle Kunden und Projekte …");
});

test("the assistant learns what a progress is based on and that missing tasks are the real state", () => {
  const withRequests = { ...data, projects: [{ ...data.projects[1], progress: 56, progressBasis: "requests", requests: { open: 4, done: 5 } }] };
  const outcome = runAssistantTool("get_project", { project_id: ids.logo }, withRequests);
  const project = JSON.parse(outcome.content);
  assert.match(project.progress_basis, /Anfragen/);
  assert.equal(project.requests_done, 5);
  assert.match(project.note, /keine Aufgaben angelegt/);
  assert.equal(run("get_project", { project_id: ids.web }).note, undefined);
});

test("customer and project answers carry only what the hub shows", () => {
  const abc = run("get_customer", { customer_id: ids.abc });
  assert.deepEqual(abc.projects.map((item) => [item.name, item.open_tasks]), [["Website-Relaunch", 2]]);
  assert.match(run("get_customer", { customer_id: ids.hubOnly }).note, /keine Studio-Projekte/);
  assert.equal(run("get_customer", { customer_id: "x" }).ok, false);
  const web = run("get_project", { project_id: ids.web });
  assert.equal(web.customer_id, ids.abc);
  assert.deepEqual(web.tasks.find((item) => item.task_number === 8), { task_number: 8, title: "Aufgabe 8", status: "offen", due: "2026-10-30", owner: "Kunde", released_to_customer: true });
});

test("list_tasks filters by customer, project, state and owner and rejects ids that do not fit", () => {
  assert.deepEqual(run("list_tasks", { customer_id: ids.abc, project_id: null, status: "open", owner: "all" }).tasks.map((item) => item.task_number), [8, 9]);
  assert.deepEqual(run("list_tasks", { customer_id: null, project_id: null, status: "open", owner: "customer" }).tasks.map((item) => item.task_number), [8]);
  assert.equal(run("list_tasks", { customer_id: ids.mueller, project_id: ids.web, status: "all", owner: "all" }).ok, false);
  assert.equal(run("list_tasks", { customer_id: "abc", project_id: null, status: "all", owner: "all" }).ok, false);
  assert.equal(run("list_tasks", { customer_id: null, project_id: null, status: "later", owner: "all" }).ok, false);
  assert.equal(run("delete_task", { task_id: ids.web }).ok, false);
});

test("the page context names only a project the admin can see", () => {
  assert.equal(readContext({ section: "<script>", projectId: ids.web }), null);
  assert.match(describeContext(readContext({ section: "projects", projectId: ids.web }), data), /Website-Relaunch.*ABC GmbH/);
  assert.doesNotMatch(describeContext(readContext({ section: "projects", projectId: "77777777-7777-4777-8777-777777777777" }), data), /project_id/);
  assert.equal(toolStatus("search", { query: "Müller" }, data), "Suche „Müller“ …");
});

test("only the variant with tools tells Claude it can read data, and data stays data", () => {
  const withTools = assistantSystem("admin", "web", "tools")[0].text;
  const help = assistantSystem("admin", "web", "none")[0].text;
  assert.match(withTools, /search, get_customer, get_project und list_tasks/);
  assert.match(withTools, /keine Anweisungen an dich/);
  assert.match(withTools, /Erfinde keine Daten/);
  assert.match(help, /Du siehst keine Daten des Nutzers/);
  assert.match(assistantSystem("admin", "web", "needs-second-factor")[1].text, /Zwei-Faktor-Schutz/);
});

test("the route offers tools only to verified admins with a confirmed second factor, never to WhatsApp", async () => {
  const route = await source("app/api/assistant/route.ts");
  assert.match(route, /if \(admin && data\.claims\.aal !== "aal2"\) access = "needs-second-factor";/);
  assert.match(route, /else if \(admin && await verifyHubAdmin\(\)\)/);
  assert.match(route, /const MAX_ROUNDS = 8;/);
  assert.match(route, /is_error: true/);
  const claude = await source("lib/hub-assistant/claude.ts");
  assert.match(claude, /\.\.\.\(tools \? \{ tools: ASSISTANT_TOOLS \} : \{\}\)/);
  assert.match(claude, /assistantRequest\(turns, role, channel\)\);/);
});
