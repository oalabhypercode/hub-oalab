/**
 * Rules of the request quota (Vertrag & Domain, stage 3, decisions of 6.11.2026): the Service package of the hub sets
 * how many new requests a customer may make on the service platform each calendar month in German time (Lite 5,
 * Max 20, without a package none). Every submitted new request counts, replies never; admins exempt single
 * requests. A switch for everyone decides whether the limit blocks; it starts off. The database counts and blocks
 * (migration 202611060001 in service-oalab); these pure functions only explain its numbers in the hub. No imports at
 * run time, so the tests load this file directly.
 */
import type { ServicePackageId } from "../service-packages";

const isServicePackage = (value: unknown): value is ServicePackageId => value === "service-lite" || value === "service-max";

/** From this share of the month's requests on, the customer sees a warning. */
export const QUOTA_WARN_SHARE = 0.8;
export const MIN_EXEMPT_REASON = 3;
export const MAX_EXEMPT_REASON = 300;

/** One hub customer with an organization on the service platform, as the database counts it this month. */
export type QuotaRow = {
  customerId: string;
  packageId: ServicePackageId | null;
  monthlyLimit: number;
  monthlyUsed: number;
  /** Admins only: requests of this month taken out of the count. */
  exempted: number;
  /** Admins only: whether the organization may log in at all, and how many active client logins it has. */
  organizationActive: boolean;
  logins: number;
};

export type QuotaStatus = "none" | "ok" | "warn" | "full";

/** No package, below 80 %, from 80 % or at the limit. */
export function quotaStatus(row: Pick<QuotaRow, "packageId" | "monthlyLimit" | "monthlyUsed">): QuotaStatus {
  if (!row.packageId || row.monthlyLimit <= 0) return "none";
  if (row.monthlyUsed >= row.monthlyLimit) return "full";
  if (row.monthlyUsed >= Math.ceil(row.monthlyLimit * QUOTA_WARN_SHARE)) return "warn";
  return "ok";
}

/** Only customers who can reach the service platform at all are blocked or warned. */
const reaches = (row: QuotaRow) => row.organizationActive && row.logins > 0;

/**
 * The block list: whom the switch refuses new requests right now (when off: whom it would refuse once switched on).
 * Without a package first, then at the limit, each by company as the caller sorted them.
 */
export function blockList<R extends QuotaRow>(rows: readonly R[]): R[] {
  const blocked = rows.filter((row) => reaches(row) && (quotaStatus(row) === "none" || quotaStatus(row) === "full"));
  return [...blocked.filter((row) => quotaStatus(row) === "none"), ...blocked.filter((row) => quotaStatus(row) === "full")];
}

/** Customers from 80 % on who can still send. */
export const warnList = <R extends QuotaRow>(rows: readonly R[]) => rows.filter((row) => reaches(row) && quotaStatus(row) === "warn");

/** Reads one row of the database's answer; anything unknown counts as no package. */
export function readQuotaRow(value: unknown): QuotaRow | null {
  const row = value as Record<string, unknown> | null;
  if (!row || typeof row.customerId !== "string") return null;
  const count = (key: string) => typeof row[key] === "number" && Number.isSafeInteger(row[key]) && (row[key] as number) >= 0 ? row[key] as number : 0;
  const packageId = isServicePackage(row.packageId) ? row.packageId : null;
  return {
    customerId: row.customerId,
    packageId,
    // The database names the limit of today's package (hub_service_request_limit); without a package it is 0.
    monthlyLimit: packageId ? count("monthlyLimit") : 0,
    monthlyUsed: count("monthlyUsed"),
    exempted: count("exempted"),
    organizationActive: row.organizationActive !== false,
    logins: typeof row.logins === "number" ? count("logins") : 1,
  };
}

const monthName = new Intl.DateTimeFormat("de-DE", { month: "long", timeZone: "Europe/Berlin" });
const monthYear = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric", timeZone: "Europe/Berlin" });
const longDay = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });

/**
 * The counted month in German time from the database's window: „November“, „November 2026“ and the day the count
 * starts again, „1. Dezember 2026“.
 */
export function quotaMonth(window: { startsAt: string; endsAt: string }) {
  const start = new Date(window.startsAt);
  const end = new Date(window.endsAt);
  return { month: monthName.format(start), monthYear: monthYear.format(start), resetDay: longDay.format(end) };
}

const shortDay = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" });
/** A point in time as its day in German time: 06.11.2026. */
export const formatBerlinDay = (iso: string) => shortDay.format(new Date(iso));

/** „3 von 5“, or the plain count without a package. */
export function usageLine(row: Pick<QuotaRow, "packageId" | "monthlyLimit" | "monthlyUsed">) {
  if (quotaStatus(row) === "none") return row.monthlyUsed === 1 ? "1 Anfrage" : `${row.monthlyUsed} Anfragen`;
  return `${row.monthlyUsed} von ${row.monthlyLimit}`;
}

/** The short internal reason an admin gives when a request does not count: one line, 3 to 300 characters. */
export function readExemptReason(value: unknown): { ok: true; reason: string } | { ok: false; error: string } {
  const reason = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
  if (reason.length < MIN_EXEMPT_REASON) return { ok: false, error: "Bitte kurz angeben, warum die Anfrage nicht zählt, zum Beispiel „Fehler von oalab“." };
  if (reason.length > MAX_EXEMPT_REASON) return { ok: false, error: `Der Grund darf höchstens ${MAX_EXEMPT_REASON} Zeichen haben.` };
  return { ok: true, reason };
}

/** The reference customers and the team know: OA-12. */
export const requestReference = (requestNumber: number) => `OA-${requestNumber}`;
