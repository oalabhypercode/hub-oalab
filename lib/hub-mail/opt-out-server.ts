import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { maskEmail } from "@/lib/hub-auth/mail-code";
import { INFO_MAILS_KEY, infoMailSecret, infoMailsWanted, validInfoMailLink } from "./opt-out";

// The page and the one-click address behind „Infomails abbestellen“ (lib/hub-mail/opt-out.ts): both work without a
// session, as the signed link stands for one login. Nothing here names more than a shortened address.

export type InfoMailsLink = { state: "invalid" } | { state: "ready"; email: string; wanted: boolean };

/** What the page shows for a link: the login's shortened address and whether the info mails still come. */
export async function readInfoMailsLink(userId: unknown, signature: unknown): Promise<InfoMailsLink> {
  if (!validInfoMailLink(userId, signature, infoMailSecret())) return { state: "invalid" };
  const db = createAdminClient();
  if (!db) return { state: "invalid" };
  const { data, error } = await db.auth.admin.getUserById(userId);
  if (error || !data.user?.email) return { state: "invalid" };
  return { state: "ready", email: maskEmail(data.user.email), wanted: infoMailsWanted(data.user.user_metadata) };
}

/**
 * Stops the info mails of the link's login (or orders them again). The admin log keeps who and when; the login itself
 * counts as the one who acted, as nobody of the team did.
 */
export async function setInfoMails(userId: unknown, signature: unknown, wanted: boolean): Promise<boolean> {
  if (!validInfoMailLink(userId, signature, infoMailSecret())) return false;
  const db = createAdminClient();
  if (!db) return false;
  const { error } = await db.auth.admin.updateUserById(userId, { user_metadata: { [INFO_MAILS_KEY]: wanted } });
  if (error) return false;
  await db.from("hub_admin_events").insert({
    actor_id: userId,
    action: wanted ? "user.info_mails_on" : "user.info_mails_off",
    summary: wanted ? "Infomails wieder bestellt (über den Link in der Mail)" : "Infomails abbestellt (über den Link in der Mail)",
    target_user_id: userId,
    target_customer_id: null,
  });
  return true;
}
