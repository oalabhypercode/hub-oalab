"use server";

import { refreshWorkspace } from "@/lib/refresh-workspace";
import { createClient } from "@/lib/supabase/server";
import { cleanNote, isDay, MAX_OPEN_REQUESTS, readAppointmentInput, readRequestInput, workWindow } from "./rules";
import type { AppointmentInput, CalendarActionResult, RequestInput } from "./types";
import { secondFactorMissing } from "@/lib/hub-auth/second-factor";

// Every action is a public POST endpoint: authenticate and authorise inside each one.
// Row Level Security in Supabase enforces the same rules a second time.

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const denied = { ok: false as const, error: "Dafür brauchst du einen echten Admin-Login." };
const unknownAppointment = { ok: false as const, error: "Unbekannter Termin." };

async function signedInClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  // A login with the e-mail code acts only after confirming it.
  if (await secondFactorMissing(supabase, data.claims.aal)) return null;
  const appMetadata = data.claims.app_metadata as Record<string, unknown> | undefined;
  return { supabase, userId: data.claims.sub, admin: appMetadata?.app_role === "oalab_admin" };
}

async function adminClient() {
  const session = await signedInClient();
  return session?.admin ? session.supabase : null;
}

/** Admin: create a confirmed appointment, or save an existing one (answering a request confirms it). */
export async function saveAppointment(id: string | null, input: AppointmentInput): Promise<CalendarActionResult<{ id: string }>> {
  const supabase = await adminClient();
  if (!supabase) return denied;
  if (id !== null && !uuid.test(String(id))) return unknownAppointment;
  const read = readAppointmentInput(input);
  if (!read.ok) return read;
  const { title, description, customerId, interval, teamsUrl } = read.value;
  if (customerId && !uuid.test(customerId)) return { ok: false, error: "Unbekannter Kunde." };
  const row = {
    title, description, customer_id: customerId, teams_url: teamsUrl, status: "confirmed", response_note: "",
    starts_at: new Date(interval.start).toISOString(), ends_at: new Date(interval.end).toISOString(),
  };
  const { data, error } = id
    ? await supabase.from("hub_appointments").update(row).eq("id", id).select("id").maybeSingle()
    : await supabase.from("hub_appointments").insert(row).select("id").single();
  if (error || !data) return { ok: false, error: "Der Termin konnte nicht gespeichert werden." };
  refreshWorkspace();
  return { ok: true, data: { id: data.id } };
}

/** Admin: decline a request or cancel an appointment; the note is shown to the customer. */
export async function closeAppointment(id: string, status: "declined" | "cancelled", note: string): Promise<CalendarActionResult> {
  const supabase = await adminClient();
  if (!supabase) return denied;
  if (!uuid.test(String(id ?? "")) || (status !== "declined" && status !== "cancelled")) return unknownAppointment;
  const { data, error } = await supabase.from("hub_appointments").update({ status, response_note: cleanNote(note) }).eq("id", id).select("id").maybeSingle();
  if (error || !data) return { ok: false, error: "Der Termin konnte nicht geändert werden." };
  refreshWorkspace();
  return { ok: true, data: null };
}

/** Admin: remove an appointment completely. */
export async function deleteAppointment(id: string): Promise<CalendarActionResult> {
  const supabase = await adminClient();
  if (!supabase) return denied;
  if (!uuid.test(String(id ?? ""))) return unknownAppointment;
  const { error } = await supabase.from("hub_appointments").delete().eq("id", id);
  if (error) return { ok: false, error: "Der Termin konnte nicht gelöscht werden." };
  refreshWorkspace();
  return { ok: true, data: null };
}

/** Customer: ask for an appointment in a free slot of the OALAB calendar. */
export async function requestAppointment(input: RequestInput): Promise<CalendarActionResult<{ id: string }>> {
  const session = await signedInClient();
  if (!session) return { ok: false, error: "Terminanfragen sind nur mit echtem Login möglich." };
  const { supabase, userId } = session;

  const membership = await supabase.from("hub_customer_members").select("customer_id").eq("user_id", userId).limit(1).maybeSingle();
  if (!membership.data) return { ok: false, error: "Dein Konto ist noch keinem Kunden zugeordnet. Bitte wende dich an dein OALAB-Team." };
  const customerId = membership.data.customer_id as string;

  // The day's booked times and the customer's own open requests, checked on the server so a stale browser view cannot double-book.
  const window = isDay(input?.day) ? workWindow(input.day) : null;
  const range = window ? { from: new Date(window.start).toISOString(), to: new Date(window.end).toISOString() } : null;
  const [busy, own] = range ? await Promise.all([
    supabase.rpc("hub_calendar_busy", { range_start: range.from, range_end: range.to }),
    supabase.from("hub_appointments").select("starts_at, ends_at").eq("customer_id", customerId).eq("status", "requested").lt("starts_at", range.to).gt("ends_at", range.from),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  if (busy.error || own.error) return { ok: false, error: "Die Verfügbarkeit konnte nicht geprüft werden. Bitte versuche es erneut." };
  const intervals = ([...(busy.data ?? []), ...(own.data ?? [])] as { starts_at: string; ends_at: string }[]).map((row) => ({ start: Date.parse(row.starts_at), end: Date.parse(row.ends_at) }));
  const read = readRequestInput(input, intervals, Date.now());
  if (!read.ok) return read;
  const { title, description, interval } = read.value;

  const open = await supabase.from("hub_appointments").select("id", { count: "exact", head: true })
    .eq("customer_id", customerId).eq("status", "requested").gt("starts_at", new Date().toISOString());
  if ((open.count ?? 0) >= MAX_OPEN_REQUESTS) return { ok: false, error: `Du hast schon ${MAX_OPEN_REQUESTS} offene Anfragen. Bitte warte auf eine Antwort oder ziehe eine zurück.` };

  const { data, error } = await supabase.from("hub_appointments").insert({
    customer_id: customerId, title, description, status: "requested", created_by: userId,
    starts_at: new Date(interval.start).toISOString(), ends_at: new Date(interval.end).toISOString(),
  }).select("id").single();
  if (error || !data) return { ok: false, error: "Die Anfrage konnte nicht gesendet werden." };
  refreshWorkspace();
  return { ok: true, data: { id: data.id } };
}

/** Customer: withdraw an own request that OALAB has not answered yet. */
export async function withdrawRequest(id: string): Promise<CalendarActionResult> {
  const session = await signedInClient();
  if (!session) return { ok: false, error: "Nur mit echtem Login möglich." };
  if (!uuid.test(String(id ?? ""))) return { ok: false, error: "Unbekannte Anfrage." };
  const { data, error } = await session.supabase.rpc("hub_withdraw_appointment_request", { appointment_id: id });
  if (error || data !== true) return { ok: false, error: "Die Anfrage konnte nicht zurückgezogen werden. Vielleicht wurde sie schon beantwortet." };
  refreshWorkspace();
  return { ok: true, data: null };
}
