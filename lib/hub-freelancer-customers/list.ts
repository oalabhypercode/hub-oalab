import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isFreelancerCustomerRow } from "./rules";
import type { FreelancerCustomerRow } from "./types";

export { withFreelancerCustomers } from "./rules";
export type { FreelancerCustomerRow } from "./types";

/** The function is missing until migration 202611200001 of service-oalab is applied. */
const missingList = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (error.code === "PGRST202" || error.code === "42883"));

/**
 * Name, number and logo of the customers the signed-in freelancer looks after, read with their own session through
 * hub_freelancer_customer_list() (migration 202611200001 in service-oalab, 20.11.2026). Since then a freelancer reads
 * only their own entry in hub_customers: contact data and packages come only through hub_freelancer_customer_cards(),
 * and only with oalab's release. `null`: the database does not have the function yet; the old rule then still lets the
 * freelancer read these rows in hub_customers, so the caller reads them as before. A failed read gives an empty list
 * (the names and logos of their customers stay out, nothing else).
 */
export async function loadFreelancerCustomerList(supabase: SupabaseClient): Promise<FreelancerCustomerRow[] | null> {
  const { data, error } = await supabase.rpc("hub_freelancer_customer_list");
  if (missingList(error)) return null;
  if (error || !Array.isArray(data)) return [];
  return data.filter(isFreelancerCustomerRow);
}
