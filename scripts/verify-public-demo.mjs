import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { request as httpRequest } from "node:http";

// Public fixture tests never read the local credential file or Supabase secret.
const local = process.argv.includes("--local");
// SMOKE_PORT lets the local run avoid a port another app already uses.
const port = /^\d{2,5}$/.test(process.env.SMOKE_PORT ?? "") ? process.env.SMOKE_PORT : "3001";
const base = new URL(local ? `http://127.0.0.1:${port}` : "https://oalab-client-hub.vercel.app");
const origin = local ? "https://demo.oalab.test" : base.origin;
const blueprint = JSON.parse(await readFile(new URL("../config/demo-accounts.json", import.meta.url), "utf8"));
let server;

async function request(path, options = {}) {
  // Node's fetch replaces Host; HTTP transport is needed only for local host-policy tests.
  if (local) return new Promise((resolve, reject) => {
    const call = httpRequest(new URL(path, base), { method: options.method, headers: { host: new URL(origin).host, ...options.headers }, signal: AbortSignal.timeout(30000) }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => {
        const headers = new Headers();
        for (let i = 0; i < response.rawHeaders.length; i += 2) headers.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
        resolve(new Response(response.statusCode === 204 ? null : Buffer.concat(chunks), { status: response.statusCode, headers }));
      });
    });
    call.on("error", reject);
    call.end(options.body);
  });
  return fetch(new URL(path, base), {
    ...options, redirect: "manual", signal: AbortSignal.timeout(30000),
    headers: { ...(local ? { host: new URL(origin).host } : {}), ...options.headers },
  });
}
async function page(path, cookie) {
  const response = await request(path, { headers: cookie ? { cookie } : {} });
  assert.equal(response.status, 200, `Page unavailable: ${path}`);
  return response.text();
}
async function rejected(cookie) {
  const response = await request("/dashboard/projects", { headers: cookie ? { cookie } : {} });
  assert.ok([302, 303, 307, 308].includes(response.status), "Missing or forged fixture sessions must redirect.");
  assert.equal(new URL(response.headers.get("location"), base).pathname, "/auth/login");
}
async function post(body, requestOrigin = origin, extraHeaders = {}) {
  return request("/auth/demo", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...(requestOrigin ? { origin: requestOrigin } : {}), ...extraHeaders }, body });
}

try {
  if (local) {
    const env = { ...process.env, ENABLE_PUBLIC_DEMO_LOGIN: "true", PUBLIC_DEMO_ORIGIN: origin, OALAB_DEMO_SESSION_SECRET: randomBytes(32).toString("hex") };
    const next = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
    const build = spawnSync(process.execPath, [next, "build"], { env, stdio: "inherit" });
    assert.equal(build.status, 0, "Public-demo production build failed.");
    server = spawn(process.execPath, [next, "start", "--port", port, "--hostname", "127.0.0.1"], { env, stdio: ["ignore", "pipe", "pipe"] });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) throw new Error("Local test server exited before startup.");
      try { if ((await request("/")).status === 200) { ready = true; break; } } catch {}
      await setTimeout(200);
    }
    assert.ok(ready, "Local test server did not become ready.");
  }
  for (const path of ["/", "/auth/login"]) {
    const html = await page(path);
    assert.equal((html.match(/class="demo-login-card(?: demo-login-card-admin)?"/g) || []).length, 4, "Four demo cards must be rendered.");
    assert.ok(html.includes("Öffentliche Demo"));
  }
  await rejected();
  await rejected("__Host-oalab-demo=forged.invalid");
  assert.equal((await post("account=admin", "https://evil.test")).status, 403);
  assert.equal((await post("account=admin", null)).status, 403);
  assert.equal((await post("account=unknown")).status, 400);
  assert.equal((await post("account=admin&account=nordlicht")).status, 400);
  if (local) {
    const otherHost = await request("/", { headers: { host: "preview.oalab.test" } });
    assert.ok(!(await otherHost.text()).includes("Direkt in die Demo"));
    assert.equal((await post("account=admin", origin, { host: "preview.oalab.test" })).status, 404);
    assert.equal((await post("account=admin", origin, { "x-forwarded-host": "evil.test" })).status, 404);
  }

  for (const account of blueprint.accounts) {
    const id = account.workspace ?? "admin";
    const login = await post(`account=${id}`);
    assert.equal(login.status, 303, `Demo entry failed: ${id}`);
    assert.equal(login.headers.get("location"), `${origin}/dashboard`);
    const cookies = login.headers.getSetCookie();
    assert.equal(cookies.length, 1, "Public demo must not issue Supabase cookies.");
    const cookie = cookies[0].split(";")[0];
    assert.match(cookie, /^__Host-oalab-demo=/);
    assert.match(cookies[0], /HttpOnly/i);
    assert.match(cookies[0], /Secure/i);
    assert.match(cookies[0], /SameSite=lax/i);
    const projects = await page("/dashboard/projects", cookie);
    const files = await page("/dashboard/files", cookie);
    const expectedProjects = account.role === "oalab_admin" ? 9 : 3;
    const expectedFiles = account.role === "oalab_admin" ? 6 : 2;
    assert.equal((projects.match(/class="project-card"/g) || []).length, expectedProjects);
    assert.equal((files.match(/class="file-row"/g) || []).length, expectedFiles);
    assert.ok(projects.includes("Öffentliche Demo"));
    for (const customer of blueprint.accounts.filter((item) => item.role === "oalab_customer")) {
      assert.equal(projects.includes(`${customer.workspace}-website-relaunch`), account.role === "oalab_admin" || account.workspace === customer.workspace);
    }
    if (account.role === "oalab_customer") {
      const foreign = blueprint.accounts.find((item) => item.workspace && item.workspace !== account.workspace);
      const attempted = await page(`/dashboard/projects?workspace=${foreign.workspace}&project=${foreign.workspace}-website-relaunch`, cookie);
      assert.equal((attempted.match(/class="project-card"/g) || []).length, 3);
      assert.ok(!attempted.includes('class="project-modal-title"'));
    }
    const settings = await page("/dashboard/settings", cookie);
    assert.ok(settings.includes("Du testest die öffentliche Demo."));
    assert.ok(!settings.includes("Passwort zurücksetzen"));
    const protectedRoute = await request("/protected", { headers: { cookie } });
    assert.equal(new URL(protectedRoute.headers.get("location"), base).pathname, "/auth/login", "Fixture identity must not bypass real-auth-only routes.");
    const logout = await request("/auth/demo/logout", { method: "POST", headers: { cookie, origin } });
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get("set-cookie"), /Max-Age=0/i);
    await rejected();
    console.log(`OK: ${id} – ${expectedProjects} projects, ${expectedFiles} file fixtures; isolated session and logout.`);
  }
  console.log("OK: All four public demo identities, host/origin checks and real-auth boundary verified.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  server?.kill();
}
