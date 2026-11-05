import "server-only";
import { parseVaultKey } from "./crypto";

/**
 * The vault key from HUB_VAULT_KEY: only in Vercel (Production) and the local .env.local, never in the database, the
 * repository or a NEXT_PUBLIC variable. Null while it is missing or malformed; the hub then shows and saves no passwords.
 */
export const vaultKey = () => parseVaultKey(process.env.HUB_VAULT_KEY);
