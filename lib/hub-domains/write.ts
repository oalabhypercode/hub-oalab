import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyContractChange } from "@/lib/hub-notify/server";
import type { ContractItem } from "@/lib/hub-chat-events/rules";
import { isUuid, readDomain, readMailbox } from "./rules";

// What „Domain & Mail“ under „Vertrag & Domain“ writes once the caller is checked as an admin: the tab's actions
// (lib/hub-domains/actions.ts) and the Claude connector (lib/hub-mcp/area-writes.ts) save domains and mailboxes through
// this code, with the service role, and check the inputs with the same rules. Passwords are never handled here; they
// belong to lib/hub-vault. The admin log names the domain or address, never more; Claude's lines are `claude.*`.
// Refreshing the page is the caller's business.

export type DomainWriter = { db: SupabaseClient; actorId: string; via?: "claude" };
type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const failed = (error: string) => ({ ok: false as const, error });
const gone = "Diesen Eintrag gibt es nicht mehr.";
export const DOMAIN_TRY_AGAIN = "Das hat gerade nicht geklappt. Bitte versuche es erneut.";
const missingTables = "Domains und Mail sind in der Datenbank noch nicht eingerichtet. Die Migration steht noch aus.";

export function domainWriteError(error: { code?: string; message?: string }, duplicate: string) {
  if (error.code === "42P01" || error.code === "PGRST205") return missingTables;
  if (error.code === "23505") return duplicate;
  if (error.code === "23514" && /Passwort/.test(error.message ?? "")) return "Dieses Postfach hat ein Passwort. Entferne es zuerst unter „Zugangsdaten“, dann wird daraus eine Weiterleitung oder ein Alias.";
  if (error.code === "23514") return "Bitte die Eingaben prüfen.";
  return DOMAIN_TRY_AGAIN;
}

export async function logDomainEvent(w: DomainWriter, action: string, summary: string, customerId: string) {
  const claude = w.via === "claude";
  await w.db.from("hub_admin_events").insert({ actor_id: w.actorId, action: claude ? `claude.${action}` : action, summary: `${summary}${claude ? " (über Claude)" : ""}`.slice(0, 300), target_customer_id: customerId });
}

/**
 * The customer sees their domains and addresses under Vertrag & Domain, so they hear of new and changed ones
 * (24.11.2026): a line in the bell and a card in their chat, after the answer. Only the domain or the address.
 */
const tellCustomer = (w: DomainWriter, customerId: string, item: ContractItem) =>
  after(() => notifyContractChange({ customerId, item, actorId: w.actorId }));

/** Only entries of the kind customer hold domains and mail; freelancers do not. */
export async function customerHoldsDomains(db: SupabaseClient, customerId: unknown): Promise<boolean> {
  if (!isUuid(customerId)) return false;
  const { data, error } = await db.from("hub_customers").select("id, kind").eq("id", customerId).maybeSingle<{ id: string; kind: string | null }>();
  return !error && Boolean(data) && (data?.kind ?? "customer") === "customer";
}

/** Creates a domain of a customer or updates one of the same customer. */
export async function saveDomainAs(w: DomainWriter, input: { id?: unknown; customerId?: unknown } & Record<string, unknown>): Promise<Result<{ id: string }>> {
  if (!await customerHoldsDomains(w.db, input?.customerId)) return failed("Diesen Kunden gibt es nicht mehr.");
  const customerId = input.customerId as string;
  const domain = readDomain(input ?? {});
  if (!domain.ok) return domain;
  const { checks, ...fields } = domain.value;
  const row = {
    domain: fields.domain, registrar: fields.registrar, dns_provider: fields.dnsProvider, website_host: fields.websiteHost, owner: fields.owner,
    renews_on: fields.renewsOn, status: fields.status, note: fields.note, updated_by: w.actorId,
    website_ok: checks.website, ssl_ok: checks.ssl, mx_ok: checks.mx, spf_ok: checks.spf, dkim_ok: checks.dkim, dmarc_ok: checks.dmarc,
  };
  const duplicate = `${fields.domain} ist schon bei einem Kunden eingetragen.`;
  if (input.id !== undefined && input.id !== null && input.id !== "") {
    if (!isUuid(input.id)) return failed(gone);
    const { data, error } = await w.db.from("hub_customer_domains").update(row).eq("id", input.id).eq("customer_id", customerId).select("id").maybeSingle<{ id: string }>();
    if (error) return failed(domainWriteError(error, duplicate));
    if (!data) return failed(gone);
    await logDomainEvent(w, "customer.domain_updated", `Domain geändert: ${fields.domain}`, customerId);
    tellCustomer(w, customerId, { what: "domain", label: fields.domain, change: "changed" });
    return { ok: true, data: { id: data.id } };
  }
  const { data, error } = await w.db.from("hub_customer_domains").insert({ ...row, customer_id: customerId, created_by: w.actorId }).select("id").single<{ id: string }>();
  if (error || !data) return failed(error ? domainWriteError(error, duplicate) : DOMAIN_TRY_AGAIN);
  await logDomainEvent(w, "customer.domain_created", `Domain eingetragen: ${fields.domain}`, customerId);
  tellCustomer(w, customerId, { what: "domain", label: fields.domain, change: "new" });
  return { ok: true, data: { id: data.id } };
}

/** Creates a mailbox, forward or alias of a customer or updates one of the same customer (never its password). */
export async function saveMailboxAs(w: DomainWriter, input: { id?: unknown; customerId?: unknown } & Record<string, unknown>): Promise<Result<{ id: string }>> {
  if (!await customerHoldsDomains(w.db, input?.customerId)) return failed("Diesen Kunden gibt es nicht mehr.");
  const customerId = input.customerId as string;
  const mailbox = readMailbox(input ?? {});
  if (!mailbox.ok) return mailbox;
  const row = { address: mailbox.value.address, person: mailbox.value.person, kind: mailbox.value.kind, target: mailbox.value.target, updated_by: w.actorId };
  const duplicate = `${mailbox.value.address} ist schon eingetragen.`;
  if (input.id !== undefined && input.id !== null && input.id !== "") {
    if (!isUuid(input.id)) return failed(gone);
    const { data, error } = await w.db.from("hub_customer_mailboxes").update(row).eq("id", input.id).eq("customer_id", customerId).select("id").maybeSingle<{ id: string }>();
    if (error) return failed(domainWriteError(error, duplicate));
    if (!data) return failed(gone);
    await logDomainEvent(w, "customer.mailbox_updated", `E-Mail-Adresse geändert: ${mailbox.value.address}`, customerId);
    tellCustomer(w, customerId, { what: "mailbox", label: mailbox.value.address, change: "changed" });
    return { ok: true, data: { id: data.id } };
  }
  const { data, error } = await w.db.from("hub_customer_mailboxes").insert({ ...row, customer_id: customerId, created_by: w.actorId }).select("id").single<{ id: string }>();
  if (error || !data) return failed(error ? domainWriteError(error, duplicate) : DOMAIN_TRY_AGAIN);
  await logDomainEvent(w, "customer.mailbox_created", `E-Mail-Adresse eingetragen: ${mailbox.value.address}`, customerId);
  tellCustomer(w, customerId, { what: "mailbox", label: mailbox.value.address, change: "new" });
  return { ok: true, data: { id: data.id } };
}
