import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HUB_TEAM_ROLE, TEAM_KIND, teamRoleOf, type TeamEntry, type TeamRoleState } from "./rules";

// oalab's own entry (kind "team") and the team role in Studio, read and written with the server key: every caller has
// passed its admin check before (the user management's verifyHubAdmin, the project desk, the connector's store).
// Without migration 202611230003 there is no entry, and every caller then behaves as before.

type EntryRow = { id: string; company: string; customer_number: string; organization_id: string | null };

/** The team entry; null without the migration or when the read failed (the hub then shows no internal entry). */
export async function loadTeamEntry(db: SupabaseClient): Promise<TeamEntry | null> {
  const { data, error } = await db.from("hub_customers").select("id, company, customer_number, organization_id").eq("kind", TEAM_KIND).maybeSingle<EntryRow>();
  if (error || !data?.organization_id) return null;
  return { id: data.id, company: data.company, customerNumber: data.customer_number, organizationId: data.organization_id };
}

/** The active oalab organizations, where Studio's team roles live (as the board reads them, lib/hub-tasks/server.ts). */
async function teamOrganizations(db: SupabaseClient): Promise<string[] | null> {
  const { data, error } = await db.from("organizations").select("id").eq("kind", "oalab").eq("status", "active").returns<{ id: string }[]>();
  return error ? null : (data ?? []).map((row) => row.id);
}

/** The organization the hub writes the team role to: the team entry's, else the only active oalab organization. */
async function roleOrganization(db: SupabaseClient): Promise<string | null> {
  const entry = await loadTeamEntry(db);
  if (entry) return entry.organizationId;
  const ids = await teamOrganizations(db);
  return ids?.length === 1 ? ids[0] : null;
}

/** Every login's team role (rules.ts teamRoleOf); empty when the read failed, so nobody shows a role they lack. */
export async function loadTeamRoles(db: SupabaseClient): Promise<Map<string, TeamRoleState>> {
  const organizations = await teamOrganizations(db);
  if (!organizations?.length) return new Map();
  const { data, error } = await db.from("memberships").select("user_id, role, status").in("organization_id", organizations).returns<{ user_id: string; role: string; status: string }[]>();
  if (error) return new Map();
  const rows = new Map<string, { role: string; status: string }[]>();
  for (const row of data ?? []) rows.set(row.user_id, [...(rows.get(row.user_id) ?? []), row]);
  return new Map([...rows].map(([userId, list]) => [userId, teamRoleOf(list)]));
}

/**
 * What a change of the team role does:
 * - grant: „Darf Projekte und Aufgaben bearbeiten“ on: the role Operator, new or back from revoked or paused;
 * - revoke: off, also when a login stops being an admin;
 * - pause / resume: deactivating and reactivating the login.
 */
export type TeamRoleChange = "grant" | "revoke" | "pause" | "resume";
type Outcome = { ok: true; state: TeamRoleState; changed: boolean } | { ok: false; error: string };

const unreachable = { ok: false as const, error: "Die Team-Rolle konnte gerade nicht geändert werden. Bitte versuche es erneut." };

/**
 * Changes the hub's team role (Operator) of a login in the oalab organization. Higher roles (Admin, Release-Management)
 * belong to the service platform: the hub never gives, pauses or takes them; a grant then changes nothing, a revoke says
 * where to change it. The database checks the rest (role fits the organization, status fields).
 */
export async function changeTeamRole(db: SupabaseClient, userId: string, change: TeamRoleChange, actorId: string): Promise<Outcome> {
  const organization = await roleOrganization(db);
  if (!organization) return { ok: false, error: "Die oalab-Organisation der Serviceplattform wurde nicht gefunden. Die Team-Rolle bleibt, wie sie ist." };
  const { data: row, error } = await db.from("memberships").select("id, role, status").eq("organization_id", organization).eq("user_id", userId).maybeSingle<{ id: string; role: string; status: string }>();
  if (error) return unreachable;
  const before = teamRoleOf(row ? [row] : []);
  const now = new Date().toISOString();

  if (row && row.role !== HUB_TEAM_ROLE) {
    if (change === "revoke" && before === "service") return { ok: false, error: "Diese Team-Rolle wurde auf der Serviceplattform vergeben; dort lässt sie sich ändern." };
    if (change === "grant" && before !== "service") return { ok: false, error: "Für diesen Zugang gibt es auf der Serviceplattform eine andere Team-Rolle. Bitte dort wieder freigeben." };
    return { ok: true, state: before, changed: false };
  }

  let next: { status: string; activated_at?: string; suspended_at?: string | null; revoked_at?: string | null } | null = null;
  if (change === "grant" && (!row || row.status !== "active")) next = { status: "active", activated_at: now, suspended_at: null, revoked_at: null };
  if (change === "revoke" && row && row.status !== "revoked") next = { status: "revoked", revoked_at: now };
  if (change === "pause" && row?.status === "active") next = { status: "suspended", suspended_at: now };
  if (change === "resume" && row?.status === "suspended") next = { status: "active", activated_at: now, suspended_at: null };
  if (!next) return { ok: true, state: before, changed: false };

  const written = row
    ? await db.from("memberships").update(next).eq("id", row.id)
    : await db.from("memberships").insert({ organization_id: organization, user_id: userId, role: HUB_TEAM_ROLE, invited_by: actorId, ...next });
  if (written.error) return unreachable;
  return { ok: true, state: teamRoleOf([{ role: HUB_TEAM_ROLE, status: next.status }]), changed: true };
}
