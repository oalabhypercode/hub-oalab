import assert from "node:assert/strict";
import { test } from "node:test";
import { safeAuthRedirect } from "../lib/auth-redirect.ts";

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
