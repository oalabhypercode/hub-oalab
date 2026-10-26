import { createHash, randomInt } from "node:crypto";

// The six-digit code a login with second factor gets by e-mail. The database only sees its hash, bound to the
// Supabase session it was issued for (public.oalab_mail_code_issue / _verify). Self-contained, so `node --test`
// can load it.

/** How long a code stays valid; the database function uses the same 10 minutes. */
export const MAIL_CODE_MINUTES = 10;

/** A uniformly random code from 000000 to 999999. */
export function newMailCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** Six digits, whatever spaces the person typed or pasted. Null for anything else. */
export function readMailCode(value: unknown) {
  const code = typeof value === "string" ? value.replace(/\s/g, "") : "";
  return /^\d{6}$/.test(code) ? code : null;
}

/** What the database stores and compares: SHA-256 of "<session id>:<code>", so a code fits only its own session. */
export function mailCodeHash(sessionId: string, code: string) {
  return createHash("sha256").update(`${sessionId}:${code}`).digest("hex");
}

/** The address the code went to, readable for its owner but not for someone looking over a shoulder: in***@oalab.de. */
export function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "";
  return `${local.slice(0, Math.min(2, local.length - 1) || 1)}***@${domain}`;
}

/**
 * False for the reserved test domains of RFC 2606 / 6761 (example.*, .test, .invalid, .localhost): no mailbox, so a
 * code could never arrive and the login would be locked out.
 */
export function hasMailbox(email: string | null | undefined) {
  return Boolean(email?.includes("@")) && !/@(?:[^@]+\.)?(?:example\.(?:com|net|org)|example|test|invalid|localhost)$/i.test(email ?? "");
}

/** The outcomes of public.oalab_mail_code_verify. */
export type MailCodeCheck = "verified" | "wrong" | "locked" | "expired" | "missing";

export function isMailCodeCheck(value: unknown): value is MailCodeCheck {
  return value === "verified" || value === "wrong" || value === "locked" || value === "expired" || value === "missing";
}
