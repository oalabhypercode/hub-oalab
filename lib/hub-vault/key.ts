import "server-only";
import { keyFingerprint, parseVaultKey } from "./crypto";

/**
 * The vault key from HUB_VAULT_KEY: only in the live server's environment and the local .env.local, never in the
 * database, the repository or a NEXT_PUBLIC variable. Null while it is missing or malformed; the hub then shows and
 * saves no passwords.
 */
export const vaultKey = () => parseVaultKey(process.env.HUB_VAULT_KEY);

/** The key's short name for the page („3F9A-1C2E“), null without a key. */
export function vaultKeyId() {
  const key = vaultKey();
  return key ? keyFingerprint(key) : null;
}
