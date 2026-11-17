"use server";

import { refreshWorkspace } from "@/lib/refresh-workspace";
import { createClient } from "@/lib/supabase/server";
import {
  cleanRules, cleanWeek, dayOf, isDay, MAX_OPEN_REQUESTS, readAvailabilityRequest, readException, wallMinuteToUtc,
  type ExceptionInput,
} from "./rules";
import { loadAvailability } from "./server";
import type { AppointmentInput, CalendarActionResult, RequestInput } from "./types";
import { closeAppointmentAs, unknownAppointment, writeAppointment } from "./write";
import { secondFactorMissing } from "@/lib/hub-auth/second-factor";

// Every action is a public POST endpoint: authenticate and authorise inside each one.
// Row Level Security in Supabase enforces the same rules a second time. Saving and closing an appointment run through
// lib/hub-calendar/write.ts, which the Claude connector uses as well.

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const denied = { ok: false as const, error: "Dafür brauchst du einen echten Admin-Login." };

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
  const result = await writeAppointment(supabase, id, input);
  if (result.ok) refreshWorkspace();
  return result;
}

/** Admin: decline a request or cancel an appointment; the note is shown to the customer. */
export async function closeAppointment(id: string, status: "declined" | "cancelled", note: string): Promise<CalendarActionResult> {
  const supabase = await adminClient();
  if (!supabase) return denied;
  const result = await closeAppointmentAs(supabase, id, status, note);
  if (result.ok) refreshWorkspace();
  return result;
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

/** Customer: ask for an appointment in a free slot of the oalab calendar. */
export async function requestAppointment(input: RequestInput): Promise<CalendarActionResult<{ id: string }>> {
  const session = await signedInClient();
  if (!session) return { ok: false, error: "Terminanfragen sind nur mit echtem Login möglich." };
  const { supabase, userId } = session;

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
  refreshWorkspace();
  return { ok: true, data: { id: data.id } };
}

/* ---------- Admins: when oalab offers appointments (weekly plan, rules, exceptions) ---------- */

const notReady = { ok: false as const, error: "Die Verfügbarkeit ist in der Datenbank noch nicht eingerichtet. Die Migration steht noch aus." };
const missingTable = (error: { code?: string } | null) => error?.code === "42P01" || error?.code === "PGRST205" || error?.code === "PGRST202";

/** Admin: the weekly plan, Monday to Sunday; it applies to every week from now on. */
export async function saveAvailabilityWeek(week: unknown): Promise<CalendarActionResult> {
  const supabase = await adminClient();
  if (!supabase) return denied;
  const clean = cleanWeek(week);
  if (!clean) return { ok: false, error: "Der Wochenplan passt nicht: Zeiten im Viertelstunden-Raster, von vor bis, höchstens acht Zeiträume am Tag." };
  const { data, error } = await supabase.from("hub_calendar_settings").update({ week: clean }).eq("id", true).select("id").maybeSingle();
  if (missingTable(error)) return notReady;
  if (error || !data) return { ok: false, error: "Der Wochenplan konnte nicht gespeichert werden." };
  refreshWorkspace();
  return { ok: true, data: null };
}

/** Admin: lead time, buffer, how far ahead and which durations customers choose from. */
export async function saveAvailabilityRules(rules: unknown): Promise<CalendarActionResult> {
  const supabase = await adminClient();
  if (!supabase) return denied;
  const clean = cleanRules(rules);
  if (!clean) return { ok: false, error: "Diese Regeln passen nicht. Bitte die angebotenen Werte und mindestens eine Dauer wählen." };
  const { data, error } = await supabase.from("hub_calendar_settings")
    .update({ notice_minutes: clean.notice, buffer_minutes: clean.buffer, horizon_weeks: clean.horizon, durations: clean.durations })
    .eq("id", true).select("id").maybeSingle();
  if (missingTable(error)) return notReady;
  if (error || !data) return { ok: false, error: "Die Regeln konnten nicht gespeichert werden." };
  refreshWorkspace();
  return { ok: true, data: null };
}

/** Admin: an absence (one or more days, whole day or a span) or extra time on one day; the note stays internal. */
export async function addAvailabilityException(input: ExceptionInput): Promise<CalendarActionResult<{ count: number }>> {
  const supabase = await adminClient();
  if (!supabase) return denied;
  const read = readException(input, dayOf(Date.now()));
  if (!read.ok) return read;
  if (!read.rows.length) return { ok: false, error: "Diese Tage liegen in der Vergangenheit." };
  const { data, error } = await supabase.from("hub_calendar_exceptions")
    .insert(read.rows.map((row) => ({ day: row.day, kind: row.kind, from_minute: row.from, to_minute: row.to, note: row.note })))
    .select("id");
  if (missingTable(error)) return notReady;
  if (error || !data) return { ok: false, error: "Die Ausnahme konnte nicht gespeichert werden." };
  refreshWorkspace();
  return { ok: true, data: { count: data.length } };
}

/** Admin: removes an absence or extra time again. */
export async function removeAvailabilityException(id: string): Promise<CalendarActionResult> {
  const supabase = await adminClient();
  if (!supabase) return denied;
  if (!uuid.test(String(id ?? ""))) return { ok: false, error: "Unbekannte Ausnahme." };
  const { error } = await supabase.from("hub_calendar_exceptions").delete().eq("id", id);
  if (missingTable(error)) return notReady;
  if (error) return { ok: false, error: "Die Ausnahme konnte nicht entfernt werden." };
  refreshWorkspace();
  return { ok: true, data: null };
}

/** Customer: withdraw an own request that oalab has not answered yet. */
export async function withdrawRequest(id: string): Promise<CalendarActionResult> {
  const session = await signedInClient();
  if (!session) return { ok: false, error: "Nur mit echtem Login möglich." };
  if (!uuid.test(String(id ?? ""))) return { ok: false, error: "Unbekannte Anfrage." };
  const { data, error } = await session.supabase.rpc("hub_withdraw_appointment_request", { appointment_id: id });
  if (error || data !== true) return { ok: false, error: "Die Anfrage konnte nicht zurückgezogen werden. Vielleicht wurde sie schon beantwortet." };
  refreshWorkspace();
  return { ok: true, data: null };
}
