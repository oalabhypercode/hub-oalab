import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyFreelancerShare } from "@/lib/hub-notify/server";
import { readShareNote, readShareToggle, shareAreas, type ShareArea } from "./rules";

// What the tab „Freelancer“ under „Vertrag & Domain“ writes once the caller is checked as an admin: which area of a
// customer a freelancer may read, and a note for that freelancer. The tab's actions (lib/hub-freelancer-customers/
// actions.ts) and the Claude connector (lib/hub-mcp/area-writes.ts) save through this code with the service role. The
// admin log names the freelancer, the customer and the area, never the note's text; Claude's lines are `claude.*`.
// Refreshing the page is the caller's business.

export type ShareWriter = { db: SupabaseClient; actorId: string; via?: "claude" };
type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const failed = (error: string) => ({ ok: false as const, error });
const tryAgain = "Das hat gerade nicht geklappt. Bitte versuche es erneut.";
const notReady = "Freigaben für Freelancer sind in der Datenbank noch nicht eingerichtet. Die Migration steht noch aus.";
const gone = "Dieser Freelancer betreut den Kunden nicht mehr.";

const missingTable = (error: { code?: string; message?: string }) => error.code === "42P01" || error.code === "PGRST205" || /hub_freelancer_shares/i.test(error.message ?? "");

/** The assignment with both names, or null when the freelancer no longer looks after the customer. */
async function assignment(ctx: ShareWriter, customerId: string, freelancerId: string) {
  const [link, names] = await Promise.all([
    ctx.db.from("hub_freelancer_customers").select("freelancer_id").eq("freelancer_id", freelancerId).eq("customer_id", customerId).maybeSingle(),
    ctx.db.from("hub_customers").select("id, company").in("id", [customerId, freelancerId]).returns<{ id: string; company: string }[]>(),
  ]);
  if (link.error || names.error) return { error: tryAgain } as const;
  if (!link.data) return { error: gone } as const;
  const nameOf = new Map((names.data ?? []).map((row) => [row.id, row.company]));
  return { customer: nameOf.get(customerId) ?? "Kunde", freelancer: nameOf.get(freelancerId) ?? "Freelancer" } as const;
}

const column = (area: ShareArea) => `${area}_since` as const;

async function log(ctx: ShareWriter, action: string, summary: string, customerId: string) {
  const claude = ctx.via === "claude";
  await ctx.db.from("hub_admin_events").insert({ actor_id: ctx.actorId, action: claude ? `claude.${action}` : action, summary: `${summary}${claude ? " (über Claude)" : ""}`.slice(0, 300), target_customer_id: customerId });
}

/** Switches one area of a customer on or off for one freelancer; returns since when it is on (null when off). */
export async function setFreelancerShareAs(ctx: ShareWriter, input: unknown): Promise<ActionResult<{ since: string | null }>> {
  const read = readShareToggle(input);
  if (!read.ok) return read;
  const { customerId, freelancerId, area, on } = read.value;
  const names = await assignment(ctx, customerId, freelancerId);
  if ("error" in names) return failed(names.error ?? tryAgain);
  const since = on ? new Date().toISOString() : null;
  const { error } = await ctx.db.from("hub_freelancer_shares")
    .upsert({ freelancer_id: freelancerId, customer_id: customerId, [column(area)]: since, updated_by: ctx.actorId }, { onConflict: "freelancer_id,customer_id" });
  if (error) return failed(missingTable(error) ? notReady : error.code === "23503" ? gone : tryAgain);
  await log(ctx, on ? "customer.freelancer_share_on" : "customer.freelancer_share_off",
    `${names.freelancer} ${on ? "sieht jetzt" : "sieht nicht mehr"} „${shareAreas[area].label}“ von ${names.customer}`, customerId);
  // A new release reaches the freelancer's bell (no mail) after the answer; switching off stays quiet.
  if (on) after(() => notifyFreelancerShare({ freelancerId, customerId, company: names.customer, area: shareAreas[area].label }));
  return { ok: true, data: { since } };
}

/** Saves the note for one freelancer at one customer; an empty note removes it. */
export async function saveFreelancerNoteAs(ctx: ShareWriter, input: unknown): Promise<ActionResult<{ note: string; updatedAt: string | null }>> {
  const read = readShareNote(input);
  if (!read.ok) return read;
  const { customerId, freelancerId, note } = read.value;
  const names = await assignment(ctx, customerId, freelancerId);
  if ("error" in names) return failed(names.error ?? tryAgain);
  const updatedAt = note ? new Date().toISOString() : null;
  const { error } = await ctx.db.from("hub_freelancer_shares")
    .upsert({ freelancer_id: freelancerId, customer_id: customerId, note, note_updated_at: updatedAt, updated_by: ctx.actorId }, { onConflict: "freelancer_id,customer_id" });
  if (error) return failed(missingTable(error) ? notReady : error.code === "23503" ? gone : error.code === "23514" ? "Höchstens 2000 Zeichen." : tryAgain);
  await log(ctx, "customer.freelancer_note", `${note ? "Hinweise für" : "Hinweise entfernt für"} ${names.freelancer} bei ${names.customer}`, customerId);
  return { ok: true, data: { note, updatedAt } };
}
