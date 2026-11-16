import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { domainToUnicode } from "node:url";
import { packagesOf, readCustomerPackages } from "@/lib/hub-contracts/packages";
import { loadServiceQuotaForAdmin } from "@/lib/hub-service-quota/server";
import { emptyServiceQuota } from "@/lib/hub-service-quota/types";
import { quotaMonth } from "@/lib/hub-service-quota/rules";
import { conversationState, requestReference } from "@/lib/hub-conversations/rules";
import { closedRequestStates, countRequests, doneRequestStates, toHubProject, toProjectTask, websiteUrl, type LiveProjectsState, type StudioDetailsRow, type StudioProjectRow, type StudioTaskRow } from "./map";
import type { DeskCustomer, DeskRequest, ProjectDesk } from "./desk";

// Real projects come from OALab Studio in the shared database. Service grants browsers no direct read of projects,
// organizations or requests, so the hub decides *which* projects a viewer sees first and reads their names afterwards:
// - admins pass the same check as the user management (hub role, second factor, is_hub_admin()) and see every project;
// - customers read Studio details and tasks with their own session, where Studio's RLS only returns what is released
//   to their company; names and request counts are then read for exactly those projects.

const DETAILS = "project_id, description, status, start_date, due_date, milestones, version";
// Admins also read whether the customer sees a project; customers only ever get their released ones.
const ADMIN_DETAILS = `${DETAILS}, client_visible`;
const TASKS = "id, task_number, project_id, title, status, due_date, labels, client_visible, version";
const unavailable = (error: string): LiveProjectsState => ({ projects: [], error });

async function assemble(viewer: SupabaseClient, db: SupabaseClient, admin: boolean): Promise<LiveProjectsState> {
  // Which projects: everything that is not archived for admins, the released ones for customers.
  const visible = admin
    ? await db.from("customer_projects").select("id").neq("status", "archived").returns<{ id: string }[]>()
    : await viewer.from("studio_project_details").select("project_id").returns<{ project_id: string }[]>();
  if (visible.error) return unavailable("Die Projekte konnten gerade nicht geladen werden. Bitte versuche es erneut.");
  const ids = (visible.data ?? []).map((row) => "id" in row ? row.id : row.project_id);
  if (!ids.length) return { projects: [], error: null };

  // Customers read details and tasks with their own session, so Studio's RLS keeps internal tasks away from them.
  const reader = admin ? db : viewer;
  const [projects, details, tasks, requests] = await Promise.all([
    db.from("customer_projects").select("id, organization_id, display_name, status, test_url, live_url").in("id", ids).neq("status", "archived").returns<StudioProjectRow[]>(),
    reader.from("studio_project_details").select(admin ? ADMIN_DETAILS : DETAILS).in("project_id", ids).returns<StudioDetailsRow[]>(),
    reader.from("studio_tasks").select(TASKS).in("project_id", ids).eq("archived", false).returns<StudioTaskRow[]>(),
    db.from("service_requests").select("project_id, state").in("project_id", ids).is("trashed_at", null).returns<{ project_id: string; state: string }[]>(),
  ]);
  const error = projects.error ?? details.error ?? tasks.error ?? requests.error;
  if (error) return unavailable("Die Projekte konnten gerade nicht geladen werden. Bitte versuche es erneut.");

  const organizationIds = [...new Set((projects.data ?? []).map((row) => row.organization_id))];
  const [organizations, customers] = organizationIds.length
    ? await Promise.all([
      db.from("organizations").select("id, name").in("id", organizationIds).returns<{ id: string; name: string }[]>(),
      // The hub customer of each organization: the project dialog jumps from there to its chat, files and contract.
      db.from("hub_customers").select("id, website, organization_id").in("organization_id", organizationIds).returns<CustomerRow[]>(),
    ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (organizations.error) return unavailable("Die Projekte konnten gerade nicht geladen werden. Bitte versuche es erneut.");

  const names = new Map((organizations.data ?? []).map((row) => [row.id, row.name]));
  // Without the customer row the dialog only leaves out its shortcuts; the projects themselves still show.
  const customerByOrganization = new Map((customers.error ? [] : customers.data ?? []).map((row) => [row.organization_id, { id: row.id, website: row.website }]));
  const detailsById = new Map((details.data ?? []).map((row) => [row.project_id, row]));
  return {
    error: null,
    projects: (projects.data ?? [])
      .map((project) => toHubProject({
        project,
        details: detailsById.get(project.id) ?? null,
        tasks: (tasks.data ?? []).filter((task) => task.project_id === project.id).map(toProjectTask),
        requests: countRequests((requests.data ?? []).filter((request) => request.project_id === project.id)),
        company: names.get(project.organization_id),
        customer: customerByOrganization.get(project.organization_id),
      }))
      .sort((a, b) => (a.company ?? "").localeCompare(b.company ?? "", "de") || a.name.localeCompare(b.name, "de")),
  };
}

type CustomerRow = { id: string; website: string | null; organization_id: string };
type DeskCustomerRow = { id: string; company: string; customer_number: string; website: string | null; organization_id: string | null; kind: string | null };
type DomainRow = { id: string; customer_id: string; domain: string; status: string | null; renews_on: string | null };
type RequestRow = { id: string; request_number: number; title: string; state: string; organization_id: string; project_id: string | null; updated_at: string; released_at: string | null; resolved_at: string | null };

const REQUESTS = "id, request_number, title, state, organization_id, project_id, updated_at, released_at, resolved_at";
// On the test domain, waiting for the customer: the service platform's "Deine Freigabe" and "Testseite bereit".
const approvalStates = new Set(["beta_ready", "release_review"]);
const deskFailed = (error: string): ProjectDesk => ({ customers: [], month: null, error, partial: null });

const readable = (domain: string) => {
  try {
    return domainToUnicode(domain) || domain;
  } catch {
    return domain;
  }
};

const toRequest = (row: RequestRow): DeskRequest => {
  const view = conversationState(row.state);
  return { id: row.id, reference: requestReference(row.request_number), title: row.title, label: view.label, tone: view.tone, approval: approvalStates.has(row.state), projectId: row.project_id, at: row.updated_at };
};
/** When a finished request was finished: released or resolved. */
const finishedAt = (row: RequestRow) => (row.state === "released" ? row.released_at : row.resolved_at) ?? row.updated_at;
const noRows = <T,>() => Promise.resolve({ data: [] as T[], error: null });

/**
 * The admins' project page (Projekte V2): every hub customer of the kind customer, also those without a project, with
 * the domains of „Vertrag & Domain“, both packages, this month's count and the open requests on the service platform.
 * Only for a verified admin (the user management's check); undefined for everyone else. Without the domain or package
 * tables, the quota or the requests the page shows that part empty and says so, instead of failing as a whole.
 */
export const loadProjectDesk = cache(async (): Promise<ProjectDesk | undefined> => {
  if (!await verifyHubAdmin()) return undefined;
  const db = createAdminClient();
  if (!db) return deskFailed("Projekte sind noch nicht eingerichtet: Es fehlt der Server-Schlüssel (SUPABASE_SECRET_KEY).");
  const [customers, packages, quota] = await Promise.all([
    db.from("hub_customers").select("id, company, customer_number, website, organization_id, kind").order("company").returns<DeskCustomerRow[]>(),
    readCustomerPackages(db),
    loadServiceQuotaForAdmin(db).catch(() => emptyServiceQuota("failed")),
  ]);
  if (customers.error) return deskFailed("Die Kunden konnten gerade nicht geladen werden. Bitte versuche es erneut.");
  // Freelancers hold no projects and no packages: only entries of the kind customer.
  const rows = (customers.data ?? []).filter((row) => (row.kind ?? "customer") === "customer");
  const ids = rows.map((row) => row.id);
  const organizationIds = [...new Set(rows.flatMap((row) => row.organization_id ? [row.organization_id] : []))];
  // The month as the quota counts it (German time); without the quota there is no month to count finished ones in.
  const since = quota.ready ? quota.window?.startsAt ?? null : null;
  const [domains, open, finished] = await Promise.all([
    ids.length ? db.from("hub_customer_domains").select("id, customer_id, domain, status, renews_on").in("customer_id", ids).order("domain").returns<DomainRow[]>() : noRows<DomainRow>(),
    organizationIds.length
      ? db.from("service_requests").select(REQUESTS).in("organization_id", organizationIds).is("trashed_at", null)
        .not("state", "in", `(${closedRequestStates.join(",")})`).order("updated_at", { ascending: false }).limit(500).returns<RequestRow[]>()
      : noRows<RequestRow>(),
    organizationIds.length && since
      ? db.from("service_requests").select(REQUESTS).in("organization_id", organizationIds).is("trashed_at", null).in("state", [...doneRequestStates])
        .or(`released_at.gte."${since}",resolved_at.gte."${since}"`).limit(1000).returns<RequestRow[]>()
      : noRows<RequestRow>(),
  ]);
  const quotaByCustomer = new Map(quota.customers.map((row) => [row.customerId, row]));
  const domainList = domains.error ? [] : domains.data ?? [];
  const openList = open.error ? [] : open.data ?? [];
  const finishedList = (finished.error ? [] : finished.data ?? []).filter((row) => since !== null && Date.parse(finishedAt(row)) >= Date.parse(since));
  const partial = open.error || finished.error ? "Die Anfragen der Serviceplattform konnten gerade nicht geladen werden."
    : quota.error ? "Das Service-Kontingent konnte gerade nicht geladen werden."
    : null;
  return {
    error: null,
    partial,
    month: quota.ready && quota.window ? quotaMonth(quota.window).month : null,
    customers: rows.map((row): DeskCustomer => {
      const counted = quotaByCustomer.get(row.id);
      const done = finishedList.filter((request) => request.organization_id === row.organization_id).sort((a, b) => Date.parse(finishedAt(b)) - Date.parse(finishedAt(a)));
      return {
        id: row.id,
        company: row.company,
        customerNumber: row.customer_number,
        website: websiteUrl(row.website),
        organizationId: row.organization_id,
        domains: domainList.filter((domain) => domain.customer_id === row.id).map((domain) => ({ id: domain.id, domain: domain.domain, display: readable(domain.domain), status: domain.status ?? "active", renewsOn: domain.renews_on })),
        packages: packagesOf(packages.byCustomer, row.id),
        quota: counted && counted.packageId ? { used: counted.monthlyUsed, limit: counted.monthlyLimit } : null,
        requests: row.organization_id ? openList.filter((request) => request.organization_id === row.organization_id).map(toRequest) : [],
        done: { count: done.length, last: done[0] ? { reference: requestReference(done[0].request_number), title: done[0].title, at: finishedAt(done[0]) } : null },
      };
    }),
  };
});

/** Studio projects of the signed-in login, once per request (layout and page share it). */
export const loadLiveProjects = cache(async (): Promise<LiveProjectsState> => {
  const db = createAdminClient();
  if (!db) return unavailable("Projekte sind noch nicht eingerichtet: Es fehlt der Server-Schlüssel (SUPABASE_SECRET_KEY).");
  const admin = Boolean(await verifyHubAdmin());
  return assemble(await createClient(), db, admin);
});
