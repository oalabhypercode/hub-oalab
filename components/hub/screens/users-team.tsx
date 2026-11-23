"use client";

import { useState } from "react";
import { FolderKanban } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { setHubUserTeamRole } from "@/lib/hub-users/actions";
import type { ManagedUser } from "@/lib/hub-users/types";
import { teamRoleText, writesProjects, type TeamRoleState } from "@/lib/hub-team/rules";
import { Switch } from "../controls";
import { useInfo } from "../info-box";
import { Row, RowIcon } from "./users-panel";

const offline = { ok: false as const, error: "Das hat gerade nicht geklappt. Bitte versuche es erneut." };

/**
 * „Projekte und Aufgaben“ at an admin's login (plan „oalab als Unternehmen“, decision 4): the switch gives or takes
 * Studio's smallest team role, Operator, in the oalab organization. Without it an admin writes notes and everything
 * else, but no projects and tasks. A role given on the service platform stands here read-only, as does the paused one
 * of a deactivated login and the admin's own (nobody locks themself out of the board).
 */
export function TeamRoleRow({ user, name, onNotice }: { user: ManagedUser; name: string; onNotice: (text: string) => void }) {
  const [state, setState] = useState<TeamRoleState>(user.teamRole);
  const [seen, setSeen] = useState(user.teamRole);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const info = useInfo("Projekte und Aufgaben", {
    steps: [
      <><b>An</b> gibt die Team-Rolle „Operator“ im Studio.</>,
      <><b>Damit</b> legt die Person Projekte und Aufgaben an.</>,
      <><b>Auch</b> Anfragen auf der Serviceplattform bearbeitet sie.</>,
    ],
    ask: "Was heißt „Projekte und Aufgaben“ bei einem Admin?",
  });

  // Saved elsewhere (another tab, the list reloading): the switch follows the login.
  if (seen !== user.teamRole) {
    setSeen(user.teamRole);
    setState(user.teamRole);
  }

  async function toggle(on: boolean) {
    setBusy(true);
    setError("");
    const result = await setHubUserTeamRole({ userId: user.id, on }).catch(() => offline);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setState(on ? "hub" : "none");
    onNotice(on ? `${name} kann jetzt Projekte und Aufgaben bearbeiten.` : `${name} bearbeitet keine Projekte und Aufgaben mehr.`);
  }

  const locked = state === "service" || state === "paused" || (user.self && state !== "none");
  return (
    <Row lead={<RowIcon icon={FolderKanban} />} title={<>Projekte und Aufgaben{info.button}</>} text={teamRoleText(state)}
      below={error && <p className="form-error" role="alert">{error}</p>}>
      {info.box}
      {busy && <MiniLoader size={14} />}
      <Switch size="sm" checked={writesProjects(state)} onChange={toggle} label={`Projekte und Aufgaben für ${name}`} disabled={busy || locked} />
    </Row>
  );
}
