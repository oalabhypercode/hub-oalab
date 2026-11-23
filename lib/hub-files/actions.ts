"use server";

import { refreshWorkspace } from "@/lib/refresh-workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkUpload, cleanFolderName, HUB_FILES_BUCKET, isFileCategory, MAX_UPLOAD_BATCH, storageSafeName, uploadType } from "./catalog";
import { cleanName, MAX_FILE_NAME, MAX_NAME, nameBase, nameExtension } from "./naming";
import { isFileAudience, type FileAudience } from "./types";
import { secondFactorMissing } from "@/lib/hub-auth/second-factor";
import { fileNotice } from "@/lib/hub-notify/rules";
import { notifyFileShared, notifyFilesShared } from "@/lib/hub-notify/server";
import { verifyHubAdmin } from "@/lib/hub-users/server";

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

function cleanFileIds(value: unknown) {
  return Array.isArray(value) ? Array.from(new Set(value.filter((id): id is string => typeof id === "string" && uuid.test(id)))).slice(0, MAX_UPLOAD_BATCH * 10) : [];
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
  // The download name may be a new one ("Namen nach Muster"); its extension stays the one of the stored file.
  const fileName = cleanName(input?.fileName, MAX_FILE_NAME);
  // The browser's type, else the one of the stored file's name (the same rule as the upload in the browser).
  const mimeType = uploadType(path, /^[\w.+-]+\/[\w.+-]+$/.test(String(input?.mimeType ?? "")) ? String(input.mimeType) : "");
  const sha256 = typeof input?.sha256 === "string" && /^[0-9a-f]{64}$/.test(input.sha256) ? input.sha256 : null;
  if (!uploadPath.test(path) || !title || !nameBase(fileName) || !isFileCategory(input?.category)) return { ok: false, error: "Bitte Titel, Kategorie und Datei angeben." };
  if (nameExtension(fileName) !== nameExtension(path)) {
    await supabase.storage.from(HUB_FILES_BUCKET).remove([path]);
    return { ok: false, error: "Die Dateiendung darf sich beim Umbenennen nicht ändern." };
  }

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
    await notifyFileShared(data.id, customerIds, fileNotice(title, data.id));
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
    if (file.data) await notifyFileShared(fileId, added, fileNotice(file.data.title, fileId));
  }
  refreshWorkspace();
  return { ok: true, data: { count: wanted.length } };
}

/**
 * Admin: several files to one customer at once (Zuordnen and drag & drop, user 19.11.2026). The files keep their other
 * customers; with `from` and `move` they leave that customer. A chosen folder applies to every file; without one, files
 * already there keep theirs and the others land in „Ohne Ordner“. Coming from another customer, „Sichtbar für“ moves
 * along, so a working file only for freelancers stays hidden from the new customer. Whoever newly sees files gets one
 * line in the bell for all of them.
 */
export async function assignFiles(input: { fileIds: string[]; customerId: string; folderId: string | null; from?: string | null; move?: boolean }): Promise<ActionResult<{ added: number; moved: number }>> {
  const supabase = await adminClient();
  if (!supabase) return denied;
  const ids = cleanFileIds(input?.fileIds);
  const customerId = String(input?.customerId ?? "");
  const folderId = input?.folderId ? String(input.folderId) : null;
  const from = input?.from ? String(input.from) : null;
  if (!ids.length || !uuid.test(customerId) || (folderId !== null && !uuid.test(folderId)) || (from !== null && !uuid.test(from))) return { ok: false, error: "Bitte Dateien und einen Kunden wählen." };
  if (from === customerId) return { ok: false, error: "Die Dateien liegen schon bei diesem Kunden." };

  const [files, current] = await Promise.all([
    supabase.from("hub_files").select("id, title").in("id", ids).returns<{ id: string; title: string }[]>(),
    supabase.from("hub_file_assignments").select("file_id, customer_id, audience").in("file_id", ids).in("customer_id", from ? [customerId, from] : [customerId])
      .returns<{ file_id: string; customer_id: string; audience: string }[]>(),
  ]);
  if (files.error || current.error) return { ok: false, error: "Die Dateien konnten nicht gelesen werden." };
  if ((files.data ?? []).length < ids.length) return { ok: false, error: "Mindestens eine Datei gibt es nicht mehr. Bitte die Auswahl prüfen." };
  const there = new Set((current.data ?? []).filter((row) => row.customer_id === customerId).map((row) => row.file_id));
  const fromAudience = new Map((current.data ?? []).filter((row) => row.customer_id === from).map((row) => [row.file_id, row.audience]));
  const added = ids.filter((id) => !there.has(id));

  if (added.length) {
    const { error } = await supabase.from("hub_file_assignments").insert(added.map((fileId) => ({ file_id: fileId, customer_id: customerId, folder_id: folderId })));
    if (error) return { ok: false, error: error.code === "23503" ? "Diesen Kunden oder Ordner gibt es nicht mehr. Bitte die Seite neu laden." : "Die Dateien konnten nicht zugeordnet werden." };
  }
  if (folderId && there.size) {
    const { error } = await supabase.from("hub_file_assignments").update({ folder_id: folderId }).eq("customer_id", customerId).in("file_id", [...there]);
    if (error) return { ok: false, error: "Die Dateien sind zugeordnet, aber nicht alle liegen im gewählten Ordner." };
  }
  // Browsers may not write „Sichtbar für“, so the server copies it with the service role (as in setFileAudience).
  const carried = new Map<string, string[]>();
  for (const id of added) {
    const audience = fromAudience.get(id);
    if (audience && isFileAudience(audience)) carried.set(audience, [...(carried.get(audience) ?? []), id]);
  }
  if (carried.size) {
    const db = createAdminClient();
    let copied = Boolean(db);
    for (const [audience, fileIds] of carried) {
      if (!db) break;
      const { error } = await db.from("hub_file_assignments").update({ audience }).eq("customer_id", customerId).in("file_id", fileIds);
      if (error) copied = false;
    }
    if (!copied) {
      refreshWorkspace();
      return { ok: false, error: "Die Dateien sind zugeordnet, aber „Sichtbar für“ ließ sich nicht übernehmen. Bitte in den Details prüfen; der Kunde hat noch keine Meldung bekommen." };
    }
  }
  let moved = 0;
  if (from && input?.move) {
    const { data, error } = await supabase.from("hub_file_assignments").delete().eq("customer_id", from).in("file_id", ids).select("file_id");
    if (error) {
      refreshWorkspace();
      return { ok: false, error: "Die Dateien sind zugeordnet, liegen aber noch beim bisherigen Kunden." };
    }
    moved = data?.length ?? 0;
  }
  const titles = new Map((files.data ?? []).map((file) => [file.id, file.title]));
  await notifyFilesShared(added.map((id) => ({ id, title: titles.get(id) ?? "Datei" })), customerId);
  refreshWorkspace();
  return { ok: true, data: { added: added.length, moved } };
}

/**
 * Admin: who sees a file at one customer: the customer and their freelancers, only the customer or only the
 * freelancers. Browsers may not write this column, so the server does it with the service role after checking the
 * admin. Whoever newly sees the file gets a notice.
 */
export async function setFileAudience(fileId: string, customerId: string, audience: FileAudience): Promise<ActionResult<null>> {
  if (!uuid.test(String(fileId ?? "")) || !uuid.test(String(customerId ?? "")) || !isFileAudience(audience)) return { ok: false, error: "Unbekannte Datei oder Auswahl." };
  const db = await verifyHubAdmin() ? createAdminClient() : null;
  if (!db) return denied;
  const current = await db.from("hub_file_assignments").select("audience").eq("file_id", fileId).eq("customer_id", customerId).maybeSingle<{ audience: string }>();
  if (current.error || !current.data) return { ok: false, error: current.error?.code === "42703" ? "„Sichtbar für“ ist in der Datenbank noch nicht eingerichtet." : "Die Datei liegt nicht mehr bei diesem Kunden." };
  const { error } = await db.from("hub_file_assignments").update({ audience }).eq("file_id", fileId).eq("customer_id", customerId);
  if (error) return { ok: false, error: "Die Sichtbarkeit konnte nicht gespeichert werden." };
  const before = current.data.audience;
  const newly = { customer: before === "freelancer" && audience !== "freelancer", freelancer: before === "customer" && audience !== "customer" };
  if (newly.customer || newly.freelancer) {
    const file = await db.from("hub_files").select("title").eq("id", fileId).maybeSingle<{ title: string }>();
    if (file.data) await notifyFileShared(fileId, [customerId], fileNotice(file.data.title, fileId), newly);
  }
  refreshWorkspace();
  return { ok: true, data: null };
}

/** Admin: a file's title, category and description. Customers get no notice for this. */
export async function updateFileDetails(fileId: string, input: { title: string; category: string; description: string }): Promise<ActionResult<{ title: string }>> {
  const supabase = await adminClient();
  if (!supabase) return denied;
  if (!uuid.test(String(fileId ?? ""))) return { ok: false, error: "Unbekannte Datei." };
  const title = String(input?.title ?? "").trim().slice(0, 200);
  const description = String(input?.description ?? "").trim().slice(0, 2000);
  if (!title || !isFileCategory(input?.category)) return { ok: false, error: "Bitte Titel und Kategorie angeben." };
  const { data, error } = await supabase.from("hub_files").update({ title, category: input.category, description }).eq("id", fileId).select("title").maybeSingle<{ title: string }>();
  if (error || !data) return { ok: false, error: "Die Angaben konnten nicht gespeichert werden." };
  refreshWorkspace();
  return { ok: true, data: { title: data.title } };
}

export type FileRename = { id: string; title: string; fileName: string };

/**
 * Admin: new titles and download names for several files at once ("Umbenennen" in the selection, user 13.11.2026).
 * The extension stays, the stored bytes keep their place (so nothing moves), and customers get no notice.
 */
export async function renameFiles(input: FileRename[]): Promise<ActionResult<{ count: number }>> {
  const supabase = await adminClient();
  if (!supabase) return denied;
  const wanted = new Map<string, { title: string; fileName: string }>();
  for (const item of Array.isArray(input) ? input.slice(0, MAX_UPLOAD_BATCH * 10) : []) {
    const id = String(item?.id ?? "");
    const title = cleanName(item?.title, MAX_NAME);
    const fileName = cleanName(item?.fileName, MAX_FILE_NAME);
    if (!uuid.test(id) || !title || !nameBase(fileName)) return { ok: false, error: "Bitte jeder Datei einen Namen geben." };
    wanted.set(id, { title, fileName });
  }
  if (!wanted.size) return { ok: false, error: "Bitte Dateien auswählen." };
  const current = await supabase.from("hub_files").select("id, file_name").in("id", [...wanted.keys()]).returns<{ id: string; file_name: string }[]>();
  if (current.error) return { ok: false, error: "Die Dateien konnten nicht gelesen werden." };
  if ((current.data ?? []).length < wanted.size) return { ok: false, error: "Mindestens eine Datei gibt es nicht mehr. Bitte die Auswahl prüfen." };
  if ((current.data ?? []).some((row) => nameExtension(row.file_name) !== nameExtension(wanted.get(row.id)?.fileName ?? ""))) {
    return { ok: false, error: "Die Dateiendung darf sich beim Umbenennen nicht ändern." };
  }
  // A few at a time: each file has its own new name, and one failure must not stop the others unseen.
  const changes = [...wanted.entries()];
  let count = 0;
  for (let index = 0; index < changes.length; index += 8) {
    const results = await Promise.all(changes.slice(index, index + 8).map(([id, change]) =>
      supabase.from("hub_files").update({ title: change.title, file_name: change.fileName }).eq("id", id).select("id").maybeSingle()));
    count += results.filter((result) => !result.error && result.data).length;
  }
  refreshWorkspace();
  if (count < wanted.size) return { ok: false, error: `${count} von ${wanted.size} Dateien umbenannt. Die übrigen ließen sich nicht ändern.` };
  return { ok: true, data: { count } };
}

/** Admin: deletes files for good. The records go first, their assignments with them, then the stored bytes. */
export async function deleteFiles(fileIds: string[]): Promise<ActionResult<{ count: number }>> {
  const supabase = await adminClient();
  if (!supabase) return denied;
  const ids = cleanFileIds(fileIds);
  if (!ids.length) return { ok: false, error: "Bitte Dateien auswählen." };
  const { data, error } = await supabase.from("hub_files").delete().in("id", ids).select("storage_path");
  if (error) return { ok: false, error: "Die Dateien konnten nicht gelöscht werden." };
  // Without its record nobody reaches a file's bytes any more; removing them frees the space.
  const paths = (data ?? []).map((row) => row.storage_path as string);
  if (paths.length) await supabase.storage.from(HUB_FILES_BUCKET).remove(paths);
  refreshWorkspace();
  return { ok: true, data: { count: paths.length } };
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
  const ids = cleanFileIds(fileIds);
  if (!ids.length || !uuid.test(String(customerId ?? "")) || (folderId !== null && !uuid.test(String(folderId)))) return { ok: false, error: "Bitte Dateien und einen Ordner wählen." };
  const { data, error } = await session.supabase.from("hub_file_assignments").update({ folder_id: folderId }).eq("customer_id", customerId).in("file_id", ids).select("file_id");
  if (error) return { ok: false, error: error.code === "23503" ? "Dieser Ordner gehört zu einem anderen Kunden." : "Die Dateien konnten nicht verschoben werden." };
  refreshWorkspace();
  return { ok: true, data: { count: data?.length ?? 0 } };
}
