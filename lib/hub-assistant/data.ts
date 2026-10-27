import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadLiveProjects } from "@/lib/hub-projects/server";
import type { AssistantData } from "./tools";

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
