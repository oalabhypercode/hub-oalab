import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { appointmentNotice } from "@/lib/hub-notify/rules";
import { notifyCustomers } from "@/lib/hub-notify/server";
import { cleanNote, readAppointmentInput } from "./rules";
import type { AppointmentInput, CalendarActionResult } from "./types";

// What the calendar writes for an admin who has passed the checks, shared by the appointment window
// (lib/hub-calendar/actions.ts, the admin's own session) and the Claude connector (lib/hub-mcp/writes.ts, a key with
// the admin's claims). Row Level Security decides again, and the customer gets the same notice either way. Refreshing
// the page is the caller's business: only a Server Action can do it.

export type CalendarClient = Awaited<ReturnType<typeof createClient>>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const unknownAppointment = { ok: false as const, error: "Unbekannter Termin." };

/** Creates a confirmed appointment, or saves an existing one (answering a request confirms it). */
export async function writeAppointment(supabase: CalendarClient, id: string | null, input: AppointmentInput): Promise<CalendarActionResult<{ id: string }>> {
  if (id !== null && !uuid.test(String(id))) return unknownAppointment;
  const read = readAppointmentInput(input);
  if (!read.ok) return read;
  const { title, description, customerId, interval, teamsUrl } = read.value;
  if (customerId && !uuid.test(customerId)) return { ok: false, error: "Unbekannter Kunde." };
  const row = {
    title, description, customer_id: customerId, teams_url: teamsUrl, status: "confirmed", response_note: "",
    starts_at: new Date(interval.start).toISOString(), ends_at: new Date(interval.end).toISOString(),
  };
  // The state before saving decides the customer's notice: new, confirmed request or moved.
  const before = id ? (await supabase.from("hub_appointments").select("status, starts_at, customer_id").eq("id", id).maybeSingle<{ status: string; starts_at: string; customer_id: string | null }>()).data : null;
  const { data, error } = id
    ? await supabase.from("hub_appointments").update(row).eq("id", id).select("id").maybeSingle()
    : await supabase.from("hub_appointments").insert(row).select("id").single();
  if (error || !data) return { ok: false, error: "Der Termin konnte nicht gespeichert werden." };
  const sameCustomer = before && before.customer_id === customerId ? { status: before.status, startsAt: before.starts_at } : null;
  const notice = customerId ? appointmentNotice({ id: data.id, title, startsAt: row.starts_at, before: sameCustomer, status: "confirmed" }) : null;
  if (customerId && notice) await notifyCustomers([customerId], notice);
  return { ok: true, data: { id: data.id } };
}

/** Declines a request or cancels an appointment; the note is shown to the customer. */
export async function closeAppointmentAs(supabase: CalendarClient, id: string, status: "declined" | "cancelled", note: string): Promise<CalendarActionResult> {
  if (!uuid.test(String(id ?? "")) || (status !== "declined" && status !== "cancelled")) return unknownAppointment;
  const { data, error } = await supabase.from("hub_appointments").update({ status, response_note: cleanNote(note) }).eq("id", id)
    .select("id, title, starts_at, customer_id").maybeSingle<{ id: string; title: string; starts_at: string; customer_id: string | null }>();
  if (error || !data) return { ok: false, error: "Der Termin konnte nicht geändert werden." };
  const notice = data.customer_id ? appointmentNotice({ id: data.id, title: data.title, startsAt: data.starts_at, before: null, status, note: cleanNote(note) }) : null;
  if (data.customer_id && notice) await notifyCustomers([data.customer_id], notice);
  return { ok: true, data: null };
}
