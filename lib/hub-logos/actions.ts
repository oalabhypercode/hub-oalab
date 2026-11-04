"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { HUB_FILES_BUCKET } from "@/lib/hub-files/catalog";
import type { ActionResult } from "@/lib/hub-files/actions";
import { canBeLogo, checkLogoFile, cleanLogoColor, DEFAULT_BRAND_COLOR, isLogoBackground, isLogoPathOf, LOGO_BUCKET, MAX_LOGO_BYTES, newLogoPath } from "./rules";

// Every action is a public POST endpoint: each one first asks the database whether this is an active admin.
// Row Level Security and the storage policies of the migration enforce the same a second time.

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const denied = { ok: false as const, error: "Logos kann nur ein echter Admin-Login ändern." };
const MISSING = "Kundenlogos sind in Supabase noch nicht eingerichtet. Die Migration steht noch aus.";

async function adminSession() {
  const admin = await verifyHubAdmin();
  return admin ? { supabase: await createClient(), userId: admin.userId } : null;
}

const missingSetup = (error: { code?: string; message?: string }) => error.code === "42703" || /logo_|hub-logos|bucket not found|schema cache/i.test(error.message ?? "");

type CandidateRow = { id: string; title: string | null; file_name: string; mime_type: string; size_bytes: number; storage_path: string };

/**
 * Images of one customer that may become its logo (newest first, at most 12), each with a preview link for a minute,
 * so the logo window needs nothing but the customer, from the asset management and from the user management alike.
 */
export async function listLogoCandidates(customerId: string): Promise<ActionResult<{ id: string; title: string; url: string | null }[]>> {
  const session = await adminSession();
  if (!session) return denied;
  if (!uuid.test(String(customerId ?? ""))) return { ok: false, error: "Unbekannter Kunde." };
  const { data, error } = await session.supabase
    .from("hub_files")
    .select("id, title, file_name, mime_type, size_bytes, storage_path, hub_file_assignments!inner(customer_id)")
    .eq("hub_file_assignments.customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(60)
    .returns<CandidateRow[]>();
  if (error) return { ok: false, error: "Die Dateien des Kunden konnten nicht gelesen werden." };
  const rows = (data ?? []).filter((row) => canBeLogo({ fileName: row.file_name, mimeType: row.mime_type, sizeBytes: Number(row.size_bytes) })).slice(0, 12);
  if (!rows.length) return { ok: true, data: [] };
  const signed = await session.supabase.storage.from(HUB_FILES_BUCKET).createSignedUrls(rows.map((row) => row.storage_path), 60);
  const urls = new Map((signed.data ?? []).flatMap((item) => item.signedUrl && item.path ? [[item.path, item.signedUrl]] : []));
  return { ok: true, data: rows.map((row) => ({ id: row.id, title: row.title || row.file_name, url: urls.get(row.storage_path) ?? null })) };
}

/** New image, step 1: check it and hand out a one-time upload link into the customer's logo folder. */
export async function prepareLogoUpload(customerId: string, fileName: string, sizeBytes: number, mimeType: string): Promise<ActionResult<{ path: string; token: string }>> {
  const session = await adminSession();
  if (!session) return denied;
  if (!uuid.test(String(customerId ?? ""))) return { ok: false, error: "Unbekannter Kunde." };
  const check = checkLogoFile(String(fileName ?? ""), Number(sizeBytes), String(mimeType ?? ""));
  if (!check.ok) return check;
  const { data, error } = await session.supabase.storage.from(LOGO_BUCKET).createSignedUploadUrl(newLogoPath(customerId, check.type));
  if (error || !data) return { ok: false, error: error && missingSetup(error) ? MISSING : "Das Hochladen konnte nicht vorbereitet werden." };
  return { ok: true, data: { path: data.path, token: data.token } };
}

/** The uploaded object as storage reports it, so neither size nor existence rests on the browser's word. */
async function isStoredLogo(supabase: SupabaseClient, path: string) {
  const folder = path.slice(0, path.lastIndexOf("/"));
  const name = path.slice(path.lastIndexOf("/") + 1);
  const { data } = await supabase.storage.from(LOGO_BUCKET).list(folder, { search: name });
  const size = Number((data?.find((item) => item.name === name)?.metadata as { size?: number } | undefined)?.size);
  return Number.isFinite(size) && size > 0 && size <= MAX_LOGO_BYTES;
}

/** One of the customer's image files becomes a copy in the logo folder, typed by the file it came from. */
async function copyFileAsLogo(supabase: SupabaseClient, customerId: string, fileId: string): Promise<ActionResult<string>> {
  if (!uuid.test(fileId)) return { ok: false, error: "Unbekannte Datei." };
  const { data: file } = await supabase
    .from("hub_files")
    .select("storage_path, file_name, mime_type, size_bytes, hub_file_assignments!inner(customer_id)")
    .eq("id", fileId)
    .eq("hub_file_assignments.customer_id", customerId)
    .maybeSingle<{ storage_path: string; file_name: string; mime_type: string; size_bytes: number }>();
  if (!file) return { ok: false, error: "Diese Datei gehört nicht zu diesem Kunden." };
  const check = checkLogoFile(file.file_name, Number(file.size_bytes), file.mime_type);
  if (!check.ok) return check;
  const bytes = await supabase.storage.from(HUB_FILES_BUCKET).download(file.storage_path);
  if (bytes.error || !bytes.data) return { ok: false, error: "Die Datei konnte nicht gelesen werden." };
  const path = newLogoPath(customerId, check.type);
  const { error } = await supabase.storage.from(LOGO_BUCKET).upload(path, bytes.data, { contentType: check.type, upsert: false });
  if (error) return { ok: false, error: missingSetup(error) ? MISSING : "Das Bild konnte nicht als Logo abgelegt werden." };
  return { ok: true, data: path };
}

type LogoSource = { kind: "upload"; path: string } | { kind: "file"; fileId: string } | { kind: "keep" };

/** New image, step 2 (or only a new background): it becomes the customer's logo, the previous image is deleted. */
export async function saveCustomerLogo(input: { customerId: string; source: LogoSource; background: string; color?: string | null }): Promise<ActionResult<null>> {
  const session = await adminSession();
  if (!session) return denied;
  const { supabase, userId } = session;
  const customerId = String(input?.customerId ?? "");
  if (!uuid.test(customerId)) return { ok: false, error: "Unbekannter Kunde." };
  const background = isLogoBackground(input?.background) ? input.background : "light";
  const color = background === "brand" ? cleanLogoColor(input?.color) ?? DEFAULT_BRAND_COLOR : null;

  const current = await supabase.from("hub_customers").select("logo_path").eq("id", customerId).maybeSingle<{ logo_path: string | null }>();
  if (current.error) return { ok: false, error: missingSetup(current.error) ? MISSING : "Der Kunde konnte nicht gelesen werden." };
  if (!current.data) return { ok: false, error: "Unbekannter Kunde." };
  const previous = current.data.logo_path;

  let path = previous;
  const source = input?.source;
  if (source?.kind === "upload") {
    path = String(source.path ?? "");
    if (!isLogoPathOf(path, customerId) || !await isStoredLogo(supabase, path)) return { ok: false, error: "Das hochgeladene Bild wurde nicht gefunden. Bitte erneut versuchen." };
  } else if (source?.kind === "file") {
    const copied = await copyFileAsLogo(supabase, customerId, String(source.fileId ?? ""));
    if (!copied.ok) return copied;
    path = copied.data;
  }
  if (!path) return { ok: false, error: "Bitte zuerst ein Bild wählen." };

  const { data, error } = await supabase.from("hub_customers").update({ logo_path: path, logo_background: background, logo_color: color, updated_by: userId }).eq("id", customerId).select("id").maybeSingle();
  if (error || !data) {
    if (path !== previous) await supabase.storage.from(LOGO_BUCKET).remove([path]);
    return { ok: false, error: error && missingSetup(error) ? MISSING : "Das Logo konnte nicht gespeichert werden." };
  }
  // Nothing points to the previous image any more; deleting it also ends every link handed out for it.
  if (previous && previous !== path) await supabase.storage.from(LOGO_BUCKET).remove([previous]);
  refreshWorkspace();
  return { ok: true, data: null };
}

/** "Buchstaben verwenden": the customer shows the initials again and the image is deleted. */
export async function removeCustomerLogo(customerId: string): Promise<ActionResult<null>> {
  const session = await adminSession();
  if (!session) return denied;
  const { supabase, userId } = session;
  if (!uuid.test(String(customerId ?? ""))) return { ok: false, error: "Unbekannter Kunde." };
  const current = await supabase.from("hub_customers").select("logo_path").eq("id", customerId).maybeSingle<{ logo_path: string | null }>();
  if (current.error || !current.data) return { ok: false, error: current.error && missingSetup(current.error) ? MISSING : "Unbekannter Kunde." };
  const { data, error } = await supabase.from("hub_customers").update({ logo_path: null, logo_background: "light", logo_color: null, updated_by: userId }).eq("id", customerId).select("id").maybeSingle();
  if (error || !data) return { ok: false, error: "Das Logo konnte nicht entfernt werden." };
  if (current.data.logo_path) await supabase.storage.from(LOGO_BUCKET).remove([current.data.logo_path]);
  refreshWorkspace();
  return { ok: true, data: null };
}
