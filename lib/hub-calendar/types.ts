import type { HubFileCustomer } from "../hub-files/types";
import type { AppointmentStatus, Interval } from "./rules";

/** An appointment as the calendar shows it, whether it comes from Supabase or from fixtures. */
export type HubAppointment = {
  id: string;
  title: string;
  description: string;
  start: number;
  end: number;
  status: AppointmentStatus;
  teamsUrl: string | null;
  /** Reason for a declined request or a cancellation, written by OALAB. */
  responseNote: string;
  /** Null for internal OALAB appointments that belong to no customer. */
  customer: HubFileCustomer | null;
  /** Fictional fixture: its Teams link is an example and leads to no meeting. */
  sample?: boolean;
};

/**
 * "supabase": real appointments under RLS; changes go through server actions.
 * "fixtures": preview and public demo identities; changes stay in the browser and are never stored.
 */
export type HubCalendarState = {
  source: "supabase" | "fixtures";
  /** Admins: every appointment in the window. Customers: only their own appointments and requests. */
  appointments: HubAppointment[];
  /** Booked times of the whole OALAB calendar without any details (customers' availability view). */
  busy: Interval[];
  /** Admins: every customer. Customers: the customers their login belongs to. */
  customers: HubFileCustomer[];
  /** Admin view: create, edit and answer requests. For "supabase" decided on the server from the verified role; fixture changes never leave the browser. */
  canManage: boolean;
  /** Berlin day the calendar opens on and the instant that separates past from future. */
  today: string;
  now: number;
  error?: string;
};

export type CalendarActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

export type AppointmentInput = {
  title: string;
  description: string;
  customerId: string | null;
  day: string;
  start: string;
  minutes: number;
  teamsUrl: string;
};

export type RequestInput = { title: string; description: string; day: string; start: string; minutes: number };
