import type { HubFileCustomer } from "../hub-files/types";
import type { AppointmentStatus, Availability, Interval } from "./rules";
import type { FeedClient, FeedOptions, FeedRole } from "./feed-rules";

/** A login's active subscription without its key: what is in it, since when, when and with what it was fetched last. */
export type FeedView = { id: string; options: FeedOptions; createdAt: string; lastFetchedAt: string | null; lastClient: FeedClient | null };

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
 * "fixtures": the preview; changes stay in the browser and are never stored.
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
  /**
   * Admins: whether this session confirmed a code (aal2). Tasks are Studio's rows, and Studio changes them only for such
   * a session; without it the calendar shows tasks read-only and offers „Mit Code bestätigen“ (like the task board).
   */
  confirmed?: boolean;
  /**
   * When oalab offers appointments: weekly plan, exceptions (admins with their notes, customers without) and the rules
   * for requests. Before the migration (or when it cannot be read) the fixed hours as before.
   */
  availability: Availability;
  /** False while the database has no availability yet: the calendar uses the fixed hours, the admin cannot save. */
  availabilityReady: boolean;
  /** Berlin day the calendar opens on and the instant that separates past from future. */
  today: string;
  now: number;
  /**
   * The login's calendar subscription for the button in the head („Abonnieren“ or „Abonniert“). Missing in the preview
   * and where it is not set up; the panel loads the rest itself (lib/hub-calendar/actions.ts loadCalendarFeed).
   */
  feed?: { active: boolean };
  /**
   * Admins only: busy times from the team's other calendars (iCloud, Microsoft 365), shown as grey blocks „Privat“ with
   * where they come from. Customers get them inside `busy`, without any origin.
   */
  privateBusy?: { start: number; end: number; source: string }[];
  error?: string;
};

/** The calendar subscription as the panel and the profile card see it (never the link, which shows only once). */
export type CalendarFeedState = {
  ready: boolean;
  role: FeedRole;
  /** Admins and freelancers confirm a code before creating a feed (aal2). */
  needsCode: boolean;
  feed: FeedView | null;
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
