"use server";

import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { authMessage } from "./messages";
import { hasMailbox, maskEmail, readMailCode } from "./mail-code";
import { hasConfirmedApp, secondFactorMethod, type SecondFactorChoice } from "./second-factor";

// The profile card „Zwei-Faktor-Schutz“: every login picks off, the code by e-mail or an authenticator app. Changes
// need a session that has passed the login's current second factor, so a password alone never weakens it. The choice
// lives in app_metadata (only the service role writes it); the app is a Supabase MFA factor. Leaving the app removes
// it, or Supabase Auth would keep asking for it (e.g. for a new password).

export type SecondFactorStatus = { choice: SecondFactorChoice; email: string; mailbox: boolean };
export type AppSetup = { mode: "confirm" } | { mode: "enroll"; factorId: string; qrCode: string; secret: string };
type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const failed = (error: string) => ({ ok: false as const, error });
const notConfirmed = failed("Bitte melde dich neu an und bestätige deinen Sicherheitscode, bevor du den Schutz änderst.");

/** The signed-in login, fresh from Supabase Auth, if this session may change its second factor. */
async function confirmedLogin() {
  const supabase = await createClient();
  const [{ data: claimData }, { data: userData }] = await Promise.all([supabase.auth.getClaims(), supabase.auth.getUser()]);
  const user = userData.user;
  if (!claimData?.claims || !user || (user.app_metadata as Record<string, unknown> | undefined)?.demo_account === true) return null;
  const hasApp = hasConfirmedApp(user.factors);
  const method = secondFactorMethod(user.app_metadata, hasApp);
  return { supabase, user, hasApp, method, confirmed: method === null || claimData.claims.aal === "aal2" };
}

/** Writes the choice and removes every app factor that does not belong to it (admin API: no aal2 check needed). */
async function saveChoice(user: User, choice: SecondFactorChoice, keepFactorId?: string) {
  const db = createAdminClient();
  if (!db) return false;
  for (const factor of user.factors ?? []) {
    if (factor.factor_type !== "totp" || factor.id === keepFactorId) continue;
    if ((await db.auth.admin.mfa.deleteFactor({ userId: user.id, id: factor.id })).error) return false;
  }
  // Supabase merges app_metadata: null removes the key.
  const { error } = await db.auth.admin.updateUserById(user.id, { app_metadata: { second_factor: choice === "off" ? null : choice } });
  return !error;
}

/** What the card shows: the method sign-in asks for. */
export async function getSecondFactorStatus(): Promise<Result<SecondFactorStatus>> {
  const login = await confirmedLogin();
  if (!login) return failed("Der Zwei-Faktor-Schutz lässt sich nur mit einem echten Konto einstellen.");
  const email = login.user.email ?? "";
  return { ok: true, data: { choice: login.method ?? "off", email: maskEmail(email), mailbox: hasMailbox(email) } };
}

/** Off or the code by e-mail. A set-up app is removed. */
export async function chooseSecondFactor(input: { choice: "off" | "email" }): Promise<Result<null>> {
  const login = await confirmedLogin();
  if (!login) return failed(authMessage("session_not_found"));
  if (!login.confirmed) return notConfirmed;
  const choice = input?.choice === "email" ? "email" : input?.choice === "off" ? "off" : null;
  if (!choice) return failed("Bitte wähle eine Methode.");
  if (choice === "email" && !hasMailbox(login.user.email)) return failed("An deine Adresse kann kein Code zugestellt werden.");
  return (await saveChoice(login.user, choice)) ? { ok: true, data: null } : failed("Die Einstellung konnte nicht gespeichert werden. Bitte versuche es erneut.");
}

/**
 * Starts the app: a set-up app is only confirmed with a current code; otherwise a new one is enrolled (QR code and
 * key for the app), replacing an unfinished earlier attempt.
 */
export async function startAppSetup(): Promise<Result<AppSetup>> {
  const login = await confirmedLogin();
  if (!login) return failed(authMessage("session_not_found"));
  if (!login.confirmed) return notConfirmed;
  if (login.hasApp) return { ok: true, data: { mode: "confirm" } };
  const db = createAdminClient();
  if (!db) return failed(authMessage("setup"));
  for (const factor of login.user.factors ?? []) {
    if (factor.factor_type === "totp") await db.auth.admin.mfa.deleteFactor({ userId: login.user.id, id: factor.id });
  }
  const { data, error } = await login.supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "oalab", issuer: "oalab" });
  const qrCode = data ? qrImage(data.totp.qr_code) : "";
  if (error || !data || !qrCode) return failed("Die App-Einrichtung konnte nicht gestartet werden. Bitte versuche es erneut.");
  return { ok: true, data: { mode: "enroll", factorId: data.id, qrCode, secret: data.totp.secret } };
}

/**
 * Supabase hands the QR code over as an SVG data URL, sometimes raw and with an XML declaration. The card shows it as
 * an image, so it is normalised to one percent-encoded SVG without comments, scripts or event handlers.
 */
function qrImage(value: string) {
  const comma = value.indexOf(",");
  if (!value.startsWith("data:image/svg+xml") || comma < 0) return "";
  let svg = value.slice(comma + 1);
  try { svg = decodeURIComponent(svg); } catch { /* already raw */ }
  svg = svg.replace(/^<\?xml[^>]*\?>\s*/, "").replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!svg.startsWith("<svg") || /<script|\son\w+\s*=/i.test(svg) || svg.length > 2_000_000) return "";
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Confirms the app with a code from it (Supabase MFA, which raises this session to aal2) and makes it the login's
 * method. The e-mail choice ends with it.
 */
export async function confirmAppSetup(input: { code: string; factorId?: string }): Promise<Result<null>> {
  const login = await confirmedLogin();
  if (!login) return failed(authMessage("session_not_found"));
  if (!login.confirmed) return notConfirmed;
  const code = readMailCode(input?.code);
  if (!code) return failed(authMessage("mfa_verification_failed"));
  const factor = (login.user.factors ?? []).find((item) => item.factor_type === "totp" && (input?.factorId ? item.id === input.factorId : item.status === "verified"));
  if (!factor) return failed("Die App-Einrichtung ist abgelaufen. Bitte starte sie neu.");
  const { error } = await login.supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return failed(authMessage(error.code));
  return (await saveChoice(login.user, "totp", factor.id)) ? { ok: true, data: null } : failed("Die App ist bestätigt, aber die Einstellung konnte nicht gespeichert werden. Bitte versuche es erneut.");
}
