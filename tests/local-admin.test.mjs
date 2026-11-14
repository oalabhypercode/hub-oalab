import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { localAdminEmail } from "../lib/local-admin.ts";

const source = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const local = { HUB_LOCAL_ADMIN_EMAIL: " Info@OALab.de ", NODE_ENV: "development", HUB_LOCAL_ADMIN_BIND: "127.0.0.1" };

test("local admin: only next dev bound to loopback, on a loopback host, with the address from .env.local", () => {
  for (const host of ["localhost:3001", "127.0.0.1:3001", "hub.oalab.localhost:3001", "LOCALHOST"]) assert.equal(localAdminEmail(host, local), "info@oalab.de");
  for (const host of ["hub.oalab.de", "192.168.1.20:3001", "localhost.oalab.de", "evil-localhost.com", "", null, undefined]) assert.equal(localAdminEmail(host, local), null);
  assert.equal(localAdminEmail("localhost:3001", { ...local, HUB_LOCAL_ADMIN_EMAIL: "" }), null);
  assert.equal(localAdminEmail("localhost:3001", { ...local, NODE_ENV: "production" }), null);
  assert.equal(localAdminEmail("localhost:3001", { ...local, HUB_LOCAL_ADMIN_BIND: undefined }), null);
  assert.equal(localAdminEmail("localhost:3001", { ...local, HUB_LOCAL_ADMIN_BIND: "0.0.0.0" }), null);
});

test("local admin: dev:admin binds to loopback, admins only, never in a versioned env file", async () => {
  const pkg = JSON.parse(await source("package.json"));
  assert.match(pkg.scripts["dev:admin"], /HUB_LOCAL_ADMIN_BIND=127\.0\.0\.1 next dev -H 127\.0\.0\.1\b/);
  assert.match(await source("lib/supabase/proxy.ts"), /claims === null && pageVisit && usesOwnPlatform\(\) \? localAdminEmail\(request\.headers\.get\("host"\)\)/);
  assert.match(await source("lib/platform/auth.ts"), /async signInLocalAdmin[\s\S]{0,300}app_role !== "oalab_admin"\) return false/);
  assert.match(await source(".gitignore"), /^\.env\*$/m);
  assert.doesNotMatch(await source(".env.example"), /^HUB_LOCAL_ADMIN_(?:EMAIL|BIND)=/m);
});
