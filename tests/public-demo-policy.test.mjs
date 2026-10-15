import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { configuredPublicDemoOrigin, createPublicDemoToken, isPublicDemoHost, isPublicDemoPost, parsePublicDemoToken, publicDemoAccountIds, PUBLIC_DEMO_MAX_AGE } from "../lib/public-demo-policy.ts";

const secret = "unit-test-fixture-only-not-a-real-secret";
const origin = "https://oalab-client-hub.vercel.app";
const settings = { enabled: "true", origin, secret };
const now = Date.UTC(2026, 9, 15, 12);
const host = new URL(origin).host;
const signed = (data) => {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
};

test("public demo is opt-in, HTTPS-only and restricted to one exact host", () => {
  assert.equal(configuredPublicDemoOrigin(settings), origin);
  for (const change of [{ enabled: undefined }, { enabled: "false" }, { secret: "short" }, { origin: "http://example.com" }, { origin: "https://localhost" }, { origin: "https://127.0.0.1" }, { origin: "https://*.vercel.app" }, { origin: `${origin}/dashboard` }, { origin: `${origin}?a=b` }, { origin: "https://user:pass@example.com" }]) {
    assert.equal(configuredPublicDemoOrigin({ ...settings, ...change }), null);
  }
  assert.equal(isPublicDemoHost(new Headers({ host }), settings), true);
  assert.equal(isPublicDemoHost(new Headers({ host, "x-forwarded-host": host }), settings), true);
  for (const headers of [{}, { host: `${host}.evil.test` }, { host: "preview.vercel.app" }, { host, "x-forwarded-host": "evil.test" }, { host: `${host}, evil.test` }]) {
    assert.equal(isPublicDemoHost(new Headers(headers), settings), false);
  }
});

test("public demo login and logout require a same-origin POST", () => {
  const make = (method, requestOrigin, site) => new Request(`${origin}/auth/demo`, { method, headers: { host, ...(requestOrigin ? { origin: requestOrigin } : {}), ...(site ? { "sec-fetch-site": site } : {}) } });
  assert.equal(isPublicDemoPost(make("POST", origin, "same-origin"), settings), true);
  for (const request of [make("GET", origin), make("POST", null), make("POST", "https://evil.test"), make("POST", origin, "cross-site"), make("POST", origin, "same-site")]) {
    assert.equal(isPublicDemoPost(request, settings), false);
  }
});

test("only four fixed fixture identities receive signed 12-hour sessions", () => {
  assert.deepEqual(publicDemoAccountIds, ["admin", "nordlicht", "formfeld", "horizont"]);
  for (const id of publicDemoAccountIds) {
    const token = createPublicDemoToken(id, secret, now);
    assert.equal(parsePublicDemoToken(token, secret, now), id);
    assert.equal(parsePublicDemoToken(token, secret, now + PUBLIC_DEMO_MAX_AGE * 1000 - 1000), id);
    assert.equal(parsePublicDemoToken(token, secret, now + PUBLIC_DEMO_MAX_AGE * 1000), null);
    assert.equal(parsePublicDemoToken(token, `${secret}-wrong`, now), null);
    assert.equal(parsePublicDemoToken(`${token}.extra`, secret, now), null);
    const [payload, signature] = token.split(".");
    assert.equal(parsePublicDemoToken(`${payload}.${signature[0] === "a" ? "b" : "a"}${signature.slice(1)}`, secret, now), null);
  }
  assert.throws(() => createPublicDemoToken("another-customer", secret, now));
  assert.throws(() => createPublicDemoToken("admin", "short", now));
});

test("malformed, future, extended and non-whitelisted signed claims are rejected", () => {
  const iat = now / 1000;
  const claims = { v: 1, id: "admin", iat, exp: iat + PUBLIC_DEMO_MAX_AGE };
  for (const token of [undefined, "", "x".repeat(513), "not.a.token", signed(null), signed({ ...claims, id: "real-admin" }), signed({ ...claims, v: 2 }), signed({ ...claims, exp: claims.exp + 1 }), signed({ ...claims, iat: iat + 31, exp: claims.exp + 31 }), signed({ ...claims, iat: String(iat) })]) {
    assert.equal(parsePublicDemoToken(token, secret, now), null);
  }
});

test("fixture sessions remain server-only and cannot substitute for Supabase tokens", async () => {
  const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const session = await source("lib/public-demo-session.ts");
  assert.match(session, /import "server-only"/);
  assert.match(session, /userId: `public-demo:/);
  assert.doesNotMatch(session, /SUPABASE_SECRET_KEY|password|signInWithPassword/);
  const login = await source("app/auth/demo/route.ts");
  assert.match(login, /httpOnly: true, secure: true, sameSite: "lax", path: "\/"/);
  assert.match(login, /form.getAll\("account"\).length !== 1/);
  const proxy = await source("lib/supabase/proxy.ts");
  assert.match(proxy, /pathname === "\/dashboard" \|\| pathname.startsWith\("\/dashboard\/"\)/);
  assert.match(await source(".vercelignore"), /\.demo-accounts\.local\.json/);
});
