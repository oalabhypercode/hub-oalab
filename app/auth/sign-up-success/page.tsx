import Link from "next/link";
import { ArrowRight, Mail } from "lucide-react";

export default function Page() {
  return <div className="auth-form"><span className="auth-success-icon" aria-hidden="true"><Mail size={26} /></span><span className="eyebrow">Der erste Schritt ist gemacht.</span><h2>Fast<br />mittendrin.</h2><p>Bitte bestätige deine E-Mail-Adresse über den Link in deinem Postfach. Danach prüft dein oalab-Team deine Angaben und schaltet deinen Zugang frei; bis dahin siehst du nach der Anmeldung den Stand deiner Registrierung.</p><Link className="button-primary full-width" href="/auth/login">Zur Anmeldung <ArrowRight size={18} aria-hidden="true" /></Link></div>;
}
