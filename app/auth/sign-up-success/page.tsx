import Link from "next/link";
import { ArrowRight, Mail } from "lucide-react";

export default function Page() {
  return <div className="auth-form"><span className="auth-success-icon" aria-hidden="true"><Mail size={26} /></span><span className="eyebrow">Der erste Schritt ist gemacht.</span><h2>Fast<br />mittendrin.</h2><p>Bitte bestätige deine E-Mail-Adresse über den Link in deinem Postfach. Anschließend kannst du dich anmelden. Dein Projektteam richtet deinen Workspace für dich ein.</p><Link className="button-primary full-width" href="/auth/login">Zur Anmeldung <ArrowRight size={18} aria-hidden="true" /></Link></div>;
}
