/**
 * Rules of the area „Vertrag & Domain“: the kinds of timeline entries, what an admin may save as one, and how days
 * and amounts read. Pure functions without imports at run time, so the tests load this file directly.
 */
import type { CustomerPackage, PackageId } from "../service-packages";

export type TimelineKind = "invoice_sent" | "invoice_paid" | "package" | "domain" | "mail" | "other";

/** Label and pill tone (glass.css) of each kind; the order is the one of the form. */
export const timelineKinds: Record<TimelineKind, { label: string; tone: "ok" | "todo" | "info" | "off" }> = {
  invoice_paid: { label: "Rechnung bezahlt", tone: "ok" },
  invoice_sent: { label: "Rechnung gestellt", tone: "todo" },
  package: { label: "Paket", tone: "info" },
  domain: { label: "Domain", tone: "info" },
  mail: { label: "Mail", tone: "info" },
  other: { label: "Sonstiges", tone: "off" },
};
export const timelineKindIds = Object.keys(timelineKinds) as TimelineKind[];
export const isTimelineKind = (value: unknown): value is TimelineKind => typeof value === "string" && Object.hasOwn(timelineKinds, value);

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && uuid.test(value);

/** A real calendar day as YYYY-MM-DD. */
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().startsWith(value);
}

/** 2026-11-03 → 03.11.2026 */
export const formatDay = (day: string) => day.split("-").reverse().join(".");

export function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
/** 8900 → „89,00 €“ */
export const formatCents = (cents: number) => euro.format(cents / 100);
/** 8900 → „89,00“, the way the form shows a saved amount. */
export const centsToInput = (cents: number | null) => cents === null ? "" : (cents / 100).toFixed(2).replace(".", ",");

export const MAX_AMOUNT_CENTS = 100_000_000;

/**
 * An amount as typed: „89“, „89,5“, „89,00 €“, „1.234,56“ or „1234.56“. Empty means no amount. A dot followed by
 * exactly three digits is a thousands separator, as in German.
 */
export function parseAmount(value: unknown): { ok: true; cents: number | null } | { ok: false; error: string } {
  if (value === null || value === undefined) return { ok: true, cents: null };
  const text = String(value).replace(/[\s €]/g, "");
  if (!text) return { ok: true, cents: null };
  let normalized: string;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(text)) normalized = text.replace(/\./g, "").replace(",", ".");
  else if (/^\d+(,\d{1,2})?$/.test(text)) normalized = text.replace(",", ".");
  else if (/^\d+\.\d{1,2}$/.test(text)) normalized = text;
  else return { ok: false, error: "Bitte den Betrag als Zahl angeben, zum Beispiel 89,00." };
  const cents = Math.round(Number(normalized) * 100);
  if (!Number.isFinite(cents) || cents > MAX_AMOUNT_CENTS) return { ok: false, error: "Der Betrag ist zu groß." };
  return { ok: true, cents };
}

const cleanLine = (value: unknown, max: number) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
const cleanText = (value: unknown, max: number) => typeof value === "string"
  ? value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max)
  : "";

export const MAX_TITLE = 160;
export const MAX_NOTE = 2000;

export type TimelineInput = {
  occurredOn: string;
  kind: TimelineKind;
  title: string;
  amountCents: number | null;
  fileId: string | null;
  note: string;
  customerVisible: boolean;
};

/** A timeline entry as an admin saves it. */
export function readTimelineEntry(input: Record<string, unknown>): { ok: true; value: TimelineInput } | { ok: false; error: string } {
  if (!isIsoDay(input.occurredOn)) return { ok: false, error: "Bitte ein gültiges Datum angeben." };
  if (!isTimelineKind(input.kind)) return { ok: false, error: "Bitte eine Art auswählen." };
  const title = cleanLine(input.title, MAX_TITLE);
  if (!title) return { ok: false, error: "Bitte einen Titel angeben, zum Beispiel „Rechnung Oktober bezahlt“." };
  const amount = parseAmount(input.amount);
  if (!amount.ok) return amount;
  const fileId = input.fileId ? input.fileId : null;
  if (fileId !== null && !isUuid(fileId)) return { ok: false, error: "Diese Datei gibt es nicht." };
  return {
    ok: true,
    value: { occurredOn: input.occurredOn, kind: input.kind, title, amountCents: amount.cents, fileId, note: cleanText(input.note, MAX_NOTE), customerVisible: input.customerVisible === true },
  };
}

/** Newest first; entries of the same day by when they were written. */
export function byNewest<T extends { occurredOn: string; createdAt: string }>(a: T, b: T) {
  return b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt);
}

/** Packages that end within the next `days` days (from today on), soonest first. */
export function endingSoon<C extends { id: string; packages: CustomerPackage[] }>(customers: readonly C[], today: string, days = 60) {
  const last = addDays(today, days);
  return customers
    .flatMap((customer) => customer.packages.flatMap((item) => item.packageId && item.until && item.until >= today && item.until <= last ? [{ customer, packageId: item.packageId as PackageId, until: item.until }] : []))
    .sort((a, b) => a.until.localeCompare(b.until));
}

/** The newest paid invoice of a customer, if any. */
export function lastPayment<E extends { customerId: string; kind: TimelineKind; occurredOn: string; createdAt: string }>(entries: readonly E[], customerId: string): E | null {
  return entries.filter((entry) => entry.customerId === customerId && entry.kind === "invoice_paid").sort(byNewest)[0] ?? null;
}
