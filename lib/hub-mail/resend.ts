/**
 * The Resend REST call (POST https://api.resend.com/emails), as pure functions: request and response handling
 * without network or secrets, so `node --test` checks them. lib/hub-mail/send.ts does the actual sending.
 */

export const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** "sent" went to Resend, "skipped" means no API key (test mode), "failed" means Resend refused or was unreachable. */
export type MailStatus = "sent" | "skipped" | "failed";

export type OutgoingMail = {
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** Resend tags (ASCII letters, digits, "_" and "-") for filtering in the Resend dashboard. */
  tags?: { name: string; value: string }[];
  /** Sending the same key again within 24 hours does not send the mail twice. */
  idempotencyKey?: string;
};

const tagValue = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256);

export function resendRequest(apiKey: string, from: string, mail: OutgoingMail) {
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  if (mail.idempotencyKey) headers["Idempotency-Key"] = mail.idempotencyKey.slice(0, 256);
  const body: Record<string, unknown> = { from, to: mail.to.slice(0, 50), subject: mail.subject, html: mail.html, text: mail.text };
  if (mail.replyTo) body.reply_to = mail.replyTo;
  if (mail.tags?.length) body.tags = mail.tags.map((tag) => ({ name: tagValue(tag.name), value: tagValue(tag.value) }));
  return { url: RESEND_ENDPOINT, init: { method: "POST", headers, body: JSON.stringify(body) } };
}

export type ResendResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Resend answers {"id": …} on success and {"name", "message", "statusCode"} on errors. Errors stay short and lose
 * any e-mail address, since they end up in the logs and in hub_notifications.
 */
export function readResendResponse(status: number, payload: unknown): ResendResult {
  const body = (payload ?? {}) as { id?: unknown; name?: unknown; message?: unknown };
  if (status >= 200 && status < 300 && typeof body.id === "string") return { ok: true, id: body.id };
  const name = typeof body.name === "string" ? body.name : `http_${status}`;
  const message = typeof body.message === "string" ? body.message : "";
  return { ok: false, error: `${name}${message ? `: ${message}` : ""}`.replace(/[^\s@<>"'`]+@[^\s@<>"'`]+/g, "[Adresse]").slice(0, 300) };
}
