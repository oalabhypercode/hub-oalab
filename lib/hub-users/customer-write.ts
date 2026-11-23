import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceCustomerRefusal, type CustomerInput } from "./rules";

// A customer's master data as the user management saves it, shared by its actions (lib/hub-users/actions.ts) and the
// Claude connector (lib/hub-mcp/area-writes.ts), with the service role after the admin check. Company and number go
// through the Service organization (its sync passes them on), the contact data through the hub's own row.

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
const failed = (error: string) => ({ ok: false as const, error });

export const customerRow = (input: CustomerInput) => ({ company: input.company, customer_number: input.customerNumber, ...customerDetails(input) });

/** What the Hub keeps itself; company and number of a customer in Service belong to its organization. */
export const customerDetails = (input: CustomerInput) => ({
  contact_email: input.contactEmail,
  phone: input.phone,
  website: input.website,
  street: input.street,
  postal_code: input.postalCode,
  city: input.city,
  country: input.country,
});

/**
 * Writes company, number and contact data of an existing customer. For a customer that is also in Service, company and
 * number go through its organization (Service's sync passes them on) and the contact data through the Hub's own row.
 */
export async function writeCustomerAs(db: SupabaseClient, actorId: string, id: string, organizationId: string | null, value: CustomerInput): Promise<ActionResult<{ id: string }>> {
  if (organizationId) {
    const refused = serviceCustomerRefusal(value);
    if (refused) return failed(refused);
    const organization = await db.from("organizations").update({ name: value.company, customer_number: value.customerNumber }).eq("id", organizationId);
    if (organization.error) return failed(organization.error.code === "23505" ? "Diese Kundennummer ist schon vergeben." : "Der Kunde konnte nicht gespeichert werden.");
  }
  const row = organizationId ? customerDetails(value) : customerRow(value);
  const { data, error } = await db.from("hub_customers").update({ ...row, updated_by: actorId }).eq("id", id).select("id").single<{ id: string }>();
  if (error || !data) return failed(error?.code === "23505" ? "Diese Kundennummer ist schon vergeben." : "Der Kunde konnte nicht gespeichert werden.");
  return { ok: true, data };
}
