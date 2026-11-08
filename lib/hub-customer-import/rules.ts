/**
 * Bulk import of customers from the accounting's contact export (Sevdesk, as CSV): reading the file, finding the
 * columns, turning rows into customer drafts and comparing them with the hub's customers before anything is written.
 * Self-contained (no runtime imports), so the tests run it directly. The hub's own checks (`readCustomer`,
 * `serviceCustomerRefusal`, `normalizeCompany` in lib/hub-users/rules.ts) come in as parameters, so a draft passes
 * here exactly when "Kunde anlegen" would take it.
 */

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 2000;
/** Customers per server call: small enough to stay well inside a request, with progress in between. */
export const IMPORT_BATCH = 20;

export type ImportField =
  | "company" | "customerNumber" | "firstName" | "lastName" | "category" | "contactEmail" | "phone" | "mobile"
  | "website" | "street" | "houseNumber" | "postalCode" | "city" | "country";

/**
 * The columns the import understands, with the headers Sevdesk and other programs use for them (compared without
 * case, umlauts and punctuation). Short names only match exactly; longer ones also as the start or part of a header
 * like „E-Mail (geschäftlich)“. The order decides ties.
 */
export const importFields: readonly { id: ImportField; label: string; aliases: readonly string[] }[] = [
  { id: "customerNumber", label: "Kundennummer", aliases: ["kundennummer", "kundennr", "kdnr", "knr", "nummer", "customernumber", "kontaktnummer", "debitorennummer", "debitor"] },
  { id: "company", label: "Unternehmen", aliases: ["organisation", "organization", "firma", "firmenname", "unternehmen", "company", "name"] },
  { id: "firstName", label: "Vorname", aliases: ["vorname", "firstname", "surename"] },
  { id: "lastName", label: "Nachname", aliases: ["nachname", "familienname", "lastname", "familyname"] },
  { id: "category", label: "Kategorie", aliases: ["kategorie", "category", "kontaktart", "kontakttyp", "typ"] },
  { id: "contactEmail", label: "E-Mail", aliases: ["email", "emailadresse", "mail"] },
  { id: "mobile", label: "Mobil", aliases: ["mobil", "mobilnummer", "mobiltelefon", "handy", "mobile"] },
  { id: "phone", label: "Telefon", aliases: ["telefon", "telefonnummer", "tel", "phone"] },
  { id: "website", label: "Website", aliases: ["webseite", "website", "homepage", "internet", "url", "web"] },
  { id: "street", label: "Straße", aliases: ["strasse", "str", "street", "adresse", "anschrift"] },
  { id: "houseNumber", label: "Hausnummer", aliases: ["hausnummer", "hausnr", "nr"] },
  { id: "postalCode", label: "PLZ", aliases: ["plz", "postleitzahl", "zip", "postalcode"] },
  { id: "city", label: "Ort", aliases: ["ort", "stadt", "city", "wohnort"] },
  { id: "country", label: "Land", aliases: ["land", "country", "staat"] },
];

export type ColumnMapping = Record<ImportField, number | null>;

/** The draft of one customer, in the shape of the hub's customer form. */
export type ImportDraft = {
  company: string;
  customerNumber: string;
  contactEmail: string;
  phone: string;
  website: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
};

/** The contact fields an import may fill in at an existing customer (never company or number). */
export const fillableFields = ["contactEmail", "phone", "website", "street", "postalCode", "city", "country"] as const;
export type FillableField = (typeof fillableFields)[number];

export const fieldLabels: Record<FillableField, string> = {
  contactEmail: "E-Mail", phone: "Telefon", website: "Website", street: "Straße", postalCode: "PLZ", city: "Ort", country: "Land",
};

export type ImportRow = {
  /** Line in the file (the header is line 1). */
  line: number;
  draft: ImportDraft;
  /** The number as the file has it, before it became an "OA-" number. */
  sourceNumber: string;
  /** Contact person of the row: first and last name. */
  person: string;
  /** Why the row is left out unless the admin ticks it anyway (another category). */
  skip: string | null;
  /** Why the row cannot be imported at all. */
  problem: string | null;
  /** What the import changed on the way: merged contact persons, dropped invalid values, a padded postal code. */
  notes: string[];
};

// Reading the file ---------------------------------------------------------------------------------------------------

/** UTF-8 (with or without BOM) when the bytes are valid UTF-8, otherwise Windows-1252, as Excel on Windows writes it. */
export function decodeImportFile(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** The separator of the header line: semicolon (German Excel and Sevdesk), comma or tab, whichever appears most. */
export function detectDelimiter(text: string) {
  let header = "";
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if ((char === "\n" || char === "\r") && !quoted) break;
    if (!quoted) header += char;
  }
  const counts = [";", ",", "\t"].map((delimiter) => ({ delimiter, count: header.split(delimiter).length - 1 }));
  return counts.sort((a, b) => b.count - a.count)[0].count > 0 ? counts[0].delimiter : ";";
}

/** CSV after RFC 4180: quoted fields may hold separators, line breaks and doubled quotes. Empty lines are dropped. */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const endRow = () => {
    row.push(field);
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
    row = [];
    field = "";
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.trim() === "") { field = ""; quoted = true; }
    else if (char === delimiter) { row.push(field); field = ""; }
    else if (char === "\r" && text[index + 1] === "\n") { endRow(); index += 1; }
    else if (char === "\n" || char === "\r") endRow();
    else field += char;
  }
  if (field !== "" || row.length) endRow();
  return rows;
}

// Finding the columns ------------------------------------------------------------------------------------------------

/** A header as compared: lower case, umlauts spelled out, only letters and digits. */
export function headerKey(header: string) {
  return header.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]/g, "");
}

function matchScore(key: string, alias: string) {
  if (!key) return 0;
  if (key === alias) return 3;
  if (alias.length < 5) return 0;
  if (key.startsWith(alias)) return 2;
  return key.includes(alias) ? 1 : 0;
}

/** The best column for each field; every column serves one field at most. */
export function guessMapping(headers: readonly string[]): ColumnMapping {
  const keys = headers.map(headerKey);
  const candidates: { field: ImportField; column: number; score: number; order: number }[] = [];
  importFields.forEach((field, order) => keys.forEach((key, column) => {
    const score = Math.max(0, ...field.aliases.map((alias) => matchScore(key, alias)));
    if (score) candidates.push({ field: field.id, column, score, order });
  }));
  candidates.sort((a, b) => b.score - a.score || a.order - b.order || a.column - b.column);
  const mapping = emptyMapping();
  const used = new Set<number>();
  for (const candidate of candidates) {
    if (mapping[candidate.field] !== null || used.has(candidate.column)) continue;
    mapping[candidate.field] = candidate.column;
    used.add(candidate.column);
  }
  return mapping;
}

export const emptyMapping = (): ColumnMapping => Object.fromEntries(importFields.map((field) => [field.id, null])) as ColumnMapping;

/** Without a company column and without first and last name there is nothing to name a customer by. */
export function mappingProblem(mapping: ColumnMapping) {
  if (mapping.company === null && mapping.lastName === null && mapping.firstName === null) return "Ordne mindestens die Spalte mit dem Unternehmen oder dem Namen zu.";
  return null;
}

// Rows into drafts ---------------------------------------------------------------------------------------------------

const line = (value: string | undefined) => (value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

/**
 * The hub's number for a number from the file: "OA-" and its letters and digits, at least four (shorter ones get
 * leading zeros), as Service requires. "OA-1003" stays as it is; nothing usable gives "".
 */
export function customerNumberFrom(value: string) {
  const raw = line(value).toUpperCase().replace(/^OA-?/, "").replace(/[^A-Z0-9]/g, "");
  if (!raw) return "";
  return `OA-${raw.padStart(4, "0")}`;
}

const countryNames: Record<string, string> = {
  de: "Deutschland", deu: "Deutschland", germany: "Deutschland", deutschland: "Deutschland",
  at: "Österreich", aut: "Österreich", austria: "Österreich", oesterreich: "Österreich",
  ch: "Schweiz", che: "Schweiz", switzerland: "Schweiz", schweiz: "Schweiz",
  nl: "Niederlande", lu: "Luxemburg", be: "Belgien", fr: "Frankreich", it: "Italien", es: "Spanien", pl: "Polen", dk: "Dänemark",
};

/** Country codes and English names in German; empty is Germany, as in the hub's form. */
export function countryFrom(value: string) {
  const text = line(value);
  return countryNames[headerKey(text)] ?? (text || "Deutschland");
}

/** Excel drops the leading zero of German postal codes (01067 → 1067); four digits in Germany get it back. */
export function postalCodeFrom(value: string, country: string) {
  const code = line(value);
  return country === "Deutschland" && /^\d{4}$/.test(code) ? `0${code}` : code;
}

/** A row belongs to the customers unless the category column names something else (Lieferant, Partner …). */
export function categorySkip(value: string) {
  const category = line(value);
  if (!category || /kunde|customer|debitor/i.test(category)) return null;
  return `Kategorie „${category.slice(0, 40)}“`;
}

/** Fills what `target` lacks from `source`: contact fields one by one, the address only as a whole. */
function fillDraft(target: ImportDraft, source: ImportDraft) {
  for (const field of ["contactEmail", "phone", "website"] as const) target[field] ||= source[field];
  if (!target.street && !target.postalCode && !target.city && (source.street || source.postalCode || source.city)) {
    target.street = source.street;
    target.postalCode = source.postalCode;
    target.city = source.city;
    target.country = source.country;
  }
}

/**
 * Turns the rows of the file into drafts. Rows of the same company come together: the company's own row (without a
 * person) leads, and the rows of its contact persons only fill what it lacks, so a contact person never becomes a
 * customer of their own. A person without a company becomes a customer under their name.
 */
export function readRows(table: readonly string[][], mapping: ColumnMapping, normalize: (company: string) => string): ImportRow[] {
  const cell = (row: readonly string[], field: ImportField) => {
    const column = mapping[field];
    return column === null ? "" : line(row[column]);
  };
  const rows: ImportRow[] = [];
  const byCompany = new Map<string, ImportRow>();
  table.slice(1, MAX_IMPORT_ROWS + 1).forEach((cells, index) => {
    const person = [cell(cells, "firstName"), cell(cells, "lastName")].filter(Boolean).join(" ");
    const company = cell(cells, "company") || person;
    const country = countryFrom(cell(cells, "country"));
    const sourceNumber = cell(cells, "customerNumber");
    const row: ImportRow = {
      line: index + 2,
      draft: {
        company,
        customerNumber: customerNumberFrom(sourceNumber),
        contactEmail: cell(cells, "contactEmail"),
        phone: cell(cells, "phone") || cell(cells, "mobile"),
        website: cell(cells, "website"),
        street: [cell(cells, "street"), cell(cells, "houseNumber")].filter(Boolean).join(" "),
        postalCode: postalCodeFrom(cell(cells, "postalCode"), country),
        city: cell(cells, "city"),
        country,
      },
      sourceNumber,
      person,
      skip: categorySkip(cell(cells, "category")),
      problem: company ? null : "Ohne Unternehmen und ohne Namen",
      notes: [],
    };
    if (row.draft.postalCode !== cell(cells, "postalCode")) row.notes.push("Führende Null der PLZ ergänzt");
    const key = company && cell(cells, "company") ? normalize(company) : "";
    const lead = key ? byCompany.get(key) : undefined;
    if (lead && row.person && !row.skip) {
      // A contact person of a company that is already in the file: only fill what the company's row lacks.
      fillDraft(lead.draft, row.draft);
      if (!lead.draft.customerNumber && row.draft.customerNumber) { lead.draft.customerNumber = row.draft.customerNumber; lead.sourceNumber = row.sourceNumber; }
      lead.notes.push(`Ansprechpartner ${row.person} (Zeile ${row.line}) zusammengeführt`);
      return;
    }
    if (lead && !row.person && lead.person && !lead.skip) {
      // The company's own row comes after one of its contact persons: it leads from now on.
      fillDraft(row.draft, lead.draft);
      if (!row.draft.customerNumber && lead.draft.customerNumber) { row.draft.customerNumber = lead.draft.customerNumber; row.sourceNumber = lead.sourceNumber; }
      row.notes.push(`Ansprechpartner ${lead.person} (Zeile ${lead.line}) zusammengeführt`, ...lead.notes);
      rows.splice(rows.indexOf(lead), 1, row);
      byCompany.set(key, row);
      return;
    }
    if (key && !lead) byCompany.set(key, row);
    rows.push(row);
  });
  return rows.sort((a, b) => a.line - b.line);
}

/**
 * Optional values the hub would refuse (an e-mail without domain, a phone with letters) are left empty with a note
 * instead of losing the whole customer. `check` is the hub's own check of a complete draft, returning its error.
 */
export function dropInvalidValues(row: ImportRow, check: (draft: ImportDraft) => string | null): ImportRow {
  if (row.problem) return row;
  const draft = { ...row.draft };
  const notes = [...row.notes];
  const probe = { company: "Prüfung", customerNumber: "OA-0000", contactEmail: "", phone: "", website: "", street: "", postalCode: "", city: "", country: "Deutschland" };
  for (const field of ["contactEmail", "phone", "website", "postalCode"] as const) {
    if (draft[field] && check({ ...probe, [field]: draft[field] })) {
      notes.push(`${fieldLabels[field]} „${draft[field].slice(0, 60)}“ ungültig, bleibt leer`);
      draft[field] = "";
    }
  }
  return { ...row, draft, notes, problem: check({ ...draft, customerNumber: draft.customerNumber || "OA-0000" }) };
}

// Comparing with the hub ---------------------------------------------------------------------------------------------

export type ExistingCustomer = { id: string; customerNumber: string; company: string } & Record<FillableField, string>;

/**
 * The contact fields an import fills in at an existing customer: only empty ones, nothing is overwritten. The country
 * counts as empty while the customer has no address yet (the form starts with „Deutschland“).
 */
export function fillsFor(current: Record<FillableField, string>, incoming: Record<FillableField, string>): FillableField[] {
  const noAddress = !current.street.trim() && !current.postalCode.trim() && !current.city.trim();
  return fillableFields.filter((field) => {
    const value = incoming[field].trim();
    if (!value) return false;
    if (field === "country") return noAddress && value !== current.country.trim() && Boolean(incoming.street || incoming.postalCode || incoming.city);
    return !current[field].trim();
  });
}

export type PlanStatus = "new" | "update" | "same" | "skip" | "error";

export type PlannedRow = ImportRow & {
  status: PlanStatus;
  /** The hub's customer the row matches (update or same). */
  customerId: string | null;
  existingCompany: string | null;
  existingNumber: string | null;
  fills: FillableField[];
  /** The existing customer takes over the number from the file. */
  renumber: boolean;
};

/**
 * Compares the rows with the hub's customers: the number from the file first, then the company name. A match only gets
 * its empty fields filled and, if the file has another free number, that number. A number that belongs to another
 * company, the same number twice and two rows for one customer are errors. Rows without a number get a free random
 * one, like a customer created by hand.
 */
export function planImport(rows: readonly ImportRow[], customers: readonly ExistingCustomer[], normalize: (company: string) => string, random: () => number = Math.random): PlannedRow[] {
  const taken = new Set(customers.map((customer) => customer.customerNumber));
  rows.forEach((row) => { if (row.draft.customerNumber) taken.add(row.draft.customerNumber); });
  const numberSeen = new Map<string, number>();
  const customerSeen = new Map<string, number>();
  const freeNumber = () => {
    for (;;) {
      const candidate = `OA-${Math.floor(10000 + random() * 90000)}`;
      if (!taken.has(candidate)) { taken.add(candidate); return candidate; }
    }
  };
  return rows.map((row): PlannedRow => {
    const base: PlannedRow = { ...row, status: "new", customerId: null, existingCompany: null, existingNumber: null, fills: [], renumber: false };
    if (row.problem) return { ...base, status: "error" };
    const number = row.draft.customerNumber;
    const name = normalize(row.draft.company);
    const byNumber = number ? customers.find((customer) => customer.customerNumber === number) : undefined;
    const byName = name ? customers.find((customer) => normalize(customer.company) === name) : undefined;
    if (number && numberSeen.has(number)) return { ...base, status: "error", problem: `Kundennummer ${number} steht schon in Zeile ${numberSeen.get(number)}` };
    if (number) numberSeen.set(number, row.line);
    if (byNumber && byNumber.id !== byName?.id && normalize(byNumber.company) !== name) {
      return { ...base, status: "error", problem: `Kundennummer ${number} gehört im Hub zu „${byNumber.company}“` };
    }
    const match = byNumber ?? byName;
    if (match) {
      if (customerSeen.has(match.id)) return { ...base, status: "error", problem: `Passt zum selben Kunden wie Zeile ${customerSeen.get(match.id)}` };
      customerSeen.set(match.id, row.line);
      const fills = fillsFor(match, row.draft);
      const renumber = Boolean(number) && number !== match.customerNumber;
      const matched = { ...base, customerId: match.id, existingCompany: match.company, existingNumber: match.customerNumber, fills, renumber };
      if (row.skip) return { ...matched, status: "skip" };
      return { ...matched, status: fills.length || renumber ? "update" : "same" };
    }
    const draft = number ? row.draft : { ...row.draft, customerNumber: freeNumber() };
    const notes = number ? row.notes : [...row.notes, "Ohne Nummer in der Datei, freie Nummer vergeben"];
    return { ...base, draft, notes, status: row.skip ? "skip" : "new" };
  });
}

/** Rows that can be ticked; new and update rows start ticked, skipped ones only on request. */
export const isSelectable = (row: PlannedRow) => row.status === "new" || row.status === "update" || (row.status === "skip" && !row.problem);
export const isPreselected = (row: PlannedRow) => row.status === "new" || row.status === "update";

/** What a skipped row would do when ticked: create a customer or fill in a match. */
export const effectiveStatus = (row: PlannedRow): "new" | "update" | "same" => row.customerId ? (row.fills.length || row.renumber ? "update" : "same") : "new";
