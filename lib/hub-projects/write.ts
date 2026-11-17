import "server-only";
import type { StudioProjectStatus } from "@/lib/hub-data";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/hub-domains/rules";
import { isStudioStatus } from "./desk";
import { projectKeyFrom, readProjectDraft } from "./edit";

// „Neues Projekt“ once the caller has passed the team's checks, shared by the project page (lib/hub-projects/actions.ts,
// the admin's own session) and the Claude connector (lib/hub-mcp/writes.ts, a key with the admin's claims). Studio's
// part goes through `supabase`, so its RLS and triggers decide; the project row through the server key, as before.
// Refreshing the page is the caller's business: only a Server Action can do it.

type Result<T> = { ok: true; data: T } | { ok: false; error: string; stale?: true };

/** The admin who writes: Studio's part with `supabase` (own session or the connector's key), the rest with `db`. */
export type ProjectTeam = { userId: string; supabase: Awaited<ReturnType<typeof createClient>>; db: NonNullable<ReturnType<typeof createAdminClient>> };

export const failed = { ok: false as const, error: "Das hat gerade nicht geklappt. Bitte versuche es erneut." };
const noTeamRole = "Speichern abgelehnt: Dein Konto braucht im Studio eine Team-Rolle mit bestätigtem zweitem Faktor. Nichts wurde gespeichert.";

/** Studio's answer to a refused write, in words. */
export function studioError(error: { code?: string; message?: string }) {
  if (error.code === "42501") return noTeamRole;
  if (error.code === "23514") return error.message?.includes("MILESTONE") ? "Das Studio hat die Meilensteine abgelehnt. Bitte prüfe Datum und Namen." : "Das Studio hat die Angaben abgelehnt. Bitte prüfe Start, Zieltermin und Meilensteine.";
  return failed.error;
}

/**
 * „Neues Projekt“ for a hub customer, the way Studio creates one: a project row on the customer's service platform
 * organization, with a key made from the name, and its Studio details (status, description, days, milestones,
 * visibility). If Studio refuses its part, the project row is taken back, so nothing half-made stays behind. The admin
 * log names the way it came: the project page (`project.created`) or Claude (`claude.project.created`).
 */
export async function createProjectAs(
  ctx: ProjectTeam,
  input: { customerId?: unknown; status?: unknown; visible?: unknown; draft?: unknown },
  via: "hub" | "claude" = "hub",
): Promise<Result<{ id: string; name: string; customerId: string }>> {
  if (!isUuid(input?.customerId)) return { ok: false, error: "Diesen Kunden gibt es nicht mehr." };
  const read = readProjectDraft(input.draft);
  if (!read.ok) return { ok: false, error: read.error };
  const status: StudioProjectStatus | null = input.status === undefined ? "planning" : isStudioStatus(input.status) ? input.status : null;
  if (!status) return { ok: false, error: "Diesen Status gibt es nicht." };
  if (input.visible !== undefined && typeof input.visible !== "boolean") return { ok: false, error: "Diese Angabe ist ungültig." };
  const fields = read.value;

  const customer = await ctx.db.from("hub_customers").select("id, organization_id, kind").eq("id", input.customerId)
    .maybeSingle<{ id: string; organization_id: string | null; kind: string | null }>();
  if (customer.error) return failed;
  if (!customer.data || (customer.data.kind ?? "customer") !== "customer") return { ok: false, error: "Diesen Kunden gibt es nicht mehr." };
  const organizationId = customer.data.organization_id;
  if (!organizationId) return { ok: false, error: "Dieser Kunde ist noch nicht auf der Serviceplattform. Ohne Organisation dort gibt es kein Projekt." };
  const organization = await ctx.db.from("organizations").select("status").eq("id", organizationId).maybeSingle<{ status: string }>();
  if (organization.error) return failed;
  if (organization.data?.status !== "active") return { ok: false, error: "Die Organisation des Kunden ist auf der Serviceplattform nicht aktiv. Dort kann gerade kein Projekt entstehen." };

  let projectId: string | null = null;
  // A key taken a moment ago by someone else (23505): once more with a fresh list.
  for (let attempt = 0; attempt < 2 && !projectId; attempt++) {
    const keys = await ctx.db.from("customer_projects").select("project_key").eq("organization_id", organizationId).returns<{ project_key: string }[]>();
    if (keys.error) return failed;
    const insert = await ctx.db.from("customer_projects")
      .insert({ organization_id: organizationId, project_key: projectKeyFrom(fields.name, (keys.data ?? []).map((row) => row.project_key)), display_name: fields.name, live_url: fields.liveUrl, test_url: fields.testUrl, created_by: ctx.userId })
      .select("id").single<{ id: string }>();
    if (insert.error?.code === "23505") continue;
    if (insert.error || !insert.data) return { ok: false, error: insert.error?.code === "23514" ? "Bitte nur Adressen mit https:// eintragen." : failed.error };
    projectId = insert.data.id;
  }
  if (!projectId) return failed;

  const details = await ctx.supabase.from("studio_project_details").insert({
    project_id: projectId,
    organization_id: organizationId,
    created_by: ctx.userId,
    description: fields.description,
    status,
    start_date: fields.startDate,
    due_date: fields.dueDate,
    milestones: fields.milestones,
    client_visible: input.visible === true,
  }).select("version");
  if (details.error || !details.data?.length) {
    const back = await ctx.db.from("customer_projects").delete().eq("id", projectId);
    if (back.error) console.error("[hub-projects] could not take back a project Studio refused", projectId, back.error.code);
    return { ok: false, error: details.error ? studioError(details.error) : failed.error };
  }

  await ctx.db.from("hub_admin_events").insert({
    actor_id: ctx.userId,
    action: via === "claude" ? "claude.project.created" : "project.created",
    summary: `Projekt „${fields.name}“ ${via === "claude" ? "über Claude " : ""}angelegt`.slice(0, 300),
    target_customer_id: customer.data.id,
  });
  return { ok: true, data: { id: projectId, name: fields.name, customerId: customer.data.id } };
}
