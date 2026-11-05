"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { isUuid, readDomain, readMailbox, readMailServer } from "./rules";

// Domains, mail server and mailboxes of „Vertrag & Domain“ (tab „Domain & Mail“). Every action is a public POST endpoint:
// each one checks with the caller's own session that the database considers them an active admin (with a confirmed
// second factor if they use one) before the service role touches anything, and checks the inputs again. Passwords are
// not handled here; they belong to lib/hub-vault/actions.ts. The admin log names the domain or address, never more.

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

type Context = { db: SupabaseClient; actorId: string };

const denied = { ok: false as const, error: "Dafür brauchst du einen aktiven Admin-Zugang mit bestätigtem zweitem Faktor." };
const failed = (error: string) => ({ ok: false as const, error });
const gone = "Diesen Eintrag gibt es nicht mehr.";
const tryAgain = "Das hat gerade nicht geklappt. Bitte versuche es erneut.";

async function context(): Promise<Context | null> {
  const admin = await verifyHubAdmin();
  if (!admin) return null;
  const db = createAdminClient();
  return db ? { db, actorId: admin.userId } : null;
}

async function log(ctx: Context, action: string, summary: string, customerId: string) {
  await ctx.db.from("hub_admin_events").insert({ actor_id: ctx.actorId, action, summary: summary.slice(0, 300), target_customer_id: customerId });
}

/** Only entries of the kind customer hold domains and mail; freelancers do not. */
async function customerExists(ctx: Context, customerId: unknown): Promise<boolean> {
  if (!isUuid(customerId)) return false;
  const { data, error } = await ctx.db.from("hub_customers").select("id, kind").eq("id", customerId).maybeSingle<{ id: string; kind: string | null }>();
  return !error && Boolean(data) && (data?.kind ?? "customer") === "customer";
}

const missingTables = "Domains und Mail sind in der Datenbank noch nicht eingerichtet. Die Migration steht noch aus.";
function writeError(error: { code?: string; message?: string }, duplicate: string) {
  if (error.code === "42P01" || error.code === "PGRST205") return missingTables;
  if (error.code === "23505") return duplicate;
  if (error.code === "23514" && /Passwort/.test(error.message ?? "")) return "Dieses Postfach hat ein Passwort. Entferne es zuerst unter „Zugänge“, dann wird daraus eine Weiterleitung oder ein Alias.";
  if (error.code === "23514") return "Bitte die Eingaben prüfen.";
  return tryAgain;
}

/* ---------- Domains ---------- */

/** Creates a domain of a customer or updates one of the same customer. */
export async function saveDomain(input: { id?: unknown; customerId?: unknown } & Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  const ctx = await context();
  if (!ctx) return denied;
  if (!await customerExists(ctx, input?.customerId)) return failed("Diesen Kunden gibt es nicht mehr.");
  const customerId = input.customerId as string;
  const domain = readDomain(input ?? {});
  if (!domain.ok) return domain;
  const { checks, ...fields } = domain.value;
  const row = {
    domain: fields.domain, registrar: fields.registrar, dns_provider: fields.dnsProvider, website_host: fields.websiteHost, owner: fields.owner,
    renews_on: fields.renewsOn, status: fields.status, note: fields.note, updated_by: ctx.actorId,
    website_ok: checks.website, ssl_ok: checks.ssl, mx_ok: checks.mx, spf_ok: checks.spf, dkim_ok: checks.dkim, dmarc_ok: checks.dmarc,
  };
  const duplicate = `${fields.domain} ist schon bei einem Kunden eingetragen.`;
  if (input.id !== undefined && input.id !== null && input.id !== "") {
    if (!isUuid(input.id)) return failed(gone);
    const { data, error } = await ctx.db.from("hub_customer_domains").update(row).eq("id", input.id).eq("customer_id", customerId).select("id").maybeSingle<{ id: string }>();
    if (error) return failed(writeError(error, duplicate));
    if (!data) return failed(gone);
    await log(ctx, "customer.domain_updated", `Domain geändert: ${fields.domain}`, customerId);
    refreshWorkspace();
    return { ok: true, data: { id: data.id } };
  }
  const { data, error } = await ctx.db.from("hub_customer_domains").insert({ ...row, customer_id: customerId, created_by: ctx.actorId }).select("id").single<{ id: string }>();
  if (error || !data) return failed(error ? writeError(error, duplicate) : tryAgain);
  await log(ctx, "customer.domain_created", `Domain eingetragen: ${fields.domain}`, customerId);
  refreshWorkspace();
  return { ok: true, data: { id: data.id } };
}

export async function deleteDomain(input: { id?: unknown }): Promise<ActionResult<null>> {
  const ctx = await context();
  if (!ctx) return denied;
  if (!isUuid(input?.id)) return failed(gone);
  const { data, error } = await ctx.db.from("hub_customer_domains").delete().eq("id", input.id).select("customer_id, domain").maybeSingle<{ customer_id: string; domain: string }>();
  if (error) return failed(writeError(error, tryAgain));
  if (!data) return failed(gone);
  await log(ctx, "customer.domain_deleted", `Domain gelöscht: ${data.domain}`, data.customer_id);
  refreshWorkspace();
  return { ok: true, data: null };
}

/* ---------- Mail server ---------- */

/** Saves the mail server of a customer with the package OALAB Domain & Mail. */
export async function saveMailServer(input: { customerId?: unknown } & Record<string, unknown>): Promise<ActionResult<null>> {
  const ctx = await context();
  if (!ctx) return denied;
  if (!await customerExists(ctx, input?.customerId)) return failed("Diesen Kunden gibt es nicht mehr.");
  const customerId = input.customerId as string;
  const server = readMailServer(input ?? {});
  if (!server.ok) return server;
  const pkg = await ctx.db.from("hub_customer_packages").select("package_id").eq("customer_id", customerId).eq("package_group", "domain").maybeSingle<{ package_id: string | null }>();
  if (pkg.error) return failed(tryAgain);
  if (pkg.data?.package_id !== "domain-mail") return failed("Einen Mail-Server gibt es nur mit dem Paket OALAB Domain & Mail. Bitte zuerst im Reiter „Vertrag“ das Paket festlegen.");
  const value = server.value;
  const { error } = await ctx.db.from("hub_customer_mail_servers").upsert({
    customer_id: customerId, provider: value.provider,
    imap_host: value.imapHost, imap_port: value.imapPort, imap_security: value.imapSecurity,
    smtp_host: value.smtpHost, smtp_port: value.smtpPort, smtp_security: value.smtpSecurity,
    webmail_url: value.webmailUrl, updated_by: ctx.actorId,
  }, { onConflict: "customer_id" });
  if (error) return failed(writeError(error, tryAgain));
  await log(ctx, "customer.mail_server", "Mail-Server gespeichert", customerId);
  refreshWorkspace();
  return { ok: true, data: null };
}

/** Removes the mail server of a customer, for example once the package OALAB Domain & Mail ends. */
export async function deleteMailServer(input: { customerId?: unknown }): Promise<ActionResult<null>> {
  const ctx = await context();
  if (!ctx) return denied;
  if (!isUuid(input?.customerId)) return failed("Diesen Kunden gibt es nicht mehr.");
  const { data, error } = await ctx.db.from("hub_customer_mail_servers").delete().eq("customer_id", input.customerId).select("customer_id").maybeSingle<{ customer_id: string }>();
  if (error) return failed(writeError(error, tryAgain));
  if (!data) return failed("Für diesen Kunden ist kein Mail-Server gespeichert.");
  await log(ctx, "customer.mail_server_deleted", "Mail-Server entfernt", data.customer_id);
  refreshWorkspace();
  return { ok: true, data: null };
}

/* ---------- Mailboxes, forwards and aliases ---------- */

/** Creates a mailbox, forward or alias of a customer or updates one of the same customer. */
export async function saveMailbox(input: { id?: unknown; customerId?: unknown } & Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  const ctx = await context();
  if (!ctx) return denied;
  if (!await customerExists(ctx, input?.customerId)) return failed("Diesen Kunden gibt es nicht mehr.");
  const customerId = input.customerId as string;
  const mailbox = readMailbox(input ?? {});
  if (!mailbox.ok) return mailbox;
  const row = { address: mailbox.value.address, person: mailbox.value.person, kind: mailbox.value.kind, target: mailbox.value.target, updated_by: ctx.actorId };
  const duplicate = `${mailbox.value.address} ist schon eingetragen.`;
  if (input.id !== undefined && input.id !== null && input.id !== "") {
    if (!isUuid(input.id)) return failed(gone);
    const { data, error } = await ctx.db.from("hub_customer_mailboxes").update(row).eq("id", input.id).eq("customer_id", customerId).select("id").maybeSingle<{ id: string }>();
    if (error) return failed(writeError(error, duplicate));
    if (!data) return failed(gone);
    await log(ctx, "customer.mailbox_updated", `E-Mail-Adresse geändert: ${mailbox.value.address}`, customerId);
    refreshWorkspace();
    return { ok: true, data: { id: data.id } };
  }
  const { data, error } = await ctx.db.from("hub_customer_mailboxes").insert({ ...row, customer_id: customerId, created_by: ctx.actorId }).select("id").single<{ id: string }>();
  if (error || !data) return failed(error ? writeError(error, duplicate) : tryAgain);
  await log(ctx, "customer.mailbox_created", `E-Mail-Adresse eingetragen: ${mailbox.value.address}`, customerId);
  refreshWorkspace();
  return { ok: true, data: { id: data.id } };
}

/** Deletes a mailbox, forward or alias; a stored password goes with it (the log says so). */
export async function deleteMailbox(input: { id?: unknown }): Promise<ActionResult<null>> {
  const ctx = await context();
  if (!ctx) return denied;
  if (!isUuid(input?.id)) return failed(gone);
  const secret = await ctx.db.from("hub_vault_secrets").select("id").eq("mailbox_id", input.id).maybeSingle<{ id: string }>();
  if (secret.error) return failed(writeError(secret.error, tryAgain));
  const { data, error } = await ctx.db.from("hub_customer_mailboxes").delete().eq("id", input.id).select("customer_id, address").maybeSingle<{ customer_id: string; address: string }>();
  if (error) return failed(writeError(error, tryAgain));
  if (!data) return failed(gone);
  await log(ctx, "customer.mailbox_deleted", `E-Mail-Adresse gelöscht${secret.data ? " samt Passwort" : ""}: ${data.address}`, data.customer_id);
  refreshWorkspace();
  return { ok: true, data: null };
}
