"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Loader2, LogOut, Mail, ShieldCheck } from "lucide-react";
import { requestPasswordResetAction, signInAction, signOutAction, signUpAction, updatePasswordAction, verifySecondFactorAction, type AuthResult } from "@/lib/hub-auth/actions";
import { authMessage } from "@/lib/hub-auth/messages";
import { readRegistration } from "@/lib/hub-users/rules";
import { legalLinks } from "@/lib/legal-links";
import { cn, hasEnvVars } from "@/lib/utils";

type AuthMode = "login" | "signup" | "forgot" | "update" | "mfa";
const copy = {
  login: { eyebrow: "Willkommen zurück.", title: "Schön, dass\ndu da bist.", description: "Melde dich an und bring dein nächstes Projekt einen Schritt weiter.", action: "Anmelden", loading: "Du wirst angemeldet …" },
  signup: { eyebrow: "Gemeinsam geht mehr.", title: "Dein Platz\nfür gute Ideen.", description: "Registriere dich mit deinen Angaben. Dein oalab-Team prüft sie und schaltet deinen Zugang zum Client Hub frei.", action: "Registrierung senden", loading: "Registrierung wird gesendet …" },
  forgot: { eyebrow: "Wir helfen dir weiter.", title: "Ein neuer\nAnfang.", description: "Gib deine E-Mail-Adresse ein. Wir senden dir einen Link, mit dem du dein Passwort zurücksetzen kannst.", action: "Link zum Zurücksetzen senden", loading: "Link wird gesendet …" },
  mfa: { eyebrow: "Noch ein Schritt.", title: "Dein\nSicherheitscode.", description: "Gib den sechsstelligen Code aus deiner Authenticator-App ein. Danach bist du im Hub und auf der Serviceplattform angemeldet.", action: "Bestätigen", loading: "Code wird geprüft …" },
  update: { eyebrow: "Fast geschafft.", title: "Ein neues\nPasswort.", description: "Wähle ein sicheres Passwort für deinen Workspace. Mindestens acht Zeichen sind ein guter Anfang.", action: "Passwort speichern", loading: "Passwort wird gespeichert …" },
};

export function AuthForm({ mode, className, children, ...props }: React.ComponentPropsWithoutRef<"div"> & { mode: AuthMode }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [code, setCode] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  // Registration only: what the oalab team needs to approve the access quickly.
  const [registration, setRegistration] = useState({ firstName: "", lastName: "", companyName: "", phone: "", position: "", website: "", customerNumberHint: "", message: "" });
  const content = copy[mode];
  const field = (key: keyof typeof registration) => ({
    value: registration[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setRegistration((value) => ({ ...value, [key]: event.target.value })),
    disabled: loading,
  });

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!hasEnvVars) { setError(authMessage("setup")); return; }
    const checked = mode === "signup" ? readRegistration({ ...registration, email }) : null;
    if (checked && !checked.ok) { setError(checked.error); return; }
    if ((mode === "signup" || mode === "update") && password !== repeatPassword) { setError("Die beiden Passwörter stimmen noch nicht überein."); return; }
    setLoading(true);
    try {
      // Every auth step runs on the server: the session cookie shared with Service OALab is HTTP-only.
      let result: AuthResult;
      if (mode === "login") {
        result = await signInAction({ email: email.trim(), password, next: new URLSearchParams(window.location.search).get("next") });
      } else if (mode === "mfa") {
        result = await verifySecondFactorAction({ code, next: new URLSearchParams(window.location.search).get("next") });
      } else if (mode === "signup") {
        if (!checked?.ok) return;
        result = await signUpAction({ ...checked.value, password });
      } else if (mode === "forgot") {
        result = await requestPasswordResetAction({ email: email.trim() });
      } else {
        result = await updatePasswordAction({ password });
      }
      if (!result.ok) { setError(result.error); return; }
      if (mode === "forgot") { setSuccess(true); return; }
      // A fresh document: no client router cache or UI state from a previous account survives the auth boundary.
      if (result.redirect) window.location.replace(result.redirect);
    } catch {
      setError(authMessage(null));
    } finally {
      setLoading(false);
    }
  }

  /** The code page belongs to a half-finished login: leaving it ends that session, so another account can sign in. */
  async function leave() {
    setLoading(true);
    await signOutAction().catch(() => null);
    window.location.replace("/auth/login");
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
        {mode === "mfa" && <div className="auth-field"><label htmlFor="code">Code aus der Authenticator-App</label><input id="code" name="one-time-code" className="auth-code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="______" required autoFocus value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} disabled={loading} /></div>}
        {mode !== "update" && mode !== "mfa" && <div className="auth-field"><label htmlFor="email">E-Mail-Adresse</label><input id="email" name="email" type="email" autoComplete="email" placeholder="du@unternehmen.de" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={loading} /></div>}
        {mode !== "forgot" && mode !== "mfa" && <div className="auth-field"><div className="auth-label-row"><label htmlFor="password">{mode === "update" ? "Neues Passwort" : "Passwort"}</label>{mode === "login" && <Link href="/auth/forgot-password">Passwort vergessen?</Link>}</div><div className="password-field"><input id="password" name="password" type={visible ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder={mode === "login" ? "Dein Passwort" : "Mindestens 8 Zeichen"} required minLength={mode === "login" ? undefined : 8} value={password} onChange={(event) => setPassword(event.target.value)} disabled={loading} /><button type="button" aria-label={visible ? "Passwort verbergen" : "Passwort anzeigen"} aria-pressed={visible} onClick={() => setVisible((value) => !value)}>{visible ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}</button></div></div>}
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
      {mode === "mfa" ? <button type="button" className="auth-back-link" onClick={leave} disabled={loading}><LogOut size={18} aria-hidden="true" />Mit einem anderen Konto anmelden</button>
        : mode === "login" ? <p className="auth-bottom-note">Noch kein Konto? <Link href="/auth/sign-up">Jetzt registrieren</Link></p> :<Link className="auth-back-link" href="/auth/login"><ArrowLeft size={18} aria-hidden="true" />Zurück zur Anmeldung</Link>}
      {mode === "mfa" && <p className="auth-security-note"><ShieldCheck size={14} aria-hidden="true" />Dein Konto ist mit einem zweiten Faktor geschützt.</p>}
      {mode === "update" && <p className="auth-security-note"><Check size={14} aria-hidden="true" />Dein Passwort wird verschlüsselt übertragen.</p>}
    </div>
  );
}
