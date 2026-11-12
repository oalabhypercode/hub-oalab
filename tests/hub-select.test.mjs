import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { edgeIndex, highlightParts, SEARCH_FROM, stepIndex, typeaheadIndex } from "../lib/select-keys.ts";

// Windows checkouts may carry CRLF line endings; the source checks below compare LF text.
const source = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

/** Every .tsx of the hub's app and components, except the starter's tutorial. */
async function hubSources() {
  const files = [];
  for (const dir of ["app", "components"]) {
    for (const entry of await readdir(new URL(`../${dir}`, import.meta.url), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".tsx")) continue;
      const path = `${entry.parentPath ?? entry.path}/${entry.name}`.replace(/\\/g, "/");
      if (path.includes("/tutorial/")) continue;
      files.push(path.slice(path.lastIndexOf(`/${dir}/`) + 1));
    }
  }
  return files;
}

test("arrow keys skip what cannot be chosen and wrap around the ends", () => {
  const disabled = [false, true, false, false];
  assert.equal(stepIndex(disabled, -1, 1), 0, "first press down starts at the top");
  assert.equal(stepIndex(disabled, -1, -1), 3, "first press up starts at the bottom");
  assert.equal(stepIndex(disabled, 0, 1), 2, "the disabled option is skipped");
  assert.equal(stepIndex(disabled, 3, 1), 0, "down from the last wraps to the first");
  assert.equal(stepIndex(disabled, 0, -1), 3, "up from the first wraps to the last");
  assert.equal(stepIndex([true, true], 0, 1), -1);
  assert.equal(stepIndex([], -1, 1), -1);
  assert.equal(edgeIndex([true, false, false, true], "first"), 1);
  assert.equal(edgeIndex([true, false, false, true], "last"), 2);
});

test("typing jumps to the next option that starts with the letters, ignoring case and accents", () => {
  const labels = ["Angebot", "Bäckerei Krume", "Büro Nord", "Design", "bauhaus"];
  const free = labels.map(() => false);
  assert.equal(typeaheadIndex(labels, free, "d", -1), 3);
  assert.equal(typeaheadIndex(labels, free, "b", -1), 1, "the first B");
  assert.equal(typeaheadIndex(labels, free, "b", 1), 2, "the same letter again moves on");
  assert.equal(typeaheadIndex(labels, free, "b", 4), 1, "and wraps around");
  assert.equal(typeaheadIndex(labels, free, "back", 0), 1, "ä is found by a");
  assert.equal(typeaheadIndex(labels, free, "BAU", 0), 4);
  assert.equal(typeaheadIndex(labels, [false, true, false, false, false], "bäc", -1), -1, "disabled options are skipped");
  assert.equal(typeaheadIndex(labels, [false, true, false, false, false], "ba", -1), 4, "the next fitting one instead");
  assert.equal(typeaheadIndex(labels, free, "x", -1), -1);
  assert.equal(typeaheadIndex(labels, free, " ", -1), -1);
});

test("suggestions mark the typed part, the rest stays plain", () => {
  assert.deepEqual(highlightParts("netcup", "NET"), [{ text: "net", hit: true }, { text: "cup", hit: false }]);
  assert.deepEqual(highlightParts("Cloudflare", "flare"), [{ text: "Cloud", hit: false }, { text: "flare", hit: true }]);
  assert.deepEqual(highlightParts("IONOS", "x"), [{ text: "IONOS", hit: false }]);
  assert.deepEqual(highlightParts("IONOS", "  "), [{ text: "IONOS", hit: false }]);
  assert.ok(SEARCH_FROM >= 8, "short lists stay without a search field");
});

test("the hub draws its own lists: no browser select or datalist is left", async () => {
  const offenders = [];
  for (const path of await hubSources()) {
    const text = await source(path);
    if (/<select\b|<datalist\b|\slist=\{/.test(text)) offenders.push(path);
  }
  assert.deepEqual(offenders, [], "use Select or SuggestInput from components/hub/select.tsx");
});

test("hover hints are the hub's own: no title tooltip on an element", async () => {
  const offenders = [];
  for (const path of await hubSources()) {
    const text = await source(path);
    for (const match of text.matchAll(/\stitle=/g)) {
      const before = text.slice(0, match.index);
      const tag = (before.slice(before.lastIndexOf("<") + 1).match(/^([A-Za-z][\w.]*)/) || [])[1] ?? "";
      // Components take title as a prop (Modal, PanelSection …); only lowercase DOM tags would show the browser's box.
      if (/^[a-z]/.test(tag)) offenders.push(`${path}: <${tag}>`);
    }
  }
  assert.deepEqual(offenders, [], "use data-tip (components/hub/tooltip.tsx) instead of title");
});

test("one hint layer for the whole hub, in the top layer and never on phones", async () => {
  const shell = await source("components/hub/app-shell.tsx");
  assert.match(shell, /<TooltipLayer \/>/);
  const layer = await source("components/hub/tooltip.tsx");
  assert.match(layer, /tip\.setAttribute\("popover", "manual"\)/, "above lists, panels and dialogs");
  assert.match(layer, /const DELAY = 400;/);
  assert.match(layer, /event\.pointerType === "touch"/, "taps show no hint");
  assert.match(layer, /title\.textContent = textOf\(element\)/, "text, never HTML: hints can carry file names");
  assert.match(layer, /element\.closest\("dialog\[open\]"\)/, "inside an open dialog the hint belongs to it");
  const css = await source("app/glass.css");
  assert.match(css, /\.hub-tip \{ position: fixed;[^}]*background: var\(--tip-bg\);[^}]*font-family: var\(--font-text\);/);
  assert.match(css, /@media \(hover: none\) \{\s*\.hub-tip \{ display: none !important; \}/);
});

test("lists float above everything, keep their keys to themselves and become a sheet on phones", async () => {
  const select = await source("components/hub/select.tsx");
  assert.match(select, /popover=\{floating \? "auto" : undefined\}/, "the browser closes it on Escape and a click elsewhere");
  assert.match(select, /popoverTarget=\{floating \? popId : undefined\}/, "the field opens and closes it");
  assert.match(select, /role="combobox"/);
  assert.match(select, /role="listbox"/);
  assert.match(select, /case "Escape":[^]*?event\.stopPropagation\(\);/, "Escape closes the list, not the dialog or panel around it");
  assert.match(select, /const take = \(\) => \{ event\.preventDefault\(\); event\.stopPropagation\(\); \};/, "Enter picks, it does not save a dialog");
  assert.match(select, /if \(!\(event\.target instanceof HTMLInputElement\)\) event\.preventDefault\(\);/, "a click in the list does not reach a surrounding label");
  const css = await source("app/glass.css");
  assert.match(css, /--menu-bg: var\(--sheet\); --menu-radius: 12px;/, "proposal A: the white sheet of the tables");
  assert.match(css, /\.hub-option\[aria-selected="true"\] \.hub-option-check \{ visibility: visible; \}/, "the choice carries a tick");
  assert.match(css, /@media \(max-width: 767px\) \{\s*\.hub-list\[popover\]:not\(\.is-suggest\) \{ left: 8px !important;[^}]*bottom: calc\(8px \+ env\(safe-area-inset-bottom\)\);/, "phones: a sheet at the bottom");
  // The menus that existed before take the same surface.
  for (const menu of [".sheet-pop", ".am-more-menu", ".sidebar-account-menu"]) {
    assert.match(css, new RegExp(`\\${menu} \\{[^}]*background: var\\(--menu-bg\\);[^}]*\\}`), menu);
  }
});

test("filters and sorting use the hub's list", async () => {
  const tools = await source("components/hub/table-tools.tsx");
  assert.match(tools, /<Select variant="bare" chevron label=\{name\} value=\{value\} onChange=\{onChange\} options=\{options\} \/>/);
  assert.match(tools, /<Select variant="bare" chevron label="Sortieren nach"/);
  assert.match(await source("components/hub/sheet.tsx"), /className="sheet-choice"[^\n]*<Check className="hub-option-check"/, "group choices carry the same tick");
});
