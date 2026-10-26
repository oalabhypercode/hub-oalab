import { createClient } from "@supabase/supabase-js";
import { hasConfirmedApp, secondFactorMethod } from "../lib/hub-auth/second-factor.ts";
import { loadLocalEnv } from "./lib/local-env.mjs";

// Shows every login with a second factor: the method sign-in asks for (chosen in the profile, or set by an admin) and
// whether an authenticator app is set up. Read-only, with the local secret key; addresses are shortened.
await loadLocalEnv();
const SERVICE_PROJECT = "hxljfihyejwpugnsffcc";

function fail(message) { throw new Error(message); }
const masked = (email = "") => email.replace(/^(.{1,2})[^@]*@/, "$1***@");
const methodLabels = { email: "Code per E-Mail", totp: "Authenticator-App" };

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
    const hasApp = hasConfirmedApp(data.factors);
    const method = secondFactorMethod(user.app_metadata, hasApp);
    if (method) rows.push({ konto: masked(user.email), methode: methodLabels[method], app: hasApp ? "eingerichtet" : "keine" });
  }
  if (rows.length) console.table(rows);
  console.log(`${rows.length} von ${users.length} Konten mit zweitem Faktor. Nur angezeigt, nichts verändert.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Unbekannter Fehler");
  process.exitCode = 1;
});
