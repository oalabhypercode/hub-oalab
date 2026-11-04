"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { getMailNotifications, setMailNotifications } from "@/lib/hub-notify/actions";
import { Switch } from "./controls";
import { GlassCard } from "./glass";

/** Profile card: whether the notification mails go out; the bell stays on. Admins hear of customers' chat messages. */
export function NotificationSettingsCard({ admin = false }: { admin?: boolean }) {
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
      {enabled === null && !error && <p className="t-subheadline t-secondary"><MiniLoader size={16} /> Wird geladen …</p>}
      {enabled !== null && <div className="settings-switch-row">
        <label htmlFor="mail-notifications" className="t-body">E-Mail-Benachrichtigungen</label>
        {busy ? <MiniLoader size={20} /> : <Switch id="mail-notifications" checked={enabled} onChange={change} label="E-Mail-Benachrichtigungen" />}
      </div>}
      <p className="t-subheadline t-secondary">{admin
        ? `Schreibt dir ein Kunde im privaten Chat, zeigt die Glocke das sofort an. ${enabled === false ? "E-Mails dazu bekommst du nicht." : "Zusätzlich kommt nach einigen Minuten eine E-Mail, solange niemand aus dem Team den Chat gelesen hat."}`
        : `Wenn oalab dir im Chat antwortet, eine Aufgabe bei dir liegt, sich ein Projekt ändert oder eine Datei oder ein Termin für dich dazukommt, zeigt die Glocke das an. ${enabled === false ? "E-Mails dazu bekommst du nicht." : "Zusätzlich bekommst du eine E-Mail, die Neuigkeiten einer Viertelstunde bündelt; eine Antwort im Chat, die du vorher im Hub gelesen hast, fällt heraus."}`}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </GlassCard>
  );
}
