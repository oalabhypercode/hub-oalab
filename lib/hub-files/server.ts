import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readEntriesWithoutActiveLogin } from "@/lib/hub-users/deactivated";
import { loadCustomerLogos, signCustomerLogos } from "@/lib/hub-logos/server";
import type { CustomerLogo } from "@/lib/hub-logos/rules";
import { loadFreelancerCustomerList, withFreelancerCustomers, type FreelancerCustomerRow } from "@/lib/hub-freelancer-customers/list";
import { loadArchive } from "@/lib/hub-archive/server";
import { fileInSight, noArchive } from "@/lib/hub-archive/rules";
import { isFileCategory } from "./catalog";
import { isFileAudience, type HubFileCustomer, type HubFilesState, type HubFolder, type HubStoredFile } from "./types";
import { isTeamKind } from "@/lib/hub-team/rules";

type CustomerRow = { id: string; customer_number: string; company: string; kind?: string };
type FileRow = {
  id: string;
  title: string;
  file_name: string;
  category: string;
  description: string;
  mime_type: string;
  size_bytes: number;
  sha256: string | null;
  created_at: string;
  hub_file_assignments: { customer_id?: string; folder_id: string | null; audience?: string; customer: CustomerRow | null }[] | null;
};

const FILE_COLUMNS = "id, title, file_name, category, description, mime_type, size_bytes, sha256, created_at";
/** A column the freelancer migration adds is missing: read without it (everything stays a customer, seen by both). */
const missingColumn = (error: { code?: string; message?: string } | null) => Boolean(error && (error.code === "42703" || error.code === "PGRST200" || /audience|kind|hub_freelancer_customers/i.test(error.message ?? "")));
type FolderRow = { id: string; customer_id: string; name: string };

const toCustomer = (row: CustomerRow): HubFileCustomer => ({ id: row.id, customerNumber: row.customer_number, company: row.company });

export function describeStorageError(error: { code?: string; message?: string }) {
  if (error.code === "42P01" || error.code === "42703" || error.code === "PGRST205" || /hub_files|hub_folders|folder_id|schema cache/i.test(error.message ?? "")) {
    return "Die Dateiablage ist in Supabase noch nicht eingerichtet. Die Migration steht noch aus.";
  }
  return "Die Dateien konnten gerade nicht geladen werden. Bitte versuche es erneut.";
}

type Session = Awaited<ReturnType<typeof createClient>>;

/**
 * The logos of the Asset Management (admins: of everyone, freelancers: of their own entry and their customers;
 * customers see their own one in the shell instead) and, for a freelancer, the customers they look after with name,
 * number and logo only (lib/hub-freelancer-customers/list.ts; null before migration 202611200001, then the session
 * still reads those customers in hub_customers and everything stays as before).
 */
async function logosAndTheirs(supabase: Session, canManage: boolean, isFreelancer: boolean): Promise<{ logos: Map<string, CustomerLogo>; theirs: FreelancerCustomerRow[] | null }> {
  if (!isFreelancer) return { logos: canManage ? await loadCustomerLogos(supabase) : new Map<string, CustomerLogo>(), theirs: null };
  const theirs = await loadFreelancerCustomerList(supabase);
  const [readable, listed] = await Promise.all([loadCustomerLogos(supabase), theirs ? signCustomerLogos(supabase, theirs) : new Map<string, CustomerLogo>()]);
  return { logos: new Map([...readable, ...listed]), theirs };
}

/**
 * Files visible to the signed-in Supabase user. Row Level Security decides:
 * admins see every file and customer, customers only files assigned to their customer, freelancers their own files
 * and what their customers share with them (only with a confirmed second factor). Archived customers stay out of the
 * admins' view (lib/hub-archive), with their folders and the files only they hold; the database already hides them
 * from freelancers, and their own logins are blocked. A freelancer's session reads only its own entry in hub_customers
 * (since migration 202611200001): the names of their customers, also at their files, come from their customer list.
 */
export async function loadHubFiles(): Promise<HubFilesState> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const role = (claims?.claims.app_metadata as Record<string, unknown> | undefined)?.app_role;
  const canManage = role === "oalab_admin";
  const isFreelancer = role === "oalab_freelancer";
  const readFiles = (assignment: string) => supabase.from("hub_files").select(`${FILE_COLUMNS}, hub_file_assignments(${assignment}, customer:hub_customers(id, customer_number, company))`).order("created_at", { ascending: false }).returns<FileRow[]>();
  const readCustomers = (columns: string) => supabase.from("hub_customers").select(columns).order("customer_number").returns<CustomerRow[]>();
  const [firstFiles, firstCustomers, folders, shown, links, own, archive] = await Promise.all([
    readFiles("customer_id, folder_id, audience"),
    readCustomers("id, customer_number, company, kind"),
    supabase.from("hub_folders").select("id, customer_id, name").order("name").returns<FolderRow[]>(),
    logosAndTheirs(supabase, canManage, isFreelancer),
    // Admins see who looks after whom ("Betreut von").
    canManage ? supabase.from("hub_freelancer_customers").select("freelancer_id, customer_id").returns<{ freelancer_id: string; customer_id: string }[]>() : null,
    // A freelancer's own entry: the files oalab provides for them ("Meine Dateien").
    isFreelancer && claims?.claims.sub ? supabase.from("hub_customer_members").select("customer_id").eq("user_id", claims.claims.sub).limit(1).maybeSingle<{ customer_id: string }>() : null,
    canManage ? loadArchive() : noArchive,
  ]);
  // Before the freelancer migration the new columns are missing: read as before.
  const files = missingColumn(firstFiles.error) ? await readFiles("customer_id, folder_id") : firstFiles;
  const customers = missingColumn(firstCustomers.error) ? await readCustomers("id, customer_number, company") : firstCustomers;
  const error = files.error ?? folders.error;
  if (error) return { source: "supabase", files: [], customers: [], folders: [], canManage, error: describeStorageError(error) };
  const { logos, theirs } = shown;
  // oalab's own entry (kind team) has no files yet: they follow in stage 2 of the plan „oalab als Unternehmen“.
  const customerRows = withFreelancerCustomers((customers.data ?? []).filter((row) => !isTeamKind(row.kind)), theirs);
  // The embedded customer is empty where the session may not read the row (a freelancer's customers): named from the list.
  const named = new Map(customerRows.map((row) => [row.id, row]));
  const fileRows = (files.data ?? []).map((row): FileRow => ({
    ...row,
    hub_file_assignments: (row.hub_file_assignments ?? []).map((assignment) => assignment.customer || !assignment.customer_id ? assignment : { ...assignment, customer: named.get(assignment.customer_id) ?? null }),
  }));
  const linkRows = (links && !links.error ? links.data ?? [] : []).filter((link) => !archive.customerIds.has(link.freelancer_id) && !archive.customerIds.has(link.customer_id));
  // Admins pick no freelancer whose every login is deactivated (lib/hub-users/deactivated.ts); a failed read hides none.
  const adminDb = canManage ? createAdminClient() : null;
  const inactive = adminDb ? await readEntriesWithoutActiveLogin(adminDb, customerRows.filter((row) => row.kind === "freelancer").map((row) => row.id)).catch(() => null) : null;
  // An archived customer's assignments drop out; a file only archived customers hold goes with them.
  const inSight = (row: FileRow) => (row.hub_file_assignments ?? []).filter((assignment) => !assignment.customer || !archive.customerIds.has(assignment.customer.id));
  return {
    source: "supabase",
    canManage,
    ...(isFreelancer ? { freelancer: { ownId: own?.data?.customer_id ?? null } } : {}),
    ...(canManage ? { freelancers: Boolean(links && !links.error) } : {}),
    customers: customerRows.filter((row) => !archive.customerIds.has(row.id)).map((row) => {
      const logo = logos.get(row.id);
      const customer: HubFileCustomer = { ...toCustomer(row), kind: row.kind === "freelancer" ? "freelancer" : "customer" };
      if (logo) customer.logo = logo;
      if (canManage) customer.freelancerIds = linkRows.filter((link) => link.customer_id === row.id).map((link) => link.freelancer_id);
      if (inactive?.has(row.id)) customer.inactive = true;
      return customer;
    }),
    folders: (folders.data ?? []).filter((row) => !archive.customerIds.has(row.customer_id)).map((row): HubFolder => ({ id: row.id, customerId: row.customer_id, name: row.name })),
    files: fileRows.filter((row) => fileInSight(archive, (row.hub_file_assignments ?? []).flatMap((assignment) => assignment.customer ? [assignment.customer.id] : []))).map((row): HubStoredFile => {
      const assignments = inSight(row);
      return {
        id: row.id,
        title: row.title,
        fileName: row.file_name,
        category: isFileCategory(row.category) ? row.category : "other",
        description: row.description,
        mimeType: row.mime_type,
        sizeBytes: Number(row.size_bytes),
        sha256: row.sha256,
        createdAt: row.created_at,
        customers: assignments.flatMap((assignment) => assignment.customer ? [toCustomer(assignment.customer)] : [])
          .sort((a, b) => a.customerNumber.localeCompare(b.customerNumber)),
        folderIds: Object.fromEntries(assignments.flatMap((assignment) => assignment.customer && assignment.folder_id ? [[assignment.customer.id, assignment.folder_id]] : [])),
        audiences: Object.fromEntries(assignments.flatMap((assignment) => assignment.customer && isFileAudience(assignment.audience) && assignment.audience !== "both" ? [[assignment.customer.id, assignment.audience]] : [])),
      };
    }),
  };
}

/**
 * The number next to "Asset Management" / "Dateien" in the sidebar: every file for admins, the assigned ones for
 * customers (RLS counts). For admins without the files only archived customers hold, like the list.
 */
export async function countHubFiles() {
  const supabase = await createClient();
  const [{ count, error }, archive] = await Promise.all([
    supabase.from("hub_files").select("id", { count: "exact", head: true }),
    adminArchive(supabase),
  ]);
  if (error) return undefined;
  if (!archive.customerIds.size) return count ?? 0;
  const assignments = await supabase.from("hub_file_assignments").select("file_id, customer_id").in("customer_id", [...archive.customerIds]).returns<{ file_id: string; customer_id: string }[]>();
  const touched = [...new Set((assignments.data ?? []).map((row) => row.file_id))];
  if (assignments.error || !touched.length) return count ?? 0;
  const held = await supabase.from("hub_file_assignments").select("file_id, customer_id").in("file_id", touched).returns<{ file_id: string; customer_id: string }[]>();
  if (held.error) return count ?? 0;
  const hidden = touched.filter((fileId) => !fileInSight(archive, (held.data ?? []).filter((row) => row.file_id === fileId).map((row) => row.customer_id)));
  return Math.max(0, (count ?? 0) - hidden.length);
}

/** The archive for an admin session, nothing for everyone else (their view is decided by the database). */
async function adminArchive(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase.auth.getClaims();
  return (data?.claims.app_metadata as Record<string, unknown> | undefined)?.app_role === "oalab_admin" ? loadArchive() : noArchive;
}
