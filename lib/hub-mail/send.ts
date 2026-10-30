import "server-only";
import nodemailer from "nodemailer";
import { cleanEmail } from "@/lib/hub-users/rules";
import { legalLinks } from "@/lib/legal-links";
import { MAIL_IMAGES } from "./images";
import { readSmtpResult, readSmtpSettings, smtpError, smtpMessage, smtpTransport, type InlineImage, type MailStatus, type OutgoingMail } from "./smtp";

export type { MailStatus };
export type MailResult = { status: MailStatus; id?: string; error?: string };

/**
 * Mail settings from the environment. Without SMTP access (SMTP_HOST, SMTP_USER, SMTP_PASSWORD) the hub runs in
 * test mode: mails are built and logged as skipped, never sent. Sender and reply address default to hub@oalab.de
 * and info@oalab.de; the sender has to be the SMTP mailbox (or one of its aliases).
 */
export function mailSettings() {
  const smtp = readSmtpSettings(process.env);
  const team = (process.env.HUB_TEAM_EMAIL ?? "info@oalab.de").split(",").flatMap((value) => {
    const email = cleanEmail(value);
    return email.ok ? [email.value] : [];
  });
  return {
    configured: smtp !== null,
    smtp,
    from: process.env.MAIL_FROM?.trim() || "oalab Client Hub <hub@oalab.de>",
    replyTo: process.env.MAIL_REPLY_TO?.trim() || "info@oalab.de",
    team,
    legal: { imprint: legalLinks.imprint, privacy: legalLinks.privacy },
  };
}

/** What the logs may say about a mail: its kind. Subjects carry names, so they stay out like addresses and content. */
const kindOf = (mail: OutgoingMail) => mail.kind ?? "ohne Art";

/** The pictures a mail shows, as inline attachments; names without a picture are skipped. */
const inlineImages = (ids: string[] = []): InlineImage[] => ids.flatMap((id) => Object.hasOwn(MAIL_IMAGES, id)
  ? [{ filename: `${id}.png`, content: MAIL_IMAGES[id as keyof typeof MAIL_IMAGES], encoding: "base64" as const, contentType: "image/png" as const, cid: `${id}@hub.oalab.de` }]
  : []);

/** Sends one mail through the SMTP server; never throws. The password and the mail content never reach the logs. */
export async function sendMail(mail: OutgoingMail): Promise<MailResult> {
  const settings = mailSettings();
  if (!settings.smtp) {
    console.info(`[hub-mail] Testmodus, nicht gesendet: ${kindOf(mail)} an ${mail.to.length} Empfänger`);
    return { status: "skipped" };
  }
  try {
    const transport = nodemailer.createTransport(smtpTransport(settings.smtp));
    const result = readSmtpResult(await transport.sendMail(smtpMessage(settings.from, { ...mail, replyTo: mail.replyTo ?? settings.replyTo }, inlineImages(mail.images))));
    if (result.ok) return { status: "sent", id: result.id };
    console.error(`[hub-mail] Mailserver hat ${kindOf(mail)} abgelehnt: ${result.error}`);
    return { status: "failed", error: result.error };
  } catch (error) {
    const message = smtpError(error);
    console.error(`[hub-mail] ${kindOf(mail)} nicht gesendet: ${message}`);
    return { status: "failed", error: message };
  }
}
