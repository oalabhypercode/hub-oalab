import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { countRequests, customerSteps, projectSites, readProjectUrl, restatesSite, shortUrl, toHubProject, toProjectTask } from "../lib/hub-projects/map.ts";
import { deadlineHint, formatDeadline } from "../lib/hub-data.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const row = { id: "p1", organization_id: "o1", display_name: "Website-Relaunch", status: "active" };
const details = { project_id: "p1", description: "Neue Website", status: "active", start_date: "2026-09-01", due_date: "2026-11-15", milestones: [{ name: "Design", date: "2026-10-20" }, { name: "Kickoff", date: "2026-09-02" }, { name: 3 }] };
let number = 100;
const task = (status, extra = {}) => toProjectTask({ id: `t${number}`, task_number: number++, project_id: "p1", title: `Aufgabe ${number}`, status, due_date: null, labels: [], client_visible: false, ...extra });
const project = (tasks, overrides = {}) => toHubProject({ project: row, details, tasks, requests: { open: 0, done: 0 }, company: "ABC GmbH", ...overrides });

test("progress is the share of done tasks, like Studio", () => {
  assert.equal(project([task("done"), task("todo"), task("progress")]).progress, 33);
  assert.equal(project([task("done"), task("done")]).progress, 100);
  // Without tasks Studio falls back to the finished requests.
  assert.equal(project([], { requests: { open: 1, done: 3 } }).progress, 75);
  assert.equal(project([]).progress, 0);
  // The basis travels along, so the assistant can explain the number.
  assert.equal(project([task("done")]).progressBasis, "tasks");
  assert.equal(project([], { requests: { open: 1, done: 3 } }).progressBasis, "requests");
  assert.equal(project([]).progressBasis, "none");
});

test("status: complete in Studio, waiting for a released customer task, otherwise running", () => {
  assert.equal(project([task("todo", { labels: ["Kunde"], client_visible: true })]).status, "Dein Feedback");
  // An internal customer task or a done one does not ask the customer for anything yet.
  assert.equal(project([task("todo", { labels: ["kunde"] })]).status, "In Umsetzung");
  assert.equal(project([task("done", { labels: ["Kunde"], client_visible: true })]).status, "In Umsetzung");
  assert.equal(project([task("todo", { labels: ["Kunde"], client_visible: true })], { details: { ...details, status: "complete" } }).status, "Abgeschlossen");
});

test("Studio fields map onto the hub project; missing details stay empty instead of invented", () => {
  const mapped = project([]);
  assert.equal(mapped.name, "Website-Relaunch");
  assert.equal(mapped.company, "ABC GmbH");
  assert.equal(mapped.category, "");
  assert.equal(mapped.dueOn, "2026-11-15");
  assert.equal(mapped.date, "15. November 2026");
  assert.deepEqual(mapped.milestones.map((item) => item.title), ["Kickoff", "Design"]);
  const bare = project([], { details: null });
  assert.equal(bare.startedOn, null);
  assert.equal(bare.dueOn, null);
  assert.equal(bare.date, "Kein Zieltermin");
  assert.equal(bare.status, "In Umsetzung");
  assert.equal(formatDeadline(null), "–");
  assert.equal(deadlineHint(null, false, "2026-10-27"), "kein Zieltermin");
});

test("requests count like Studio: released and resolved are done, drafts and closed ones are not open", () => {
  assert.deepEqual(countRequests([{ state: "released" }, { state: "resolved" }, { state: "draft" }, { state: "triage" }, { state: "cancelled" }]), { open: 1, done: 2 });
});

test("customer steps list only open, released customer tasks, earliest due first", () => {
  const due = (day) => task("todo", { labels: ["Kunde"], client_visible: true, due_date: day });
  const steps = customerSteps([project([due("2026-11-02"), due("2026-10-30"), task("todo", { labels: ["Kunde"] }), task("todo", { client_visible: true }), task("done", { labels: ["Kunde"], client_visible: true })])]);
  assert.deepEqual(steps.map((step) => step.task.dueOn), ["2026-10-30", "2026-11-02"]);
});

test("customers read Studio rows with their own session; names come only for projects they may see", async () => {
  const loader = await source("lib/hub-projects/server.ts");
  assert.match(loader, /import "server-only"/);
  assert.match(loader, /const admin = Boolean\(await verifyHubAdmin\(\)\)/);
  assert.match(loader, /: await viewer\.from\("studio_project_details"\)\.select\("project_id"\)/);
  assert.match(loader, /const reader = admin \? db : viewer;/);
  assert.match(loader, /reader\.from\("studio_tasks"\)/);
  assert.match(loader, /export const loadLiveProjects = cache\(/);
});

test("project addresses: https only, typed the short way, the live one first and the customer's website as fallback", () => {
  assert.deepEqual(readProjectUrl(" kunde.de "), { ok: true, value: "https://kunde.de" });
  assert.deepEqual(readProjectUrl("https://www.kunde.de/shop/"), { ok: true, value: "https://www.kunde.de/shop/" });
  assert.deepEqual(readProjectUrl(""), { ok: true, value: null });
  assert.equal(readProjectUrl("http://kunde.de").ok, false);
  assert.equal(readProjectUrl("kunde").ok, false);
  assert.equal(readProjectUrl("kunde .de").ok, false);
  assert.equal(shortUrl("https://www.kunde.de/"), "kunde.de");
  assert.equal(shortUrl("https://kunde.de/shop/"), "kunde.de/shop");
  const keys = (project) => projectSites(project).map((site) => site.key);
  assert.deepEqual(keys({ liveUrl: "https://kunde.de", website: "https://alt.de", testUrl: "https://kunde-git-test.vercel.app" }), ["live", "test"]);
  assert.deepEqual(keys({ website: "https://kunde.de" }), ["website"]);
  assert.deepEqual(keys({}), []);
  const project = toHubProject({ project: { id: "p", organization_id: "o", display_name: "Website", status: "active", live_url: "http://unsicher.de", test_url: "https://kunde-git-test.vercel.app" }, details: null, tasks: [], requests: { open: 0, done: 0 }, company: "Kunde" });
  assert.equal(project.liveUrl, undefined, "only https counts as an address");
  assert.equal(project.testUrl, "https://kunde-git-test.vercel.app");
});

test("a description that only names the website stays out; a real one stays", () => {
  assert.equal(restatesSite("Website podologie-sassnitz.de", ["https://podologie-sassnitz.de"]), true);
  assert.equal(restatesSite("https://www.kunde.de/", ["https://kunde.de"]), true);
  assert.equal(restatesSite("Der Testshop von KalaClo.", ["https://kalaclo.com"]), false);
  assert.equal(restatesSite("Website kunde.de", []), false);
  assert.equal(restatesSite(undefined, ["https://kunde.de"]), false);
});

test("admins open projects in the panel on „Projekte“; the window stays for customers and other pages", async () => {
  const view = await source("components/hub/hub-view.tsx");
  assert.match(view, /const panelShowsProject = admin && !preview && section === "projects" && !detail;/);
  assert.match(view, /\{selectedProject && !panelShowsProject && <ProjectModal /);
  assert.match(view, /<ProjectSites sites=\{sites\} \/>/);
  const actions = await source("lib/hub-projects/actions.ts");
  assert.match(actions, /^"use server";/);
  assert.match(actions, /verifyHubAdmin\(\)/);
  assert.match(actions, /readProjectUrl\(/);
});
