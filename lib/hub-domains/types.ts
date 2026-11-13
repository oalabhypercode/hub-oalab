import type { KeychainLock } from "@/lib/hub-keychain/types";
import type { DomainCheck, DomainOwner, DomainStatus, MailboxKind, MailSecurity } from "./rules";

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
  /** As stored: lower case, umlaut domains as xn--…. */
  address: string;
  /** The address the way people read it, with umlauts. */
  display: string;
  person: string;
  kind: MailboxKind;
  /** Forward targets („a@x.de, b@y.de“) or the mailbox of an alias; empty for a mailbox. */
  target: string;
  /** The targets the way people read them. */
  targetDisplay: string;
  /** Admins only: whether a password is stored. The password itself never reaches the page this way. */
  hasPassword?: boolean;
};

/** A login of a customer (domain provider, DNS, hosting or any other category of the Schlüsselbund); admins only. */
export type ProviderLogin = {
  id: string;
  customerId: string;
  /** The category's id (hub_keychain_categories). */
  kind: string;
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
  /**
   * Admins only: whether the server holds the key (with its short name, never the key) and where the Schlüsselbund
   * stands for this admin (set up, locked, open): its app's code opens the passwords here as well.
   */
  vault: { keyReady: boolean; keyId: string | null; lock: KeychainLock } | null;
  /** Admins only: the Schlüsselbund's fixed categories, for the login's category and its name. */
  categories: { id: string; name: string; icon: string }[];
  error?: string;
};

export const emptyDomainMail = (ready: boolean, error?: string): DomainMailState => ({ ready, domains: [], mailServers: [], mailboxes: [], logins: [], vault: null, categories: [], ...(error ? { error } : {}) });
