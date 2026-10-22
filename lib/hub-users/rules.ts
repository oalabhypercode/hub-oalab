/**
 * Rules of the user management: input cleaning for registration and admin forms, customer numbers and the
 * status a login shows. Self-contained (no imports), so the browser form, the server and `node --test` share it.
 */

export const hubRoles = ["oalab_customer", "oalab_admin"] as const;
export type HubRole = (typeof hubRoles)[number];
export const roleLabels: Record<HubRole, string> = { oalab_customer: "Kunde", oalab_admin: "Admin" };
export const isHubRole = (value: unknown): value is HubRole => hubRoles.includes(value as HubRole);

/** Stored in hub_profiles.status. */
export const accountStatuses = ["pending", "active", "disabled", "rejected"] as const;
export type AccountStatus = (typeof accountStatuses)[number];
export const isAccountStatus = (value: unknown): value is AccountStatus => accountStatuses.includes(value as AccountStatus);

/** What a login shows in the list: an active login that never signed in still waits for its activation. */
export type DisplayStatus = "pending" | "invited" | "active" | "disabled" | "rejected";
export const displayStatusLabels: Record<DisplayStatus, string> = {
  pending: "Wartet auf Freigabe",
  invited: "Aktivierung offen",
  active: "Aktiv",
  disabled: "Deaktiviert",
  rejected: "Abgelehnt",
};

export function displayStatus(status: AccountStatus, lastSignInAt: string | null): DisplayStatus {
  return status === "active" && !lastSignInAt ? "invited" : status;
}

/** Must match lib/service-packages.ts and the check constraint on hub_customers (the tests compare them). */
export const servicePackageIds = ["website-mail", "website-lite", "website-extra", "website-max"] as const;

export type Check<T> = { ok: true; value: T } | { ok: false; error: string };

/** Single-line text: control characters and runs of whitespace become one space, at most `max` characters. */
export function cleanLine(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Multi-line text (messages, notes): keeps single blank lines, drops every other control character. */
export function cleanText(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

/** Required name parts: letters of any script plus spaces, dots, hyphens and apostrophes. */
function cleanName(value: unknown, label: string): Check<string> {
  const name = cleanLine(value, 80);
  if (!name) return { ok: false, error: `Bitte ${label} angeben.` };
  return /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(name) ? { ok: true, value: name } : { ok: false, error: `Bitte ${label} nur mit Buchstaben angeben.` };
}

export function cleanEmail(value: unknown): Check<string> {
  const email = cleanLine(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? { ok: true, value: email } : { ok: false, error: "Bitte eine gültige E-Mail-Adresse angeben." };
}

/** Phone numbers as people write them: digits with +, spaces, slashes, dashes and brackets; 6 to 20 digits. */
export function cleanPhone(value: unknown, required: boolean): Check<string> {
  const phone = cleanLine(value, 40);
  if (!phone) return required ? { ok: false, error: "Bitte eine Telefonnummer angeben." } : { ok: true, value: "" };
  const digits = phone.replace(/\D/g, "").length;
  return /^\+?[\d\s/().-]+$/.test(phone) && digits >= 6 && digits <= 20 ? { ok: true, value: phone } : { ok: false, error: "Bitte eine gültige Telefonnummer angeben." };
}

/** Optional website: "oalab.de" becomes "https://oalab.de"; only http(s) addresses with a dotted host pass. */
export function cleanWebsite(value: unknown): Check<string> {
  const raw = cleanLine(value, 200);
  if (!raw) return { ok: true, value: "" };
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!/^https?:$/.test(url.protocol) || !/^[^.]+\.[^.]/.test(url.hostname) || url.username || url.password) throw new Error("invalid");
    return { ok: true, value: url.toString().replace(/\/$/, "").slice(0, 200) };
  } catch {
    return { ok: false, error: "Bitte eine gültige Website angeben, z. B. beispiel.de." };
  }
}

/** Customer numbers like "KD-24017": letters, digits and dashes, stored in upper case. */
export function cleanCustomerNumber(value: unknown, required: boolean): Check<string> {
  const number = cleanLine(value, 40).toUpperCase().replace(/\s+/g, "");
  if (!number) return required ? { ok: false, error: "Bitte eine Kundennummer angeben." } : { ok: true, value: "" };
  return /^[A-Z0-9][A-Z0-9-]{1,39}$/.test(number) ? { ok: true, value: number } : { ok: false, error: "Kundennummern bestehen aus Buchstaben, Ziffern und Bindestrichen, z. B. KD-24017." };
}

/** The next free number after the highest "KD-…" number in use, keeping its width; KD-10001 for the first one. */
export function nextCustomerNumber(existing: readonly string[]) {
  let highest = 0;
  let width = 5;
  for (const number of existing) {
    const match = /^KD-(\d+)$/.exec(number);
    if (match && Number(match[1]) >= highest) {
      highest = Number(match[1]);
      width = Math.max(width, match[1].length);
    }
  }
  return `KD-${String(highest ? highest + 1 : 10001).padStart(width, "0")}`;
}

/** Company names compared without case, punctuation and legal forms: "Nordlicht Studio GmbH" ≈ "nordlicht studio". */
export function normalizeCompany(name: string) {
  return name.toLowerCase()
    .replace(/&/g, " und ")
    .replace(/\b(gmbh|mbh|ug|ag|kg|ohg|gbr|e\.?\s?k|e\.?\s?v|co|haftungsbeschränkt|inc|ltd|llc)\b\.?/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The customer a registration most likely belongs to: the stated customer number first, then the company name. */
export function suggestCustomer<T extends { id: string; customerNumber: string; company: string }>(registration: { customerNumberHint: string; companyName: string }, customers: readonly T[]) {
  const hint = cleanCustomerNumber(registration.customerNumberHint, false);
  if (hint.ok && hint.value) {
    const byNumber = customers.find((customer) => customer.customerNumber === hint.value);
    if (byNumber) return byNumber;
  }
  const company = normalizeCompany(registration.companyName);
  return company ? customers.find((customer) => normalizeCompany(customer.company) === company) ?? null : null;
}

export type RegistrationInput = {
  email: string;
  firstName: string;
  lastName: string;
  companyName: string;
  phone: string;
  position: string;
  website: string;
  customerNumberHint: string;
  message: string;
};

/** The registration form: everything the admin needs to approve quickly. Password rules stay with Supabase Auth. */
export function readRegistration(input: Record<string, unknown>): Check<RegistrationInput> {
  const firstName = cleanName(input.firstName, "deinen Vornamen");
  if (!firstName.ok) return firstName;
  const lastName = cleanName(input.lastName, "deinen Nachnamen");
  if (!lastName.ok) return lastName;
  const companyName = cleanLine(input.companyName, 200);
  if (!companyName) return { ok: false, error: "Bitte dein Unternehmen angeben." };
  const email = cleanEmail(input.email);
  if (!email.ok) return email;
  const phone = cleanPhone(input.phone, true);
  if (!phone.ok) return phone;
  const website = cleanWebsite(input.website);
  if (!website.ok) return website;
  const customerNumberHint = cleanCustomerNumber(input.customerNumberHint, false);
  if (!customerNumberHint.ok) return customerNumberHint;
  return {
    ok: true,
    value: {
      email: email.value,
      firstName: firstName.value,
      lastName: lastName.value,
      companyName,
      phone: phone.value,
      position: cleanLine(input.position, 80),
      website: website.value,
      customerNumberHint: customerNumberHint.value,
      message: cleanText(input.message, 1000),
    },
  };
}

export type PersonInput = { firstName: string; lastName: string; phone: string; position: string };

/** A login's person data as an admin edits it; the phone is optional here. */
export function readPerson(input: Record<string, unknown>): Check<PersonInput> {
  const firstName = cleanName(input.firstName, "den Vornamen");
  if (!firstName.ok) return firstName;
  const lastName = cleanName(input.lastName, "den Nachnamen");
  if (!lastName.ok) return lastName;
  const phone = cleanPhone(input.phone, false);
  if (!phone.ok) return phone;
  return { ok: true, value: { firstName: firstName.value, lastName: lastName.value, phone: phone.value, position: cleanLine(input.position, 80) } };
}

export type CustomerInput = {
  company: string;
  customerNumber: string;
  servicePackages: string[];
  contactEmail: string;
  phone: string;
  website: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
};

/** A customer (company) as an admin creates or edits it. */
export function readCustomer(input: Record<string, unknown>): Check<CustomerInput> {
  const company = cleanLine(input.company, 200);
  if (!company) return { ok: false, error: "Bitte den Namen des Unternehmens angeben." };
  const customerNumber = cleanCustomerNumber(input.customerNumber, true);
  if (!customerNumber.ok) return customerNumber;
  const known: readonly string[] = servicePackageIds;
  const packages = Array.isArray(input.servicePackages) ? input.servicePackages : [];
  if (packages.some((id) => typeof id !== "string" || !known.includes(id))) return { ok: false, error: "Unbekanntes Servicepaket." };
  const contactEmail = cleanLine(input.contactEmail, 254) ? cleanEmail(input.contactEmail) : { ok: true as const, value: "" };
  if (!contactEmail.ok) return { ok: false, error: "Bitte eine gültige Kontakt-E-Mail angeben." };
  const phone = cleanPhone(input.phone, false);
  if (!phone.ok) return phone;
  const website = cleanWebsite(input.website);
  if (!website.ok) return website;
  const postalCode = cleanLine(input.postalCode, 12);
  if (postalCode && !/^[A-Za-z0-9 -]{3,12}$/.test(postalCode)) return { ok: false, error: "Bitte eine gültige Postleitzahl angeben." };
  return {
    ok: true,
    value: {
      company,
      customerNumber: customerNumber.value,
      servicePackages: Array.from(new Set(packages as string[])).sort((a, b) => known.indexOf(a) - known.indexOf(b)),
      contactEmail: contactEmail.value,
      phone: phone.value,
      website: website.value,
      street: cleanLine(input.street, 120),
      postalCode,
      city: cleanLine(input.city, 80),
      country: cleanLine(input.country, 60) || "Deutschland",
    },
  };
}
