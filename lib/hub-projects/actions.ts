"use server";

import type { StudioProjectStatus } from "@/lib/hub-data";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { isUuid } from "@/lib/hub-domains/rules";
import { isStudioStatus, studioStatuses } from "./desk";
import { readProjectUrl } from "./map";

// Test and live address of a project, from the admins' project panel. The columns live on customer_projects (migration
// 202610190001 in service-oalab), the one source Studio, Business and the customer read as well. A public POST endpoint:
// the caller's own session must be an active admin with a confirmed second factor before the service role writes.

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const denied = { ok: false as const, error: "Dafür brauchst du einen aktiven Admin-Zugang mit bestätigtem zweitem Faktor." };

/** Saves both addresses of a project; an empty field clears its address. */
export async function saveProjectUrls(input: { projectId?: unknown; liveUrl?: unknown; testUrl?: unknown }): Promise<ActionResult<{ liveUrl: string | null; testUrl: string | null }>> {
  const admin = await verifyHubAdmin();
  const db = admin ? createAdminClient() : null;
  if (!admin || !db) return denied;
  if (!isUuid(input?.projectId)) return { ok: false, error: "Dieses Projekt gibt es nicht mehr." };
  const live = readProjectUrl(input.liveUrl);
  if (!live.ok) return { ok: false, error: `Live-Adresse: ${live.error}` };
  const preview = readProjectUrl(input.testUrl);
  if (!preview.ok) return { ok: false, error: `Test-Adresse: ${preview.error}` };

  const write = await db.from("customer_projects").update({ live_url: live.value, test_url: preview.value })
    .eq("id", input.projectId).neq("status", "archived").select("organization_id, display_name").maybeSingle<{ organization_id: string; display_name: string }>();
  if (write.error) return { ok: false, error: write.error.code === "23514" ? "Bitte nur Adressen mit https:// eintragen." : "Das hat gerade nicht geklappt. Bitte versuche es erneut." };
  if (!write.data) return { ok: false, error: "Dieses Projekt gibt es nicht mehr." };

  const customer = await db.from("hub_customers").select("id").eq("organization_id", write.data.organization_id).maybeSingle<{ id: string }>();
  await db.from("hub_admin_events").insert({ actor_id: admin.userId, action: "project.urls_saved", summary: `Adressen von „${write.data.display_name}“ gespeichert`.slice(0, 300), target_customer_id: customer.data?.id ?? null });
  refreshWorkspace();
  return { ok: true, data: { liveUrl: live.value, testUrl: preview.value } };
}

const stale = { ok: false as const, error: "Der Status wurde inzwischen im Studio geändert. Nichts wurde überschrieben; lade die Seite neu und wähle ihn noch einmal." };

/**
 * Sets a project's Studio status from the admins' project page (Projekte V2, user 15.11.2026). Written with the admin's
 * *own* session, like the assistant's project changes: Studio's RLS lets only team members with a confirmed second
 * factor change projects, and its triggers raise the version and log the change under the admin's name. The version
 * the page showed (null while Studio has no details row yet) keeps a change made in Studio meanwhile from being lost.
 */
export async function setProjectStatus(input: { projectId?: unknown; status?: unknown; expectedVersion?: unknown }): Promise<ActionResult<{ status: StudioProjectStatus; version: number }>> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims || claims.claims.aal !== "aal2") return denied;
  const admin = await verifyHubAdmin();
  const db = admin ? createAdminClient() : null;
  if (!admin || !db) return denied;
  if (!isUuid(input?.projectId)) return { ok: false, error: "Dieses Projekt gibt es nicht mehr." };
  if (!isStudioStatus(input.status)) return { ok: false, error: "Diesen Status gibt es nicht." };
  const expected = input.expectedVersion === null ? null
    : typeof input.expectedVersion === "number" && Number.isSafeInteger(input.expectedVersion) && input.expectedVersion > 0 ? input.expectedVersion
    : undefined;
  if (expected === undefined) return stale;
  const { projectId, status } = input as { projectId: string; status: StudioProjectStatus };

  const project = await db.from("customer_projects").select("organization_id, display_name").eq("id", projectId).neq("status", "archived")
    .maybeSingle<{ organization_id: string; display_name: string }>();
  if (project.error) return { ok: false, error: "Das hat gerade nicht geklappt. Bitte versuche es erneut." };
  if (!project.data) return { ok: false, error: "Dieses Projekt gibt es nicht mehr." };

  const write = expected === null
    // Studio has no details row yet: create it, as Studio does on a project's first change.
    ? await supabase.from("studio_project_details").insert({ project_id: projectId, organization_id: project.data.organization_id, created_by: admin.userId, status }).select("version")
    : await supabase.from("studio_project_details").update({ status }).eq("project_id", projectId).eq("version", expected).select("version");
  if (write.error) {
    return { ok: false, error: write.error.code === "42501" ? "Speichern abgelehnt: Dein Konto braucht im Studio eine Team-Rolle mit bestätigtem zweitem Faktor. Nichts wurde gespeichert."
      : write.error.code === "23505" ? stale.error : "Das hat gerade nicht geklappt. Bitte versuche es erneut." };
  }
  const version = Number((write.data as { version: number }[] | null)?.[0]?.version);
  if (!write.data?.length || !Number.isSafeInteger(version)) return stale;

  const customer = await db.from("hub_customers").select("id").eq("organization_id", project.data.organization_id).maybeSingle<{ id: string }>();
  await db.from("hub_admin_events").insert({ actor_id: admin.userId, action: "project.status_set", summary: `Status von „${project.data.display_name}“: ${studioStatuses[status].label}`.slice(0, 300), target_customer_id: customer.data?.id ?? null });
  refreshWorkspace();
  return { ok: true, data: { status, version } };
}
