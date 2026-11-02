import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("conversations live under Nachrichten: no separate Chat link to the service platform any more", async () => {
  // Since 2 November 2026 the service platform's conversations are the chat in Nachrichten.
  assert.doesNotMatch(await source("components/hub/navigation.ts"), /chatNavigation|label: "Chat"/);
  for (const path of ["components/hub/glass-sidebar.tsx", "components/hub/screens/workspace.tsx"]) {
    assert.doesNotMatch(await source(path), /chatNavigation/, path);
  }
  // Rows that open another site still say that they open a new tab.
  assert.match(await source("components/hub/navigation.ts"), /target: "_blank", rel: "noopener noreferrer"/);
  const list = await source("components/hub/list.tsx");
  assert.match(list, /<a href=\{href\} \{\.\.\.newTabLinkProps\}/);
  assert.match(list, /\(öffnet in neuem Tab\)/);
  // The service platform's address lives only in lib/service-packages.ts; no component repeats it.
  for (const path of ["components/hub/navigation.ts", "components/hub/glass-sidebar.tsx", "components/hub/glass-tab-bar.tsx", "components/hub/cards.tsx", "components/hub/screens/conversations.tsx"]) {
    assert.doesNotMatch(await source(path), /service\.oalab\.de/, path);
  }
});

test("the tab bar below 1024 px has five entries: Übersicht, Dateien, Nachrichten, Kalender and Mehr", async () => {
  const navigation = await source("components/hub/navigation.ts");
  const start = navigation.indexOf("export const tabNavigation");
  const tabs = navigation.slice(start, navigation.indexOf("];", start));
  assert.match(tabs, /mainNavigation\[0\],/);
  // Since 2 November 2026 the conversations have a tab of their own; Projekte moved to "Mehr".
  assert.match(tabs, /\["files", "messages", "calendar"\]/);
  assert.match(tabs, /\{ section: "discover", label: "Mehr", icon: Ellipsis \}/);
  assert.match(await source("lib/hub-data.ts"), /discover: "Mehr"/);
  const tabBar = await source("components/hub/glass-tab-bar.tsx");
  assert.match(tabBar, /tabNavigation\.map/);
  assert.doesNotMatch(tabBar, /tab-search/, "no separate search button any more");
  // Nachrichten carries the unread count.
  assert.match(tabBar, /className="tab-badge"/);
  assert.match(await source("components/hub/app-shell.tsx"), /<GlassTabBar [^\n]*badges=\{\{ messages: /);
  // Bell, assistant and profile move into the top row, so page titles keep the whole width on phones.
  assert.match(await source("components/hub/app-shell.tsx"), /<div className="topbar-actions"><HeaderActions \/>/);
  assert.match(await source("app/glass.css"), /\.large-title-actions \{ display: none; \}/);
});

test("below 1024 px the name stays on the left and the logo alone sits in the middle of the top row", async () => {
  // Wish of 2 November 2026, on every device with the tab bar.
  const shell = await source("components/hub/app-shell.tsx");
  assert.match(shell, /className="topbar-brand" aria-label="oalab Client Hub – Übersicht"><span className="topbar-brand-text" aria-hidden="true">/);
  assert.match(shell, /className="topbar-logo" tabIndex=\{-1\} aria-hidden="true"><span className="brand-tile"><BrandLogo \/><\/span><\/Link>/);
  const css = await source("app/glass.css");
  // Equal side columns keep the logo in the middle of the screen, whatever the name and the buttons need.
  assert.match(css, /\.hub-topbar \{ display: grid; grid-template-columns: 1fr auto 1fr;/);
  assert.match(css, /\.topbar-logo \{ grid-column: 2;/);
  assert.match(css, /\.hub-topbar \.hub-notice \{ grid-column: 1 \/ -1;/);
});
