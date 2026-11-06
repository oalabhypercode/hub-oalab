import type { QuotaRow } from "./rules";
import type { QuotaRequest, ServiceQuotaState } from "./types";

// Fictional usage of the three demo customers (/preview and the demo logins) in the demo month, October 2026 in
// German time (DEMO_AS_OF is 15.10.2026). The switch is off, as it is live until the user switches it on: admins see
// the counts and the block list, customers see nothing yet. Ids are the customer numbers, as in the contract examples.

const OCTOBER = { startsAt: "2026-09-30T22:00:00.000Z", endsAt: "2026-10-31T23:00:00.000Z" };

const rows: QuotaRow[] = [
  { customerId: "KD-24017", packageId: "service-max", monthlyLimit: 20, monthlyUsed: 16, exempted: 1, organizationActive: true, logins: 2 },
  { customerId: "KD-24023", packageId: "service-lite", monthlyLimit: 5, monthlyUsed: 5, exempted: 0, organizationActive: true, logins: 1 },
  { customerId: "KD-24031", packageId: "service-lite", monthlyLimit: 5, monthlyUsed: 2, exempted: 0, organizationActive: true, logins: 1 },
];

const titles = [
  "Öffnungszeiten auf der Startseite ändern", "Neues Teamfoto einsetzen", "Kontaktformular: Pflichtfeld Telefon entfernen",
  "Preisliste 2027 hochladen", "Tippfehler im Impressum", "Neue Unterseite für Gutscheine", "Logo im Footer größer",
  "Bildergalerie lädt langsam", "Termin-Button in die Navigation", "Text für die Weihnachtsaktion",
];

/** The requests of the demo month at a demo customer, newest first; Nordlicht Studio has one that does not count. */
export function quotaRequestFixtures(customerId: string): QuotaRequest[] {
  const row = rows.find((item) => item.customerId === customerId);
  if (!row) return [];
  const count = row.monthlyUsed + row.exempted;
  const base = Number(customerId.replace(/\D/g, "")) % 1000;
  // Newest on the demo day (14.10.), then every 17 hours one further back, all within October.
  const newest = Date.parse("2026-10-14T15:20:00.000Z");
  return Array.from({ length: count }, (_, index) => ({
    requestId: `${customerId}-r${index}`,
    reference: `OA-${base + count - index}`,
    title: titles[(index + base) % titles.length],
    submittedAt: new Date(newest - index * 17 * 3_600_000).toISOString(),
    trashed: false,
    exemption: customerId === "KD-24017" && index === 2 ? { reason: "Fehler von oalab beim letzten Update", createdAt: "2026-10-12T10:00:00.000Z", byName: "oalab-Team" } : null,
  }));
}

export function quotaFixtures({ admin, customerIds }: { admin: boolean; customerIds: readonly string[] }): ServiceQuotaState {
  if (!admin) return { ready: true, enforced: false, window: null, customers: [], canManage: false };
  return {
    ready: true,
    enforced: false,
    window: OCTOBER,
    customers: rows.filter((row) => customerIds.includes(row.customerId)),
    switchedAt: null,
    switchedBy: null,
    canManage: false,
  };
}
