import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { formatPatchDate, patchAreaLabels, patchAreaOrder, patchKindLabels, patchPackages, patchPackagesFor } from "../lib/patch-notes.ts";

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

test("every change names one of six areas and its place in the hub (22.11.2026)", () => {
  assert.deepEqual([...patchAreaOrder].sort(), Object.keys(patchAreaLabels).sort(), "the order holds every area once");
  assert.equal(patchAreaOrder.length, 6);
  for (const item of patchPackages) {
    for (const change of item.changes) {
      const name = `${item.number}: ${change.title}`;
      assert.ok(change.area in patchAreaLabels, `${name}: area`);
      assert.ok(change.place.trim() && change.place.length <= 60, `${name}: place`);
      assert.doesNotMatch(change.place, /@|https?:|·/, `${name}: place is a path, not a sentence`);
      for (const other of change.also ?? []) assert.ok(other in patchAreaLabels && other !== change.area, `${name}: also ${other}`);
      assert.equal(new Set(change.also ?? []).size, (change.also ?? []).length, `${name}: also without repeats`);
    }
  }
});

test("customers see only their entries, admins see everything", () => {
  const forCustomers = patchPackagesFor("customer");
  for (const item of forCustomers) {
    assert.ok(item.changes.length > 0, `package ${item.number} is not empty`);
    assert.ok(item.changes.every((change) => change.customers), `package ${item.number} holds no internal entry`);
  }
  const internal = patchPackages.flatMap((item) => item.changes.filter((change) => !change.customers));
  assert.ok(internal.length > 0, "there are internal entries to hide");
  assert.equal(forCustomers.flatMap((item) => item.changes).length, patchPackages.flatMap((item) => item.changes).length - internal.length);
  assert.equal(patchPackagesFor("admin"), patchPackages);
});

test("freelancers see what is marked for them, under titles that hold for them (18.11.2026)", () => {
  const forFreelancers = patchPackagesFor("freelancer");
  assert.ok(forFreelancers.length > 0);
  for (const item of forFreelancers) {
    assert.ok(item.changes.length > 0 && item.changes.every((change) => change.freelancers), `package ${item.number}`);
    assert.ok(item.date >= "2026-11-05", "nothing from before the freelancer role");
  }
  const latest = forFreelancers.find((item) => item.number === 25);
  const titles = latest.changes.map((change) => change.title);
  assert.ok(titles.includes("Übersicht für Freelancer") && titles.includes("Kunden für Freelancer"));
  assert.ok(!titles.includes("Insights auf einen Blick") && !titles.includes("Freigaben für Freelancer"), "neither customers' nor admins' entries");
  assert.equal(latest.title, patchPackages.find((item) => item.number === 25).freelancerTitle);
  for (const item of patchPackages) if (item.freelancerTitle) assert.doesNotMatch(item.freelancerTitle, /Vertrag & Domain|Insights|Serviceplattform/, `package ${item.number}`);
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
  assert.match(await source("CLAUDE.md"), /`area`.*`place`/);
});
