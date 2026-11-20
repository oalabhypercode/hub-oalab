"use client";

import { useEffect, useState } from "react";
import { Bot, Unplug } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { disconnectHubUserClaude, loadHubUserClaude, setHubUserClaude } from "@/lib/hub-users/actions";
import type { ClaudeConnections } from "@/lib/hub-mcp/actions";
import type { ManagedUser } from "@/lib/hub-users/types";
import { formatFileDateTime } from "@/lib/hub-files/catalog";
import { Switch } from "../controls";
import { useInfo } from "../info-box";
import { Row, RowIcon } from "./users-panel";

type Connections = { enabled: boolean; connections: ClaudeConnections["connections"] };

const rights = (scopes: readonly string[]) => (scopes.includes("hub:write") ? "Lesen und Schreiben" : "Lesen");
const offline = { ok: false as const, error: "Das hat gerade nicht geklappt. Bitte versuche es erneut." };

/**
 * „Claude“ at a freelancer's login in the user management (since 19.11.2026). The admin switches the Claude connector
 * on or off for this login; on, the freelancer connects Claude in their own profile, and Claude works with the
 * freelancer's rights only (lib/hub-mcp/freelancer.ts). Below: the connections the freelancer made, each with
 * „Trennen“. Off ends all of them at once.
 */
export function ClaudeLoginRow({ user, name, onNotice }: { user: ManagedUser; name: string; onNotice: (text: string) => void }) {
  const [on, setOn] = useState(user.claude);
  const [seen, setSeen] = useState(user.claude);
  const [state, setState] = useState<Connections | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const info = useInfo("Claude für Freelancer", {
    steps: [
      <><b>An</b> erlaubt Claude nur mit den Rechten dieses Zugangs.</>,
      <><b>Verbinden</b> geht danach im Profil des Freelancers.</>,
      <><b>Aus</b> trennt jede Verbindung sofort.</>,
    ],
    warn: "Erst nach Vereinbarung mit dem Freelancer einschalten.",
    ask: "Was darf Claude für einen Freelancer im Hub?",
  });

  // Saved elsewhere (another tab, the list reloading): the switch follows the login.
  if (seen !== user.claude) {
    setSeen(user.claude);
    setOn(user.claude);
  }

  useEffect(() => {
    if (!on) return;
    let active = true;
    loadHubUserClaude({ userId: user.id }).then((result) => {
      if (!active) return;
      if (result.ok) setState(result.data); else setError(result.error);
    }).catch(() => { if (active) setError("Die Verbindungen konnten gerade nicht geladen werden."); });
    return () => { active = false; };
  }, [on, user.id]);

  async function toggle(next: boolean) {
    setBusy("switch");
    setError("");
    const result = await setHubUserClaude({ userId: user.id, allowed: next }).catch(() => offline);
    setBusy(null);
    if (!result.ok) { setError(result.error); return; }
    setOn(next);
    setState(null);
    const ended = result.data.ended;
    onNotice(next ? `${name} kann Claude jetzt im eigenen Profil verbinden.`
      : ended ? `Claude für ${name} ausgeschaltet, ${ended === 1 ? "die Verbindung ist" : `${ended} Verbindungen sind`} getrennt.` : `Claude für ${name} ausgeschaltet.`);
  }

  async function end(id: string, client: string) {
    setBusy(id);
    setError("");
    const result = await disconnectHubUserClaude({ userId: user.id, connectionId: id }).catch(() => offline);
    setBusy(null);
    if (!result.ok) { setError(result.error); return; }
    setState((current) => current && { ...current, connections: current.connections.filter((item) => item.id !== id) });
    onNotice(`${client} von ${name} ist getrennt.`);
  }

  const list = on && (
    !state ? (error ? null : <p className="am-help"><MiniLoader size={14} /> Verbindungen werden geladen …</p>)
      : !state.enabled ? <p className="am-help">Der Claude-Connector ist gerade ausgeschaltet. Sobald er an ist, kann der Freelancer Claude verbinden.</p>
      : !state.connections.length ? <p className="am-help">Noch keine Verbindung.</p>
      : <ul className="um-claude-list">
        {state.connections.map((item) => (
          <li key={item.id}>
            <span>
              <strong>{item.clientName}</strong>
              <small>{rights(item.scopes)} · verbunden am {formatFileDateTime(item.createdAt)}{item.endsAt ? ` · gilt bis ${formatFileDateTime(item.endsAt)}` : ""}{item.lastUsedAt ? ` · zuletzt genutzt ${formatFileDateTime(item.lastUsedAt)}` : ""}</small>
            </span>
            <button type="button" className="sheet-action is-quiet" onClick={() => end(item.id, item.clientName)} disabled={busy !== null}>
              {busy === item.id ? <MiniLoader size={14} /> : <Unplug size={14} aria-hidden="true" />}Trennen
            </button>
          </li>
        ))}
      </ul>
  );

  return (
    <Row lead={<RowIcon icon={Bot} />} title={<>Claude{info.button}</>}
      text={on ? "An: Claude arbeitet dann nur mit den Rechten dieses Zugangs: eigene Projekte und Aufgaben, Terminanfragen bei oalab, keine Kontaktdaten der Kunden."
        : "Aus: Mit diesem Zugang lässt sich Claude nicht mit dem Hub verbinden."}
      below={(list || error) && <>{list}{error && <p className="form-error" role="alert">{error}</p>}</>}>
      {info.box}
      {busy === "switch" && <MiniLoader size={14} />}
      <Switch size="sm" checked={on} onChange={toggle} label={`Claude für ${name}`} disabled={busy !== null} />
    </Row>
  );
}
