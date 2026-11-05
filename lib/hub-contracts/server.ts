import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { loadCustomerLogos } from "@/lib/hub-logos/server";
import type { CustomerLogo } from "@/lib/hub-logos/rules";
import type { HubAccountData } from "@/lib/hub-users/types";
import { loadDomainMailForAdmin, loadDomainMailForCustomer } from "@/lib/hub-domains/server";
import { emptyDomainMail } from "@/lib/hub-domains/types";
import { vaultKey } from "@/lib/hub-vault/key";
import { isTimelineKind } from "./rules";
import { packagesOf, readCustomerPackages } from "./packages";
import type { ContractCustomer, ContractsState, TimelineEntry } from "./types";

type CustomerRow = { id: string; company: string; customer_number: string; kind: string | null };
type TimelineRow = {
  id: string; customer_id: string; occurred_on: string; kind: string; title: string; amount_cents: number | null; file_id: string | null;
  customer_visible: boolean; created_at: string; note?: string; source?: string; created_by?: string | null;
};

/** What customers may read of the timeline (the column grant of migration 202611050001); never the note or the author. */
export const CUSTOMER_TIMELINE_COLUMNS = "id, customer_id, occurred_on, kind, title, amount_cents, file_id, customer_visible, created_at";
const ADMIN_TIMELINE_COLUMNS = `${CUSTOMER_TIMELINE_COLUMNS}, note, source, created_by`;

/** The tables are missing until the migration is applied. */
export const isMissingContractTables = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || /hub_customer_(timeline|packages)|schema cache/i.test(error.message ?? "")));

function toEntry(row: TimelineRow, nameOf?: (id: string | null) => string): TimelineEntry | null {
  if (!isTimelineKind(row.kind)) return null;
  const entry: TimelineEntry = {
    id: row.id, customerId: row.customer_id, occurredOn: row.occurred_on, kind: row.kind, title: row.title,
    amountCents: row.amount_cents, fileId: row.file_id, customerVisible: row.customer_visible, createdAt: row.created_at,
  };
  return nameOf ? { ...entry, note: row.note ?? "", source: row.source === "package" ? "package" : "manual", authorName: nameOf(row.created_by ?? null) } : entry;
}

const empty = (view: ContractsState["view"], error?: string): ContractsState => ({ view, source: "supabase", customers: [], timeline: [], ready: false, canManage: false, domainMail: emptyDomainMail(false), error });
const domainMailFailed = () => emptyDomainMail(false, "Domains und Mail konnten gerade nicht geladen werden. Bitte versuche es erneut.");

/** Every customer with its packages and the whole timeline for a real admin, read with the service role after the check. */
async function loadForAdmin(): Promise<ContractsState> {
  if (!await verifyHubAdmin()) return empty("admin", "Vertrag & Domain ist nur für Admins mit bestätigtem zweitem Faktor verfügbar.");
  const db = createAdminClient();
  if (!db) return empty("admin", "Auf dem Server fehlt der Supabase Secret Key (SUPABASE_SECRET_KEY).");
  // Passwords need this session's confirmed second factor; verifyHubAdmin alone also lets admins without one in.
  const { data: claims } = await (await createClient()).auth.getClaims();
  const confirmed = claims?.claims?.aal === "aal2";
  const [customers, packages, timeline, profiles, logos, domainMail] = await Promise.all([
    db.from("hub_customers").select("id, company, customer_number, kind").order("company").returns<CustomerRow[]>(),
    readCustomerPackages(db),
    db.from("hub_customer_timeline").select(ADMIN_TIMELINE_COLUMNS).order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).limit(3000).returns<TimelineRow[]>(),
    db.from("hub_profiles").select("user_id, first_name, last_name").returns<{ user_id: string; first_name: string; last_name: string }[]>(),
    loadCustomerLogos(db).catch(() => new Map<string, CustomerLogo>()),
    loadDomainMailForAdmin(db, confirmed, vaultKey() !== null).catch(domainMailFailed),
  ]);
  if (customers.error) return empty("admin", "Die Kunden konnten gerade nicht geladen werden. Bitte versuche es erneut.");
  if (timeline.error && !isMissingContractTables(timeline.error)) return empty("admin", "Pakete und Verlauf konnten gerade nicht geladen werden. Bitte versuche es erneut.");
  const ready = packages.ready && !timeline.error;
  const names = new Map((profiles.data ?? []).map((row) => [row.user_id, `${row.first_name} ${row.last_name}`.trim()]));
  const nameOf = (id: string | null) => (id && names.get(id)) || "oalab-Team";
  return {
    view: "admin",
    source: "supabase",
    // Freelancers hold no packages: only entries of the kind customer.
    customers: (customers.data ?? []).filter((row) => (row.kind ?? "customer") === "customer").map((row): ContractCustomer => ({
      id: row.id, company: row.company, customerNumber: row.customer_number, logo: logos.get(row.id) ?? null, packages: packagesOf(packages.byCustomer, row.id),
    })),
    timeline: ready ? (timeline.data ?? []).flatMap((row) => toEntry(row, nameOf) ?? []) : [],
    ready,
    canManage: ready,
    domainMail,
  };
}

/** The login's own customers with their packages and the released entries, read with its own session (RLS). */
async function loadForCustomer(account: HubAccountData): Promise<ContractsState> {
  const supabase = await createClient();
  const ids = account.customers.map((customer) => customer.id);
  const [packages, timeline, domainMail] = await Promise.all([
    readCustomerPackages(supabase, ids),
    ids.length
      ? supabase.from("hub_customer_timeline").select(CUSTOMER_TIMELINE_COLUMNS).in("customer_id", ids).eq("customer_visible", true)
        .order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).limit(500).returns<TimelineRow[]>()
      : Promise.resolve({ data: [] as TimelineRow[], error: null }),
    loadDomainMailForCustomer(supabase, ids).catch(domainMailFailed),
  ]);
  if (timeline.error && !isMissingContractTables(timeline.error)) return empty("customer", "Deine Angaben konnten gerade nicht geladen werden. Bitte versuche es erneut.");
  return {
    view: "customer",
    source: "supabase",
    customers: account.customers.map((customer): ContractCustomer => ({
      id: customer.id, company: customer.company, customerNumber: customer.customerNumber, logo: null, packages: packagesOf(packages.byCustomer, customer.id),
    })),
    timeline: (timeline.data ?? []).flatMap((row) => toEntry(row) ?? []),
    ready: packages.ready && !timeline.error,
    canManage: false,
    domainMail,
  };
}

/**
 * The area „Vertrag & Domain“ for a real login: everything for admins, their own for customers. Preview, public demo
 * and the demo logins keep their fixtures (undefined); freelancers never reach the page.
 */
export async function loadContractsForIdentity(identity: { publicDemo: boolean; demoAccess?: unknown; account?: HubAccountData | null }): Promise<ContractsState | undefined> {
  if (identity.publicDemo || identity.demoAccess || !identity.account) return undefined;
  if (identity.account.role === "oalab_admin") return loadForAdmin();
  if (identity.account.role === "oalab_customer") return loadForCustomer(identity.account);
  return undefined;
}
