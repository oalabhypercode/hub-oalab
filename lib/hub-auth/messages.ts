/**
 * What the login, registration and password forms say when Supabase Auth refuses. Self-contained, so the server
 * actions, the form and `node --test` share it.
 */
export function authMessage(code: string | undefined | null) {
  const value = code ?? "";
  if (value === "invalid_credentials") return "E-Mail-Adresse oder Passwort stimmen nicht. Bitte prüfe deine Eingaben.";
  if (value === "user_banned") return "Dein Zugang ist deaktiviert. Bitte wende dich an dein oalab-Team.";
  if (value === "email_not_confirmed") return "Bitte bestätige zuerst deine E-Mail-Adresse über den Link in deinem Postfach.";
  if (value === "user_already_exists" || value === "email_exists") return "Für diese E-Mail-Adresse besteht bereits ein Konto. Bitte melde dich an.";
  if (value.includes("rate_limit")) return "Zu viele Versuche. Bitte warte einen Moment und versuche es erneut.";
  if (value === "weak_password") return "Bitte wähle ein stärkeres Passwort mit mindestens acht Zeichen.";
  if (value === "same_password") return "Dein neues Passwort muss sich vom bisherigen unterscheiden.";
  if (value === "session_not_found" || value === "refresh_token_not_found") return "Der Link ist abgelaufen. Fordere bitte einen neuen Passwort-Link an.";
  if (value === "mfa_verification_failed" || value === "mfa_challenge_expired") return "Der Code stimmt nicht. Bitte gib den aktuellen Code aus deiner Authenticator-App ein.";
  if (value === "mfa_factor_not_found") return "Für dein Konto ist keine Authenticator-App hinterlegt. Bitte wende dich an dein oalab-Team.";
  if (value === "insufficient_aal") return "Bitte bestätige zuerst den Code aus deiner Authenticator-App.";
  if (value === "setup") return "Der Login wird gerade eingerichtet. Bitte versuche es später erneut.";
  if (value === "mail_failed") return "Die E-Mail konnte gerade nicht gesendet werden. Bitte versuche es später erneut oder wende dich an dein oalab-Team.";
  return "Das hat gerade nicht geklappt. Bitte versuche es erneut oder wende dich an dein Projektteam.";
}

/** Attempts per subject and window. Network = the visitor's address, account = the e-mail address; both are hashed. */
export const authRateLimits = {
  login: { network: 30, account: 10, windowSeconds: 15 * 60 },
  signup: { network: 5, account: 3, windowSeconds: 60 * 60 },
  password_reset: { network: 5, account: 3, windowSeconds: 60 * 60 },
} as const;
export type AuthRateAction = keyof typeof authRateLimits;

/** The visitor's address as the platform reports it (first X-Forwarded-For entry), else a shared bucket. */
export function clientAddress(list: Pick<Headers, "get">) {
  const forwarded = list.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || list.get("x-real-ip")?.trim() || "unknown";
}
