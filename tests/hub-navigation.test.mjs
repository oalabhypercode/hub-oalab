import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the chat entry opens the service platform from one shared URL in a new tab", async () => {
  const navigation = await source("components/hub/navigation.ts");
  assert.match(navigation, /href: SERVICE_PLATFORM_URL, label: "Chat"/);
  assert.match(navigation, /target: "_blank", rel: "noopener noreferrer"/);
  for (const path of ["components/hub/glass-sidebar.tsx", "components/hub/glass-tab-bar.tsx"]) {
    const component = await source(path);
    assert.match(component, /href=\{chatNavigation\.href\} \{\.\.\.newTabLinkProps\}/, path);
    assert.match(component, /\(öffnet in neuem Tab\)/, path);
  }
  // The URL lives only in lib/service-packages.ts; no component repeats it.
  for (const path of ["components/hub/navigation.ts", "components/hub/glass-sidebar.tsx", "components/hub/glass-tab-bar.tsx", "components/hub/cards.tsx"]) {
    assert.doesNotMatch(await source(path), /service\.oalab\.de/, path);
  }
});
