import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { loadArchive } from "@/lib/hub-archive/server";
import { loadServiceQuotaForAdmin, loadServiceQuotaForCustomer } from "@/lib/hub-service-quota/server";
import { loadAppointmentsBetween } from "@/lib/hub-calendar/server";
import { addDays, wallTimeToUtc } from "@/lib/hub-calendar/rules";
import { todayIso } from "@/lib/hub-routes";
import type { HubRole } from "@/lib/hub-users/rules";
import type { InsightsData } from "./types";

const DAY = 86_400_000;
const noQuota: InsightsData["quota"] = { ready: false, enforced: false, window: null, rows: [], names: {} };
const empty = (today: string): InsightsData => ({ today, now: Date.now(), appointments: [], appointmentsError: null, quota: noQuota });

/**
 * The Service quota for the Insights tiles and the overview's widgets. Admins: every customer with a package, named,
 * archived ones left out (the service role only after the admin check). Customers: their own, while the switch is on.
 */
export async function loadQuota(role: HubRole | null): Promise<InsightsData["quota"]> {
  if (role === "oalab_admin") {
    const admin = await verifyHubAdmin();
    const db = admin ? createAdminClient() : null;
    if (!db) return noQuota;
    const [quota, archive] = await Promise.all([loadServiceQuotaForAdmin(db), loadArchive()]);
    const rows = quota.customers.filter((row) => !archive.customerIds.has(row.customerId));
    const ids = rows.map((row) => row.customerId);
    const named = ids.length
      ? await db.from("hub_customers").select("id, company, customer_number").in("id", ids).returns<{ id: string; company: string; customer_number: string }[]>()
      : { data: [], error: null };
    const names = Object.fromEntries((named.error ? [] : named.data ?? []).map((row) => [row.id, { company: row.company, customerNumber: row.customer_number }]));
    return { ready: quota.ready && !quota.error, enforced: quota.enforced, window: quota.window, rows, names };
  }
  if (role === "oalab_customer") {
    const quota = await loadServiceQuotaForCustomer(await createClient());
    return { ready: quota.ready && !quota.error, enforced: quota.enforced, window: quota.window, rows: quota.customers, names: {} };
  }
  return noQuota;
}

/**
 * The Insights page's own data. Admins: every appointment from the start of today for a month (today's list and the
 * open requests) and the quota of every customer with a package. Customers: their appointments of the next two months
 * and their quota while the switch is on. Freelancers (19.11.2026): their appointments like customers, no quota.
 */
export async function loadInsights(role: HubRole | null): Promise<InsightsData> {
  const today = todayIso();
  if (role !== "oalab_admin" && role !== "oalab_customer" && role !== "oalab_freelancer") return empty(today);
  const now = Date.now();
  const admin = role === "oalab_admin";
  const [appointments, quota] = await Promise.all([
    admin ? loadAppointmentsBetween(wallTimeToUtc(today, "00:00"), wallTimeToUtc(addDays(today, 31), "00:00"), 60) : loadAppointmentsBetween(now, now + 61 * DAY, 10),
    loadQuota(role),
  ]);
  return { today, now, appointments: appointments.appointments, appointmentsError: appointments.error, quota };
}
