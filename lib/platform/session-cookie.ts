import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// The session cookie both apps share, in Better Auth's signed format `<token>.<base64 HMAC-SHA256>`: Service OALab
// reads a session the Hub created and the other way round. Self-contained, so `node --test` can load it.

const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** 32 random characters, like Better Auth's `generateId(32)`. */
export function newSessionToken() {
  const bytes = randomBytes(32);
  return Array.from(bytes, (byte) => TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length]).join("");
}

export function signSessionToken(token: string, secret: string) {
  return `${token}.${createHmac("sha256", secret).update(token).digest("base64")}`;
}

/** The token of a correctly signed cookie value, else null. */
export function verifiedSessionToken(value: string | undefined, secret: string) {
  if (!value) return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  const dot = decoded.lastIndexOf(".");
  if (dot < 1) return null;
  const token = decoded.slice(0, dot);
  const signature = Buffer.from(decoded.slice(dot + 1));
  const expected = Buffer.from(createHmac("sha256", secret).update(token).digest("base64"));
  return signature.length === expected.length && timingSafeEqual(signature, expected) ? token : null;
}
