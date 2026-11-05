import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPackageGroup, isPackageId, packagesByGroup, type CustomerPackage } from "@/lib/service-packages";

type PackageRow = { customer_id: string; package_group: string; package_id: string | null; since: string | null; until: string | null };

/**
 * The packages per customer, read with whichever client the caller holds: the service role for admins, the login's own
 * session for customers (RLS: their own customers only). `ready` is false while the table is missing; the hub then
 * shows no packages instead of failing.
 */
export async function readCustomerPackages(db: SupabaseClient, customerIds?: readonly string[]) {
  if (customerIds && !customerIds.length) return { ready: true, byCustomer: new Map<string, CustomerPackage[]>() };
  let query = db.from("hub_customer_packages").select("customer_id, package_group, package_id, since, until");
  if (customerIds) query = query.in("customer_id", [...customerIds]);
  const { data, error } = await query.returns<PackageRow[]>();
  const rows = new Map<string, CustomerPackage[]>();
  for (const row of error ? [] : data ?? []) {
    if (!isPackageGroup(row.package_group)) continue;
    const item: CustomerPackage = { group: row.package_group, packageId: isPackageId(row.package_id) ? row.package_id : null, since: row.since, until: row.until };
    rows.set(row.customer_id, [...(rows.get(row.customer_id) ?? []), item]);
  }
  return {
    ready: !error,
    /** Both groups for every customer that has rows; packagesOf fills in customers without any. */
    byCustomer: new Map([...rows].map(([id, items]) => [id, packagesByGroup(items)])),
  };
}

/** Both groups of one customer, "none" where nothing is stored. */
export const packagesOf = (byCustomer: Map<string, CustomerPackage[]>, customerId: string) => byCustomer.get(customerId) ?? packagesByGroup([]);
