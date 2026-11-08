import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { banUntil, mergeMetadata, restRequestUrl, sessionCookieName, usesOwnPlatform } from "../lib/platform/config.ts";
import { signJwt } from "../lib/platform/jwt.ts";
import { newSessionToken, signSessionToken, verifiedSessionToken } from "../lib/platform/session-cookie.ts";
import { base32Decode, base32Encode, totpCode, verifyTotp } from "../lib/platform/totp.ts";

test("only OALAB_PLATFORM=own switches the Hub to the own platform", () => {
  assert.equal(usesOwnPlatform({ OALAB_PLATFORM: "own" }), true);
  assert.equal(usesOwnPlatform({ OALAB_PLATFORM: "supabase" }), false);
  assert.equal(usesOwnPlatform({}), false);
});

test("supabase-js data requests reach PostgREST at its root, never another host", () => {
  const origin = "http://postgrest-abc:3000";
  assert.equal(restRequestUrl(`${origin}/rest/v1/hub_files?select=id`, origin), `${origin}/hub_files?select=id`);
  assert.equal(restRequestUrl(`${origin}/rest/v1/rpc/is_hub_admin`, origin), `${origin}/rpc/is_hub_admin`);
  assert.throws(() => restRequestUrl("https://example.supabase.co/rest/v1/hub_files", origin));
});

test("metadata updates merge like Supabase: null removes a key", () => {
  assert.deepEqual(mergeMetadata({ app_role: "oalab_admin", second_factor: "email" }, { second_factor: null }), { app_role: "oalab_admin" });
  assert.deepEqual(mergeMetadata(null, { second_factor: "totp" }), { second_factor: "totp" });
});

test("ban durations: none lifts, Go durations ban, anything else is refused", () => {
  const now = Date.UTC(2026, 10, 8);
  assert.equal(banUntil("none", now), null);
  assert.equal(banUntil("876000h", now)?.getTime(), now + 876000 * 3_600_000);
  assert.equal(banUntil("24h30m", now)?.getTime(), now + 24.5 * 3_600_000);
  assert.equal(banUntil("forever", now), undefined);
  assert.equal(banUntil("10x", now), undefined);
});

test("the session cookie is Better Auth's: same name, same signature as Service OALab checks", () => {
  const secret = "s".repeat(40);
  const token = newSessionToken();
  assert.match(token, /^[A-Za-z0-9]{32}$/u);
  const value = signSessionToken(token, secret);
  // scripts/oalab-auth-check.mjs in service-oalab signs exactly like this.
  assert.equal(value, `${token}.${createHmac("sha256", secret).update(token).digest("base64")}`);
  assert.equal(verifiedSessionToken(value, secret), token);
  assert.equal(verifiedSessionToken(encodeURIComponent(value), secret), token);
  assert.equal(verifiedSessionToken(value, "t".repeat(40)), null);
  assert.equal(verifiedSessionToken(`${token}x.${value.split(".")[1]}`, secret), null);
  assert.equal(sessionCookieName(true), "__Secure-oalab.session_token");
  assert.equal(sessionCookieName(false), "oalab.session_token");
});

test("PostgREST tokens are HS256 with the given claims", () => {
  const secret = "k".repeat(40);
  const token = signJwt({ role: "authenticated", sub: "u1", aal: "aal2" }, secret);
  const [header, payload, signature] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "HS256", typ: "JWT" });
  assert.equal(JSON.parse(Buffer.from(payload, "base64url").toString()).aal, "aal2");
  assert.equal(signature, createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url"));
});

test("authenticator codes follow RFC 6238 (SHA-1, six digits, 30 s) with one step of drift", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  assert.equal(secret, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.deepEqual(Buffer.from(base32Decode(secret)).toString(), "12345678901234567890");
  // RFC 6238 appendix B, T = 59 s: 94287082 → the last six digits.
  assert.equal(totpCode(base32Decode(secret), 1), "287082");
  assert.equal(verifyTotp(secret, "287082", 59_000), true);
  assert.equal(verifyTotp(secret, "287082", 59_000 + 30_000), true);
  assert.equal(verifyTotp(secret, "287082", 59_000 + 90_000), false);
  assert.equal(verifyTotp(secret, "28708", 59_000), false);
  assert.equal(verifyTotp("not base32!", "287082", 59_000), false);
});
