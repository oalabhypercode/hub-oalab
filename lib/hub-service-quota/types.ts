import type { QuotaRow } from "./rules";

/** One request of this month that counts (or was taken out of the count), for the admin's list at a customer. */
export type QuotaRequest = {
  requestId: string;
  reference: string;
  title: string;
  /** When the customer submitted it (the database's count). */
  submittedAt: string;
  trashed: boolean;
  exemption: { reason: string; createdAt: string; byName: string } | null;
};

export type ServiceQuotaState = {
  /** False while the database lacks the quota (migration 202611060001 in service-oalab). */
  ready: boolean;
  /** The switch: does the limit block new requests? */
  enforced: boolean;
  /** The month the database counts, in German time; null without data. */
  window: { startsAt: string; endsAt: string } | null;
  /** Admins: every hub customer with an organization on the service platform. Customers: their own, only while on. */
  customers: QuotaRow[];
  /** Admins only: the last change of the switch. */
  switchedAt?: string | null;
  switchedBy?: string | null;
  /** A real admin with the migration applied may switch and exempt. */
  canManage: boolean;
  error?: string;
};

export const emptyServiceQuota = (error?: string): ServiceQuotaState => ({ ready: false, enforced: false, window: null, customers: [], canManage: false, error });
