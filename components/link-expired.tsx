import Link from "next/link";
import { ArrowRight, RefreshCw } from "lucide-react";

/** A one-time link that no longer counts (used, expired or unknown): what to do now. /auth/error and the password page. */
export function LinkExpired() {
  return <div className="auth-form"><span className="auth-success-icon" aria-hidden="true"><RefreshCw size={26} /></span><span className="eyebrow">Noch ein Versuch.</span><h2>Der Link ist<br />nicht mehr gültig.</h2><p>Der Bestätigungslink ist möglicherweise abgelaufen oder wurde bereits verwendet. Melde dich erneut an oder fordere einen neuen Passwort-Link an.</p><Link className="button-primary full-width" href="/auth/login">Zur Anmeldung <ArrowRight size={18} aria-hidden="true" /></Link><Link className="auth-back-link" href="/auth/forgot-password">Neuen Passwort-Link anfordern</Link></div>;
}
