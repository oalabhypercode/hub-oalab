import type { SupabaseClient } from "@supabase/supabase-js";

// Logins with a confirmed authenticator app (TOTP, set up in Service OALab) only count as signed in once the session
// has used it (AAL2). Service OALab asks for the code too, so a Hub login with code is valid there as well.

/**
 * The login has a confirmed second factor, but this session was opened with the password alone. Read from the
 * session cookie without a network call: good for redirects, not for access decisions (see secondFactorMissing).
 */
export async function secondFactorPending(supabase: Pick<SupabaseClient, "auth">): Promise<boolean> {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentLevel === "aal1" && data.nextLevel === "aal2";
}

/**
 * The same, verified against Supabase Auth, because the cookie's copy of the factors could be edited. Sessions
 * that already used the code (`aal` claim of the verified token) need no extra request.
 */
export async function secondFactorMissing(supabase: Pick<SupabaseClient, "auth">, aal: unknown): Promise<boolean> {
  if (aal === "aal2") return false;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return true;
  return (data.user.factors ?? []).some((factor) => factor.status === "verified");
}
