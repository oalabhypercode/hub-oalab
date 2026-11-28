import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { formatPatchDay, formatPatchDayShort, formatPatchSpan, patchAreaLabels, patchAreaOrder, patchBlocksFor, patchDays, patchKindLabels } from "../lib/patch-notes.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8").then((text) => text.replace(/\r\n/g, "\n"));
const allChanges = patchDays.flatMap((day) => day.changes);
const parts = (version) => version.split(".").map(Number);
const newer = (a, b) => { const [x, y] = [parts(a), parts(b)]; return x[0] - y[0] || (x[1] ?? 0) - (y[1] ?? 0); };

test("patch blocks (27.11.2026): Patch 1 holds everything up to 27.11.2026, then 1.1, 1.2 … with about 20 changes each", () => {
  patchDays.forEach((day, index) => {
    assert.match(day.date, /^\d{4}-\d{2}-\d{2}$/, `date of day ${index}`);
    assert.ok(!Number.isNaN(Date.parse(`${day.date}T00:00:00Z`)), `date of day ${index}`);
    assert.match(day.patch, /^\d+(\.\d+)?$/, `patch of ${day.date}`);
    assert.ok(day.changes.length > 0, `day ${day.date} of patch ${day.patch} has changes`);
    if (index === 0) return;
    const above = patchDays[index - 1];
    assert.ok(day.date <= above.date, `${day.date} is older than the day above`);
    assert.ok(newer(above.patch, day.patch) >= 0, `patch ${day.patch} does not come back after ${above.patch}`);
  });
  assert.equal(patchDays[patchDays.length - 1].patch, "1", "the oldest day belongs to Patch 1");
  for (const day of patchDays) if (day.date < "2026-11-27") assert.equal(day.patch, "1", `${day.date} belongs to Patch 1`);
  // A minor patch closes at about 20 changes; the next change starts the next number (a new whole number only on the user's word).
  for (const block of patchBlocksFor("admin")) if (block.version !== "1") assert.ok(block.entries.length <= 25, `Patch ${block.version} has ${block.entries.length} changes: start the next one`);
  assert.equal(formatPatchDay("2026-10-26"), "26.10.2026");
  assert.equal(formatPatchDayShort("2026-10-26"), "26.10.");
  assert.equal(formatPatchSpan("2026-10-15", "2026-11-27"), "15.10.–27.11.2026");
  assert.equal(formatPatchSpan("2026-11-27", "2026-11-27"), "27.11.2026");
  assert.equal(formatPatchSpan("2026-12-28", "2027-01-05"), "28.12.2026–05.01.2027");
});

test("every change has a known kind, a title and a text; titles are unique within a day", () => {
  for (const day of patchDays) {
    assert.equal(new Set(day.changes.map((change) => change.title)).size, day.changes.length, `unique titles on ${day.date} (Patch ${day.patch})`);
    for (const change of day.changes) {
      assert.ok(change.kind in patchKindLabels, `${change.title}: kind`);
      assert.ok(change.title.trim() && change.text.trim().length > 20, `${change.title}: text`);
    }
  }
});

test("every change names one of six areas and its place in the hub (22.11.2026)", () => {
  assert.deepEqual([...patchAreaOrder].sort(), Object.keys(patchAreaLabels).sort(), "the order holds every area once");
  assert.equal(patchAreaOrder.length, 6);
  for (const day of patchDays) {
    for (const change of day.changes) {
      const name = `${day.date}: ${change.title}`;
      assert.ok(change.area in patchAreaLabels, `${name}: area`);
      assert.ok(change.place.trim() && change.place.length <= 60, `${name}: place`);
      assert.doesNotMatch(change.place, /@|https?:|·/, `${name}: place is a path, not a sentence`);
      for (const other of change.also ?? []) assert.ok(other in patchAreaLabels && other !== change.area, `${name}: also ${other}`);
      assert.equal(new Set(change.also ?? []).size, (change.also ?? []).length, `${name}: also without repeats`);
    }
  }
});

test("customers see only their entries, admins see everything", () => {
  const forCustomers = patchBlocksFor("customer");
  for (const block of forCustomers) {
    assert.ok(block.entries.length > 0, `Patch ${block.version} is not empty`);
    assert.ok(block.entries.every((entry) => entry.customers), `Patch ${block.version} holds no internal entry`);
  }
  const internal = allChanges.filter((change) => !change.customers);
  assert.ok(internal.length > 0, "there are internal entries to hide");
  assert.equal(forCustomers.flatMap((block) => block.entries).length, allChanges.length - internal.length);
  assert.equal(patchBlocksFor("admin").flatMap((block) => block.entries).length, allChanges.length);
  // Every line carries its go-live day; a block knows its first and last one.
  const one = patchBlocksFor("admin").find((block) => block.version === "1");
  assert.equal(one.from, "2026-10-15");
  assert.ok(one.entries.every((entry) => entry.date >= one.from && entry.date <= one.to));
});

test("freelancers see what is marked for them (18.11.2026)", () => {
  const entries = patchBlocksFor("freelancer").flatMap((block) => block.entries);
  assert.ok(entries.length > 0 && entries.every((entry) => entry.freelancers), "only freelancers' entries");
  assert.ok(entries.every((entry) => entry.date >= "2026-11-05"), "nothing from before the freelancer role");
  const titles = entries.map((entry) => entry.title);
  assert.ok(titles.includes("Übersicht für Freelancer") && titles.includes("Kunden für Freelancer"));
  assert.ok(!titles.includes("Insights auf einen Blick") && !titles.includes("Freigaben für Freelancer"), "neither customers' nor admins' entries");
});

test("customers and freelancers read only what is theirs: no admins, other roles, technology or internal tools (27.11.2026)", () => {
  // The privacy statement has to name who else sees data (freelancers who look after a company, the team's Telegram group).
  const privacy = (change) => /^(Datenschutz|Impressum)/.test(change.place);
  const words = {
    customers: /\b(Admins?|Freelancer\w*|Datenbank|Migration\w*|Coolify|Supabase|Testmail\w*|intern\w*|Studio|NoteTree|Designvorschau|User Management|Schlüsselbund|KI-Protokoll|Kundenstamm|Asset Management)\b/,
    freelancers: /\b(Admins?|Datenbank|Migration\w*|Coolify|Supabase|Testmail\w*|NoteTree|Designvorschau|User Management|Schlüsselbund|KI-Protokoll|Kundenstamm|Servicepaket\w*|Testansicht)\b/,
  };
  for (const [audience, pattern] of Object.entries(words)) {
    for (const change of allChanges.filter((item) => item[audience] && !privacy(item))) {
      assert.doesNotMatch(`${change.title} ${change.text}`, pattern, `${audience}: „${change.title}“ speaks of something that is not theirs; write it for them or add an internal entry`);
    }
  }
});

test("patch notes carry no addresses, links or keys", () => {
  for (const change of allChanges) {
    for (const text of [change.title, change.text]) assert.doesNotMatch(text, /@|https?:|\bsb_|\bsk-|supabase\.co/i, text);
  }
});

test("the page lists patch blocks quietly: Art, Bereich, Stelle, Änderung and Datum, a click opens the text", async () => {
  const screen = await source("components/hub/screens/patch-notes.tsx");
  assert.match(screen, /const blocks = useMemo\(\(\) => patchBlocksFor\(asRole \? \(audience === "customers" \? "customer" : "freelancer"\) : view\), \[asRole, audience, view\]\);/);
  for (const column of ["Art", "Bereich", "Stelle", "Änderung", "Datum"]) assert.match(screen, new RegExp(`role="columnheader" className="fl-col [a-z-]+">(<span>)?${column}`), column);
  // The area filter is the hub's own list; an admin's „Kunden“ or „Freelancer“ shows exactly that role's list.
  assert.match(screen, /<Select variant="bare" chevron showLead label="Bereich" value=\{area\} onChange=\{chooseArea\} options=\{areaOptions\} \/>/);
  assert.match(screen, /So sehen <b>\{audienceLook\[audience\]\.label\}<\/b> die Patch Notes/);
  assert.doesNotMatch(screen, /summary|Betrifft|Ganzen Text anzeigen/, "no package titles, summaries or chips any more");
  const css = await source("app/glass.css");
  assert.match(css, /\.pn-detail-body \{ grid-column: 1 \/ -1;/, "the opened text runs across the whole row");
  // Phones: a dot in the area's colour, no line under the title; kind, area and place above the opened text.
  assert.match(css, /@container fl \(max-width: 640px\) \{\n[^@]*?\.pn-list \.pn-area-col \{ display: none; \}[^@]*?\.pn-area-dot \{ display: inline-block; \}[^@]*?\.pn-meta-kind \{ display: inline; \}/);
  assert.doesNotMatch(css, /\.patch-(table|chip|touch|summary)/, "the old table is gone");
});

test("the section is reachable for everyone and every change must add an entry", async () => {
  const sidebar = await source("components/hub/glass-sidebar.tsx");
  assert.match(sidebar, /item\("patch-notes"\)/);
  assert.match(sidebar, /\{!manageUsers && <span className="sidebar-caption">Neuigkeiten<\/span>\}/);
  assert.match(await source("components/hub/screens/workspace.tsx"), /hubHref\(preview, "patch-notes"\)/);
  assert.match(await source("components/hub/hub-view.tsx"), /section === "patch-notes" \? <PatchNotesScreen \/>/);
  assert.doesNotMatch(await source("lib/hub-data.ts"), /adminSections: readonly HubSection\[\] = \[[^\]]*patch-notes/);
  const rules = await source("CLAUDE.md");
  assert.match(rules, /lib\/patch-notes\.ts/);
  assert.match(rules, /`area`.*`place`/);
  assert.match(rules, /Patch 1\.1/);
});
