import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { activeFilterCount, byBoardOrder, cleanDay, cleanLabels, cleanText, cleanTitle, dueInfo, initialsOf, matchesFilters, NO_FILTERS, orderBetween, progressOf, renumbered, toBoardTask, TASK_STATUSES } from "../lib/hub-tasks/rules.ts";
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
