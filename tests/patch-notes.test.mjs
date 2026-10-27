import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { formatPatchDate, patchKindLabels, patchPackages, patchPackagesFor } from "../lib/patch-notes.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("packages run newest first with consecutive numbers and go-live days", () => {
  patchPackages.forEach((item, index) => {
    assert.equal(item.number, patchPackages.length - index, `package ${item.title}`);
    assert.match(item.date, /^\d{4}-\d{2}-\d{2}$/, `date of package ${item.number}`);
    assert.ok(!Number.isNaN(Date.parse(`${item.date}T00:00:00Z`)), `date of package ${item.number}`);
    if (index > 0) assert.ok(item.date <= patchPackages[index - 1].date, `package ${item.number} is older than the one above`);
  });
  assert.equal(formatPatchDate("2026-10-26"), "26. Oktober 2026");
});

test("every package explains itself and every change has a known kind", () => {
  for (const item of patchPackages) {
    assert.ok(item.title.trim() && item.summary.trim(), `package ${item.number}`);
    assert.ok(item.changes.length > 0, `package ${item.number} has changes`);
    assert.equal(new Set(item.changes.map((change) => change.title)).size, item.changes.length, `unique titles in package ${item.number}`);
    for (const change of item.changes) {
      assert.ok(change.kind in patchKindLabels, `${change.title}: kind`);
      assert.ok(change.title.trim() && change.text.trim().length > 20, `${change.title}: text`);
    }
  }
});

test("customers see only their entries, admins see everything", () => {
  const forCustomers = patchPackagesFor(false);
  for (const item of forCustomers) {
    assert.ok(item.changes.length > 0, `package ${item.number} is not empty`);
    assert.ok(item.changes.every((change) => change.customers), `package ${item.number} holds no internal entry`);
  }
  const internal = patchPackages.flatMap((item) => item.changes.filter((change) => !change.customers));
  assert.ok(internal.length > 0, "there are internal entries to hide");
  assert.equal(forCustomers.flatMap((item) => item.changes).length, patchPackages.flatMap((item) => item.changes).length - internal.length);
  assert.equal(patchPackagesFor(true), patchPackages);
});

test("patch notes carry no addresses, links or keys", () => {
  for (const item of patchPackages) {
    for (const text of [item.title, item.summary, ...item.changes.flatMap((change) => [change.title, change.text])]) {
      assert.doesNotMatch(text, /@|https?:|\bsb_|\bsk-|supabase\.co/i, text);
    }
  }
});

test("the section is reachable for everyone and every change must add an entry", async () => {
  const sidebar = await source("components/hub/glass-sidebar.tsx");
  assert.match(sidebar, /item\("patch-notes"\)/);
  assert.match(sidebar, /\{!manageUsers && <span className="sidebar-caption">Neuigkeiten<\/span>\}/);
  assert.match(await source("components/hub/screens/workspace.tsx"), /hubHref\(preview, "patch-notes"\)/);
  assert.match(await source("components/hub/hub-view.tsx"), /section === "patch-notes" \? <PatchNotesScreen \/>/);
  assert.doesNotMatch(await source("lib/hub-data.ts"), /adminSections: readonly HubSection\[\] = \[[^\]]*patch-notes/);
  assert.match(await source("CLAUDE.md"), /lib\/patch-notes\.ts/);
});
