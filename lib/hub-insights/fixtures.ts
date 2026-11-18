import { addDays, formatDayShort, wallTimeToUtc } from "@/lib/hub-calendar/rules";
import type { HubAppointment } from "@/lib/hub-calendar/types";
import type { InboxItem } from "@/lib/hub-notify/server";
import type { QuotaRow } from "@/lib/hub-service-quota/rules";
import type { InsightsData } from "./types";

// Fictional content for the design preview (/preview, local only) and for checks with fixtures; never real data.

const customers = {
  nordlicht: { id: "preview-nordlicht", customerNumber: "KD-24017", company: "Nordlicht Studio" },
  atelier: { id: "preview-atelier", customerNumber: "KD-90102", company: "Atelier Morgenrot" },
  cafe: { id: "preview-cafe", customerNumber: "KD-90103", company: "Café Kranich" },
  werkstatt: { id: "preview-werkstatt", customerNumber: "KD-90104", company: "Holzwerkstatt Lind" },
};

const appointment = (id: string, title: string, day: string, from: string, to: string, extra: Partial<HubAppointment> = {}): HubAppointment => ({
  id, title, description: "", status: "confirmed", start: wallTimeToUtc(day, from), end: wallTimeToUtc(day, to),
  teamsUrl: null, responseNote: "", customer: null, sample: true, ...extra,
});

const quota = (customerId: string, packageId: "service-lite" | "service-max", monthlyUsed: number): QuotaRow => ({
  customerId, packageId, monthlyLimit: packageId === "service-max" ? 20 : 5, monthlyUsed, exempted: 0, organizationActive: true, logins: 1,
});

/**
 * Insights of the preview. Customers: an appointment two days ahead and „Service Max“ with 3 of 20 requests used.
 * Admins (local checks only; /preview is the customer's view): two appointments today, a request, four customers'
 * quotas from free to full.
 */
export function previewInsights(asOf: string, admin = false): InsightsData {
  const month = asOf.slice(0, 7);
  const window = { startsAt: new Date(wallTimeToUtc(`${month}-01`, "00:00")).toISOString(), endsAt: new Date(wallTimeToUtc(addDays(`${month}-28`, 4).slice(0, 7) + "-01", "00:00")).toISOString() };
  if (admin) {
    return {
      today: asOf,
      now: wallTimeToUtc(asOf, "09:12"),
      appointments: [
        appointment("preview-today-1", "Kick-off Website", asOf, "08:30", "09:00", { customer: customers.atelier }),
        appointment("preview-today-2", "Abstimmung Startseite", asOf, "15:00", "15:45", { customer: customers.nordlicht }),
        appointment("preview-request", "Erstgespräch Speisekarte", addDays(asOf, 3), "11:00", "11:30", { customer: customers.cafe, status: "requested" }),
      ],
      appointmentsError: null,
      quota: {
        ready: true, enforced: false, window,
        rows: [quota(customers.nordlicht.id, "service-max", 3), quota(customers.atelier.id, "service-lite", 4), quota(customers.cafe.id, "service-lite", 5), quota(customers.werkstatt.id, "service-max", 9)],
        names: Object.fromEntries(Object.values(customers).map((customer) => [customer.id, { company: customer.company, customerNumber: customer.customerNumber }])),
      },
    };
  }
  return {
    today: asOf,
    now: wallTimeToUtc(asOf, "09:12"),
    appointments: [appointment("preview-appointment", "Abstimmung Startseite", addDays(asOf, 2), "10:00", "10:30")],
    appointmentsError: null,
    quota: { ready: true, enforced: true, window, rows: [quota("preview", "service-max", 3)], names: {} },
  };
}

/** The bell of the preview. Customers: a confirmed appointment, two files (a stack) and an answer. Admins: three chats. */
export function previewNotices(asOf: string, admin = false): InboxItem[] {
  const at = (days: number, time: string) => new Date(wallTimeToUtc(addDays(asOf, days), time)).toISOString();
  if (admin) {
    return [
      { id: 13, kind: "chat.message", title: "Nachricht von Nordlicht Studio", body: "„Können wir die Farben der Startseite noch einmal ansehen?“", href: "/preview/messages", createdAt: at(0, "08:47"), read: false },
      { id: 12, kind: "chat.message", title: "Nachricht von Atelier Morgenrot", body: "„Der Kick-off war super, danke!“", href: "/preview/messages", createdAt: at(0, "08:05"), read: false },
      { id: 11, kind: "chat.message", title: "Nachricht von Café Kranich", body: "„Die neue Speisekarte ist im Ordner.“", href: "/preview/messages", createdAt: at(-1, "17:32"), read: true },
    ];
  }
  return [
    { id: 3, kind: "appointment.confirmed", title: "Termin bestätigt: Abstimmung Startseite", body: `${formatDayShort(addDays(asOf, 2))} um 10:00 Uhr`, href: "/preview/projects/calendar", createdAt: at(0, "08:58"), read: false },
    { id: 4, kind: "file.shared", title: "Neue Datei: Logo-Varianten.pdf", body: "Unter Dateien › Marke", href: "/preview/files", createdAt: at(-1, "16:20"), read: false },
    { id: 2, kind: "file.shared", title: "Neue Datei: Farbpalette.pdf", body: "Unter Dateien › Marke", href: "/preview/files", createdAt: at(-1, "16:18"), read: false },
    { id: 1, kind: "chat.reply", title: "Antwort von oalab", body: "„Klar, die Schrift tauschen wir gern aus.“", href: "/preview/messages", createdAt: at(-1, "11:05"), read: true },
  ];
}
