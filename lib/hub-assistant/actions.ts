"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import { CUSTOMER_LABEL } from "@/lib/hub-projects/map";
import { applyChoices, type TaskProposal } from "./proposals";

// Confirming or discarding an assistant proposal. Each action is a public POST endpoint: it checks the admin again
// (role, second factor, is_hub_admin() and aal2), claims the proposal in one UPDATE so a double click runs it once,
// and writes the tasks with the admin's *own* session. Studio's RLS and triggers then check the team role, validate
// the rows and log the change under the admin's name, exactly as when the task is created in Studio.

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const denied = { ok: false as const, error: "Dafür brauchst du einen aktiven Admin-Zugang mit bestätigtem zweiten Faktor." };

async function actor() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims || data.claims.aal !== "aal2") return null;
  const admin = await verifyHubAdmin();
  const db = createAdminClient();
  return admin && db ? { userId: admin.userId, supabase, db } : null;
}

type ClaimedRow = { id: string; payload: TaskProposal };

/** Why a proposal can no longer be decided, for the message in the chat. */
async function whyNotOpen(db: NonNullable<ReturnType<typeof createAdminClient>>, id: string, userId: string) {
  const { data } = await db.from("hub_assistant_actions").select("status, expires_at").eq("id", id).eq("actor_id", userId).maybeSingle<{ status: string; expires_at: string }>();
  if (!data) return "Diesen Vorschlag gibt es nicht.";
  if (data.status === "done") return "Dieser Vorschlag ist schon gespeichert.";
  if (data.status === "discarded") return "Dieser Vorschlag wurde verworfen.";
  if (data.status === "executing") return "Dieser Vorschlag wird gerade gespeichert.";
  if (data.status === "failed") return "Dieser Vorschlag ist fehlgeschlagen. Bitte den Assistenten neu vorschlagen lassen.";
  return "Dieser Vorschlag ist abgelaufen (30 Minuten). Bitte den Assistenten neu vorschlagen lassen.";
}

/** Saves the chosen tasks of a proposal in Studio. `choices` holds one switch set per proposed task. */
export async function confirmTaskProposal(input: { id: string; choices: unknown }): Promise<ActionResult<{ saved: number; taskNumbers: number[] }>> {
  const ctx = await actor();
  if (!ctx) return denied;
  const id = typeof input?.id === "string" && uuid.test(input.id) ? input.id : null;
  if (!id) return { ok: false, error: "Diesen Vorschlag gibt es nicht." };

  const { data: claimed } = await ctx.db
    .from("hub_assistant_actions")
    .update({ status: "executing" })
    .eq("id", id).eq("actor_id", ctx.userId).eq("kind", "tasks.create").eq("status", "proposed").gt("expires_at", new Date().toISOString())
    .select("id, payload")
    .maybeSingle<ClaimedRow>();
  if (!claimed) return { ok: false, error: await whyNotOpen(ctx.db, id, ctx.userId) };

  const finish = async (status: "done" | "failed", fields: { result?: object; error_code?: string }) => {
    await ctx.db.from("hub_assistant_actions").update({ status, decided_at: new Date().toISOString(), ...fields }).eq("id", id);
  };
  const proposal = claimed.payload;
  const chosen = applyChoices(proposal.tasks, input.choices);
  if (!chosen.ok) {
    // Back to proposed: a wrong selection must not use up the proposal.
    await ctx.db.from("hub_assistant_actions").update({ status: "proposed" }).eq("id", id);
    return chosen;
  }

  const project = await ctx.db.from("customer_projects").select("organization_id, status").eq("id", proposal.projectId).maybeSingle<{ organization_id: string; status: string }>();
  if (!project.data || project.data.status === "archived" || project.data.organization_id !== proposal.organizationId) {
    await finish("failed", { error_code: "PROJECT_GONE" });
    return { ok: false, error: "Das Projekt gibt es nicht mehr oder es ist archiviert. Nichts wurde gespeichert." };
  }

  // One insert: all tasks or none.
  const { data: rows, error } = await ctx.supabase
    .from("studio_tasks")
    .insert(chosen.tasks.map((task) => ({
      organization_id: proposal.organizationId,
      project_id: proposal.projectId,
      title: task.title,
      description: task.description,
      status: "todo",
      priority: "none",
      due_date: task.dueOn,
      labels: task.customer ? [CUSTOMER_LABEL] : [],
      client_visible: task.visible,
      created_by: ctx.userId,
    })))
    .select("id, task_number")
    .returns<{ id: string; task_number: number }[]>();
  if (error || !rows) {
    await finish("failed", { error_code: (error?.code ?? "UNKNOWN").slice(0, 80) });
    return {
      ok: false,
      error: error?.code === "42501"
        ? "Speichern abgelehnt: Dein Konto braucht im Studio eine Team-Rolle mit bestätigtem zweiten Faktor. Nichts wurde gespeichert."
        : "Die Aufgaben konnten nicht gespeichert werden. Nichts wurde gespeichert.",
    };
  }

  const taskNumbers = rows.map((row) => Number(row.task_number)).sort((a, b) => a - b);
  await finish("done", { result: { task_ids: rows.map((row) => row.id), task_numbers: taskNumbers } });
  const customer = await ctx.db.from("hub_customers").select("id").eq("organization_id", proposal.organizationId).maybeSingle<{ id: string }>();
  await ctx.db.from("hub_admin_events").insert({
    actor_id: ctx.userId,
    action: "assistant.tasks_created",
    summary: `${rows.length} ${rows.length === 1 ? "Aufgabe" : "Aufgaben"} über den Assistenten angelegt`,
    target_customer_id: customer.data?.id ?? null,
  });
  refreshWorkspace();
  return { ok: true, data: { saved: rows.length, taskNumbers } };
}

/** Discards a proposal; nothing is written to Studio. */
export async function discardTaskProposal(input: { id: string }): Promise<ActionResult<null>> {
  const ctx = await actor();
  if (!ctx) return denied;
  const id = typeof input?.id === "string" && uuid.test(input.id) ? input.id : null;
  if (!id) return { ok: false, error: "Diesen Vorschlag gibt es nicht." };
  const { data } = await ctx.db
    .from("hub_assistant_actions")
    .update({ status: "discarded", decided_at: new Date().toISOString() })
    .eq("id", id).eq("actor_id", ctx.userId).eq("status", "proposed")
    .select("id")
    .maybeSingle<{ id: string }>();
  return data ? { ok: true, data: null } : { ok: false, error: await whyNotOpen(ctx.db, id, ctx.userId) };
}
