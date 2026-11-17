import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { noArchive, type ArchiveState } from "./rules";

type ArchivedRow = { id: string; organization_id: string | null };

/**
 * What the hub keeps out of sight for admins (lib/hub-archive/rules.ts): hub customers with archived_at (migration
 * 202611170001 in service-oalab) and Service organizations that are archived, plus the hub customers of those. Read
 * with the service role, since browsers may not read organizations. Without the migration only Service's archive
 * counts; a failed read hides nothing rather than failing the page.
 */
export async function readArchive(db: SupabaseClient): Promise<ArchiveState> {
  const [organizations, customers] = await Promise.all([
    db.from("organizations").select("id").or("status.eq.archived,archived_at.not.is.null").returns<{ id: string }[]>(),
    db.from("hub_customers").select("id, organization_id").not("archived_at", "is", null).returns<ArchivedRow[]>(),
  ]);
  const archivedCustomers = customers.error ? [] : customers.data ?? [];
  const organizationIds = new Set([
    ...(organizations.error ? [] : organizations.data ?? []).map((row) => row.id),
    ...archivedCustomers.flatMap((row) => row.organization_id ? [row.organization_id] : []),
  ]);
  const customerIds = new Set(archivedCustomers.map((row) => row.id));
  if (organizationIds.size) {
    const linked = await db.from("hub_customers").select("id").in("organization_id", [...organizationIds]).returns<{ id: string }[]>();
    for (const row of linked.error ? [] : linked.data ?? []) customerIds.add(row.id);
  }
  return { customerIds, organizationIds };
}

/** The archive once per request, for loaders that already checked an admin (or only filter for admins). */
export const loadArchive = cache(async (): Promise<ArchiveState> => {
  const db = createAdminClient();
  return db ? readArchive(db) : noArchive;
});
