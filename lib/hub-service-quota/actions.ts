"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { isUuid } from "@/lib/hub-contracts/rules";
import { readExemptReason, requestReference } from "./rules";
import type { QuotaRequest } from "./types";

// Every action is a public POST endpoint: each one checks with the caller's own session that the database considers
// them an active admin before the service role touches anything, and checks its input again. The switch and the
// exemptions live in the service platform's database (202611060001); the admin log stores no titles or reasons.

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

type Context = { db: SupabaseClient; actorId: string };

const denied = { ok: false as const, error: "Dafür brauchst du einen aktiven Admin-Zugang mit bestätigtem zweitem Faktor." };
const failed = (error: string) => ({ ok: false as const, error });
const missing = "Die Service-Kontingente sind in der Datenbank noch nicht eingerichtet. Die Migration steht noch aus.";
const retry = "Das hat gerade nicht geklappt. Bitte versuche es erneut.";

async function context(): Promise<Context | null> {
  const admin = await verifyHubAdmin();
  if (!admin) return null;
  const db = createAdminClient();
  return db ? { db, actorId: admin.userId } : null;
}

async function log(ctx: Context, action: string, summary: string, customerId: string | null) {
  await ctx.db.from("hub_admin_events").insert({ actor_id: ctx.actorId, action, summary, target_customer_id: customerId });
}

const isMissing = (error: { code?: string; message?: string }) =>
  ["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code ?? "") || /hub_service_(quota|request)/i.test(error.message ?? "");

/** The organization of a hub customer on the service platform; freelancers and hub-only customers have none. */
async function organizationOf(ctx: Context, customerId: unknown): Promise<string | null> {
  if (!isUuid(customerId)) return null;
  const { data, error } = await ctx.db.from("hub_customers").select("organization_id, kind").eq("id", customerId).maybeSingle<{ organization_id: string | null; kind: string | null }>();
  return !error && data && (data.kind ?? "customer") === "customer" ? data.organization_id : null;
}

type RequestRow = {
  requestId: string; requestNumber: number; title: string; trashed: boolean; submittedAt: string;
  exemption: { reason: string; createdAt: string; createdBy: string | null } | null;
};

/** The requests of this month that count at a customer, newest first, with who took one out of the count and why. */
export async function loadServiceQuotaRequests(input: { customerId?: unknown }): Promise<ActionResult<QuotaRequest[]>> {
  const ctx = await context();
  if (!ctx) return denied;
  if (!isUuid(input?.customerId)) return failed("Diesen Kunden gibt es nicht mehr.");
  const { data, error } = await ctx.db.rpc("hub_service_quota_requests", { p_customer: input.customerId });
  if (error) return failed(isMissing(error) ? missing : "Die Anfragen konnten gerade nicht geladen werden. Bitte versuche es erneut.");
  const rows = (Array.isArray(data) ? data : []) as RequestRow[];
  const authors = [...new Set(rows.flatMap((row) => row.exemption?.createdBy ? [row.exemption.createdBy] : []))];
  const profiles = authors.length
    ? await ctx.db.from("hub_profiles").select("user_id, first_name, last_name").in("user_id", authors).returns<{ user_id: string; first_name: string; last_name: string }[]>()
    : { data: [] };
  const names = new Map((profiles.data ?? []).map((row) => [row.user_id, `${row.first_name} ${row.last_name}`.trim()]));
  return {
    ok: true,
    data: rows.filter((row) => typeof row.requestId === "string" && Number.isSafeInteger(row.requestNumber)).map((row): QuotaRequest => ({
      requestId: row.requestId,
      reference: requestReference(row.requestNumber),
      title: typeof row.title === "string" ? row.title : "",
      submittedAt: row.submittedAt,
      trashed: row.trashed === true,
      exemption: row.exemption ? { reason: row.exemption.reason, createdAt: row.exemption.createdAt, byName: (row.exemption.createdBy && names.get(row.exemption.createdBy)) || "oalab-Team" } : null,
    })),
  };
}

const exemptError = (error: { code?: string; message?: string }) =>
  isMissing(error) ? missing
    : error.code === "23503" ? "Diese Anfrage gehört nicht zu diesem Kunden."
      : error.code === "23514" ? "Bitte kurz angeben, warum die Anfrage nicht zählt, zum Beispiel „Fehler von oalab“."
        : retry;

/**
 * Takes one request of a customer out of the count (with a short internal reason) or counts it again. The database
 * only accepts requests of the customer's own organization.
 */
export async function setServiceRequestExempt(input: { customerId?: unknown; requestId?: unknown; exempt?: unknown; reason?: unknown }): Promise<ActionResult<{ exempt: boolean }>> {
  const ctx = await context();
  if (!ctx) return denied;
  const organizationId = await organizationOf(ctx, input?.customerId);
  if (!organizationId) return failed("Dieser Kunde hat keinen Zugang zur Serviceplattform.");
  if (!isUuid(input.requestId) || typeof input.exempt !== "boolean") return failed("Diese Anfrage gibt es nicht mehr.");
  const customerId = input.customerId as string;
  if (input.exempt) {
    const reason = readExemptReason(input.reason);
    if (!reason.ok) return reason;
    const { error } = await ctx.db.from("hub_service_request_exemptions").upsert(
      { request_id: input.requestId, organization_id: organizationId, reason: reason.reason, created_by: ctx.actorId, created_at: new Date().toISOString() },
      { onConflict: "request_id" },
    );
    if (error) return failed(exemptError(error));
    await log(ctx, "service.request_exempted", "Anfrage aus dem Service-Kontingent genommen", customerId);
  } else {
    const { error } = await ctx.db.from("hub_service_request_exemptions").delete().eq("request_id", input.requestId).eq("organization_id", organizationId);
    if (error) return failed(exemptError(error));
    await log(ctx, "service.request_counted", "Anfrage zählt wieder im Service-Kontingent", customerId);
  }
  refreshWorkspace();
  return { ok: true, data: { exempt: input.exempt } };
}

/** Switches the limit on (new requests blocked at the limit and without a Service package) or off for everyone. */
export async function setServiceQuotaSwitch(input: { enforced?: unknown }): Promise<ActionResult<{ enforced: boolean }>> {
  const ctx = await context();
  if (!ctx) return denied;
  if (typeof input?.enforced !== "boolean") return failed("Bitte ein- oder ausschalten.");
  const { data, error } = await ctx.db.from("hub_service_quota_switch").update({ enforced: input.enforced, updated_by: ctx.actorId }).eq("id", true).select("enforced").maybeSingle<{ enforced: boolean }>();
  if (error) return failed(isMissing(error) ? missing : retry);
  if (!data) return failed(missing);
  await log(ctx, "service.quota_switch", data.enforced ? "Anfragen-Sperre eingeschaltet" : "Anfragen-Sperre ausgeschaltet", null);
  refreshWorkspace();
  return { ok: true, data: { enforced: data.enforced } };
}
