import "server-only";
import { loadArchive } from "@/lib/hub-archive/server";
import { secondFactorMissing } from "@/lib/hub-auth/second-factor";
import { customerFree, dayOf, isDay, lastRequestDay, startsIn, wallMinuteToUtc } from "@/lib/hub-calendar/rules";
import { loadAvailability } from "@/lib/hub-calendar/server";
import { requestAppointmentAs, writeAppointment, type CalendarClient } from "@/lib/hub-calendar/write";
import { appointmentView } from "./refs";
import { isUuid, noteText, positionAfter, validateNoteDoc } from "./rules";
import { notesContext, notesCustomers, notesMissing, readPage, SETTINGS_COLUMNS, toSettings, type NotesContext } from "./server";
import { noteTemplate } from "./templates";
import { fail, logNoteEvent, noteError } from "./write";
import { NO_CALENDAR_NOTES, type CalendarNotes, type NoteAppointmentView, type NotePage, type NoteRequestSlots, type NoteResult } from "./types";

// The notes and the calendar (plan 5, step 3): appointments as blocks in a note, a meeting note from an appointment,
// an appointment from a note (the team enters it, customers and freelancers ask for one) and pages with a date in the
// calendar. Everything reads and writes with the person's own session, so the calendar's rules decide as everywhere;
// appointments are written through the calendar's own code (lib/hub-calendar/write.ts) with its notices.

type PageRow = { id: string; title: string; icon: string; customer_id: string; dated_on: string | null; appointment_id: string | null };

/**
 * For the calendar: pages with a date between two days (not the meeting notes, they hang at their appointment) and the
 * meeting notes of the given appointments, each only if the person sees it. Admins leave out archived customers like
 * the calendar does. Before the migration, nothing.
 */
export async function loadCalendarNotes(appointmentIds: readonly string[], from: string, to: string): Promise<CalendarNotes> {
  const ctx = await notesContext();
  if (!ctx || !isDay(from) || !isDay(to)) return NO_CALENDAR_NOTES;
  const ids = appointmentIds.filter(isUuid).slice(0, 500);
  const [dated, meetings, archive] = await Promise.all([
    ctx.session.from("hub_note_pages").select("id, title, icon, customer_id, dated_on, appointment_id").is("deleted_at", null).is("appointment_id", null)
      .gte("dated_on", from).lte("dated_on", to).order("dated_on").limit(300).returns<PageRow[]>(),
    ids.length ? ctx.session.from("hub_note_pages").select("id, title, icon, customer_id, dated_on, appointment_id").is("deleted_at", null).in("appointment_id", ids).returns<PageRow[]>() : null,
    ctx.viewer === "admin" ? loadArchive() : null,
  ]);
  if (dated.error) return NO_CALENDAR_NOTES;
  const shown = (row: PageRow) => !archive?.customerIds.has(row.customer_id);
  return {
    dated: (dated.data ?? []).filter(shown).map((row) => ({ id: row.id, title: row.title, icon: row.icon, customerId: row.customer_id, day: row.dated_on! })),
    byAppointment: Object.fromEntries((meetings?.data ?? []).filter(shown).flatMap((row) => row.appointment_id ? [[row.appointment_id, { id: row.id, customerId: row.customer_id, title: row.title }]] : [])),
  };
}

type AppointmentRow = { id: string; title: string; starts_at: string; ends_at: string; status: string; teams_url: string | null; customer_id: string | null };
const APPOINTMENT_FIELDS = "id, title, starts_at, ends_at, status, teams_url, customer_id";

/** The appointments of a customer for „/Termin“, as the person sees them: upcoming ones first, then the last ones. */
export async function noteAppointmentOptionsAs(ctx: NotesContext, input: { customerId: string }): Promise<NoteResult<NoteAppointmentView[]>> {
  if (ctx.viewer === "freelancer") return { ok: true, data: [] };
  if (!isUuid(input?.customerId)) return fail("Der Kunde ist unbekannt.");
  const now = new Date().toISOString();
  const [upcoming, past] = await Promise.all([
    ctx.session.from("hub_appointments").select(APPOINTMENT_FIELDS).eq("customer_id", input.customerId).gte("ends_at", now).order("starts_at").limit(15).returns<AppointmentRow[]>(),
    ctx.session.from("hub_appointments").select(APPOINTMENT_FIELDS).eq("customer_id", input.customerId).lt("ends_at", now).order("starts_at", { ascending: false }).limit(10).returns<AppointmentRow[]>(),
  ]);
  if (upcoming.error || past.error) return fail("Die Termine konnten gerade nicht geladen werden.");
  return { ok: true, data: [...(upcoming.data ?? []), ...(past.data ?? [])].map(appointmentView) };
}

/**
 * „Notiz anlegen“ at an appointment (team): one meeting note per appointment, with the template of the settings, the
 * appointment's title and day, „Nur Team“ (plan 5.2). An existing note is returned instead of a second one.
 */
export async function createMeetingNoteAs(ctx: NotesContext, input: { appointmentId: string }): Promise<NoteResult<{ id: string; customerId: string; created: boolean }>> {
  if (ctx.viewer !== "admin") return fail("Besprechungsnotizen legt das oalab-Team an.");
  if (!isUuid(input?.appointmentId)) return fail("Unbekannter Termin.");
  const appointment = await ctx.session.from("hub_appointments").select(APPOINTMENT_FIELDS).eq("id", input.appointmentId).maybeSingle<AppointmentRow>();
  if (!appointment.data) return fail("Diesen Termin gibt es nicht mehr.");
  const customerId = appointment.data.customer_id;
  const customers = customerId ? await notesCustomers(ctx) : null;
  // Notes belong to customers: internal appointments and a freelancer's own ones have none.
  if (!customerId || !customers?.some((item) => item.id === customerId)) return fail("Notizen gibt es nur zu Terminen mit einem Kunden.");
  const existing = await ctx.session.from("hub_note_pages").select("id, deleted_at").eq("appointment_id", input.appointmentId).maybeSingle<{ id: string; deleted_at: string | null }>();
  if (existing.error && notesMissing(existing.error)) return fail("Notizen sind noch nicht eingerichtet: Die Datenbank kennt sie noch nicht.");
  if (existing.data?.deleted_at) return fail("Die Besprechungsnotiz zu diesem Termin liegt im Papierkorb. Stelle sie dort wieder her.");
  if (existing.data) return { ok: true, data: { id: existing.data.id, customerId, created: false } };

  const [settingsRow, siblings] = await Promise.all([
    ctx.session.from("hub_note_settings").select(SETTINGS_COLUMNS).maybeSingle(),
    ctx.session.from("hub_note_pages").select("id, parent_id, position").eq("customer_id", customerId).is("parent_id", null).is("deleted_at", null).returns<{ id: string; parent_id: string | null; position: number }[]>(),
  ]);
  const settings = toSettings(settingsRow.data as Parameters<typeof toSettings>[0]);
  const day = dayOf(Date.parse(appointment.data.starts_at));
  const template = noteTemplate(settings.meetingTemplate === "blank" ? "meeting" : settings.meetingTemplate, { title: appointment.data.title, date: day });
  const checked = validateNoteDoc(template.doc);
  if (!checked.ok) return fail(checked.error);
  const title = `Besprechung: ${appointment.data.title}`.slice(0, 200);
  const position = positionAfter((siblings.data ?? []).map((row) => ({ id: row.id, parentId: row.parent_id, position: Number(row.position) })));
  const { data, error } = await ctx.session.from("hub_note_pages").insert({
    customer_id: customerId, title, icon: template.icon || "🗓️", audience: "team", appointment_id: input.appointmentId, dated_on: day,
    width: settings.defaultWidth, content: checked.doc, content_text: noteText(checked.doc), position,
  }).select("id").single<{ id: string }>();
  if (error || !data) {
    // Two people at once: the other one was faster, so the note exists now.
    if (error?.code === "23505") {
      const again = await ctx.session.from("hub_note_pages").select("id").eq("appointment_id", input.appointmentId).maybeSingle<{ id: string }>();
      if (again.data) return { ok: true, data: { id: again.data.id, customerId, created: false } };
    }
    return fail(noteError(error, "Die Besprechungsnotiz konnte gerade nicht angelegt werden."));
  }
  await logNoteEvent(ctx, "note.created", "Besprechungsnotiz angelegt · Sichtbar für: Nur Team", customerId);
  return { ok: true, data: { id: data.id, customerId, created: true } };
}

/** Whether this session may write to the calendar: a login with a second factor confirms its code first. */
async function calendarSession(ctx: NotesContext): Promise<CalendarClient | null> {
  const { data } = await ctx.session.auth.getClaims();
  if (!data?.claims || await secondFactorMissing(ctx.session, data.claims.aal)) return null;
  return ctx.session as unknown as CalendarClient;
}
const confirmFirst = "Termine gehen erst mit bestätigter Anmeldung: Bestätige sie einmal mit einem Code aus der Mail.";

export type NoteAppointmentInput = { pageId: string; title: string; description?: string; day: string; start: string; minutes: number; teamsUrl?: string };

/** „Termin anlegen“ from a note (team): a confirmed appointment with the page's customer, who hears of it as usual. */
export async function createNoteAppointmentAs(ctx: NotesContext, input: NoteAppointmentInput): Promise<NoteResult<NoteAppointmentView>> {
  if (ctx.viewer !== "admin") return fail("Termine trägt das oalab-Team ein; du kannst einen anfragen.");
  const page = await readPage(ctx, input?.pageId, false);
  if (!page) return fail("Diese Seite gibt es nicht mehr.");
  const supabase = await calendarSession(ctx);
  if (!supabase) return fail(confirmFirst);
  const written = await writeAppointment(supabase, null, {
    title: String(input.title ?? ""), description: String(input.description ?? ""), customerId: page.customerId,
    day: String(input.day ?? ""), start: String(input.start ?? ""), minutes: Number(input.minutes), teamsUrl: String(input.teamsUrl ?? ""),
  });
  if (!written.ok) return fail(written.error);
  return readAppointment(ctx, written.data.id);
}

/** „Termin anfragen“ from a note (customers and freelancers): a request in a free time of oalab's calendar. */
export async function requestNoteAppointmentAs(ctx: NotesContext, input: NoteAppointmentInput): Promise<NoteResult<NoteAppointmentView>> {
  if (ctx.viewer === "admin") return fail("Als Team trägst du Termine direkt ein.");
  const page = await readPage(ctx, input?.pageId, false);
  if (!page) return fail("Diese Seite gibt es nicht mehr.");
  const supabase = await calendarSession(ctx);
  if (!supabase) return fail(confirmFirst);
  const requested = await requestAppointmentAs(supabase, ctx.userId, {
    title: String(input.title ?? ""), description: String(input.description ?? ""), day: String(input.day ?? ""), start: String(input.start ?? ""), minutes: Number(input.minutes),
  });
  if (!requested.ok) return fail(requested.error);
  return readAppointment(ctx, requested.data.id);
}

async function readAppointment(ctx: NotesContext, id: string): Promise<NoteResult<NoteAppointmentView>> {
  const { data } = await ctx.session.from("hub_appointments").select(APPOINTMENT_FIELDS).eq("id", id).maybeSingle<AppointmentRow>();
  return data ? { ok: true, data: appointmentView(data) } : fail("Der Termin ist eingetragen, ließ sich aber gerade nicht lesen.");
}

/**
 * The free start times for a request on a day (customers and freelancers): oalab's availability, the lead time, the
 * buffer around booked times and the person's own open requests, the same rules the calendar's request window uses
 * and the database checks again.
 */
export async function noteRequestSlotsAs(ctx: NotesContext, input: { day: string; minutes?: number }): Promise<NoteResult<NoteRequestSlots>> {
  if (ctx.viewer === "admin") return fail("Als Team trägst du Termine direkt ein.");
  const now = Date.now();
  const today = dayOf(now);
  const day = isDay(input?.day) && input.day >= today ? input.day : today;
  const { availability } = await loadAvailability(ctx.session as unknown as CalendarClient, false, day, day);
  const durations = availability.rules.durations;
  const minutes = durations.includes(Number(input?.minutes)) ? Number(input.minutes) : durations.includes(60) ? 60 : durations[0] ?? 60;
  const last = lastRequestDay(availability, today);
  if (day > last) return { ok: true, data: { durations, minutes, starts: [], lastDay: last } };
  const pad = availability.rules.buffer * 60_000;
  const range = { from: new Date(wallMinuteToUtc(day, 0) - pad).toISOString(), to: new Date(wallMinuteToUtc(day, 1440) + pad).toISOString() };
  const membership = await ctx.session.from("hub_customer_members").select("customer_id").eq("user_id", ctx.userId).limit(1).maybeSingle<{ customer_id: string }>();
  const [busy, own] = await Promise.all([
    ctx.session.rpc("hub_calendar_busy", { range_start: range.from, range_end: range.to }),
    membership.data ? ctx.session.from("hub_appointments").select("starts_at, ends_at").eq("customer_id", membership.data.customer_id).eq("status", "requested").lt("starts_at", range.to).gt("ends_at", range.from) : null,
  ]);
  if (busy.error || own?.error) return fail("Die freien Zeiten konnten gerade nicht geladen werden.");
  const intervals = (rows: unknown) => ((rows ?? []) as { starts_at: string; ends_at: string }[]).map((row) => ({ start: Date.parse(row.starts_at), end: Date.parse(row.ends_at) }));
  const free = customerFree(availability, day, intervals(busy.data), intervals(own?.data), now, today);
  return { ok: true, data: { durations, minutes, starts: startsIn(day, free, minutes), lastDay: last } };
}

/** A page for the calendar's „Notiz öffnen“ after creating it: the page as the person sees it. */
export async function meetingNotePage(ctx: NotesContext, id: string): Promise<NotePage | null> {
  return readPage(ctx, id, false);
}
