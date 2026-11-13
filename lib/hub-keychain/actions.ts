"use server";

import QRCode from "qrcode";
import { maskEmail, readMailCode } from "@/lib/hub-auth/mail-code";
import { isUuid, MAX_NOTE, readLogin, readSecret, readVaultOwner, type VaultOwner } from "@/lib/hub-domains/rules";
import { mailKeychainCode } from "@/lib/hub-mail/notify";
import { matchTotpStep, newTotpSecret, totpUri } from "@/lib/platform/totp";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import { sendTelegram } from "@/lib/hub-telegram/server";
import { openSecret, sealSecret } from "@/lib/hub-vault/crypto";
import { readSealed, removeSealed, storeSealed } from "@/lib/hub-vault/store";
import { newRecoveryCodes, newSetupCode, recoveryCodeHash, setupCodeHash } from "./codes";
import { currentUnlock, endUnlock, extendUnlock, hasConfirmedApp, keychainAdmin, lockOf, logKeychain, recoveryCodesLeft, startUnlock, wrongCodeTimes, type KeychainAdmin, type OpenUnlock } from "./gate";
import {
  APP_ISSUER, CODE_ATTEMPTS, LOCK_MINUTES, MAILBOX_CATEGORY, NEW_CATEGORY_ICONS, SETUP_CODE_ATTEMPTS, SETUP_CODE_MINUTES, SETUP_WINDOW_MINUTES,
  categoryId, formatRecoveryCode, groupedKey, isCategoryIcon, isCategoryId, lockState, nameTaken, normalizeRecoveryCode, readCategoryName, recoveryState,
} from "./rules";
import type { KeychainLock } from "./types";

// The „Schlüsselbund“. Every action is a public POST endpoint and checks first an active hub admin with this sign-in
// (lib/hub-keychain/gate.ts). Linking the app needs a fresh code by mail (or, to replace an app, the open keychain);
// opening needs the app's code (once per code) or a recovery code; reading and changing accesses needs the open
// keychain and keeps it open ten more minutes. Wrong codes count in the admin log and lock the door; Telegram hears of a
// lock and of every recovery code, never a code itself. No code, password or note travels anywhere but back to the admin.

export type KeychainResult<T> = { ok: true; data: T } | { ok: false; error: string; lock?: KeychainLock };

const failed = (error: string, lock?: KeychainLock) => ({ ok: false as const, error, ...(lock ? { lock } : {}) });
const adminsOnly = failed("Der Schlüsselbund ist nur für Admins.");
const missingKey = failed("Auf dem Server fehlt der Schlüssel für die Zugangsdaten (HUB_VAULT_KEY). Bis er eingetragen ist, lässt sich der Schlüsselbund nicht nutzen.");
const tryAgain = failed("Das hat gerade nicht geklappt. Bitte versuche es erneut.");
const lockedText = "Der Schlüsselbund ist gesperrt. Entsperre ihn mit dem Code aus deiner Authenticator-App.";
const gone = failed("Diesen Zugang gibt es nicht mehr.");
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const clock = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
const blockedText = (until: number | string) => `Zu viele falsche Codes. Der Schlüsselbund bleibt bis ${clock.format(new Date(until))} Uhr zu.`;

type Open = { ok: true; admin: KeychainAdmin; unlock: OpenUnlock } | { ok: false; error: string; lock?: KeychainLock };

/** The admin with the keychain open in this sign-in; otherwise why not, with where they stand. */
async function openKeychain(): Promise<Open> {
  const admin = await keychainAdmin();
  if (!admin) return adminsOnly;
  const unlock = await currentUnlock(admin);
  if (!unlock) return failed(lockedText, await lockOf(admin).catch(() => undefined));
  return { ok: true, admin, unlock };
}

async function firstName(admin: KeychainAdmin) {
  const { data } = await admin.db.from("hub_profiles").select("first_name").eq("user_id", admin.userId).maybeSingle<{ first_name: string }>();
  return data?.first_name?.trim() ?? "";
}

/** A short note into the admins' Telegram group: who, what; never a code. */
async function tellTeam(admin: KeychainAdmin, text: string) {
  const name = (await firstName(admin)) || "Ein Admin";
  await sendTelegram({ text: `Schlüsselbund · ${name}\n${text}` });
}

/* ---------- Status ---------- */

/** Where the admin stands now (for the page after the time ran out or another tab changed it). */
export async function keychainStatus(): Promise<KeychainResult<{ lock: KeychainLock }>> {
  const admin = await keychainAdmin();
  if (!admin) return adminsOnly;
  return { ok: true, data: { lock: await lockOf(admin) } };
}

/* ---------- Linking the app ---------- */

/** Step 1: a six-digit code to the admin's own address, valid ten minutes for this sign-in. */
export async function sendKeychainSetupCode(): Promise<KeychainResult<{ email: string }>> {
  const admin = await keychainAdmin();
  if (!admin) return adminsOnly;
  if (!admin.key) return missingKey;
  if (!admin.email) return failed("Für deinen Zugang ist keine E-Mail-Adresse hinterlegt.");
  // Replacing a linked app needs the keychain open: a sign-in alone never swaps the app.
  if (await hasConfirmedApp(admin) && !(await currentUnlock(admin))) return failed("Zum Neu-Verbinden entsperre den Schlüsselbund zuerst, mit der App oder einem Notfall-Code.");
  const previous = await admin.db.from("hub_keychain_setup_codes").select("created_at").eq("user_id", admin.userId).maybeSingle<{ created_at: string }>();
  if (previous.data && Date.now() - Date.parse(previous.data.created_at) < 60_000) return failed("Ein Code ist gerade unterwegs. Bitte warte eine Minute, bevor du einen neuen anforderst.");
  const code = newSetupCode();
  const issuedAt = new Date();
  const { error } = await admin.db.from("hub_keychain_setup_codes").upsert({
    user_id: admin.userId, session_id: admin.sessionId, code_hash: setupCodeHash(admin.sessionId, code), attempts: 0,
    created_at: issuedAt.toISOString(), expires_at: new Date(issuedAt.getTime() + SETUP_CODE_MINUTES * 60_000).toISOString(), verified_at: null,
  }, { onConflict: "user_id" });
  if (error) return tryAgain;
  const status = await mailKeychainCode(admin.email, { firstName: await firstName(admin), code, minutes: SETUP_CODE_MINUTES, issuedAt });
  if (status !== "sent") return failed("Die E-Mail mit dem Code ließ sich gerade nicht senden. Bitte versuche es gleich noch einmal.");
  await logKeychain(admin, "keychain.setup_code", "Code zum Einrichten des Schlüsselbunds angefordert");
  return { ok: true, data: { email: maskEmail(admin.email) } };
}

/** Step 2: the mail code; then a new key for the app, shown as QR code and as text to type. */
export async function confirmKeychainSetupCode(input: { code?: unknown }): Promise<KeychainResult<{ qr: string; key: string }>> {
  const admin = await keychainAdmin();
  if (!admin) return adminsOnly;
  if (!admin.key) return missingKey;
  const code = readMailCode(input?.code);
  if (!code) return failed("Bitte gib die 6 Ziffern aus der E-Mail ein.");
  const { data: row, error } = await admin.db.from("hub_keychain_setup_codes").select("session_id, code_hash, attempts, expires_at, verified_at").eq("user_id", admin.userId)
    .maybeSingle<{ session_id: string; code_hash: string; attempts: number; expires_at: string; verified_at: string | null }>();
  if (error) return tryAgain;
  if (!row || row.session_id !== admin.sessionId) return failed("Fordere zuerst einen Code an.");
  if (Date.parse(row.expires_at) < Date.now()) return failed("Der Code ist abgelaufen. Fordere einen neuen an.");
  if (row.attempts >= SETUP_CODE_ATTEMPTS) return failed("Zu viele falsche Versuche. Fordere einen neuen Code an.");
  if (row.code_hash !== setupCodeHash(admin.sessionId, code)) {
    await admin.db.from("hub_keychain_setup_codes").update({ attempts: row.attempts + 1 }).eq("user_id", admin.userId);
    const left = SETUP_CODE_ATTEMPTS - row.attempts - 1;
    return failed(left > 0 ? `Der Code passt nicht. Noch ${plural(left, "Versuch", "Versuche")}.` : "Der Code passt nicht. Fordere einen neuen Code an.");
  }
  await admin.db.from("hub_keychain_setup_codes").update({ verified_at: new Date().toISOString() }).eq("user_id", admin.userId);
  // The new app's key, waiting for its first code; a linked app stops counting from here on.
  const secret = newTotpSecret();
  const sealed = sealSecret(admin.key, { kind: "keychain-app", id: admin.userId }, secret);
  const stored = await admin.db.from("hub_keychain_factors").upsert({
    user_id: admin.userId, key_version: sealed.keyVersion, iv: sealed.iv, auth_tag: sealed.authTag, ciphertext: sealed.ciphertext, confirmed_at: null, last_step: null,
  }, { onConflict: "user_id" });
  if (stored.error) return tryAgain;
  const svg = await QRCode.toString(totpUri(APP_ISSUER, admin.email, secret), { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return { ok: true, data: { qr: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, key: groupedKey(secret) } };
}

/** Step 3: the first code from the app confirms it; eight new recovery codes (shown once), and the keychain opens. */
export async function confirmKeychainApp(input: { code?: unknown }): Promise<KeychainResult<{ codes: string[]; lock: KeychainLock }>> {
  const admin = await keychainAdmin();
  if (!admin) return adminsOnly;
  if (!admin.key) return missingKey;
  const code = readMailCode(input?.code);
  if (!code) return failed("Bitte gib die 6 Ziffern aus der App ein.");
  const setup = await admin.db.from("hub_keychain_setup_codes").select("session_id, verified_at").eq("user_id", admin.userId).maybeSingle<{ session_id: string; verified_at: string | null }>();
  if (setup.error) return tryAgain;
  if (!setup.data?.verified_at || setup.data.session_id !== admin.sessionId || Date.parse(setup.data.verified_at) < Date.now() - SETUP_WINDOW_MINUTES * 60_000) {
    return failed("Bitte bestätige zuerst den Code aus der E-Mail.");
  }
  const factor = await admin.db.from("hub_keychain_factors").select("key_version, iv, auth_tag, ciphertext, confirmed_at").eq("user_id", admin.userId)
    .maybeSingle<{ key_version: number; iv: string; auth_tag: string; ciphertext: string; confirmed_at: string | null }>();
  if (factor.error || !factor.data || factor.data.confirmed_at) return failed("Bitte starte die Einrichtung neu.");
  const secret = openSecret(admin.key, { kind: "keychain-app", id: admin.userId }, { keyVersion: factor.data.key_version, iv: factor.data.iv, authTag: factor.data.auth_tag, ciphertext: factor.data.ciphertext });
  if (!secret) return failed("Bitte starte die Einrichtung neu.");
  const step = matchTotpStep(secret, code);
  if (step === null) return failed("Der Code passt nicht. Nimm den Eintrag „oalab Schlüsselbund“ in der App und den aktuellen Code.");
  const confirmed = await admin.db.from("hub_keychain_factors").update({ confirmed_at: new Date().toISOString(), last_step: step }).eq("user_id", admin.userId).is("confirmed_at", null).select("user_id").maybeSingle();
  if (confirmed.error || !confirmed.data) return tryAgain;
  // Eight new recovery codes; the old ones stop counting.
  const codes = newRecoveryCodes();
  await admin.db.from("hub_keychain_recovery_codes").delete().eq("user_id", admin.userId);
  const saved = await admin.db.from("hub_keychain_recovery_codes").insert(codes.map((item) => ({ user_id: admin.userId, code_hash: recoveryCodeHash(admin.key!, admin.userId, item) })));
  if (saved.error) return failed("Die App ist verbunden, die Notfall-Codes aber nicht gespeichert. Richte die App bitte noch einmal ein.");
  await admin.db.from("hub_keychain_setup_codes").delete().eq("user_id", admin.userId);
  await startUnlock(admin, "setup");
  await logKeychain(admin, "keychain.setup", "Authenticator-App für den Schlüsselbund verbunden, 8 neue Notfall-Codes");
  return { ok: true, data: { codes: codes.map(formatRecoveryCode), lock: await lockOf(admin) } };
}

/* ---------- Opening and locking ---------- */

/** Records a wrong code; at the fifth within the window the door shuts and the team hears of it. */
async function wrongCode(admin: KeychainAdmin, wrong: number[], what: string) {
  await logKeychain(admin, "keychain.code_wrong", `Falscher ${what} für den Schlüsselbund`);
  const now = Date.now();
  const was = lockState(wrong, now);
  const state = lockState([...wrong, now], now);
  if (state.locked && state.until) {
    // The team hears of it once, when the door shuts; a wrong recovery code in the block only goes to the log.
    if (!was.locked) {
      await logKeychain(admin, "keychain.blocked", `Schlüsselbund nach ${CODE_ATTEMPTS} falschen Codes ${LOCK_MINUTES} Minuten gesperrt`);
      await tellTeam(admin, `${CODE_ATTEMPTS} falsche Codes in ${LOCK_MINUTES} Minuten: Der Schlüsselbund ist bis ${clock.format(new Date(state.until))} Uhr gesperrt. Warst du das nicht, ändere sofort dein Passwort.`);
    }
    const lock: KeychainLock = { status: "blocked", until: new Date(state.until).toISOString(), recoveryLeft: await recoveryCodesLeft(admin) };
    return failed(was.locked ? `Der ${what} passt nicht. Der Schlüsselbund bleibt bis ${clock.format(new Date(state.until))} Uhr zu.` : blockedText(state.until), lock);
  }
  return failed(`Der ${what} passt nicht. Noch ${plural(state.left, "Versuch", "Versuche")}, dann bleibt der Schlüsselbund ${LOCK_MINUTES} Minuten zu.`, { status: "locked", attemptsLeft: state.left, recoveryLeft: await recoveryCodesLeft(admin) });
}

/** Opens the keychain with the app's code, each code once. */
export async function unlockKeychain(input: { code?: unknown }): Promise<KeychainResult<{ lock: KeychainLock }>> {
  const admin = await keychainAdmin();
  if (!admin) return adminsOnly;
  if (!admin.key) return missingKey;
  const factor = await admin.db.from("hub_keychain_factors").select("key_version, iv, auth_tag, ciphertext, confirmed_at, last_step").eq("user_id", admin.userId)
    .maybeSingle<{ key_version: number; iv: string; auth_tag: string; ciphertext: string; confirmed_at: string | null; last_step: number | null }>();
  if (factor.error) return tryAgain;
  if (!factor.data?.confirmed_at) return failed("Richte zuerst deine Authenticator-App für den Schlüsselbund ein.", { status: "setup" });
  const wrong = await wrongCodeTimes(admin);
  const before = lockState(wrong, Date.now());
  if (before.locked && before.until) return failed(blockedText(before.until), { status: "blocked", until: new Date(before.until).toISOString(), recoveryLeft: await recoveryCodesLeft(admin) });
  const code = readMailCode(input?.code);
  if (!code) return failed("Bitte gib die 6 Ziffern aus der App ein.");
  const secret = openSecret(admin.key, { kind: "keychain-app", id: admin.userId }, { keyVersion: factor.data.key_version, iv: factor.data.iv, authTag: factor.data.auth_tag, ciphertext: factor.data.ciphertext });
  if (!secret) return failed("Der Schlüssel der App lässt sich mit dem Schlüssel auf dem Server nicht öffnen. Entsperre mit einem Notfall-Code und verbinde die App neu.");
  const step = matchTotpStep(secret, code);
  // A code counts once: a step at or before the last one used is a replay (or a code someone saw).
  if (step === null || (factor.data.last_step !== null && step <= Number(factor.data.last_step))) return wrongCode(admin, wrong, "Code");
  const claimed = await admin.db.from("hub_keychain_factors").update({ last_step: step }).eq("user_id", admin.userId)
    .or(`last_step.is.null,last_step.lt.${step}`).select("user_id").maybeSingle();
  if (claimed.error) return tryAgain;
  if (!claimed.data) return wrongCode(admin, wrong, "Code");
  if (!(await startUnlock(admin, "app"))) return tryAgain;
  await logKeychain(admin, "keychain.unlocked", "Schlüsselbund entsperrt (Code aus der App)");
  return { ok: true, data: { lock: await lockOf(admin) } };
}

/** Opens the keychain with one of the eight recovery codes; it counts once, and the team hears of it. */
export async function unlockKeychainWithRecovery(input: { code?: unknown }): Promise<KeychainResult<{ lock: KeychainLock }>> {
  const admin = await keychainAdmin();
  if (!admin) return adminsOnly;
  if (!admin.key) return missingKey;
  if (!(await hasConfirmedApp(admin))) return failed("Richte zuerst deine Authenticator-App für den Schlüsselbund ein.", { status: "setup" });
  const wrong = await wrongCodeTimes(admin);
  // The block stops the app's code; a recovery code still opens, until RECOVERY_CAP wrong codes in the window.
  const now = Date.now();
  const gate = recoveryState(wrong, now);
  const block = lockState(wrong, now);
  if (!gate.allowed && gate.until && block.until) {
    return failed(`Zu viele falsche Codes. Ein Notfall-Code geht wieder ab ${clock.format(new Date(gate.until))} Uhr.`, { status: "blocked", until: new Date(block.until).toISOString(), recoveryLeft: await recoveryCodesLeft(admin) });
  }
  const code = normalizeRecoveryCode(input?.code);
  if (!code) return failed("Ein Notfall-Code hat acht Zeichen, zum Beispiel 7KQ2-M9XD.");
  const used = await admin.db.from("hub_keychain_recovery_codes").update({ used_at: new Date().toISOString() }).eq("user_id", admin.userId)
    .eq("code_hash", recoveryCodeHash(admin.key, admin.userId, code)).is("used_at", null).select("id").maybeSingle();
  if (used.error) return tryAgain;
  if (!used.data) return wrongCode(admin, wrong, "Notfall-Code");
  if (!(await startUnlock(admin, "recovery"))) return tryAgain;
  const left = await recoveryCodesLeft(admin);
  await logKeychain(admin, "keychain.unlocked", `Schlüsselbund entsperrt (Notfall-Code, noch ${left} übrig)`);
  await tellTeam(admin, `Ein Notfall-Code für den Schlüsselbund wurde benutzt. Noch ${plural(left, "Code", "Codes")} übrig.`);
  return { ok: true, data: { lock: await lockOf(admin) } };
}

/** Locks again in this sign-in: every shown password hides, the next look needs a code. */
export async function lockKeychain(): Promise<KeychainResult<{ lock: KeychainLock }>> {
  const admin = await keychainAdmin();
  if (!admin) return adminsOnly;
  await endUnlock(admin);
  await logKeychain(admin, "keychain.locked", "Schlüsselbund gesperrt");
  return { ok: true, data: { lock: await lockOf(admin) } };
}

/* ---------- Accesses ---------- */

const MAX_NOTE_CHARS = MAX_NOTE;
const readNote = (value: unknown) => typeof value === "string"
  ? value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim().slice(0, MAX_NOTE_CHARS)
  : null;

async function categoryOf(admin: KeychainAdmin, id: unknown) {
  if (!isCategoryId(id)) return null;
  const { data } = await admin.db.from("hub_keychain_categories").select("id, name").eq("id", id).maybeSingle<{ id: string; name: string }>();
  return data ?? null;
}

/**
 * Creates or changes a login: its customer (or oalab itself), category, name, address and user name; on creation also
 * its password and note. Mailboxes stay in „Vertrag & Domain“; here they only get a password and a note.
 */
export async function saveKeychainEntry(input: { id?: unknown; ownerId?: unknown; categoryId?: unknown; label?: unknown; loginUrl?: unknown; username?: unknown; secret?: unknown; note?: unknown }): Promise<KeychainResult<{ id: string; until: string }>> {
  const open = await openKeychain();
  if (!open.ok) return open;
  const { admin, unlock } = open;
  const category = await categoryOf(admin, input?.categoryId);
  if (!category) return failed("Bitte wähle eine Kategorie aus der Liste.");
  const ownerId = input?.ownerId === null || input?.ownerId === undefined || input?.ownerId === "" ? null : input.ownerId;
  if (ownerId !== null) {
    if (!isUuid(ownerId)) return failed("Diesen Kunden gibt es nicht mehr.");
    const customer = await admin.db.from("hub_customers").select("kind").eq("id", ownerId).maybeSingle<{ kind: string | null }>();
    if (customer.error || !customer.data || (customer.data.kind ?? "customer") !== "customer") return failed("Diesen Kunden gibt es nicht mehr.");
  }
  const login = readLogin({ kind: category.id, label: input?.label, loginUrl: input?.loginUrl, username: input?.username });
  if (!login.ok) return login;
  const secret = typeof input?.secret === "string" && input.secret !== "" ? readSecret(input.secret) : null;
  if (secret && !secret.ok) return secret;
  const note = readNote(input?.note);
  if ((secret || note) && !admin.key) return missingKey;
  const row = { customer_id: ownerId, kind: category.id, label: login.value.label, login_url: login.value.loginUrl, username: login.value.username, updated_by: admin.userId };
  const name = `${login.value.label} (${category.name})`;
  let id: string;
  if (input?.id !== undefined && input?.id !== null && input?.id !== "") {
    if (!isUuid(input.id)) return gone;
    const { data, error } = await admin.db.from("hub_customer_logins").update(row).eq("id", input.id).select("id").maybeSingle<{ id: string }>();
    if (error) return failed(error.code === "23503" ? "Bitte wähle eine Kategorie aus der Liste." : "Bitte die Eingaben prüfen.");
    if (!data) return gone;
    id = data.id;
    await logKeychain(admin, "keychain.entry_updated", `Zugang geändert: ${name}`, ownerId as string | null);
  } else {
    const { data, error } = await admin.db.from("hub_customer_logins").insert({ ...row, created_by: admin.userId }).select("id").single<{ id: string }>();
    if (error || !data) return failed(error?.code === "23503" ? "Bitte wähle eine Kategorie aus der Liste." : "Bitte die Eingaben prüfen.");
    id = data.id;
    await logKeychain(admin, "keychain.entry_created", `Zugang angelegt: ${name}`, ownerId as string | null);
  }
  const owner: VaultOwner = { kind: "login", id };
  if (secret?.ok && admin.key) {
    const stored = await storeSealed(admin.db, admin.key, owner, "password", secret.value, admin.userId);
    if (!stored.ok) return failed(`Der Zugang ist gespeichert, das Passwort aber nicht: ${stored.error}`);
    await logKeychain(admin, stored.created ? "vault.saved" : "vault.changed", `Passwort ${stored.created ? "hinterlegt" : "geändert"}: Login ${name}`, ownerId as string | null);
  }
  if (note && admin.key) {
    const stored = await storeSealed(admin.db, admin.key, owner, "note", note, admin.userId);
    if (!stored.ok) return failed(`Der Zugang ist gespeichert, die Notiz aber nicht: ${stored.error}`);
  }
  const until = await extendUnlock(admin, unlock);
  refreshWorkspace();
  return { ok: true, data: { id, until } };
}

/** Deletes a login with its password and note. Mailboxes go only in „Vertrag & Domain“. */
export async function deleteKeychainEntry(input: { id?: unknown }): Promise<KeychainResult<{ until: string }>> {
  const open = await openKeychain();
  if (!open.ok) return open;
  const { admin, unlock } = open;
  if (!isUuid(input?.id)) return gone;
  const { data, error } = await admin.db.from("hub_customer_logins").delete().eq("id", input.id).select("customer_id, label").maybeSingle<{ customer_id: string | null; label: string }>();
  if (error) return tryAgain;
  if (!data) return gone;
  await logKeychain(admin, "keychain.entry_deleted", `Zugang gelöscht: ${data.label}`, data.customer_id);
  const until = await extendUnlock(admin, unlock);
  refreshWorkspace();
  return { ok: true, data: { until } };
}

/** The customer of a mailbox or login, for the log; undefined if it does not exist. */
async function ownerCustomer(admin: KeychainAdmin, owner: VaultOwner): Promise<string | null | undefined> {
  if (owner.kind === "mailbox") {
    const { data } = await admin.db.from("hub_customer_mailboxes").select("customer_id, kind").eq("id", owner.id).maybeSingle<{ customer_id: string; kind: string }>();
    return data && data.kind === "mailbox" ? data.customer_id : undefined;
  }
  const { data } = await admin.db.from("hub_customer_logins").select("customer_id").eq("id", owner.id).maybeSingle<{ customer_id: string | null }>();
  return data ? data.customer_id : undefined;
}

/** Opens a note (encrypted like the password); the look is logged first. */
export async function revealKeychainNote(input: { owner?: unknown }): Promise<KeychainResult<{ note: string; until: string }>> {
  const open = await openKeychain();
  if (!open.ok) return open;
  const { admin, unlock } = open;
  if (!admin.key) return missingKey;
  const owner = readVaultOwner(input?.owner);
  const customerId = owner ? await ownerCustomer(admin, owner) : undefined;
  if (!owner || customerId === undefined) return gone;
  const read = await readSealed(admin.db, admin.key, owner, "note");
  if (!read.ok) return read;
  if (read.text !== null && !(await logKeychain(admin, "vault.note_revealed", `Notiz angezeigt (${owner.kind === "mailbox" ? "Postfach" : "Login"})`, customerId))) return tryAgain;
  return { ok: true, data: { note: read.text ?? "", until: await extendUnlock(admin, unlock) } };
}

/** Stores, changes or (empty) removes a note. */
export async function saveKeychainNote(input: { owner?: unknown; note?: unknown }): Promise<KeychainResult<{ until: string }>> {
  const open = await openKeychain();
  if (!open.ok) return open;
  const { admin, unlock } = open;
  if (!admin.key) return missingKey;
  const owner = readVaultOwner(input?.owner);
  const customerId = owner ? await ownerCustomer(admin, owner) : undefined;
  if (!owner || customerId === undefined) return gone;
  const note = readNote(input?.note) ?? "";
  if (note) {
    const stored = await storeSealed(admin.db, admin.key, owner, "note", note, admin.userId);
    if (!stored.ok) return stored;
  } else {
    const removed = await removeSealed(admin.db, owner, "note");
    if (!removed.ok) return removed;
  }
  await logKeychain(admin, "vault.note_changed", note ? "Notiz gespeichert" : "Notiz entfernt", customerId);
  const until = await extendUnlock(admin, unlock);
  refreshWorkspace();
  return { ok: true, data: { until } };
}

/* ---------- Categories (settings) ---------- */

type CategoryRow = { id: string; name: string; position: number; fixed: boolean };

async function allCategories(admin: KeychainAdmin) {
  const { data, error } = await admin.db.from("hub_keychain_categories").select("id, name, position, fixed").order("position").order("name").returns<CategoryRow[]>();
  return error ? null : data ?? [];
}

/** A new category (name and symbol) or a new name for one; the list stays fixed for everyone. */
export async function saveKeychainCategory(input: { id?: unknown; name?: unknown; icon?: unknown }): Promise<KeychainResult<{ id: string }>> {
  const admin = await keychainAdmin();
  if (!admin) return adminsOnly;
  const name = readCategoryName(input?.name);
  if (!name) return failed("Bitte gib der Kategorie einen Namen.");
  const categories = await allCategories(admin);
  if (!categories) return tryAgain;
  const editing = typeof input?.id === "string" && input.id !== "" ? categories.find((category) => category.id === input.id) : undefined;
  if (input?.id && !editing) return failed("Diese Kategorie gibt es nicht mehr.");
  if (nameTaken(name, categories, editing?.id)) return failed("Diese Kategorie gibt es schon.");
  if (editing) {
    const { error } = await admin.db.from("hub_keychain_categories").update({ name, updated_by: admin.userId }).eq("id", editing.id);
    if (error) return failed(error.code === "23505" ? "Diese Kategorie gibt es schon." : "Das hat gerade nicht geklappt. Bitte versuche es erneut.");
    await logKeychain(admin, "keychain.category_renamed", `Kategorie umbenannt: ${editing.name} → ${name}`);
    refreshWorkspace();
    return { ok: true, data: { id: editing.id } };
  }
  const icon = isCategoryIcon(input?.icon) && NEW_CATEGORY_ICONS.includes(input.icon) ? input.icon : "key-round";
  const id = categoryId(name, categories.map((category) => category.id));
  const position = Math.max(0, ...categories.map((category) => category.position)) + 10;
  const { error } = await admin.db.from("hub_keychain_categories").insert({ id, name, icon, position, created_by: admin.userId, updated_by: admin.userId });
  if (error) return failed(error.code === "23505" ? "Diese Kategorie gibt es schon." : "Das hat gerade nicht geklappt. Bitte versuche es erneut.");
  await logKeychain(admin, "keychain.category_created", `Kategorie angelegt: ${name}`);
  refreshWorkspace();
  return { ok: true, data: { id } };
}

/** One step up or down; the order is the order of the groups. */
export async function moveKeychainCategory(input: { id?: unknown; direction?: unknown }): Promise<KeychainResult<null>> {
  const admin = await keychainAdmin();
  if (!admin) return adminsOnly;
  const categories = await allCategories(admin);
  if (!categories) return tryAgain;
  const index = categories.findIndex((category) => category.id === input?.id);
  const to = index + (input?.direction === "up" ? -1 : 1);
  if (index < 0 || to < 0 || to >= categories.length) return { ok: true, data: null };
  const order = [...categories];
  [order[index], order[to]] = [order[to], order[index]];
  // Positions 10, 20, 30 … in the new order, only where they change.
  for (const [position, category] of order.entries()) {
    if (category.position === (position + 1) * 10) continue;
    const { error } = await admin.db.from("hub_keychain_categories").update({ position: (position + 1) * 10, updated_by: admin.userId }).eq("id", category.id);
    if (error) return tryAgain;
  }
  refreshWorkspace();
  return { ok: true, data: null };
}

/** Deletes an unused category; „Postfächer“ and categories with accesses stay. */
export async function deleteKeychainCategory(input: { id?: unknown }): Promise<KeychainResult<null>> {
  const admin = await keychainAdmin();
  if (!admin) return adminsOnly;
  if (!isCategoryId(input?.id)) return failed("Diese Kategorie gibt es nicht mehr.");
  if (input.id === MAILBOX_CATEGORY) return failed("„Postfächer“ gehört zu Vertrag & Domain und bleibt.");
  const { data, error } = await admin.db.from("hub_keychain_categories").delete().eq("id", input.id).select("name").maybeSingle<{ name: string }>();
  if (error) return failed(error.code === "23503" ? "In dieser Kategorie liegen noch Zugänge. Verschiebe sie zuerst in eine andere." : error.code === "23514" ? "Diese Kategorie bleibt." : "Das hat gerade nicht geklappt. Bitte versuche es erneut.");
  if (!data) return failed("Diese Kategorie gibt es nicht mehr.");
  await logKeychain(admin, "keychain.category_deleted", `Kategorie gelöscht: ${data.name}`);
  refreshWorkspace();
  return { ok: true, data: null };
}
