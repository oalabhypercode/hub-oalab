"use server";

import { secondFactorMissing } from "@/lib/hub-auth/second-factor";
import { HUB_FILES_BUCKET, isFileCategory, storageSafeName, uploadType } from "@/lib/hub-files/catalog";
import { isFileAudience } from "@/lib/hub-files/types";
import { fileNotice } from "@/lib/hub-notify/rules";
import { notifyFileShared } from "@/lib/hub-notify/server";
import { multipart } from "@/lib/platform/storage";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkCustomerUpload } from "./check";
import { partCount, UPLOAD_LIMIT_CHOICES } from "./rules";

// The customers' upload area (service-oalab 202611280001_hub_customer_uploads). Every action is a public POST endpoint:
// it checks the login here, and the database checks membership, limits and admins a second time in its functions.

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_URLS = 20;
const unavailable = { ok: false as const, error: "Der Upload-Bereich ist gerade nicht erreichbar. Bitte versuch es gleich noch einmal." };
const denied = { ok: false as const, error: "Dafür brauchst du einen echten Admin-Login." };

async function signedIn() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  if (await secondFactorMissing(supabase, data.claims.aal)) return null;
  const appMetadata = data.claims.app_metadata as Record<string, unknown> | undefined;
  return { supabase, userId: String(data.claims.sub ?? ""), admin: appMetadata?.app_role === "oalab_admin" };
}

type UploadRow = { id: string; customer_id: string; storage_path: string; file_name: string; status: "uploading" | "waiting"; upload_ref: string | null; size_bytes: number; uploaded_by: string | null };
type Session = NonNullable<Awaited<ReturnType<typeof signedIn>>>;

/** The caller's own running upload (the database shows a customer only the uploads of their customer). */
async function ownRunning(session: Session, id: string) {
  if (!uuid.test(String(id ?? ""))) return null;
  const { data } = await session.supabase.from("hub_uploads").select("id, customer_id, storage_path, file_name, status, upload_ref, size_bytes, uploaded_by").eq("id", id).maybeSingle<UploadRow>();
  return data && data.status === "uploading" && data.uploaded_by === session.userId && data.upload_ref ? data : null;
}

/** Bytes go after the row: a running upload is aborted, a finished one deleted. A failure only leaves bytes the sweep finds. */
async function dropBytes(path: string, uploadRef: string | null, state: string) {
  try {
    if (state === "uploading" && uploadRef) await multipart.abort(HUB_FILES_BUCKET, path, uploadRef);
    await multipart.remove(HUB_FILES_BUCKET, path);
  } catch (error) {
    console.error("[hub-uploads] removing bytes failed", error instanceof Error ? error.message : error);
  }
}

/** Customer: reserve space for one file and start its multipart upload. */
export async function startCustomerUpload(input: { customerId: string; fileName: string; size: number; type: string }): Promise<ActionResult<{ id: string; parts: number }>> {
  const session = await signedIn();
  if (!session || session.admin) return { ok: false, error: "Hochladen können hier nur Kundinnen und Kunden." };
  const customerId = String(input?.customerId ?? "");
  const fileName = String(input?.fileName ?? "").trim();
  const size = Number(input?.size);
  if (!uuid.test(customerId)) return { ok: false, error: "Unbekannter Kunde." };
  const space = await session.supabase.rpc("hub_upload_space", { p_customer: customerId });
  if (space.error || !space.data) return unavailable;
  const check = checkCustomerUpload(fileName, size, Number((space.data as { maxFile: number }).maxFile));
  if (!check.ok) return check;
  const mimeType = uploadType(fileName, String(input?.type ?? ""));
  const begun = await session.supabase.rpc("hub_upload_begin", { p_customer: customerId, p_file_name: fileName.slice(0, 255), p_object_name: storageSafeName(fileName), p_mime_type: mimeType, p_size: size });
  if (begun.error || !begun.data) return unavailable;
  const answer = begun.data as { status: string; id?: string; path?: string; maxFile?: number };
  if (answer.status !== "ok" || !answer.id || !answer.path) {
    if (answer.status === "customer_full" || answer.status === "too_large") {
      // Another upload took the space meanwhile: say how much is left now.
      const recheck = checkCustomerUpload(fileName, size, Number(answer.maxFile ?? 0));
      return recheck.ok ? { ok: false, error: `„${fileName}“ passt gerade nicht mehr. Bitte versuch es noch einmal.` } : recheck;
    }
    if (answer.status === "server_full") return { ok: false, error: "Der Speicher für Uploads ist gerade voll. Bitte versuch es später noch einmal oder schreib oalab." };
    if (answer.status === "invalid") return { ok: false, error: "Mit diesem Dateinamen geht es nicht. Bitte benenne die Datei kürzer um." };
    return { ok: false, error: "Für deinen Zugang ist der Upload-Bereich nicht offen." };
  }
  try {
    const uploadRef = await multipart.start(HUB_FILES_BUCKET, answer.path, mimeType);
    const db = createAdminClient();
    const saved = db ? await db.from("hub_uploads").update({ upload_ref: uploadRef }).eq("id", answer.id) : { error: new Error("no service client") };
    if (saved.error) throw saved.error;
  } catch (error) {
    console.error("[hub-uploads] start failed", error instanceof Error ? error.message : error);
    await session.supabase.rpc("hub_upload_remove", { p_upload: answer.id });
    return unavailable;
  }
  return { ok: true, data: { id: answer.id, parts: partCount(size) } };
}

/** Customer: short PUT links for some parts of their running upload. */
export async function uploadPartUrls(id: string, partNumbers: number[]): Promise<ActionResult<{ urls: Record<number, string> }>> {
  const session = await signedIn();
  if (!session) return unavailable;
  const row = await ownRunning(session, id);
  if (!row) return { ok: false, error: "Diesen Upload gibt es nicht mehr." };
  const total = partCount(Number(row.size_bytes));
  const numbers = [...new Set((Array.isArray(partNumbers) ? partNumbers : []).map(Number))].filter((n) => Number.isInteger(n) && n >= 1 && n <= total).slice(0, MAX_URLS);
  if (!numbers.length) return { ok: false, error: "Diesen Teil gibt es nicht." };
  const urls: Record<number, string> = {};
  for (const number of numbers) urls[number] = await multipart.partUrl(HUB_FILES_BUCKET, row.storage_path, row.upload_ref!, number);
  return { ok: true, data: { urls } };
}

/** Customer: every part is there; the storage joins them, the database starts the 7 days and tells the admins. */
export async function finishCustomerUpload(id: string): Promise<ActionResult<null>> {
  const session = await signedIn();
  if (!session) return unavailable;
  const row = await ownRunning(session, id);
  if (!row) return { ok: false, error: "Diesen Upload gibt es nicht mehr." };
  try {
    const parts = await multipart.parts(HUB_FILES_BUCKET, row.storage_path, row.upload_ref!);
    if (!parts || parts.length !== partCount(Number(row.size_bytes))) return { ok: false, error: "Es sind nicht alle Teile angekommen. Bitte lade die Datei noch einmal hoch." };
    await multipart.complete(HUB_FILES_BUCKET, row.storage_path, row.upload_ref!, parts);
    const stored = await multipart.head(HUB_FILES_BUCKET, row.storage_path);
    const finished = await session.supabase.rpc("hub_upload_finish", { p_upload: id, p_size: stored?.size ?? 0 });
    const status = (finished.data as { status?: string } | null)?.status;
    if (finished.error || status !== "ok") {
      const removed = await session.supabase.rpc("hub_upload_remove", { p_upload: id });
      if (!removed.error) await dropBytes(row.storage_path, null, "waiting");
      return { ok: false, error: "Die Datei ist nicht vollständig angekommen. Bitte lade sie noch einmal hoch." };
    }
  } catch (error) {
    console.error("[hub-uploads] finish failed", error instanceof Error ? error.message : error);
    return unavailable;
  }
  refreshWorkspace();
  return { ok: true, data: null };
}

/** Customer (their own customer's uploads) or admin: delete an upload, finished or not. */
export async function removeUpload(id: string): Promise<ActionResult<null>> {
  const session = await signedIn();
  if (!session) return unavailable;
  if (!uuid.test(String(id ?? ""))) return { ok: false, error: "Unbekannter Upload." };
  const removed = await session.supabase.rpc("hub_upload_remove", { p_upload: id });
  const answer = removed.data as { status?: string; path?: string; uploadRef?: string | null; state?: string } | null;
  if (removed.error || answer?.status !== "ok" || !answer.path) return { ok: false, error: "Diesen Upload gibt es nicht mehr." };
  await dropBytes(answer.path, answer.uploadRef ?? null, answer.state ?? "waiting");
  refreshWorkspace();
  return { ok: true, data: null };
}

/** Customer or admin: a short link to look at or download a finished upload. */
export async function uploadFileUrl(id: string, mode: "view" | "download"): Promise<ActionResult<{ url: string }>> {
  const session = await signedIn();
  if (!session || !uuid.test(String(id ?? ""))) return unavailable;
  const { data: row } = await session.supabase.from("hub_uploads").select("storage_path, file_name, status").eq("id", id).maybeSingle<{ storage_path: string; file_name: string; status: string }>();
  if (!row || row.status !== "waiting") return { ok: false, error: "Diese Datei ist noch nicht fertig hochgeladen." };
  const { data, error } = await session.supabase.storage.from(HUB_FILES_BUCKET).createSignedUrl(row.storage_path, 120, mode === "download" ? { download: row.file_name } : undefined);
  if (error || !data) return unavailable;
  return { ok: true, data: { url: data.signedUrl } };
}

/** Admin: take a finished upload over into the customer's files (title, category, description, „Sichtbar für“, folder). */
export async function takeUpload(input: { id: string; title: string; category: string; description: string; audience: string | null; folderId: string | null }): Promise<ActionResult<{ fileId: string }>> {
  const session = await signedIn();
  if (!session?.admin) return denied;
  const id = String(input?.id ?? "");
  const title = String(input?.title ?? "").trim().slice(0, 200);
  const description = String(input?.description ?? "").trim().slice(0, 2000);
  const audience = input?.audience && isFileAudience(input.audience) ? input.audience : null;
  const folderId = uuid.test(String(input?.folderId ?? "")) ? String(input.folderId) : null;
  if (!uuid.test(id) || !title || !isFileCategory(input?.category)) return { ok: false, error: "Bitte Titel und Kategorie angeben." };
  const { data: row } = await session.supabase.from("hub_uploads").select("customer_id").eq("id", id).maybeSingle<{ customer_id: string }>();
  if (!row) return { ok: false, error: "Diesen Upload gibt es nicht mehr." };
  const taken = await session.supabase.rpc("hub_upload_take", { p_upload: id, p_title: title, p_category: input.category, p_description: description, p_audience: audience, p_folder: folderId });
  const answer = taken.data as { status?: string; fileId?: string } | null;
  if (taken.error || answer?.status !== "ok" || !answer.fileId) {
    return { ok: false, error: answer?.status === "uploading" ? "Die Datei lädt noch hoch." : "Die Datei konnte nicht übernommen werden. Ist der Ordner noch da?" };
  }
  await notifyFileShared(answer.fileId, [row.customer_id], fileNotice(title, answer.fileId));
  refreshWorkspace();
  return { ok: true, data: { fileId: answer.fileId } };
}

/** Admin: the default per customer and each customer's own limit (null: the default). */
export async function saveUploadLimits(input: { defaultLimit: number; limits: Record<string, number | null> }): Promise<ActionResult<null>> {
  const session = await signedIn();
  if (!session?.admin) return denied;
  const allowed = (value: unknown) => typeof value === "number" && UPLOAD_LIMIT_CHOICES.includes(value);
  if (!allowed(input?.defaultLimit)) return { ok: false, error: "Bitte einen Standard wählen." };
  const entries = Object.entries(input?.limits ?? {}).filter(([id, value]) => uuid.test(id) && (value === null || allowed(value))).slice(0, 500);
  const settings = await session.supabase.from("hub_upload_settings").update({ default_limit_bytes: input.defaultLimit }).eq("id", true);
  if (settings.error) return { ok: false, error: "Der Speicher konnte nicht gespeichert werden." };
  for (const [customerId, value] of entries) {
    const saved = await session.supabase.from("hub_customers").update({ upload_limit_bytes: value }).eq("id", customerId);
    if (saved.error) return { ok: false, error: "Der Speicher eines Kunden konnte nicht gespeichert werden." };
  }
  refreshWorkspace();
  return { ok: true, data: null };
}
