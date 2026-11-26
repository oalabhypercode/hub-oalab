"use client";

import { useEffect, useState } from "react";
import { Bell, Send } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { getMailNotifications, getPreviewMail, setMailNotifications, setPreviewMail } from "@/lib/hub-notify/actions";
import { getTelegramStatus, sendTelegramTest } from "@/lib/hub-telegram/actions";
import { Switch } from "./controls";
import { GlassCard } from "./glass";

/** „Neu“ next to the switch for the test view e-mail until the end of the year it came (26.11.2026). */
const PREVIEW_MAIL_NEW_UNTIL = "2026-12-31";

/**
 * Profile card: whether the notification mails go out; the bell stays on. Admins hear of customers' chat messages.
 * Customers also switch the service platform's e-mail for a new test view here (26.11.2026).
 */
export function NotificationSettingsCard({ admin = false, customer = false, asOf }: { admin?: boolean; customer?: boolean; asOf?: string }) {
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
      {customer && <PreviewMailRow fresh={Boolean(asOf && asOf <= PREVIEW_MAIL_NEW_UNTIL)} />}
      {admin && <TelegramRow />}
    </GlassCard>
  );
}

/**
 * Customers: the service platform's e-mail when a new test view is ready, with date, time and link. It goes to the
 * addresses under „Updates erhalten“ there and is the same switch; without a company on the service platform (or
 * before the server knows the switch) the row stays away.
 */
function PreviewMailRow({ fresh }: { fresh: boolean }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getPreviewMail().then((result) => { if (active && result.ok && result.data) setEnabled(result.data.enabled); }).catch(() => {});
    return () => { active = false; };
  }, []);

  async function change(value: boolean) {
    setBusy(true);
    const result = await setPreviewMail(value).catch(() => ({ ok: false as const, error: "Keine Verbindung. Bitte versuche es erneut." }));
    setBusy(false);
    if (result.ok) { setEnabled(result.data.enabled); setError(""); } else setError(result.error);
  }

  if (enabled === null) return null;
  return (
    <>
      <hr className="settings-divider" />
      <div className="settings-switch-row">
        <label htmlFor="preview-mail" className="t-body">Neue Testansicht per E-Mail{fresh && <span className="settings-new">Neu</span>}</label>
        {busy ? <MiniLoader size={20} /> : <Switch id="preview-mail" checked={enabled} onChange={change} label="Neue Testansicht per E-Mail" />}
      </div>
      <p className="t-subheadline t-secondary">{enabled
        ? "Sobald ein neuer Stand auf deiner Testseite liegt, schickt dir die Serviceplattform eine kurze E-Mail mit Datum, Uhrzeit und Link. Sie geht an deine Adressen unter „Updates erhalten“; dort und hier ist es derselbe Schalter."
        : "Ausgeschaltet: Zu neuen Testansichten kommt keine E-Mail. Auf der Serviceplattform siehst du sie weiter im Chat."}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </>
  );
}

/**
 * Admins: whether the team's Telegram group gets a message when a customer writes, and a test message to check the
 * setup. The group and the bot come from the environment; nothing here changes them.
 */
function TelegramRow() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getTelegramStatus().then((result) => { if (active && result.ok) setReady(result.data.ready); }).catch(() => {});
    return () => { active = false; };
  }, []);

  async function test() {
    setState("sending");
    setError("");
    const result = await sendTelegramTest().catch(() => ({ ok: false as const, error: "Keine Verbindung. Bitte versuche es erneut." }));
    setState(result.ok ? "sent" : "idle");
    if (!result.ok) setError(result.error);
  }

  if (ready === null) return null;
  return (
    <>
      <div className="settings-switch-row">
        <span className="t-body">Telegram-Gruppe</span>
        {ready
          ? <button type="button" className="sheet-action" onClick={test} disabled={state === "sending"}>{state === "sending" ? <MiniLoader size={16} /> : <Send size={15} aria-hidden="true" />}Testmeldung senden</button>
          : <span className="t-subheadline t-secondary">Nicht eingerichtet</span>}
      </div>
      <p className="t-subheadline t-secondary" role="status">{state === "sent"
        ? "Gesendet. Schau in eure Telegram-Gruppe."
        : ready
          ? "Schreibt ein Kunde, kommt seine Nachricht mit Firma und Name in eure Telegram-Gruppe. Antworten könnt ihr über den Knopf „Im Hub öffnen“."
          : "Mit Bot-Token und Gruppen-Nummer in der Einrichtung des Hubs kommen die Nachrichten eurer Kunden auch in eure Telegram-Gruppe."}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </>
  );
}
