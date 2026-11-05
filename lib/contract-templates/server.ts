import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { OPERATOR } from "@/lib/legal-details";
import { blankValues, contractTemplates, contractValues, type ContractOperator, type ContractTemplateId, type ContractValues } from "./catalog";
import { fillDocx } from "./docx";

/** oalab's side of every contract: the imprint's address and the partners who sign. */
export const contractOperator: ContractOperator = { street: OPERATOR.street, city: OPERATOR.city, partners: OPERATOR.partners };

/**
 * The Word template of a contract. The default ships with the hub in lib/contract-templates/templates (next.config.ts
 * traces the folder into the server bundle).
 */
export async function readTemplate(id: ContractTemplateId): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(process.cwd(), "lib", "contract-templates", "templates", contractTemplates[id].file)));
}

/** A filled contract, or the field errors that stand in the way. */
export async function buildContract(id: ContractTemplateId, input: Record<string, unknown>): Promise<{ ok: true; bytes: Uint8Array } | Extract<ContractValues, { ok: false }>> {
  const result = contractValues(contractTemplates[id], input, contractOperator);
  if (!result.ok) return result;
  const bytes = fillDocx(await readTemplate(id), (key) => result.values[key]);
  return { ok: true, bytes };
}

/** The template with lines instead of values, to print and fill in by hand. */
export async function buildBlank(id: ContractTemplateId): Promise<Uint8Array> {
  const values = blankValues(contractTemplates[id], contractOperator);
  return fillDocx(await readTemplate(id), (key) => values[key]);
}
