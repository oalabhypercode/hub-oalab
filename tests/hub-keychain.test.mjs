import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CATEGORY_ICONS, CODE_ATTEMPTS, DEFAULT_CATEGORIES, LOCK_MINUTES, MAILBOX_CATEGORY, MAX_OPEN_MINUTES, NEW_CATEGORY_ICONS, RECOVERY_ALPHABET, RECOVERY_CAP, RECOVERY_CODE_COUNT, UNLOCK_MINUTES,
  categoryId, formatRecoveryCode, groupedKey, isCategoryId, lockState, nameTaken, nextExpiry, normalizeRecoveryCode, readCategoryName, recoveryState, unlockWindow,
} from "../lib/hub-keychain/rules.ts";
import { newRecoveryCodes, newSetupCode, newUnlockToken, recoveryCodeHash, setupCodeHash, unlockTokenHash } from "../lib/hub-keychain/codes.ts";
import { base32Encode, matchTotpStep, totpCode } from "../lib/platform/totp.ts";
import { openSecret, parseVaultKey, sealSecret } from "../lib/hub-vault/crypto.ts";

// Windows checkouts may carry CRLF line endings; the source checks below compare LF text.
const source = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const MINUTE = 60_000;
const KEY = parseVaultKey(Buffer.alloc(32, 7).toString("base64"));
const USER = "00000000-0000-4000-8000-000000000001";

test("keychain: open ten minutes after the last action, never longer than an hour in one go", () => {
  assert.equal(UNLOCK_MINUTES, 10);
  assert.equal(MAX_OPEN_MINUTES, 60);
  const start = Date.parse("2026-11-13T10:00:00Z");
  const window = unlockWindow(start);
  assert.equal(window.expiresAt, start + 10 * MINUTE);
  assert.equal(window.hardUntil, start + 60 * MINUTE);
  assert.equal(nextExpiry(start + 30 * MINUTE, window.hardUntil), start + 40 * MINUTE);
  assert.equal(nextExpiry(start + 55 * MINUTE, window.hardUntil), window.hardUntil, "the hour is the end, whatever happens");
});

test("keychain: five wrong codes within 15 minutes lock it until the oldest of them leaves the window", () => {
  assert.equal(CODE_ATTEMPTS, 5);
  assert.equal(LOCK_MINUTES, 15);
  const now = Date.parse("2026-11-13T10:00:00Z");
  assert.deepEqual(lockState([], now), { locked: false, until: null, left: 5 });
  const four = [1, 2, 3, 4].map((minutes) => now - minutes * MINUTE);
  assert.deepEqual(lockState(four, now), { locked: false, until: null, left: 1 });
  const five = [...four, now - 5 * MINUTE];
  assert.deepEqual(lockState(five, now), { locked: true, until: now - 5 * MINUTE + 15 * MINUTE, left: 0 });
  // Old wrong codes and codes from the future do not count.
  assert.equal(lockState([...four, now - 16 * MINUTE], now).locked, false);
  assert.equal(lockState([...four, now + MINUTE], now).locked, false);
});

test("keychain: in the block a recovery code still opens, until ten wrong codes; the team hears of the block once", async () => {
  assert.equal(RECOVERY_CAP, 10);
  const now = Date.parse("2026-11-13T10:00:00Z");
  const five = [1, 2, 3, 4, 5].map((minutes) => now - minutes * MINUTE);
  assert.equal(lockState(five, now).locked, true, "the app's code waits");
  assert.deepEqual(recoveryState(five, now), { allowed: true, until: null }, "a recovery code still opens");
  const ten = [...five, ...[6, 7, 8, 9, 10].map((minutes) => now - minutes * MINUTE)];
  assert.deepEqual(recoveryState(ten, now), { allowed: false, until: now - 10 * MINUTE + 15 * MINUTE });
  assert.equal(recoveryState([...ten.slice(0, 9), now - 16 * MINUTE], now).allowed, true, "old wrong codes do not count");
  const actions = await source("lib/hub-keychain/actions.ts");
  const recovery = actions.slice(actions.indexOf("export async function unlockKeychainWithRecovery"), actions.indexOf("export async function lockKeychain"));
  assert.match(recovery, /const gate = recoveryState\(wrong, now\);\n[^]*?if \(!gate\.allowed/);
  assert.doesNotMatch(recovery, /before\.locked/, "the block alone does not stop a recovery code");
  assert.match(actions, /if \(!was\.locked\) \{\n\s+await logKeychain\(admin, "keychain\.blocked"[^]*?await tellTeam\(/);
});

test("keychain: categories have clean names, unique regardless of case, and stable ids", () => {
  assert.equal(readCategoryName("  Online   Shop \n"), "Online Shop");
  assert.equal(readCategoryName("x".repeat(60)), "x".repeat(40));
  assert.equal(readCategoryName("   "), null);
  assert.equal(readCategoryName(5), null);
  const list = [{ id: "dns", name: "DNS" }, { id: "c-shop", name: "Online-Shop" }];
  assert.equal(nameTaken("dns", list), true);
  assert.equal(nameTaken("online-shop", list), true);
  assert.equal(nameTaken("DNS", list, "dns"), false, "renaming keeps its own name");
  assert.equal(categoryId("Online-Shop", []), "c-online-shop");
  assert.equal(categoryId("Tänze & Öl", []), "c-taenze-oel");
  assert.equal(categoryId("Online-Shop", ["c-online-shop", "c-online-shop-2"]), "c-online-shop-3");
  assert.equal(categoryId("!!!", []), "c-kategorie");
  for (const id of ["c-online-shop", "mailbox", "c-taenze-oel"]) assert.equal(isCategoryId(id), true, id);
  for (const id of ["", "x", "Mailbox", "-a", "a b", 7]) assert.equal(isCategoryId(id), false, String(id));
});

test("keychain: the first categories as agreed, only „Postfächer“ fixed, symbols from one list", () => {
  assert.deepEqual(DEFAULT_CATEGORIES.map((category) => category.name), ["Postfächer", "Domain-Anbieter", "DNS", "Hosting", "Website & CMS", "Social Media", "Google & Statistik", "Software & Tools", "Sonstiges"]);
  assert.deepEqual(DEFAULT_CATEGORIES.filter((category) => category.fixed).map((category) => category.id), [MAILBOX_CATEGORY]);
  for (const category of DEFAULT_CATEGORIES) assert.ok(CATEGORY_ICONS.includes(category.icon), category.id);
  for (const icon of NEW_CATEGORY_ICONS) assert.ok(CATEGORY_ICONS.includes(icon), icon);
});

test("keychain: recovery codes are eight unambiguous characters, all different, read in any spelling", () => {
  const codes = newRecoveryCodes();
  assert.equal(codes.length, RECOVERY_CODE_COUNT);
  assert.equal(new Set(codes).size, codes.length);
  for (const code of codes) {
    assert.match(code, /^[A-Z0-9]{8}$/);
    assert.ok([...code].every((char) => RECOVERY_ALPHABET.includes(char)), code);
    assert.equal(normalizeRecoveryCode(formatRecoveryCode(code).toLowerCase()), code);
  }
  assert.equal(normalizeRecoveryCode("7kq2 m9xd"), "7KQ2M9XD");
  assert.equal(formatRecoveryCode("7KQ2M9XD"), "7KQ2-M9XD");
  for (const typed of ["7KQ2-M9X", "7KQ2-M9XDD", "0KQ2-M9XD", "IKQ2-M9XD", "1KQ2-M9XD", null]) assert.equal(normalizeRecoveryCode(typed), null, String(typed));
  assert.equal(groupedKey("JBSWY3DPEHPK3PXP"), "JBSW Y3DP EHPK 3PXP");
});

test("keychain: what the database keeps is a hash, bound to its admin, session or key", () => {
  const hash = recoveryCodeHash(KEY, USER, "7KQ2M9XD");
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(recoveryCodeHash(KEY, USER, "7KQ2M9XD"), hash);
  assert.notEqual(recoveryCodeHash(KEY, "00000000-0000-4000-8000-000000000002", "7KQ2M9XD"), hash, "another admin's code differs");
  assert.notEqual(recoveryCodeHash(parseVaultKey(Buffer.alloc(32, 9).toString("base64")), USER, "7KQ2M9XD"), hash, "without the server's key no hash fits");
  const token = newUnlockToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(unlockTokenHash(token), /^[0-9a-f]{64}$/);
  assert.notEqual(unlockTokenHash(token), unlockTokenHash(newUnlockToken()));
  assert.match(newSetupCode(), /^\d{6}$/);
  assert.notEqual(setupCodeHash("session-a", "123456"), setupCodeHash("session-b", "123456"), "a mail code fits only its sign-in");
});

test("keychain: the app's code tells its step (RFC 6238), so a used code can be refused", () => {
  // RFC 6238 test secret (SHA-1): "12345678901234567890"; at 59 s the 8-digit code is 94287082, six digits 287082.
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  assert.equal(totpCode(Buffer.from("12345678901234567890"), 1), "287082");
  assert.equal(matchTotpStep(secret, "287082", 59_000), 1);
  // One step of drift either way, then nothing.
  assert.equal(matchTotpStep(secret, "287082", 89_000), 1);
  assert.equal(matchTotpStep(secret, "287082", 125_000), null);
  assert.equal(matchTotpStep(secret, "000000", 59_000), null);
  assert.equal(matchTotpStep(secret, "28708", 59_000), null);
  assert.equal(matchTotpStep("not base32!", "287082", 59_000), null);
});

test("keychain: a note never opens as a password, an app key never as a note", () => {
  const note = sealSecret(KEY, { kind: "login-note", id: USER }, "Code geht an Jana");
  assert.equal(openSecret(KEY, { kind: "login-note", id: USER }, note), "Code geht an Jana");
  assert.equal(openSecret(KEY, { kind: "login", id: USER }, note), null);
  const app = sealSecret(KEY, { kind: "keychain-app", id: USER }, "JBSWY3DPEHPK3PXP");
  assert.equal(openSecret(KEY, { kind: "login-note", id: USER }, app), null);
  assert.equal(openSecret(KEY, { kind: "keychain-app", id: USER }, app), "JBSWY3DPEHPK3PXP");
});

test("keychain: every action checks the admin first, the vault the open keychain instead of aal2", async () => {
  const actions = await source("lib/hub-keychain/actions.ts");
  const bodies = actions.split(/\nexport async function /).slice(1);
  assert.ok(bodies.length >= 14, `${bodies.length} actions`);
  for (const body of bodies) {
    const name = body.slice(0, body.indexOf("("));
    const first = body.slice(body.indexOf("{\n") + 2).trimStart().split("\n")[0];
    assert.match(first, /^const (admin = await keychainAdmin\(\)|open = await openKeychain\(\));$/, name);
  }
  assert.doesNotMatch(actions, /console\./, "nothing is written to the server log");
  assert.doesNotMatch(actions, /tellTeam\([^)]*\$\{code\}/, "Telegram never hears a code");
  const vault = await source("lib/hub-vault/actions.ts");
  assert.doesNotMatch(vault, /aal2/);
  assert.match(vault, /const unlock = await currentUnlock\(admin\);\n {2}if \(!unlock\) return/);
  assert.match(vault, /\.eq\("purpose", "password"\)/);
  const store = await source("lib/hub-vault/store.ts");
  for (const fn of ["storeSealed", "readSealed", "removeSealed"]) assert.match(store, new RegExp(`export async function ${fn}[\\s\\S]+?\\.eq\\("purpose", purpose\\)`), fn);
});

test("keychain: the unlock cookie is httpOnly, strict and bound to the sign-in", async () => {
  const gate = await source("lib/hub-keychain/gate.ts");
  assert.match(gate, /production \? "__Host-oalab-keychain" : "oalab-keychain"/);
  assert.match(gate, /\{ httpOnly: true, secure: production, sameSite: "strict", path: "\/", maxAge: MAX_OPEN_MINUTES \* 60 \}/);
  assert.match(gate, /\.eq\("token_hash", unlockTokenHash\(token\)\)\.eq\("user_id", admin\.userId\)\.eq\("session_id", admin\.sessionId\)/);
  assert.match(gate, /\.is\("ended_at", null\)\.gt\("expires_at", now\)\.gt\("hard_until", now\)/);
  // A failed read of wrong codes counts as locked.
  assert.match(gate, /if \(error\) return Array\.from\(\{ length: 10 \}, \(\) => Date\.now\(\)\);/);
});

test("keychain: an admin-only page in the sidebar, under „Verwaltung“", async () => {
  const data = await source("lib/hub-data.ts");
  assert.match(data, /export const adminSections: readonly HubSection\[\] = \["users", "ai-log", "keychain"\];/);
  assert.match(data, /keychain: "Schlüsselbund",/);
  const sidebar = await source("components/hub/glass-sidebar.tsx");
  assert.match(sidebar, /<Link \{\.\.\.item\("keychain"\)\}>/);
  const page = await source("app/dashboard/[section]/page.tsx");
  assert.match(page, /validSection === "keychain" \? loadKeychain\(\) : undefined/);
});
