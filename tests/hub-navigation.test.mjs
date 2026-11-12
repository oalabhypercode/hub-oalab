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

test("the profile corner shows sign, name and package, and one gear opens Profil, Darstellung and Abmelden", async () => {
  // Wish of 2 November 2026: nothing floats over the name any more; Abmelden moved into the gear's menu.
  const sidebar = await source("components/hub/glass-sidebar.tsx");
  assert.doesNotMatch(sidebar, /sidebar-profile-actions|sidebar-icon-button/);
  assert.match(sidebar, /className="sidebar-account-gear" aria-haspopup="menu" aria-expanded=\{menuOpen\}/);
  assert.match(sidebar, /role="menu" aria-label="Konto"/);
  for (const label of [">Profil<", ">Darstellung<"]) assert.ok(sidebar.includes(label), label);
  assert.match(sidebar, /\{preview \? "Vorschau verlassen" : "Abmelden"\}<\/button>/);
  assert.match(sidebar, /const meta = activePackages \|\| \(account\.admin \? "oalab-Team" : account\.freelancer \? "Freelancer" : ""\);/);
  assert.match(await source("app/glass.css"), /\.sidebar-account-gear::before \{ content: ""; position: absolute; left: -7px;/);
});

test("on tablets the logo alone sits in the middle of the top row; phones keep logo and name together on the left", async () => {
  // Wish of 2 November 2026: centred on tablets only. The logo stays part of the link home.
  assert.match(await source("components/hub/app-shell.tsx"), /className="topbar-brand" aria-label="oalab Client Hub – Übersicht"><span className="brand-tile"><BrandLogo \/><\/span><span className="topbar-brand-text"/);
  const css = await source("app/glass.css");
  const start = css.indexOf("@media (min-width: 768px) and (max-width: 1023px) {");
  assert.ok(start > 0, "a block for tablets only");
  const tablet = css.slice(start).split(/\r?\n\}\r?\n/)[0];
  assert.match(tablet, /\.topbar-brand \.brand-tile \{ position: absolute; top: 4px; left: calc\(50% - 18px\); \}/);
  assert.match(tablet, /\.hub-topbar \.hub-notice \{ order: 3; flex: 1 1 100%; \}/);
});

test("on tablets signing out sits top right next to the profile; phones and computers keep their ways", async () => {
  // Wish of 5 November 2026: tablets hide the sidebar with its gear menu, so signing out was only in Profil.
  const shell = await source("components/hub/app-shell.tsx");
  assert.match(shell, /<MobileAvatar href=\{hubHref\(preview, "settings"\)\} initials=\{initials\} logo=\{logo\} \/><button type="button" className="glass glass-float glass-button topbar-signout" aria-label=\{signOutLabel\} data-tip=\{signOutLabel\} onClick=\{signOut\} disabled=\{signingOut\}>/);
  assert.match(shell, /const signOutLabel = preview \? "Vorschau verlassen" : "Abmelden";/);
  // A failed attempt is shown in the top row, except on Profil, which has its own message.
  assert.match(shell, /\{logoutError && section !== "settings" && <p role="alert" className="form-error topbar-signout-error">/);
  const css = await source("app/glass.css");
  assert.match(css, /\n\.topbar-actions \.topbar-signout, \.hub-topbar \.topbar-signout-error \{ display: none; \}/);
  const start = css.indexOf("@media (min-width: 768px) and (max-width: 1023px) {");
  const tablet = css.slice(start).split(/\r?\n\}\r?\n/)[0];
  assert.match(tablet, /\.topbar-actions \.topbar-signout \{ display: inline-flex; \}/);
  assert.match(tablet, /\.hub-topbar \.topbar-signout-error \{ display: block; order: 4; flex: 1 1 100%; margin: 0; \}/);
});

test("changes refresh the browser only: nothing purges the server's prerendered page shells (10.11.2026)", async () => {
  const helper = await source("lib/refresh-workspace.ts");
  assert.match(helper, /import \{ refresh \} from "next\/cache";/);
  assert.match(helper, /export function refreshWorkspace\(\) \{\s+refresh\(\);\s+\}/);
  // revalidatePath("/dashboard", "layout") made Next.js rebuild the /dashboard/[section] shells at runtime, which fails:
  // every subpage answered 500 on a full load until the next deployment.
  const { readdir } = await import("node:fs/promises");
  for (const dir of ["app", "lib", "components"]) {
    const files = (await readdir(new URL(`../${dir}`, import.meta.url), { recursive: true })).filter((file) => /\.(ts|tsx)$/.test(file));
    for (const file of files) {
      const path = `${dir}/${file.replaceAll("\\", "/")}`;
      assert.doesNotMatch(await source(path), /\b(revalidatePath|revalidateTag|updateTag)\(/, path);
    }
  }
});
