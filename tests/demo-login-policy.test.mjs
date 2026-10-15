import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isDemoLoginAllowed, isSameOriginDemoPost, validateLocalDemoAccounts } from "../lib/demo-login-policy.ts";

const blueprint = JSON.parse(await readFile(new URL("../config/demo-accounts.json", import.meta.url), "utf8"));
const options = blueprint.accounts.map((account) => ({ ...account, id: account.workspace ?? "admin" }));
const fixture = () => ({ projectRef: blueprint.projectRef, accounts: options.map((account, i) => ({ ...account, password: `test-fixture-only-password-${i}`, userId: `test-user-${i}` })) });

test("one-click demo login is available only for local development", () => {
  for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) {
    const headers = new Headers({ host });
    assert.equal(isDemoLoginAllowed(headers, "development", undefined), true);
    for (const mode of ["production", "test", undefined]) assert.equal(isDemoLoginAllowed(headers, mode, "true"), false);
    assert.equal(isDemoLoginAllowed(headers, "development", "false"), false);
  }
});

test("remote, malformed and externally forwarded hosts never enable demo login", () => {
  for (const host of ["demo.oalab.de", "localhost.evil.test", "localhost:3000/", "evil.test@localhost:3000", "0.0.0.0:3000", "localhost:3000, evil.test"]) {
    assert.equal(isDemoLoginAllowed(new Headers({ host }), "development", "true"), false);
  }
  assert.equal(isDemoLoginAllowed(new Headers(), "development", "true"), false);
  assert.equal(isDemoLoginAllowed(new Headers({ host: "localhost:3000", "x-forwarded-host": "demo.oalab.de" }), "development", "true"), false);
});

test("demo login requires a same-origin POST", () => {
  const url = "http://127.0.0.1:3000/auth/demo";
  const make = (method, origin, fetchSite) => new Request(url, { method, headers: { host: "127.0.0.1:3000", ...(origin ? { origin } : {}), ...(fetchSite ? { "sec-fetch-site": fetchSite } : {}) } });
  assert.equal(isSameOriginDemoPost(make("POST", "http://127.0.0.1:3000", "same-origin")), true);
  assert.equal(isSameOriginDemoPost(make("GET", "http://127.0.0.1:3000")), false);
  assert.equal(isSameOriginDemoPost(make("POST", "https://evil.test")), false);
  assert.equal(isSameOriginDemoPost(make("POST", null)), false);
  assert.equal(isSameOriginDemoPost(make("POST", "http://127.0.0.1:3000", "cross-site")), false);
  assert.equal(isSameOriginDemoPost(new Request("http://localhost:3000/auth/demo", { method: "POST", headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" } })), true);
});

test("only the four provisioned accounts from the expected project can be used", () => {
  const data = fixture();
  assert.equal(validateLocalDemoAccounts(data, options, blueprint.projectRef).length, 4);
  for (const invalid of [null, {}, { ...data, projectRef: "another-project" }, { ...data, accounts: data.accounts.slice(0, 3) }, { ...data, accounts: [...data.accounts, data.accounts[0]] }]) {
    assert.deepEqual(validateLocalDemoAccounts(invalid, options, blueprint.projectRef), []);
  }
  for (const change of [{ role: "oalab_admin" }, { workspace: "other-customer" }, { password: "" }, { userId: null }, { email: options[0].email }]) {
    const modified = fixture();
    Object.assign(modified.accounts[1], change);
    assert.deepEqual(validateLocalDemoAccounts(modified, options, blueprint.projectRef), []);
  }
});

test("the homepage renders login directly and credentials remain server-only", async () => {
  const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const home = await source("app/page.tsx");
  assert.match(home, /<AuthFrame><LoginPage/);
  assert.doesNotMatch(home, /landing/);
  assert.match(await source("lib/demo-login.ts"), /import "server-only"/);
  assert.doesNotMatch(await source("components/demo-account-picker.tsx"), /password|SUPABASE_SECRET_KEY/);
  assert.match(await source("next.config.ts"), /outputFileTracingExcludes:.*\.demo-accounts\.local\.json/);
});
