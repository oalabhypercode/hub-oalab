import "server-only";
import { cleanEmail } from "@/lib/hub-users/rules";
import { legalLinks } from "@/lib/legal-links";
import { readResendResponse, resendRequest, type MailStatus, type OutgoingMail } from "./resend";

export type { MailStatus };
export type MailResult = { status: MailStatus; id?: string; error?: string };

/**
 * Mail settings from the environment. Without RESEND_API_KEY the hub runs in test mode: mails are built and
 * logged as skipped, never sent. Sender and reply address default to hub@oalab.de and info@oalab.de.
 */
export function mailSettings() {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? "";
  const team = (process.env.HUB_TEAM_EMAIL ?? "info@oalab.de").split(",").flatMap((value) => {
    const email = cleanEmail(value);
    return email.ok ? [email.value] : [];
  });
  return {
    configured: apiKey.length > 0,
    apiKey,
    from: process.env.MAIL_FROM?.trim() || "oalab Client Hub <hub@oalab.de>",
    replyTo: process.env.MAIL_REPLY_TO?.trim() || "info@oalab.de",
    team,
    legal: { imprint: legalLinks.imprint, privacy: legalLinks.privacy },
  };
}

/** What the logs may say about a mail: its kind tag. Subjects carry names, so they stay out like addresses and content. */
const kindOf = (mail: OutgoingMail) => mail.tags?.find((tag) => tag.name === "kind")?.value ?? "ohne Art";

/** Sends one mail through Resend; never throws. The key and the mail content never reach the logs. */
export async function sendMail(mail: OutgoingMail): Promise<MailResult> {
  const settings = mailSettings();
  if (!settings.configured) {
    console.info(`[hub-mail] Testmodus, nicht gesendet: ${kindOf(mail)} an ${mail.to.length} Empfänger`);
    return { status: "skipped" };
  }
  try {
    const { url, init } = resendRequest(settings.apiKey, settings.from, { ...mail, replyTo: mail.replyTo ?? settings.replyTo });
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
    const result = readResendResponse(response.status, await response.json().catch(() => null));
    if (result.ok) return { status: "sent", id: result.id };
    console.error(`[hub-mail] Resend hat ${kindOf(mail)} abgelehnt: ${result.error}`);
    return { status: "failed", error: result.error };
  } catch (error) {
    const message = error instanceof Error ? error.name : "unbekannt";
    console.error(`[hub-mail] Resend nicht erreichbar (${message})`);
    return { status: "failed", error: `Resend nicht erreichbar (${message})` };
  }
}
