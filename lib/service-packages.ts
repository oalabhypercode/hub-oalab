/**
 * The oalab packages in two groups. A customer holds at most one package per group, and a group may stay empty
 * (table hub_customer_packages, migration 202611050001 in service-oalab; its function hub_package_name carries the
 * same names, the tests compare them). Since stage 3 (202611060001) the Service package sets how many new requests a
 * customer may make on the service platform each month, once the switch in the hub is on.
 */
export type PackageGroup = "domain" | "service";
export type PackageId = "domain" | "domain-mail" | "service-lite" | "service-max";

export const packageGroupOrder: readonly PackageGroup[] = ["domain", "service"];

export const packageGroups: Record<PackageGroup, { name: string; packages: readonly PackageId[] }> = {
  domain: { name: "Domain", packages: ["domain", "domain-mail"] },
  service: { name: "Service", packages: ["service-lite", "service-max"] },
};

export type ServicePackageId = "service-lite" | "service-max";
export const isServicePackageId = (value: unknown): value is ServicePackageId => value === "service-lite" || value === "service-max";

/**
 * New requests a month on the service platform, counted by the calendar month in German time; without a Service
 * package none (the database's hub_service_request_limit in 202611060001 carries the same numbers).
 */
export const serviceRequestLimits: Record<ServicePackageId, number> = { "service-lite": 5, "service-max": 20 };
export const serviceRequestLimit = (id: string | null | undefined) => isServicePackageId(id) ? serviceRequestLimits[id] : 0;

export const packageCatalog: Record<PackageId, { name: string; short: string; group: PackageGroup; description: string }> = {
  domain: { name: "OALAB Domain", short: "Domain", group: "domain", description: "Hosting der Website" },
  "domain-mail": { name: "OALAB Domain & Mail", short: "Domain & Mail", group: "domain", description: "Hosting der Website und der E-Mail" },
  "service-lite": { name: "OALAB Service Lite", short: "Service Lite", group: "service", description: `${serviceRequestLimits["service-lite"]} neue Anfragen im Monat über die Serviceplattform` },
  "service-max": { name: "OALAB Service Max", short: "Service Max", group: "service", description: `${serviceRequestLimits["service-max"]} neue Anfragen im Monat über die Serviceplattform` },
};

export const packageIds = Object.keys(packageCatalog) as PackageId[];
export const isPackageId = (value: unknown): value is PackageId => typeof value === "string" && Object.hasOwn(packageCatalog, value);
export const isPackageGroup = (value: unknown): value is PackageGroup => value === "domain" || value === "service";

/** A customer's package in one group: none (null) or one, with its first day and the day it is cancelled to (ISO days). */
export type CustomerPackage = { group: PackageGroup; packageId: PackageId | null; since: string | null; until: string | null };

/** Both groups of a customer, a group without a row as "none". */
export function packagesByGroup(rows: readonly CustomerPackage[]): CustomerPackage[] {
  return packageGroupOrder.map((group) => rows.find((row) => row.group === group) ?? { group, packageId: null, since: null, until: null });
}

/** The packages a customer holds, in group order. */
export function heldPackages(rows: readonly Pick<CustomerPackage, "group" | "packageId">[]): PackageId[] {
  return packageGroupOrder.flatMap((group) => {
    const id = rows.find((row) => row.group === group)?.packageId;
    return id ? [id] : [];
  });
}

const isDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

/**
 * The packages of both groups as an admin saves them: a known package of the right group or none, the days only with
 * a package, „gekündigt zum“ never before „seit“.
 */
export function readPackageChoices(input: unknown): { ok: true; value: CustomerPackage[] } | { ok: false; error: string } {
  const list = Array.isArray(input) ? input : [];
  const value: CustomerPackage[] = [];
  for (const group of packageGroupOrder) {
    const item = list.find((entry) => (entry as Record<string, unknown> | null)?.group === group) as Record<string, unknown> | undefined;
    const raw = item?.packageId;
    if (raw !== null && raw !== undefined && raw !== "" && !(isPackageId(raw) && packageCatalog[raw].group === group)) {
      return { ok: false, error: `Unbekanntes Paket in der Gruppe ${packageGroups[group].name}.` };
    }
    const packageId = isPackageId(raw) ? raw : null;
    const since = item?.since ? item.since : null;
    const until = item?.until ? item.until : null;
    if ((since !== null && !isDay(since)) || (until !== null && !isDay(until))) return { ok: false, error: "Bitte ein gültiges Datum angeben." };
    if (!packageId) {
      value.push({ group, packageId: null, since: null, until: null });
      continue;
    }
    if (since && until && until < since) return { ok: false, error: `„Gekündigt zum“ liegt bei ${packageCatalog[packageId].name} vor „seit“.` };
    value.push({ group, packageId, since: since as string | null, until: until as string | null });
  }
  return { ok: true, value };
}

export const SERVICE_PLATFORM_URL = "https://service.oalab.de";
