import assert from "node:assert/strict";
import { test } from "node:test";
import { safeAuthRedirect, signedInRedirect } from "../lib/auth-redirect.ts";

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
