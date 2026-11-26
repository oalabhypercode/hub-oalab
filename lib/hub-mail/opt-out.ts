import { createHmac, timingSafeEqual } from "node:crypto";
import type { MailOptOut } from "./templates";

/**
 * „Infomails abbestellen“ (26.11.2026): every info mail of the start series carries the login's own signed link, as
 * § 7 Abs. 3 UWG and Art. 21 DSGVO want a way to object in every such mail. The page asks before it switches anything
 * (mail scanners open links), mail programs post to the one-click address for their own „Abbestellen“ (RFC 8058). The
 * signature uses the server key of the calendar links (HUB_NOTIFY_TOKEN) under its own name, so neither link opens the
 * other; the choice sits in the login's user metadata, like `hub_mail_notifications` for the notification mails.
 * Self-contained apart from node:crypto, so `node --test` and the proxy read it directly.
 */

export const OPT_OUT_PATHS = { page: "/abmelden", oneClick: "/api/mail/abmelden" } as const;

/** The user metadata key: `false` once the login stopped the info mails; missing or anything else means they come. */
export const INFO_MAILS_KEY = "hub_info_mails";

export const infoMailsWanted = (metadata: Record<string, unknown> | null | undefined) => metadata?.[INFO_MAILS_KEY] !== false;

/** The key that signs the links; without it no info mail goes out, as none could carry its link. */
export const infoMailSecret = (env: Record<string, string | undefined> = process.env) => env.HUB_NOTIFY_TOKEN?.trim() || null;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function infoMailSignature(userId: string, secret: string) {
  return createHmac("sha256", secret).update(`hub-info-mails:${userId.toLowerCase()}`).digest("base64url").slice(0, 32);
}

/** A link of an info mail: a login's id and the signature that belongs to it, compared in constant time. */
export function validInfoMailLink(userId: unknown, signature: unknown, secret: string | null): userId is string {
  if (!secret || typeof userId !== "string" || !uuid.test(userId) || typeof signature !== "string" || signature.length > 64) return false;
  const expected = Buffer.from(infoMailSignature(userId, secret));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The login's two addresses: the page behind the link at the foot and the one-click address of the header. */
export function infoMailOptOut(origin: string, userId: string, secret: string): MailOptOut {
  const query = `?u=${encodeURIComponent(userId)}&sig=${infoMailSignature(userId, secret)}`;
  const base = origin.replace(/\/+$/, "");
  return { page: `${base}${OPT_OUT_PATHS.page}${query}`, oneClick: `${base}${OPT_OUT_PATHS.oneClick}${query}` };
}
