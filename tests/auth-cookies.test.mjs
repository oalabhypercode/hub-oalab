import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { AUTH_COOKIE_NAME, LEGACY_AUTH_COOKIE, authCookieOptions, sharedCookieDomain } from "../lib/supabase/cookies.ts";
import { authRateLimits, clientAddress } from "../lib/hub-auth/messages.ts";

const source = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const production = { NODE_ENV: "production" };

test("one HTTP-only session cookie shared with Service OALab on oalab.de", () => {
  assert.deepEqual(authCookieOptions("hub.oalab.de", production), { domain: "oalab.de", httpOnly: true, name: "sb-oalab-auth-token", path: "/", sameSite: "lax", secure: true });
  for (const host of ["service.oalab.de", "hub.oalab.de:443", "oalab.de", "HUB.OALAB.DE"]) assert.equal(sharedCookieDomain(host, production), "oalab.de");
});

test("previews, lookalike hosts and localhost keep host-bound cookies", () => {
  for (const host of ["oalab-client-hub.vercel.app", "hub-oalab.152.53.247.26.sslip.io", "evil-oalab.de", "oalab.de.evil.com", "localhost:3000", "", null, undefined]) {
    assert.equal("domain" in authCookieOptions(host, production), false, String(host));
  }
  assert.equal(authCookieOptions("localhost:3000", { NODE_ENV: "development" }).secure, false);
});

test("local tests choose their own shared domain or switch sharing off", () => {
  assert.equal(sharedCookieDomain("hub.oalab.localhost:3001", { OALAB_AUTH_COOKIE_DOMAIN: "oalab.localhost" }), "oalab.localhost");
  assert.equal(sharedCookieDomain("hub.oalab.de", { OALAB_AUTH_COOKIE_DOMAIN: "oalab.localhost" }), undefined);
  assert.equal(sharedCookieDomain("hub.oalab.de", { OALAB_AUTH_COOKIE_DOMAIN: "off" }), undefined);
});

test("only the former project-scoped cookies count as leftovers", () => {
  for (const name of ["sb-tjbslvwvisxjjcxfhbgm-auth-token", "sb-tjbslvwvisxjjcxfhbgm-auth-token.0", "sb-tjbslvwvisxjjcxfhbgm-auth-token-code-verifier"]) assert.match(name, LEGACY_AUTH_COOKIE);
  for (const name of [AUTH_COOKIE_NAME, `${AUTH_COOKIE_NAME}.1`, "__Host-oalab-demo", "oalab-theme"]) assert.doesNotMatch(name, LEGACY_AUTH_COOKIE);
});

test("Hub and Service write the same cookie", async () => {
  const service = await source("../service-oalab/apps/web/lib/supabase/config.ts").catch(() => null);
  if (service === null) return; // Only checkable where both repos sit side by side.
  assert.match(service, new RegExp(`SHARED_AUTH_COOKIE_NAME = "${AUTH_COOKIE_NAME}"`));
  assert.match(service, /SHARED_AUTH_COOKIE_DOMAIN = "oalab\.de"/);
});

test("server client and proxy use the shared cookie; browser code never touches the session", async () => {
  for (const path of ["lib/supabase/server.ts", "lib/supabase/proxy.ts"]) assert.match(await source(path), /cookieOptions: authCookieOptions\(/);
  for (const path of ["components/auth-form.tsx", "components/hub/app-shell.tsx", "app/auth/pending/sign-out.tsx", "components/logout-button.tsx"]) {
    const code = await source(path);
    assert.doesNotMatch(code, /lib\/supabase\/client/, path);
    assert.doesNotMatch(code, /\.auth\.(signInWithPassword|signUp|signOut|resetPasswordForEmail|updateUser)\(/, path);
  }
});

test("auth actions are server actions with rate limits, no public sign-up and no tokens in logs", async () => {
  const code = await source("lib/hub-auth/actions.ts");
  assert.match(code, /^"use server";/);
  assert.doesNotMatch(code, /auth\.signUp\(/);
  assert.match(code, /generateLink\(\{\s*type: "signup"/);
  assert.match(code, /hub_take_auth_rate/);
  assert.doesNotMatch(code, /console\.[a-z]+\([^)]*(token|link|email|password)/i);
  for (const action of ["login", "signup", "password_reset", "login_code"]) assert.ok(authRateLimits[action].account <= authRateLimits[action].network);
  // Codes go to the login's own address, are hashed per session and only finish a login once the token has aal2.
  assert.match(code, /mailLoginCode\(db, \{ id: session\.userId, email: session\.email \}/);
  assert.match(code, /p_code_hash: mailCodeHash\(session\.sessionId, code\)/);
  assert.match(code, /tokenClaims\(renewed\.session\.access_token\)\?\.aal !== "aal2"/);
  // Next.js would otherwise print Server Action arguments (passwords, codes) in the dev terminal.
  assert.match(await source("next.config.ts"), /logging: \{ serverFunctions: false \}/);
});

test("the visitor's address comes from the first forwarded entry", () => {
  const headers = (values) => ({ get: (name) => values[name] ?? null });
  assert.equal(clientAddress(headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
  assert.equal(clientAddress(headers({ "x-real-ip": "198.51.100.2" })), "198.51.100.2");
  assert.equal(clientAddress(headers({})), "unknown");
});
