"use server";

import { refreshWorkspace } from "@/lib/refresh-workspace";
import { createClient } from "@/lib/supabase/server";
import { checkUpload, cleanFolderName, HUB_FILES_BUCKET, isFileCategory, MAX_UPLOAD_BATCH, storageSafeName } from "./catalog";
import { secondFactorMissing } from "@/lib/hub-auth/second-factor";
import { fileNotice } from "@/lib/hub-notify/rules";
import { notifyCustomers } from "@/lib/hub-notify/server";

// Every action is a public POST endpoint: authenticate and authorise inside each one.
// Row Level Security in Supabase enforces the same rules a second time.

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uploadPath = /^files\/[0-9a-f-]{36}\/[a-z0-9.-]{1,96}$/;

async function signedInClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  // A login with the e-mail code acts only after confirming it.
  if (await secondFactorMissing(supabase, data.claims.aal)) return null;
  const appMetadata = data.claims.app_metadata as Record<string, unknown> | undefined;
  return { supabase, admin: appMetadata?.app_role === "oalab_admin" };
}

async function adminClient() {
  const session = await signedInClient();
  return session?.admin ? session.supabase : null;
}

const denied = { ok: false as const, error: "Dafür brauchst du einen echten Admin-Login." };

function cleanCustomerIds(value: unknown) {
  return Array.isArray(value) ? Array.from(new Set(value.filter((id): id is string => typeof id === "string" && uuid.test(id)))).slice(0, 200) : [];
}

/** Step 1 (admin): validate the file and issue a one-time signed upload URL for a fresh storage path. */
export async function prepareUpload(fileName: string, sizeBytes: number): Promise<ActionResult<{ path: string; token: string }>> {
  const supabase = await adminClient();
  if (!supabase) return denied;
  const check = checkUpload(String(fileName ?? ""), Number(sizeBytes));
  if (!check.ok) return check;
  const path = `files/${crypto.randomUUID()}/${storageSafeName(fileName)}`;
  const { data, error } = await supabase.storage.from(HUB_FILES_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "Der Upload konnte nicht vorbereitet werden. Ist die Dateiablage eingerichtet?" };
  return { ok: true, data: { path: data.path, token: data.token } };
}

type FinalizeInput = {
  path: string;
  fileName: string;
  title: string;
  category: string;
  description: string;
  mimeType: string;
  sha256: string | null;
  customerIds: string[];
  /** Folder of the single assigned customer; ignored when the file goes to several customers or none. */
  folderId?: string | null;
};

/** Step 2 (admin): record the uploaded object with its metadata and customer assignments. */
export async function finalizeUpload(input: FinalizeInput): Promise<ActionResult<{ id: string }>> {
  const supabase = await adminClient();
  if (!supabase) return denied;
  const path = String(input?.path ?? "");
  const title = String(input?.title ?? "").trim().slice(0, 200);
  const description = String(input?.description ?? "").trim().slice(0, 2000);
  const fileName = String(input?.fileName ?? "").trim().slice(0, 255);
  const mimeType = /^[\w.+-]+\/[\w.+-]+$/.test(String(input?.mimeType ?? "")) ? String(input.mimeType) : "application/octet-stream";
  const sha256 = typeof input?.sha256 === "string" && /^[0-9a-f]{64}$/.test(input.sha256) ? input.sha256 : null;
  if (!uploadPath.test(path) || !title || !fileName || !isFileCategory(input?.category)) return { ok: false, error: "Bitte Titel, Kategorie und Datei angeben." };

  // Trust the stored object, not the browser, for the size.
  const folder = path.slice(0, path.lastIndexOf("/"));
  const name = path.slice(path.lastIndexOf("/") + 1);
  const listing = await supabase.storage.from(HUB_FILES_BUCKET).list(folder, { search: name });
  const stored = listing.data?.find((item) => item.name === name);
  const sizeBytes = Number((stored?.metadata as { size?: number } | undefined)?.size);
  if (!stored || !Number.isFinite(sizeBytes)) return { ok: false, error: "Die hochgeladene Datei wurde nicht gefunden. Bitte erneut versuchen." };

  const { data, error } = await supabase
    .from("hub_files")
    .insert({ storage_path: path, title, description, category: input.category, file_name: fileName, mime_type: mimeType, size_bytes: sizeBytes, sha256 })
    .select("id")
    .single();
  if (error || !data) {
    await supabase.storage.from(HUB_FILES_BUCKET).remove([path]);
    return { ok: false, error: "Die Datei konnte nicht gespeichert werden." };
  }
  const customerIds = cleanCustomerIds(input?.customerIds);
  const folderId = customerIds.length === 1 && uuid.test(String(input?.folderId ?? "")) ? String(input.folderId) : null;
  if (customerIds.length) {
    const assigned = await supabase.from("hub_file_assignments").insert(customerIds.map((customerId) => ({ file_id: data.id, customer_id: customerId, folder_id: folderId })));
    if (assigned.error) {
      refreshWorkspace();
      return { ok: false, error: "Die Datei ist gespeichert, aber die Zuordnung ist fehlgeschlagen. Bitte die Zuordnung erneut setzen." };
    }
    await notifyCustomers(customerIds, fileNotice(title));
  }
  refreshWorkspace();
  return { ok: true, data: { id: data.id } };
}

/** Admin: replace the customers a file is assigned to (an empty list moves it to the general store). */
export async function setFileAssignments(fileId: string, customerIds: string[]): Promise<ActionResult<{ count: number }>> {
  const supabase = await adminClient();
  if (!supabase) return denied;
  if (!uuid.test(String(fileId ?? ""))) return { ok: false, error: "Unbekannte Datei." };
  const wanted = cleanCustomerIds(customerIds);
  const current = await supabase.from("hub_file_assignments").select("customer_id").eq("file_id", fileId);
  if (current.error) return { ok: false, error: "Die Zuordnung konnte nicht gelesen werden." };
  const existing = new Set((current.data ?? []).map((row) => row.customer_id as string));
  const removed = [...existing].filter((id) => !wanted.includes(id));
  const added = wanted.filter((id) => !existing.has(id));
  if (removed.length) {
    const { error } = await supabase.from("hub_file_assignments").delete().eq("file_id", fileId).in("customer_id", removed);
    if (error) return { ok: false, error: "Die Zuordnung konnte nicht geändert werden." };
  }
  if (added.length) {
    const { error } = await supabase.from("hub_file_assignments").insert(added.map((customerId) => ({ file_id: fileId, customer_id: customerId })));
    if (error) return { ok: false, error: "Die Zuordnung konnte nicht geändert werden." };
    const file = await supabase.from("hub_files").select("title").eq("id", fileId).maybeSingle<{ title: string }>();
    if (file.data) await notifyCustomers(added, fileNotice(file.data.title));
  }
  refreshWorkspace();
  return { ok: true, data: { count: wanted.length } };
}

/** Any signed-in user: a 60-second download link to the exact stored bytes, if RLS lets them read the file. */
export async function createDownloadUrl(fileId: string): Promise<ActionResult<{ url: string }>> {
  const session = await signedInClient();
  if (!session) return { ok: false, error: "Downloads sind nur mit echtem Login möglich." };
  if (!uuid.test(String(fileId ?? ""))) return { ok: false, error: "Unbekannte Datei." };
  const { data: file } = await session.supabase.from("hub_files").select("storage_path, file_name").eq("id", fileId).maybeSingle();
  if (!file) return { ok: false, error: "Diese Datei ist für dich nicht freigegeben." };
  const { data, error } = await session.supabase.storage.from(HUB_FILES_BUCKET).createSignedUrl(file.storage_path, 60, { download: file.file_name });
  if (error || !data) return { ok: false, error: "Der Download konnte nicht gestartet werden." };
  return { ok: true, data: { url: data.signedUrl } };
}

/** Any signed-in user: 60-second links for several files at once (bulk download), only for files RLS lets them read. */
export async function createDownloadUrls(fileIds: string[]): Promise<ActionResult<{ id: string; url: string; fileName: string }[]>> {
  const session = await signedInClient();
  if (!session) return { ok: false, error: "Downloads sind nur mit echtem Login möglich." };
  const ids = Array.isArray(fileIds) ? Array.from(new Set(fileIds.filter((id) => typeof id === "string" && uuid.test(id)))).slice(0, 200) : [];
  if (!ids.length) return { ok: false, error: "Bitte Dateien auswählen." };
  const { data: files, error } = await session.supabase.from("hub_files").select("id, storage_path, file_name").in("id", ids);
  if (error || !files?.length) return { ok: false, error: "Diese Dateien sind für dich nicht freigegeben." };
  const signed = await session.supabase.storage.from(HUB_FILES_BUCKET).createSignedUrls(files.map((file) => file.storage_path as string), 60);
  if (signed.error || !signed.data) return { ok: false, error: "Der Download konnte nicht gestartet werden." };
  const urls = new Map(signed.data.flatMap((item) => item.signedUrl && item.path ? [[item.path, item.signedUrl]] : []));
  const links = files.flatMap((file) => {
    const url = urls.get(file.storage_path as string);
    return url ? [{ id: file.id as string, url, fileName: file.file_name as string }] : [];
  });
  if (links.length < ids.length) return { ok: false, error: "Mindestens eine Datei ist nicht mehr verfügbar. Bitte die Auswahl prüfen." };
  return { ok: true, data: links };
}

// Folders: one level per customer. Admins manage every customer's folders, customers those of their own
// customer (RLS); customers may only change the folder of an assignment (column grant in the migration).

function describeFolderError(error: { code?: string; message?: string }) {
  if (error.code === "23505") return "Einen Ordner mit diesem Namen gibt es schon.";
  if (error.code === "42P01" || error.code === "PGRST205" || /hub_folders|schema cache/i.test(error.message ?? "")) return "Ordner sind in Supabase noch nicht eingerichtet. Die Migration steht noch aus.";
  return "Der Ordner konnte nicht gespeichert werden.";
}

export async function createFolder(customerId: string, name: string): Promise<ActionResult<{ id: string; name: string }>> {
  const session = await signedInClient();
  if (!session) return { ok: false, error: "Ordner lassen sich nur mit echtem Login anlegen." };
  if (!uuid.test(String(customerId ?? ""))) return { ok: false, error: "Bitte zuerst einen Kunden wählen." };
  const clean = cleanFolderName(name);
  if (!clean.ok) return clean;
  const { data, error } = await session.supabase.from("hub_folders").insert({ customer_id: customerId, name: clean.name }).select("id, name").single();
  if (error || !data) return { ok: false, error: error ? describeFolderError(error) : "Der Ordner konnte nicht angelegt werden." };
  refreshWorkspace();
  return { ok: true, data: { id: data.id, name: data.name } };
}

export async function renameFolder(folderId: string, name: string): Promise<ActionResult<{ name: string }>> {
  const session = await signedInClient();
  if (!session) return { ok: false, error: "Nur mit echtem Login möglich." };
  if (!uuid.test(String(folderId ?? ""))) return { ok: false, error: "Unbekannter Ordner." };
  const clean = cleanFolderName(name);
  if (!clean.ok) return clean;
  const { data, error } = await session.supabase.from("hub_folders").update({ name: clean.name }).eq("id", folderId).select("name").maybeSingle();
  if (error || !data) return { ok: false, error: error ? describeFolderError(error) : "Diesen Ordner darfst du nicht ändern." };
  refreshWorkspace();
  return { ok: true, data: { name: data.name } };
}

/** Deletes a folder; its files move back to "Ohne Ordner" (the reference is cleared, no file is deleted). */
export async function deleteFolder(folderId: string): Promise<ActionResult<null>> {
  const session = await signedInClient();
  if (!session) return { ok: false, error: "Nur mit echtem Login möglich." };
  if (!uuid.test(String(folderId ?? ""))) return { ok: false, error: "Unbekannter Ordner." };
  const { data, error } = await session.supabase.from("hub_folders").delete().eq("id", folderId).select("id");
  if (error || !data?.length) return { ok: false, error: error ? describeFolderError(error) : "Diesen Ordner darfst du nicht löschen." };
  refreshWorkspace();
  return { ok: true, data: null };
}

/** Moves files of one customer into a folder of that customer, or back to "Ohne Ordner" with null. */
export async function moveFiles(fileIds: string[], customerId: string, folderId: string | null): Promise<ActionResult<{ count: number }>> {
  const session = await signedInClient();
  if (!session) return { ok: false, error: "Nur mit echtem Login möglich." };
  const ids = Array.isArray(fileIds) ? Array.from(new Set(fileIds.filter((id) => typeof id === "string" && uuid.test(id)))).slice(0, MAX_UPLOAD_BATCH * 10) : [];
  if (!ids.length || !uuid.test(String(customerId ?? "")) || (folderId !== null && !uuid.test(String(folderId)))) return { ok: false, error: "Bitte Dateien und einen Ordner wählen." };
  const { data, error } = await session.supabase.from("hub_file_assignments").update({ folder_id: folderId }).eq("customer_id", customerId).in("file_id", ids).select("file_id");
  if (error) return { ok: false, error: error.code === "23503" ? "Dieser Ordner gehört zu einem anderen Kunden." : "Die Dateien konnten nicht verschoben werden." };
  refreshWorkspace();
  return { ok: true, data: { count: data?.length ?? 0 } };
}
