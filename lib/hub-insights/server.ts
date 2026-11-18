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
const empty = (today: string): InsightsData => ({ today, now: Date.now(), appointments: [], appointmentsError: null, quota: { ready: false, enforced: false, window: null, rows: [], names: {} } });

/**
 * The Insights page's own data. Admins: every appointment from the start of today for a month (today's list and the
 * open requests) and the quota of every customer with a package, with names, archived ones left out. Customers: their
 * appointments of the next two months and their quota while the switch is on. Freelancers have no Insights tiles.
 */
export async function loadInsights(role: HubRole | null): Promise<InsightsData> {
  const today = todayIso();
  if (role !== "oalab_admin" && role !== "oalab_customer") return empty(today);
  if (role === "oalab_admin") {
    const admin = await verifyHubAdmin();
    const db = admin ? createAdminClient() : null;
    if (!db) return empty(today);
    const start = wallTimeToUtc(today, "00:00");
    const [appointments, quota, archive] = await Promise.all([
      loadAppointmentsBetween(start, wallTimeToUtc(addDays(today, 31), "00:00"), 60),
      loadServiceQuotaForAdmin(db),
      loadArchive(),
    ]);
    const ids = quota.customers.map((row) => row.customerId).filter((id) => !archive.customerIds.has(id));
    const named = ids.length
      ? await db.from("hub_customers").select("id, company, customer_number").in("id", ids).returns<{ id: string; company: string; customer_number: string }[]>()
      : { data: [], error: null };
    const names = Object.fromEntries((named.error ? [] : named.data ?? []).map((row) => [row.id, { company: row.company, customerNumber: row.customer_number }]));
    return {
      today,
      now: Date.now(),
      appointments: appointments.appointments,
      appointmentsError: appointments.error,
      quota: { ready: quota.ready && !quota.error, enforced: quota.enforced, window: quota.window, rows: quota.customers.filter((row) => !archive.customerIds.has(row.customerId)), names },
    };
  }
  const now = Date.now();
  const [appointments, quota] = await Promise.all([
    loadAppointmentsBetween(now, now + 61 * DAY, 10),
    createClient().then((supabase) => loadServiceQuotaForCustomer(supabase)),
  ]);
  return {
    today,
    now,
    appointments: appointments.appointments,
    appointmentsError: appointments.error,
    quota: { ready: quota.ready && !quota.error, enforced: quota.enforced, window: quota.window, rows: quota.customers, names: {} },
  };
}
