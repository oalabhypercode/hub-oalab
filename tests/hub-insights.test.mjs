import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { activityByDay, adminTodos, dueByDay, dueTasks, hasProgress, openRequests, orderProjects, progressRows, quotaView, serviceRows, serviceSummary, taskCounts, todoId, watchProjects, weekStartOf } from "../lib/hub-insights/rules.ts";
import { quotaStatus } from "../lib/hub-service-quota/rules.ts";

// Insights (design „V5“, 18.11.2026): the tiles' rules and how the page is wired. Fictional data only.

// Windows checkouts may carry CRLF line endings; the source checks below compare LF text.
const source = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

const today = "2026-11-25";
let counter = 0;
const task = (extra = {}) => { counter += 1; return { id: `t${counter}`, number: counter, title: `Aufgabe ${counter}`, status: "todo", dueOn: null, customer: false, visible: false, ...extra }; };
const project = (name, extra = {}) => ({ id: name, name, category: "", description: "", status: "In Umsetzung", progress: 0, date: "", artwork: "orange", startedOn: null, dueOn: null, milestones: [], ...extra });
const quotaRow = (customerId, packageId, monthlyUsed) => ({ customerId, packageId, monthlyLimit: packageId === "service-max" ? 20 : packageId === "service-lite" ? 5 : 0, monthlyUsed, exempted: 0, organizationActive: true, logins: 1 });

test("the customer's first project: waiting for feedback, then the nearest target date, finished ones last", () => {
  const ordered = orderProjects([
    project("Fertig", { status: "Abgeschlossen", dueOn: "2026-10-01" }),
    project("Später", { dueOn: "2026-12-20" }),
    project("Ohne Datum"),
    project("Bald", { dueOn: "2026-12-01" }),
    project("Feedback", { status: "Dein Feedback", dueOn: "2027-01-10" }),
  ]);
  assert.deepEqual(ordered.map((item) => item.name), ["Feedback", "Bald", "Später", "Ohne Datum", "Fertig"]);
});

test("a progress figure only where Studio counts something", () => {
  assert.equal(hasProgress(project("a", { progressBasis: "none" })), false, "neither tasks nor requests");
  assert.equal(hasProgress(project("a", { progressBasis: "tasks" })), true, "0 % of counted tasks is news");
  assert.equal(hasProgress(project("a", { progressBasis: "requests", progress: 40 })), true);
  assert.equal(hasProgress(project("a")), false, "without a basis and at 0 %");
  assert.equal(hasProgress(project("a", { progress: 35 })), true);
});

test("the month's requests read like the quota rules: warning from 80 %, full at the limit", () => {
  for (const [packageId, limit] of [["service-lite", 5], ["service-max", 20]]) {
    for (let used = 0; used <= limit + 2; used += 1) {
      const view = quotaView({ monthlyLimit: limit, monthlyUsed: used });
      assert.equal(view.tone, quotaStatus({ packageId, monthlyLimit: limit, monthlyUsed: used }), `${used} of ${limit}`);
      assert.equal(view.free, Math.max(0, limit - used));
      assert.ok(view.share >= 0 && view.share <= 1);
    }
  }
  assert.deepEqual(quotaView({ monthlyLimit: 20, monthlyUsed: 3 }), { limit: 20, used: 3, free: 17, tone: "ok", share: 0.15 });
  assert.deepEqual(quotaView({ monthlyLimit: 5, monthlyUsed: 7 }), { limit: 5, used: 7, free: 0, tone: "full", share: 1 }, "over the limit after exemptions");
  assert.deepEqual(quotaView({ monthlyLimit: 0, monthlyUsed: 2 }), { limit: 0, used: 2, free: 0, tone: "ok", share: 0 });
});

test("open requests over every project of the customer", () => {
  assert.equal(openRequests([project("a", { requests: { open: 2, done: 5 } }), project("b"), project("c", { requests: { open: 1, done: 0 } })]), 3);
  assert.equal(openRequests([]), 0);
});

test("due tasks: open, due today or earlier, finished projects left out, overdue first", () => {
  const live = project("Live", { tasks: [
    task({ title: "heute", dueOn: today }),
    task({ title: "gestern", dueOn: "2026-11-24" }),
    task({ title: "morgen", dueOn: "2026-11-26" }),
    task({ title: "ohne Datum" }),
    task({ title: "erledigt", dueOn: "2026-11-20", status: "done" }),
  ] });
  const finished = project("Fertig", { studio: { status: "complete", version: 1 }, tasks: [task({ title: "alt", dueOn: "2026-11-01" })] });
  const older = project("Alt", { tasks: [task({ title: "vorige Woche", dueOn: "2026-11-18" })] });
  const due = dueTasks([live, finished, older], today);
  assert.deepEqual(due.map((item) => [item.task.title, item.project.name, item.overdue]), [["vorige Woche", "Alt", true], ["gestern", "Live", true], ["heute", "Live", false]]);
});

test("projects in view: at risk, late, waiting for the customer, paused; each once, finished ones never", () => {
  const watched = watchProjects([
    project("Pausiert", { studio: { status: "hold", version: 1 }, tasks: [] }),
    project("Wartet", { tasks: [task({ customer: true, visible: true }), task({ customer: true, visible: true, status: "done" }), task({ customer: true, visible: false })] }),
    project("Überfällig", { dueOn: "2026-11-20", tasks: [task({ customer: true, visible: true })] }),
    project("Gefährdet", { studio: { status: "risk", version: 1 }, dueOn: "2026-11-01", tasks: [] }),
    project("Im Plan", { dueOn: "2026-12-01", tasks: [task()] }),
    project("Fertig", { status: "Abgeschlossen", dueOn: "2026-10-01" }),
    project("Feedback ohne Aufgaben", { status: "Dein Feedback" }),
  ], today);
  assert.deepEqual(watched.map((item) => [item.project.name, item.reason, item.waiting]), [
    ["Gefährdet", "risk", 0],
    ["Überfällig", "late", 1],
    ["Wartet", "waiting", 1],
    ["Feedback ohne Aufgaben", "waiting", 0],
    ["Pausiert", "hold", 0],
  ]);
});

test("the admins' service list: customers with a package and a name, the fullest first", () => {
  const names = new Map([
    ["a", { company: "Atelier Nord", customerNumber: "KD-1" }],
    ["b", { company: "Bäckerei Süd", customerNumber: "KD-2" }],
    ["c", { company: "Café Ost", customerNumber: "KD-3" }],
    ["d", { company: "Dach West", customerNumber: "KD-4" }],
    ["e", { company: "Elektro Mitte", customerNumber: "KD-5" }],
  ]);
  const rows = serviceRows([
    quotaRow("e", "service-max", 3),
    quotaRow("a", "service-max", 3),
    quotaRow("b", "service-lite", 5),
    quotaRow("c", "service-lite", 4),
    quotaRow("d", null, 2),
    quotaRow("archived", "service-max", 19),
  ], names);
  assert.deepEqual(rows.map((row) => [row.company, row.used, row.limit, row.tone]), [
    ["Bäckerei Süd", 5, 5, "full"],
    ["Café Ost", 4, 5, "warn"],
    ["Atelier Nord", 3, 20, "ok"],
    ["Elektro Mitte", 3, 20, "ok"],
  ]);
  assert.deepEqual(serviceSummary(rows), { ok: 2, warn: 1, full: 1 });
});

test("Insights loads its data on its own page only, and freelancers keep the plain page", async () => {
  assert.match(await source("app/dashboard/[section]/page.tsx"), /validSection === "insights" \? loadInsights\(identity\.account\?\.role \?\? null\) : undefined/);
  assert.match(await source("components/hub/hub-view.tsx"), /<InsightsScreen \{\.\.\.screen\} insights=\{preview \? undefined : insights\} \/>/);
  const screen = await source("components/hub/screens/insights.tsx");
  assert.match(screen, /if \(freelancer\) return <>\{header\}<EmptyState section="insights"/);
  assert.match(screen, /const data = insights \?\? previewInsights\(asOf, admin\);/, "the design preview draws fictional data");
  assert.match(screen, /const notices = preview \? previewNotices\(asOf, admin\) : inbox\?\.items \?\? \[\];/);
  assert.match(await source("app/layout.tsx"), /import "\.\/web-app\.css";\nimport "\.\/overview\.css";/);
  const server = await source("lib/hub-insights/server.ts");
  assert.match(server, /const admin = await verifyHubAdmin\(\);\n\s+const db = admin \? createAdminClient\(\) : null;/, "the service role only after the admin check");
  assert.match(server, /filter\(\(row\) => !archive\.customerIds\.has\(row\.customerId\)\)/, "archived customers stay out");
});

test("customers see their month's figures only while the quota switch is on, else what the package includes", async () => {
  const screen = await source("components/hub/screens/insights.tsx");
  assert.match(screen, /const quotaRow = data\.quota\.enforced \? data\.quota\.rows\[0\] : undefined;/);
  assert.match(screen, /\{serviceRequestLimits\[servicePackage\]\}<\/b><span>neue Anfragen im Monat inklusive/);
});

test("an empty page no longer leads to the design preview, which is a 404 live", async () => {
  const overview = await source("components/hub/screens/overview.tsx");
  assert.doesNotMatch(overview, /Designvorschau entdecken|href="\/preview"/);
});

test("the overview's widgets: tasks by column, admins over running projects, customers over released tasks", () => {
  const projects = [
    project("Live", { tasks: [task({ status: "done", visible: true }), task({ status: "todo", visible: true }), task({ status: "review" }), task({ status: "backlog", visible: true })] }),
    project("Fertig", { studio: { status: "complete", version: 1 }, tasks: [task({ status: "done", visible: true })] }),
  ];
  assert.deepEqual(taskCounts(projects, true), { backlog: 1, todo: 1, progress: 0, review: 1, done: 1 }, "finished projects stay out for admins");
  assert.deepEqual(taskCounts(projects, false), { backlog: 1, todo: 1, progress: 0, review: 0, done: 2 }, "customers count what is released");
});

test("due dates: overdue apart, then one count per day for two weeks, done and dateless tasks left out", () => {
  const projects = [project("Live", { tasks: [
    task({ dueOn: "2026-11-20", visible: true }),
    task({ dueOn: today, visible: true }),
    task({ dueOn: today }),
    task({ dueOn: "2026-11-27", visible: true }),
    task({ dueOn: "2026-12-08", visible: true }),
    task({ dueOn: "2026-12-09", visible: true }),
    task({ dueOn: "2026-11-26", status: "done", visible: true }),
    task({ visible: true }),
  ] })];
  const admin = dueByDay(projects, today, true);
  assert.equal(admin.overdue, 1);
  assert.equal(admin.days.length, 14);
  assert.deepEqual([admin.days[0], admin.days[2], admin.days[13]], [2, 1, 1], "today, in two days, the last of the 14 days");
  assert.equal(admin.days.reduce((sum, n) => sum + n, 0), 4, "the 15th day lies outside");
  assert.equal(dueByDay(projects, today, false).days[0], 1, "customers only see released tasks");
});

test("project progress: at risk first for admins, a dash without counted tasks", () => {
  const rows = progressRows([
    project("Ruhig", { dueOn: "2026-12-01", progress: 40, progressBasis: "tasks", company: "Atelier Nord" }),
    project("Brennt", { dueOn: "2027-01-10", studio: { status: "risk", version: 1 }, progressBasis: "none" }),
    project("Fertig", { status: "Abgeschlossen" }),
  ], true);
  assert.deepEqual(rows.map((row) => [row.name, row.value, row.risk]), [["Brennt", null, true], ["Ruhig", 40, false]]);
});

test("activity: one count per German day for the last two weeks", () => {
  const values = activityByDay(["2026-11-25T08:00:00Z", "2026-11-24T23:30:00Z", "2026-11-24T22:30:00Z", "2026-11-12T10:00:00Z", "2026-11-11T10:00:00Z", "kein Datum"], today);
  assert.equal(values.length, 14);
  assert.equal(values[13], 2, "today, including 00:30 in Berlin");
  assert.equal(values[12], 1, "23:30 in Berlin was yesterday");
  assert.equal(values[0], 1, "the first of the 14 days");
  assert.equal(values.reduce((sum, n) => sum + n, 0), 4, "the 15th day back lies outside");
});

test("the week strip starts on Monday", () => {
  assert.equal(weekStartOf("2026-11-25"), "2026-11-23", "a Wednesday");
  assert.equal(weekStartOf("2026-11-23"), "2026-11-23", "a Monday");
  assert.equal(weekStartOf("2026-11-29"), "2026-11-23", "a Sunday");
  assert.equal(weekStartOf("2026-03-01"), "2026-02-23", "across a month");
});

test("what waits for admins: registrations, requests, overdue tasks, full quotas, projects at risk or waiting, in that order", () => {
  const now = Date.parse("2026-11-25T08:00:00Z");
  const appointment = (id, status, start) => ({ id, title: `Termin ${id}`, status, start: Date.parse(start), end: Date.parse(start) + 1_800_000, customer: null });
  const todos = adminTodos({
    registrations: 2,
    appointments: [appointment("a", "requested", "2026-11-26T09:00:00Z"), appointment("b", "confirmed", "2026-11-26T10:00:00Z"), appointment("c", "requested", "2026-11-24T09:00:00Z")],
    projects: [
      project("Brennt", { studio: { status: "risk", version: 1 }, tasks: [task({ dueOn: "2026-11-20" }), task({ dueOn: "2026-11-22" })] }),
      project("Wartet", { tasks: [task({ customer: true, visible: true })] }),
    ],
    rows: [{ customerId: "c1", company: "Café Ost", customerNumber: "KD-1", packageId: "service-lite", limit: 5, used: 5, tone: "full", share: 1 }, { customerId: "c2", company: "Atelier Nord", customerNumber: "KD-2", packageId: "service-max", limit: 20, used: 3, tone: "ok", share: 0.15 }],
    today, now,
  });
  assert.deepEqual(todos.map((todo) => todo.kind), ["registrations", "request", "overdue", "quota", "risk", "waiting"]);
  assert.equal(todos[1].appointment.id, "a", "only open requests still ahead");
  assert.equal(todos[2].count, 2);
  assert.equal(todos[2].first.task.dueOn, "2026-11-20", "the longest overdue first");
  assert.equal(todos[0].key, "registrations:2", "the key carries the state: one more brings the line back");
  assert.equal(adminTodos({ registrations: 0, appointments: [], projects: [], rows: [], today, now }).length, 0);
});

test("a derived line's id is negative and stable for its key", () => {
  assert.ok(todoId("registrations:2") < 0);
  assert.equal(todoId("quota:c1:5"), todoId("quota:c1:5"));
  assert.notEqual(todoId("quota:c1:5"), todoId("quota:c1:6"));
  assert.ok(Number.isSafeInteger(todoId("x".repeat(500))));
});
