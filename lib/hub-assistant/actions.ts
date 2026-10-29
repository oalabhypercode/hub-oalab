"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import { CUSTOMER_LABEL } from "@/lib/hub-projects/map";
import { applyChoices, type TaskProposal } from "./proposals";
import { pickChanges, projectColumns, taskColumns, type ProjectUpdateProposal, type TaskUpdateProposal } from "./updates";

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

// Changes to existing projects and tasks (KI-Plan Schritt 5) -------------------------------------------------------

type Context = NonNullable<Awaited<ReturnType<typeof actor>>>;

/** Claims an open proposal of one kind for this admin, once; null tells the caller to explain why not. */
async function claim<T>(ctx: Context, id: string, kind: "project.update" | "tasks.update") {
  const { data } = await ctx.db
    .from("hub_assistant_actions")
    .update({ status: "executing" })
    .eq("id", id).eq("actor_id", ctx.userId).eq("kind", kind).eq("status", "proposed").gt("expires_at", new Date().toISOString())
    .select("payload")
    .maybeSingle<{ payload: T }>();
  return data?.payload ?? null;
}

async function settle(ctx: Context, id: string, status: "done" | "failed" | "proposed", fields: { result?: object; error_code?: string } = {}) {
  await ctx.db.from("hub_assistant_actions").update({ status, ...(status === "proposed" ? {} : { decided_at: new Date().toISOString() }), ...fields }).eq("id", id);
}

const STALE = "wurde inzwischen im Studio geändert. Nichts wurde überschrieben; lass den Assistenten bitte neu vorschlagen.";

/** Saves the chosen fields of a project change; `picks` holds one switch per proposed field. */
export async function confirmProjectUpdate(input: { id: string; picks: unknown }): Promise<ActionResult<{ saved: number }>> {
  const ctx = await actor();
  if (!ctx) return denied;
  const id = typeof input?.id === "string" && uuid.test(input.id) ? input.id : null;
  if (!id) return { ok: false, error: "Diesen Vorschlag gibt es nicht." };
  const proposal = await claim<ProjectUpdateProposal>(ctx, id, "project.update");
  if (!proposal) return { ok: false, error: await whyNotOpen(ctx.db, id, ctx.userId) };
  const chosen = pickChanges(proposal.changes, input.picks);
  if (!chosen.ok) { await settle(ctx, id, "proposed"); return chosen; }
  const columns = projectColumns(chosen.items);

  // With the admin's own session: Studio's RLS lets only team members with a second factor change projects, and
  // its triggers raise the version and log the change under the admin's name.
  const write = proposal.expectedVersion === null
    // Studio has no details row yet: create it, as Studio does on a project's first change.
    ? await ctx.supabase.from("studio_project_details").insert({ project_id: proposal.projectId, organization_id: proposal.organizationId, created_by: ctx.userId, ...columns }).select("version")
    : await ctx.supabase.from("studio_project_details").update(columns).eq("project_id", proposal.projectId).eq("version", proposal.expectedVersion).select("version");
  if (write.error) {
    await settle(ctx, id, "failed", { error_code: (write.error.code ?? "UNKNOWN").slice(0, 80) });
    return { ok: false, error: write.error.code === "42501" ? "Speichern abgelehnt: Dein Konto braucht im Studio eine Team-Rolle mit bestätigtem zweiten Faktor. Nichts wurde gespeichert." : write.error.code === "23505" ? `Das Projekt ${STALE}` : "Die Änderung konnte nicht gespeichert werden. Nichts wurde gespeichert." };
  }
  if (!write.data?.length) {
    await settle(ctx, id, "failed", { error_code: "STALE_VERSION" });
    return { ok: false, error: `Das Projekt ${STALE}` };
  }
  await settle(ctx, id, "done", { result: { fields: chosen.items.map((change) => change.field) } });
  const customer = await ctx.db.from("hub_customers").select("id").eq("organization_id", proposal.organizationId).maybeSingle<{ id: string }>();
  await ctx.db.from("hub_admin_events").insert({ actor_id: ctx.userId, action: "assistant.project_updated", summary: "Projekt über den Assistenten geändert", target_customer_id: customer.data?.id ?? null });
  refreshWorkspace();
  return { ok: true, data: { saved: chosen.items.length } };
}

/** Saves the chosen task changes, one task at a time, each only while its Studio version still matches. */
export async function confirmTaskUpdates(input: { id: string; picks: unknown }): Promise<ActionResult<{ saved: number[]; stale: number[]; failed: number[] }>> {
  const ctx = await actor();
  if (!ctx) return denied;
  const id = typeof input?.id === "string" && uuid.test(input.id) ? input.id : null;
  if (!id) return { ok: false, error: "Diesen Vorschlag gibt es nicht." };
  const proposal = await claim<TaskUpdateProposal>(ctx, id, "tasks.update");
  if (!proposal) return { ok: false, error: await whyNotOpen(ctx.db, id, ctx.userId) };
  const chosen = pickChanges(proposal.tasks, input.picks);
  if (!chosen.ok) { await settle(ctx, id, "proposed"); return chosen; }

  const saved: number[] = [];
  const stale: number[] = [];
  const failed: number[] = [];
  for (const change of chosen.items) {
    // Read the row with the admin's session first: its labels are needed to switch "Kunde" without losing others.
    const current = await ctx.supabase.from("studio_tasks").select("version, labels").eq("id", change.taskId).maybeSingle<{ version: number; labels: string[] | null }>();
    if (current.error || !current.data) { failed.push(change.number); continue; }
    if (Number(current.data.version) !== change.expectedVersion) { stale.push(change.number); continue; }
    const write = await ctx.supabase.from("studio_tasks").update(taskColumns(change, current.data.labels ?? [], CUSTOMER_LABEL)).eq("id", change.taskId).eq("version", change.expectedVersion).select("id");
    if (write.error) failed.push(change.number);
    else if (!write.data?.length) stale.push(change.number);
    else saved.push(change.number);
  }
  await settle(ctx, id, saved.length ? "done" : "failed", { result: { saved, stale, failed }, ...(saved.length ? {} : { error_code: stale.length ? "STALE_VERSION" : "WRITE_FAILED" }) });
  if (saved.length) {
    const customer = await ctx.db.from("hub_customers").select("id").eq("organization_id", proposal.organizationId).maybeSingle<{ id: string }>();
    await ctx.db.from("hub_admin_events").insert({ actor_id: ctx.userId, action: "assistant.tasks_updated", summary: `${saved.length} ${saved.length === 1 ? "Aufgabe" : "Aufgaben"} über den Assistenten geändert`, target_customer_id: customer.data?.id ?? null });
    refreshWorkspace();
  }
  return { ok: true, data: { saved, stale, failed } };
}
