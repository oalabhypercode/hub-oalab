import "server-only";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { vaultKey } from "@/lib/hub-vault/key";
import { newUnlockToken, unlockTokenHash } from "./codes";
import { LOCK_MINUTES, MAX_OPEN_MINUTES, lockState, nextExpiry, unlockWindow } from "./rules";
import type { KeychainLock } from "./types";

// The door of the „Schlüsselbund“: whether this admin, in this browser and this sign-in, has opened it with the app.
// An unlock is a random value in an httpOnly cookie that only this server reads; the database keeps its SHA-256 with
// the auth session, so another browser, another sign-in or the end of the sign-in never inherits it. Ten minutes after
// the last action, an hour at most. Wrong codes land in the admin log and lock the door for a while.

const production = process.env.NODE_ENV === "production";
/** __Host-: only this host, only https, path / (the browser enforces it). Locally (http) without the prefix. */
export const UNLOCK_COOKIE = production ? "__Host-oalab-keychain" : "oalab-keychain";

export type KeychainAdmin = { db: SupabaseClient; userId: string; sessionId: string; email: string; key: Buffer | null };
export type OpenUnlock = { id: string; via: "app" | "recovery" | "setup"; expiresAt: string; hardUntil: string };
type UnlockRow = { id: string; via: OpenUnlock["via"]; expires_at: string; hard_until: string };

/** The signed-in hub admin with session, service-role client and vault key; null for everyone else. */
export async function keychainAdmin(): Promise<KeychainAdmin | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims || typeof claims.session_id !== "string" || typeof claims.sub !== "string") return null;
  const admin = await verifyHubAdmin();
  if (!admin || admin.userId !== claims.sub) return null;
  const db = createAdminClient();
  if (!db) return null;
  return { db, userId: admin.userId, sessionId: claims.session_id, email: typeof claims.email === "string" ? claims.email : "", key: vaultKey() };
}

/** This session's open unlock from the cookie, or null (no cookie, someone else's, ended, run out). */
export async function currentUnlock(admin: KeychainAdmin): Promise<OpenUnlock | null> {
  const token = (await cookies()).get(UNLOCK_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const now = new Date().toISOString();
  const { data, error } = await admin.db.from("hub_keychain_unlocks").select("id, via, expires_at, hard_until")
    .eq("token_hash", unlockTokenHash(token)).eq("user_id", admin.userId).eq("session_id", admin.sessionId)
    .is("ended_at", null).gt("expires_at", now).gt("hard_until", now).maybeSingle<UnlockRow>();
  if (error || !data) return null;
  return { id: data.id, via: data.via, expiresAt: data.expires_at, hardUntil: data.hard_until };
}

/** Ten more minutes after an action (never past the hard end); the new end. */
export async function extendUnlock(admin: KeychainAdmin, unlock: OpenUnlock): Promise<string> {
  const until = new Date(nextExpiry(Date.now(), Date.parse(unlock.hardUntil))).toISOString();
  const { error } = await admin.db.from("hub_keychain_unlocks").update({ expires_at: until }).eq("id", unlock.id).is("ended_at", null);
  return error ? unlock.expiresAt : until;
}

/** Opens the keychain for this sign-in: earlier unlocks of the session end, a new cookie is set. */
export async function startUnlock(admin: KeychainAdmin, via: OpenUnlock["via"]): Promise<{ until: string; hardUntil: string } | null> {
  const token = newUnlockToken();
  const { expiresAt, hardUntil } = unlockWindow(Date.now());
  await admin.db.from("hub_keychain_unlocks").update({ ended_at: new Date().toISOString() }).eq("user_id", admin.userId).eq("session_id", admin.sessionId).is("ended_at", null);
  const until = new Date(expiresAt).toISOString();
  const hard = new Date(hardUntil).toISOString();
  const { error } = await admin.db.from("hub_keychain_unlocks").insert({ user_id: admin.userId, session_id: admin.sessionId, token_hash: unlockTokenHash(token), via, expires_at: until, hard_until: hard });
  if (error) return null;
  (await cookies()).set(UNLOCK_COOKIE, token, { httpOnly: true, secure: production, sameSite: "strict", path: "/", maxAge: MAX_OPEN_MINUTES * 60 });
  return { until, hardUntil: hard };
}

/** Locks again: every open unlock of this sign-in ends, the cookie goes. */
export async function endUnlock(admin: KeychainAdmin) {
  await admin.db.from("hub_keychain_unlocks").update({ ended_at: new Date().toISOString() }).eq("user_id", admin.userId).eq("session_id", admin.sessionId).is("ended_at", null);
  (await cookies()).delete(UNLOCK_COOKIE);
}

/**
 * The times of wrong codes since the last unlock, within the lock window. A failed read counts as locked: the door stays
 * shut rather than letting someone try on.
 */
export async function wrongCodeTimes(admin: KeychainAdmin): Promise<number[]> {
  const since = new Date(Date.now() - LOCK_MINUTES * 60_000).toISOString();
  const { data, error } = await admin.db.from("hub_admin_events").select("action, created_at").eq("actor_id", admin.userId)
    .in("action", ["keychain.code_wrong", "keychain.unlocked"]).gte("created_at", since).order("created_at", { ascending: false }).limit(50)
    .returns<{ action: string; created_at: string }[]>();
  if (error) return Array.from({ length: 10 }, () => Date.now());
  const times: number[] = [];
  for (const row of data ?? []) {
    if (row.action === "keychain.unlocked") break;
    times.push(Date.parse(row.created_at));
  }
  return times;
}

/** Whether the admin's app is set up and confirmed. */
export async function hasConfirmedApp(admin: KeychainAdmin) {
  const { data, error } = await admin.db.from("hub_keychain_factors").select("confirmed_at").eq("user_id", admin.userId).maybeSingle<{ confirmed_at: string | null }>();
  return !error && Boolean(data?.confirmed_at);
}

/** Unused recovery codes of the admin. */
export async function recoveryCodesLeft(admin: KeychainAdmin) {
  const { count, error } = await admin.db.from("hub_keychain_recovery_codes").select("id", { count: "exact", head: true }).eq("user_id", admin.userId).is("used_at", null);
  return error ? 0 : count ?? 0;
}

/** Where the admin stands now: to set up, locked, shut after wrong codes, or open until when. */
export async function lockOf(admin: KeychainAdmin): Promise<KeychainLock> {
  if (!(await hasConfirmedApp(admin))) return { status: "setup" };
  const [unlock, recoveryLeft, wrong] = await Promise.all([currentUnlock(admin), recoveryCodesLeft(admin), wrongCodeTimes(admin)]);
  if (unlock) return { status: "unlocked", until: unlock.expiresAt, hardUntil: unlock.hardUntil, via: unlock.via, recoveryLeft };
  const state = lockState(wrong, Date.now());
  if (state.locked && state.until) return { status: "blocked", until: new Date(state.until).toISOString(), recoveryLeft };
  return { status: "locked", attemptsLeft: state.left, recoveryLeft };
}

/** The admin log; false if writing failed. Never a password, code or note in the summary. */
export async function logKeychain(admin: KeychainAdmin, action: string, summary: string, customerId: string | null = null) {
  const { error } = await admin.db.from("hub_admin_events").insert({ actor_id: admin.userId, action, summary: summary.slice(0, 300), target_customer_id: customerId });
  return !error;
}
