import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { countRequests, customerSteps, projectSites, restatesSite, shortUrl, toHubProject, toProjectTask } from "../lib/hub-projects/map.ts";
import { blankDraft, changedWords, changesOf, draftOf, isDay, mergeDraft, projectKeyFrom, readProjectDraft, readProjectPatch, readProjectUrl, sameDraft } from "../lib/hub-projects/edit.ts";
import { deadlineHint, formatDeadline } from "../lib/hub-data.ts";
import { byUrgency, customerSees, customerState, isStudioStatus, mainLinks, nextMilestone, statusOf, studioStatusOrder, studioStatuses, veilCounts, veilOf, withStudio } from "../lib/hub-projects/desk.ts";

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

test("Projekte V2: what the page saved shows until the page's data carries that version", () => {
  const project = { id: "p", name: "X", status: "In Umsetzung", studio: { status: "active", version: 3, visible: true }, tasks: [] };
  const set = withStudio(project, { status: "complete", version: 4 });
  assert.equal(set.studio.status, "complete");
  assert.equal(set.studio.version, 4);
  assert.equal(set.status, "Abgeschlossen");
  assert.equal(set.studio.visible, true);
  // Visibility alone keeps the status and the customer's word, and carries the new version for the next change.
  const hidden = withStudio(project, { version: 4, visible: false });
  assert.equal(hidden.studio.visible, false);
  assert.equal(hidden.studio.status, "active");
  assert.equal(hidden.status, "In Umsetzung");
  // A saved text field only moves the version on.
  assert.equal(withStudio(project, { version: 6 }).studio.version, 6);
  // A newer version from Studio wins over what the page set.
  assert.equal(withStudio({ ...project, studio: { status: "hold", version: 5 } }, { status: "complete", version: 4 }).studio.status, "hold");
  assert.equal(withStudio(project, undefined), project);
});

test("Projekte V2: the status is written with the admin's own session, only with 2FA and the version the page showed", async () => {
  const actions = await source("lib/hub-projects/actions.ts");
  const actor = actions.slice(actions.indexOf("async function teamActor"), actions.indexOf("type Team ="));
  assert.match(actor, /claims\.claims\.aal !== "aal2"\) return null/);
  assert.match(actor, /await verifyHubAdmin\(\)/);
  const write = actions.slice(actions.indexOf("export async function setProjectStatus"), actions.indexOf("const staleDetails"));
  assert.match(write, /const ctx = await teamActor\(\);\s+if \(!ctx\) return denied;/);
  assert.match(write, /isStudioStatus\(input\.status\)/);
  assert.match(write, /ctx\.supabase\.from\("studio_project_details"\)\.update\(\{ status \}\)\.eq\("project_id", projectId\)\.eq\("version", expected\)/);
  assert.match(write, /ctx\.supabase\.from\("studio_project_details"\)\.insert\(/);
  assert.doesNotMatch(write, /db\.from\("studio_project_details"\)/, "never with the service role: Studio's RLS and triggers check and log the change");
  assert.match(write, /action: "project\.status_set"/);
  assert.match(write, /refreshWorkspace\(\)/);
});

test("Projekte V2 step 2: what the panel takes, checked like Studio checks it", () => {
  const typed = { name: "  Website   Relaunch ", description: " Neue Seite \n", startDate: "2026-11-16", dueDate: "2026-12-20", liveUrl: "kunde.de", testUrl: "", milestones: [
    { id: "a", name: "Livegang", date: "2026-12-18" }, { id: "b", name: "", date: "" }, { id: "c", name: "Design", date: "2026-11-30" },
  ] };
  const read = readProjectDraft(typed);
  assert.ok(read.ok);
  assert.deepEqual(read.value, { name: "Website Relaunch", description: "Neue Seite", startDate: "2026-11-16", dueDate: "2026-12-20", liveUrl: "https://kunde.de", testUrl: null,
    milestones: [{ name: "Design", date: "2026-11-30" }, { name: "Livegang", date: "2026-12-18" }] }, "empty rows drop out, milestones sort by day");
  const fail = (patch) => readProjectDraft({ ...typed, ...patch });
  assert.deepEqual(fail({ name: "  " }), { ok: false, field: "name", error: "Bitte gib dem Projekt einen Namen." });
  assert.equal(fail({ name: "x".repeat(161) }).field, "name");
  assert.equal(fail({ dueDate: "2026-11-01" }).error, "Der Zieltermin liegt vor dem Start.");
  assert.equal(fail({ startDate: "2026-02-30" }).field, "startDate");
  assert.equal(fail({ milestones: [{ id: "x", name: "Nur ein Name", date: "" }] }).error, "Jeder Meilenstein braucht ein Datum und einen Namen.");
  assert.equal(fail({ milestones: Array.from({ length: 41 }, (_, index) => ({ id: `${index}`, name: `M${index}`, date: "2026-12-01" })) }).field, "milestones");
  assert.equal(fail({ testUrl: "http://test.kunde.de" }).error, "Testdomain: Bitte eine sichere Adresse mit https:// eintragen.");
  assert.ok(isDay("2028-02-29"));
  assert.ok(!isDay("2027-02-29"));
  assert.ok(!isDay("16.11.2026"));
});

test("Projekte V2 step 2: a change carries only what differs, both days together, and nothing unknown", () => {
  const base = { name: "Shop", description: "", startDate: "2026-11-01", dueDate: null, liveUrl: null, testUrl: null, milestones: [] };
  assert.deepEqual(changesOf(base, { ...base }), {});
  assert.deepEqual(changesOf(base, { ...base, dueDate: "2026-12-01" }), { startDate: "2026-11-01", dueDate: "2026-12-01" });
  assert.deepEqual(changesOf(base, { ...base, name: "Shop 2", milestones: [{ name: "Go", date: "2026-11-20" }] }), { name: "Shop 2", milestones: [{ name: "Go", date: "2026-11-20" }] });
  assert.equal(changedWords(["milestones", "name", "dueDate"]), "Name, Zieltermin und Meilensteine");
  assert.equal(changedWords(["clientVisible"]), "Sichtbarkeit");

  assert.deepEqual(readProjectPatch({ clientVisible: true }), { ok: true, value: { clientVisible: true } });
  assert.deepEqual(readProjectPatch({ liveUrl: "www.kunde.de/" }), { ok: true, value: { liveUrl: "https://www.kunde.de" } });
  assert.deepEqual(readProjectPatch({ dueDate: "" }), { ok: true, value: { dueDate: null } });
  assert.equal(readProjectPatch({}).ok, false, "at least one field");
  assert.equal(readProjectPatch({ status: "active" }).ok, false, "the status has its own action");
  assert.equal(readProjectPatch({ clientVisible: "ja" }).ok, false);
  assert.equal(readProjectPatch({ startDate: "2026-12-02", dueDate: "2026-12-01" }).error, "Der Zieltermin liegt vor dem Start.");
  assert.equal(readProjectPatch(null).ok, false);
});

test("Projekte V2 step 2: the panel's draft, what counts as changed and newer data while typing", () => {
  const project = { name: "Shop", description: "Alt", startedOn: "2026-11-01", dueOn: null, liveUrl: "https://kunde.de", milestones: [{ title: "Go", description: "", at: "2026-11-20", kind: "milestone" }] };
  const draft = draftOf(project);
  assert.deepEqual(draft, { name: "Shop", description: "Alt", startDate: "2026-11-01", dueDate: "", liveUrl: "https://kunde.de", testUrl: "", milestones: [{ id: "m0", name: "Go", date: "2026-11-20" }] });
  assert.deepEqual(blankDraft("2026-11-16"), { name: "", description: "", startDate: "2026-11-16", dueDate: "", liveUrl: "", testUrl: "", milestones: [] });
  // Spaces, an empty milestone row and other row ids are no change.
  assert.ok(sameDraft(draft, { ...draft, name: " Shop ", milestones: [{ id: "x", name: "Go ", date: "2026-11-20" }, { id: "y", name: "", date: "" }] }));
  assert.ok(!sameDraft(draft, { ...draft, dueDate: "2026-12-01" }));
  // Someone changed the description in Studio while the name is being typed: the name stays, the description follows.
  const typing = { ...draft, name: "Shop neu" };
  const merged = mergeDraft(typing, draft, { ...draft, description: "Neu aus dem Studio" });
  assert.equal(merged.name, "Shop neu");
  assert.equal(merged.description, "Neu aus dem Studio");
});

test("Projekte V2 step 2: the project key comes from the name, exactly like Studio makes it", () => {
  assert.equal(projectKeyFrom("Website Relaunch 2027", []), "website-relaunch-2027");
  assert.equal(projectKeyFrom("Müller & Söhne: Größe", []), "mueller-soehne-groesse");
  assert.equal(projectKeyFrom("Website Relaunch 2027", ["website-relaunch-2027", "website-relaunch-2027-2"]), "website-relaunch-2027-3");
  assert.equal(projectKeyFrom("2027", []), "projekt");
  assert.equal(projectKeyFrom("X", []), "x-projekt");
  for (const name of ["Ä", "Café crème", "a".repeat(200), "!!!"]) assert.match(projectKeyFrom(name, []), /^[a-z][a-z0-9_-]{1,63}$/);
});

test("Projekte V2 step 2: saving and creating go through Studio's checks with the admin's own session", async () => {
  const actions = await source("lib/hub-projects/actions.ts");
  const save = actions.slice(actions.indexOf("export async function saveProjectDetails"), actions.indexOf("export async function createProject"));
  assert.match(save, /const ctx = await teamActor\(\);\s+if \(!ctx\) return denied;/);
  assert.match(save, /readProjectPatch\(input\.patch\)/);
  assert.match(save, /ctx\.supabase\.from\("studio_project_details"\)\.update\(studio\)\.eq\("project_id", projectId\)\.eq\("version", expected\)/);
  assert.doesNotMatch(save, /db\.from\("studio_project_details"\)/, "Studio's part never with the service role");
  assert.match(save, /ctx\.db\.from\("customer_projects"\)\.update\(own\)/, "name and addresses on the project row");
  assert.match(save, /action: "project\.saved"/);
  assert.match(save, /refreshWorkspace\(\)/);
  const create = actions.slice(actions.indexOf("export async function createProject"));
  assert.match(create, /const ctx = await teamActor\(\);\s+if \(!ctx\) return denied;/);
  assert.match(create, /readProjectDraft\(input\.draft\)/);
  assert.match(create, /\(customer\.data\.kind \?\? "customer"\) !== "customer"/, "never for freelancers");
  assert.match(create, /organization\.data\?\.status !== "active"/);
  assert.match(create, /project_key: projectKeyFrom\(fields\.name,/);
  assert.match(create, /ctx\.supabase\.from\("studio_project_details"\)\.insert\(/);
  assert.doesNotMatch(create, /db\.from\("studio_project_details"\)/);
  assert.match(create, /ctx\.db\.from\("customer_projects"\)\.delete\(\)\.eq\("id", projectId\)/, "a project Studio refused is taken back");
  assert.match(create, /action: "project\.created"/);
  assert.match(create, /refreshWorkspace\(\)/);
});

test("Projekte V2 step 2: the page asks before unsaved changes are lost and offers „Neues Projekt“ only with a service platform account", async () => {
  const panel = await source("components/hub/screens/projects-panel.tsx");
  assert.match(panel, /window\.confirm\("Deine Änderungen sind noch nicht gespeichert\. Verwerfen\?"\)/);
  for (const name of ["chooseCustomer", "openProject", "closePanel", "startProject"]) {
    const body = panel.slice(panel.indexOf(name.includes("Customer") ? `function ${name}` : `const ${name} =`));
    assert.match(body.slice(0, 400), /leave\(\)/, `${name} asks first`);
  }
  assert.match(panel, /creating && entry\?\.customer\?\.organizationId/);
  assert.match(panel, /<NewProjectPanel /);
  assert.match(panel, /disabled=\{!customer\.organizationId \|\| creating\}/);
  const side = await source("components/hub/screens/projects-side-panel.tsx");
  assert.match(side, /useDirtyReport\(dirty, onDirty\)/);
  assert.match(side, /saveProjectDetails\(\{ projectId: project\.id, expectedVersion: project\.studio\?\.version \?\? null, patch \}\)/);
  assert.match(side, /project\.studio\?\.visible === true/, "without a Studio row a project is internal");
  const created = await source("components/hub/screens/projects-new-panel.tsx");
  assert.match(created, /useState<StudioProjectStatus>\("planning"\)/);
  assert.match(created, /useState\(false\)/);
  assert.match(created, /createProject\(\{ customerId: customer\.id, status, visible, draft \}\)/);
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

