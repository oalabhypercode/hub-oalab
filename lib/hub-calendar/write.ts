import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { appointmentNotice } from "@/lib/hub-notify/rules";
import { notifyCustomers } from "@/lib/hub-notify/server";
import { cleanNote, dayOf, isDay, MAX_OPEN_REQUESTS, readAppointmentInput, readAvailabilityRequest, wallMinuteToUtc } from "./rules";
import { loadAvailability } from "./server";
import type { AppointmentInput, CalendarActionResult, RequestInput } from "./types";

// What the calendar writes once the caller has passed its checks, shared by the calendar's windows
// (lib/hub-calendar/actions.ts, the person's own session) and the Claude connector (lib/hub-mcp/writes.ts with the
// admin's claims, lib/hub-mcp/freelancer-writes.ts with a freelancer's). Row Level Security decides again, and the
// customer gets the same notice either way. Refreshing the page is the caller's business: only a Server Action can.

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

/**
 * A request for a free time in oalab's calendar, as a customer or a freelancer sends it („Termin anfragen“, and Claude
 * for a freelancer): on the login's own entry (hub_customer_members), checked against the day's availability, the
 * booked times with the buffer around them and the login's own open requests, at most MAX_OPEN_REQUESTS open at once.
 * The database checks the same again.
 */
export async function requestAppointmentAs(supabase: CalendarClient, userId: string, input: RequestInput): Promise<CalendarActionResult<{ id: string }>> {
  const membership = await supabase.from("hub_customer_members").select("customer_id").eq("user_id", userId).limit(1).maybeSingle();
  if (!membership.data) return { ok: false, error: "Dein Konto ist noch keinem Kunden zugeordnet. Bitte wende dich an dein oalab-Team." };
  const customerId = membership.data.customer_id as string;

  // The day's availability, its booked times (with the buffer around the day) and the customer's own open requests,
  // checked on the server so a stale browser view cannot double-book. The database checks the same rules again.
  if (!isDay(input?.day)) return { ok: false, error: "Bitte Datum und Uhrzeit angeben." };
  const day = input.day;
  const { availability } = await loadAvailability(supabase, false, day, day);
  const pad = availability.rules.buffer * 60_000;
  const range = { from: new Date(wallMinuteToUtc(day, 0) - pad).toISOString(), to: new Date(wallMinuteToUtc(day, 1440) + pad).toISOString() };
  const [busy, own] = await Promise.all([
    supabase.rpc("hub_calendar_busy", { range_start: range.from, range_end: range.to }),
    supabase.from("hub_appointments").select("starts_at, ends_at").eq("customer_id", customerId).eq("status", "requested").lt("starts_at", range.to).gt("ends_at", range.from),
  ]);
  if (busy.error || own.error) return { ok: false, error: "Die Verfügbarkeit konnte nicht geprüft werden. Bitte versuche es erneut." };
  const intervals = (rows: unknown) => ((rows ?? []) as { starts_at: string; ends_at: string }[]).map((row) => ({ start: Date.parse(row.starts_at), end: Date.parse(row.ends_at) }));
  const now = Date.now();
  const read = readAvailabilityRequest(input, availability, intervals(busy.data), intervals(own.data), now, dayOf(now));
  if (!read.ok) return read;
  const { title, description, interval } = read.value;

  const open = await supabase.from("hub_appointments").select("id", { count: "exact", head: true })
    .eq("customer_id", customerId).eq("status", "requested").gt("starts_at", new Date().toISOString());
  if ((open.count ?? 0) >= MAX_OPEN_REQUESTS) return { ok: false, error: `Du hast schon ${MAX_OPEN_REQUESTS} offene Anfragen. Bitte warte auf eine Antwort oder ziehe eine zurück.` };

  const { data, error } = await supabase.from("hub_appointments").insert({
    customer_id: customerId, title, description, status: "requested", created_by: userId,
    starts_at: new Date(interval.start).toISOString(), ends_at: new Date(interval.end).toISOString(),
  }).select("id").single();
  // The database's own check (row rule) refused: the time was taken or changed in the meantime.
  if (error?.code === "42501") return { ok: false, error: "Diese Zeit ist gerade nicht mehr frei. Bitte eine andere grüne Zeit wählen." };
  if (error || !data) return { ok: false, error: "Die Anfrage konnte nicht gesendet werden." };
  return { ok: true, data: { id: data.id } };
}

/** Withdraws an own request that oalab has not answered yet (the database function checks both). */
export async function withdrawRequestAs(supabase: CalendarClient, id: string): Promise<CalendarActionResult> {
  if (!uuid.test(String(id ?? ""))) return { ok: false, error: "Unbekannte Anfrage." };
  const { data, error } = await supabase.rpc("hub_withdraw_appointment_request", { appointment_id: id });
  if (error || data !== true) return { ok: false, error: "Die Anfrage konnte nicht zurückgezogen werden. Vielleicht wurde sie schon beantwortet." };
  return { ok: true, data: null };
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
