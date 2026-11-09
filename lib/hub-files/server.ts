import "server-only";
import { createClient } from "@/lib/supabase/server";
import { loadCustomerLogos } from "@/lib/hub-logos/server";
import type { CustomerLogo } from "@/lib/hub-logos/rules";
import { isFileCategory } from "./catalog";
import { isFileAudience, type HubFileCustomer, type HubFilesState, type HubFolder, type HubStoredFile } from "./types";

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
  hub_file_assignments: { folder_id: string | null; audience?: string; customer: CustomerRow | null }[] | null;
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

/**
 * Files visible to the signed-in Supabase user. Row Level Security decides:
 * admins see every file and customer, customers only files assigned to their customer, freelancers their own files
 * and what their customers share with them (only with a confirmed second factor).
 */
export async function loadHubFiles(): Promise<HubFilesState> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const role = (claims?.claims.app_metadata as Record<string, unknown> | undefined)?.app_role;
  const canManage = role === "oalab_admin";
  const isFreelancer = role === "oalab_freelancer";
  const readFiles = (assignment: string) => supabase.from("hub_files").select(`${FILE_COLUMNS}, hub_file_assignments(${assignment}, customer:hub_customers(id, customer_number, company))`).order("created_at", { ascending: false }).returns<FileRow[]>();
  const readCustomers = (columns: string) => supabase.from("hub_customers").select(columns).order("customer_number").returns<CustomerRow[]>();
  const [firstFiles, firstCustomers, folders, logos, links, own] = await Promise.all([
    readFiles("folder_id, audience"),
    readCustomers("id, customer_number, company, kind"),
    supabase.from("hub_folders").select("id, customer_id, name").order("name").returns<FolderRow[]>(),
    // The Asset Management shows the logos (admins: of everyone, freelancers: of their customers); customers see
    // their own one in the shell instead.
    canManage || isFreelancer ? loadCustomerLogos(supabase) : new Map<string, CustomerLogo>(),
    // Admins see who looks after whom ("Betreut von").
    canManage ? supabase.from("hub_freelancer_customers").select("freelancer_id, customer_id").returns<{ freelancer_id: string; customer_id: string }[]>() : null,
    // A freelancer's own entry: the files oalab provides for them ("Meine Dateien").
    isFreelancer && claims?.claims.sub ? supabase.from("hub_customer_members").select("customer_id").eq("user_id", claims.claims.sub).limit(1).maybeSingle<{ customer_id: string }>() : null,
  ]);
  // Before the freelancer migration the new columns are missing: read as before.
  const files = missingColumn(firstFiles.error) ? await readFiles("folder_id") : firstFiles;
  const customers = missingColumn(firstCustomers.error) ? await readCustomers("id, customer_number, company") : firstCustomers;
  const error = files.error ?? folders.error;
  if (error) return { source: "supabase", files: [], customers: [], folders: [], canManage, error: describeStorageError(error) };
  const linkRows = links && !links.error ? links.data ?? [] : [];
  return {
    source: "supabase",
    canManage,
    ...(isFreelancer ? { freelancer: { ownId: own?.data?.customer_id ?? null } } : {}),
    ...(canManage ? { freelancers: Boolean(links && !links.error) } : {}),
    customers: (customers.data ?? []).map((row) => {
      const logo = logos.get(row.id);
      const customer: HubFileCustomer = { ...toCustomer(row), kind: row.kind === "freelancer" ? "freelancer" : "customer" };
      if (logo) customer.logo = logo;
      if (canManage) customer.freelancerIds = linkRows.filter((link) => link.customer_id === row.id).map((link) => link.freelancer_id);
      return customer;
    }),
    folders: (folders.data ?? []).map((row): HubFolder => ({ id: row.id, customerId: row.customer_id, name: row.name })),
    files: (files.data ?? []).map((row): HubStoredFile => ({
      id: row.id,
      title: row.title,
      fileName: row.file_name,
      category: isFileCategory(row.category) ? row.category : "other",
      description: row.description,
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes),
      sha256: row.sha256,
      createdAt: row.created_at,
      customers: (row.hub_file_assignments ?? []).flatMap((assignment) => assignment.customer ? [toCustomer(assignment.customer)] : [])
        .sort((a, b) => a.customerNumber.localeCompare(b.customerNumber)),
      folderIds: Object.fromEntries((row.hub_file_assignments ?? []).flatMap((assignment) => assignment.customer && assignment.folder_id ? [[assignment.customer.id, assignment.folder_id]] : [])),
      audiences: Object.fromEntries((row.hub_file_assignments ?? []).flatMap((assignment) => assignment.customer && isFileAudience(assignment.audience) && assignment.audience !== "both" ? [[assignment.customer.id, assignment.audience]] : [])),
    })),
  };
}

/**
 * The number next to "Asset Management" / "Dateien" in the sidebar: every file for admins, the assigned ones for
 * customers (RLS counts).
 */
export async function countHubFiles() {
  const supabase = await createClient();
  const { count, error } = await supabase.from("hub_files").select("id", { count: "exact", head: true });
  return error ? undefined : count ?? 0;
}
