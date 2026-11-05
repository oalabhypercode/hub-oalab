import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OPERATOR } from "@/lib/legal-details";
import { HUB_FILES_BUCKET } from "@/lib/hub-files/catalog";
import {
  blankValues, contractTemplates, contractValues, sortedVersions, TEMPLATE_VERSIONS_PREFIX,
  type ContractOperator, type ContractTemplateId, type ContractValues, type TemplateVersion,
} from "./catalog";
import { fillDocx } from "./docx";

/** oalab's side of every contract: the imprint's address and the partners who sign. */
export const contractOperator: ContractOperator = { street: OPERATOR.street, city: OPERATOR.city, partners: OPERATOR.partners };

/** The template that ships with the hub, in lib/contract-templates/templates (next.config.ts traces the folder). */
export async function readDefaultTemplate(id: ContractTemplateId): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(process.cwd(), "lib", "contract-templates", "templates", contractTemplates[id].file)));
}

export const versionPath = (id: ContractTemplateId, name: string) => `${TEMPLATE_VERSIONS_PREFIX}/${id}/${name}`;

/** The uploaded versions of a template, newest first; null when the storage cannot be read right now. */
export async function listVersions(supabase: SupabaseClient, id: ContractTemplateId): Promise<TemplateVersion[] | null> {
  const { data, error } = await supabase.storage.from(HUB_FILES_BUCKET).list(`${TEMPLATE_VERSIONS_PREFIX}/${id}`, { limit: 500, sortBy: { column: "name", order: "desc" } });
  return error ? null : sortedVersions((data ?? []).map((item) => item.name));
}

/** The bytes of one version; a "standard" version stands for the template that ships with the hub. */
export async function readVersion(supabase: SupabaseClient, id: ContractTemplateId, version: TemplateVersion | null): Promise<Uint8Array | null> {
  if (!version || version.kind === "standard") return readDefaultTemplate(id);
  const { data, error } = await supabase.storage.from(HUB_FILES_BUCKET).download(versionPath(id, version.name));
  return error || !data ? null : new Uint8Array(await data.arrayBuffer());
}

/**
 * The active template: the newest uploaded version, or the one that ships with the hub. If the storage cannot be read,
 * there is no silent fallback to the default text: the contract would have the wrong wording.
 */
export async function readActiveTemplate(supabase: SupabaseClient, id: ContractTemplateId): Promise<{ bytes: Uint8Array; version: TemplateVersion | null } | null> {
  const versions = await listVersions(supabase, id);
  if (!versions) return null;
  const version = versions[0] ?? null;
  const bytes = await readVersion(supabase, id, version);
  return bytes ? { bytes, version } : null;
}

/** A filled contract from the given template, or the field errors that stand in the way. */
export function buildContract(id: ContractTemplateId, template: Uint8Array, input: Record<string, unknown>): { ok: true; bytes: Uint8Array } | Extract<ContractValues, { ok: false }> {
  const result = contractValues(contractTemplates[id], input, contractOperator);
  if (!result.ok) return result;
  return { ok: true, bytes: fillDocx(template, (key) => result.values[key]) };
}

/** The template with lines instead of values, to print and fill in by hand. */
export function buildBlank(id: ContractTemplateId, template: Uint8Array): Uint8Array {
  const values = blankValues(contractTemplates[id], contractOperator);
  return fillDocx(template, (key) => values[key]);
}
