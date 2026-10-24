import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { loadLocalEnv } from "./lib/local-env.mjs";

// Applies supabase/migrations to the configured project. Credentials come from .env.local
// (SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD) and go to the CLI via its environment, never as arguments or output.
// Since 25.10.2026 the Hub runs on the Service Supabase project. The shared schema, these migrations included, is
// versioned and applied in service-oalab (`pnpm db:push` there); the project below is only the retired fallback.
if (!process.argv.includes("--retired-project")) {
  console.error("Die Hub-Datenbank liegt jetzt im Service-Supabase-Projekt. Migrationen bitte über service-oalab anwenden (pnpm db:push). Nur für das stillgelegte Hub-Projekt: --retired-project.");
  process.exit(1);
}
await loadLocalEnv();
const blueprint = JSON.parse(await readFile(new URL("../config/demo-accounts.json", import.meta.url), "utf8"));
const missing = ["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD"].filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Fehlt in .env.local: ${missing.join(", ")}. Bitte selbst eintragen und erneut starten.`);
  process.exit(1);
}

const dryRun = process.argv.includes("--check");
const run = (args) => {
  const result = spawnSync("npx", ["--no-install", "supabase", ...args], { stdio: "inherit", shell: true, env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run(["link", "--project-ref", blueprint.projectRef]);
run(["db", "push", ...(dryRun ? ["--dry-run"] : ["--yes"])]);
console.log(dryRun ? "Prüfung abgeschlossen: Migrationen wurden nicht angewendet." : "Migrationen angewendet.");
