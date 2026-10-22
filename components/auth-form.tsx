"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Loader2, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { safeAuthRedirect } from "@/lib/auth-redirect";
import { readRegistration } from "@/lib/hub-users/rules";
import { legalLinks } from "@/lib/legal-links";
import { cn, hasEnvVars } from "@/lib/utils";

type AuthMode = "login" | "signup" | "forgot" | "update";
const copy = {
  login: { eyebrow: "Willkommen zurück.", title: "Schön, dass\ndu da bist.", description: "Melde dich an und bring dein nächstes Projekt einen Schritt weiter.", action: "Anmelden", loading: "Du wirst angemeldet …" },
  signup: { eyebrow: "Gemeinsam geht mehr.", title: "Dein Platz\nfür gute Ideen.", description: "Registriere dich mit deinen Angaben. Dein oalab-Team prüft sie und schaltet deinen Zugang zum Client Hub frei.", action: "Registrierung senden", loading: "Registrierung wird gesendet …" },
  forgot: { eyebrow: "Wir helfen dir weiter.", title: "Ein neuer\nAnfang.", description: "Gib deine E-Mail-Adresse ein. Wir senden dir einen Link, mit dem du dein Passwort zurücksetzen kannst.", action: "Link zum Zurücksetzen senden", loading: "Link wird gesendet …" },
  update: { eyebrow: "Fast geschafft.", title: "Ein neues\nPasswort.", description: "Wähle ein sicheres Passwort für deinen Workspace. Mindestens acht Zeichen sind ein guter Anfang.", action: "Passwort speichern", loading: "Passwort wird gespeichert …" },
};

function authError(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (code === "invalid_credentials") return "E-Mail-Adresse oder Passwort stimmen nicht. Bitte prüfe deine Eingaben.";
  if (code === "user_banned") return "Dein Zugang ist deaktiviert. Bitte wende dich an dein oalab-Team.";
  if (code === "email_not_confirmed") return "Bitte bestätige zuerst deine E-Mail-Adresse über den Link in deinem Postfach.";
  if (code === "user_already_exists") return "Für diese E-Mail-Adresse besteht bereits ein Konto. Bitte melde dich an.";
  if (code.includes("rate_limit")) return "Zu viele Versuche. Bitte warte einen Moment und versuche es erneut.";
  if (code === "weak_password") return "Bitte wähle ein stärkeres Passwort mit mindestens acht Zeichen.";
  if (code === "same_password") return "Dein neues Passwort muss sich vom bisherigen unterscheiden.";
  if (code === "session_not_found" || code === "refresh_token_not_found") return "Der Link ist abgelaufen. Fordere bitte einen neuen Passwort-Link an.";
  return "Das hat gerade nicht geklappt. Bitte versuche es erneut oder wende dich an dein Projektteam.";
}

export function AuthForm({ mode, className, children, ...props }: React.ComponentPropsWithoutRef<"div"> & { mode: AuthMode }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  // Registration only: what the oalab team needs to approve the access quickly.
  const [registration, setRegistration] = useState({ firstName: "", lastName: "", companyName: "", phone: "", position: "", website: "", customerNumberHint: "", message: "" });
  const router = useRouter();
  const content = copy[mode];
  const field = (key: keyof typeof registration) => ({
    value: registration[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setRegistration((value) => ({ ...value, [key]: event.target.value })),
    disabled: loading,
  });

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!hasEnvVars) { setError("Der Login wird gerade eingerichtet. Bitte versuche es später erneut."); return; }
    const checked = mode === "signup" ? readRegistration({ ...registration, email }) : null;
    if (checked && !checked.ok) { setError(checked.error); return; }
    if ((mode === "signup" || mode === "update") && password !== repeatPassword) { setError("Die beiden Passwörter stimmen noch nicht überein."); return; }
    setLoading(true);
    try {
      const supabase = createClient();
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        // A real login must supersede a previously selected public fixture identity.
        const demoExit = await fetch("/auth/demo/logout", { method: "POST" });
        if (!demoExit.ok && ![403, 404].includes(demoExit.status)) throw new Error("Could not leave public demo");
        const next = new URLSearchParams(window.location.search).get("next");
        // Discard any client router cache and UI state from a previous account.
        window.location.replace(safeAuthRedirect(next));
      } else if (mode === "signup") {
        if (!checked?.ok) return;
        // The details travel as user_metadata; a database trigger copies them into a profile that waits for approval.
        const person = checked.value;
        const { data, error } = await supabase.auth.signUp({
          email: person.email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
            data: {
              first_name: person.firstName, last_name: person.lastName, full_name: `${person.firstName} ${person.lastName}`, company_name: person.companyName,
              phone: person.phone, position: person.position, website: person.website, customer_number_hint: person.customerNumberHint, message: person.message,
              privacy_noted: true,
            },
          },
        });
        if (error) throw error;
        router.replace(data.session ? "/dashboard" : "/auth/sign-up-success");
        router.refresh();
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth/callback?next=/auth/update-password` });
        if (error) throw error;
        setSuccess(true);
      } else {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        router.replace("/dashboard");
        router.refresh();
      }
    } catch (failure: unknown) {
      setError(authError(failure));
    } finally {
      setLoading(false);
    }
  }

  if (success) return <div className="auth-form"><span className="auth-success-icon" aria-hidden="true"><Mail size={26} /></span><span className="eyebrow">Post für dich.</span><h2>Schau in<br />dein Postfach.</h2><p>Falls ein Konto zu dieser E-Mail-Adresse existiert, erhältst du einen Link zum Zurücksetzen deines Passworts. Schau auch im Spam-Ordner nach.</p><Link className="button-primary full-width" href="/auth/login">Zurück zur Anmeldung <ArrowRight size={18} aria-hidden="true" /></Link></div>;

  return (
    <div className={cn("auth-form", className)} {...props}>
      <span className="eyebrow">{content.eyebrow}</span>
      <h2>{content.title.split("\n").map((line, index) => <span key={line}>{index > 0 && <br />}{line}</span>)}</h2>
      <p className="auth-description">{content.description}</p>
      {mode === "login" && children}
      <form onSubmit={submit} className="auth-fields" aria-busy={loading}>
        {mode === "signup" && <>
          <div className="auth-field-row">
            <div className="auth-field"><label htmlFor="first-name">Vorname</label><input id="first-name" name="given-name" autoComplete="given-name" required maxLength={80} {...field("firstName")} /></div>
            <div className="auth-field"><label htmlFor="last-name">Nachname</label><input id="last-name" name="family-name" autoComplete="family-name" required maxLength={80} {...field("lastName")} /></div>
          </div>
          <div className="auth-field"><label htmlFor="company">Unternehmen</label><input id="company" name="organization" autoComplete="organization" placeholder="z. B. Nordlicht Studio GmbH" required maxLength={200} {...field("companyName")} /></div>
          <div className="auth-field-row">
            <div className="auth-field"><label htmlFor="phone">Telefon</label><input id="phone" name="tel" type="tel" autoComplete="tel" placeholder="+49 30 1234567" required maxLength={40} {...field("phone")} /></div>
            <div className="auth-field"><label htmlFor="position">Position <span className="auth-optional">(optional)</span></label><input id="position" name="organization-title" autoComplete="organization-title" placeholder="z. B. Geschäftsführung" maxLength={80} {...field("position")} /></div>
          </div>
        </>}
        {mode !== "update" && <div className="auth-field"><label htmlFor="email">E-Mail-Adresse</label><input id="email" name="email" type="email" autoComplete="email" placeholder="du@unternehmen.de" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={loading} /></div>}
        {mode !== "forgot" && <div className="auth-field"><div className="auth-label-row"><label htmlFor="password">{mode === "update" ? "Neues Passwort" : "Passwort"}</label>{mode === "login" && <Link href="/auth/forgot-password">Passwort vergessen?</Link>}</div><div className="password-field"><input id="password" name="password" type={visible ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder={mode === "login" ? "Dein Passwort" : "Mindestens 8 Zeichen"} required minLength={mode === "login" ? undefined : 8} value={password} onChange={(event) => setPassword(event.target.value)} disabled={loading} /><button type="button" aria-label={visible ? "Passwort verbergen" : "Passwort anzeigen"} aria-pressed={visible} onClick={() => setVisible((value) => !value)}>{visible ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}</button></div></div>}
        {(mode === "signup" || mode === "update") && <div className="auth-field"><label htmlFor="repeat-password">Passwort wiederholen</label><input id="repeat-password" name="repeat-password" type={visible ? "text" : "password"} autoComplete="new-password" required minLength={8} placeholder="Noch einmal zur Sicherheit" value={repeatPassword} onChange={(event) => setRepeatPassword(event.target.value)} disabled={loading} /></div>}
        {mode === "signup" && <>
          <details className="auth-more">
            <summary>Weitere Angaben <span className="auth-optional">(optional)</span></summary>
            <div className="auth-more-fields">
              <div className="auth-field"><label htmlFor="website">Website</label><input id="website" name="url" type="text" inputMode="url" autoComplete="url" placeholder="beispiel.de" maxLength={200} {...field("website")} /></div>
              <div className="auth-field"><label htmlFor="customer-number">Kundennummer, falls vorhanden</label><input id="customer-number" name="customer-number" autoComplete="off" placeholder="z. B. KD-24017" maxLength={40} {...field("customerNumberHint")} /></div>
              <div className="auth-field"><label htmlFor="message">Nachricht an dein oalab-Team</label><textarea id="message" name="message" rows={3} maxLength={1000} placeholder="Worum geht es bei dir?" {...field("message")} /></div>
            </div>
          </details>
          {/* Art. 13 DSGVO: the notice at the form; the legal basis is the contract initiation, so no consent box. */}
          <p className="auth-privacy-note">Wir verwenden deine Angaben, um deine Registrierung zu prüfen und deinen Zugang zum oalab Client Hub einzurichten (Art. 6 Abs. 1 lit. b DSGVO).{legalLinks.privacy && <> Mehr dazu in der <a href={legalLinks.privacy} target="_blank" rel="noopener noreferrer">Datenschutzerklärung</a>.</>}</p>
        </>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button-primary auth-submit" type="submit" disabled={loading}>{loading ? <><Loader2 size={18} className="spin" aria-hidden="true" />{content.loading}</> : <>{content.action}<ArrowRight size={18} aria-hidden="true" /></>}</button>
      </form>
      {mode === "login" ? <p className="auth-bottom-note">Noch kein Konto? <Link href="/auth/sign-up">Jetzt registrieren</Link></p> :<Link className="auth-back-link" href="/auth/login"><ArrowLeft size={18} aria-hidden="true" />Zurück zur Anmeldung</Link>}
      {mode === "update" && <p className="auth-security-note"><Check size={14} aria-hidden="true" />Dein Passwort wird verschlüsselt übertragen.</p>}
    </div>
  );
}
