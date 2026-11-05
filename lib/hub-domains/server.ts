import "server-only";
import { domainToUnicode } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { domainCheckIds, isDomainOwner, isDomainStatus, isLoginKind, isMailboxKind, isMailSecurity, type DomainCheck } from "./rules";
import { emptyDomainMail, type CustomerDomain, type DomainMailState, type Mailbox, type MailServer, type ProviderLogin } from "./types";

// Domains, mail and logins of „Vertrag & Domain“ (migration 202611050002 in service-oalab). Admins read everything with
// the service role after the admin check, and of the passwords only whether one exists; customers read with their own
// session, which the database limits to the columns below (column grants) and to their own customers (RLS).

/** What customers may read (the column grants of migration 202611050002). */
export const CUSTOMER_DOMAIN_COLUMNS = "id, customer_id, domain";
export const CUSTOMER_MAIL_SERVER_COLUMNS = "customer_id, imap_host, imap_port, imap_security, smtp_host, smtp_port, smtp_security, webmail_url";
export const CUSTOMER_MAILBOX_COLUMNS = "id, customer_id, address, person, kind, target";
const ADMIN_DOMAIN_COLUMNS = `${CUSTOMER_DOMAIN_COLUMNS}, registrar, dns_provider, website_host, owner, renews_on, status, website_ok, ssl_ok, mx_ok, spf_ok, dkim_ok, dmarc_ok, note`;
const ADMIN_MAIL_SERVER_COLUMNS = `${CUSTOMER_MAIL_SERVER_COLUMNS}, provider`;
const LOGIN_COLUMNS = "id, customer_id, kind, label, login_url, username";

type DomainRow = { id: string; customer_id: string; domain: string } & Partial<Record<`${DomainCheck}_ok`, boolean>> & {
  registrar?: string; dns_provider?: string; website_host?: string; owner?: string; renews_on?: string | null; status?: string; note?: string;
};
type MailServerRow = { customer_id: string; imap_host: string; imap_port: number | null; imap_security: string; smtp_host: string; smtp_port: number | null; smtp_security: string; webmail_url: string; provider?: string };
type MailboxRow = { id: string; customer_id: string; address: string; person: string; kind: string; target: string };
type LoginRow = { id: string; customer_id: string; kind: string; label: string; login_url: string; username: string };

/** The tables are missing until the migration is applied. */
export const isMissingDomainTables = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || /hub_customer_(domains|mail_servers|mailboxes|logins)|hub_vault_secrets|schema cache/i.test(error.message ?? "")));

const readable = (domain: string) => {
  try {
    return domainToUnicode(domain) || domain;
  } catch {
    return domain;
  }
};

function toDomain(row: DomainRow, admin: boolean): CustomerDomain {
  const domain: CustomerDomain = { id: row.id, customerId: row.customer_id, domain: row.domain, display: readable(row.domain) };
  if (!admin) return domain;
  return {
    ...domain,
    details: {
      registrar: row.registrar ?? "",
      dnsProvider: row.dns_provider ?? "",
      websiteHost: row.website_host ?? "",
      owner: isDomainOwner(row.owner) ? row.owner : "customer",
      renewsOn: row.renews_on ?? null,
      status: isDomainStatus(row.status) ? row.status : "active",
      checks: Object.fromEntries(domainCheckIds.map((id) => [id, row[`${id}_ok`] === true])) as Record<DomainCheck, boolean>,
      note: row.note ?? "",
    },
  };
}

function toMailServer(row: MailServerRow, admin: boolean): MailServer {
  const server: MailServer = {
    customerId: row.customer_id,
    imapHost: row.imap_host, imapPort: row.imap_port, imapSecurity: isMailSecurity(row.imap_security) ? row.imap_security : "ssl",
    smtpHost: row.smtp_host, smtpPort: row.smtp_port, smtpSecurity: isMailSecurity(row.smtp_security) ? row.smtp_security : "ssl",
    webmailUrl: row.webmail_url,
  };
  return admin ? { ...server, provider: row.provider ?? "" } : server;
}

const toMailbox = (row: MailboxRow): Mailbox | null => isMailboxKind(row.kind)
  ? { id: row.id, customerId: row.customer_id, address: row.address, person: row.person, kind: row.kind, target: row.target }
  : null;

const byDomain = (a: CustomerDomain, b: CustomerDomain) => a.display.localeCompare(b.display, "de");
const byAddress = (a: Mailbox, b: Mailbox) => a.address.localeCompare(b.address, "de");

/**
 * Everything for a real admin, read with the service role after the admin check. Of the vault only which mailboxes and
 * logins have a password, nothing sealed: a password only travels through revealSecret.
 */
export async function loadDomainMailForAdmin(db: SupabaseClient, confirmed: boolean, keyReady: boolean): Promise<DomainMailState> {
  const [domains, servers, mailboxes, logins, secrets] = await Promise.all([
    db.from("hub_customer_domains").select(ADMIN_DOMAIN_COLUMNS).returns<DomainRow[]>(),
    db.from("hub_customer_mail_servers").select(ADMIN_MAIL_SERVER_COLUMNS).returns<MailServerRow[]>(),
    db.from("hub_customer_mailboxes").select(CUSTOMER_MAILBOX_COLUMNS).returns<MailboxRow[]>(),
    db.from("hub_customer_logins").select(LOGIN_COLUMNS).returns<LoginRow[]>(),
    db.from("hub_vault_secrets").select("mailbox_id, login_id").returns<{ mailbox_id: string | null; login_id: string | null }[]>(),
  ]);
  const error = domains.error ?? servers.error ?? mailboxes.error ?? logins.error ?? secrets.error;
  if (error) {
    if (isMissingDomainTables(error)) return emptyDomainMail(false);
    throw new Error("Domains und Mail konnten gerade nicht geladen werden.");
  }
  const stored = new Set((secrets.data ?? []).flatMap((row) => [row.mailbox_id, row.login_id]).filter((value): value is string => Boolean(value)));
  return {
    ready: true,
    domains: (domains.data ?? []).map((row) => toDomain(row, true)).sort(byDomain),
    mailServers: (servers.data ?? []).map((row) => toMailServer(row, true)),
    mailboxes: (mailboxes.data ?? []).flatMap((row) => {
      const mailbox = toMailbox(row);
      return mailbox ? [{ ...mailbox, hasPassword: stored.has(mailbox.id) }] : [];
    }).sort(byAddress),
    logins: (logins.data ?? []).flatMap((row): ProviderLogin[] => isLoginKind(row.kind)
      ? [{ id: row.id, customerId: row.customer_id, kind: row.kind, label: row.label, loginUrl: row.login_url, username: row.username, hasPassword: stored.has(row.id) }]
      : []).sort((a, b) => a.label.localeCompare(b.label, "de")),
    vault: { keyReady, confirmed },
  };
}

/** The login's own customers, read with its own session: running domain names, mailboxes and the mail program settings. */
export async function loadDomainMailForCustomer(supabase: SupabaseClient, customerIds: readonly string[]): Promise<DomainMailState> {
  if (!customerIds.length) return emptyDomainMail(true);
  const ids = [...customerIds];
  const [domains, servers, mailboxes] = await Promise.all([
    supabase.from("hub_customer_domains").select(CUSTOMER_DOMAIN_COLUMNS).in("customer_id", ids).returns<DomainRow[]>(),
    supabase.from("hub_customer_mail_servers").select(CUSTOMER_MAIL_SERVER_COLUMNS).in("customer_id", ids).returns<MailServerRow[]>(),
    supabase.from("hub_customer_mailboxes").select(CUSTOMER_MAILBOX_COLUMNS).in("customer_id", ids).returns<MailboxRow[]>(),
  ]);
  const error = domains.error ?? servers.error ?? mailboxes.error;
  if (error) {
    if (isMissingDomainTables(error)) return emptyDomainMail(false);
    throw new Error("Domains und Mail konnten gerade nicht geladen werden.");
  }
  return {
    ready: true,
    domains: (domains.data ?? []).map((row) => toDomain(row, false)).sort(byDomain),
    mailServers: (servers.data ?? []).map((row) => toMailServer(row, false)),
    mailboxes: (mailboxes.data ?? []).flatMap((row) => toMailbox(row) ?? []).sort(byAddress),
    logins: [],
    vault: null,
  };
}
