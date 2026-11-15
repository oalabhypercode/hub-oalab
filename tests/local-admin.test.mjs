import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { localAdminEmail } from "../lib/local-admin.ts";
import { devPlan } from "../scripts/lib/dev-plan.mjs";

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

test("local admin: npm run dev binds to loopback only together with the switch", () => {
  const admin = { HUB_LOCAL_ADMIN_EMAIL: "info@oalab.de" };
  assert.deepEqual(devPlan(admin, []).args, ["dev", "-H", "127.0.0.1"]);
  assert.equal(devPlan(admin, []).bind, "127.0.0.1");
  assert.deepEqual(devPlan({}, ["-p", "3005"]).args, ["dev", "-p", "3005"]);
  assert.equal(devPlan({}, []).bind, undefined);
  assert.equal(devPlan({ HUB_LOCAL_ADMIN_EMAIL: "  " }, []).bind, undefined);
  for (const own of [["-H", "0.0.0.0"], ["--hostname", "0.0.0.0"], ["--hostname=0.0.0.0"]]) {
    const plan = devPlan(admin, own);
    assert.equal(plan.bind, undefined);
    assert.equal(plan.adminOff, true);
    assert.deepEqual(plan.args, ["dev", ...own]);
  }
  assert.equal(devPlan(admin, ["-p", "3005"]).port, "3005");
  assert.equal(devPlan(admin, ["--port=3006"]).port, "3006");
  assert.equal(devPlan(admin, [], "3007").port, "3007");
  assert.equal(devPlan({ HUB_LOCAL_TUNNEL_SCRIPT: " /x/hub-lokal.sh " }, []).tunnel, "/x/hub-lokal.sh");
  assert.equal(devPlan({}, []).tunnel, null);
});

test("local admin: wired into dev, proxy and auth, admins only, never in a versioned env file", async () => {
  const pkg = JSON.parse(await source("package.json"));
  assert.equal(pkg.scripts.dev, "node scripts/dev.mjs");
  assert.equal(pkg.scripts["dev:admin"], undefined);
  const dev = await source("scripts/dev.mjs");
  assert.match(dev, /if \(plan\.bind\) env\.HUB_LOCAL_ADMIN_BIND = plan\.bind;\nelse delete env\.HUB_LOCAL_ADMIN_BIND;/);
  assert.match(await source("lib/supabase/proxy.ts"), /claims === null && pageVisit && usesOwnPlatform\(\) \? localAdminEmail\(request\.headers\.get\("host"\)\)/);
  assert.match(await source("lib/platform/auth.ts"), /async signInLocalAdmin[\s\S]{0,300}app_role !== "oalab_admin"\) return false/);
  assert.match(await source(".gitignore"), /^\.env\*$/m);
  assert.doesNotMatch(await source(".env.example"), /^HUB_LOCAL_(?:ADMIN_EMAIL|ADMIN_BIND|TUNNEL_SCRIPT)=/m);
});
