import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compareValues, foldText, matchesSearch, nextSort, sortRows } from "../lib/table-tools.ts";

// Windows checkouts may carry CRLF line endings; the source checks below compare LF text.
const source = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

test("keyword search ignores case and accents and needs every word", () => {
  assert.equal(foldText("Größe Übergabe"), "grosse ubergabe");
  const fields = ["Brand Identity", "Eine Marke. Ein Gefühl.", "Dein Feedback", null, undefined];
  assert.ok(matchesSearch("", fields));
  assert.ok(matchesSearch("   ", fields));
  assert.ok(matchesSearch("marke feed", fields));
  assert.ok(matchesSearch("GEFUHL", fields));
  assert.ok(matchesSearch("gefühl", fields));
  assert.equal(matchesSearch("marke website", fields), false);
  // Words may come from different fields.
  assert.ok(matchesSearch("identity gefühl", fields));
});

test("sorting compares numbers as numbers and text the German way", () => {
  assert.ok(compareValues(9, 10) < 0);
  assert.ok(compareValues("Datei 9", "Datei 10") < 0);
  assert.ok(compareValues("Äpfel", "Birnen") < 0);
  assert.equal(compareValues("logo", "Logo"), 0);
});

test("rows sort in both directions, keep their groups and stay stable", () => {
  const rows = [
    { name: "B", progress: 40, done: false },
    { name: "Fertig", progress: 100, done: true },
    { name: "A", progress: 85, done: false },
    { name: "C", progress: 40, done: false },
  ];
  const options = { group: (row) => Number(row.done), tieBreak: (row) => row.name };
  assert.deepEqual(sortRows(rows, (row) => row.progress, "desc", options).map((row) => row.name), ["A", "B", "C", "Fertig"]);
  assert.deepEqual(sortRows(rows, (row) => row.progress, "asc", options).map((row) => row.name), ["B", "C", "A", "Fertig"]);
  // Without a tie break equal values keep their order; the input is not changed.
  assert.deepEqual(sortRows(rows, (row) => row.progress, "asc").map((row) => row.name), ["B", "C", "A", "Fertig"]);
  assert.equal(rows[0].name, "B");
});

test("a header click flips the sorted column and starts others in their first direction", () => {
  assert.deepEqual(nextSort({ key: "title", dir: "asc" }, "title"), { key: "title", dir: "desc" });
  assert.deepEqual(nextSort({ key: "title", dir: "desc" }, "title"), { key: "title", dir: "asc" });
  assert.deepEqual(nextSort({ key: "title", dir: "desc" }, "date", "desc"), { key: "date", dir: "desc" });
  assert.deepEqual(nextSort({ key: "date", dir: "asc" }, "title"), { key: "title", dir: "asc" });
});

test("both tables offer search, filters, sorting and grouping in one toolbar", async () => {
  for (const [path, search] of [["components/hub/screens/workspace.tsx", "Projekte durchsuchen"], ["components/hub/screens/files.tsx", "Dateien durchsuchen"]]) {
    const screen = await source(path);
    assert.ok(screen.includes(`label="${search}"`), path);
    // Filters, sorting and grouping sit in menus of the sheet's toolbar, next to the search field.
    const toolbar = screen.slice(screen.indexOf("<SheetToolbar "), screen.indexOf("</SheetToolbar>"));
    for (const menu of ["Filter", "Sortierung", "Gruppe"]) assert.ok(toolbar.includes(`label="${menu}"`), `${path}: ${menu}`);
    assert.match(toolbar, /<FilterSelect /, path);
    assert.match(toolbar, /<SortControl /, path);
    assert.match(screen, /<SortHeader /, path);
    assert.match(screen, /<TableGroup /, path);
    assert.match(screen, /className="sheet section-first"/, path);
  }
  const sheet = await source("components/hub/sheet.tsx");
  assert.match(sheet, /aria-expanded=\{open\}/);
  assert.match(sheet, /hidden=\{!open\}/);
  assert.match(sheet, /event\.key === "Escape"/);
  const css = await source("app/glass.css");
  // The menus drop out of the sheet: it must not clip them, even when it holds only a few rows.
  const sheetRule = css.match(/\n\.sheet \{[^}]+\}/)[0];
  assert.doesNotMatch(sheetRule, /overflow/);
  // Narrower sheets drop the start date before the table has to scroll sideways.
  assert.match(css, /@container sheet \(max-width: 1040px\) \{\n(?: {2}[^\n]+\n)* {2}\.project-table \.col-start \{ display: none; \}/);
});

test("the projects table shows the project start and the next date in their own columns", async () => {
  const screen = await source("components/hub/screens/workspace.tsx");
  assert.match(screen, /label: "Nächster Termin"/);
  assert.match(screen, /className="cell-start col-start"[^\n]+project\.startedOn/);
  // The milestone cell no longer carries a date.
  assert.doesNotMatch(screen, /milestone\.at/);
  const headers = screen.slice(screen.indexOf("<thead>"), screen.indexOf("</thead>"));
  assert.ok(headers.indexOf("projectSorts.start") < headers.indexOf("projectSorts.deadline"));
});

test("on tablets the projects table drops the status and then the area before it has to scroll", async () => {
  const css = await source("app/glass.css");
  assert.match(css, /@container sheet \(max-width: 900px\) \{\n(?: {2}[^\n]+\n)* {2}\.project-table \.col-status \{ display: none; \}/);
  assert.match(css, /@container sheet \(max-width: 760px\) \{\n {2}\.project-table \.col-area \{ display: none; \}/);
  const screen = await source("components/hub/screens/workspace.tsx");
  for (const column of ["status", "area"]) {
    assert.match(screen, new RegExp(`<SortHeader option=\\{projectSorts\\.${column}\\} className="col-${column}"`), column);
    assert.match(screen, new RegExp(`<td className="cell-${column} col-${column}">`), column);
  }
});

test("a wide table scrolls inside its sheet, and the logins drop columns before they have to", async () => {
  const css = await source("app/glass.css");
  // Labels hidden for screen readers sit absolutely; without a positioned scroll area a wide table widens the whole page.
  assert.match(css, /\n\.sheet-scroll \{ position: relative; overflow-x: auto; \}/);
  // With open registrations the logins need the most room: first the customer number goes, then the last login.
  assert.match(css, /@container sheet \(max-width: 1200px\) \{\n {2}\.user-table \.col-number \{ display: none; \}/);
  assert.match(css, /@container sheet \(max-width: 1040px\) \{\n(?: {2}[^\n]+\n)* {2}\.user-table \.col-login \{ display: none; \}/);
  const users = await source("components/hub/screens/users.tsx");
  for (const column of ["number", "login"]) {
    assert.match(users, new RegExp(`<SortHeader option=\\{userSorts\\.${column}\\} className="col-${column}"`), column);
    assert.match(users, new RegExp(`<td className="cell-${column} col-${column}">`), column);
  }
});
