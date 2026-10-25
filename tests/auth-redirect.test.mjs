import assert from "node:assert/strict";
import { test } from "node:test";
import { safeAuthRedirect, secondFactorRedirect, settledSecondFactorRedirect, signedInRedirect } from "../lib/auth-redirect.ts";
import { authMessage } from "../lib/hub-auth/messages.ts";

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

test("a password-only session of a login with authenticator app goes to the code page first", () => {
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

test("the code page without an open code request sends on or back to the login", () => {
  assert.equal(settledSecondFactorRedirect(true, "/dashboard/calendar"), "/dashboard/calendar");
  assert.equal(settledSecondFactorRedirect(true, "https://example.com"), "/dashboard");
  assert.equal(settledSecondFactorRedirect(false, "/dashboard"), "/auth/login");
});

test("wrong or expired codes get one clear message", () => {
  assert.match(authMessage("mfa_verification_failed"), /Code stimmt nicht/);
  assert.equal(authMessage("mfa_challenge_expired"), authMessage("mfa_verification_failed"));
  assert.match(authMessage("mfa_factor_not_found"), /keine Authenticator-App/);
});
