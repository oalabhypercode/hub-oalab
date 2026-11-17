"use client";

import { useState } from "react";
import Link from "next/link";
import { Bot, Check, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { answerClaude } from "@/lib/hub-mcp/actions";
import type { ConsentState } from "@/lib/hub-mcp/consent";
import { GlassCard, TitleIcon } from "./glass";
import { LargeTitleHeader } from "./large-title-header";

/**
 * The consent page of the Claude connector (/dashboard/settings/claude): Claude asks, the admin allows or refuses,
 * and the browser goes back to Claude. Before allowing, a session without confirmed code confirms it first.
 */
export function ClaudeConsent({ state }: { state: ConsentState }) {
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");

  async function answer(allow: boolean) {
    if (state.kind === "off" || state.kind === "expired") return;
    setBusy(allow ? "allow" : "deny");
    setError("");
    const result = await answerClaude(state.request, allow).catch(() => ({ ok: false as const, error: "Keine Verbindung. Bitte versuche es erneut." }));
    if (result.ok) {
      setLeaving(true);
      window.location.assign(result.data.url);
      return;
    }
    setBusy(null);
    setError(result.error);
  }

  const refuse = (label: string) => (
    <button type="button" className="sheet-button" onClick={() => answer(false)} disabled={busy !== null || leaving}>
      {busy === "deny" ? <MiniLoader size={18} /> : <X size={18} aria-hidden="true" />}{label}
    </button>
  );

  return (
    <>
      <LargeTitleHeader title="Claude verbinden" icon={<TitleIcon icon={Bot} />} />
      <div className="settings-grid section-first">
        <GlassCard className="settings-card claude-consent">
          {state.kind === "off" && <>
            <h2 className="t-headline settings-card-title"><Bot size={20} color="var(--accent-text)" aria-hidden="true" />Gerade ausgeschaltet</h2>
            <p className="t-subheadline t-secondary">Der Claude-Connector des Hubs ist gerade ausgeschaltet. Versuche es später erneut.</p>
          </>}

          {state.kind === "expired" && <>
            <h2 className="t-headline settings-card-title"><Bot size={20} color="var(--accent-text)" aria-hidden="true" />Anfrage abgelaufen</h2>
            <p className="t-subheadline t-secondary">Diese Anfrage ist abgelaufen oder schon beantwortet. Starte die Verbindung in Claude neu; dann kommst du wieder hierher.</p>
            <Link className="text-link" href="/dashboard/settings">Zum Profil</Link>
          </>}

          {state.kind === "not-admin" && <>
            <h2 className="t-headline settings-card-title"><Bot size={20} color="var(--accent-text)" aria-hidden="true" />Nur für Admins</h2>
            <p className="t-subheadline t-secondary">Claude lässt sich nur mit einem Admin-Login mit dem Hub verbinden.</p>
            <div className="claude-consent-actions">{refuse("Zurück zu Claude")}</div>
          </>}

          {(state.kind === "confirm" || state.kind === "ready") && <>
            <h2 className="t-headline settings-card-title"><Bot size={20} color="var(--accent-text)" aria-hidden="true" />{state.clientName} möchte auf deinen Hub zugreifen</h2>
            <p className="t-subheadline t-secondary">Claude arbeitet dann mit deinen Rechten als Admin ({state.email}).</p>
            <p className="t-footnote claude-consent-label">Das darf Claude:</p>
            <ul className="claude-consent-scopes">
              {state.scopes.map((scope) => <li key={scope}><Check size={16} aria-hidden="true" /><span>{scope}</span></li>)}
            </ul>
            {state.writes && <p className="t-footnote t-secondary">Vor jeder Änderung fragt Claude dich, ob es sie machen darf, solange du das in Claude nicht abschaltest. Jede Änderung steht im Admin-Protokoll, und Termine mit Kunde schicken dem Kunden eine Meldung wie im Hub.</p>}
            <p className="t-footnote t-secondary">Löschen kann Claude nichts. Die Verbindung siehst und trennst du jederzeit im Profil unter „Verbundene Apps“.</p>
            <p className="claude-consent-warn t-footnote"><TriangleAlert size={15} aria-hidden="true" /><span>Erlaube das nur, wenn du die Verbindung gerade selbst in Claude gestartet hast.</span></p>
            {state.kind === "confirm"
              ? <>
                <p className="t-subheadline t-secondary">Bestätige dich zuerst mit dem Code aus deiner E-Mail; danach kommst du hierher zurück.</p>
                <div className="claude-consent-actions">
                  <a className="sheet-button sheet-button-primary" href={state.confirmHref}><ShieldCheck size={18} aria-hidden="true" />Mit Code bestätigen</a>
                  {refuse("Ablehnen")}
                </div>
              </>
              : <div className="claude-consent-actions">
                <button type="button" className="sheet-button sheet-button-primary" onClick={() => answer(true)} disabled={busy !== null || leaving}>
                  {busy === "allow" ? <MiniLoader size={18} /> : <Check size={18} aria-hidden="true" />}Erlauben
                </button>
                {refuse("Ablehnen")}
              </div>}
          </>}

          {leaving && <p className="t-footnote t-secondary" role="status"><MiniLoader size={14} /> Weiter zu Claude …</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
        </GlassCard>
      </div>
    </>
  );
}
