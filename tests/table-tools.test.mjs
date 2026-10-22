import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compareValues, foldText, matchesSearch, nextSort, sortRows } from "../lib/table-tools.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

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

test("both tables offer search, filters and sorting", async () => {
  for (const [path, search] of [["components/hub/screens/workspace.tsx", "Projekte durchsuchen"], ["components/hub/screens/files.tsx", "Dateien durchsuchen"]]) {
    const screen = await source(path);
    assert.ok(screen.includes(`label="${search}"`), path);
    assert.match(screen, /<FilterSelect /, path);
    assert.match(screen, /<SortControl /, path);
    assert.match(screen, /<SortHeader /, path);
    assert.match(screen, /className="table-blobs"/, path);
  }
  const css = await source("app/glass.css");
  assert.match(css, /border-spacing: 0 4px/);
});
