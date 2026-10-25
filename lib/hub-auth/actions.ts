"use server";

import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { safeAuthRedirect, SECOND_FACTOR_PAGE } from "@/lib/auth-redirect";
import { mailPasswordLink, mailRegistrationConfirmation } from "@/lib/hub-mail/notify";
import { cleanEmail, readRegistration } from "@/lib/hub-users/rules";
import { PUBLIC_DEMO_COOKIE } from "@/lib/public-demo-policy";
import { siteOrigin } from "@/lib/site-origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { hasEnvVars } from "@/lib/utils";
import { authMessage, authRateLimits, clientAddress, type AuthRateAction } from "./messages";
import { secondFactorPending } from "./second-factor";

// Login, registration, password link, new password and sign-out run on the server: the session cookie that Hub and
// Service share is HTTP-only, so browser code can neither read nor write it. Each action is a public POST endpoint
// (Next.js checks its origin); inputs are validated here again, whatever the form already checked.

export type AuthResult = { ok: true; redirect?: string } | { ok: false; error: string };

const failure = (code?: string | null): AuthResult => ({ ok: false, error: authMessage(code) });
const passwordOk = (value: unknown, min: number): value is string => typeof value === "string" && value.length >= min && value.length <= 512;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Counts an attempt for the visitor's address and the e-mail address; false once either reached its limit. Supabase
 * Auth only sees the server's address, so the hub counts itself (hub_take_auth_rate, service role only). Without the
 * secret key or the function the forms keep working, with Supabase's own limits as the only brake.
 */
async function withinRate(action: AuthRateAction, email: string) {
  const db = createAdminClient();
  if (!db) return true;
  const limits = authRateLimits[action];
  const address = clientAddress(await headers());
  const checks = [
    { subject: hash(`${action}:network:${address}`), limit: limits.network },
    { subject: hash(`${action}:account:${email}`), limit: limits.account },
  ];
  for (const check of checks) {
    const { data, error } = await db.rpc("hub_take_auth_rate", { p_action: action, p_subject: check.subject, p_limit: check.limit, p_window_seconds: limits.windowSeconds });
    if (error) {
      console.error("[hub-auth] Rate limit nicht prüfbar", error.code ?? "unbekannt");
      return true;
    }
    if (data === false) return false;
  }
  return true;
}

/** Signs in with e-mail and password; the session lands in the shared cookie. */
export async function signInAction(input: { email: string; password: string; next?: string | null }): Promise<AuthResult> {
  if (!hasEnvVars) return failure("setup");
  const email = cleanEmail(input.email);
  if (!email.ok || !passwordOk(input.password, 1)) return failure("invalid_credentials");
  if (!(await withinRate("login", email.value))) return failure("over_request_rate_limit");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: email.value, password: input.password });
  if (error) return failure(error.code);
  // A real login supersedes a previously selected public fixture identity.
  (await cookies()).set(PUBLIC_DEMO_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  const next = safeAuthRedirect(input.next);
  // Logins with an authenticator app continue with its code.
  if (await secondFactorPending(supabase)) return { ok: true, redirect: `${SECOND_FACTOR_PAGE}?next=${encodeURIComponent(next)}` };
  return { ok: true, redirect: next };
}

/**
 * Second step for logins with an authenticator app: checks the six-digit code and raises the session to AAL2, which
 * Service OALab accepts as well. Attempts count against the login limit of the account.
 */
export async function verifySecondFactorAction(input: { code: string; next?: string | null }): Promise<AuthResult> {
  if (!hasEnvVars) return failure("setup");
  const code = typeof input.code === "string" ? input.code.replace(/\s/g, "") : "";
  if (!/^\d{6}$/.test(code)) return failure("mfa_verification_failed");
  const supabase = await createClient();
  const { data: user, error: userError } = await supabase.auth.getUser();
  if (userError || !user.user) return failure("session_not_found");
  if (!(await withinRate("login", user.user.email ?? user.user.id))) return failure("over_request_rate_limit");
  const factor = (user.user.factors ?? []).find((item) => item.factor_type === "totp" && item.status === "verified");
  if (!factor) return failure("mfa_factor_not_found");
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return failure(error.code);
  return { ok: true, redirect: safeAuthRedirect(input.next) };
}

/**
 * Registration with approval: creates the login with the service role (public sign-ups stay closed in the shared
 * project) and mails the confirmation link. The details travel as user_metadata; a database trigger copies them
 * into a profile that waits for approval. If the link cannot be mailed, the login is removed again so the person
 * can simply try once more.
 */
export async function signUpAction(input: Record<string, unknown> & { password: string }): Promise<AuthResult> {
  if (!hasEnvVars) return failure("setup");
  const checked = readRegistration(input);
  if (!checked.ok) return { ok: false, error: checked.error };
  if (!passwordOk(input.password, 8)) return failure("weak_password");
  const person = checked.value;
  if (!(await withinRate("signup", person.email))) return failure("over_email_send_rate_limit");
  const db = createAdminClient();
  const origin = siteOrigin(await headers());
  if (!db || !origin) return failure("setup");

  const { data, error } = await db.auth.admin.generateLink({
    type: "signup",
    email: person.email,
    password: input.password,
    options: {
      data: {
        first_name: person.firstName, last_name: person.lastName, full_name: `${person.firstName} ${person.lastName}`, company_name: person.companyName,
        phone: person.phone, position: person.position, website: person.website, customer_number_hint: person.customerNumberHint, message: person.message,
        privacy_noted: true,
      },
    },
  });
  const token = data?.properties?.hashed_token;
  if (error || !token || !data.user) return failure(error?.code);
  const link = `${origin}/auth/confirm?token_hash=${encodeURIComponent(token)}&type=email&next=${encodeURIComponent("/dashboard")}`;
  const mail = await mailRegistrationConfirmation(db, data.user, { firstName: person.firstName, link });
  if (mail !== "sent") {
    if (!data.user.email_confirmed_at) await db.auth.admin.deleteUser(data.user.id);
    return failure("mail_failed");
  }
  return { ok: true, redirect: "/auth/sign-up-success" };
}

/** Mails a one-time link for a new password. Same answer whether or not the address has a login. */
export async function requestPasswordResetAction(input: { email: string }): Promise<AuthResult> {
  if (!hasEnvVars) return failure("setup");
  const email = cleanEmail(input.email);
  if (!email.ok) return { ok: false, error: email.error };
  if (!(await withinRate("password_reset", email.value))) return failure("over_email_send_rate_limit");
  const db = createAdminClient();
  const origin = siteOrigin(await headers());
  if (!db || !origin) return failure("setup");

  const { data, error } = await db.auth.admin.generateLink({ type: "recovery", email: email.value });
  const token = data?.properties?.hashed_token;
  if (error || !token || !data.user) return { ok: true };
  const { data: profile } = await db.from("hub_profiles").select("first_name, status").eq("user_id", data.user.id).maybeSingle<{ first_name: string; status: string }>();
  // Deactivated and rejected logins get no link: it would set a password they cannot use.
  if (profile && (profile.status === "disabled" || profile.status === "rejected")) return { ok: true };
  const link = `${origin}/auth/confirm?token_hash=${encodeURIComponent(token)}&type=recovery&next=${encodeURIComponent("/auth/update-password")}`;
  const mail = await mailPasswordLink(db, data.user, { firstName: profile?.first_name ?? "", link, activation: false });
  return mail === "failed" ? failure("mail_failed") : { ok: true };
}

/** Sets a new password for the signed-in login (after the password link). */
export async function updatePasswordAction(input: { password: string }): Promise<AuthResult> {
  if (!hasEnvVars) return failure("setup");
  if (!passwordOk(input.password, 8)) return failure("weak_password");
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return failure("session_not_found");
  const { error } = await supabase.auth.updateUser({ password: input.password });
  if (error) return failure(error.code);
  return { ok: true, redirect: "/dashboard" };
}

/** Signs out everywhere: the shared cookie goes, so Service OALab is signed out as well, and the session is revoked. */
export async function signOutAction(): Promise<AuthResult> {
  if (!hasEnvVars) return { ok: true, redirect: "/auth/login" };
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  // Revoking can fail (expired session, network); the cookies of this browser are removed in any case.
  if (error) await supabase.auth.signOut({ scope: "local" });
  return { ok: true, redirect: "/auth/login" };
}
