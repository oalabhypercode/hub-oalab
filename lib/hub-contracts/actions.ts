"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { readPackageChoices } from "@/lib/service-packages";
import { isUuid, readTimelineEntry } from "./rules";
import { packagesOf, readCustomerPackages } from "./packages";

// Every action is a public POST endpoint: each one checks with the caller's own session that the database considers
// them an active admin (with a confirmed second factor) before the service role touches anything. Inputs are checked
// here again, whatever the form already checked. The admin log stores no names, amounts or titles.

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

type Context = { db: SupabaseClient; actorId: string };

const denied = { ok: false as const, error: "Dafür brauchst du einen aktiven Admin-Zugang mit bestätigtem zweitem Faktor." };
const failed = (error: string) => ({ ok: false as const, error });

async function context(): Promise<Context | null> {
  const admin = await verifyHubAdmin();
  if (!admin) return null;
  const db = createAdminClient();
  return db ? { db, actorId: admin.userId } : null;
}

async function log(ctx: Context, action: string, summary: string, customerId: string) {
  await ctx.db.from("hub_admin_events").insert({ actor_id: ctx.actorId, action, summary, target_customer_id: customerId });
}

/** Only entries of the kind customer hold packages and a timeline; freelancers do not. */
async function customerExists(ctx: Context, customerId: unknown): Promise<boolean> {
  if (!isUuid(customerId)) return false;
  const { data, error } = await ctx.db.from("hub_customers").select("id, kind").eq("id", customerId).maybeSingle<{ id: string; kind: string | null }>();
  return !error && Boolean(data) && (data?.kind ?? "customer") === "customer";
}

const missingTables = "Pakete und Verlauf sind in der Datenbank noch nicht eingerichtet. Die Migration steht noch aus.";
const writeError = (error: { code?: string; message?: string }) =>
  error.code === "42P01" || error.code === "PGRST205" ? missingTables
    : error.code === "23514" && /Datei/.test(error.message ?? "") ? "Diese Datei liegt nicht bei diesem Kunden."
      : "Das hat gerade nicht geklappt. Bitte versuche es erneut.";

/**
 * Saves both package groups of a customer. Only groups that change are written; the database writes package changes
 * and cancellations into the timeline itself.
 */
export async function saveCustomerPackages(input: { customerId?: unknown; packages?: unknown }): Promise<ActionResult<{ changed: number }>> {
  const ctx = await context();
  if (!ctx) return denied;
  if (!await customerExists(ctx, input?.customerId)) return failed("Diesen Kunden gibt es nicht mehr.");
  const customerId = input.customerId as string;
  const choices = readPackageChoices(input?.packages);
  if (!choices.ok) return choices;
  const current = await readCustomerPackages(ctx.db, [customerId]);
  if (!current.ready) return failed(missingTables);
  const before = packagesOf(current.byCustomer, customerId);
  const changed = choices.value.filter((choice) => {
    const old = before.find((item) => item.group === choice.group);
    return old?.packageId !== choice.packageId || old?.since !== choice.since || old?.until !== choice.until;
  });
  if (!changed.length) return { ok: true, data: { changed: 0 } };
  const { error } = await ctx.db.from("hub_customer_packages").upsert(changed.map((choice) => ({
    customer_id: customerId, package_group: choice.group, package_id: choice.packageId, since: choice.since, until: choice.until, updated_by: ctx.actorId,
  })), { onConflict: "customer_id,package_group" });
  if (error) return failed(writeError(error));
  await log(ctx, "customer.packages", "Pakete geändert", customerId);
  refreshWorkspace();
  return { ok: true, data: { changed: changed.length } };
}

/** Creates a timeline entry, or updates one of the same customer. A linked file must lie at that customer. */
export async function saveTimelineEntry(input: { id?: unknown; customerId?: unknown } & Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  const ctx = await context();
  if (!ctx) return denied;
  if (!await customerExists(ctx, input?.customerId)) return failed("Diesen Kunden gibt es nicht mehr.");
  const customerId = input.customerId as string;
  const entry = readTimelineEntry(input ?? {});
  if (!entry.ok) return entry;
  if (entry.value.fileId) {
    const file = await ctx.db.from("hub_file_assignments").select("file_id").eq("file_id", entry.value.fileId).eq("customer_id", customerId).maybeSingle();
    if (file.error || !file.data) return failed("Diese Datei liegt nicht bei diesem Kunden.");
  }
  const row = {
    occurred_on: entry.value.occurredOn, kind: entry.value.kind, title: entry.value.title, amount_cents: entry.value.amountCents,
    file_id: entry.value.fileId, note: entry.value.note, customer_visible: entry.value.customerVisible, updated_by: ctx.actorId,
  };
  if (input.id !== undefined && input.id !== null && input.id !== "") {
    if (!isUuid(input.id)) return failed("Diesen Eintrag gibt es nicht mehr.");
    const { data, error } = await ctx.db.from("hub_customer_timeline").update(row).eq("id", input.id).eq("customer_id", customerId).select("id").maybeSingle<{ id: string }>();
    if (error) return failed(writeError(error));
    if (!data) return failed("Diesen Eintrag gibt es nicht mehr.");
    await log(ctx, "customer.timeline_updated", "Zeitpunkt geändert", customerId);
    refreshWorkspace();
    return { ok: true, data: { id: data.id } };
  }
  const { data, error } = await ctx.db.from("hub_customer_timeline").insert({ ...row, customer_id: customerId, created_by: ctx.actorId }).select("id").single<{ id: string }>();
  if (error || !data) return failed(error ? writeError(error) : "Das hat gerade nicht geklappt. Bitte versuche es erneut.");
  await log(ctx, "customer.timeline_created", "Zeitpunkt eingetragen", customerId);
  refreshWorkspace();
  return { ok: true, data: { id: data.id } };
}

/** Shows an entry to the customer or hides it again. */
export async function setTimelineVisible(input: { id?: unknown; visible?: unknown }): Promise<ActionResult<{ visible: boolean }>> {
  const ctx = await context();
  if (!ctx) return denied;
  if (!isUuid(input?.id) || typeof input.visible !== "boolean") return failed("Diesen Eintrag gibt es nicht mehr.");
  const { data, error } = await ctx.db.from("hub_customer_timeline").update({ customer_visible: input.visible, updated_by: ctx.actorId }).eq("id", input.id).select("customer_id").maybeSingle<{ customer_id: string }>();
  if (error) return failed(writeError(error));
  if (!data) return failed("Diesen Eintrag gibt es nicht mehr.");
  await log(ctx, "customer.timeline_visibility", input.visible ? "Zeitpunkt für den Kunden freigegeben" : "Zeitpunkt vor dem Kunden verborgen", data.customer_id);
  refreshWorkspace();
  return { ok: true, data: { visible: input.visible } };
}

export async function deleteTimelineEntry(input: { id?: unknown }): Promise<ActionResult<null>> {
  const ctx = await context();
  if (!ctx) return denied;
  if (!isUuid(input?.id)) return failed("Diesen Eintrag gibt es nicht mehr.");
  const { data, error } = await ctx.db.from("hub_customer_timeline").delete().eq("id", input.id).select("customer_id").maybeSingle<{ customer_id: string }>();
  if (error) return failed(writeError(error));
  if (!data) return failed("Diesen Eintrag gibt es nicht mehr.");
  await log(ctx, "customer.timeline_deleted", "Zeitpunkt gelöscht", data.customer_id);
  refreshWorkspace();
  return { ok: true, data: null };
}
