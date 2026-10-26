import type { SupabaseClient } from "@supabase/supabase-js";

// Logins with the e-mail code (app_metadata.second_factor = "email", switch in the user management) only count as
// signed in once this session has confirmed a six-digit code from their inbox. The hub mails and checks the code;
// the database then marks the session, and its access token hook issues the session's tokens with aal2
// (service-oalab/supabase/migrations/202610260001_mail_second_factor.sql). Service OALab requires aal2 for team
// roles, so a hub login with code is valid there as well. Self-contained, so `node --test` can load it.

/** The value of app_metadata.second_factor for logins that confirm each session with a code by e-mail. */
export const MAIL_SECOND_FACTOR = "email";

/** The login confirms its sessions with a code by e-mail. */
export function wantsMailCode(appMetadata: unknown): boolean {
  return Boolean(appMetadata && typeof appMetadata === "object" && (appMetadata as Record<string, unknown>).second_factor === MAIL_SECOND_FACTOR);
}

/**
 * The login wants the code, but this session has not confirmed it yet. Read from the verified token's claims without
 * a network call: good for redirects, not for access decisions (the claims' app_metadata is as old as the token,
 * see secondFactorMissing).
 */
export function secondFactorPending(claims: { aal?: unknown; app_metadata?: unknown } | null | undefined): boolean {
  return Boolean(claims) && claims?.aal !== "aal2" && wantsMailCode(claims?.app_metadata);
}

/**
 * The same, checked against Supabase Auth: a switch turned on after the token was issued counts at once. Sessions
 * that already confirmed the code (`aal` claim of the verified token) need no extra request.
 */
export async function secondFactorMissing(supabase: Pick<SupabaseClient, "auth">, aal: unknown): Promise<boolean> {
  if (aal === "aal2") return false;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return true;
  return wantsMailCode(data.user.app_metadata);
}
