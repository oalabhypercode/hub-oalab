"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import { createClient } from "@/lib/supabase/server";
import { siteOrigin } from "@/lib/site-origin";
import { cleanRules, cleanWeek, dayOf, readException, type ExceptionInput } from "./rules";
import type { AppointmentInput, CalendarActionResult, CalendarFeedState, RequestInput } from "./types";
import { closeAppointmentAs, requestAppointmentAs, unknownAppointment, withdrawRequestAs, writeAppointment } from "./write";
import { secondFactorMissing } from "@/lib/hub-auth/second-factor";
import { feedOptionsFor, feedRoleOf, feedUrl, type FeedRole } from "./feed";
import { activeFeed, createFeed, endFeedsOf, feedReady, logFeedEvent, saveFeedOptions, type FeedView } from "./feed-store";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { vaultKey } from "@/lib/hub-vault/key";
import {
  microsoftConfig, microsoftMailboxes, readCalendarLink, readMailbox, readSourceName, readSourceRules, sourceLabel, type SourceView,
} from "./sources-rules";
import { deleteSource, insertLinkSource, insertMailboxSource, listSources, missingSourcesTable, replaceLink, saveRules, sourcesClient, syncCalendarSources } from "./sources-store";

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

/** Customer or freelancer: withdraw an own request that oalab has not answered yet (lib/hub-calendar/write.ts). */
export async function withdrawRequest(id: string): Promise<CalendarActionResult> {
  const session = await signedInClient();
  if (!session) return { ok: false, error: "Nur mit echtem Login möglich." };
  const result = await withdrawRequestAs(session.supabase, id);
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

/* ---------- Admins: other calendars that block time (Verfügbarkeit › Andere Kalender berücksichtigen) ---------- */

/** What the section shows: the sources (never a link), whether links can be sealed and Microsoft 365 is set up. */
export type CalendarSourcesState = {
  sources: SourceView[];
  /** HUB_VAULT_KEY is set: links can be stored. */
  vault: boolean;
  microsoft: { configured: boolean; mailboxes: { address: string; own: boolean }[] };
};

const sourcesDenied = { ok: false as const, error: "Andere Kalender legt nur das oalab-Team fest." };
const sourcesMissing = { ok: false as const, error: "Für andere Kalender fehlt noch die Erweiterung der Datenbank. Die Migration steht noch aus." };
const uuidOf = (value: unknown) => (typeof value === "string" && uuid.test(value) ? value : null);

/** The checked admin with the service role and their sign-in address (their own mailbox to choose). */
async function sourcesAdmin() {
  const admin = await verifyHubAdmin();
  const db = admin ? sourcesClient() : null;
  if (!admin || !db) return null;
  const { data } = await (await createClient()).auth.getClaims();
  return { ...admin, db, email: typeof data?.claims.email === "string" ? data.claims.email : null };
}

async function sourcesState(admin: NonNullable<Awaited<ReturnType<typeof sourcesAdmin>>>): Promise<CalendarActionResult<CalendarSourcesState>> {
  const { sources, error } = await listSources(admin.db, admin.userId);
  if (error) return missingSourcesTable(error) ? sourcesMissing : { ok: false, error: "Die anderen Kalender konnten gerade nicht geladen werden." };
  return {
    ok: true,
    data: { sources, vault: Boolean(vaultKey()), microsoft: { configured: Boolean(microsoftConfig(process.env)), mailboxes: microsoftMailboxes(process.env, admin.email) } },
  };
}

async function logSource(admin: { userId: string; db: NonNullable<ReturnType<typeof sourcesClient>> }, action: `calendar.source_${string}`, summary: string) {
  await admin.db.from("hub_admin_events").insert({ actor_id: admin.userId, action, summary: summary.slice(0, 300) }).then(() => undefined, () => undefined);
}

export async function loadCalendarSources(): Promise<CalendarActionResult<CalendarSourcesState>> {
  const admin = await sourcesAdmin();
  return admin ? sourcesState(admin) : sourcesDenied;
}

/**
 * „Hinzufügen“: a public calendar link from iCloud (or published in Outlook), sealed with the vault key, or a mailbox in
 * Microsoft 365. The first busy times are read right after the answer; the schedule keeps them current.
 */
export async function addCalendarSource(input: { kind?: unknown; link?: unknown; name?: unknown; mailbox?: unknown; rules?: unknown }): Promise<CalendarActionResult<CalendarSourcesState>> {
  const admin = await sourcesAdmin();
  if (!admin) return sourcesDenied;
  const rules = readSourceRules(input?.rules);
  let written;
  if (input?.kind === "microsoft") {
    if (!microsoftConfig(process.env)) return { ok: false, error: "Die Verbindung zu Microsoft 365 ist auf dem Server noch nicht eingerichtet." };
    const mailbox = readMailbox(input.mailbox);
    if (!mailbox) return { ok: false, error: "Bitte ein Postfach wählen oder seine Adresse eingeben." };
    written = await insertMailboxSource(admin.db, admin.userId, { mailbox, name: readSourceName(input.name, mailbox), rules });
  } else {
    const link = readCalendarLink(input?.link);
    if (!link.ok) return link;
    written = await insertLinkSource(admin.db, admin.userId, { url: link.url, provider: link.provider, name: readSourceName(input?.name, link.provider === "icloud" ? "iCloud-Kalender" : "Outlook-Kalender"), rules });
  }
  if (!written.ok) return written;
  const id = written.id;
  await logSource(admin, "calendar.source_added", "Anderer Kalender für die Verfügbarkeit hinzugefügt");
  after(() => syncCalendarSources({ only: id }).then(() => undefined, () => undefined));
  refreshWorkspace();
  return sourcesState(admin);
}

/** The rules of one source; they apply from the next read, which comes at once. */
export async function saveCalendarSourceRules(id: unknown, rules: unknown): Promise<CalendarActionResult<CalendarSourcesState>> {
  const admin = await sourcesAdmin();
  if (!admin) return sourcesDenied;
  const sourceId = uuidOf(id);
  const saved = sourceId ? await saveRules(admin.db, sourceId, readSourceRules(rules)) : null;
  if (!saved) return { ok: false, error: "Diesen Kalender gibt es nicht mehr." };
  after(() => syncCalendarSources({ only: saved.id }).then(() => undefined, () => undefined));
  return sourcesState(admin);
}

/** „Link neu einfügen“: a new public link for a source that stopped working. */
export async function replaceCalendarSourceLink(id: unknown, link: unknown): Promise<CalendarActionResult<CalendarSourcesState>> {
  const admin = await sourcesAdmin();
  if (!admin) return sourcesDenied;
  const sourceId = uuidOf(id);
  const checked = readCalendarLink(link);
  if (!checked.ok) return checked;
  const written = sourceId ? await replaceLink(admin.db, sourceId, { url: checked.url, provider: checked.provider }) : { ok: false as const, error: "Diesen Kalender gibt es nicht mehr." };
  if (!written.ok) return written;
  await logSource(admin, "calendar.source_link", "Neuer Link für einen anderen Kalender der Verfügbarkeit");
  after(() => syncCalendarSources({ only: written.id }).then(() => undefined, () => undefined));
  return sourcesState(admin);
}

/** „Entfernen“: the source and its busy times are gone; they block nothing from now on. */
export async function removeCalendarSource(id: unknown): Promise<CalendarActionResult<CalendarSourcesState>> {
  const admin = await sourcesAdmin();
  if (!admin) return sourcesDenied;
  const sourceId = uuidOf(id);
  const removed = sourceId ? await deleteSource(admin.db, sourceId) : null;
  if (!removed) return { ok: false, error: "Diesen Kalender gibt es nicht mehr." };
  await logSource(admin, "calendar.source_removed", `Anderer Kalender „${sourceLabel(removed)}“ aus der Verfügbarkeit entfernt`);
  refreshWorkspace();
  return sourcesState(admin);
}
