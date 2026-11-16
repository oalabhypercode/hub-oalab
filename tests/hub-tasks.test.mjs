import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { activeFilterCount, assignableIn, audienceColumns, audienceFields, audienceOf, audienceText, byBoardOrder, cleanDay, cleanLabels, cleanText, cleanTitle, commentReaders, dueInfo, initialsOf, isAudience, joinNames, matchesFilters, metadataName, NO_FILTERS, orderBetween, progressOf, projectFreelancerLogins, renumbered, TASK_COLUMNS, toBoardTask, TASK_STATUSES } from "../lib/hub-tasks/rules.ts";
import { taskFixtures } from "../lib/hub-tasks/fixtures.ts";

// Windows checkouts with autocrlf hold CRLF; the patterns below are written with \n.
const source = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

test("columns follow Studio: backlog, open, in progress, in review, done", () => {
  assert.deepEqual([...TASK_STATUSES], ["backlog", "todo", "progress", "review", "done"]);
});

test("a dropped card lands between its neighbours without touching them", () => {
  assert.equal(orderBetween(null, null), 0);
  assert.equal(orderBetween(null, 4), 3);
  assert.equal(orderBetween(4, null), 5);
  assert.equal(orderBetween(1, 2), 1.5);
  // A used-up gap asks for renumbering instead of a wrong place.
  assert.equal(orderBetween(1, 1 + 1e-17), null);
  assert.equal(orderBetween(1e12, null), null);
  assert.deepEqual([...renumbered(["a", "b", "c"]).entries()], [["a", 1], ["b", 2], ["c", 3]]);
  const cards = [{ order: 2, number: 9 }, { order: 1, number: 7 }, { order: 1, number: 3 }];
  assert.deepEqual(cards.sort(byBoardOrder).map((card) => card.number), [3, 7, 9]);
});

test("inputs keep Studio's limits", () => {
  assert.equal(cleanTitle("  Startseite   prüfen "), "Startseite prüfen");
  assert.equal(cleanTitle(""), null);
  assert.equal(cleanTitle("x".repeat(241)), null);
  assert.equal(cleanText("Zeile 1\r\nZeile 2  \n"), "Zeile 1\nZeile 2");
  assert.equal(cleanText("x".repeat(20001)), null);
  assert.deepEqual(cleanLabels([" Design ", "design", "Text"]), ["Design", "Text"]);
  assert.equal(cleanLabels(["x".repeat(65)]), null);
  assert.equal(cleanLabels([""]), null);
  assert.equal(cleanDay("2026-11-18"), "2026-11-18");
  assert.equal(cleanDay(""), null);
  assert.equal(cleanDay("2026-02-30"), undefined);
});

test("due dates read like the cards: today, tomorrow, weekday, overdue", () => {
  const today = "2026-11-15";
  assert.equal(dueInfo("2026-11-15", today, false).short, "Heute");
  assert.equal(dueInfo("2026-11-15", today, false).tone, "is-today");
  assert.equal(dueInfo("2026-11-16", today, false).short, "Morgen");
  // Node's and the browsers' ICU differ in the dot ("Mi" / "Mi.").
  assert.match(dueInfo("2026-11-18", today, false).short, /^Mi\.?$/);
  assert.equal(dueInfo("2026-11-18", today, false).hint, "in 3 Tagen");
  assert.equal(dueInfo("2026-11-14", today, false).short, "Gestern");
  assert.equal(dueInfo("2026-11-12", today, false).tone, "is-overdue");
  assert.equal(dueInfo("2026-11-12", today, false).hint, "3 Tage überfällig");
  // Done cards are never late.
  assert.equal(dueInfo("2026-11-12", today, true).tone, "");
  assert.equal(dueInfo(null, today, false), null);
});

test("search and filters", () => {
  const board = taskFixtures("2026-11-15");
  const people = new Map(board.people.map((person) => [person.id, person]));
  const context = { viewerId: "p-jonas", today: "2026-11-15", people };
  const count = (filters) => board.tasks.filter((task) => matchesFilters(task, { ...NO_FILTERS, ...filters }, context)).length;
  assert.equal(count({}), board.tasks.length);
  assert.equal(count({ query: "hero" }), 1);
  assert.equal(count({ query: "#1031" }), 1);
  assert.equal(count({ query: "lea" }), board.tasks.filter((task) => task.assigneeIds.includes("p-lea")).length);
  assert.equal(count({ mine: true }), board.tasks.filter((task) => task.assigneeIds.includes("p-jonas")).length);
  assert.equal(count({ label: "design" }), board.tasks.filter((task) => task.labels.includes("Design")).length);
  assert.equal(count({ assignee: "none" }), board.tasks.filter((task) => !task.assigneeIds.length).length);
  assert.ok(count({ due: "overdue" }) >= 1);
  assert.equal(activeFilterCount({ ...NO_FILTERS, label: "Design", due: "week" }), 2);
});

test("Studio rows become cards, unknown values fall back", () => {
  const card = toBoardTask({ id: "t", task_number: "1031", project_id: "p", title: "Hero", status: "weird", priority: "x", due_date: null, labels: null, assignee_user_ids: null, client_visible: true, board_order: "2.5", version: "3", created_by: "u", created_at: "c", updated_at: "u" });
  assert.equal(card.number, 1031);
  assert.equal(card.status, "todo");
  assert.equal(card.priority, "none");
  assert.deepEqual(card.labels, []);
  assert.equal(card.order, 2.5);
  assert.equal(card.version, 3);
  // Rows without the column (before the freelancer migration) count as visible to the project's freelancers.
  assert.equal(card.teamOnly, false);
  assert.equal(toBoardTask({ ...{ id: "t", task_number: 1, project_id: "p", title: "x", status: "todo", priority: "none", due_date: null, labels: [], assignee_user_ids: [], client_visible: false, board_order: 1, version: 1, created_by: "u", created_at: "c", updated_at: "u" }, team_only: true }).teamOnly, true);
  assert.match(TASK_COLUMNS, /client_visible, team_only, board_order/);
  assert.equal(progressOf([{ status: "done" }, { status: "todo" }, { status: "review" }]), 33);
  assert.equal(initialsOf("Jonas Keller"), "JK");
  assert.equal(initialsOf("Mia"), "MI");
});

test("writes go through the admin's own session with a version check", async () => {
  const actions = await source("lib/hub-tasks/actions.ts");
  assert.match(actions, /^"use server";/);
  assert.match(actions, /if \(data\?\.claims\?\.aal !== "aal2"\) return unconfirmed;/);
  assert.match(actions, /verifyHubAdmin\(\)/);
  // Every action starts with its check. Only the window's reads use the board's own check (live 16.11.2026: a login
  // without a second factor saw the board but not a card's window); everything else writes and needs aal2.
  const guards = [...actions.matchAll(/export async function (\w+)[^\n]*\n  const ctx = await (reader|actor)\(\);\n  if \((!ctx\) return denied|"error" in ctx\) return ctx);/g)];
  const exported = [...actions.matchAll(/export async function (\w+)/g)].map((match) => match[1]);
  assert.deepEqual(guards.map((match) => match[1]).sort(), exported.sort());
  assert.deepEqual(guards.filter((match) => match[2] === "reader").map((match) => match[1]).sort(), ["loadTaskDetail", "taskFileLink"]);
  for (const match of guards) assert.equal(match[3].startsWith("!ctx"), match[2] === "reader", match[1]);
  // Every update of a task or a checklist point carries the version the browser saw.
  for (const write of actions.matchAll(/ctx\.supabase\.from\("studio_(tasks|subtasks)"\)\.update\(/g)) {
    const line = actions.slice(write.index, actions.indexOf("\n", write.index));
    assert.match(line, /\.eq\("version", version\)/, line);
  }
  assert.doesNotMatch(actions, /revalidatePath|revalidateTag/);
  const server = await source("lib/hub-tasks/server.ts");
  assert.match(server, /return data\?\.claims\?\.aal === "aal2";/);
  assert.match(server, /verifyHubAdmin\(\)/);
  assert.match(server, /\.eq\("archived", false\)/);
});

test("without a session confirmed by a code the board reads only and offers the code", async () => {
  assert.equal(taskFixtures("2026-11-15").confirmed, true);
  const screen = await source("components/hub/screens/tasks.tsx");
  assert.match(screen, /const canEdit = !source\.error && source\.confirmed;/);
  assert.match(screen, /const confirmHref = locked \? confirmSessionHref\(`\$\{hubHref\(preview, "projects"\)\}\/tasks/);
  assert.match(screen, /href=\{confirmHref\}>Mit Code bestätigen<\/a>/);
  // The open window covers that note on the right, so its footer offers the code as well (live 16.11.2026).
  assert.match(screen, /confirmHref=\{confirmHref\}/);
  const panel = await source("components/hub/screens/tasks-panel.tsx");
  assert.match(panel, /\) : confirmHref \? \(\n\s+<div className="kb-locked" role="status">/);
  assert.match(panel, /href=\{confirmHref\}>Mit Code bestätigen<\/a>/);
  // Read-only keeps the choice between board and list.
  assert.match(screen, /actions=\{canEdit \? \[\{ icon: Plus, label: "Neue Aufgabe"/);
});

// Step 3 (user 16.11.2026, as in the approved design): freelancers work on the board of the projects an admin put them
// on, and the team chooses who sees a task: „Nur Team“, „+ Freelancer“ or „+ Kunde“.

test("who sees a task: one choice of three, always written as both of Studio's fields", () => {
  assert.deepEqual(audienceColumns("team"), { team_only: true, client_visible: false });
  assert.deepEqual(audienceColumns("shared"), { team_only: false, client_visible: false });
  assert.deepEqual(audienceColumns("customer"), { team_only: false, client_visible: true });
  assert.deepEqual(audienceFields("team"), { teamOnly: true, visible: false });
  assert.equal(audienceOf({ teamOnly: true, visible: false }), "team");
  assert.equal(audienceOf({ teamOnly: false, visible: false }), "shared");
  assert.equal(audienceOf({ teamOnly: false, visible: true }), "customer");
  // Studio knows only client_visible: a card it released counts as released, whatever else is set.
  assert.equal(audienceOf({ teamOnly: true, visible: true }), "customer");
  assert.equal(isAudience("shared"), true);
  assert.equal(isAudience("everyone"), false);
});

test("comment hints and „Sichtbar für“ name who reads along", () => {
  assert.equal(joinNames(["Mia", "Tom", "Lea"]), "Mia, Tom und Lea");
  assert.equal(commentReaders("team", ["Mia"], false), "Nur das oalab-Team sieht Kommentare");
  assert.equal(commentReaders("shared", [], false), "Sehen: das oalab-Team");
  assert.equal(commentReaders("shared", ["Mia"], false), "Sehen: oalab-Team und Mia");
  // Comments never reach the customer, so „+ Kunde“ reads like „+ Freelancer“.
  assert.equal(commentReaders("customer", ["Mia"], false), "Sehen: oalab-Team und Mia");
  assert.equal(commentReaders("shared", [], true), "Sehen: oalab-Team und du");
  assert.equal(commentReaders("shared", ["Tom"], true), "Sehen: oalab-Team, du und Tom");
  assert.equal(audienceText("shared", []), "oalab-Team und du");
  assert.equal(audienceText("shared", ["Tom"]), "oalab-Team, du und Tom");
  assert.equal(audienceText("customer", []), "oalab-Team, du und der Kunde");
});

test("assignees: the team first, then the project's freelancers, nobody from other projects", () => {
  const board = taskFixtures("2026-11-15");
  const web = board.projects.find((project) => project.id === "web");
  const brand = board.projects.find((project) => project.id === "brand");
  assert.deepEqual(projectFreelancerLogins(web, board.freelancers), ["p-mia"]);
  assert.deepEqual(assignableIn(web, board.people, board.freelancers).map((person) => person.id), ["p-jonas", "p-lea", "p-sam", "p-mia"]);
  assert.deepEqual(assignableIn(brand, board.people, board.freelancers).map((person) => person.id), ["p-jonas", "p-lea", "p-sam"]);
  assert.equal(board.people.find((person) => person.id === "p-mia").kind, "freelancer");
});

test("the freelancer's example board is what the database shows them", () => {
  const admin = taskFixtures("2026-11-15");
  const freelancer = taskFixtures("2026-11-15", "freelancer");
  assert.equal(admin.viewer, "admin");
  assert.equal(freelancer.viewer, "freelancer");
  assert.equal(freelancer.viewerId, "p-mia");
  // Only the project she is on, without „Nur Team“, and of the freelancers only those on her projects.
  assert.deepEqual(freelancer.projects.map((project) => project.id), ["web"]);
  assert.ok(admin.tasks.some((task) => task.teamOnly));
  assert.ok(freelancer.tasks.length > 0);
  assert.ok(freelancer.tasks.every((task) => task.projectId === "web" && !task.teamOnly));
  assert.deepEqual(freelancer.freelancers.map((entry) => entry.id), ["fl-pixelwerk"]);
  assert.ok(!freelancer.people.some((person) => person.id === "p-tom"));
  assert.equal(freelancer.confirmed, true);
});

test("freelancers read and write with their own session; the team's things stay with the team", async () => {
  const actions = await source("lib/hub-tasks/actions.ts");
  const users = await source("lib/hub-users/server.ts");
  // An active freelancer whose session confirmed its code; the database asks the same of every freelancer rule.
  const verify = users.slice(users.indexOf("export async function verifyHubFreelancer"), users.indexOf("/** Every Supabase Auth user"));
  assert.match(verify, /app_role !== "oalab_freelancer"\) return null;/);
  assert.match(verify, /if \(data\.claims\.aal !== "aal2"\) return null;/);
  assert.match(verify, /profile\?\.status !== "active"\) return null;/);
  // Reads of a freelancer go through their session, never the server key; writes always do.
  assert.match(actions, /return freelancer \? \{ userId: freelancer\.userId, read: freelancer\.supabase as unknown as SupabaseClient, freelancer: true \} : null;/);
  assert.match(actions, /return \{ userId: freelancer\.userId, supabase: session, read: session, db, freelancer: true \};/);
  for (const name of ["loadTaskDetail", "taskFileLink", "addComment", "saveSubtask"]) {
    const start = actions.indexOf(`export async function ${name}`);
    const body = actions.slice(start, actions.indexOf("\n}\n", start));
    assert.doesNotMatch(body, /ctx\.db\./, `${name} reads with ctx.read`);
  }
  // Archiving, the audience and „Beteiligte“ stay with the team, before the database says the same.
  assert.match(actions, /export async function archiveTask[^\n]*\n  const ctx = await actor\(\);\n  if \("error" in ctx\) return ctx;\n  if \(ctx\.freelancer\) return fail\(TEAM_DECIDES\);/);
  assert.match(actions, /export async function setProjectFreelancer[^\n]*\n  const ctx = await actor\(\);\n  if \("error" in ctx\) return ctx;\n  if \(ctx\.freelancer\) return denied;/);
  assert.match(actions, /if \(patch\.audience !== undefined\) \{\n    if \(freelancer\) return \{ ok: false, error: TEAM_DECIDES \};/);
  // A freelancer creates only in a project their session lists, and never for the customer or „Nur Team“.
  assert.match(actions, /if \(ctx\.freelancer\) \{\n    const own = await ctx\.read\.from\("studio_project_freelancers"\)/);
  assert.match(actions, /client_visible: false,\n      team_only: false,/);
  // German answers to the database's refusals.
  assert.match(actions, /if \(message\.includes\("STUDIO_FREELANCER_FIELD_LOCKED"\)\) return TEAM_DECIDES;/);
  assert.match(actions, /STUDIO_ASSIGNEE_MUST_BE_ACTIVE_TEAM_MEMBER"\)\) return "Zuständig können nur aktive Mitglieder des oalab-Teams und Freelancer dieses Projekts sein\."/);
  assert.match(actions, /\? "Speichern abgelehnt: Dieses Projekt oder diese Aufgabe ist für dich nicht mehr freigegeben\. Lade die Seite neu\."/);
  assert.match(actions, /STUDIO_FREELANCER_MUST_SERVE_CUSTOMER/);
});

test("the freelancer's board comes from their session, only the names from the server key", async () => {
  const server = await source("lib/hub-tasks/server.ts");
  const board = server.slice(server.indexOf("async function freelancerBoard"), server.indexOf("/** The board for the signed-in admin or freelancer"));
  // Projects, cards, checklists, comments and images with the session (RLS); names only for these projects.
  assert.match(board, /const own = await session\.from\("studio_project_freelancers"\)\.select\("project_id"\)/);
  assert.match(board, /\.in\("id", ownIds\)\.neq\("status", "archived"\)/);
  for (const table of ["studio_tasks", "studio_comments", "studio_subtasks", "studio_files"]) assert.match(board, new RegExp(`session\\.from\\("${table}"\\)`), table);
  assert.doesNotMatch(board, /db\.from\("studio_(tasks|comments|subtasks|files)"\)/);
  assert.match(board, /loadFreelancers\(db, organizationIds, \[\.\.\.new Set\(\(links\.data \?\? \[\]\)\.map\(\(link\) => link\.freelancer_id\)\)\]\)/);
  // Admins first, then freelancers; the calendar under Projekte keeps reading the admins' board.
  assert.match(server, /const freelancer = admin \? null : await verifyHubFreelancer\(\);/);
  assert.match(server, /return admin \? adminBoard\(admin\.userId, db\) : freelancerBoard\(/);
});

test("the board as freelancers see it: their projects, no archive, no choice of who sees a card", async () => {
  const screen = await source("components/hub/screens/tasks.tsx");
  assert.match(screen, /const freelancerView = source\.viewer === "freelancer";/);
  assert.match(screen, /canArchive=\{!freelancerView\}/);
  assert.match(screen, /manage=\{!freelancerView\}/);
  assert.match(screen, /\? \{ mode: "text", text: audienceText\(audience, othersOn\(id\)\) \}\n\s+: \{ mode: "choose"/);
  assert.match(screen, /<strong>Noch keinem Projekt zugeordnet\.<\/strong>/);
  // Freelancers have no page „Projekte“ to go back to; new cards of theirs start with them as assignee.
  assert.match(screen, /leading=\{freelancerView \? undefined :/);
  assert.match(screen, /initialAssignees=\{freelancerView \? \[source\.viewerId\] : \[\]\}/);
  // The preview shows their view with ?role=freelancer.
  assert.match(screen, /const previewRole = searchParams\.get\("role"\) === "freelancer" \? "freelancer" : "admin";/);
  const panel = await source("components/hub/screens/tasks-panel.tsx");
  assert.match(panel, /\{canEdit && canArchive && \(archiving/);
  assert.match(panel, /audience\.mode === "choose" \? <>\n\s+<AudienceChoice /);
  assert.match(panel, /label: hasFreelancers \? "\+ Freelancer" : "Team"/);
  const views = await source("components/hub/screens/tasks-views.tsx");
  assert.match(views, /if \(task\.teamOnly\) return <span className="kb-vis is-team"/);
  const people = await source("components/hub/screens/tasks-people.tsx");
  assert.match(people, /if \(!manage\) return <div className="kb-stat">Beteiligte<strong>\{stack\}<\/strong><\/div>;/);
  assert.match(people, /<Switch checked=\{on\} disabled=\{!canEdit \|\| busy !== null\}/);
  assert.match(people, /beim Kunden unter „Betreut von“ fest\./);
});

test("team accounts without a hub profile show the name their login keeps (seen live 16.11.2026)", async () => {
  // Studio writes full_name, the hub's sign-up first and last name; anything else stays empty.
  assert.equal(metadataName({ full_name: "  Jonas  Keller " }), "Jonas Keller");
  assert.equal(metadataName({ first_name: "Lea", last_name: "Brandt" }), "Lea Brandt");
  assert.equal(metadataName({ full_name: "", first_name: "Sam" }), "Sam");
  assert.equal(metadataName({ name: "Studio" }), "Studio");
  assert.equal(metadataName({ full_name: 42 }), "");
  assert.equal(metadataName(null), "");
  assert.equal(metadataName("Jonas"), "");
  // The board asks the login only for people without a name in the hub, and only for a few of them.
  const server = await source("lib/hub-tasks/server.ts");
  assert.match(server, /const unnamed = ids\.filter\(\(id\) => !names\.get\(id\)\)\.slice\(0, LOGIN_NAMES\);/);
  assert.match(server, /const found = await db\.auth\.admin\.getUserById\(id\)\.catch\(\(\) => null\);/);
  assert.match(server, /return \[id, metadataName\(found\?\.data\?\.user\?\.user_metadata\)\] as const;/);
  assert.match(server, /names\.get\(id\) \|\| \(team\.has\(id\) \? "Teammitglied"/);
});
