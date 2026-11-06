"use client";

import { useEffect, useState } from "react";
import { Check, KeyRound, ShieldCheck } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { chooseSecondFactor, confirmAppSetup, getSecondFactorStatus, startAppSetup, type AppSetup, type SecondFactorStatus } from "@/lib/hub-auth/second-factor-actions";
import type { SecondFactorChoice } from "@/lib/hub-auth/second-factor";
import { GlassCard } from "./glass";
import { useInfo } from "./info-box";

/** The app's key in groups of four, easier to type by hand. */
const grouped = (secret: string) => secret.replace(/(.{4})/g, "$1 ").trim();

/**
 * Profile card: the login picks its second factor (off, code by e-mail, authenticator app). Sign-in then asks for
 * exactly that one. A new app shows its QR code and key and is confirmed with its first code.
 */
export function SecondFactorCard() {
  const [status, setStatus] = useState<SecondFactorStatus | null>(null);
  const [choice, setChoice] = useState<SecondFactorChoice>("off");
  const [setup, setSetup] = useState<AppSetup | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const info = useInfo("So funktioniert der zweite Faktor", (
    <ul>
      {/* Freelancers never reach the service platform, so their text names the hub only. */}
      <li>{status?.required ? "Die Methode, die du hier wählst, fragt der Hub bei jeder Anmeldung nach dem Passwort ab." : "Die Methode, die du hier wählst, fragen Hub und Serviceplattform bei jeder Anmeldung nach dem Passwort ab."}</li>
      <li>Code per E-Mail: sechs Ziffern, 10 Minuten gültig. Es gilt nur der Code aus der neuesten E-Mail; ihr Betreff nennt die Uhrzeit, „Neuen Code senden“ schickt einen frischen.</li>
      <li>Authenticator-App: QR-Code scannen und mit dem ersten Code bestätigen. Wechselst du später zu E-Mail oder Aus, wird die App aus deinem Konto entfernt.</li>
      <li>„Passwort vergessen“: Mit Code per E-Mail reicht der Link aus der E-Mail, mit der App brauchst du zusätzlich ihren Code.</li>
      <li>Handy verloren? Das oalab-Team setzt deinen Schutz auf Code per E-Mail zurück.</li>
      {status?.required && <li>Für Freelancer lässt sich der Schutz nicht ausschalten, weil sie die Dateien mehrerer Kunden sehen.</li>}
    </ul>
  ));

  async function load() {
    const result = await getSecondFactorStatus();
    if (!result.ok) { setError(result.error); return; }
    setStatus(result.data);
    setChoice(result.data.choice);
  }

  useEffect(() => {
    let active = true;
    getSecondFactorStatus().then((result) => {
      if (!active) return;
      if (result.ok) { setStatus(result.data); setChoice(result.data.choice); } else setError(result.error);
    });
    return () => { active = false; };
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try { await action(); } catch { setError("Das hat gerade nicht geklappt. Bitte versuche es erneut."); } finally { setBusy(false); }
  }

  const pick = (value: SecondFactorChoice) => { setChoice(value); setSetup(null); setCode(""); setError(""); setNotice(""); };

  const save = () => run(async () => {
    if (choice === "totp") return;
    const before = status?.choice;
    const result = await chooseSecondFactor({ choice });
    if (!result.ok) { setError(result.error); return; }
    // A session without second factor has to confirm the new e-mail code right away, then returns here. A fresh
    // document, as at every auth boundary (components/auth-form.tsx).
    if (choice === "email" && before === "off") {
      window.location.replace(`/auth/mfa?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    await load();
    setNotice(choice === "off" ? "Der Zwei-Faktor-Schutz ist aus." : "Ab jetzt fragen wir bei jeder Anmeldung nach einem Code per E-Mail.");
  });

  const beginApp = () => run(async () => {
    const result = await startAppSetup();
    if (result.ok) setSetup(result.data); else setError(result.error);
  });

  const confirmApp = () => run(async () => {
    const result = await confirmAppSetup({ code, factorId: setup?.mode === "enroll" ? setup.factorId : undefined });
    if (!result.ok) { setError(result.error); return; }
    setSetup(null);
    setCode("");
    await load();
    setNotice("Die Authenticator-App ist eingerichtet. Ab jetzt fragen wir bei jeder Anmeldung nach ihrem Code.");
  });

  const options: { id: SecondFactorChoice; title: string; text: string }[] = [
    { id: "off", title: "Aus", text: status?.required ? "Für Freelancer nicht möglich: Du siehst die Dateien mehrerer Kunden." : "Anmeldung nur mit deinem Passwort." },
    { id: "email", title: "Code per E-Mail", text: `Nach dem Passwort schicken wir dir einen sechsstelligen Code${status?.email ? ` an ${status.email}` : ""}.` },
    { id: "totp", title: "Authenticator-App", text: "Nach dem Passwort gibst du den Code aus einer App wie Google Authenticator, Microsoft Authenticator oder 1Password ein." },
  ];
  const current = status?.choice;
  const leavesApp = current === "totp" && choice !== "totp";

  return (
    <GlassCard className="settings-card second-factor-card">
      <h2 className="t-headline settings-card-title"><ShieldCheck size={20} color="var(--switch-on)" aria-hidden="true" />Zwei-Faktor-Schutz{info.button}</h2>
      {info.box}
      {!status && !error && <p className="t-subheadline t-secondary"><MiniLoader size={16} /> Wird geladen …</p>}
      {status && <>
        <p className="t-subheadline t-secondary">Wähle, womit du deine Anmeldung im Hub und auf der Serviceplattform zusätzlich bestätigst. Gefragt wird genau diese Methode.</p>
        <fieldset className="factor-options" disabled={busy}>
          <legend className="visually-hidden">Methode für den zweiten Faktor</legend>
          {options.map((option) => (
            <label key={option.id} className={`factor-option${choice === option.id ? " is-selected" : ""}`}>
              <input type="radio" name="second-factor" value={option.id} checked={choice === option.id} onChange={() => pick(option.id)} disabled={(option.id === "email" && !status.mailbox) || (option.id === "off" && status.required)} />
              <span><strong>{option.title}{current === option.id && <span className="factor-current"><Check size={14} aria-hidden="true" />aktiv</span>}</strong><small>{option.text}</small></span>
            </label>
          ))}
        </fieldset>

        {choice !== current && choice !== "totp" && <>
          {leavesApp && <p className="t-footnote t-secondary">Deine Authenticator-App wird dabei aus deinem Konto entfernt.</p>}
          {choice === "email" && current === "off" && <p className="t-footnote t-secondary">Zur Bestätigung schicken wir dir gleich einen ersten Code.</p>}
          <button type="button" className="sheet-button sheet-button-primary" onClick={save} disabled={busy}>{busy ? <MiniLoader size={18} /> : <Check size={18} aria-hidden="true" />}{choice === "off" ? "Schutz ausschalten" : "Code per E-Mail verwenden"}</button>
        </>}

        {choice === "totp" && current !== "totp" && !setup && (
          <button type="button" className="sheet-button sheet-button-primary" onClick={beginApp} disabled={busy}>{busy ? <MiniLoader size={18} /> : <KeyRound size={18} aria-hidden="true" />}App einrichten</button>
        )}

        {setup && (
          <form className="factor-setup" onSubmit={(event) => { event.preventDefault(); confirmApp(); }}>
            {setup.mode === "enroll" ? <>
              <p className="t-footnote t-secondary">Scanne den QR-Code mit deiner Authenticator-App oder gib den Schlüssel von Hand ein.</p>
              {/* eslint-disable-next-line @next/next/no-img-element -- data URL from Supabase, nothing to optimise */}
              <img className="factor-qr" src={setup.qrCode} alt="QR-Code für die Authenticator-App" width={176} height={176} />
              <p className="factor-secret numeric" aria-label="Schlüssel für die Authenticator-App">{grouped(setup.secret)}</p>
            </> : <p className="t-footnote t-secondary">Deine Authenticator-App ist schon eingerichtet. Bestätige sie mit ihrem aktuellen Code.</p>}
            <label className="settings-label" htmlFor="factor-code">Code aus der App</label>
            <input id="factor-code" className="account-input auth-code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="______" required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} disabled={busy} />
            <button type="submit" className="sheet-button sheet-button-primary" disabled={busy || code.length !== 6}>{busy ? <MiniLoader size={18} /> : <Check size={18} aria-hidden="true" />}Bestätigen</button>
          </form>
        )}
      </>}
      {notice && <p className="t-footnote factor-notice" role="status">{notice}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </GlassCard>
  );
}
