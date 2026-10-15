import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createServerClient } from "@supabase/ssr";

const env = parseEnv((await readFile(new URL("../.env.local", import.meta.url), "utf8")).replace(/^\uFEFF/, ""));
const blueprint = JSON.parse(await readFile(new URL("../config/demo-accounts.json", import.meta.url), "utf8"));
const credentials = JSON.parse(await readFile(new URL("../.demo-accounts.local.json", import.meta.url), "utf8"));
const base = new URL(process.env.DEMO_BASE_URL || "http://127.0.0.1:3000");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(base.hostname), "Smoke-Tests dürfen Session-Cookies nur an den lokalen Entwicklungsserver senden.");
assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname, `${blueprint.projectRef}.supabase.co`);
assert.equal(credentials.projectRef, blueprint.projectRef);

async function page(path, jar) {
  const response = await fetch(new URL(path, base), {
    redirect: "manual",
    headers: { Cookie: [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ") },
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200, `Die authentifizierte Seite ${path} muss erreichbar sein.`);
  return response.text();
}

try {
  for (const account of blueprint.accounts) {
    const local = credentials.accounts.find((item) => item.email === account.email && item.userId);
    assert.ok(local?.password, `Lokale Test-Zugangsdaten fehlen für ${account.email}.`);
    const jar = new Map();
    const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      cookies: {
        getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
        setAll: (cookies) => cookies.forEach(({ name, value }) => value ? jar.set(name, value) : jar.delete(name)),
      },
    });
    const { error } = await supabase.auth.signInWithPassword({ email: account.email, password: local.password });
    assert.equal(error, null, `Anmeldung fehlgeschlagen: ${account.email}`);
    try {
      const projects = await page("/dashboard/projects", jar);
      const expectedProjects = account.role === "oalab_admin" ? 9 : 3;
      assert.equal((projects.match(/class="project-card"/g) || []).length, expectedProjects, `Falsche Projektanzahl für ${account.email}`);
      assert.ok(projects.includes(account.role === "oalab_admin" ? "OALAB Admin" : "OALAB Customer"));
      const files = await page("/dashboard/files", jar);
      const expectedFiles = account.role === "oalab_admin" ? 6 : 2;
      assert.equal((files.match(/class="file-row"/g) || []).length, expectedFiles, `Falsche Dateianzahl für ${account.email}`);

      for (const customer of blueprint.accounts.filter((item) => item.role === "oalab_customer")) {
        const projectId = `${customer.workspace}-website-relaunch`;
        if (account.role === "oalab_admin" || account.workspace === customer.workspace) {
          assert.ok(projects.includes(projectId), `Zulässiges Projekt fehlt: ${account.email}`);
        } else {
          assert.ok(!projects.includes(projectId), `Fremdes Projekt im Workspace von ${account.email}`);
          assert.ok(!files.includes(customer.company), `Fremde Dateimetadaten im Workspace von ${account.email}`);
        }
      }
      if (account.role === "oalab_customer") {
        const foreign = blueprint.accounts.find((item) => item.role === "oalab_customer" && item.workspace !== account.workspace);
        const attempted = await page(`/dashboard/projects?workspace=${foreign.workspace}&project=${foreign.workspace}-website-relaunch`, jar);
        assert.equal((attempted.match(/class="project-card"/g) || []).length, 3);
        assert.ok(!attempted.includes('class="project-modal-title"'), "Eine fremde Projekt-ID darf keine Detailansicht öffnen.");
        assert.ok(!attempted.includes(foreign.company), "URL-Parameter dürfen den autorisierten Workspace nicht ändern.");
      }
      console.log(`OK: ${account.email} – ${expectedProjects} Projekte, ${expectedFiles} Dateien, Datensicht korrekt.`);
    } finally {
      const { error: logoutError } = await supabase.auth.signOut({ scope: "local" });
      assert.equal(logoutError, null, "Die Test-Session muss abgemeldet werden können.");
    }
  }
  const anonymous = await fetch(new URL("/dashboard/projects", base), { redirect: "manual", signal: AbortSignal.timeout(15000) });
  assert.ok([302, 303, 307, 308].includes(anonymous.status));
  assert.equal(new URL(anonymous.headers.get("location"), base).pathname, "/auth/login");
  console.log("OK: Ohne Anmeldung bleibt der Workspace geschützt.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
