import type { PackageId } from "@/lib/service-packages";
import type { DomainCheck, DomainOwner, DomainStatus, MailboxKind, MailSecurity } from "@/lib/hub-domains/rules";
import type { ShareArea } from "./rules";

/** Since when each area is released (ISO instant), null while it is off. */
export type ShareTimes = Record<ShareArea, string | null>;

/** What one freelancer may read of one customer, as the admins set it under „Vertrag & Domain“ › Kunde › Freelancer. */
export type FreelancerAssignment = {
  freelancerId: string;
  freelancerName: string;
  freelancerNumber: string;
  customerId: string;
  assignedAt: string | null;
  shares: ShareTimes;
  /** For this freelancer only; empty when there is none. */
  note: string;
  noteUpdatedAt: string | null;
};

export type FreelancerShareState = {
  /** False while the database does not know the shares yet (migration 202611180001 in service-oalab). */
  ready: boolean;
  /** Every assignment of a freelancer to a customer, with its shares (all off without a row). */
  assignments: FreelancerAssignment[];
  error?: string;
};

export type CardDomain = {
  id: string;
  /** As stored: lower case, umlauts as xn--…. */
  domain: string;
  /** The way people read it, with umlauts. */
  display: string;
  status: DomainStatus;
  owner: DomainOwner;
  registrar: string;
  dnsProvider: string;
  websiteHost: string;
  renewsOn: string | null;
  checks: Record<DomainCheck, boolean>;
};

export type CardMailServer = {
  imapHost: string;
  imapPort: number | null;
  imapSecurity: MailSecurity;
  smtpHost: string;
  smtpPort: number | null;
  smtpSecurity: MailSecurity;
  webmailUrl: string;
  provider: string;
};

export type CardMailbox = { id: string; address: string; display: string; person: string; kind: MailboxKind; target: string; targetDisplay: string };

export type CardPackage = { group: "domain" | "service"; packageId: PackageId; since: string | null; until: string | null };

export type CardContact = { email: string; phone: string; website: string; street: string; postalCode: string; city: string; country: string };

/**
 * One customer the signed-in freelancer looks after, with exactly what oalab released (hub_freelancer_customer_cards()).
 * An area that is off arrives as null, never as an empty list.
 */
export type FreelancerCustomerCard = {
  customerId: string;
  freelancerId: string;
  company: string;
  customerNumber: string;
  /** The customer's Service organization: it links the customer with their projects in the task board. */
  organizationId: string | null;
  assignedAt: string | null;
  shares: ShareTimes;
  note: string | null;
  noteUpdatedAt: string | null;
  domains: CardDomain[] | null;
  mailServer: CardMailServer | null;
  mailboxes: CardMailbox[] | null;
  packages: CardPackage[] | null;
  contact: CardContact | null;
};

export type FreelancerCustomersState = {
  /** "fixtures": the design preview, which never touches real data. */
  source: "supabase" | "fixtures";
  /** False while the database has no shares yet: the customers show, „Vertrag & Domain“ stays empty. */
  ready: boolean;
  cards: FreelancerCustomerCard[];
  error?: string;
};

/**
 * A customer a freelancer looks after, as hub_freelancer_customer_list() hands it out (migration 202611200001 in
 * service-oalab): name, number, Service organization and logo, never contact data or packages.
 */
export type FreelancerCustomerRow = {
  id: string;
  company: string;
  customer_number: string;
  organization_id: string | null;
  logo_path: string | null;
  logo_background: string | null;
  logo_color: string | null;
};

/** A row of hub_customers as the hub shows it next to files and appointments. */
export type CustomerNameRow = { id: string; customer_number: string; company: string; kind?: string };
