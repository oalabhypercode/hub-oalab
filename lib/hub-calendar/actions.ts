"use server";

import { headers } from "next/headers";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import { createClient } from "@/lib/supabase/server";
import { siteOrigin } from "@/lib/site-origin";
import { cleanRules, cleanWeek, dayOf, type ExceptionInput } from "./rules";
import type { AppointmentInput, CalendarActionResult, CalendarFeedState, RequestInput } from "./types";
import { addAvailabilityExceptionAs, closeAppointmentAs, requestAppointmentAs, unknownAppointment, withdrawRequestAs, writeAppointment } from "./write";
import { settleAppointmentRequest } from "@/lib/hub-notify/server";
import { secondFactorMissing } from "@/lib/hub-auth/second-factor";
import { feedOptionsFor, feedRoleOf, feedUrl, type FeedRole } from "./feed";
import { activeFeed, createFeed, endFeedsOf, feedReady, logFeedEvent, saveFeedOptions, type FeedView } from "./feed-store";

// Every action is a public POST endpoint: authenticate and authorise inside each one.
// Row Level Security in Supabase enforces the same rules a second time. Saving and closing an appointment, requests and
// withdrawing them run through lib/hub-calendar/write.ts, which the Claude connector uses as well.

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const denied = { ok: false as const, error: "Dafür brauchst du einen echten Admin-Login." };

async function signedInClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  // A login with the e-mail code acts only after confirming it.
  if (await secondFactorMissing(supabase, data.claims.aal)) return null;
  const appMetadata = data.claims.app_metadata as Record<string, unknown> | undefined;
  return { supabase, userId: data.claims.sub, admin: appMetadata?.app_role === "oalab_admin", role: appMetadata?.app_role, aal: data.claims.aal };
}

async function adminClient() {
  const session = await signedInClient();
  return session?.admin ? session.supabase : null;
}

/** Admin: create a confirmed appointment, or save an existing one (answering a request confirms it). */
export async function saveAppointment(id: string | null, input: AppointmentInput): Promise<CalendarActionResult<{ id: string }>> {
  const session = await signedInClient();
  if (!session?.admin) return denied;
  // The admin's id names them on the customer's chat card.
  const result = await writeAppointment(session.supabase, id, input, session.userId);
  if (result.ok) refreshWorkspace();
  return result;
}

/** Admin: decline a request or cancel an appointment; the note is shown to the customer. */
export async function closeAppointment(id: string, status: "declined" | "cancelled", note: string): Promise<CalendarActionResult> {
  const session = await signedInClient();
  if (!session?.admin) return denied;
  const result = await closeAppointmentAs(session.supabase, id, status, note, session.userId);
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
  // A deleted request leaves the admins' bell as well.
  await settleAppointmentRequest(id);
  refreshWorkspace();
  return { ok: true, data: null };
}

/** Customer or freelancer: ask for an appointment in a free slot of the oalab calendar (lib/hub-calendar/write.ts). */
export async function requestAppointment(input: RequestInput): Promise<CalendarActionResult<{ id: string }>> {
  const session = await signedInClient();
  if (!session) return { ok: false, error: "Terminanfragen sind nur mit echtem Login möglich." };
  const result = await requestAppointmentAs(session.supabase, session.userId, input);
  if (result.ok) refreshWorkspace();
  return result;
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
  const result = await addAvailabilityExceptionAs(supabase, input, dayOf(Date.now()));
  if (!result.ok) return result;
  refreshWorkspace();
  return { ok: true, data: { count: result.data.count } };
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

/** Customer or freelancer: withdraw an own request that oalab has not answered yet (lib/hub-calendar/write.ts). */
export async function withdrawRequest(id: string): Promise<CalendarActionResult> {
  const session = await signedInClient();
  if (!session) return { ok: false, error: "Nur mit echtem Login möglich." };
  const result = await withdrawRequestAs(session.supabase, id, session.userId);
  if (result.ok) refreshWorkspace();
  return result;
}

/* ---------- Everyone: the calendar subscription („Kalender-Abo“, lib/hub-calendar/feed*.ts) ---------- */

const feedOff = { ok: false as const, error: "Das Kalender-Abo ist hier nicht eingerichtet." };
const feedFailed = { ok: false as const, error: "Das hat gerade nicht geklappt. Bitte versuche es erneut." };
const feedMissing = { ok: false as const, error: "Für das Kalender-Abo fehlt noch die Erweiterung der Datenbank." };
const needsCode = { ok: false as const, error: "Bitte bestätige zuerst deinen Code. Der Link liest danach ohne Anmeldung." };
const tableMissing = (error: unknown) => (error as { code?: string } | null)?.code === "42P01";

/**
 * The signed-in login for its own subscription: any active login of the hub (admin, customer, freelancer) whose code is
 * confirmed where it has one. `confirmed`: the session confirmed a code (aal2), which admins and freelancers need to
 * create a feed (decision 4), since its link reads without signing in afterwards.
 */
async function feedLogin(): Promise<{ userId: string; role: FeedRole; confirmed: boolean } | null> {
  const session = await signedInClient();
  const role = feedRoleOf(session?.role);
  if (!session || !role) return null;
  const { data: profile, error } = await session.supabase.from("hub_profiles").select("status").eq("user_id", session.userId).maybeSingle<{ status: string }>();
  if (error || profile?.status !== "active") return null;
  return { userId: session.userId, role, confirmed: session.aal === "aal2" };
}

const stateOf = (login: { role: FeedRole; confirmed: boolean }, feed: FeedView | null): CalendarFeedState =>
  ({ ready: true, role: login.role, needsCode: login.role !== "customer" && !login.confirmed, feed });

/** The panel and the profile card: whether a feed is active, what is in it and when it was fetched last; never the link. */
export async function loadCalendarFeed(): Promise<CalendarActionResult<CalendarFeedState>> {
  const login = await feedLogin();
  if (!login) return { ok: false, error: "Das Kalender-Abo gibt es nur mit echtem Login." };
  if (!feedReady()) return feedOff;
  try {
    return { ok: true, data: stateOf(login, await activeFeed(login.userId, login.role)) };
  } catch (error) {
    return tableMissing(error) ? feedMissing : feedFailed;
  }
}

/**
 * „Abo anlegen“ and „Neuen Link erzeugen“: a new key, shown this once as the feed's address; an existing link stops at
 * once. Admins and freelancers only with a confirmed code. `options` null keeps what the active feed had.
 */
export async function createCalendarFeed(options: unknown): Promise<CalendarActionResult<{ url: string; state: CalendarFeedState }>> {
  const login = await feedLogin();
  if (!login) return { ok: false, error: "Das Kalender-Abo gibt es nur mit echtem Login." };
  if (!feedReady()) return feedOff;
  if (login.role !== "customer" && !login.confirmed) return needsCode;
  try {
    const current = options === null ? await activeFeed(login.userId, login.role) : null;
    const chosen = feedOptionsFor(login.role, options === null ? current?.options : options);
    const created = await createFeed(login.userId, login.role, chosen);
    await logFeedEvent(login.userId, login.userId, created.renewed ? "calendar.feed_renewed" : "calendar.feed_created",
      created.renewed ? "Kalender-Abo: neuen Link erzeugt, der alte geht nicht mehr" : "Kalender-Abo angelegt");
    const origin = siteOrigin(await headers()) ?? "https://hub.oalab.de";
    return { ok: true, data: { url: feedUrl(origin, created.token), state: stateOf(login, created.view) } };
  } catch (error) {
    return tableMissing(error) ? feedMissing : feedFailed;
  }
}

/** The switches in the panel: what is in the feed from the next fetch on. */
export async function saveCalendarFeedOptions(options: unknown): Promise<CalendarActionResult<CalendarFeedState>> {
  const login = await feedLogin();
  if (!login) return { ok: false, error: "Das Kalender-Abo gibt es nur mit echtem Login." };
  if (!feedReady()) return feedOff;
  try {
    const view = await saveFeedOptions(login.userId, login.role, feedOptionsFor(login.role, options));
    if (!view) return { ok: false, error: "Es gibt kein aktives Abo mehr. Leg es neu an." };
    return { ok: true, data: stateOf(login, view) };
  } catch (error) {
    return tableMissing(error) ? feedMissing : feedFailed;
  }
}

/** „Abo beenden“: the link stops at once; the calendar „oalab“ stays in the apps without anything new. */
export async function endCalendarFeed(): Promise<CalendarActionResult<CalendarFeedState>> {
  const login = await feedLogin();
  if (!login) return { ok: false, error: "Das Kalender-Abo gibt es nur mit echtem Login." };
  if (!feedReady()) return feedOff;
  try {
    if (await endFeedsOf(login.userId)) await logFeedEvent(login.userId, login.userId, "calendar.feed_ended", "Kalender-Abo beendet");
    return { ok: true, data: stateOf(login, null) };
  } catch (error) {
    return tableMissing(error) ? feedMissing : feedFailed;
  }
}
