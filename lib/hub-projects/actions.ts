"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { isUuid } from "@/lib/hub-domains/rules";
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
