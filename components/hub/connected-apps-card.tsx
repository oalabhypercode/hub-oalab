"use client";

import { useEffect, useState } from "react";
import { Bot, Copy, Check, Unplug } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { disconnectClaude, loadClaudeConnections, type ClaudeConnections } from "@/lib/hub-mcp/actions";
import { GlassCard } from "./glass";
import { useInfo } from "./info-box";

const when = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" });
const rights = (scopes: string[]) => (scopes.includes("hub:write") ? "Lesen und Schreiben" : "Lesen");

/**
 * Profile card for admins: the address to give Claude, and every connection this admin allowed, with „Trennen“.
 * Connections are allowed on the consent page (/dashboard/settings/claude) during Claude's sign-in.
 */
export function ConnectedAppsCard() {
  const [state, setState] = useState<ClaudeConnections | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const info = useInfo("Claude verbinden", {
    steps: [
      <><b>In Claude</b> bei den Connectors einen eigenen hinzufügen.</>,
      <><b>Adresse</b> von hier einfügen und verbinden.</>,
      <><b>Im Hub</b> mit Code bestätigen und „Erlauben“ wählen.</>,
    ],
    warn: "Claude arbeitet mit deinen Admin-Rechten.",
    ask: "Wie verbinde ich Claude mit dem Hub?",
  });

  useEffect(() => {
    let active = true;
    loadClaudeConnections().then((result) => {
      if (!active) return;
      if (result.ok) setState(result.data); else setError(result.error);
    }).catch(() => { if (active) setError("Die Verbindungen konnten gerade nicht geladen werden."); });
    return () => { active = false; };
  }, []);

  async function copy() {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Kopieren ging nicht. Markiere die Adresse und kopiere sie selbst.");
    }
  }

  async function end(id: string, name: string) {
    setBusy(id);
    setError("");
    setNotice("");
    const result = await disconnectClaude(id).catch(() => ({ ok: false as const, error: "Keine Verbindung. Bitte versuche es erneut." }));
    setBusy(null);
    if (!result.ok) { setError(result.error); return; }
    setState((current) => current && { ...current, connections: current.connections.filter((item) => item.id !== id) });
    setNotice(`${name} ist getrennt. Claude kommt ab sofort nicht mehr in den Hub.`);
  }

  return (
    <GlassCard className="settings-card connected-apps-card">
      <h2 className="t-headline settings-card-title"><Bot size={20} color="var(--accent-text)" aria-hidden="true" />Verbundene Apps{info.button}</h2>
      {info.box}
      {!state && !error && <p className="t-subheadline t-secondary"><MiniLoader size={16} /> Wird geladen …</p>}
      {state && !state.enabled && <p className="t-subheadline t-secondary">Der Claude-Connector ist noch ausgeschaltet. Sobald er an ist, verbindest du Claude hier mit dem Hub.</p>}
      {state?.enabled && <>
        <p className="t-subheadline t-secondary">Mit Claude fragst du in deinen Chats nach Kunden, Projekten, Aufgaben und Terminen; Claude liest sie mit deinen Rechten im Hub.</p>
        <label className="settings-label" htmlFor="claude-address">Adresse für Claude</label>
        <div className="connected-apps-address">
          <input id="claude-address" className="account-input" readOnly value={state.address} onFocus={(event) => event.currentTarget.select()} />
          <button type="button" className="sheet-action" onClick={copy}>{copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{copied ? "Kopiert" : "Kopieren"}</button>
        </div>
        {state.connections.length === 0
          ? <p className="t-footnote t-secondary">Noch keine Verbindung.</p>
          : <ul className="connected-apps-list">
            {state.connections.map((item) => (
              <li key={item.id}>
                <span>
                  <strong>{item.clientName}</strong>
                  <small>{rights(item.scopes)} · verbunden am {when.format(new Date(item.createdAt))}{item.lastUsedAt ? ` · zuletzt genutzt ${when.format(new Date(item.lastUsedAt))}` : ""}</small>
                </span>
                <button type="button" className="sheet-action" onClick={() => end(item.id, item.clientName)} disabled={busy !== null}>
                  {busy === item.id ? <MiniLoader size={15} /> : <Unplug size={15} aria-hidden="true" />}Trennen
                </button>
              </li>
            ))}
          </ul>}
      </>}
      {notice && <p className="t-footnote factor-notice" role="status">{notice}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </GlassCard>
  );
}
