"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, MessageCircle, RefreshCw, Unlink } from "lucide-react";
import { createWhatsAppLinkCode, getWhatsAppStatus, unlinkWhatsApp, type WhatsAppLinkCode, type WhatsAppStatus } from "@/lib/hub-whatsapp/actions";
import { GlassCard } from "./glass";

const timeFormat = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });

/** Profile card: link the own WhatsApp number to the assistant with a code, or remove the link. */
export function WhatsAppCard() {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [code, setCode] = useState<WhatsAppLinkCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    const result = await getWhatsAppStatus();
    if (!result.ok) { setError(result.error); return; }
    setError("");
    setStatus(result.data);
    if (result.data.linkedPhone) setCode(null);
  }

  useEffect(() => {
    let active = true;
    getWhatsAppStatus().then((result) => {
      if (!active) return;
      if (result.ok) setStatus(result.data); else setError(result.error);
    });
    return () => { active = false; };
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try { await action(); } finally { setBusy(false); }
  }

  const createCode = () => run(async () => {
    const result = await createWhatsAppLinkCode();
    if (result.ok) { setCode(result.data); setError(""); } else setError(result.error);
  });
  const unlink = () => run(async () => {
    const result = await unlinkWhatsApp();
    if (result.ok) await refresh(); else setError(result.error);
  });

  return (
    <GlassCard className="settings-card whatsapp-card">
      <h2 className="t-headline settings-card-title"><MessageCircle size={20} color="#128c4a" aria-hidden="true" />WhatsApp verbinden</h2>
      {!status && !error && <p className="t-subheadline t-secondary"><Loader2 size={16} className="spin" aria-hidden="true" /> Wird geladen …</p>}
      {status?.linkedPhone ? <>
        <p className="t-subheadline whatsapp-linked"><Check size={18} aria-hidden="true" />Verbunden mit <strong className="numeric">{status.linkedPhone}</strong></p>
        <p className="t-subheadline t-secondary">Stell dem KI-Assistenten deine Fragen zum Client Hub auch per WhatsApp. Mit „TEAM“ erreichst du einen Menschen.</p>
        <button type="button" className="sheet-button whatsapp-action" onClick={unlink} disabled={busy}>{busy ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <Unlink size={18} aria-hidden="true" />}Trennen</button>
      </> : status && !status.available ? (
        <p className="t-subheadline t-secondary">WhatsApp ist für den Client Hub noch nicht eingerichtet.</p>
      ) : status && <>
        <p className="t-subheadline t-secondary">Stell dem KI-Assistenten deine Fragen zum Client Hub auch per WhatsApp. Dafür verbindest du einmal deine Nummer mit einem Code.</p>
        {code ? (
          <div className="whatsapp-code">
            <p className="t-footnote t-secondary">Sende diese Nachricht an <strong className="numeric">{code.number}</strong>. Der Code gilt bis {timeFormat.format(new Date(code.expiresAt))} Uhr.</p>
            <p className="whatsapp-code-message numeric" aria-label={`Nachricht: VERBINDEN ${code.code}`}>VERBINDEN {code.code}</p>
            <div className="file-assign-actions">
              <a className="sheet-button sheet-button-primary whatsapp-open" href={code.url} target="_blank" rel="noopener noreferrer"><MessageCircle size={18} aria-hidden="true" />In WhatsApp öffnen</a>
              <button type="button" className="sheet-button" onClick={() => run(refresh)} disabled={busy}><RefreshCw size={18} aria-hidden="true" />Ich habe gesendet</button>
            </div>
          </div>
        ) : (
          <button type="button" className="sheet-button sheet-button-primary whatsapp-action" onClick={createCode} disabled={busy}>{busy ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <MessageCircle size={18} aria-hidden="true" />}Code erzeugen</button>
        )}
      </>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="t-footnote t-secondary">Dafür speichern wir deine Nummer und den WhatsApp-Verlauf der letzten zwei Tage. Nachrichten laufen über WhatsApp (Meta) und werden von einer KI (Claude von Anthropic) beantwortet.</p>
    </GlassCard>
  );
}
