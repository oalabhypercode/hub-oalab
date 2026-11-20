import "server-only";
import { domainToUnicode } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyHubFreelancer } from "@/lib/hub-users/server";
import { emptyShares, isUuid, parseCards } from "./rules";
import type { FreelancerAssignment, FreelancerCustomerCard, FreelancerCustomersState, FreelancerShareState } from "./types";

// The freelancers' area „Kunden“ and the admins' tab „Freelancer“ under „Vertrag & Domain“ (migration 202611180001 in
// service-oalab). Freelancers read only through hub_freelancer_customer_cards() with their own session: the database
// hands out per customer exactly what oalab released. Admins read every assignment and its shares with the service
// role after their admin check (lib/hub-contracts/server.ts).

const readable = (domain: string) => {
  try {
    return domainToUnicode(domain) || domain;
  } catch {
    return domain;
  }
};

/** The function or the table is missing until the migration is applied. */
const missingFunction = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (error.code === "PGRST202" || error.code === "42883" || /hub_freelancer_customer_cards/i.test(error.message ?? "")));
const missingTable = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || /hub_freelancer_shares/i.test(error.message ?? "")));

/** Before the migration: the customers from the freelancer's own list, without anything of „Vertrag & Domain“. */
async function customersWithoutShares(supabase: SupabaseClient): Promise<FreelancerCustomerCard[]> {
  const links = await supabase.from("hub_freelancer_customers").select("freelancer_id, customer_id, assigned_at").returns<{ freelancer_id: string; customer_id: string; assigned_at: string | null }[]>();
  if (links.error || !links.data?.length) return [];
  const customers = await supabase.from("hub_customers").select("id, company, customer_number, organization_id").in("id", links.data.map((link) => link.customer_id))
    .returns<{ id: string; company: string; customer_number: string; organization_id: string | null }[]>();
  if (customers.error) return [];
  const byId = new Map((customers.data ?? []).map((row) => [row.id, row]));
  return links.data.flatMap((link): FreelancerCustomerCard[] => {
    const row = byId.get(link.customer_id);
    return row ? [{
      customerId: row.id, freelancerId: link.freelancer_id, company: row.company, customerNumber: row.customer_number, organizationId: isUuid(row.organization_id) ? row.organization_id : null,
      assignedAt: link.assigned_at, shares: emptyShares(), note: null, noteUpdatedAt: null, domains: null, mailServer: null, mailboxes: null, packages: null, contact: null,
    }] : [];
  }).sort((a, b) => a.company.localeCompare(b.company, "de"));
}

/**
 * The cards of the freelancer behind this client, for the Claude connector (lib/hub-mcp/freelancer.ts), which passes
 * one carrying the freelancer's claims: the same database function as „Kunden“, so only what oalab released. Null
 * when it cannot be read.
 */
export async function loadFreelancerCardsWith(supabase: SupabaseClient): Promise<FreelancerCustomerCard[] | null> {
  const { data, error } = await supabase.rpc("hub_freelancer_customer_cards");
  return error ? null : parseCards(data, readable);
}

/** The customers of the signed-in freelancer, each with exactly what oalab released. */
export async function loadFreelancerCustomers(): Promise<FreelancerCustomersState> {
  const freelancer = await verifyHubFreelancer();
  if (!freelancer) return { source: "supabase", ready: false, cards: [], error: "Deine Kunden siehst du, sobald deine Anmeldung mit dem Code bestätigt ist." };
  const { data, error } = await freelancer.supabase.rpc("hub_freelancer_customer_cards");
  if (error) {
    if (!missingFunction(error)) return { source: "supabase", ready: false, cards: [], error: "Deine Kunden konnten gerade nicht geladen werden. Bitte versuche es erneut." };
    return { source: "supabase", ready: false, cards: await customersWithoutShares(freelancer.supabase as unknown as SupabaseClient) };
  }
  return { source: "supabase", ready: true, cards: parseCards(data, readable) };
}

type LinkRow = { freelancer_id: string; customer_id: string; assigned_at: string | null };
type ShareRow = {
  freelancer_id: string; customer_id: string; domains_since: string | null; mail_since: string | null; packages_since: string | null; contact_since: string | null;
  note: string; note_updated_at: string | null;
};

/**
 * Every assignment of a freelancer to a customer with its shares, for a real admin, read with the service role after
 * the admin check. Freelancers the archive hides (`hidden`) stay out. Before the migration the assignments come
 * without shares and the tab cannot save yet.
 */
export async function loadFreelancerSharesForAdmin(db: SupabaseClient, hidden: ReadonlySet<string> = new Set()): Promise<FreelancerShareState> {
  const [links, shares] = await Promise.all([
    db.from("hub_freelancer_customers").select("freelancer_id, customer_id, assigned_at").returns<LinkRow[]>(),
    db.from("hub_freelancer_shares").select("freelancer_id, customer_id, domains_since, mail_since, packages_since, contact_since, note, note_updated_at").returns<ShareRow[]>(),
  ]);
  if (links.error) return { ready: false, assignments: [], error: "Die Freelancer der Kunden konnten gerade nicht geladen werden." };
  if (shares.error && !missingTable(shares.error)) return { ready: false, assignments: [], error: "Die Freigaben für Freelancer konnten gerade nicht geladen werden." };
  const shown = (links.data ?? []).filter((link) => !hidden.has(link.freelancer_id) && !hidden.has(link.customer_id));
  const freelancerIds = [...new Set(shown.map((link) => link.freelancer_id))];
  const names = freelancerIds.length
    ? await db.from("hub_customers").select("id, company, customer_number").in("id", freelancerIds).returns<{ id: string; company: string; customer_number: string }[]>()
    : { data: [], error: null };
  if (names.error) return { ready: false, assignments: [], error: "Die Freelancer der Kunden konnten gerade nicht geladen werden." };
  const nameOf = new Map((names.data ?? []).map((row) => [row.id, row]));
  const shareOf = new Map((shares.data ?? []).map((row) => [`${row.freelancer_id}:${row.customer_id}`, row]));
  return {
    ready: !shares.error,
    assignments: shown.flatMap((link): FreelancerAssignment[] => {
      const freelancer = nameOf.get(link.freelancer_id);
      if (!freelancer) return [];
      const share = shareOf.get(`${link.freelancer_id}:${link.customer_id}`);
      return [{
        freelancerId: link.freelancer_id, freelancerName: freelancer.company, freelancerNumber: freelancer.customer_number, customerId: link.customer_id, assignedAt: link.assigned_at,
        shares: share ? { domains: share.domains_since, mail: share.mail_since, packages: share.packages_since, contact: share.contact_since } : emptyShares(),
        note: share?.note ?? "", noteUpdatedAt: share?.note ? share.note_updated_at : null,
      }];
    }).sort((a, b) => a.freelancerName.localeCompare(b.freelancerName, "de")),
  };
}
