import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeAppearance } from "../lib/appearance.ts";
import { fileDayGroup, formatFileDay } from "../lib/hub-files/catalog.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("quiet lists name the day: today, yesterday, then the date, in Berlin time", () => {
  assert.equal(formatFileDay("2026-11-02T09:14:00+01:00", "2026-11-02"), "Heute");
  // Shortly after midnight in Berlin it is already the next day, although UTC still says the 1st.
  assert.equal(formatFileDay("2026-11-01T23:30:00Z", "2026-11-02"), "Heute");
  assert.equal(formatFileDay("2026-11-01T10:00:00+01:00", "2026-11-02"), "Gestern");
  assert.equal(formatFileDay("2026-10-28T16:40:00+01:00", "2026-11-02"), "28. Okt.");
  // Fixtures carry no zone and count as UTC wall time, measured against their own reference day.
  assert.equal(formatFileDay("2026-10-15T08:00", "2026-10-15"), "Heute");
});

test("all files fall into Heute, Gestern, Diese Woche and Früher", () => {
  const today = "2026-11-02";
  assert.equal(fileDayGroup("2026-11-02T08:00:00+01:00", today), "Heute");
  assert.equal(fileDayGroup("2026-11-01T08:00:00+01:00", today), "Gestern");
  assert.equal(fileDayGroup("2026-10-28T08:00:00+01:00", today), "Diese Woche");
  assert.equal(fileDayGroup("2026-10-20T08:00:00+01:00", today), "Früher");
});

test("the list view is a setting of its own: minimal unless someone chose detail", () => {
  assert.equal(normalizeAppearance(null).listView, "minimal");
  assert.equal(normalizeAppearance({ listView: "detail" }).listView, "detail");
  assert.equal(normalizeAppearance({ listView: "table" }).listView, "minimal");
});

test("admins get the Asset Management with customers first; customers keep their files table", async () => {
  const files = await source("components/hub/screens/files.tsx");
  assert.match(files, /return props\.admin \? <AssetManagement \{\.\.\.props\} \/> : <CustomerFiles \{\.\.\.props\} \/>;/);
  const screen = await source("components/hub/screens/asset-management.tsx");
  // The switch and the setting under Darstellung are one value.
  assert.match(screen, /trailing=\{<DensitySwitch view=\{listView\} onChange=\{\(next\) => update\(\{ listView: next \}\)\} \/>\}/);
  assert.match(screen, /title="Minimalistische Sicht"/);
  assert.match(screen, /title="Detailsicht"/);
  // The shared views stay on top of the customers; a notice's link still opens its file.
  assert.match(screen, /"Alle Dateien"/);
  assert.match(screen, /"Ablage"/);
  assert.match(screen, /const linkedFile = useSearchParams\(\)\.get\("file"\);/);
  // Admins no longer see the two metric cards above the list.
  assert.doesNotMatch(screen, /CategoryMetrics/);
  const appearance = await source("components/hub/screens/appearance.tsx");
  assert.match(appearance, /\{admin && \(\s*<GlassCard aria-labelledby="appearance-lists">/);
  const css = await source("app/glass.css");
  assert.match(css, /\.am-min-lead \{ position: relative; width: 34px; height: 34px;[^}]*color: var\(--cat\);/);
  assert.match(css, /@container sheet \(max-width: 820px\) \{\s*\.am-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /@media \(hover: none\) \{\s*\.am-min-section-acts \{ opacity: 1; \}/);
});
