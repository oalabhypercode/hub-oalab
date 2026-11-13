"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import { isUuid, LOOK_LIMIT, LOOK_WINDOW_MINUTES, loginKinds, readLogin, readSecret, readVaultOwner, type VaultOwner } from "@/lib/hub-domains/rules";
import { currentUnlock, extendUnlock, keychainAdmin, lockOf, type KeychainAdmin, type OpenUnlock } from "@/lib/hub-keychain/gate";
import type { KeychainLock } from "@/lib/hub-keychain/types";
import { readSealed, removeSealed, storeSealed } from "./store";

// Passwords of mailboxes and logins („Zugangsdaten“ under „Vertrag & Domain“, and the „Schlüsselbund“). Every action is
// a public POST endpoint and checks first an active admin and an open Schlüsselbund: unlocked in this browser and this
// sign-in with the code from the admin's authenticator app (lib/hub-keychain/gate.ts). Only then does the service role
// touch anything, and each action keeps the keychain open ten more minutes. Every look and every change lands in
// hub_admin_events, never with the password; a password is shown only after its look is logged. Nothing here sends mail,
// Telegram or bell messages, talks to the assistant or writes to the server log, and errors are fixed texts, so no
// password can travel anywhere but back to the admin who asked.

export type VaultResult<T> = { ok: true; data: T } | { ok: false; error: string; lock?: KeychainLock };

type Context = { db: SupabaseClient; actorId: string; key: Buffer | null; admin: KeychainAdmin; unlock: OpenUnlock };
type Checked = { ok: true; ctx: Context } | { ok: false; error: string; lock?: KeychainLock };

const failed = (error: string) => ({ ok: false as const, error });
const denied = "Dafür brauchst du einen aktiven Admin-Zugang.";
const locked = "Der Schlüsselbund ist gesperrt. Entsperre ihn mit dem Code aus deiner Authenticator-App.";
const missingKey = "Auf dem Server fehlt der Schlüssel für die Zugangsdaten (HUB_VAULT_KEY). Bis er eingetragen ist, lassen sich keine Passwörter speichern oder anzeigen.";
const gone = "Diesen Zugang gibt es nicht mehr.";
const tryAgain = "Das hat gerade nicht geklappt. Bitte versuche es erneut.";

async function context(needsKey: boolean): Promise<Checked> {
  const admin = await keychainAdmin();
  if (!admin) return failed(denied);
  const unlock = await currentUnlock(admin);
  if (!unlock) return { ok: false, error: locked, lock: await lockOf(admin).catch(() => undefined) };
  if (needsKey && !admin.key) return failed(missingKey);
  return { ok: true, ctx: { db: admin.db, actorId: admin.userId, key: admin.key, admin, unlock } };
}

/** Writes the admin log; false if that failed. The summary names the mailbox or login, never the password. */
async function log(ctx: Context, action: string, summary: string, customerId: string | null) {
  const { error } = await ctx.db.from("hub_admin_events").insert({ actor_id: ctx.actorId, action, summary: summary.slice(0, 300), target_customer_id: customerId });
  return !error;
}

const loginName = (kind: string, label: string) => `Login ${label} (${loginKinds[kind as keyof typeof loginKinds] ?? kind})`;

/** The mailbox (only a real mailbox, no forward or alias) or login a password belongs to; oalab's own logins have no customer. */
async function findOwner(ctx: Context, owner: VaultOwner): Promise<{ customerId: string | null; name: string } | null> {
  if (owner.kind === "mailbox") {
    const { data, error } = await ctx.db.from("hub_customer_mailboxes").select("customer_id, address, kind").eq("id", owner.id).maybeSingle<{ customer_id: string; address: string; kind: string }>();
    return !error && data && data.kind === "mailbox" ? { customerId: data.customer_id, name: `Postfach ${data.address}` } : null;
  }
  const { data, error } = await ctx.db.from("hub_customer_logins").select("customer_id, kind, label").eq("id", owner.id).maybeSingle<{ customer_id: string | null; kind: string; label: string }>();
  return !error && data ? { customerId: data.customer_id, name: loginName(data.kind, data.label) } : null;
}

/** Admins may look at a limited number of passwords per window; a failed count counts as too many. */
async function tooManyLooks(ctx: Context) {
  const since = new Date(Date.now() - LOOK_WINDOW_MINUTES * 60_000).toISOString();
  const { count, error } = await ctx.db.from("hub_admin_events").select("id", { count: "exact", head: true })
    .eq("actor_id", ctx.actorId).in("action", ["vault.revealed", "vault.copied"]).gte("created_at", since);
  return Boolean(error) || (count ?? 0) >= LOOK_LIMIT;
}

/* ---------- Passwords ---------- */

/** Opens a password for showing (30 seconds in the page) or copying. The look is logged before the password leaves. */
export async function revealSecret(input: { owner?: unknown; purpose?: unknown }): Promise<VaultResult<{ secret: string; until: string }>> {
  const checked = await context(true);
  if (!checked.ok) return checked;
  const { ctx } = checked;
  const owner = readVaultOwner(input?.owner);
  if (!owner || !ctx.key) return failed(gone);
  const target = await findOwner(ctx, owner);
  if (!target) return failed(gone);
  if (await tooManyLooks(ctx)) return failed(`Du hast in den letzten ${LOOK_WINDOW_MINUTES} Minuten schon ${LOOK_LIMIT} Passwörter angesehen oder kopiert. Bitte warte ein paar Minuten.`);
  const read = await readSealed(ctx.db, ctx.key, owner, "password");
  if (!read.ok) return read;
  if (read.text === null) return failed("Für diesen Zugang ist kein Passwort hinterlegt.");
  const copy = input?.purpose === "copy";
  // The server cannot see the clipboard: a copy is logged as the password handed out for copying.
  if (!await log(ctx, copy ? "vault.copied" : "vault.revealed", `Passwort ${copy ? "zum Kopieren abgerufen" : "angezeigt"}: ${target.name}`, target.customerId)) return failed(tryAgain);
  return { ok: true, data: { secret: read.text, until: await extendUnlock(ctx.admin, ctx.unlock) } };
}

/** Stores a new password for a mailbox or login, or replaces the stored one. */
export async function saveSecret(input: { owner?: unknown; secret?: unknown }): Promise<VaultResult<{ created: boolean; until: string }>> {
  const checked = await context(true);
  if (!checked.ok) return checked;
  const { ctx } = checked;
  const owner = readVaultOwner(input?.owner);
  if (!owner || !ctx.key) return failed(gone);
  const secret = readSecret(input?.secret);
  if (!secret.ok) return secret;
  const target = await findOwner(ctx, owner);
  if (!target) return failed(gone);
  const stored = await storeSealed(ctx.db, ctx.key, owner, "password", secret.value, ctx.actorId);
  if (!stored.ok) return stored;
  await log(ctx, stored.created ? "vault.saved" : "vault.changed", `Passwort ${stored.created ? "hinterlegt" : "geändert"}: ${target.name}`, target.customerId);
  refreshWorkspace();
  return { ok: true, data: { created: stored.created, until: await extendUnlock(ctx.admin, ctx.unlock) } };
}

export async function removeSecret(input: { owner?: unknown }): Promise<VaultResult<{ until: string }>> {
  const checked = await context(false);
  if (!checked.ok) return checked;
  const { ctx } = checked;
  const owner = readVaultOwner(input?.owner);
  if (!owner) return failed(gone);
  const target = await findOwner(ctx, owner);
  if (!target) return failed(gone);
  const removed = await removeSealed(ctx.db, owner, "password");
  if (!removed.ok) return removed;
  if (!removed.removed) return failed("Für diesen Zugang ist kein Passwort hinterlegt.");
  await log(ctx, "vault.removed", `Passwort entfernt: ${target.name}`, target.customerId);
  refreshWorkspace();
  return { ok: true, data: { until: await extendUnlock(ctx.admin, ctx.unlock) } };
}

/* ---------- Provider logins (Vertrag & Domain) ---------- */

/**
 * Creates a login of a customer, with its password if one is given, or updates the details of one of the same customer
 * (its password changes through saveSecret). The category comes from the Schlüsselbund's fixed list.
 */
export async function saveLogin(input: { id?: unknown; customerId?: unknown; secret?: unknown } & Record<string, unknown>): Promise<VaultResult<{ id: string }>> {
  const checked = await context(false);
  if (!checked.ok) return checked;
  const { ctx } = checked;
  const customerId = input?.customerId;
  if (!isUuid(customerId)) return failed("Diesen Kunden gibt es nicht mehr.");
  const customer = await ctx.db.from("hub_customers").select("id, kind").eq("id", customerId).maybeSingle<{ id: string; kind: string | null }>();
  if (customer.error || !customer.data || (customer.data.kind ?? "customer") !== "customer") return failed("Diesen Kunden gibt es nicht mehr.");
  const login = readLogin(input ?? {});
  if (!login.ok) return login;
  const row = { kind: login.value.kind, label: login.value.label, login_url: login.value.loginUrl, username: login.value.username, updated_by: ctx.actorId };
  const name = loginName(login.value.kind, login.value.label);
  const refused = (code?: string) => failed(code === "23503" ? "Bitte wähle eine Kategorie aus der Liste." : code === "23514" ? "Bitte die Eingaben prüfen." : tryAgain);
  if (input.id !== undefined && input.id !== null && input.id !== "") {
    if (!isUuid(input.id)) return failed(gone);
    const { data, error } = await ctx.db.from("hub_customer_logins").update(row).eq("id", input.id).eq("customer_id", customerId).select("id").maybeSingle<{ id: string }>();
    if (error) return refused(error.code);
    if (!data) return failed(gone);
    await log(ctx, "vault.login_updated", `Zugang geändert: ${name}`, customerId);
    await extendUnlock(ctx.admin, ctx.unlock);
    refreshWorkspace();
    return { ok: true, data: { id: data.id } };
  }
  const typed = typeof input.secret === "string" && input.secret !== "" ? readSecret(input.secret) : null;
  if (typed && !typed.ok) return typed;
  if (typed && !ctx.key) return failed(missingKey);
  const { data, error } = await ctx.db.from("hub_customer_logins").insert({ ...row, customer_id: customerId, created_by: ctx.actorId }).select("id").single<{ id: string }>();
  if (error || !data) return refused(error?.code);
  await log(ctx, "vault.login_created", `Zugang angelegt: ${name}`, customerId);
  await extendUnlock(ctx.admin, ctx.unlock);
  if (typed?.ok && ctx.key) {
    const stored = await storeSealed(ctx.db, ctx.key, { kind: "login", id: data.id }, "password", typed.value, ctx.actorId);
    refreshWorkspace();
    if (!stored.ok) return failed(`Der Zugang ist angelegt, das Passwort aber nicht gespeichert: ${stored.error}`);
    await log(ctx, "vault.saved", `Passwort hinterlegt: ${name}`, customerId);
    return { ok: true, data: { id: data.id } };
  }
  refreshWorkspace();
  return { ok: true, data: { id: data.id } };
}

/** Deletes a login with its password and note. */
export async function deleteLogin(input: { id?: unknown }): Promise<VaultResult<null>> {
  const checked = await context(false);
  if (!checked.ok) return checked;
  const { ctx } = checked;
  if (!isUuid(input?.id)) return failed(gone);
  const secret = await ctx.db.from("hub_vault_secrets").select("id").eq("login_id", input.id).eq("purpose", "password").maybeSingle<{ id: string }>();
  if (secret.error) return failed(tryAgain);
  const { data, error } = await ctx.db.from("hub_customer_logins").delete().eq("id", input.id).select("customer_id, kind, label").maybeSingle<{ customer_id: string | null; kind: string; label: string }>();
  if (error) return failed(tryAgain);
  if (!data) return failed(gone);
  await log(ctx, "vault.login_deleted", `Zugang gelöscht${secret.data ? " samt Passwort" : ""}: ${loginName(data.kind, data.label)}`, data.customer_id);
  await extendUnlock(ctx.admin, ctx.unlock);
  refreshWorkspace();
  return { ok: true, data: null };
}
