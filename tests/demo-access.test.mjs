import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { parseDemoAccess, demoWorkspaceSlugs } from "../lib/demo-access.ts";

test("the seed contains exactly the requested four distinct test accounts", async () => {
  const blueprint = JSON.parse(await readFile(new URL("../config/demo-accounts.json", import.meta.url), "utf8"));
  assert.equal(blueprint.accounts.length, 4);
  assert.equal(new Set(blueprint.accounts.map((account) => account.email)).size, 4);
  assert.equal(blueprint.accounts.filter((account) => account.role === "oalab_admin").length, 1);
  assert.deepEqual(blueprint.accounts.filter((account) => account.role === "oalab_customer").map((account) => account.workspace), [...demoWorkspaceSlugs]);
});

test("an administrator is recognized only with an explicit trusted demo assignment", () => {
  assert.deepEqual(parseDemoAccess({ demo_account: true, app_role: "oalab_admin", demo_workspace: "all" }), { role: "oalab_admin", workspace: null });
  assert.equal(parseDemoAccess({ app_role: "oalab_admin" }), null);
  assert.equal(parseDemoAccess({ demo_account: false, app_role: "oalab_admin", demo_workspace: "all" }), null);
});

test("every customer is restricted to exactly one known workspace", () => {
  for (const workspace of demoWorkspaceSlugs) {
    assert.deepEqual(parseDemoAccess({ demo_account: true, app_role: "oalab_customer", demo_workspace: workspace }), { role: "oalab_customer", workspace });
  }
  for (const workspace of [null, "", "unknown", ["nordlicht", "formfeld"]]) {
    assert.equal(parseDemoAccess({ demo_account: true, app_role: "oalab_customer", demo_workspace: workspace }), null);
  }
});

test("missing, malformed and ambiguous access metadata cannot grant demo access", () => {
  for (const metadata of [null, undefined, "oalab_admin", {}, { demo_account: true, app_role: "admin", demo_workspace: "all" }, { demo_account: true, app_role: "oalab_admin", demo_workspace: null }, { demo_account: true, app_role: "oalab_admin", demo_workspace: "nordlicht" }]) {
    assert.equal(parseDemoAccess(metadata), null);
  }
});
