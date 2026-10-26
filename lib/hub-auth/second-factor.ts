import type { SupabaseClient } from "@supabase/supabase-js";

// Every login picks its second factor in the profile (since 26.10.2026): off, a six-digit code by e-mail or an
// authenticator app (app_metadata.second_factor = "email" | "totp"). Sign-in asks for exactly that one.
// - "totp": Supabase MFA checks the app's code itself and raises the session to aal2.
// - "email": the hub mails and checks the code; the database marks the session, and its access token hook issues the
//   session's tokens with aal2 (service-oalab/supabase/migrations/202610260001_mail_second_factor.sql).
// Service OALab requires aal2 for team roles, so a hub login with either code is valid there as well.
// Self-contained (type import only), so `node --test` can load it.

export type SecondFactorMethod = "email" | "totp";
export type SecondFactorChoice = SecondFactorMethod | "off";

/** What the login chose in the profile (or an admin set), null for none. */
export function chosenSecondFactor(appMetadata: unknown): SecondFactorMethod | null {
  const value = appMetadata && typeof appMetadata === "object" ? (appMetadata as Record<string, unknown>).second_factor : null;
  return value === "email" || value === "totp" ? value : null;
}

/** A confirmed authenticator app among the login's Supabase factors. */
export function hasConfirmedApp(factors: readonly { factor_type?: string; status?: string }[] | null | undefined) {
  return (factors ?? []).some((factor) => factor.factor_type === "totp" && factor.status === "verified");
}

/**
 * The method sign-in asks for. An app that was chosen but is gone (an admin reset it) means the e-mail code, never
 * no protection; an app without a choice (set up before the choice existed) means the app.
 */
export function secondFactorMethod(appMetadata: unknown, hasApp: boolean): SecondFactorMethod | null {
  const chosen = chosenSecondFactor(appMetadata);
  if (chosen === "totp") return hasApp ? "totp" : "email";
  if (chosen === "email") return "email";
  return hasApp ? "totp" : null;
}

/**
 * The code this session confirms with. A new password needs the app whenever there is one: Supabase Auth refuses the
 * password otherwise, whatever the hub decided. Logins without any method that Service OALab sends for its team pages
 * get the e-mail code.
 */
export function codeMethod(method: SecondFactorMethod | null, hasApp: boolean, destination?: string | null): SecondFactorMethod {
  if (hasApp && destination?.startsWith("/auth/update-password")) return "totp";
  return method ?? "email";
}

/**
 * The login has a method, but this session has not confirmed it yet. From the verified token's claims and the
 * cookie's copy of the factors, without a network call: good for redirects, not for access decisions (see
 * secondFactorMissing).
 */
export function secondFactorPending(claims: { aal?: unknown; app_metadata?: unknown } | null | undefined, hasApp: boolean): boolean {
  return Boolean(claims) && claims?.aal !== "aal2" && secondFactorMethod(claims?.app_metadata, hasApp) !== null;
}

/**
 * The same, checked against Supabase Auth: a choice changed after the token was issued counts at once. Sessions that
 * already confirmed their code (`aal` claim of the verified token) need no extra request.
 */
export async function secondFactorMissing(supabase: Pick<SupabaseClient, "auth">, aal: unknown): Promise<boolean> {
  if (aal === "aal2") return false;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return true;
  return secondFactorMethod(data.user.app_metadata, hasConfirmedApp(data.user.factors)) !== null;
}
