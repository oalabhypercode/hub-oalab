import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canBeLogo, checkLogoFile, cleanLogoColor, isLogoPathOf, logoTypeOf, MAX_LOGO_BYTES, newLogoPath } from "../lib/hub-logos/rules.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8").then((text) => text.replace(/\r\n/g, "\n"));
const customer = "0b5d2f4e-8c1a-4d3e-9f20-1a2b3c4d5e6f";
const other = "7f6e5d4c-3b2a-4190-8f7e-6d5c4b3a2918";

test("a logo is an SVG, PNG, JPG or WebP of at most 2 MB; an empty browser type falls back to the name", () => {
  assert.deepEqual(checkLogoFile("logo.svg", 811, "image/svg+xml"), { ok: true, type: "image/svg+xml" });
  assert.deepEqual(checkLogoFile("Logo.SVG", 811, ""), { ok: true, type: "image/svg+xml" });
  assert.deepEqual(checkLogoFile("logo.jpeg", 2048, "application/octet-stream"), { ok: true, type: "image/jpeg" });
  assert.equal(logoTypeOf("logo.png", "text/plain"), null);
  assert.equal(checkLogoFile("logo.gif", 2048, "image/gif").ok, false);
  assert.equal(checkLogoFile("logo.png", 0, "image/png").ok, false);
  assert.equal(checkLogoFile("logo.png", MAX_LOGO_BYTES + 1, "image/png").ok, false);
  assert.equal(canBeLogo({ fileName: "Vertrag.pdf", mimeType: "application/pdf", sizeBytes: 1200 }), false);
  assert.equal(canBeLogo({ fileName: "Logo-Datei.svg", mimeType: "image/svg+xml", sizeBytes: 811 }), true);
});

test("a logo lives in its customer's own folder, the path the migration accepts", () => {
  const path = newLogoPath(customer, "image/png");
  assert.match(path, new RegExp(`^logos/${customer}/[0-9a-f-]{36}\\.png$`));
  assert.equal(isLogoPathOf(path, customer), true);
  assert.equal(isLogoPathOf(path, other), false);
  assert.equal(isLogoPathOf(`files/${customer}/x.png`, customer), false);
  assert.throws(() => newLogoPath("../other", "image/png"));
  assert.equal(cleanLogoColor("#7E004B"), "#7e004b");
  assert.equal(cleanLogoColor("0f1b2d"), "#0f1b2d");
  assert.equal(cleanLogoColor("#fff"), null);
});

test("logos are read on their own, so a missing migration never breaks the account or the files", async () => {
  const users = await source("lib/hub-users/server.ts");
  assert.doesNotMatch(users, /logo_/);
  const logos = await source("lib/hub-logos/server.ts");
  assert.match(logos, /const rows = error \? \[\] :/);
  assert.match(logos, /if \(signed\.error \|\| !signed\.data\) return logos;/);
  // Customers get only their own customer's logo, signed with their own session; admins keep their initials.
  assert.match(logos, /if \(identity\.publicDemo \|\| identity\.demoAccess \|\| !customerId \|\| identity\.account\?\.role === "oalab_admin"\) return null;/);
  const files = await source("lib/hub-files/server.ts");
  assert.match(files, /canManage \? loadCustomerLogos\(supabase\) : new Map<string, CustomerLogo>\(\)/);
});

test("every logo action checks for an active admin in the database before anything else", async () => {
  const actions = await source("lib/hub-logos/actions.ts");
  assert.match(actions, /^"use server";/);
  assert.match(actions, /const admin = await verifyHubAdmin\(\);/);
  const bodies = actions.split("\nexport async function ").slice(1);
  assert.equal(bodies.length, 3);
  assert.equal((actions.match(/^export /gm) ?? []).length, 3);
  for (const body of bodies) assert.match(body, /^\w+\([\s\S]*?\{\n {2}const session = await adminSession\(\);\n {2}if \(!session\) return denied;/, body.slice(0, 30));
  // A file becomes a logo only if it belongs to that customer, and keeps the type it was saved with.
  assert.match(actions, /\.eq\("hub_file_assignments\.customer_id", customerId\)/);
  assert.match(actions, /upload\(path, bytes\.data, \{ contentType: check\.type, upsert: false \}\)/);
  // The previous image is deleted, which also ends the links handed out for it.
  assert.match(actions, /if \(previous && previous !== path\) await supabase\.storage\.from\(LOGO_BUCKET\)\.remove\(\[previous\]\);/);
});

test("the logo replaces the initials in the customer's login and in the Asset Management; the sidebar counts real files", async () => {
  const layout = await source("app/dashboard/layout.tsx");
  assert.match(layout, /countFilesForIdentity\(identity\),\n.*\n {4}loadAccountLogo\(identity\),/);
  assert.match(layout, /fileCount=\{fileCount\} accountLogo=\{accountLogo\}/);
  const shell = await source("components/hub/app-shell.tsx");
  assert.match(shell, /files: hasDemo \? files\.length : fileCount \?\? 0/);
  assert.match(shell, /const logo = live && !account\.admin \? accountLogo : null;/);
  assert.match(shell, /<MobileAvatar href=\{hubHref\(preview, "settings"\)\} initials=\{initials\} logo=\{logo\} \/>/);
  assert.match(await source("components/hub/glass-sidebar.tsx"), /<LogoMark logo=\{logo\} initials=\{initials\} className="avatar" \/>/);
  assert.match(await source("components/hub/cards.tsx"), /<LogoMark logo=\{logo\} initials=\{initials\} className="avatar welcome-avatar" \/>/);
  // A link that ran out shows the initials again instead of a broken image.
  assert.match(await source("components/hub/logo-mark.tsx"), /onError: \(\) => \{ if \(logo\) setFailed\(logo\.url\); \}/);
  const screen = await source("components/hub/screens/asset-management.tsx");
  assert.match(screen, /\{canUpload \? \(\n\s*<button type="button" className="am-sign-edit" onClick=\{\(\) => setLogoFor\(current\.id\)\}/);
  assert.match(screen, /<CustomerSign customer=\{file\.customers\[0\]\} logo=\{logos\.get\(file\.customers\[0\]\.id\)\}/);
  const css = await source("app/glass.css");
  assert.match(css, /\.hub-app \.has-logo \{ overflow: hidden; background: var\(--logo-bg, #ffffff\);/);
  assert.match(css, /\.hub-app \.mobile-avatar\.has-logo \{ border-radius: 11px; background: var\(--logo-bg, #ffffff\);/);
});
