import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import { fileNotice } from "@/lib/hub-notify/rules";
import { notifyFileShared, notifyFilesShared } from "@/lib/hub-notify/server";
import { MAX_UPLOAD_BATCH } from "./catalog";
import { cleanName, MAX_FILE_NAME, MAX_NAME, nameBase, nameExtension } from "./naming";
import { isFileAudience, type FileAudience } from "./types";

// What the Asset Management writes once the caller is checked as an admin, shared by its actions
// (lib/hub-files/actions.ts, the admin's own session) and the Claude connector (lib/hub-mcp/area-writes.ts, the admin's
// claims): assigning files to a customer (with a folder, „Sichtbar für“ carried along and one notice), who sees a file
// at a customer, and renaming. „Sichtbar für“ is written with the service role, as browsers may not write it.
// Uploading and deleting stay with the actions. Refreshing the page is the caller's business.

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
/** The admin's own session, or the connector's key with the admin's claims. */
export type FileClient = Awaited<ReturnType<typeof createClient>>;
export type FileRename = { id: string; title: string; fileName: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanFileIds(value: unknown) {
  return Array.isArray(value) ? Array.from(new Set(value.filter((id): id is string => typeof id === "string" && uuid.test(id)))).slice(0, MAX_UPLOAD_BATCH * 10) : [];
}

/**
 * Several files to one customer at once (Zuordnen and drag & drop, user 19.11.2026). The files keep their other
 * customers; with `from` and `move` they leave that customer. A chosen folder applies to every file; without one, files
 * already there keep theirs and the others land in „Ohne Ordner“. Coming from another customer, „Sichtbar für“ moves
 * along, so a working file only for freelancers stays hidden from the new customer. Whoever newly sees files gets one
 * line in the bell for all of them.
 */
export async function assignFilesAs(supabase: FileClient, input: { fileIds: string[]; customerId: string; folderId: string | null; from?: string | null; move?: boolean }): Promise<ActionResult<{ added: number; moved: number }>> {
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
      return { ok: false, error: "Die Dateien sind zugeordnet, aber „Sichtbar für“ ließ sich nicht übernehmen. Bitte in den Details prüfen; der Kunde hat noch keine Meldung bekommen." };
    }
  }
  let moved = 0;
  if (from && input?.move) {
    const { data, error } = await supabase.from("hub_file_assignments").delete().eq("customer_id", from).in("file_id", ids).select("file_id");
    if (error) {
      return { ok: false, error: "Die Dateien sind zugeordnet, liegen aber noch beim bisherigen Kunden." };
    }
    moved = data?.length ?? 0;
  }
  const titles = new Map((files.data ?? []).map((file) => [file.id, file.title]));
  await notifyFilesShared(added.map((id) => ({ id, title: titles.get(id) ?? "Datei" })), customerId);
  return { ok: true, data: { added: added.length, moved } };
}

/**
 * Who sees a file at one customer: the customer and their freelancers, only the customer or only the freelancers,
 * written with the service role. Whoever newly sees the file gets a notice.
 */
export async function setFileAudienceAs(db: NonNullable<ReturnType<typeof createAdminClient>>, fileId: string, customerId: string, audience: FileAudience): Promise<ActionResult<null>> {
  if (!uuid.test(String(fileId ?? "")) || !uuid.test(String(customerId ?? "")) || !isFileAudience(audience)) return { ok: false, error: "Unbekannte Datei oder Auswahl." };
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
  return { ok: true, data: null };
}

/** New titles and download names for files; the extension stays, the stored file too, and nobody gets a notice. */
export async function renameFilesAs(supabase: FileClient, input: FileRename[]): Promise<ActionResult<{ count: number }>> {
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
  if (count < wanted.size) return { ok: false, error: `${count} von ${wanted.size} Dateien umbenannt. Die übrigen ließen sich nicht ändern.` };
  return { ok: true, data: { count } };
}
