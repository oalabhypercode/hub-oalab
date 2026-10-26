import { createClient } from "@supabase/supabase-js";
import { hasMailbox } from "../lib/hub-auth/mail-code.ts";
import { loadLocalEnv } from "./lib/local-env.mjs";

// Switches from the authenticator app to the code by e-mail (26.10.2026), with the local secret key only.
//   (no flag)       shows which logins have an app and whether their e-mail code is on; changes nothing
//   --apply         turns the e-mail code on for every login with a confirmed app
//   --remove-apps   removes the app factors of logins whose e-mail code is on (after the code works live)
// Addresses are shown shortened, codes and keys never.
await loadLocalEnv();
const apply = process.argv.includes("--apply");
const removeApps = process.argv.includes("--remove-apps");
const SERVICE_PROJECT = "hxljfihyejwpugnsffcc";

function fail(message) { throw new Error(message); }
const masked = (email = "") => email.replace(/^(.{1,2})[^@]*@/, "$1***@");

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || new URL(url).hostname !== `${SERVICE_PROJECT}.supabase.co`) fail(`Nur für das gemeinsame Supabase-Projekt ${SERVICE_PROJECT} vorgesehen.`);
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) fail("SUPABASE_SECRET_KEY fehlt in .env.local.");
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail(`Benutzer konnten nicht gelesen werden: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }

  const rows = [];
  for (const user of users) {
    // The user list carries no factors; each login is asked on its own.
    const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: user.id });
    if (error) fail(`Faktoren von ${masked(user.email)} nicht lesbar: ${error.message}`);
    const apps = data.factors.filter((factor) => factor.factor_type === "totp");
    const mailCode = user.app_metadata?.second_factor === "email";
    if (!apps.length && !mailCode) continue;
    rows.push({ user, apps, mailCode, confirmedApp: apps.some((factor) => factor.status === "verified") });
  }
  console.table(rows.map((row) => ({ konto: masked(row.user.email), app: row.confirmedApp ? "bestätigt" : row.apps.length ? "unbestätigt" : "keine", "code per mail": row.mailCode ? "an" : "aus" })));

  if (apply) {
    for (const row of rows.filter((item) => item.confirmedApp && !item.mailCode)) {
      // Reserved test domains have no mailbox: the code could never arrive, so the login would be locked out.
      if (!hasMailbox(row.user.email)) {
        console.log(`Übersprungen, Adresse ohne Postfach: ${masked(row.user.email)}`);
        continue;
      }
      const { error } = await admin.auth.admin.updateUserById(row.user.id, { app_metadata: { second_factor: "email" } });
      if (error) fail(`Code per E-Mail für ${masked(row.user.email)} nicht einschaltbar: ${error.message}`);
      row.mailCode = true;
      console.log(`Code per E-Mail eingeschaltet: ${masked(row.user.email)}`);
    }
  }
  if (removeApps) {
    // Never leaves a login without second factor: only logins with the e-mail code lose their app.
    for (const row of rows.filter((item) => item.mailCode && item.apps.length)) {
      for (const factor of row.apps) {
        const { error } = await admin.auth.admin.mfa.deleteFactor({ userId: row.user.id, id: factor.id });
        if (error) fail(`App von ${masked(row.user.email)} nicht entfernbar: ${error.message}`);
      }
      console.log(`Authenticator-App entfernt: ${masked(row.user.email)}`);
    }
  }
  if (!apply && !removeApps) console.log("Nur angezeigt, nichts verändert. --apply schaltet den Code per E-Mail ein, --remove-apps entfernt danach die Apps.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Unbekannter Fehler");
  process.exitCode = 1;
});
