import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the chat entry opens the service platform from one shared URL in a new tab", async () => {
  const navigation = await source("components/hub/navigation.ts");
  assert.match(navigation, /href: SERVICE_PLATFORM_URL, label: "Chat"/);
  assert.match(navigation, /target: "_blank", rel: "noopener noreferrer"/);
  const sidebar = await source("components/hub/glass-sidebar.tsx");
  assert.match(sidebar, /href=\{chatNavigation\.href\} \{\.\.\.newTabLinkProps\}/);
  assert.match(sidebar, /\(öffnet in neuem Tab\)/);
  // On phones and tablets the chat sits under "Mehr", as a row that opens a new tab.
  assert.match(await source("components/hub/screens/workspace.tsx"), /<ListRow compact external href=\{chatNavigation\.href\}/);
  const list = await source("components/hub/list.tsx");
  assert.match(list, /<a href=\{href\} \{\.\.\.newTabLinkProps\}/);
  assert.match(list, /\(öffnet in neuem Tab\)/);
  // The URL lives only in lib/service-packages.ts; no component repeats it.
  for (const path of ["components/hub/navigation.ts", "components/hub/glass-sidebar.tsx", "components/hub/glass-tab-bar.tsx", "components/hub/cards.tsx"]) {
    assert.doesNotMatch(await source(path), /service\.oalab\.de/, path);
  }
});

test("the tab bar below 1024 px has five entries: Übersicht, Projekte, Dateien, Kalender and Mehr", async () => {
  const navigation = await source("components/hub/navigation.ts");
  const start = navigation.indexOf("export const tabNavigation");
  const tabs = navigation.slice(start, navigation.indexOf("];", start));
  assert.match(tabs, /mainNavigation\[0\],/);
  assert.match(tabs, /\["projects", "files", "calendar"\]/);
  assert.match(tabs, /\{ section: "discover", label: "Mehr", icon: Ellipsis \}/);
  assert.match(await source("lib/hub-data.ts"), /discover: "Mehr"/);
  const tabBar = await source("components/hub/glass-tab-bar.tsx");
  assert.match(tabBar, /tabNavigation\.map/);
  assert.doesNotMatch(tabBar, /tab-search/, "no separate search button any more");
  // Bell, assistant and profile move into the top row, so page titles keep the whole width on phones.
  assert.match(await source("components/hub/app-shell.tsx"), /<div className="topbar-actions"><HeaderActions \/>/);
  assert.match(await source("app/glass.css"), /\.large-title-actions \{ display: none; \}/);
});
