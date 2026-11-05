import type { CustomerPackage, PackageId } from "@/lib/service-packages";
import type { ContractCustomer, ContractsState, TimelineEntry } from "./types";

// Fictional packages and timelines of the three demo customers (/preview and the demo logins). Ids are the customer
// numbers, as with the example files, so an entry can link the customer's example contract.

type FixtureEntry = Pick<TimelineEntry, "occurredOn" | "kind" | "title" | "amountCents" | "customerVisible"> & { note?: string; source?: "manual" | "package"; linksContract?: true };
type Fixture = { company: string; packages: [PackageId | null, string | null, string | null][]; timeline: FixtureEntry[] };

const fixtures: Record<string, Fixture> = {
  "KD-24017": {
    company: "Nordlicht Studio",
    packages: [["domain-mail", "2026-03-01", null], ["service-max", "2026-10-01", null]],
    timeline: [
      { occurredOn: "2026-10-06", kind: "invoice_paid", title: "Rechnung Oktober bezahlt", amountCents: 8900, customerVisible: true, note: "Per Überweisung eingegangen." },
      { occurredOn: "2026-10-01", kind: "invoice_sent", title: "Rechnung Oktober gestellt", amountCents: 8900, customerVisible: true },
      { occurredOn: "2026-10-01", kind: "package", title: "Wechsel von OALAB Service Lite zu OALAB Service Max", amountCents: null, customerVisible: true, source: "package", linksContract: true },
      { occurredOn: "2026-03-04", kind: "mail", title: "Postfächer info@ und jana@ eingerichtet", amountCents: null, customerVisible: true, note: "Weiterleitung von hallo@ auf info@." },
      { occurredOn: "2026-03-01", kind: "domain", title: "Domain nordlicht.example umgezogen", amountCents: null, customerVisible: false, note: "Umzug vom alten Anbieter, DNS-Einträge übernommen." },
      { occurredOn: "2026-03-01", kind: "package", title: "OALAB Domain & Mail gebucht", amountCents: null, customerVisible: false, source: "package" },
    ],
  },
  "KD-24023": {
    company: "Form & Feld",
    packages: [["domain", "2026-05-01", null], ["service-lite", "2026-05-01", null]],
    timeline: [
      { occurredOn: "2026-10-09", kind: "invoice_paid", title: "Rechnung Oktober bezahlt", amountCents: 3900, customerVisible: true },
      { occurredOn: "2026-10-01", kind: "invoice_sent", title: "Rechnung Oktober gestellt", amountCents: 3900, customerVisible: true },
      { occurredOn: "2026-05-01", kind: "package", title: "OALAB Service Lite gebucht", amountCents: null, customerVisible: false, source: "package", linksContract: true },
    ],
  },
  "KD-24031": {
    company: "Studio Horizont",
    packages: [["domain-mail", "2026-01-15", null], ["service-lite", "2026-01-15", "2026-11-30"]],
    timeline: [
      { occurredOn: "2026-10-12", kind: "package", title: "OALAB Service Lite gekündigt zum 30.11.2026", amountCents: null, customerVisible: true, note: "Kündigung per Mail, Gespräch über Service Max vereinbart.", source: "package" },
      { occurredOn: "2026-10-01", kind: "invoice_sent", title: "Rechnung Oktober gestellt", amountCents: 6900, customerVisible: true, note: "Zahlung noch offen." },
      { occurredOn: "2026-01-15", kind: "package", title: "OALAB Domain & Mail gebucht", amountCents: null, customerVisible: false, source: "package", linksContract: true },
    ],
  },
};

const groups = ["domain", "service"] as const;

/**
 * The example data the area shows without real data: every demo customer for admins, the own one for customers
 * (released entries only, without notes). `contractFiles` maps a customer number to its example contract's file id.
 */
export function contractFixtures({ admin, customerNumber, contractFiles = {} }: { admin: boolean; customerNumber: string | null; contractFiles?: Record<string, string> }): ContractsState {
  const numbers = admin ? Object.keys(fixtures) : customerNumber && fixtures[customerNumber] ? [customerNumber] : [];
  const customers: ContractCustomer[] = numbers.map((number) => ({
    id: number,
    company: fixtures[number].company,
    customerNumber: number,
    logo: null,
    packages: fixtures[number].packages.map(([packageId, since, until], index): CustomerPackage => ({ group: groups[index], packageId, since, until })),
  }));
  const timeline = numbers.flatMap((number) => fixtures[number].timeline
    .filter((entry) => admin || entry.customerVisible)
    .map((entry, index): TimelineEntry => {
      const shown: TimelineEntry = {
        id: `${number}-t${index}`,
        customerId: number,
        occurredOn: entry.occurredOn,
        kind: entry.kind,
        title: entry.title,
        amountCents: entry.amountCents,
        fileId: entry.linksContract ? contractFiles[number] ?? null : null,
        customerVisible: entry.customerVisible,
        createdAt: `${entry.occurredOn}T09:${String(59 - index).padStart(2, "0")}:00Z`,
      };
      return admin ? { ...shown, note: entry.note ?? "", source: entry.source ?? "manual", authorName: "oalab-Team" } : shown;
    }));
  return { view: admin ? "admin" : "customer", source: "fixtures", customers, timeline, ready: true, canManage: false };
}
