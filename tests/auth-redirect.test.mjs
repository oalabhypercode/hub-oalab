import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { safeAuthRedirect, secondFactorDestination, secondFactorPageRedirect, secondFactorRedirect, serviceDestination, serviceOrigin, signedInRedirect } from "../lib/auth-redirect.ts";
import { hasMailbox, isMailCodeCheck, mailCodeHash, maskEmail, newMailCode, readMailCode } from "../lib/hub-auth/mail-code.ts";
import { authMessage } from "../lib/hub-auth/messages.ts";
import { secondFactorPending, wantsMailCode } from "../lib/hub-auth/second-factor.ts";

const SERVICE = "https://service.oalab.de";

test("keeps dashboard paths and the password recovery destination", () => {
  for (const path of ["/dashboard", "/dashboard/projects", "/dashboard/projects?project=website-relaunch", "/auth/update-password"]) {
    assert.equal(safeAuthRedirect(path), path);
  }
});

test("rejects external, malformed and unrelated destinations", () => {
  for (const path of [null, undefined, "", "https://example.com", "//example.com/dashboard", "/\\example.com/dashboard", "/auth/login", "/preview", "/dashboard-other", "/dashboard/../../auth/login", "/dashboard\n"]) {
    assert.equal(safeAuthRedirect(path), "/dashboard");
  }
});

test("sends a signed-in visitor from the sign-in pages into the hub", () => {
  assert.equal(signedInRedirect("/", null), "/dashboard");
  assert.equal(signedInRedirect("/auth/login", "/dashboard/projects?project=x"), "/dashboard/projects?project=x");
  assert.equal(signedInRedirect("/auth/sign-up", "https://example.com"), "/dashboard");
});

test("leaves every other page alone, including the waiting and recovery pages", () => {
  for (const path of ["/auth/pending", "/auth/update-password", "/auth/forgot-password", "/auth/confirm", "/dashboard", "/preview"]) {
    assert.equal(signedInRedirect(path, null), null);
  }
});

test("only logins switched to the e-mail code owe it, and only until the session carries aal2", () => {
  assert.equal(wantsMailCode({ second_factor: "email", app_role: "oalab_admin" }), true);
  for (const metadata of [null, undefined, {}, { second_factor: null }, { second_factor: "totp" }, { second_factor: true }, "email"]) assert.equal(wantsMailCode(metadata), false);
  assert.equal(secondFactorPending({ aal: "aal1", app_metadata: { second_factor: "email" } }), true);
  assert.equal(secondFactorPending({ aal: "aal2", app_metadata: { second_factor: "email" } }), false);
  assert.equal(secondFactorPending({ aal: "aal1", app_metadata: {} }), false);
  assert.equal(secondFactorPending(null), false);
});

test("codes are six random digits, hashed per session, and read leniently but strictly", () => {
  const codes = new Set(Array.from({ length: 200 }, newMailCode));
  for (const code of codes) assert.match(code, /^\d{6}$/);
  assert.ok(codes.size > 190);
  assert.equal(readMailCode(" 042 917 "), "042917");
  for (const bad of ["04291", "0429170", "04291a", "", null, 42917]) assert.equal(readMailCode(bad), null);
  const session = "5f0c4a5e-8c1b-4d1e-9a3f-2b7c6d8e9f10";
  assert.match(mailCodeHash(session, "042917"), /^[0-9a-f]{64}$/);
  assert.notEqual(mailCodeHash(session, "042917"), mailCodeHash("6f0c4a5e-8c1b-4d1e-9a3f-2b7c6d8e9f10", "042917"));
  assert.equal(maskEmail("info@oalab.de"), "in***@oalab.de");
  assert.equal(maskEmail("a@b.de"), "a***@b.de");
  assert.equal(maskEmail("kein-at"), "");
  for (const email of ["info@oalab.de", "jana@testfirma.de"]) assert.equal(hasMailbox(email), true, email);
  for (const email of ["oalab-ops@example.invalid", "kunde@nordlicht.example", "demo@hub.test", "x@example.com", "", null]) assert.equal(hasMailbox(email), false, String(email));
  assert.equal(isMailCodeCheck("verified"), true);
  assert.equal(isMailCodeCheck("ok"), false);
});

test("Service OALab pages are the only outside destination after the code", () => {
  assert.equal(serviceOrigin({}), SERVICE);
  assert.equal(serviceOrigin({ OALAB_SERVICE_URL: "http://service.oalab.localhost:3000/" }), "http://service.oalab.localhost:3000");
  assert.equal(serviceDestination("https://service.oalab.de/ops?x=1", SERVICE), "https://service.oalab.de/ops?x=1");
  for (const bad of ["https://evil.example/ops", "https://service.oalab.de.evil.example/ops", "https://user:pw@service.oalab.de/ops", "//service.oalab.de/ops", "/ops", "https://service.oalab.de/\n", null]) {
    assert.equal(serviceDestination(bad, SERVICE), null, String(bad));
  }
  assert.equal(secondFactorDestination("https://service.oalab.de/workspace", SERVICE), "https://service.oalab.de/workspace");
  assert.equal(secondFactorDestination("/dashboard/files", SERVICE), "/dashboard/files");
  assert.equal(secondFactorDestination("https://evil.example", SERVICE), "/dashboard");
});

test("the code page keeps who owes a code, also for Service team pages, and sends everyone else on", () => {
  const page = (state, next) => secondFactorPageRedirect(state, next, SERVICE);
  assert.equal(page({ signedIn: false, confirmed: false, wanted: false }, "/dashboard"), "/auth/login");
  assert.equal(page({ signedIn: true, confirmed: false, wanted: true }, "/dashboard"), null);
  // Service OALab sends its team for the code even when the hub itself would not ask for it.
  assert.equal(page({ signedIn: true, confirmed: false, wanted: false }, "https://service.oalab.de/ops"), null);
  assert.equal(page({ signedIn: true, confirmed: false, wanted: false }, "/dashboard/calendar"), "/dashboard/calendar");
  assert.equal(page({ signedIn: true, confirmed: true, wanted: true }, "https://service.oalab.de/ops"), "https://service.oalab.de/ops");
  assert.equal(page({ signedIn: true, confirmed: true, wanted: true }, "https://example.com"), "/dashboard");
});

test("a password-only session of a login with the e-mail code goes to the code page first", () => {
  assert.equal(secondFactorRedirect("/dashboard/files", "?folder=a", null, false), "/auth/mfa?next=%2Fdashboard%2Ffiles%3Ffolder%3Da");
  assert.equal(secondFactorRedirect("/auth/login", "", "/dashboard/users", true), "/auth/mfa?next=%2Fdashboard%2Fusers");
  assert.equal(secondFactorRedirect("/", "", "https://example.com", true), "/auth/mfa?next=%2Fdashboard");
  // The recovery link opens a password-only session: the new password needs the code as well.
  assert.equal(secondFactorRedirect("/auth/update-password", "", null, true), "/auth/mfa?next=%2Fauth%2Fupdate-password");
});

test("the code page itself and pages without login stay reachable while the code is open", () => {
  for (const path of ["/auth/mfa", "/auth/error", "/preview", "/auth/forgot-password"]) {
    assert.equal(secondFactorRedirect(path, "", null, true), null);
  }
});

test("codes and confirmed sessions stay server-side, and the hook raises only confirmed sessions to aal2", async () => {
  const sql = (await readFile(new URL("../supabase/migrations/20261026120000_mail_second_factor.sql", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  assert.match(sql, /revoke all on public\.oalab_mail_codes, public\.oalab_mail_code_sessions from public, anon, authenticated;/);
  assert.doesNotMatch(sql, /grant [^;]*oalab_mail_codes[^;]* to (anon|authenticated|supabase_auth_admin)/);
  for (const name of ["oalab_mail_code_issue", "oalab_mail_code_verify"]) {
    assert.match(sql, new RegExp(`revoke execute on function public\\.${name}\\(uuid, uuid, text\\) from public, anon, authenticated;`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\(uuid, uuid, text\\) to service_role;`));
  }
  // Five attempts, ten minutes, one code per session.
  assert.match(sql, /attempts smallint not null default 0 check \(attempts between 0 and 5\)/);
  assert.match(sql, /now\(\) \+ interval '10 minutes'/);
  const hook = sql.match(/create or replace function public\.oalab_access_token_hook[\s\S]+?\n\$\$;/)[0];
  assert.match(hook, /s\.session_id = session_text::uuid\s+and s\.user_id = user_text::uuid\s+and s\.verified_at > now\(\) - interval '30 days'/);
  assert.match(hook, /claims := jsonb_set\(claims, '\{aal\}', to_jsonb\('aal2'::text\)\);/);
  assert.equal(hook.match(/jsonb_set/g).length, 1);
  assert.match(sql, /revoke execute on function public\.oalab_access_token_hook\(jsonb\) from public, anon, authenticated;\s+grant execute on function public\.oalab_access_token_hook\(jsonb\) to supabase_auth_admin;/);
});

test("wrong, used-up and expired codes each get one clear message", () => {
  assert.match(authMessage("mail_code_wrong"), /Code stimmt nicht/);
  assert.match(authMessage("mail_code_locked"), /zu oft falsch/);
  assert.match(authMessage("mail_code_expired"), /abgelaufen/);
  assert.equal(authMessage("mail_code_missing"), authMessage("mail_code_expired"));
  assert.match(authMessage("over_email_send_rate_limit"), /Zu viele Versuche/);
});
