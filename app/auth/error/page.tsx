import Link from "next/link";
import { ArrowRight, RefreshCw } from "lucide-react";

export default function Page() {
  return <div className="auth-form"><span className="auth-success-icon"><RefreshCw size={26} /></span><span className="eyebrow">NOCH EIN VERSUCH.</span><h2>Der Link ist<br />nicht mehr gültig.</h2><p>Der Bestätigungslink ist möglicherweise abgelaufen oder wurde bereits verwendet. Melde dich erneut an oder fordere einen neuen Passwort-Link an.</p><Link className="button-primary full-width" href="/auth/login">Zur Anmeldung <ArrowRight size={17} /></Link><Link className="auth-back-link" href="/auth/forgot-password">Neuen Passwort-Link anfordern</Link></div>;
}
