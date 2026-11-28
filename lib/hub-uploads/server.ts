import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NO_UPLOADS, type HubUpload, type HubUploadsState } from "./types";

/*
 * What the Asset Management shows of the customers' upload area. The session reads the rows, so the database decides
 * who sees what: customers the uploads of their customer, admins all of them. Before the database knows the upload area
 * (service-oalab 202611280001) the state says `ready: false` and the hub shows nothing of it.
 */

type UploadRow = { id: string; customer_id: string; file_name: string; mime_type: string; size_bytes: number; status: "uploading" | "waiting"; uploaded_by: string | null; created_at: string; completed_at: string | null; expires_at: string | null };

const missing = (error: { code?: string; message?: string } | null) => Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST202" || /hub_uploads|hub_upload_|schema cache/i.test(error.message ?? "")));
const time = (value: string | null) => (value ? Date.parse(value) : null);

export async function loadHubUploads(): Promise<HubUploadsState> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return NO_UPLOADS;
  const role = (claims.claims.app_metadata as Record<string, unknown> | undefined)?.app_role;
  const admin = role === "oalab_admin";
  if (role === "oalab_freelancer") return NO_UPLOADS;

  const rows = await supabase.from("hub_uploads")
    .select("id, customer_id, file_name, mime_type, size_bytes, status, uploaded_by, created_at, completed_at, expires_at")
    .order("created_at", { ascending: false })
    .returns<UploadRow[]>();
  if (rows.error) return missing(rows.error) ? NO_UPLOADS : { ...NO_UPLOADS, ready: true, error: "Der Upload-Bereich konnte nicht geladen werden." };

  // Who uploaded: colleagues of the same company for customers, everyone for admins. Names come from the profiles.
  const uploaderIds = [...new Set((rows.data ?? []).map((row) => row.uploaded_by).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  const db = createAdminClient();
  if (db && uploaderIds.length) {
    const { data } = await db.from("hub_profiles").select("user_id, first_name, last_name").in("user_id", uploaderIds).returns<{ user_id: string; first_name: string; last_name: string }[]>();
    for (const profile of data ?? []) names.set(profile.user_id, `${profile.first_name} ${profile.last_name}`.trim());
  }
  const uploads: HubUpload[] = (rows.data ?? []).map((row) => ({
    id: row.id,
    customerId: row.customer_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    status: row.status,
    uploader: row.uploaded_by ? names.get(row.uploaded_by) ?? "" : "",
    createdAt: Date.parse(row.created_at),
    completedAt: time(row.completed_at),
    expiresAt: time(row.expires_at),
  }));

  if (admin) {
    const [settings, customers] = await Promise.all([
      supabase.from("hub_upload_settings").select("default_limit_bytes, total_limit_bytes").maybeSingle<{ default_limit_bytes: number; total_limit_bytes: number }>(),
      supabase.from("hub_customers").select("id, upload_limit_bytes").returns<{ id: string; upload_limit_bytes: number | null }[]>(),
    ]);
    return {
      ready: true,
      uploads,
      customerId: null,
      space: null,
      settings: settings.data ? { defaultLimit: Number(settings.data.default_limit_bytes), totalLimit: Number(settings.data.total_limit_bytes) } : null,
      limits: Object.fromEntries((customers.data ?? []).map((row) => [row.id, row.upload_limit_bytes === null ? null : Number(row.upload_limit_bytes)])),
    };
  }

  // Customers upload for their own company (a login of several companies: the first of them, by customer number).
  const { data: own } = await supabase.from("hub_customers").select("id, kind, archived_at").order("customer_number").returns<{ id: string; kind: string; archived_at: string | null }[]>();
  const customer = (own ?? []).find((row) => row.kind === "customer" && !row.archived_at);
  if (!customer) return { ...NO_UPLOADS, ready: true, uploads };
  const space = await supabase.rpc("hub_upload_space", { p_customer: customer.id });
  const value = space.data as { used: number; limit: number; maxFile: number } | null;
  return {
    ready: true,
    uploads: uploads.filter((upload) => upload.customerId === customer.id),
    customerId: customer.id,
    space: value ? { used: Number(value.used), limit: Number(value.limit), maxFile: Number(value.maxFile) } : null,
    settings: null,
    limits: {},
  };
}
