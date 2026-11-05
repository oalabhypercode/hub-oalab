/**
 * The contract templates of the hub: which exist, which fields they ask for and how the values are written into the
 * Word file. Self-contained (no imports), so the generator, the server and `node --test` share the same rules.
 *
 * Every field is a placeholder in the template, e.g. {{preis_monat}}. Computed placeholders (annual price, discount,
 * minute steps) and oalab's own address are never typed in; they follow from the other fields and from the imprint.
 */

export type ContractTemplateId = "website-domain-mail" | "website-pflege";

export type ContractFieldKind = "text" | "money" | "minutes" | "percent" | "date";
export type ContractFieldGroup = "customer" | "terms" | "provider" | "signature";

export type ContractField = {
  key: string;
  label: string;
  kind: ContractFieldKind;
  group: ContractFieldGroup;
  /** Must be filled before a contract can be created. */
  required: boolean;
  /** Prefilled from the customer master. */
  from?: "company" | "street" | "postalCity" | "domain";
  hint?: string;
  /** Left empty, an optional field becomes a line of this many underscores, to be filled in by hand. */
  line?: number;
  /** Suggestions under the input. */
  options?: "partners";
};

export type ContractTemplate = {
  id: ContractTemplateId;
  /** Short name in the hub. */
  name: string;
  /** The heading of the document itself. */
  title: string;
  description: string;
  /** Start of the file name: "Servicevertrag Website-Pflege – Firma.docx". */
  fileTitle: string;
  /** Default template in lib/contract-templates/templates. */
  file: string;
  /** Ends with lines for signatures; the other one is accepted by e-mail. */
  signature: boolean;
  /** The domain packages this contract is written for; none means the domain lies elsewhere. */
  packages: readonly string[];
  /** The fields of the form, in order. */
  fields: readonly string[];
  /** Starting values that differ per template (raw input as typed). */
  initial: Readonly<Record<string, string>>;
};

export const contractFields: Record<string, ContractField> = {
  kunde_firma: { key: "kunde_firma", label: "Firma", kind: "text", group: "customer", required: true, from: "company" },
  kunde_strasse: { key: "kunde_strasse", label: "Straße und Hausnummer", kind: "text", group: "customer", required: true, from: "street" },
  kunde_plz_ort: { key: "kunde_plz_ort", label: "PLZ und Ort", kind: "text", group: "customer", required: true, from: "postalCity" },
  kunde_domain: { key: "kunde_domain", label: "Domain der Website", kind: "text", group: "customer", required: true, from: "domain", hint: "Ohne https://, zum Beispiel beispiel.de" },
  hoster: { key: "hoster", label: "Hoster", kind: "text", group: "terms", required: true, hint: "Steht in § 6: „Das Hosting … erfolgt derzeit über die …“" },
  vertragsbeginn: { key: "vertragsbeginn", label: "Vertragsbeginn", kind: "date", group: "terms", required: true },
  preis_monat: { key: "preis_monat", label: "Preis pro Monat (netto)", kind: "money", group: "terms", required: true },
  minuten_monat: { key: "minuten_monat", label: "Inklusive Minuten pro Monat", kind: "minutes", group: "terms", required: true },
  preis_zusatzblock: { key: "preis_zusatzblock", label: "Je weiterer 60-Minuten-Block (netto)", kind: "money", group: "terms", required: true },
  rabatt_prozent: { key: "rabatt_prozent", label: "Rabatt bei Jahreszahlung (%)", kind: "percent", group: "terms", required: true },
  dienstleister_name: { key: "dienstleister_name", label: "Name", kind: "text", group: "provider", required: true, hint: "Der externe IT-Dienstleister des Kunden für Hosting, Domain und E-Mail" },
  dienstleister_strasse: { key: "dienstleister_strasse", label: "Straße und Hausnummer", kind: "text", group: "provider", required: true },
  dienstleister_plz_ort: { key: "dienstleister_plz_ort", label: "PLZ und Ort", kind: "text", group: "provider", required: true },
  ort_datum: { key: "ort_datum", label: "Ort, Datum", kind: "text", group: "signature", required: false, line: 38 },
  ag_name: { key: "ag_name", label: "Name beim Kunden", kind: "text", group: "signature", required: false, line: 45, hint: "Leer lassen, wenn der Kunde von Hand einträgt" },
  ag_funktion: { key: "ag_funktion", label: "Funktion beim Kunden", kind: "text", group: "signature", required: false, line: 42 },
  an_name: { key: "an_name", label: "Name bei oalab", kind: "text", group: "signature", required: false, line: 45, options: "partners" },
  an_funktion: { key: "an_funktion", label: "Funktion bei oalab", kind: "text", group: "signature", required: false, line: 42 },
};

export const contractGroupLabels: Record<ContractFieldGroup, string> = {
  customer: "Kunde",
  terms: "Konditionen",
  provider: "Externer IT-Dienstleister",
  signature: "Unterschriften",
};

export const contractTemplates: Record<ContractTemplateId, ContractTemplate> = {
  "website-domain-mail": {
    id: "website-domain-mail",
    name: "Website, Domain & Mail",
    title: "Servicevereinbarung „OALAB Website-, Domain- & Mail-Service“",
    description: "Website, Domain und E-Mail liegen bei oalab. Ohne Unterschrift, der Kunde nimmt per E-Mail an.",
    fileTitle: "Servicevereinbarung Website, Domain & Mail",
    file: "website-domain-mail.docx",
    signature: false,
    packages: ["domain-mail", "domain"],
    fields: ["kunde_firma", "kunde_strasse", "kunde_plz_ort", "preis_monat", "minuten_monat", "rabatt_prozent", "hoster"],
    initial: { preis_monat: "15,00", minuten_monat: "60", rabatt_prozent: "10", hoster: "netcup GmbH" },
  },
  "website-pflege": {
    id: "website-pflege",
    name: "Website-Pflege",
    title: "Servicevertrag „Oalab Website-Pflege und technischer Support“",
    description: "Nur die Pflege der Website. Hosting, Domain und E-Mail liegen bei einem externen IT-Dienstleister. Mit Unterschrift.",
    fileTitle: "Servicevertrag Website-Pflege",
    file: "website-pflege.docx",
    signature: true,
    packages: [],
    fields: [
      "kunde_firma", "kunde_strasse", "kunde_plz_ort", "kunde_domain",
      "vertragsbeginn", "preis_monat", "minuten_monat", "preis_zusatzblock", "rabatt_prozent",
      "dienstleister_name", "dienstleister_strasse", "dienstleister_plz_ort",
      "ort_datum", "ag_name", "ag_funktion", "an_name", "an_funktion",
    ],
    initial: { preis_monat: "30,00", minuten_monat: "30", preis_zusatzblock: "95,00", rabatt_prozent: "10", an_funktion: "Geschäftsführer" },
  },
};

export const contractTemplateIds = Object.keys(contractTemplates) as ContractTemplateId[];
export const isContractTemplateId = (value: unknown): value is ContractTemplateId => typeof value === "string" && Object.hasOwn(contractTemplates, value);

/** Placeholders the hub fills itself; they never appear in the form. */
export const computedKeys = ["preis_jahr_regulaer", "rabatt_betrag", "preis_jahr", "minuten_stufe_1", "minuten_stufe_2", "oalab_strasse", "oalab_plz_ort"] as const;

/** Every placeholder a template may contain: its fields plus the computed ones. */
export const knownPlaceholders = (template: ContractTemplate) => [...template.fields, ...computedKeys];

export const computedLabels: Record<(typeof computedKeys)[number], string> = {
  preis_jahr_regulaer: "Regulärer Jahrespreis (12 × Monatspreis), berechnet",
  rabatt_betrag: "Rabatt in Euro, berechnet",
  preis_jahr: "Jahrespreis nach Rabatt, berechnet",
  minuten_stufe_1: "Inklusive Minuten + 60, berechnet",
  minuten_stufe_2: "Inklusive Minuten + 120, berechnet",
  oalab_strasse: "Straße von oalab, aus dem Impressum",
  oalab_plz_ort: "PLZ und Ort von oalab, aus dem Impressum",
};

/** What a placeholder stands for, for the help list next to the upload. */
export function placeholderLabel(key: string) {
  const field = contractFields[key];
  if (field) return `${contractGroupLabels[field.group]}: ${field.label}`;
  return (computedLabels as Record<string, string>)[key] ?? key;
}

/** The template that fits a customer's domain package: oalab hosts → Website, Domain & Mail; otherwise Website-Pflege. */
export function suggestedTemplate(packageIds: readonly (string | null)[]): ContractTemplateId {
  return packageIds.some((id) => id && contractTemplates["website-domain-mail"].packages.includes(id)) ? "website-domain-mail" : "website-pflege";
}

/* ---------- Reading and writing values ---------- */

/** Cents from "30", "30,00", "30.5", "1.140,00" or "1140.00"; null when it is no amount. */
export function parseMoney(raw: string): number | null {
  const value = raw.replace(/\s|€|EUR|Euro/gi, "");
  if (!value) return null;
  let normalized: string;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(value)) normalized = value.replace(/\./g, "").replace(",", ".");
  else if (/^\d+(,\d{1,2})?$/.test(value)) normalized = value.replace(",", ".");
  else if (/^\d+(\.\d{1,2})?$/.test(value)) normalized = value;
  else return null;
  const cents = Math.round(Number(normalized) * 100);
  return Number.isFinite(cents) && cents >= 0 && cents <= 100_000_000 ? cents : null;
}

const moneyFormat = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const formatMoney = (cents: number) => moneyFormat.format(cents / 100);

/** A percentage between 0 and 100, comma or point; null otherwise. */
export function parsePercent(raw: string): number | null {
  const value = raw.replace(/\s|%/g, "").replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) return null;
  const number = Number(value);
  return number >= 0 && number <= 100 ? number : null;
}

export const formatPercent = (value: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(value);

/** ISO day (from a date input) or "TT.MM.JJJJ" → ISO day; null when it is no real date. */
export function parseDay(raw: string): string | null {
  const value = raw.trim();
  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value);
  const iso = german ? `${german[3]}-${german[2].padStart(2, "0")}-${german[1].padStart(2, "0")}` : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(iso) ? iso : null;
}

export const formatDay = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** The first day of the month after `today` (ISO), the usual start of a service contract. */
export function nextMonthStart(today: string) {
  const [year, month] = today.split("-").map(Number);
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

/** "https://www.beispiel.de/kontakt" → "beispiel.de". */
export function domainFromWebsite(website: string) {
  return website.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").replace(/[/?#:].*$/, "");
}

/* ---------- Form → placeholders ---------- */

/** What the customer master offers for the prefill. */
export type ContractCustomerData = { company: string; street: string; postalCode: string; city: string; website: string };

/** Who signs for oalab and where the GbR sits (from lib/legal-details.ts). */
export type ContractOperator = { street: string; city: string; partners: readonly string[] };

/** The form's starting values: customer master, then the template's own values, then the day-dependent ones. */
export function initialInput(template: ContractTemplate, customer: ContractCustomerData | null, today: string, operator: ContractOperator): Record<string, string> {
  const fromCustomer: Record<NonNullable<ContractField["from"]>, string> = {
    company: customer?.company ?? "",
    street: customer?.street ?? "",
    postalCity: [customer?.postalCode, customer?.city].filter(Boolean).join(" "),
    domain: customer ? domainFromWebsite(customer.website) : "",
  };
  const input: Record<string, string> = {};
  for (const key of template.fields) {
    const field = contractFields[key];
    input[key] = field.from ? fromCustomer[field.from] : template.initial[key] ?? "";
  }
  if (template.fields.includes("vertragsbeginn")) input.vertragsbeginn = nextMonthStart(today);
  if (template.fields.includes("ort_datum")) input.ort_datum = `Münster, ${formatDay(today)}`;
  if (template.fields.includes("an_name")) input.an_name = operator.partners[0] ?? "";
  return input;
}

const clean = (raw: unknown) => String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 200);

export type ContractValues = { ok: true; values: Record<string, string> } | { ok: false; errors: Record<string, string> };

/**
 * The text for every placeholder of a template from the form's input. Required fields must be filled and every
 * amount, number and date must read cleanly; an empty optional field becomes a line to fill in by hand.
 */
export function contractValues(template: ContractTemplate, input: Record<string, unknown>, operator: ContractOperator): ContractValues {
  const values: Record<string, string> = {};
  const errors: Record<string, string> = {};
  let cents: number | null = null;
  let minutes: number | null = null;
  let percent: number | null = null;
  for (const key of template.fields) {
    const field = contractFields[key];
    const raw = clean(input?.[key]);
    if (!raw) {
      if (field.required) errors[key] = "Bitte ausfüllen.";
      else values[key] = "_".repeat(field.line ?? 30);
      continue;
    }
    if (field.kind === "money") {
      const parsed = parseMoney(raw);
      if (parsed === null) errors[key] = "Bitte einen Betrag wie 30,00 angeben.";
      else {
        values[key] = formatMoney(parsed);
        if (key === "preis_monat") cents = parsed;
      }
    } else if (field.kind === "minutes") {
      const parsed = /^\d{1,4}$/.test(raw) ? Number(raw) : NaN;
      if (!(parsed > 0)) errors[key] = "Bitte eine ganze Zahl an Minuten angeben.";
      else values[key] = String((minutes = parsed));
    } else if (field.kind === "percent") {
      const parsed = parsePercent(raw);
      if (parsed === null) errors[key] = "Bitte eine Zahl zwischen 0 und 100 angeben.";
      else values[key] = formatPercent((percent = parsed));
    } else if (field.kind === "date") {
      const parsed = parseDay(raw);
      if (!parsed) errors[key] = "Bitte ein gültiges Datum angeben.";
      else values[key] = formatDay(parsed);
    } else {
      values[key] = raw;
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  Object.assign(values, computedValues(cents, minutes, percent), { oalab_strasse: operator.street, oalab_plz_ort: operator.city });
  return { ok: true, values };
}

/** Annual price, discount and the minute steps of the extra blocks (blocks of 60 minutes). */
export function computedValues(cents: number | null, minutes: number | null, percent: number | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (cents !== null) {
    const regular = cents * 12;
    const discount = Math.round(regular * (percent ?? 0) / 100);
    out.preis_jahr_regulaer = formatMoney(regular);
    out.rabatt_betrag = formatMoney(discount);
    out.preis_jahr = formatMoney(regular - discount);
  }
  if (minutes !== null) {
    out.minuten_stufe_1 = String(minutes + 60);
    out.minuten_stufe_2 = String(minutes + 120);
  }
  return out;
}

/** The blank form: every field and every computed value a line, only oalab's own address filled in. */
export function blankValues(template: ContractTemplate, operator: ContractOperator): Record<string, string> {
  const lengths: Record<ContractFieldKind, number> = { text: 30, money: 10, minutes: 5, percent: 4, date: 12 };
  const values: Record<string, string> = {};
  for (const key of template.fields) {
    const field = contractFields[key];
    values[key] = "_".repeat(field.line ?? lengths[field.kind]);
  }
  for (const key of ["preis_jahr_regulaer", "rabatt_betrag", "preis_jahr"]) values[key] = "_".repeat(10);
  for (const key of ["minuten_stufe_1", "minuten_stufe_2"]) values[key] = "_".repeat(5);
  return { ...values, oalab_strasse: operator.street, oalab_plz_ort: operator.city };
}

/** A file name Windows and macOS accept: "Servicevertrag Website-Pflege – Nalbach & Hinkel GmbH.docx". */
export function contractFileName(template: ContractTemplate, company: string, extension = "docx") {
  const safe = `${template.fileTitle} – ${company}`.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 150);
  return `${safe}.${extension}`;
}

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/* ---------- Versions the admins upload ---------- */

/**
 * Uploaded versions live in the private bucket of the asset management, which only admins may read: one folder per
 * template, plus a staging folder for uploads until their check passed. The newest version is the active one; without
 * any, the template that ships with the hub is.
 */
export const TEMPLATE_VERSIONS_PREFIX = "templates/contracts";
export const TEMPLATE_STAGING_PREFIX = "templates/staging";
export const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;

/** upload: a new Word file; restore: an older version used again; standard: back to the template that ships with the hub. */
export type TemplateVersionKind = "upload" | "restore" | "standard";
export type TemplateVersion = { name: string; kind: TemplateVersionKind; createdAt: string };

export const versionKindLabels: Record<TemplateVersionKind, string> = { upload: "Hochgeladen", restore: "Wieder verwendet", standard: "Standardfassung" };

/** "20261105-130512-upload-k3x9.docx": UTC, so the names sort by time. */
export function versionFileName(kind: TemplateVersionKind, date: Date, random: string) {
  const iso = date.toISOString();
  return `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}-${kind}-${random}.docx`;
}

export function parseVersionName(name: string): TemplateVersion | null {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(upload|restore|standard)-[a-z0-9]{4,12}\.docx$/.exec(name);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, kind] = match;
  return { name, kind: kind as TemplateVersionKind, createdAt: `${year}-${month}-${day}T${hour}:${minute}:${second}Z` };
}

/** Newest first; names that are not versions are left out. */
export const sortedVersions = (names: readonly string[]) => names.flatMap((name) => parseVersionName(name) ?? []).sort((a, b) => b.name.localeCompare(a.name));

export type TemplateCheck = {
  /** Every placeholder in the file. */
  keys: string[];
  /** Placeholders the hub does not know, e.g. a typo such as {{kunde_frima}}: they would stay in every contract. */
  unknown: string[];
  /** Fields of the form the text no longer uses; their input has no effect. */
  missing: string[];
  /** Pieces like "{{kunde_" without their end. */
  broken: string[];
  ok: boolean;
};

/** Unknown or broken placeholders, or none at all, block a new version; fields the text no longer uses only warn. */
export function checkTemplateScan(template: ContractTemplate, scan: { keys: readonly string[]; broken: readonly string[] }): TemplateCheck {
  const known = knownPlaceholders(template);
  const unknown = scan.keys.filter((key) => !known.includes(key));
  const missing = template.fields.filter((key) => !scan.keys.includes(key));
  return { keys: [...scan.keys], unknown, missing, broken: [...scan.broken], ok: scan.keys.length > 0 && !unknown.length && !scan.broken.length };
}
