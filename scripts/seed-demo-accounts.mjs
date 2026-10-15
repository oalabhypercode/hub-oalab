import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";

const root = fileURLToPath(new URL("../", import.meta.url));
const blueprint = JSON.parse(await readFile(new URL("../config/demo-accounts.json", import.meta.url), "utf8"));
const credentialsPath = fileURLToPath(new URL("../.demo-accounts.local.json", import.meta.url));
const checkOnly = process.argv.includes("--check");
const verifyOnly = process.argv.includes("--verify");

if (existsSync(new URL("../.env.local", import.meta.url))) {
  const envSource = await readFile(new URL("../.env.local", import.meta.url), "utf8");
  const localEnv = parseEnv(envSource.replace(/^\uFEFF/, ""));
  for (const [name, value] of Object.entries(localEnv)) {
    if (process.env[name] === undefined) process.env[name] = value;
  }
}

function fail(message) { throw new Error(message); }

async function readCredentials() {
  if (!existsSync(credentialsPath)) return { projectRef: blueprint.projectRef, accounts: [] };
  const saved = JSON.parse(await readFile(credentialsPath, "utf8"));
  if (saved.projectRef !== blueprint.projectRef) fail("Die lokale Zugangsdaten-Datei gehört zu einem anderen Projekt.");
  return saved;
}

async function saveCredentials(saved) {
  await writeFile(credentialsPath, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 });
}

function metadataFor(account) {
  return {
    app_role: account.role,
    demo_account: true,
    demo_workspace: account.workspace ?? "all",
    demo_seed_version: blueprint.version,
  };
}

async function main() {
  const roles = blueprint.accounts.map((account) => account.role);
  const customerWorkspaces = blueprint.accounts.filter((account) => account.role === "oalab_customer").map((account) => account.workspace);
  if (blueprint.accounts.length !== 4 || roles.filter((role) => role === "oalab_admin").length !== 1 || customerWorkspaces.length !== 3 || new Set(customerWorkspaces).size !== 3) {
    fail("Der Seed muss genau einen Admin und drei getrennte Customer-Workspaces enthalten.");
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || new URL(url).hostname !== `${blueprint.projectRef}.supabase.co`) {
    fail(`Der Seed ist ausschließlich für das konfigurierte Client-Hub-Projekt ${blueprint.projectRef} vorgesehen.`);
  }
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (checkOnly) {
    console.table(blueprint.accounts.map(({ email, role, company }) => ({ email, role, company })));
    console.log(`Plan: ${blueprint.accounts.length} Testkonten. Administrative Konfiguration: ${secret ? "vorhanden" : "fehlt"}.`);
    console.log("Es wurden keine Konten angelegt oder verändert.");
    return;
  }

  // Refuse to persist credentials unless Git explicitly ignores the output.
  try { execFileSync("git", ["check-ignore", "--quiet", ".demo-accounts.local.json"], { cwd: root, stdio: "ignore" }); }
  catch { fail("Die lokale Zugangsdaten-Datei muss zuerst in .gitignore ausgeschlossen werden."); }

  const saved = await readCredentials();
  const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

  if (verifyOnly) {
    const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!publishable) fail("Der öffentliche Supabase-Key fehlt.");
    for (const account of blueprint.accounts) {
      const credentials = saved.accounts.find((item) => item.email === account.email && item.userId);
      if (!credentials?.password) fail(`Für ${account.email} existieren noch keine erfolgreich angelegten lokalen Test-Zugangsdaten.`);
      const client = createClient(url, publishable, clientOptions);
      const { data, error } = await client.auth.signInWithPassword({ email: account.email, password: credentials.password });
      if (error || !data.user || !data.session) fail(`Loginprüfung für ${account.email} fehlgeschlagen: ${error?.message || "Keine Session"}`);
      const metadata = data.user.app_metadata;
      const expectedWorkspace = account.workspace ?? "all";
      if (metadata.demo_account !== true || metadata.app_role !== account.role || metadata.demo_workspace !== expectedWorkspace) {
        await client.auth.signOut({ scope: "local" });
        fail(`Rollen- oder Workspace-Zuordnung von ${account.email} stimmt nicht mit dem Seed überein.`);
      }
      const { error: signOutError } = await client.auth.signOut({ scope: "local" });
      if (signOutError) fail(`Test-Session für ${account.email} konnte nicht abgemeldet werden.`);
      console.log(`OK: Login, Rolle und Workspace für ${account.email}`);
    }
    return;
  }

  if (!secret) fail("SUPABASE_SECRET_KEY fehlt in .env.local. Der öffentliche Publishable Key kann keine Testkonten verwalten.");
  let validSecret = secret.startsWith("sb_secret_");
  if (!validSecret && secret.startsWith("eyJ")) {
    try { validSecret = JSON.parse(Buffer.from(secret.split(".")[1], "base64url").toString()).role === "service_role"; } catch { /* handled below */ }
  }
  if (!validSecret) fail("Es wird ein serverseitiger Supabase Secret Key oder Legacy service_role Key benötigt.");
  const admin = createClient(url, secret, clientOptions);

  // Complete read-only discovery before the first mutation.
  const known = new Map();
  let complete = false;
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail(`Der Verwaltungszugriff auf das Zielprojekt ist nicht verfügbar: ${error.message}`);
    for (const user of data.users) {
      if (blueprint.accounts.some((account) => account.email === user.email)) known.set(user.email, user);
    }
    if (data.users.length < 1000 || known.size === blueprint.accounts.length) { complete = true; break; }
  }
  if (!complete) fail("Die Kontensuche hat das Sicherheitslimit erreicht; es wurden keine Konten verändert.");
  for (const account of blueprint.accounts) {
    const existing = known.get(account.email);
    if (existing && existing.app_metadata?.demo_account !== true) fail(`Die Adresse ${account.email} wird bereits von einem anderen Konto verwendet; der Seed überschreibt es nicht.`);
    const local = saved.accounts.find((item) => item.email === account.email);
    if (existing && (!local?.password || (local.userId && local.userId !== existing.id))) fail(`Für das bestehende Testkonto ${account.email} fehlen passende lokale Zugangsdaten. Es wird kein Passwort ungefragt zurückgesetzt.`);
  }

  for (const account of blueprint.accounts) {
    let local = saved.accounts.find((item) => item.email === account.email);
    if (!local) {
      local = { email: account.email, password: `Wola!${randomBytes(24).toString("base64url")}7a`, role: account.role, workspace: account.workspace, userId: null };
      saved.accounts.push(local);
      await saveCredentials(saved);
    }
    const existing = known.get(account.email);
    const attributes = {
      app_metadata: { ...(existing?.app_metadata || {}), ...metadataFor(account) },
      user_metadata: { ...(existing?.user_metadata || {}), full_name: account.name, company: account.company },
      email_confirm: true,
    };
    const { data, error } = existing
      ? await admin.auth.admin.updateUserById(existing.id, attributes)
      : await admin.auth.admin.createUser({ email: account.email, password: local.password, ...attributes });
    if (error || !data.user) fail(`Das Testkonto ${account.email} konnte nicht eingerichtet werden: ${error?.message || "Keine Benutzer-ID"}`);
    local.userId = data.user.id;
    local.role = account.role;
    local.workspace = account.workspace;
    await saveCredentials(saved);
    console.log(`${existing ? "Gepflegt" : "Angelegt"}: ${account.email} (${account.role})`);
  }
  console.log(`Zugangsdaten wurden ausschließlich lokal gespeichert: ${credentialsPath}`);
  console.log("Prüfung anschließend mit: npm run demo:verify");
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
