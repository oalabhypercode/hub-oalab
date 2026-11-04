import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { groundForPixels } from "../lib/hub-logos/ground.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

/** RGBA pixels from [pixel, count] parts, the way a canvas hands them out. */
const image = (parts) => Uint8ClampedArray.from(parts.flatMap(([pixel, count]) => Array.from({ length: count }, () => pixel).flat()));
const white = [255, 255, 255, 255];
const clear = [0, 0, 0, 0];

test("a light logo on a see-through ground gets the dark ground, everything else the light one", () => {
  assert.equal(groundForPixels(image([[white, 30], [clear, 70]])), "dark", "a white logo");
  assert.equal(groundForPixels(image([[[22, 33, 62, 255], 30], [clear, 70]])), "light", "a dark logo");
  assert.equal(groundForPixels(image([[white, 95], [clear, 5]])), "light", "hardly see-through: a white picture");
  assert.equal(groundForPixels(image([[[180, 170, 160, 255], 100]])), "light", "a photo");
  assert.equal(groundForPixels(image([[clear, 100]])), "light", "nothing visible");
  assert.equal(groundForPixels(new Uint8ClampedArray()), "light");
});

test("both ways open the same logo window: asset management and user management (user 4.11.2026)", async () => {
  const am = await source("components/hub/screens/asset-management.tsx");
  assert.match(am, /\{canUpload && <button type="button" className="sheet-action am-logo-button" onClick=\{\(\) => setLogoFor\(current\.id\)\}/);
  assert.match(am, /<span className="am-logo-text">\{current\.logo \? "Logo ändern" : "Logo hochladen"\}<\/span>/);
  assert.match(am, /<CustomerLogoDialog customer=\{logoRow\.customer\} onClose=/);
  const um = await source("components/hub/screens/users-dialogs.tsx");
  assert.match(um, /<div className="customer-logo-row">/);
  assert.match(um, /\{customer && logoOpen && <CustomerLogoDialog customer=\{customer\} onClose=/);
  const users = await source("components/hub/screens/users.tsx");
  assert.equal((users.match(/<LogoMark logo=\{customer\.logo\} initials=\{companyMark\(customer\.company\)\} className="company-mark" \/>/g) ?? []).length, 2, "in the logins and in the customers");
  await assert.rejects(stat(new URL("../components/hub/screens/asset-logo.tsx", import.meta.url)), "the old window is gone");
});

test("the user management shows the same logos as the asset management", async () => {
  const server = await source("lib/hub-users/server.ts");
  assert.match(server, /loadCustomerLogos\(db\)\.catch\(\(\) => new Map/, "a failure only leaves the letters");
  assert.match(server, /logo: logos\.get\(row\.id\) \?\? null,/);
});

test("the window: one zone to drop, choose or paste, the customer's images, a ground chosen to fit, two buttons", async () => {
  const window = await source("components/hub/customer-logo-dialog.tsx");
  assert.match(window, /onDrop=\{\(event\) => \{ event\.preventDefault\(\); setDragging\(false\); pick\(event\.dataTransfer\.files\[0\]\); \}\}/);
  assert.match(window, /document\.addEventListener\("paste", paste\);/);
  assert.match(window, /listLogoCandidates\(customer\.id\)/);
  assert.match(window, /const ground = await detectLogoGround\(url\);\r?\n\s+if \(ground && latest\.current === url\)/, "the last image picked wins");
  assert.match(window, /<LogoMark logo=\{preview\} initials=\{companyInitials\(customer\.company\)\} className="avatar welcome-company-logo" plate \/>/, "the preview is the customer's company row");
  assert.match(window, /\{current && !choice && \(/, "removing only with a logo and nothing new chosen");
  assert.match(window, />Abbrechen<\/button>/);
  assert.match(window, /\/>\}Speichern<\/button>/);
  const css = await source("app/glass.css");
  assert.match(css, /\.hub-modal\.logo-window \{ width: min\(480px, calc\(100% - 32px\)\); \}/);
  assert.doesNotMatch(css, /\.am-logo-dialog|\.am-thumb|\.am-bg-choice/, "the old window's styles are gone");
  assert.match(css, /\.am-zone \{/, "the upload panel keeps its zone");
});

test("listing a customer's images checks for an admin first", async () => {
  const actions = await source("lib/hub-logos/actions.ts");
  assert.match(actions, /export async function listLogoCandidates\(customerId: string\): .* \{\r?\n\s+const session = await adminSession\(\);\r?\n\s+if \(!session\) return denied;/);
});
