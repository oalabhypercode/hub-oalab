import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadLiveProjects } from "@/lib/hub-projects/server";
import { listAllUsers } from "@/lib/hub-users/server";
import { mailSettings } from "@/lib/hub-mail/send";
import type { AssistantData } from "./tools";
import type { CustomerContext } from "./customers";

type CustomerRow = {
  id: string;
  organization_id: string | null;
  company: string;
  customer_number: string;
  service_packages: string[] | null;
  city: string | null;
  website: string | null;
  contact_email: string | null;
};

/**
 * What the assistant's tools may read: the same customers and Studio projects the admin sees in the hub.
 * Call only after the route has verified a real admin with a confirmed second factor. Null when the data
 * cannot be loaded; the assistant then says so instead of answering without data.
 */
export async function loadAssistantData(): Promise<AssistantData | null> {
  const db = createAdminClient();
  if (!db) return null;
  const [projects, customers] = await Promise.all([
    loadLiveProjects(),
    db.from("hub_customers").select("id, organization_id, company, customer_number, service_packages, city, website, contact_email").order("company").returns<CustomerRow[]>(),
  ]);
  if (projects.error || customers.error) return null;
  return {
    projects: projects.projects,
    customers: (customers.data ?? []).map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      company: row.company,
      customerNumber: row.customer_number,
      servicePackages: row.service_packages ?? [],
      city: row.city ?? "",
      website: row.website ?? "",
      contactEmail: row.contact_email ?? "",
    })),
  };
}

type PlanRow = { id: string; code: string; name: string; created_at: string };

/**
 * For a customer proposal (propose_customer), loaded only when the assistant makes one: the active Service packages,
 * the addresses that already have a login and whether mails really go out. Call only after the same admin check.
 */
export async function loadCustomerContext(): Promise<CustomerContext | null> {
  const db = createAdminClient();
  if (!db) return null;
  try {
    const [plans, users] = await Promise.all([
      db.from("plans").select("id, code, name, created_at").eq("is_active", true).returns<PlanRow[]>(),
      listAllUsers(db),
    ]);
    if (plans.error) return null;
    return {
      plans: (plans.data ?? []).map((row) => ({ id: row.id, code: row.code, name: row.name, createdAt: row.created_at })),
      loginEmails: new Set(users.flatMap((user) => user.email ? [user.email.toLowerCase()] : [])),
      mailReady: mailSettings().configured,
    };
  } catch {
    return null;
  }
}
