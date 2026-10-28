import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ProposalView, TaskProposal } from "./proposals";

/**
 * Stores an assistant proposal in hub_assistant_actions (service role only; the route calls this after its own
 * admin check). Nothing is executed here: the admin confirms in the chat, see actions.ts.
 */
export async function saveTaskProposal(actorId: string, proposal: TaskProposal): Promise<{ ok: true; view: ProposalView } | { ok: false; error: string }> {
  const db = createAdminClient();
  if (!db) return { ok: false, error: "Vorschläge sind noch nicht eingerichtet (Server-Schlüssel fehlt)." };
  const { data, error } = await db
    .from("hub_assistant_actions")
    .insert({ actor_id: actorId, kind: "tasks.create", organization_id: proposal.organizationId, project_id: proposal.projectId, payload: proposal })
    .select("id, expires_at")
    .single<{ id: string; expires_at: string }>();
  if (error || !data) {
    const missing = error?.code === "42P01" || error?.code === "PGRST205";
    return { ok: false, error: missing ? "Vorschläge sind in der Datenbank noch nicht eingerichtet (Migration hub_assistant_actions steht aus)." : "Der Vorschlag konnte nicht gespeichert werden." };
  }
  return { ok: true, view: { ...proposal, id: data.id, expiresAt: data.expires_at } };
}
