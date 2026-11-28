import type { HubAppointment } from "../hub-calendar/types";
import type { QuotaRow } from "../hub-service-quota/rules";

/**
 * What the Insights page reads besides the layout's data (projects, bell, counts): appointments and the Service quota.
 * Customers get their own appointments and, while the quota switch is on, their quota; admins every appointment of the
 * coming weeks and the quota of every customer with a package.
 */
export type InsightsData = {
  /** Berlin day the page was read on, YYYY-MM-DD, and the instant (the server's clock). */
  today: string;
  now: number;
  /** Confirmed and requested appointments, earliest first (customers from now, admins from the start of today). */
  appointments: HubAppointment[];
  appointmentsError: string | null;
  quota: {
    /** The quota could be read (the migration is in place). */
    ready: boolean;
    /** The switch „Sperre bei vollem Kontingent“. */
    enforced: boolean;
    /** The current month in German time, when the database said so. */
    window: { startsAt: string; endsAt: string } | null;
    rows: QuotaRow[];
    /** Admins: company and number of each customer in `rows` that is not archived. */
    names: Record<string, { company: string; customerNumber: string }>;
  };
};
