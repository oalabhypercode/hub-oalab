import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { entriesWithoutActiveLogin } from "./rules";

// A login deactivated in the user management (hub_profiles.status „disabled“, its sign-in blocked) is nobody's choice
// outside it any more (user 17.11.2026): no assignee on the task board, in the calendar or through the Claude
// connector, no participant under „Beteiligte“, and a freelancer whose every login is deactivated is no choice under
// „Betreut von“ either. Cards it was on hide it; the history (comments, changes, chats, logs) keeps its name. The user
// management itself still lists it, so it can be activated again. Read with the server key after the caller's check.

/** Deactivated logins; only among `ids` when given. Null when the read failed. */
export async function readDeactivatedLogins(db: SupabaseClient, ids?: readonly string[]): Promise<Set<string> | null> {
  if (ids && !ids.length) return new Set();
  const query = db.from("hub_profiles").select("user_id").eq("status", "disabled");
  const { data, error } = await (ids ? query.in("user_id", [...new Set(ids)]) : query).returns<{ user_id: string }[]>();
  return error ? null : new Set((data ?? []).map((row) => row.user_id));
}

/** Of these entries, those with logins that are all deactivated (rules.ts). Null when a read failed. */
export async function readEntriesWithoutActiveLogin(db: SupabaseClient, entryIds: readonly string[]): Promise<Set<string> | null> {
  if (!entryIds.length) return new Set();
  const members = await db.from("hub_customer_members").select("customer_id, user_id").in("customer_id", [...new Set(entryIds)]).returns<{ customer_id: string; user_id: string }[]>();
  if (members.error) return null;
  const deactivated = await readDeactivatedLogins(db, (members.data ?? []).map((row) => row.user_id));
  return deactivated && entriesWithoutActiveLogin(members.data ?? [], deactivated);
}
