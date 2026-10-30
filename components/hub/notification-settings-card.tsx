"use client";

import { useEffect, useState } from "react";
import { Bell, Loader2 } from "lucide-react";
import { getMailNotifications, setMailNotifications } from "@/lib/hub-notify/actions";
import { Switch } from "./controls";
import { GlassCard } from "./glass";

/** Profile card for customers: whether the bundled notification mails go out; the bell stays on. */
export function NotificationSettingsCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getMailNotifications().then((result) => {
      if (!active) return;
      if (result.ok) setEnabled(result.data.enabled); else setError(result.error);
    });
    return () => { active = false; };
  }, []);

  async function change(value: boolean) {
    setBusy(true);
    const result = await setMailNotifications(value);
    setBusy(false);
    if (result.ok) { setEnabled(result.data.enabled); setError(""); } else setError(result.error);
  }

  return (
    <GlassCard className="settings-card">
      <h2 className="t-headline settings-card-title"><Bell size={20} color="var(--accent-text)" aria-hidden="true" />Benachrichtigungen</h2>
      {enabled === null && !error && <p className="t-subheadline t-secondary"><Loader2 size={16} className="spin" aria-hidden="true" /> Wird geladen …</p>}
      {enabled !== null && <div className="settings-switch-row">
        <label htmlFor="mail-notifications" className="t-body">E-Mail-Benachrichtigungen</label>
        {busy ? <Loader2 size={20} className="spin" aria-hidden="true" /> : <Switch id="mail-notifications" checked={enabled} onChange={change} label="E-Mail-Benachrichtigungen" />}
      </div>}
      <p className="t-subheadline t-secondary">Wenn eine Aufgabe bei dir liegt, sich ein Projekt ändert oder eine Datei oder ein Termin für dich dazukommt, zeigt die Glocke das an. {enabled === false ? "E-Mails dazu bekommst du nicht." : "Zusätzlich bekommst du eine E-Mail, die Neuigkeiten einer Viertelstunde bündelt."}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </GlassCard>
  );
}
