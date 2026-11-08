import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Authenticator apps (RFC 6238 as Supabase MFA issued them: SHA-1, six digits, 30 seconds). Secrets travel as base32;
// Better Auth stores carried-over and Hub-made apps as `base32:<secret>`. Self-contained, so `node --test` can load it.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text: string) {
  const clean = text.toUpperCase().replace(/=+$/u, "").replace(/\s+/gu, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new TypeError("not base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(output);
}

export function newTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: Uint8Array, counter: number) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, "0");
}

/** A six-digit code of this window or the one before or after (clock drift), compared in constant time. */
export function verifyTotp(base32Secret: string, code: string, now = Date.now()) {
  if (!/^\d{6}$/u.test(code)) return false;
  let secret: Uint8Array;
  try {
    secret = base32Decode(base32Secret);
  } catch {
    return false;
  }
  if (secret.length < 10) return false;
  const counter = Math.floor(now / 30_000);
  let match = false;
  for (const step of [-1, 0, 1]) {
    if (timingSafeEqual(Buffer.from(totpCode(secret, counter + step)), Buffer.from(code))) match = true;
  }
  return match;
}

/** The `otpauth://` link an authenticator app reads from the QR code. */
export function totpUri(issuer: string, account: string, secret: string) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
