"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { saveFreelancerNoteAs, setFreelancerShareAs } from "./write";

// The admins' tab „Freelancer“ under „Vertrag & Domain“: which area of a customer a freelancer may read, and a note for
// that freelancer. Every action is a public POST endpoint: it checks with the caller's own session that the database
// considers them an active admin before the service role writes; the inputs, the write, the admin log (which names the
// freelancer, the customer and the area, never the note's text) and the freelancer's notice follow in
// lib/hub-freelancer-customers/write.ts, which the Claude connector uses as well.

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

type Context = { db: SupabaseClient; actorId: string };

const denied = { ok: false as const, error: "Dafür brauchst du einen aktiven Admin-Zugang mit bestätigtem zweitem Faktor." };

async function context(): Promise<Context | null> {
  const admin = await verifyHubAdmin();
  if (!admin) return null;
  const db = createAdminClient();
  return db ? { db, actorId: admin.userId } : null;
}

/** Switches one area of a customer on or off for one freelancer; returns since when it is on (null when off). */
export async function setFreelancerShare(input: unknown): Promise<ActionResult<{ since: string | null }>> {
  const ctx = await context();
  if (!ctx) return denied;
  const result = await setFreelancerShareAs(ctx, input);
  if (result.ok) refreshWorkspace();
  return result;
}

/** Saves the note for one freelancer at one customer; an empty note removes it. */
export async function saveFreelancerNote(input: unknown): Promise<ActionResult<{ note: string; updatedAt: string | null }>> {
  const ctx = await context();
  if (!ctx) return denied;
  const result = await saveFreelancerNoteAs(ctx, input);
  if (result.ok) refreshWorkspace();
  return result;
}
