/**
 * The SMTP side of the hub's mails (the Netcup mailbox hub@oalab.de), as pure functions: settings, message and
 * result handling without network or secrets, so `node --test` checks them. lib/hub-mail/send.ts does the sending.
 */

/** "sent" was accepted by the mail server, "skipped" means no SMTP access (test mode), "failed" means refused or unreachable. */
export type MailStatus = "sent" | "skipped" | "failed";

export type OutgoingMail = {
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** The kind of mail (e.g. "registration.team"): an X-Hub-Mail header for mailbox filters, and all the logs say about it. */
  kind?: string;
  /** The pictures the HTML shows (cid:<id>@hub.oalab.de); lib/hub-mail/send.ts attaches them inline. */
  images?: string[];
};

/** A picture inside the mail, shown by the HTML through its content ID. */
export type InlineImage = { filename: string; content: string; encoding: "base64"; contentType: "image/png"; cid: string };

export type SmtpSettings = { host: string; port: number; secure: boolean; user: string; password: string };

/** SMTP access from the environment; null (test mode) unless host, user and password are set and the port is 465 or 587. */
export function readSmtpSettings(env: Record<string, string | undefined>): SmtpSettings | null {
  const host = env.SMTP_HOST?.trim() ?? "";
  const user = env.SMTP_USER?.trim() ?? "";
  const password = env.SMTP_PASSWORD ?? "";
  const port = Number(env.SMTP_PORT?.trim() || 465);
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) || !user || !password || (port !== 465 && port !== 587)) return null;
  return { host, port, secure: port === 465, user, password };
}

/** Transport options: always encrypted (465 directly, 587 only after STARTTLS) and with short timeouts. */
export function smtpTransport(settings: SmtpSettings) {
  return {
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    requireTLS: !settings.secure,
    auth: { user: settings.user, pass: settings.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
}

/** The message: at most 50 recipients, HTML with a plain-text alternative and its pictures inline, the kind as header. */
export function smtpMessage(from: string, mail: OutgoingMail, images: InlineImage[] = []) {
  return {
    from,
    to: mail.to.slice(0, 50),
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
    ...(mail.kind ? { headers: { "X-Hub-Mail": mail.kind.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 60) } } : {}),
    ...(images.length ? { attachments: images } : {}),
  };
}

export type SmtpResult = { ok: true; id: string } | { ok: false; error: string };

/** The server's answer: sent once it accepted a recipient. The message ID is kept as reference. */
export function readSmtpResult(info: { messageId?: unknown; accepted?: unknown; rejected?: unknown }): SmtpResult {
  const accepted = Array.isArray(info.accepted) ? info.accepted.length : 0;
  const rejected = Array.isArray(info.rejected) ? info.rejected.length : 0;
  if (!accepted) return { ok: false, error: `Empfänger abgelehnt (${rejected})` };
  return { ok: true, id: typeof info.messageId === "string" ? info.messageId.slice(0, 100) : "" };
}

/** A short error for the logs and hub_notifications: code, status and server answer, without e-mail addresses. */
export function smtpError(error: unknown): string {
  const failure = (error ?? {}) as { code?: unknown; responseCode?: unknown; response?: unknown; message?: unknown };
  const code = typeof failure.code === "string" ? failure.code : "SMTP";
  const status = typeof failure.responseCode === "number" ? ` ${failure.responseCode}` : "";
  const detail = typeof failure.response === "string" ? failure.response : typeof failure.message === "string" ? failure.message : "";
  return `${code}${status}${detail ? `: ${detail}` : ""}`.replace(/\s+/g, " ").replace(/[^\s@<>"'`]+@[^\s@<>"'`]+/g, "[Adresse]").slice(0, 300);
}
