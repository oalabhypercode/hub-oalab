import { DEMO_AS_OF } from "../hub-data";
import type { HubFileCustomer } from "../hub-files/types";
import { wallTimeToUtc, type AppointmentStatus, type Availability } from "./rules";
import type { HubAppointment, HubCalendarState } from "./types";

// Fictional appointments for the preview and the public demo, around the fixtures' reference day.
const customers: Record<string, HubFileCustomer> = {
  nordlicht: { id: "KD-24017", customerNumber: "KD-24017", company: "Nordlicht Studio" },
  formfeld: { id: "KD-24023", customerNumber: "KD-24023", company: "Form & Feld" },
  horizont: { id: "KD-24031", customerNumber: "KD-24031", company: "Studio Horizont" },
};

// Sample links of all three providers, so the preview shows the marks of Teams, Zoom and Google Meet (27.11.2026).
const SAMPLE_TEAMS_URL = "https://teams.microsoft.com/l/meetup-join/beispiel-oalab";
const SAMPLE_LINKS: Record<string, string> = {
  "Feedback Brand Direction": "https://us02web.zoom.us/j/84122345567?pwd=beispiel",
  "Statusrunde Oktober": "https://meet.google.com/kpr-xnow-tzb",
  "Kickoff Social-Kampagne": "https://meet.google.com/kpr-xnow-tzb",
  "Content-Planung Q1": "https://us02web.zoom.us/j/84122345567?pwd=beispiel",
};

type Fixture = [day: string, start: string, end: string, customer: keyof typeof customers | null, title: string, status: AppointmentStatus, description?: string, note?: string];

const fixtures: Fixture[] = [
  ["2026-10-13", "10:00", "11:00", "nordlicht", "Review Konzept & Struktur", "confirmed", "Wir gehen gemeinsam durch Seitenstruktur und Navigation der neuen Website."],
  ["2026-10-15", "09:30", "10:30", "formfeld", "Kickoff Social-Kampagne", "confirmed", "Ziele, Kanäle und Zeitplan für den Social-Auftritt."],
  ["2026-10-15", "14:00", "15:30", "horizont", "Designabnahme Website", "confirmed", "Finale Abnahme der Seitenentwürfe vor der Umsetzung."],
  ["2026-10-16", "11:00", "12:00", "nordlicht", "Feedback Brand Direction", "confirmed", "Dein Feedback zur ersten Designrichtung."],
  ["2026-10-16", "16:00", "17:00", "horizont", "Kurzer Austausch", "declined", "Kurze Rückfrage zu den Bildrechten.", "Leider schon verplant. Bitte wähle einen anderen freien Zeitraum."],
  ["2026-10-19", "09:00", "12:00", null, "Team-Workshop (intern)", "confirmed"],
  ["2026-10-19", "14:00", "15:00", "formfeld", "Abstimmung Website-Inhalte", "confirmed", "Texte und Bilder für die Startseite."],
  ["2026-10-20", "10:00", "11:00", "horizont", "Content-Planung Q1", "confirmed"],
  ["2026-10-20", "13:00", "17:00", null, "Produktionstag (intern)", "confirmed"],
  ["2026-10-21", "09:00", "10:00", "nordlicht", "Website-Texte durchgehen", "requested", "Ich würde gern die Texte für die Leistungsseiten gemeinsam durchgehen."],
  ["2026-10-22", "15:00", "16:00", "formfeld", "Logo-Feinschliff", "requested", "Zwei Varianten des Logos besprechen."],
  ["2026-10-23", "10:00", "11:30", "horizont", "Launch-Vorbereitung", "confirmed"],
  ["2026-10-27", "14:00", "15:00", "nordlicht", "Statusrunde Oktober", "confirmed", "Monatlicher Blick auf alle laufenden Projekte."],
];

const appointments: HubAppointment[] = fixtures.map(([day, start, end, customer, title, status, description = "", note = ""], index) => ({
  id: `sample-${index + 1}`,
  title,
  description,
  start: wallTimeToUtc(day, start),
  end: wallTimeToUtc(day, end),
  status,
  teamsUrl: status === "confirmed" && customer ? SAMPLE_LINKS[title] ?? SAMPLE_TEAMS_URL : null,
  responseNote: note,
  customer: customer ? customers[customer] : null,
  sample: true,
}));

/** A fictional availability like the approved preview: lunch break, a short Friday, a fair, a day off, an extra Saturday. */
const availability: Availability = {
  week: [[[540, 720], [780, 1020]], [[540, 720], [780, 1020]], [[540, 720], [780, 1020]], [[540, 720], [780, 1020]], [[540, 780]], [], []],
  exceptions: [
    { id: "sample-x1", day: "2026-10-22", kind: "off", from: 540, to: 720, note: "Messe, nur nachmittags da" },
    { id: "sample-x2", day: "2026-10-24", kind: "extra", from: 600, to: 780, note: "Samstag für den Livegang" },
    { id: "sample-x3", day: "2026-10-30", kind: "off", from: null, to: null, note: "Urlaubstag" },
  ],
  rules: { notice: 1440, buffer: 15, horizon: 8, durations: [30, 45, 60, 90] },
};

/** Admins see every fixture appointment; customers their own and the anonymous busy times of all others. */
export function calendarFixtures({ admin, customerNumber }: { admin: boolean; customerNumber: string | null }): HubCalendarState {
  const own = appointments.filter((item) => item.customer && item.customer.customerNumber === customerNumber);
  return {
    source: "fixtures",
    appointments: admin ? appointments : own,
    busy: appointments.filter((item) => item.status === "confirmed").map(({ start, end }) => ({ start, end })),
    customers: Object.values(customers).filter((customer) => admin || customer.customerNumber === customerNumber),
    canManage: admin,
    // The preview's changes never leave the browser, so its tasks move without a code.
    confirmed: admin,
    // Customers never see the team's notes.
    availability: admin ? availability : { ...availability, exceptions: availability.exceptions.map((item) => ({ ...item, note: "" })) },
    availabilityReady: true,
    today: DEMO_AS_OF,
    now: wallTimeToUtc(DEMO_AS_OF, "08:00"),
  };
}
