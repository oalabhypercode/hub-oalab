import { createAdminClient } from "@/lib/supabase/admin";
import { siteOrigin } from "@/lib/site-origin";
import {
  ICS_FILE, calendarEvent, calendarLinkSecret, calendarTarget, googleCalendarUrl, icsCalendar, outlookCalendarUrl, validCalendarSignature,
  type CalendarAppointment,
} from "@/lib/hub-calendar/links";

// "In deinen Kalender eintragen" from the notification mails. Works without a session: the signature in the link
// stands for the appointment (lib/hub-calendar/links.ts). Every call reads the appointment again, so a moved one
// lands with its new time and a cancelled one not at all.

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const plain = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };

/** A short page instead of a calendar entry, with the way into the hub. */
function page(status: number, title: string, text: string, origin: string) {
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>`
    + `<body style="margin:0;padding:48px 16px;background:#FAF8F7;font-family:Inter,'Segoe UI',Arial,sans-serif;color:#252027;">`
    + `<main style="max-width:480px;margin:0 auto;padding:28px;border-radius:20px;background:#ffffff;">`
    + `<h1 style="margin:0 0 10px;font-size:22px;line-height:28px;">${title}</h1>`
    + `<p style="margin:0 0 22px;font-size:16px;line-height:24px;color:#6F626B;">${text}</p>`
    + `<a href="${origin}/dashboard/calendar" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#7E004B;color:#ffffff;font-weight:600;text-decoration:none;">Zum Kalender im Client Hub</a>`
    + `</main></body></html>`;
  return new Response(html, { status, headers: { ...plain, "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string; target: string }> }) {
  const { id: rawId, target: segment } = await params;
  const id = rawId.toLowerCase();
  const target = calendarTarget(segment);
  const origin = siteOrigin(request.headers) ?? "https://hub.oalab.de";
  const secret = calendarLinkSecret();
  const signature = new URL(request.url).searchParams.get("sig") ?? "";
  if (!secret || !target || !uuid.test(id) || !validCalendarSignature(id, signature, secret)) {
    return page(404, "Link ungültig", "Dieser Kalender-Link ist ungültig. Deine Termine findest du im Kalender des Client Hub.", origin);
  }

  const db = createAdminClient();
  const read = db
    ? await db.from("hub_appointments").select("id, title, description, starts_at, ends_at, status, teams_url, updated_at").eq("id", id)
      .maybeSingle<CalendarAppointment & { status: string }>()
    : null;
  if (!read || read.error) return page(503, "Gerade nicht erreichbar", "Der Termin konnte gerade nicht geladen werden. Bitte versuch es gleich noch einmal.", origin);
  if (!read.data) return page(404, "Termin nicht gefunden", "Diesen Termin gibt es nicht mehr. Deine Termine findest du im Kalender des Client Hub.", origin);
  if (read.data.status !== "confirmed") {
    return read.data.status === "cancelled"
      ? page(410, "Termin abgesagt", "Dieser Termin wurde abgesagt. Was aktuell geplant ist, siehst du im Kalender des Client Hub.", origin)
      : page(410, "Termin nicht bestätigt", "Dieser Termin ist nicht bestätigt. Was aktuell geplant ist, siehst du im Kalender des Client Hub.", origin);
  }

  const event = calendarEvent(read.data, origin, new Date());
  if (target !== "ics") return new Response(null, { status: 302, headers: { ...plain, Location: target === "google" ? googleCalendarUrl(event) : outlookCalendarUrl(event) } });
  // Inline, so iPhone and iPad offer "Zum Kalender hinzufügen" right away; other browsers save the file.
  return new Response(icsCalendar(event), {
    headers: { ...plain, "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `inline; filename="${ICS_FILE}"` },
  });
}
