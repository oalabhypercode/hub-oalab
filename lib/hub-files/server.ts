import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isFileCategory } from "./catalog";
import type { HubFileCustomer, HubFilesState, HubStoredFile } from "./types";

type CustomerRow = { id: string; customer_number: string; company: string };
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
  hub_file_assignments: { customer: CustomerRow | null }[] | null;
};

const toCustomer = (row: CustomerRow): HubFileCustomer => ({ id: row.id, customerNumber: row.customer_number, company: row.company });

export function describeStorageError(error: { code?: string; message?: string }) {
  if (error.code === "42P01" || error.code === "PGRST205" || /hub_files|schema cache/i.test(error.message ?? "")) {
    return "Die Dateiablage ist in Supabase noch nicht eingerichtet. Die Migration steht noch aus.";
  }
  return "Die Dateien konnten gerade nicht geladen werden. Bitte versuche es erneut.";
}

/**
 * Files visible to the signed-in Supabase user. Row Level Security decides:
 * admins see every file and customer, customers only files assigned to their customer.
 * Public demo identities never reach this function (they have no Supabase session).
 */
export async function loadHubFiles(): Promise<HubFilesState> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const canManage = (claims?.claims.app_metadata as Record<string, unknown> | undefined)?.app_role === "oalab_admin";
  const [files, customers] = await Promise.all([
    supabase
      .from("hub_files")
      .select("id, title, file_name, category, description, mime_type, size_bytes, sha256, created_at, hub_file_assignments(customer:hub_customers(id, customer_number, company))")
      .order("created_at", { ascending: false })
      .returns<FileRow[]>(),
    supabase.from("hub_customers").select("id, customer_number, company").order("customer_number").returns<CustomerRow[]>(),
  ]);
  if (files.error) return { source: "supabase", files: [], customers: [], canManage, error: describeStorageError(files.error) };
  return {
    source: "supabase",
    canManage,
    customers: (customers.data ?? []).map(toCustomer),
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
    })),
  };
}

/** Real files for a signed-in Supabase user; public demo identities keep their fixtures. */
export async function loadFilesForIdentity(identity: { publicDemo: boolean }) {
  return identity.publicDemo ? undefined : loadHubFiles();
}
