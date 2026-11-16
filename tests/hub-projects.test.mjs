import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { countRequests, customerSteps, projectSites, readProjectUrl, restatesSite, shortUrl, toHubProject, toProjectTask } from "../lib/hub-projects/map.ts";
import { deadlineHint, formatDeadline } from "../lib/hub-data.ts";
import { byUrgency, customerSees, customerState, isStudioStatus, mainLinks, nextMilestone, statusOf, studioStatusOrder, studioStatuses, veilCounts, veilOf, withStatus } from "../lib/hub-projects/desk.ts";

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
  assert.match(view, /const panelShowsProject = admin && !preview && section === "projects" && !detail && Boolean\(projectDesk && !projectDesk\.error\);/);
  assert.match(view, /\{selectedProject && !panelShowsProject && <ProjectModal /);
  assert.match(view, /<ProjectSites sites=\{sites\} \/>/);
  const actions = await source("lib/hub-projects/actions.ts");
  assert.match(actions, /^"use server";/);
  assert.match(actions, /verifyHubAdmin\(\)/);
  assert.match(actions, /readProjectUrl\(/);
});

test("Projekte V2: Studio's five statuses, what the customer sees and the row veil", () => {
  assert.deepEqual(studioStatusOrder, ["planning", "active", "risk", "hold", "complete"]);
  assert.deepEqual(studioStatusOrder.map((status) => studioStatuses[status].label), ["Planung", "In Arbeit", "Gefährdet", "Pausiert", "Fertig"]);
  assert.ok(isStudioStatus("risk"));
  assert.ok(!isStudioStatus("paused"));
  assert.ok(!isStudioStatus(undefined));
  // The customer keeps the hub's three words: only "complete" finishes, a released customer task asks for feedback.
  assert.equal(customerSees("complete", true), "Abgeschlossen");
  assert.equal(customerSees("risk", true), "Dein Feedback");
  assert.equal(customerSees("hold", false), "In Umsetzung");
  // Every open status colours its row, finished projects stay plain; the legend counts the most urgent first.
  assert.equal(veilOf("complete"), null);
  assert.equal(veilOf("risk"), "risk");
  assert.deepEqual(veilCounts(["active", "risk", "active", "complete", "planning"]).map((key) => `${key.count} ${key.label}`), ["1 gefährdet", "2 in Arbeit", "1 in Planung"]);
  assert.deepEqual(veilCounts(["complete"]), []);
});

test("Projekte V2: the customer's state in the list, the links in its head and the order of its projects", () => {
  const project = (status, extra = {}) => ({ id: status, name: status, status: status === "complete" ? "Abgeschlossen" : "In Umsetzung", studio: { status, version: 1 }, dueOn: null, milestones: [], ...extra });
  assert.deepEqual(customerState([]), { running: false, tone: "off", pill: null, sub: "Noch kein Projekt" });
  assert.equal(customerState([project("risk"), project("active")]).pill, "risk");
  assert.equal(customerState([project("active"), project("planning")]).sub, "2 Projekte laufen");
  assert.equal(customerState([project("active", { tasks: [{ status: "todo", customer: true, visible: true }] })]).pill, "feedback");
  // An internal customer task does not ask the customer for anything yet.
  assert.equal(customerState([project("active", { tasks: [{ status: "todo", customer: true, visible: false }] })]).pill, null);
  assert.equal(customerState([project("hold")]).running, false);
  assert.equal(customerState([project("hold")]).sub, "Projekt pausiert");
  assert.equal(customerState([project("complete")]).sub, "Kein laufendes Projekt");
  // Without Studio details a finished project counts as complete, every other one as active.
  assert.equal(statusOf({ status: "Abgeschlossen" }), "complete");
  assert.equal(statusOf({ status: "Dein Feedback" }), "active");
  // The head shows the running project's live domain and its test domain.
  assert.deepEqual(mainLinks([project("complete", { liveUrl: "https://alt.de" }), project("active", { liveUrl: "https://neu.de", testUrl: "https://test.neu.de" })]), { live: "https://neu.de", test: "https://test.neu.de" });
  assert.deepEqual(mainLinks([project("active", { testUrl: "https://t.de" })]), { live: null, test: "https://t.de" });
  assert.deepEqual(mainLinks([]), { live: null, test: null });
  // At risk first, then by target day, then by name.
  assert.deepEqual(byUrgency([project("planning", { name: "b", dueOn: "2026-12-01" }), project("active", { name: "a", dueOn: "2026-12-05" }), project("risk", { name: "c" })]).map((item) => item.name), ["c", "a", "b"]);
  assert.equal(nextMilestone({ milestones: [{ title: "A", at: "2026-11-01" }, { title: "B", at: "2026-11-20" }] }, "2026-11-16")?.title, "B");
  assert.equal(nextMilestone({ milestones: [{ title: "A", at: "2026-11-01" }] }, "2026-11-16"), null);
});

test("Projekte V2: a status set on the page shows until the page's data carries that version", () => {
  const project = { id: "p", name: "X", status: "In Umsetzung", studio: { status: "active", version: 3, visible: true }, tasks: [] };
  const set = withStatus(project, { status: "complete", version: 4 });
  assert.equal(set.studio.status, "complete");
  assert.equal(set.studio.version, 4);
  assert.equal(set.status, "Abgeschlossen");
  assert.equal(set.studio.visible, true);
  // A newer version from Studio wins over what the page set.
  assert.equal(withStatus({ ...project, studio: { status: "hold", version: 5 } }, { status: "complete", version: 4 }).studio.status, "hold");
  assert.equal(withStatus(project, undefined), project);
});

test("Projekte V2: the status is written with the admin's own session, only with 2FA and the version the page showed", async () => {
  const actions = await source("lib/hub-projects/actions.ts");
  const write = actions.slice(actions.indexOf("export async function setProjectStatus"));
  assert.match(write, /claims\.claims\.aal !== "aal2"\) return denied/);
  assert.match(write, /await verifyHubAdmin\(\)/);
  assert.match(write, /isStudioStatus\(input\.status\)/);
  assert.match(write, /supabase\.from\("studio_project_details"\)\.update\(\{ status \}\)\.eq\("project_id", projectId\)\.eq\("version", expected\)/);
  assert.match(write, /supabase\.from\("studio_project_details"\)\.insert\(/);
  assert.doesNotMatch(write, /db\.from\("studio_project_details"\)/, "never with the service role: Studio's RLS and triggers check and log the change");
  assert.match(write, /action: "project\.status_set"/);
  assert.match(write, /refreshWorkspace\(\)/);
});

test("Projekte V2: every customer on the left, loaded only on the page and only for admins", async () => {
  const server = await source("lib/hub-projects/server.ts");
  const desk = server.slice(server.indexOf("export const loadProjectDesk"));
  assert.match(desk, /if \(!await verifyHubAdmin\(\)\) return undefined;/);
  assert.match(desk, /\(row\.kind \?\? "customer"\) === "customer"/, "freelancers stay out");
  assert.match(desk, /loadServiceQuotaForAdmin\(db\)/);
  assert.match(desk, /readCustomerPackages\(db\)/);
  assert.match(desk, /\.not\("state", "in", `\(\$\{closedRequestStates\.join\(","\)\}\)`\)/);
  // The layout and the other pages keep loading only the projects.
  assert.doesNotMatch(server.slice(0, server.indexOf("export const loadProjectDesk")), /hub_customer_domains/);
  const page = await source("app/dashboard/[section]/page.tsx");
  assert.match(page, /validSection === "projects" \? loadProjectDesk\(\) : undefined/);
  const screen = await source("components/hub/screens/projects.tsx");
  assert.match(screen, /admin && !preview && !liveProjects\?\.error && desk && !desk\.error/);
  // Customers keep their table; the status field is the hub's own list, never the browser's.
  assert.match(screen, /<ProjectTable projects=\{projects\}/);
  const parts = await source("components/hub/screens/projects-parts.tsx");
  assert.match(parts, /<Select\s+variant="bare"/);
});

