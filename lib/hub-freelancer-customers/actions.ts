"use server";

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyFreelancerShare } from "@/lib/hub-notify/server";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { readShareNote, readShareToggle, shareAreas, type ShareArea } from "./rules";

// The admins' tab „Freelancer“ under „Vertrag & Domain“: which area of a customer a freelancer may read, and a note for
// that freelancer. Every action is a public POST endpoint: it checks with the caller's own session that the database
// considers them an active admin before the service role writes, and checks the inputs again. The admin log names the
// freelancer, the customer and the area, never the note's text.

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

type Context = { db: SupabaseClient; actorId: string };

const denied = { ok: false as const, error: "Dafür brauchst du einen aktiven Admin-Zugang mit bestätigtem zweitem Faktor." };
const failed = (error: string) => ({ ok: false as const, error });
const tryAgain = "Das hat gerade nicht geklappt. Bitte versuche es erneut.";
const notReady = "Freigaben für Freelancer sind in der Datenbank noch nicht eingerichtet. Die Migration steht noch aus.";
const gone = "Dieser Freelancer betreut den Kunden nicht mehr.";

async function context(): Promise<Context | null> {
  const admin = await verifyHubAdmin();
  if (!admin) return null;
  const db = createAdminClient();
  return db ? { db, actorId: admin.userId } : null;
}

const missingTable = (error: { code?: string; message?: string }) => error.code === "42P01" || error.code === "PGRST205" || /hub_freelancer_shares/i.test(error.message ?? "");

/** The assignment with both names, or null when the freelancer no longer looks after the customer. */
async function assignment(ctx: Context, customerId: string, freelancerId: string) {
  const [link, names] = await Promise.all([
    ctx.db.from("hub_freelancer_customers").select("freelancer_id").eq("freelancer_id", freelancerId).eq("customer_id", customerId).maybeSingle(),
    ctx.db.from("hub_customers").select("id, company").in("id", [customerId, freelancerId]).returns<{ id: string; company: string }[]>(),
  ]);
  if (link.error || names.error) return { error: tryAgain } as const;
  if (!link.data) return { error: gone } as const;
  const nameOf = new Map((names.data ?? []).map((row) => [row.id, row.company]));
  return { customer: nameOf.get(customerId) ?? "Kunde", freelancer: nameOf.get(freelancerId) ?? "Freelancer" } as const;
}

async function log(ctx: Context, action: string, summary: string, customerId: string) {
  await ctx.db.from("hub_admin_events").insert({ actor_id: ctx.actorId, action, summary: summary.slice(0, 300), target_customer_id: customerId });
}

const column = (area: ShareArea) => `${area}_since` as const;

/** Switches one area of a customer on or off for one freelancer; returns since when it is on (null when off). */
export async function setFreelancerShare(input: unknown): Promise<ActionResult<{ since: string | null }>> {
  const ctx = await context();
  if (!ctx) return denied;
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
  refreshWorkspace();
  return { ok: true, data: { since } };
}

/** Saves the note for one freelancer at one customer; an empty note removes it. */
export async function saveFreelancerNote(input: unknown): Promise<ActionResult<{ note: string; updatedAt: string | null }>> {
  const ctx = await context();
  if (!ctx) return denied;
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
  refreshWorkspace();
  return { ok: true, data: { note, updatedAt } };
}
