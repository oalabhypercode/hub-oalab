"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Pencil } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { changeHubUserEmail } from "@/lib/hub-users/actions";
import { cleanEmail, emailChangeMailNote } from "@/lib/hub-users/rules";
import type { ManagedUser } from "@/lib/hub-users/types";
import { ReadonlyField } from "./users-panel";

const offline = { ok: false as const, error: "Das hat gerade nicht geklappt. Bitte versuche es erneut." };

/**
 * The address a login signs in with, in its profile in the User Management: shown with „Kopieren“ as before and, since
 * 23.11.2026, with „Ändern“ (the pencil). Type the new address, „Weiter“, read what happens, confirm. It acts at once,
 * apart from the form's „Speichern“ (lib/hub-users/actions.ts, changeHubUserEmail): the same login with its id and data
 * signs in with the new address only. Not for the admin's own login (`locked`, another admin changes it).
 */
export function LoginEmailField({ user, name, mailConfigured, locked, disabled, onNotice }: {
  user: ManagedUser; name: string; mailConfigured: boolean; locked: boolean; disabled: boolean; onNotice: (text: string) => void;
}) {
  const [step, setStep] = useState<"view" | "edit" | "confirm">("view");
  const [value, setValue] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The new address until the list reloads with it.
  const [changed, setChanged] = useState<{ from: string; to: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const shown = changed && changed.from === user.email ? changed.to : user.email;
  const next = cleanEmail(value);
  const fresh = next.ok && next.value !== shown.toLowerCase();
  const serviceToo = user.role !== "oalab_freelancer";
  const mailable = mailConfigured && user.status === "active";
  const activated = Boolean(user.lastSignInAt);

  useEffect(() => {
    if (step !== "edit") return;
    input.current?.focus();
    input.current?.select();
  }, [step]);

  const close = () => { setStep("view"); setError(""); };
  const proceed = () => {
    if (!next.ok) { setError(next.error); return; }
    if (!fresh) { setError("Das ist schon die Adresse dieses Zugangs."); return; }
    setError("");
    setStep("confirm");
  };

  async function confirm() {
    if (!next.ok) return;
    setBusy(true);
    setError("");
    const result = await changeHubUserEmail({ userId: user.id, email: next.value, notify: mailable && notify }).catch(() => offline);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setChanged({ from: user.email, to: result.data.email });
    setStep("view");
    const note = emailChangeMailNote(result.data.mail);
    onNotice(`${name} meldet sich jetzt mit ${result.data.email} an.${note ? ` ${note}.` : ""}${result.data.activated ? "" : " Ältere Aktivierungslinks gelten nicht mehr."}`);
  }

  if (step === "view") {
    return (
      <ReadonlyField label="E-Mail-Adresse" note="der Login" value={shown} copyLabel={`E-Mail-Adresse von ${name} kopieren`}
        action={!locked && <button type="button" onClick={() => { setValue(shown); setStep("edit"); }} disabled={disabled} aria-label={`E-Mail-Adresse von ${name} ändern`} data-tip="Ändern"><Pencil size={14} aria-hidden="true" /></button>} />
    );
  }

  return (
    <div className="um-field is-wide">
      <span className="am-label">E-Mail-Adresse<small>der Login</small></span>
      {step === "edit" ? (
        <div className="um-stack">
          {/* A text field, neither of the e-mail type nor needed: „Speichern“ of the profile never waits for it. */}
          <input ref={input} className="am-input" type="text" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={254}
            value={value} onChange={(event) => { setValue(event.target.value); setError(""); }} aria-label={`Neue E-Mail-Adresse für ${name}`} disabled={busy}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); proceed(); }
              if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
            }} />
          <p className="am-help">Die neue Adresse wird der Login{serviceToo ? " für Hub und Serviceplattform" : ""}. Vor dem Ändern zeigt der Hub noch einmal, was passiert.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="um-actions">
            <button type="button" className="sheet-action is-quiet" onClick={close}>Abbrechen</button>
            <button type="button" className="sheet-action is-primary" onClick={proceed} disabled={!value.trim()}><ArrowRight size={14} aria-hidden="true" />Weiter</button>
          </div>
        </div>
      ) : (
        <div className="um-stack" role="group" aria-label="E-Mail-Adresse ändern">
          <dl className="um-email-swap">
            <dt>Bisher</dt><dd>{shown}</dd>
            <dt>Neu</dt><dd><strong>{next.ok ? next.value : value}</strong></dd>
          </dl>
          <p className="am-help">
            Danach meldet sich {name} nur noch mit der neuen Adresse an{serviceToo ? ", im Hub und auf der Serviceplattform" : ""}. Der Zugang bleibt derselbe, mit Kunde, Chats, Kalender-Abo, Zwei-Faktor-Schutz und Passwort. Alle Sitzungen enden sofort, und Passwort- oder Aktivierungslinks an die alte Adresse gelten nicht mehr.
            {!activated && user.status === "active" && " Noch nicht aktiviert: Schick danach einen neuen Aktivierungslink an die neue Adresse, oder die Person fordert ihn mit „Passwort vergessen?“ selbst an."}
          </p>
          {mailable && <label className="um-check"><input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} disabled={busy} />Info per E-Mail an die neue und die alte Adresse</label>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="um-actions">
            <button type="button" className="sheet-action is-quiet" onClick={() => { setError(""); setStep("edit"); }} disabled={busy}>Zurück</button>
            <button type="button" className="sheet-action is-primary" onClick={confirm} disabled={busy || !fresh}>{busy ? <MiniLoader size={16} /> : <Check size={14} aria-hidden="true" />}Adresse jetzt ändern</button>
          </div>
        </div>
      )}
    </div>
  );
}
