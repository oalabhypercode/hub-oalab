import "server-only";
import type { Session, User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMailCodeCheck, mailCodeHash, newMailCode } from "./mail-code";
import { hasConfirmedApp, secondFactorMethod } from "./second-factor";
import { sessionOf } from "./session-token";

/**
 * A password link of a login with the e-mail code came from the same mailbox the code would go to, so it confirms the
 * session like a code: issued and checked at once through the same database functions. The new password and the hub
 * then need no second mail. Logins with an app still enter the app's code on the code page: Supabase Auth requires it
 * for the new password, and it keeps a cracked mailbox from taking over the account. True once the session is
 * confirmed; the caller renews the token, which then carries aal2 from the access token hook.
 */
export async function confirmRecoveryByMail(user: User | null, session: Session | null): Promise<boolean> {
  if (!user || !session) return false;
  const hasApp = hasConfirmedApp(user.factors);
  if (hasApp || secondFactorMethod(user.app_metadata, hasApp) !== "email") return false;
  const target = sessionOf(session.access_token);
  const db = createAdminClient();
  if (!target || !db) return false;
  const request = { p_user_id: target.userId, p_session_id: target.sessionId, p_code_hash: mailCodeHash(target.sessionId, newMailCode()) };
  const issued = await db.rpc("oalab_mail_code_issue", request);
  if (issued.error) return false;
  const checked = await db.rpc("oalab_mail_code_verify", request);
  return !checked.error && isMailCodeCheck(checked.data) && checked.data === "verified";
}
