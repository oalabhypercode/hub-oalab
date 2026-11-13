import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VaultOwner } from "@/lib/hub-domains/rules";
import { openSecret, sealSecret, type VaultOwnerRef } from "./crypto";

// Reading and writing hub_vault_secrets for the vault's actions (Vertrag & Domain, Schlüsselbund). Each mailbox or
// login has at most one password and one note (purpose, migration 202611130001); both only as ciphertext, sealed with
// the owner and the purpose as additional data, so a note never opens as a password or on another row.

export type SecretPurpose = "password" | "note";
type Failure = { ok: false; error: string };
const tryAgain = "Das hat gerade nicht geklappt. Bitte versuche es erneut.";

export const ownerColumn = (owner: VaultOwner) => owner.kind === "mailbox" ? "mailbox_id" : "login_id";
const sealedOwner = (owner: VaultOwner, purpose: SecretPurpose): VaultOwnerRef => ({ kind: purpose === "note" ? `${owner.kind}-note` : owner.kind, id: owner.id });

/** Seals and stores a password or note: an update when one exists, else a new row. */
export async function storeSealed(db: SupabaseClient, key: Buffer, owner: VaultOwner, purpose: SecretPurpose, text: string, actorId: string): Promise<{ ok: true; created: boolean } | Failure> {
  const existing = await db.from("hub_vault_secrets").select("id").eq(ownerColumn(owner), owner.id).eq("purpose", purpose).maybeSingle<{ id: string }>();
  if (existing.error) return { ok: false, error: tryAgain };
  const sealed = sealSecret(key, sealedOwner(owner, purpose), text);
  const row = { key_version: sealed.keyVersion, iv: sealed.iv, auth_tag: sealed.authTag, ciphertext: sealed.ciphertext, updated_by: actorId };
  const { error } = existing.data
    ? await db.from("hub_vault_secrets").update(row).eq("id", existing.data.id)
    : await db.from("hub_vault_secrets").insert({ ...row, purpose, [ownerColumn(owner)]: owner.id });
  if (error) {
    return { ok: false, error: error.code === "23514" ? "Nur ein Postfach hat ein Passwort, keine Weiterleitung und kein Alias." : error.code === "23505" ? "Gerade hat jemand anderes gespeichert. Bitte lade die Seite neu." : tryAgain };
  }
  return { ok: true, created: !existing.data };
}

/** Opens a stored password or note; text null when none is stored. */
export async function readSealed(db: SupabaseClient, key: Buffer, owner: VaultOwner, purpose: SecretPurpose): Promise<{ ok: true; text: string | null } | Failure> {
  const { data, error } = await db.from("hub_vault_secrets").select("key_version, iv, auth_tag, ciphertext").eq(ownerColumn(owner), owner.id).eq("purpose", purpose)
    .maybeSingle<{ key_version: number; iv: string; auth_tag: string; ciphertext: string }>();
  if (error) return { ok: false, error: tryAgain };
  if (!data) return { ok: true, text: null };
  const text = openSecret(key, sealedOwner(owner, purpose), { keyVersion: data.key_version, iv: data.iv, authTag: data.auth_tag, ciphertext: data.ciphertext });
  if (text === null) return { ok: false, error: "Das lässt sich mit dem Schlüssel auf dem Server nicht öffnen. Wurde HUB_VAULT_KEY geändert?" };
  return { ok: true, text };
}

/** Removes a stored password or note; removed false when there was none. */
export async function removeSealed(db: SupabaseClient, owner: VaultOwner, purpose: SecretPurpose): Promise<{ ok: true; removed: boolean } | Failure> {
  const { data, error } = await db.from("hub_vault_secrets").delete().eq(ownerColumn(owner), owner.id).eq("purpose", purpose).select("id");
  if (error) return { ok: false, error: tryAgain };
  return { ok: true, removed: (data ?? []).length > 0 };
}
