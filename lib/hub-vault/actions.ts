"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { isUuid, LOOK_LIMIT, LOOK_WINDOW_MINUTES, loginKinds, readLogin, readSecret, readVaultOwner, type LoginKind, type VaultOwner } from "@/lib/hub-domains/rules";
import { openSecret, sealSecret } from "./crypto";
import { vaultKey } from "./key";

// „Zugänge“: provider logins and the passwords of mailboxes and logins. Every action is a public POST endpoint and
// checks first, with the caller's own session, an access token with a confirmed second factor (aal2) and an active
// admin; a hub admin without a second factor gets no password and changes none. Only then does the service role touch
// anything. Every look and every change lands in hub_admin_events, never with the password; a password is shown only
// after its look is logged. Nothing here sends mail, Telegram or bell messages, talks to the assistant or writes to the
// server log, and errors are fixed texts, so no password can travel anywhere but back to the admin who asked.

export type VaultResult<T> = { ok: true; data: T } | { ok: false; error: string };

type Context = { db: SupabaseClient; actorId: string; key: Buffer | null };
type Checked = { ok: true; ctx: Context } | { ok: false; error: string };

const failed = (error: string) => ({ ok: false as const, error });
const needsCode = "Zugänge gibt es nur mit bestätigtem zweitem Faktor. Melde dich mit deinem Code neu an; ohne zweiten Faktor richtest du ihn zuerst im Profil ein.";
const denied = "Dafür brauchst du einen aktiven Admin-Zugang mit bestätigtem zweitem Faktor.";
const missingKey = "Auf dem Server fehlt der Schlüssel für die Zugänge (HUB_VAULT_KEY). Bis er eingetragen ist, lassen sich keine Passwörter speichern oder anzeigen.";
const gone = "Diesen Zugang gibt es nicht mehr.";
const tryAgain = "Das hat gerade nicht geklappt. Bitte versuche es erneut.";

async function context(needsKey: boolean): Promise<Checked> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims || data.claims.aal !== "aal2") return failed(needsCode);
  const admin = await verifyHubAdmin();
  if (!admin) return failed(denied);
  const db = createAdminClient();
  if (!db) return failed("Auf dem Server fehlt der Supabase Secret Key.");
  const key = vaultKey();
  if (needsKey && !key) return failed(missingKey);
  return { ok: true, ctx: { db, actorId: admin.userId, key } };
}

/** Writes the admin log; false if that failed. The summary names the mailbox or login, never the password. */
async function log(ctx: Context, action: string, summary: string, customerId: string) {
  const { error } = await ctx.db.from("hub_admin_events").insert({ actor_id: ctx.actorId, action, summary: summary.slice(0, 300), target_customer_id: customerId });
  return !error;
}

const loginName = (kind: LoginKind, label: string) => `Login ${label} (${loginKinds[kind] ?? "Sonstiges"})`;

/** The mailbox (only a real mailbox, no forward or alias) or provider login a password belongs to. */
async function findOwner(ctx: Context, owner: VaultOwner): Promise<{ customerId: string; name: string } | null> {
  if (owner.kind === "mailbox") {
    const { data, error } = await ctx.db.from("hub_customer_mailboxes").select("customer_id, address, kind").eq("id", owner.id).maybeSingle<{ customer_id: string; address: string; kind: string }>();
    return !error && data && data.kind === "mailbox" ? { customerId: data.customer_id, name: `Postfach ${data.address}` } : null;
  }
  const { data, error } = await ctx.db.from("hub_customer_logins").select("customer_id, kind, label").eq("id", owner.id).maybeSingle<{ customer_id: string; kind: LoginKind; label: string }>();
  return !error && data ? { customerId: data.customer_id, name: loginName(data.kind, data.label) } : null;
}

const ownerColumn = (owner: VaultOwner) => owner.kind === "mailbox" ? "mailbox_id" : "login_id";

/** Admins may look at a limited number of passwords per window; a failed count counts as too many. */
async function tooManyLooks(ctx: Context) {
  const since = new Date(Date.now() - LOOK_WINDOW_MINUTES * 60_000).toISOString();
  const { count, error } = await ctx.db.from("hub_admin_events").select("id", { count: "exact", head: true })
    .eq("actor_id", ctx.actorId).in("action", ["vault.revealed", "vault.copied"]).gte("created_at", since);
  return Boolean(error) || (count ?? 0) >= LOOK_LIMIT;
}

/** Seals and stores a password for its owner: an update when one exists, else a new row. */
async function storeSecret(ctx: Context & { key: Buffer }, owner: VaultOwner, secret: string): Promise<{ ok: true; created: boolean } | { ok: false; error: string }> {
  const existing = await ctx.db.from("hub_vault_secrets").select("id").eq(ownerColumn(owner), owner.id).maybeSingle<{ id: string }>();
  if (existing.error) return failed(tryAgain);
  const sealed = sealSecret(ctx.key, owner, secret);
  const row = { key_version: sealed.keyVersion, iv: sealed.iv, auth_tag: sealed.authTag, ciphertext: sealed.ciphertext, updated_by: ctx.actorId };
  const { error } = existing.data
    ? await ctx.db.from("hub_vault_secrets").update(row).eq("id", existing.data.id)
    : await ctx.db.from("hub_vault_secrets").insert({ ...row, [ownerColumn(owner)]: owner.id });
  if (error) return failed(error.code === "23514" ? "Nur ein Postfach hat ein Passwort, keine Weiterleitung und kein Alias." : error.code === "23505" ? "Gerade hat jemand anderes ein Passwort gespeichert. Bitte lade die Seite neu." : tryAgain);
  return { ok: true, created: !existing.data };
}

/* ---------- Passwords ---------- */

/** Opens a password for showing (30 seconds in the page) or copying. The look is logged before the password leaves. */
export async function revealSecret(input: { owner?: unknown; purpose?: unknown }): Promise<VaultResult<{ secret: string }>> {
  const checked = await context(true);
  if (!checked.ok) return checked;
  const { ctx } = checked;
  const owner = readVaultOwner(input?.owner);
  if (!owner || !ctx.key) return failed(gone);
  const target = await findOwner(ctx, owner);
  if (!target) return failed(gone);
  if (await tooManyLooks(ctx)) return failed(`Du hast in den letzten ${LOOK_WINDOW_MINUTES} Minuten schon ${LOOK_LIMIT} Passwörter angesehen oder kopiert. Bitte warte ein paar Minuten.`);
  const { data, error } = await ctx.db.from("hub_vault_secrets").select("key_version, iv, auth_tag, ciphertext").eq(ownerColumn(owner), owner.id)
    .maybeSingle<{ key_version: number; iv: string; auth_tag: string; ciphertext: string }>();
  if (error) return failed(tryAgain);
  if (!data) return failed("Für diesen Zugang ist kein Passwort hinterlegt.");
  const secret = openSecret(ctx.key, owner, { keyVersion: data.key_version, iv: data.iv, authTag: data.auth_tag, ciphertext: data.ciphertext });
  if (secret === null) return failed("Dieses Passwort lässt sich mit dem Schlüssel auf dem Server nicht öffnen. Wurde HUB_VAULT_KEY geändert?");
  const copy = input?.purpose === "copy";
  if (!await log(ctx, copy ? "vault.copied" : "vault.revealed", `Passwort ${copy ? "kopiert" : "angezeigt"}: ${target.name}`, target.customerId)) return failed(tryAgain);
  return { ok: true, data: { secret } };
}

/** Stores a new password for a mailbox or login, or replaces the stored one. */
export async function saveSecret(input: { owner?: unknown; secret?: unknown }): Promise<VaultResult<{ created: boolean }>> {
  const checked = await context(true);
  if (!checked.ok) return checked;
  const { ctx } = checked;
  const owner = readVaultOwner(input?.owner);
  if (!owner || !ctx.key) return failed(gone);
  const secret = readSecret(input?.secret);
  if (!secret.ok) return secret;
  const target = await findOwner(ctx, owner);
  if (!target) return failed(gone);
  const stored = await storeSecret({ ...ctx, key: ctx.key }, owner, secret.value);
  if (!stored.ok) return stored;
  await log(ctx, stored.created ? "vault.saved" : "vault.changed", `Passwort ${stored.created ? "hinterlegt" : "geändert"}: ${target.name}`, target.customerId);
  refreshWorkspace();
  return { ok: true, data: { created: stored.created } };
}

export async function removeSecret(input: { owner?: unknown }): Promise<VaultResult<null>> {
  const checked = await context(false);
  if (!checked.ok) return checked;
  const { ctx } = checked;
  const owner = readVaultOwner(input?.owner);
  if (!owner) return failed(gone);
  const target = await findOwner(ctx, owner);
  if (!target) return failed(gone);
  const { data, error } = await ctx.db.from("hub_vault_secrets").delete().eq(ownerColumn(owner), owner.id).select("id").maybeSingle<{ id: string }>();
  if (error) return failed(tryAgain);
  if (!data) return failed("Für diesen Zugang ist kein Passwort hinterlegt.");
  await log(ctx, "vault.removed", `Passwort entfernt: ${target.name}`, target.customerId);
  refreshWorkspace();
  return { ok: true, data: null };
}

/* ---------- Provider logins ---------- */

/**
 * Creates a provider login of a customer, with its password if one is given, or updates the details of one of the
 * same customer (its password changes through saveSecret).
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
  if (input.id !== undefined && input.id !== null && input.id !== "") {
    if (!isUuid(input.id)) return failed(gone);
    const { data, error } = await ctx.db.from("hub_customer_logins").update(row).eq("id", input.id).eq("customer_id", customerId).select("id").maybeSingle<{ id: string }>();
    if (error) return failed(error.code === "23514" ? "Bitte die Eingaben prüfen." : tryAgain);
    if (!data) return failed(gone);
    await log(ctx, "vault.login_updated", `Zugang geändert: ${name}`, customerId);
    refreshWorkspace();
    return { ok: true, data: { id: data.id } };
  }
  const typed = typeof input.secret === "string" && input.secret !== "" ? readSecret(input.secret) : null;
  if (typed && !typed.ok) return typed;
  if (typed && !ctx.key) return failed(missingKey);
  const { data, error } = await ctx.db.from("hub_customer_logins").insert({ ...row, customer_id: customerId, created_by: ctx.actorId }).select("id").single<{ id: string }>();
  if (error || !data) return failed(error?.code === "23514" ? "Bitte die Eingaben prüfen." : tryAgain);
  await log(ctx, "vault.login_created", `Zugang angelegt: ${name}`, customerId);
  if (typed?.ok && ctx.key) {
    const owner: VaultOwner = { kind: "login", id: data.id };
    const stored = await storeSecret({ ...ctx, key: ctx.key }, owner, typed.value);
    refreshWorkspace();
    if (!stored.ok) return failed(`Der Zugang ist angelegt, das Passwort aber nicht gespeichert: ${stored.error}`);
    await log(ctx, "vault.saved", `Passwort hinterlegt: ${name}`, customerId);
    return { ok: true, data: { id: data.id } };
  }
  refreshWorkspace();
  return { ok: true, data: { id: data.id } };
}

/** Deletes a provider login with its password. */
export async function deleteLogin(input: { id?: unknown }): Promise<VaultResult<null>> {
  const checked = await context(false);
  if (!checked.ok) return checked;
  const { ctx } = checked;
  if (!isUuid(input?.id)) return failed(gone);
  const secret = await ctx.db.from("hub_vault_secrets").select("id").eq("login_id", input.id).maybeSingle<{ id: string }>();
  if (secret.error) return failed(tryAgain);
  const { data, error } = await ctx.db.from("hub_customer_logins").delete().eq("id", input.id).select("customer_id, kind, label").maybeSingle<{ customer_id: string; kind: LoginKind; label: string }>();
  if (error) return failed(tryAgain);
  if (!data) return failed(gone);
  await log(ctx, "vault.login_deleted", `Zugang gelöscht${secret.data ? " samt Passwort" : ""}: ${loginName(data.kind, data.label)}`, data.customer_id);
  refreshWorkspace();
  return { ok: true, data: null };
}
