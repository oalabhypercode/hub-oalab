import "server-only";
import { createClient } from "@/lib/supabase/server";
import { calendarWindow, isAppointmentStatus } from "./rules";
import type { HubFileCustomer } from "../hub-files/types";
import type { HubAppointment, HubCalendarState } from "./types";

type CustomerRow = { id: string; customer_number: string; company: string };
type AppointmentRow = {
  id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  status: string;
  teams_url: string | null;
  response_note: string;
  customer: CustomerRow | null;
};
type BusyRow = { starts_at: string; ends_at: string };

const toCustomer = (row: CustomerRow): HubFileCustomer => ({ id: row.id, customerNumber: row.customer_number, company: row.company });

export function describeCalendarError(error: { code?: string; message?: string }) {
  if (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST202" || /hub_appointments|hub_calendar_busy|schema cache/i.test(error.message ?? "")) {
    return "Der Kalender ist in Supabase noch nicht eingerichtet. Die Migration steht noch aus.";
  }
  return "Der Kalender konnte gerade nicht geladen werden. Bitte versuche es erneut.";
}

/**
 * Calendar of the signed-in Supabase user for the browsable window around `today`.
 * Row Level Security decides: admins see every appointment, customers only their own;
 * the busy times of the whole calendar come without details from hub_calendar_busy().
 */
export async function loadHubCalendar(today: string): Promise<HubCalendarState> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const canManage = (claims?.claims.app_metadata as Record<string, unknown> | undefined)?.app_role === "oalab_admin";
  const window = calendarWindow(today);
  const from = new Date(window.from).toISOString();
  const to = new Date(window.to).toISOString();
  const base = { source: "supabase" as const, canManage, today, now: Date.now() };

  const [appointments, customers, busy] = await Promise.all([
    supabase
      .from("hub_appointments")
      .select("id, title, description, starts_at, ends_at, status, teams_url, response_note, customer:hub_customers(id, customer_number, company)")
      .lt("starts_at", to)
      .gt("ends_at", from)
      .order("starts_at")
      .returns<AppointmentRow[]>(),
    supabase.from("hub_customers").select("id, customer_number, company").order("customer_number").returns<CustomerRow[]>(),
    canManage ? Promise.resolve({ data: [] as BusyRow[], error: null }) : supabase.rpc("hub_calendar_busy", { range_start: from, range_end: to }),
  ]);
  const error = appointments.error ?? busy.error;
  if (error) return { ...base, appointments: [], busy: [], customers: [], error: describeCalendarError(error) };

  return {
    ...base,
    customers: (customers.data ?? []).map(toCustomer),
    busy: ((busy.data ?? []) as BusyRow[]).map((row) => ({ start: Date.parse(row.starts_at), end: Date.parse(row.ends_at) })),
    appointments: (appointments.data ?? []).map((row): HubAppointment => ({
      id: row.id,
      title: row.title,
      description: row.description,
      start: Date.parse(row.starts_at),
      end: Date.parse(row.ends_at),
      status: isAppointmentStatus(row.status) ? row.status : "requested",
      teamsUrl: row.teams_url,
      responseNote: row.response_note,
      customer: row.customer ? toCustomer(row.customer) : null,
    })),
  };
}

/** Real calendar for a signed-in Supabase user; public demo identities keep their fixtures. */
export async function loadCalendarForIdentity(identity: { publicDemo: boolean }, today: string) {
  return identity.publicDemo ? undefined : loadHubCalendar(today);
}
