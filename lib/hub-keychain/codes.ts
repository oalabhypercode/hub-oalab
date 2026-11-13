import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";

// Random values and their hashes for the „Schlüsselbund“. The database never sees a value that opens anything: the
// unlock cookie and the mail code only as SHA-256, the recovery codes only as HMAC with the server's vault key (so a
// copy of the database alone cannot try them out). Only node:crypto, so the tests load it directly; the alphabet and the
// count repeat those of ./rules.ts (the tests compare them).
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const RECOVERY_CODE_COUNT = 8;

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** The value of the unlock cookie: 32 random bytes, URL-safe. */
export const newUnlockToken = () => randomBytes(32).toString("base64url");
/** What the database keeps of an unlock cookie. */
export const unlockTokenHash = (token: string) => sha256(`oalab-keychain-unlock:${token}`);

/** The six-digit mail code before linking the app. */
export const newSetupCode = () => randomInt(0, 1_000_000).toString().padStart(6, "0");
/** Bound to the session it was sent for, like the login's mail code. */
export const setupCodeHash = (sessionId: string, code: string) => sha256(`oalab-keychain-setup:${sessionId}:${code}`);

/** Eight recovery codes of eight letters from the unambiguous alphabet, all different. */
export function newRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(Array.from({ length: 8 }, () => RECOVERY_ALPHABET[randomInt(0, RECOVERY_ALPHABET.length)]).join(""));
  return [...codes];
}

/** A recovery code's hash: HMAC-SHA256 with the vault key, bound to its admin. `code` is normalized („7KQ2M9XD“). */
export const recoveryCodeHash = (key: Buffer, userId: string, code: string) => createHmac("sha256", key).update(`oalab-keychain-recovery:${userId}:${code}`, "utf8").digest("hex");
