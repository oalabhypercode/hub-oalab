"use server";

import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import { checkUpload, fileExtension, HUB_FILES_BUCKET, storageSafeName } from "@/lib/hub-files/catalog";
import { notifyFileShared } from "@/lib/hub-notify/server";
import { fileNotice } from "@/lib/hub-notify/rules";
import {
  checkTemplateScan, contractFileName, contractTemplateIds, contractTemplates, DOCX_MIME, formatDay, isContractTemplateId, MAX_TEMPLATE_BYTES,
  parseVersionName, TEMPLATE_STAGING_PREFIX, versionFileName,
  type ContractCustomerData, type ContractTemplateId, type TemplateCheck, type TemplateVersion, type TemplateVersionKind,
} from "./catalog";
import { docxPlaceholders, looksLikeDocx, readDocx } from "./docx";
import { buildBlank, buildContract, listVersions, readActiveTemplate, readDefaultTemplate, readVersion, versionPath } from "./server";

// Every action is a public POST endpoint: each one checks for a real admin with a confirmed second factor itself.
// Row Level Security checks the writes a second time, as in the asset management; templates live in the private
// bucket, which only admins may read.

export type ContractActionResult<T> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };
export type ContractDownload = { fileName: string; base64: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uploadPath = /^files\/[0-9a-f-]{36}\/[a-z0-9.-]{1,96}$/;
const stagingPath = new RegExp(`^${TEMPLATE_STAGING_PREFIX}/[0-9a-f-]{36}\\.docx$`);
const denied = { ok: false as const, error: "Verträge erstellen und ablegen geht nur mit echtem Admin-Login." };
const unknownTemplate = { ok: false as const, error: "Diese Vorlage gibt es nicht." };
const templateUnavailable = { ok: false as const, error: "Die Vorlage konnte gerade nicht geladen werden. Bitte versuche es erneut." };
/** The customer's folder in the asset management that collects the contracts; created on first use. */
const CONTRACT_FOLDER = "Verträge";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type CustomerRow = { id: string; company: string; street: string | null; postal_code: string | null; city: string | null; website: string | null };

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const randomTag = () => randomUUID().replace(/-/g, "").slice(0, 6);
const berlinTime = (iso: string) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** The admin's own session: writes and storage access run under RLS like every upload in the asset management. */
async function adminSession() {
  return (await verifyHubAdmin()) ? createClient() : null;
}

async function readCustomer(supabase: Supabase, customerId: string) {
  const { data } = await supabase.from("hub_customers").select("id, company, street, postal_code, city, website").eq("id", customerId).maybeSingle<CustomerRow>();
  return data ?? null;
}

/** Admin: the customer master data the form starts with. */
export async function loadContractCustomer(customerId: string): Promise<ContractActionResult<ContractCustomerData>> {
  if (!uuid.test(String(customerId ?? ""))) return { ok: false, error: "Unbekannter Kunde." };
  const supabase = await adminSession();
  if (!supabase) return denied;
  const row = await readCustomer(supabase, customerId);
  if (!row) return { ok: false, error: "Diesen Kunden gibt es nicht mehr." };
  return { ok: true, data: { company: row.company, street: row.street ?? "", postalCode: row.postal_code ?? "", city: row.city ?? "", website: row.website ?? "" } };
}

/** Admin: the filled contract from the active template as a Word file to download. Nothing is stored. */
export async function createContractDocument(templateId: string, input: Record<string, string>): Promise<ContractActionResult<ContractDownload>> {
  if (!isContractTemplateId(templateId)) return unknownTemplate;
  const supabase = await adminSession();
  if (!supabase) return denied;
  const active = await readActiveTemplate(supabase, templateId);
  if (!active) return templateUnavailable;
  const built = buildContract(templateId, active.bytes, input ?? {});
  if (!built.ok) return { ok: false, error: "Bitte die markierten Felder prüfen.", fieldErrors: built.errors };
  return { ok: true, data: { fileName: contractFileName(contractTemplates[templateId], String(input?.kunde_firma ?? "")), base64: toBase64(built.bytes) } };
}

/** Admin: the active template as a blank with lines to fill in by hand, or as the Word file with its placeholders. */
export async function downloadContractTemplate(templateId: string, variant: "blank" | "placeholders"): Promise<ContractActionResult<ContractDownload>> {
  if (!isContractTemplateId(templateId)) return unknownTemplate;
  const supabase = await adminSession();
  if (!supabase) return denied;
  const active = await readActiveTemplate(supabase, templateId);
  if (!active) return templateUnavailable;
  const template = contractTemplates[templateId];
  const bytes = variant === "placeholders" ? active.bytes : buildBlank(templateId, active.bytes);
  return { ok: true, data: { fileName: `${template.fileTitle} – ${variant === "placeholders" ? "Vorlage mit Platzhaltern" : "Blanko"}.docx`, base64: toBase64(bytes) } };
}

/** The customer's folder „Verträge“, found in any spelling of upper and lower case or created; null without folders. */
async function contractFolder(supabase: Supabase, customerId: string) {
  const find = () => supabase.from("hub_folders").select("id").eq("customer_id", customerId).ilike("name", CONTRACT_FOLDER).limit(1).maybeSingle<{ id: string }>();
  const existing = await find();
  if (existing.error) return null;
  if (existing.data) return existing.data.id;
  const created = await supabase.from("hub_folders").insert({ customer_id: customerId, name: CONTRACT_FOLDER }).select("id").single<{ id: string }>();
  if (created.data) return created.data.id;
  // Another admin created it a moment ago.
  return created.error?.code === "23505" ? (await find()).data?.id ?? null : null;
}

export type FileContractInput = {
  customerId: string;
  templateId: string;
  notify: boolean;
} & (
  | { source: "generated"; input: Record<string, string> }
  | { source: "upload"; path: string; fileName: string; mimeType: string; sha256: string | null }
);

/**
 * Admin: files a contract at the customer, in the asset management in the folder „Verträge“ with the category
 * Vertrag. For that category the database shows the file to the customer only, never to their freelancers. The file is
 * either the generated Word file or a finished one the admin uploaded first (the signed PDF, or one saved from Word).
 */
export async function fileContract(input: FileContractInput): Promise<ContractActionResult<{ fileId: string; title: string }>> {
  if (!uuid.test(String(input?.customerId ?? ""))) return { ok: false, error: "Bitte zuerst einen Kunden wählen." };
  if (!isContractTemplateId(input?.templateId)) return unknownTemplate;
  const supabase = await adminSession();
  if (!supabase) return denied;
  const customer = await readCustomer(supabase, input.customerId);
  if (!customer) return { ok: false, error: "Diesen Kunden gibt es nicht mehr." };
  const template = contractTemplates[input.templateId];
  const storage = supabase.storage.from(HUB_FILES_BUCKET);

  let path: string;
  let fileName: string;
  let mimeType: string;
  let sizeBytes: number;
  let sha256: string | null;
  let description: string;
  if (input.source === "generated") {
    const active = await readActiveTemplate(supabase, input.templateId);
    if (!active) return templateUnavailable;
    const built = buildContract(input.templateId, active.bytes, input.input ?? {});
    if (!built.ok) return { ok: false, error: "Bitte die markierten Felder prüfen.", fieldErrors: built.errors };
    fileName = contractFileName(template, String(input.input?.kunde_firma ?? customer.company));
    path = `files/${randomUUID()}/${storageSafeName(fileName)}`;
    const uploaded = await storage.upload(path, built.bytes, { contentType: DOCX_MIME, upsert: false });
    if (uploaded.error) return { ok: false, error: "Der Vertrag konnte nicht gespeichert werden. Ist die Dateiablage eingerichtet?" };
    mimeType = DOCX_MIME;
    sizeBytes = built.bytes.length;
    sha256 = createHash("sha256").update(built.bytes).digest("hex");
    const edition = active.version && active.version.kind !== "standard" ? `Fassung vom ${formatDay(active.version.createdAt.slice(0, 10))}` : "Standardfassung";
    description = `Mit dem Vertragsgenerator aus der Vorlage „${template.name}“ erstellt (${edition}).`;
  } else {
    path = String(input.path ?? "");
    const extension = fileExtension(String(input.fileName ?? ""));
    if (!uploadPath.test(path) || !["pdf", "docx"].includes(extension)) return { ok: false, error: "Bitte eine PDF- oder Word-Datei wählen." };
    // Trust the stored object, not the browser, for the size.
    const folder = path.slice(0, path.lastIndexOf("/"));
    const name = path.slice(path.lastIndexOf("/") + 1);
    const stored = (await storage.list(folder, { search: name })).data?.find((item) => item.name === name);
    sizeBytes = Number((stored?.metadata as { size?: number } | undefined)?.size);
    if (!stored || !Number.isFinite(sizeBytes)) return { ok: false, error: "Die hochgeladene Datei wurde nicht gefunden. Bitte erneut versuchen." };
    const check = checkUpload(String(input.fileName), sizeBytes);
    if (!check.ok) {
      await storage.remove([path]);
      return check;
    }
    fileName = contractFileName(template, customer.company, extension);
    mimeType = extension === "pdf" ? "application/pdf" : DOCX_MIME;
    sha256 = typeof input.sha256 === "string" && /^[0-9a-f]{64}$/.test(input.sha256) ? input.sha256 : null;
    description = `Fertige Fassung zur Vorlage „${template.name}“.`;
  }

  const title = template.fileTitle;
  const record = await supabase.from("hub_files")
    .insert({ storage_path: path, title, description, category: "contract", file_name: fileName, mime_type: mimeType, size_bytes: sizeBytes, sha256 })
    .select("id")
    .single<{ id: string }>();
  if (record.error || !record.data) {
    await storage.remove([path]);
    return { ok: false, error: "Der Vertrag konnte nicht gespeichert werden." };
  }
  const folderId = await contractFolder(supabase, input.customerId);
  const assigned = await supabase.from("hub_file_assignments").insert({ file_id: record.data.id, customer_id: input.customerId, folder_id: folderId });
  if (assigned.error) {
    await supabase.from("hub_files").delete().eq("id", record.data.id);
    await storage.remove([path]);
    return { ok: false, error: "Der Vertrag konnte dem Kunden nicht zugeordnet werden. Bitte erneut versuchen." };
  }
  if (input.notify) await notifyFileShared(record.data.id, [input.customerId], fileNotice(title, record.data.id));
  refreshWorkspace();
  return { ok: true, data: { fileId: record.data.id, title } };
}

/* ---------- Template versions ---------- */

export type TemplateOverview = { id: ContractTemplateId; versions: TemplateVersion[] };

/** Admin: every template with its uploaded versions, newest (the active one) first. */
export async function listContractTemplates(): Promise<ContractActionResult<TemplateOverview[]>> {
  const supabase = await adminSession();
  if (!supabase) return denied;
  const out: TemplateOverview[] = [];
  for (const id of contractTemplateIds) {
    const versions = await listVersions(supabase, id);
    if (!versions) return { ok: false, error: "Die Fassungen der Vorlagen konnten gerade nicht geladen werden." };
    out.push({ id, versions });
  }
  return { ok: true, data: out };
}

/** Admin: a one-time upload link for a new version; it lands in the staging folder until its check passed. */
export async function prepareTemplateUpload(templateId: string, fileName: string, sizeBytes: number): Promise<ContractActionResult<{ path: string; token: string }>> {
  if (!isContractTemplateId(templateId)) return unknownTemplate;
  if (fileExtension(String(fileName ?? "")) !== "docx") return { ok: false, error: "Bitte die Vorlage als Word-Datei (.docx) hochladen." };
  if (!(Number(sizeBytes) > 0) || Number(sizeBytes) > MAX_TEMPLATE_BYTES) return { ok: false, error: "Die Datei ist leer oder größer als 10 MB." };
  const supabase = await adminSession();
  if (!supabase) return denied;
  const storage = supabase.storage.from(HUB_FILES_BUCKET);
  // Uploads nobody took over or discarded (a closed browser) go after a day.
  const staged = await storage.list(TEMPLATE_STAGING_PREFIX, { limit: 100 });
  const stale = (staged.data ?? []).filter((item) => item.created_at && Date.now() - Date.parse(item.created_at) > 86_400_000).map((item) => `${TEMPLATE_STAGING_PREFIX}/${item.name}`);
  if (stale.length) await storage.remove(stale);
  const { data, error } = await storage.createSignedUploadUrl(`${TEMPLATE_STAGING_PREFIX}/${randomUUID()}.docx`);
  if (error || !data) return { ok: false, error: "Der Upload konnte nicht vorbereitet werden." };
  return { ok: true, data: { path: data.path, token: data.token } };
}

/** Reads and checks an uploaded Word file: a real .docx without macros, with known and complete placeholders. */
async function checkStaged(supabase: Supabase, templateId: ContractTemplateId, path: string): Promise<ContractActionResult<TemplateCheck>> {
  if (!stagingPath.test(path)) return { ok: false, error: "Unbekannter Upload." };
  const { data, error } = await supabase.storage.from(HUB_FILES_BUCKET).download(path);
  if (error || !data) return { ok: false, error: "Die hochgeladene Datei wurde nicht gefunden. Bitte erneut hochladen." };
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.length > MAX_TEMPLATE_BYTES || !looksLikeDocx(bytes)) return { ok: false, error: "Das ist keine Word-Datei (.docx)." };
  let parts: Record<string, Uint8Array>;
  try {
    parts = readDocx(bytes);
  } catch {
    return { ok: false, error: "Die Word-Datei lässt sich nicht lesen. Bitte in Word neu speichern und erneut hochladen." };
  }
  if (!parts["word/document.xml"]) return { ok: false, error: "Das ist keine Word-Datei (.docx)." };
  if (Object.keys(parts).some((name) => /vbaProject\.bin$/i.test(name))) return { ok: false, error: "Vorlagen mit Makros werden nicht angenommen. Bitte als normales Word-Dokument (.docx) speichern." };
  return { ok: true, data: checkTemplateScan(contractTemplates[templateId], docxPlaceholders(bytes)) };
}

/** Admin: the check of an uploaded version, before it becomes active. */
export async function checkTemplateUpload(templateId: string, path: string): Promise<ContractActionResult<TemplateCheck>> {
  if (!isContractTemplateId(templateId)) return unknownTemplate;
  const supabase = await adminSession();
  if (!supabase) return denied;
  return checkStaged(supabase, templateId, String(path ?? ""));
}

/** Admin: makes a checked upload the active version. The check runs again here; the browser's word does not count. */
export async function activateTemplateUpload(templateId: string, path: string): Promise<ContractActionResult<TemplateVersion>> {
  if (!isContractTemplateId(templateId)) return unknownTemplate;
  const supabase = await adminSession();
  if (!supabase) return denied;
  const check = await checkStaged(supabase, templateId, String(path ?? ""));
  if (!check.ok) return check;
  if (!check.data.ok) return { ok: false, error: "Die Vorlage hat noch unbekannte oder unvollständige Platzhalter." };
  const name = versionFileName("upload", new Date(), randomTag());
  const { error } = await supabase.storage.from(HUB_FILES_BUCKET).move(path, versionPath(templateId, name));
  if (error) return { ok: false, error: "Die neue Fassung konnte nicht gespeichert werden." };
  return { ok: true, data: parseVersionName(name)! };
}

/** Admin: drops an upload that was not taken over. */
export async function discardTemplateUpload(path: string): Promise<ContractActionResult<null>> {
  if (!stagingPath.test(String(path ?? ""))) return { ok: false, error: "Unbekannter Upload." };
  const supabase = await adminSession();
  if (!supabase) return denied;
  await supabase.storage.from(HUB_FILES_BUCKET).remove([path]);
  return { ok: true, data: null };
}

/**
 * Admin: makes an older version active again, or the template that ships with the hub ("standard"). Nothing is
 * deleted: the chosen version is copied to the top of the list, so the history stays complete.
 */
export async function restoreTemplateVersion(templateId: string, name: string): Promise<ContractActionResult<TemplateVersion>> {
  if (!isContractTemplateId(templateId)) return unknownTemplate;
  const version = name === "standard" ? null : parseVersionName(String(name ?? ""));
  if (name !== "standard" && !version) return { ok: false, error: "Diese Fassung gibt es nicht." };
  const supabase = await adminSession();
  if (!supabase) return denied;
  const storage = supabase.storage.from(HUB_FILES_BUCKET);
  // A "standard" entry always means the template that ships with the hub at that moment, whatever the stored bytes.
  const standard = !version || version.kind === "standard";
  const kind: TemplateVersionKind = standard ? "standard" : "restore";
  const target = versionFileName(kind, new Date(), randomTag());
  const { error } = standard
    ? await storage.upload(versionPath(templateId, target), await readDefaultTemplate(templateId), { contentType: DOCX_MIME, upsert: false })
    : await storage.copy(versionPath(templateId, version.name), versionPath(templateId, target));
  if (error) return { ok: false, error: standard ? "Die Standardfassung konnte nicht wiederhergestellt werden." : "Diese Fassung konnte nicht wieder verwendet werden." };
  return { ok: true, data: parseVersionName(target)! };
}

/** Admin: one version as the Word file with placeholders, to compare or to edit further. */
export async function downloadTemplateVersion(templateId: string, name: string): Promise<ContractActionResult<ContractDownload>> {
  if (!isContractTemplateId(templateId)) return unknownTemplate;
  const version = parseVersionName(String(name ?? ""));
  if (!version) return { ok: false, error: "Diese Fassung gibt es nicht." };
  const supabase = await adminSession();
  if (!supabase) return denied;
  const bytes = await readVersion(supabase, templateId, version);
  if (!bytes) return { ok: false, error: "Diese Fassung konnte nicht geladen werden." };
  const stamp = `${berlinTime(version.createdAt).replace(",", "").replace(":", ".")} Uhr`;
  return { ok: true, data: { fileName: `${contractTemplates[templateId].fileTitle} – Fassung vom ${stamp}.docx`, base64: toBase64(bytes) } };
}
