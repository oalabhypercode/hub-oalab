/**
 * oalab as its own company in the hub (plan docs/planung/oalab-als-unternehmen.md, stage 1, approved 23.11.2026):
 * one entry of the kind "team" in hub_customers, on the oalab organization of the service platform where Studio's team
 * roles live (migration 202611230003_hub_team_entry in service-oalab). Admins belong to it by their role, never as
 * members; internal projects live on its organization. Self-contained (no imports), so pages, server and `node --test`
 * share it.
 */

export const TEAM_KIND = "team";
/** The tag internal things carry wherever customers' things stand next to them. */
export const INTERNAL_TAG = "Intern";

export const isTeamKind = (kind: unknown): kind is typeof TEAM_KIND => kind === TEAM_KIND;

/** The entry as the hub uses it; null until the migration created it. */
export type TeamEntry = { id: string; company: string; customerNumber: string; organizationId: string };

/** Studio's team roles: an active one in the oalab organization lets a login write projects and tasks. */
export const TEAM_ROLES = ["oalab_operator", "oalab_release_manager", "oalab_admin"] as const;
/** The smallest team role, the one the hub gives and takes („Darf Projekte und Aufgaben bearbeiten“). */
export const HUB_TEAM_ROLE = "oalab_operator";

/**
 * A login's team role as the user management shows it:
 * - none: no active team role, so no projects and tasks;
 * - hub: the smallest role, given in the hub, which the hub may also take back;
 * - service: a higher role (Admin, Release-Management) given on the service platform, changed only there;
 * - paused: the hub's role while the login is deactivated.
 */
export type TeamRoleState = "none" | "hub" | "service" | "paused";

type MembershipRow = { role: string; status: string };

/** The state from the login's memberships in the oalab organization (at most one row per organization). */
export function teamRoleOf(rows: readonly MembershipRow[]): TeamRoleState {
  if (rows.some((row) => row.status === "active" && row.role !== HUB_TEAM_ROLE && (TEAM_ROLES as readonly string[]).includes(row.role))) return "service";
  if (rows.some((row) => row.status === "active" && row.role === HUB_TEAM_ROLE)) return "hub";
  if (rows.some((row) => row.status === "suspended" && row.role === HUB_TEAM_ROLE)) return "paused";
  return "none";
}

/** Whether the state lets the login write projects and tasks in Studio. */
export const writesProjects = (state: TeamRoleState) => state === "hub" || state === "service";

/** The line under „Projekte und Aufgaben“ in a login's „Sicherheit“. */
export function teamRoleText(state: TeamRoleState): string {
  switch (state) {
    case "hub": return "An: legt Projekte und Aufgaben an, übernimmt Aufgaben und arbeitet auf der Serviceplattform an Anfragen mit (Team-Rolle „Operator“).";
    case "service": return "Diese Team-Rolle wurde auf der Serviceplattform vergeben und lässt sich nur dort ändern.";
    case "paused": return "Ruht, solange der Zugang deaktiviert ist; mit dem Aktivieren gilt sie wieder.";
    default: return "Aus: Notizen und alles andere gehen, aber keine Projekte und Aufgaben.";
  }
}

/** The tag of an entry in lists where customers and the team stand together. */
export const entryTag = (kind: unknown) => isTeamKind(kind) ? INTERNAL_TAG : null;

// ---- Stage 2: notes and files of oalab (migration 202611240002_hub_team_notes in service-oalab) ----------------------

/**
 * „Sichtbar für“ at oalab: only the team, or the team and freelancers. The entry never has members, so nobody of a
 * customer ever sees it. Notes keep „Team und Freelancer“ as their level „Nur Freelancer“, files keep „Nur Team“ as
 * „Nur Kunde“ (the database sets both, whatever the hub sends). Freelancers see oalab only once they may look after it
 * (stage 3).
 */
export type TeamSight = "team" | "freelancer";
export const TEAM_SIGHTS: readonly TeamSight[] = ["team", "freelancer"];
export const TEAM_SIGHT_LABELS: Record<TeamSight, string> = { team: "Nur Team", freelancer: "Team und Freelancer" };
/** The sentence under the choice. */
export const TEAM_SIGHT_NOTES: Record<TeamSight, string> = {
  team: "Alle Admins sehen und bearbeiten sie. Kunden sehen bei oalab nie etwas.",
  freelancer: "Dazu Freelancer, sobald sie oalab mitbetreuen. Kunden sehen bei oalab nie etwas.",
};

/** A note's level at oalab: „Team und Freelancer“ wherever freelancers would see it, else „Nur Team“. */
export const teamSightOfNote = (audience: unknown): TeamSight => audience === "freelancer" || audience === "both" ? "freelancer" : "team";
/** A file's level at oalab: stored as „Nur Kunde“ (only the team) or „Nur Freelancer“ (with freelancers). */
export const teamSightOfFile = (audience: unknown): TeamSight => audience === "freelancer" || audience === "both" ? "freelancer" : "team";
/** What a file assignment at oalab stores for a level. */
export const fileAudienceOfTeamSight = (sight: TeamSight) => sight === "freelancer" ? "freelancer" as const : "customer" as const;

/** The optional sentence of „Team informieren“: one line, at most this long. */
export const TEAM_MESSAGE_MAX = 200;
/** The sentence as stored in the bell: trimmed, one line; null when it is too long. */
export function cleanTeamMessage(value: unknown): string | null {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text.length > TEAM_MESSAGE_MAX ? null : text;
}
