import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for the passwords under „Zugänge“. The hub server seals a password with the key from HUB_VAULT_KEY before
 * it reaches the database (hub_vault_secrets holds ciphertext only) and opens it only for an admin with a confirmed
 * second factor. The additional data binds each ciphertext to its owner, a mailbox or a provider login: copied onto
 * another row it no longer opens. Self-contained, so the tests load it directly; the key is read in ./key.ts.
 */

export const VAULT_KEY_VERSION = 1;

export type VaultOwnerRef = { kind: "mailbox" | "login"; id: string };
/** As stored: Base64 of the 12-byte IV, the 16-byte tag and the ciphertext. */
export type SealedSecret = { keyVersion: number; iv: string; authTag: string; ciphertext: string };

/** The key as HUB_VAULT_KEY holds it: 32 random bytes in Base64 (44 characters). Anything else counts as no key. */
export function parseVaultKey(value: string | null | undefined): Buffer | null {
  const text = value?.trim() ?? "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(text)) return null;
  const key = Buffer.from(text, "base64");
  return key.length === 32 ? key : null;
}

const additionalData = (owner: VaultOwnerRef, version: number) => Buffer.from(`oalab-hub-vault:v${version}:${owner.kind}:${owner.id}`, "utf8");

export function sealSecret(key: Buffer, owner: VaultOwnerRef, plaintext: string): SealedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  cipher.setAAD(additionalData(owner, VAULT_KEY_VERSION));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { keyVersion: VAULT_KEY_VERSION, iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

/** Opens a sealed password; null when key, owner or ciphertext do not fit, never a partial or wrong text. */
export function openSecret(key: Buffer, owner: VaultOwnerRef, sealed: SealedSecret): string | null {
  if (sealed.keyVersion !== VAULT_KEY_VERSION) return null;
  try {
    const iv = Buffer.from(sealed.iv, "base64");
    const tag = Buffer.from(sealed.authTag, "base64");
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    decipher.setAAD(additionalData(owner, sealed.keyVersion));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
