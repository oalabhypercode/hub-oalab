"use server";

import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { safeAuthRedirect, SECOND_FACTOR_PAGE, secondFactorDestination, serviceOrigin } from "@/lib/auth-redirect";
import { greetsAt } from "@/lib/greeting";
import { mailLoginCode, mailPasswordLink, mailRegistrationConfirmation } from "@/lib/hub-mail/notify";
import { cleanEmail, readRegistration } from "@/lib/hub-users/rules";
import { PUBLIC_DEMO_COOKIE } from "@/lib/public-demo-policy";
import { siteOrigin } from "@/lib/site-origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { hasEnvVars } from "@/lib/utils";
import { codeTimes, isMailCodeCheck, MAIL_CODE_MINUTES, mailCodeHash, newMailCode, readMailCode, type CodeTimes } from "./mail-code";
import { authMessage, authRateLimits, clientAddress, type AuthRateAction } from "./messages";
import { codeMethod, hasConfirmedApp, isFreelancerLogin, secondFactorMethod } from "./second-factor";
import { sessionOf, tokenClaims, type CodeSession } from "./session-token";

// Login, registration, password link, new password and sign-out run on the server: the session cookie that Hub and
// Service share is HTTP-only, so browser code can neither read nor write it. Each action is a public POST endpoint
// (Next.js checks its origin); inputs are validated here again, whatever the form already checked.

/**
 * `greeting`: first name for the greeting when a sign-in opens the hub (lib/greeting.ts); may be empty. `code`: when a
 * new e-mail code went out and until when it counts, so the code page names that mail.
 */
export type AuthResult = { ok: true; redirect?: string; greeting?: string; code?: CodeTimes } | { ok: false; error: string };

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

/** First name for the greeting when the sign-in opens the hub, read with the new session; empty if it can't be read. */
async function greetingFor(supabase: Awaited<ReturnType<typeof createClient>>, userId: string | undefined, destination: string) {
  if (!userId || !greetsAt(destination)) return undefined;
  const { data } = await supabase.from("hub_profiles").select("first_name").eq("user_id", userId).maybeSingle<{ first_name: string | null }>();
  return data?.first_name?.trim() ?? "";
}

/** Signs in with e-mail and password; the session lands in the shared cookie. */
export async function signInAction(input: { email: string; password: string; next?: string | null }): Promise<AuthResult> {
  if (!hasEnvVars) return failure("setup");
  const email = cleanEmail(input.email);
  if (!email.ok || !passwordOk(input.password, 1)) return failure("invalid_credentials");
  if (!(await withinRate("login", email.value))) return failure("over_request_rate_limit");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.value, password: input.password });
  if (error) return failure(error.code);
  // A real login supersedes a previously selected public fixture identity.
  (await cookies()).set(PUBLIC_DEMO_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  const next = safeAuthRedirect(input.next);
  // Logins with a second factor continue on the code page. The e-mail code goes out right away (the page offers a new
  // one if this fails); the app needs nothing sent.
  const method = secondFactorMethod(data.user?.app_metadata, hasConfirmedApp(data.user?.factors));
  if (method) {
    const session = method === "email" && data.session ? sessionOf(data.session.access_token) : null;
    if (session) await issueMailCode(session, isFreelancerLogin(data.user?.app_metadata));
    return { ok: true, redirect: `${SECOND_FACTOR_PAGE}?next=${encodeURIComponent(next)}` };
  }
  return { ok: true, redirect: next, greeting: await greetingFor(supabase, data.user?.id, next) };
}

/** The login's second factor as Supabase Auth knows it now (not the token's copy). */
async function secondFactorOf(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const hasApp = hasConfirmedApp(data.user.factors);
  return { user: data.user, hasApp, method: secondFactorMethod(data.user.app_metadata, hasApp) };
}

/** The signed-in session from the verified cookie token. */
async function currentSession(supabase: Awaited<ReturnType<typeof createClient>>): Promise<CodeSession | null> {
  const { data, error } = await supabase.auth.getClaims();
  const claims = error ? null : data?.claims;
  return claims && typeof claims.session_id === "string" && typeof claims.email === "string"
    ? { userId: claims.sub, sessionId: claims.session_id, email: claims.email }
    : null;
}

/**
 * Issues a new code for the session (an older one expires) and mails it to the login's own address. Counted per
 * address and account; the database keeps only the hash and the hub_notifications row only kind and outcome.
 * `status` is "sent" or the error code for authMessage; `issuedAt` is the database's time of issue, so mail, code page
 * and stored code name the same minute. Freelancers (`hubOnly`) read nothing about the service platform.
 */
async function issueMailCode(session: CodeSession, hubOnly: boolean): Promise<{ status: string; issuedAt?: Date }> {
  if (!(await withinRate("login_code", session.email))) return { status: "over_email_send_rate_limit" };
  const db = createAdminClient();
  if (!db) return { status: "setup" };
  const code = newMailCode();
  const { error } = await db.rpc("oalab_mail_code_issue", { p_user_id: session.userId, p_session_id: session.sessionId, p_code_hash: mailCodeHash(session.sessionId, code) });
  if (error) {
    console.error("[hub-auth] Sicherheitscode nicht ausstellbar", error.code ?? "unbekannt");
    return { status: "setup" };
  }
  const [{ data: issued }, { data: profile }] = await Promise.all([
    db.from("oalab_mail_codes").select("created_at").eq("session_id", session.sessionId).maybeSingle<{ created_at: string }>(),
    db.from("hub_profiles").select("first_name").eq("user_id", session.userId).maybeSingle<{ first_name: string }>(),
  ]);
  const issuedAt = issued?.created_at ? new Date(issued.created_at) : new Date();
  const mail = await mailLoginCode(db, { id: session.userId, email: session.email }, { firstName: profile?.first_name ?? "", code, minutes: MAIL_CODE_MINUTES, issuedAt, hubOnly });
  return { status: mail === "sent" ? "sent" : "mail_failed", issuedAt };
}

/**
 * „Code senden“ / „Neuen Code senden“ on the code page: a fresh e-mail code for the signed-in session. Logins whose
 * method is the app get none: the choice is fixed per login.
 */
export async function sendSecondFactorCodeAction(input?: { next?: string | null }): Promise<AuthResult> {
  if (!hasEnvVars) return failure("setup");
  const supabase = await createClient();
  const session = await currentSession(supabase);
  const state = session ? await secondFactorOf(supabase) : null;
  if (!session || !state) return failure("session_not_found");
  if (codeMethod(state.method, state.hasApp, input?.next) !== "email") return failure("mfa_use_app");
  const issued = await issueMailCode(session, isFreelancerLogin(state.user.app_metadata));
  return issued.status === "sent" ? { ok: true, code: codeTimes(issued.issuedAt ?? new Date()) } : failure(issued.status);
}

/**
 * Second step: checks the six-digit code of the login's method. The app's code goes to Supabase MFA, which raises the
 * session to aal2 itself. A correct e-mail code marks the session in the database; the renewed token then carries
 * aal2 from the access token hook. Service OALab accepts both. Wrong codes count against the account's login limit
 * (and an e-mail code's own five attempts).
 */
export async function verifySecondFactorAction(input: { code: string; next?: string | null }): Promise<AuthResult> {
  if (!hasEnvVars) return failure("setup");
  const supabase = await createClient();
  const session = await currentSession(supabase);
  const state = session ? await secondFactorOf(supabase) : null;
  if (!session || !state) return failure("session_not_found");
  const method = codeMethod(state.method, state.hasApp, input.next);
  const code = readMailCode(input.code);
  if (!code) return failure(method === "totp" ? "mfa_verification_failed" : "mail_code_wrong");
  if (!(await withinRate("login", session.email))) return failure("over_request_rate_limit");
  const destination = secondFactorDestination(input.next, serviceOrigin());
  if (method === "totp") {
    const factor = (state.user.factors ?? []).find((item) => item.factor_type === "totp" && item.status === "verified");
    if (!factor) return failure("mfa_factor_not_found");
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    return error ? failure(error.code) : { ok: true, redirect: destination, greeting: await greetingFor(supabase, session.userId, destination) };
  }
  const db = createAdminClient();
  if (!db) return failure("setup");
  const { data, error } = await db.rpc("oalab_mail_code_verify", { p_user_id: session.userId, p_session_id: session.sessionId, p_code_hash: mailCodeHash(session.sessionId, code) });
  if (error || !isMailCodeCheck(data)) {
    console.error("[hub-auth] Sicherheitscode nicht prüfbar", error?.code ?? "unbekannt");
    return failure("setup");
  }
  if (data !== "verified") return failure(`mail_code_${data}`);
  // The session is confirmed; its next token comes with aal2. Without the hook it would not, so the login stops here.
  const { data: renewed, error: renewError } = await supabase.auth.refreshSession();
  if (renewError || !renewed.session || tokenClaims(renewed.session.access_token)?.aal !== "aal2") {
    console.error("[hub-auth] Code bestätigt, aber die erneuerte Sitzung hat kein aal2. Ist der Hook aus der Migration 202610260001 in Supabase aktiv?");
    return failure("setup");
  }
  return { ok: true, redirect: destination, greeting: await greetingFor(supabase, session.userId, destination) };
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
