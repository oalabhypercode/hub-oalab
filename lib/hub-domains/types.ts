import type { DomainCheck, DomainOwner, DomainStatus, LoginKind, MailboxKind, MailSecurity } from "./rules";

/** What only admins see of a domain. */
export type DomainDetails = {
  registrar: string;
  dnsProvider: string;
  websiteHost: string;
  owner: DomainOwner;
  /** ISO day. */
  renewsOn: string | null;
  status: DomainStatus;
  checks: Record<DomainCheck, boolean>;
  note: string;
};

export type CustomerDomain = {
  id: string;
  customerId: string;
  /** As stored: lower case, umlauts as xn--…. */
  domain: string;
  /** The way people read it, with umlauts. */
  display: string;
  /** Admins only; customers read the name alone. */
  details?: DomainDetails;
};

/** The settings for a mail program; the provider is for admins only. */
export type MailServer = {
  customerId: string;
  imapHost: string;
  imapPort: number | null;
  imapSecurity: MailSecurity;
  smtpHost: string;
  smtpPort: number | null;
  smtpSecurity: MailSecurity;
  webmailUrl: string;
  provider?: string;
};

export type Mailbox = {
  id: string;
  customerId: string;
  address: string;
  person: string;
  kind: MailboxKind;
  /** Forward targets („a@x.de, b@y.de“) or the mailbox of an alias; empty for a mailbox. */
  target: string;
  /** Admins only: whether a password is stored. The password itself never reaches the page this way. */
  hasPassword?: boolean;
};

/** A login at a domain provider, DNS or hosting; admins only. */
export type ProviderLogin = {
  id: string;
  customerId: string;
  kind: LoginKind;
  label: string;
  loginUrl: string;
  username: string;
  hasPassword: boolean;
};

export type DomainMailState = {
  /** False while the database does not know domains and mail yet (migration 202611050002 in service-oalab). */
  ready: boolean;
  domains: CustomerDomain[];
  mailServers: MailServer[];
  mailboxes: Mailbox[];
  /** Admins only. */
  logins: ProviderLogin[];
  /** Admins only: whether the server holds the key and this session confirmed its second factor (aal2). */
  vault: { keyReady: boolean; confirmed: boolean } | null;
  error?: string;
};

export const emptyDomainMail = (ready: boolean, error?: string): DomainMailState => ({ ready, domains: [], mailServers: [], mailboxes: [], logins: [], vault: null, ...(error ? { error } : {}) });
