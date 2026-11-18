import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { loadArchive } from "@/lib/hub-archive/server";
import { packagesOf, readCustomerPackages } from "@/lib/hub-contracts/packages";
import { heldPackages, isServicePackageId } from "@/lib/service-packages";
import type { HubRole } from "@/lib/hub-users/rules";
import { loadAppointmentsBetween } from "@/lib/hub-calendar/server";
import { addDays, wallTimeToUtc } from "@/lib/hub-calendar/rules";
import { weekStartOf } from "@/lib/hub-insights/rules";
import { loadQuota } from "@/lib/hub-insights/server";
import { todayIso } from "@/lib/hub-routes";
import type { OverviewFacts, OverviewWidgetsData } from "./types";

/**
 * The facts of the admins' welcome card (18.11.2026): customers without freelancers and archived ones, and those with
 * Service Lite or Max under „Vertrag & Domain“. Null for everyone else and when the numbers could not be read.
 */
export async function loadOverviewFacts(role: HubRole | null): Promise<OverviewFacts | null> {
  if (role !== "oalab_admin") return null;
  const admin = await verifyHubAdmin();
  const db = admin ? createAdminClient() : null;
  if (!db) return null;
  const [customers, packages, archive] = await Promise.all([
    db.from("hub_customers").select("id, kind").returns<{ id: string; kind: string | null }[]>(),
    readCustomerPackages(db),
    loadArchive(),
  ]);
  if (customers.error || !packages.ready) return null;
  const ids = (customers.data ?? []).filter((row) => row.kind !== "freelancer" && !archive.customerIds.has(row.id)).map((row) => row.id);
  return { customers: ids.length, withService: ids.filter((id) => heldPackages(packagesOf(packages.byCustomer, id)).some(isServicePackageId)).length };
}

/**
 * The widgets beside the notifications (18.11.2026): this week's appointments (Monday to Sunday, RLS as in the calendar)
 * and the Service quota, for admins and customers. Freelancers have no widgets.
 */
export async function loadOverviewWidgets(role: HubRole | null): Promise<OverviewWidgetsData | null> {
  if (role !== "oalab_admin" && role !== "oalab_customer") return null;
  const today = todayIso();
  const weekStart = weekStartOf(today);
  const [appointments, quota] = await Promise.all([
    loadAppointmentsBetween(wallTimeToUtc(weekStart, "00:00"), wallTimeToUtc(addDays(weekStart, 7), "00:00"), 60),
    loadQuota(role),
  ]);
  return { today, now: Date.now(), weekStart, appointments: appointments.appointments, appointmentsError: appointments.error, quota };
}
