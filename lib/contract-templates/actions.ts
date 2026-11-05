"use server";

import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import { checkUpload, fileExtension, HUB_FILES_BUCKET, storageSafeName } from "@/lib/hub-files/catalog";
import { notifyFileShared } from "@/lib/hub-notify/server";
import { fileNotice } from "@/lib/hub-notify/rules";
import { contractFileName, contractTemplates, DOCX_MIME, isContractTemplateId, type ContractCustomerData } from "./catalog";
import { buildBlank, buildContract, readTemplate } from "./server";

// Every action is a public POST endpoint: each one checks for a real admin with a confirmed second factor itself.
// Row Level Security checks the writes a second time, as in the asset management.

export type ContractActionResult<T> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };
export type ContractDownload = { fileName: string; base64: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uploadPath = /^files\/[0-9a-f-]{36}\/[a-z0-9.-]{1,96}$/;
const denied = { ok: false as const, error: "Verträge erstellen und ablegen geht nur mit echtem Admin-Login." };
const unknownTemplate = { ok: false as const, error: "Diese Vorlage gibt es nicht." };
/** The customer's folder in the asset management that collects the contracts; created on first use. */
const CONTRACT_FOLDER = "Verträge";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type CustomerRow = { id: string; company: string; street: string | null; postal_code: string | null; city: string | null; website: string | null };

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/** The admin's own session: writes run under RLS like every upload in the asset management. */
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

/** Admin: the filled contract as a Word file to download. Nothing is stored. */
export async function createContractDocument(templateId: string, input: Record<string, string>): Promise<ContractActionResult<ContractDownload>> {
  if (!isContractTemplateId(templateId)) return unknownTemplate;
  if (!(await verifyHubAdmin())) return denied;
  const built = await buildContract(templateId, input ?? {});
  if (!built.ok) return { ok: false, error: "Bitte die markierten Felder prüfen.", fieldErrors: built.errors };
  return { ok: true, data: { fileName: contractFileName(contractTemplates[templateId], String(input?.kunde_firma ?? "")), base64: toBase64(built.bytes) } };
}

/** Admin: the blank template with lines to fill in by hand, or the Word file with its placeholders. */
export async function downloadContractTemplate(templateId: string, variant: "blank" | "placeholders"): Promise<ContractActionResult<ContractDownload>> {
  if (!isContractTemplateId(templateId)) return unknownTemplate;
  if (!(await verifyHubAdmin())) return denied;
  const template = contractTemplates[templateId];
  const bytes = variant === "placeholders" ? await readTemplate(templateId) : await buildBlank(templateId);
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
    const built = await buildContract(input.templateId, input.input ?? {});
    if (!built.ok) return { ok: false, error: "Bitte die markierten Felder prüfen.", fieldErrors: built.errors };
    fileName = contractFileName(template, String(input.input?.kunde_firma ?? customer.company));
    path = `files/${randomUUID()}/${storageSafeName(fileName)}`;
    const uploaded = await storage.upload(path, built.bytes, { contentType: DOCX_MIME, upsert: false });
    if (uploaded.error) return { ok: false, error: "Der Vertrag konnte nicht gespeichert werden. Ist die Dateiablage eingerichtet?" };
    mimeType = DOCX_MIME;
    sizeBytes = built.bytes.length;
    sha256 = createHash("sha256").update(built.bytes).digest("hex");
    description = `Mit dem Vertragsgenerator aus der Vorlage „${template.name}“ erstellt.`;
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
