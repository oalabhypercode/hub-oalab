import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StoredProposal, TaskProposal } from "./proposals";

export type ProposalKind = "tasks.create" | "tasks.update" | "project.update";

/**
 * Stores an assistant proposal in hub_assistant_actions (service role only; the route calls this after its own
 * admin check). Nothing is executed here: the admin confirms in the chat, see actions.ts.
 */
export async function saveProposal(actorId: string, kind: ProposalKind, target: { organizationId: string; projectId: string }, payload: object): Promise<{ ok: true; id: string; expiresAt: string } | { ok: false; error: string }> {
  const db = createAdminClient();
  if (!db) return { ok: false, error: "Vorschläge sind noch nicht eingerichtet (Server-Schlüssel fehlt)." };
  const { data, error } = await db
    .from("hub_assistant_actions")
    .insert({ actor_id: actorId, kind, organization_id: target.organizationId, project_id: target.projectId, payload })
    .select("id, expires_at")
    .single<{ id: string; expires_at: string }>();
  if (error || !data) {
    const missing = error?.code === "42P01" || error?.code === "PGRST205";
    return { ok: false, error: missing ? "Vorschläge sind in der Datenbank noch nicht eingerichtet (Migration hub_assistant_actions steht aus)." : "Der Vorschlag konnte nicht gespeichert werden." };
  }
  return { ok: true, id: data.id, expiresAt: data.expires_at };
}

/** New tasks: the proposal is stored as it will be written. */
export async function saveTaskProposal(actorId: string, proposal: TaskProposal): Promise<{ ok: true; view: StoredProposal } | { ok: false; error: string }> {
  const saved = await saveProposal(actorId, "tasks.create", proposal, proposal);
  return saved.ok ? { ok: true, view: { ...proposal, id: saved.id, expiresAt: saved.expiresAt } } : saved;
}
