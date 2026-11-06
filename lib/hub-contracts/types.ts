import type { CustomerLogo } from "@/lib/hub-logos/rules";
import type { DomainMailState } from "@/lib/hub-domains/types";
import type { ServiceQuotaState } from "@/lib/hub-service-quota/types";
import type { CustomerPackage } from "@/lib/service-packages";
import type { TimelineKind } from "./rules";

/** One entry of a customer's timeline („Zeitpunkte“). */
export type TimelineEntry = {
  id: string;
  customerId: string;
  /** ISO day. */
  occurredOn: string;
  kind: TimelineKind;
  title: string;
  amountCents: number | null;
  /** A file of the customer in the asset management, such as the invoice. */
  fileId: string | null;
  customerVisible: boolean;
  createdAt: string;
  /** Admins only: the internal note, whether the package trigger wrote it, and who entered it. */
  note?: string;
  source?: "manual" | "package";
  authorName?: string;
};

export type ContractCustomer = {
  id: string;
  company: string;
  customerNumber: string;
  logo: CustomerLogo | null;
  /** Both groups, a group without a package as packageId null. */
  packages: CustomerPackage[];
};

export type ContractsState = {
  /** "admin": every customer with internal notes; "customer": the login's own customers and released entries only. */
  view: "admin" | "customer";
  /** "fixtures": preview and demo logins, which never touch real data. */
  source: "supabase" | "fixtures";
  customers: ContractCustomer[];
  /** Newest first. */
  timeline: TimelineEntry[];
  /** False while the database does not know packages and timeline yet (migration 202611050001 in service-oalab). */
  ready: boolean;
  /** A real admin with the migration applied may save. */
  canManage: boolean;
  /** Domains, mail server, mailboxes and (admins only) provider logins of stage 2. */
  domainMail: DomainMailState;
  /** Stage 3: new requests a month on the service platform per Service package, the switch and the block list. */
  serviceQuota: ServiceQuotaState;
  error?: string;
};
