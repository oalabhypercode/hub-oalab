import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyContractChange } from "@/lib/hub-notify/server";
import { isUuid, readTimelineEntry } from "./rules";

// What the timeline under „Vertrag & Domain“ writes once the caller is checked as an admin: the tab's action
// (lib/hub-contracts/actions.ts) and the Claude connector (lib/hub-mcp/area-writes.ts) save an entry through this code
// with the service role and the same checks. The admin log stores no names, amounts or titles; Claude's lines are
// `claude.*`. Refreshing the page is the caller's business.

export type ContractWriter = { db: SupabaseClient; actorId: string; via?: "claude" };
type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
const failed = (error: string) => ({ ok: false as const, error });

const missingTables = "Pakete und Verlauf sind in der Datenbank noch nicht eingerichtet. Die Migration steht noch aus.";
export const contractWriteError = (error: { code?: string; message?: string }) =>
  error.code === "42P01" || error.code === "PGRST205" ? missingTables
    : error.code === "23514" && /Datei/.test(error.message ?? "") ? "Diese Datei liegt nicht bei diesem Kunden."
      : "Das hat gerade nicht geklappt. Bitte versuche es erneut.";

async function logContractEvent(ctx: ContractWriter, action: string, summary: string, customerId: string) {
  const claude = ctx.via === "claude";
  await ctx.db.from("hub_admin_events").insert({ actor_id: ctx.actorId, action: claude ? `claude.${action}` : action, summary: claude ? `${summary} (über Claude)` : summary, target_customer_id: customerId });
}

/** Only entries of the kind customer hold packages and a timeline; freelancers do not. */
export async function customerHoldsContracts(db: SupabaseClient, customerId: unknown): Promise<boolean> {
  if (!isUuid(customerId)) return false;
  const { data, error } = await db.from("hub_customers").select("id, kind").eq("id", customerId).maybeSingle<{ id: string; kind: string | null }>();
  return !error && Boolean(data) && (data?.kind ?? "customer") === "customer";
}

/** Creates an entry of a customer's timeline or updates one of the same customer. */
export async function saveTimelineEntryAs(ctx: ContractWriter, input: { id?: unknown; customerId?: unknown } & Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  if (!await customerHoldsContracts(ctx.db, input?.customerId)) return failed("Diesen Kunden gibt es nicht mehr.");
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
    const before = await ctx.db.from("hub_customer_timeline").select("customer_visible").eq("id", input.id).eq("customer_id", customerId).maybeSingle<{ customer_visible: boolean }>();
    const { data, error } = await ctx.db.from("hub_customer_timeline").update(row).eq("id", input.id).eq("customer_id", customerId).select("id").maybeSingle<{ id: string }>();
    if (error) return failed(contractWriteError(error));
    if (!data) return failed("Diesen Eintrag gibt es nicht mehr.");
    await logContractEvent(ctx, "customer.timeline_updated", "Zeitpunkt geändert", customerId);
    // An entry the customer newly sees is new to them.
    if (row.customer_visible && before.data && !before.data.customer_visible) tellCustomer(ctx, customerId, row.title);
    return { ok: true, data: { id: data.id } };
  }
  const { data, error } = await ctx.db.from("hub_customer_timeline").insert({ ...row, customer_id: customerId, created_by: ctx.actorId }).select("id").single<{ id: string }>();
  if (error || !data) return failed(error ? contractWriteError(error) : "Das hat gerade nicht geklappt. Bitte versuche es erneut.");
  await logContractEvent(ctx, "customer.timeline_created", "Zeitpunkt eingetragen", customerId);
  if (row.customer_visible) tellCustomer(ctx, customerId, row.title);
  return { ok: true, data: { id: data.id } };
}

/**
 * A timeline entry the customer sees is new to them (24.11.2026): a line in their bell and a card in their chat,
 * after the answer. Only the title, never the amount or a note.
 */
export function tellCustomer(ctx: ContractWriter, customerId: string, title: string) {
  after(() => notifyContractChange({ customerId, item: { what: "timeline", label: title, change: "new" }, actorId: ctx.actorId }));
}
