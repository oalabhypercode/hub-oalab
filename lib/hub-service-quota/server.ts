import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readQuotaRow, type QuotaRow } from "./rules";
import { emptyServiceQuota, type ServiceQuotaState } from "./types";

// The quota lives in the service platform's database (migration 202611060001 in service-oalab). The hub reads it
// through its functions, which count exactly like the check before every new request: admins all customers with the
// service role after verifyHubAdmin, a customer login its own with its own session, and that only while the switch
// is on. Without the migration the area simply shows no quota.

/** The functions are missing until the migration is applied. */
export const isMissingQuota = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (error.code === "PGRST202" || error.code === "42883" || /hub_(service_quota|member_service_quota)|schema cache/i.test(error.message ?? "")));

const failed = "Die Service-Kontingente konnten gerade nicht geladen werden. Bitte versuche es erneut.";

function readWindow(value: Record<string, unknown>) {
  const startsAt = typeof value.windowStartsAt === "string" ? value.windowStartsAt : null;
  const endsAt = typeof value.windowEndsAt === "string" ? value.windowEndsAt : null;
  return startsAt && endsAt && Number.isFinite(Date.parse(startsAt)) && Number.isFinite(Date.parse(endsAt)) ? { startsAt, endsAt } : null;
}

/**
 * Switch, month and every customer on the service platform, for a real admin (the caller checked the admin and
 * turns `switchedBy`, the login that switched last, into a name).
 */
export async function loadServiceQuotaForAdmin(db: SupabaseClient): Promise<ServiceQuotaState> {
  const { data, error } = await db.rpc("hub_service_quota_overview");
  if (error) return isMissingQuota(error) ? emptyServiceQuota() : emptyServiceQuota(failed);
  const value = (data ?? {}) as Record<string, unknown>;
  const customers = (Array.isArray(value.customers) ? value.customers : []).flatMap((row) => readQuotaRow(row) ?? []);
  return {
    ready: true,
    enforced: value.enforced === true,
    window: readWindow(value),
    customers,
    switchedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
    switchedBy: typeof value.updatedBy === "string" ? value.updatedBy : null,
    canManage: true,
  };
}

/**
 * The login's own customers while the switch is on, read with its own session; an empty list means the switch is off
 * (or the login has no customer on the service platform), and then the customer sees nothing of the quota.
 */
export async function loadServiceQuotaForCustomer(supabase: SupabaseClient): Promise<ServiceQuotaState> {
  const { data, error } = await supabase.rpc("hub_member_service_quota");
  if (error) return isMissingQuota(error) ? emptyServiceQuota() : emptyServiceQuota(failed);
  const rows = Array.isArray(data) ? data as Record<string, unknown>[] : [];
  const customers: QuotaRow[] = rows.flatMap((row) => {
    const read = readQuotaRow(row);
    // Customers never learn about exemptions or other logins.
    return read ? [{ ...read, exempted: 0, organizationActive: true, logins: 1 }] : [];
  });
  return { ready: true, enforced: customers.length > 0, window: rows[0] ? readWindow(rows[0]) : null, customers, canManage: false };
}
