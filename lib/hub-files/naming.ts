/**
 * Names after a pattern for many files at once (user 13.11.2026), like the file names of a Lightroom export: up to six
 * positions (own text, customer, customer number, folder, category, date, year, number, old name) joined by a separator.
 * The upload names new files with it, the selection bar existing ones. Only the title and the download name change;
 * the stored file keeps its place, so renaming never moves bytes.
 * Self-contained (no imports) so the panels, the server actions and the tests share the same rules.
 */

export type NamePartKind = "text" | "customer" | "customerNumber" | "folder" | "category" | "date" | "year" | "number" | "original";
export type DateStyle = "iso" | "compact" | "de";
export type NumberDigits = "auto" | "1" | "2" | "3" | "4";
export type NameSeparator = "_" | "-" | " ";
/** Order of the numbers: when the photos were taken, the old names A–Z, or as the files were added. */
export type NameOrder = "taken" | "name" | "added";

export type NamePart = {
  id: string;
  kind: NamePartKind;
  /** Own text ("text" only). */
  text: string;
  /** Date format ("date" only). */
  dateStyle: DateStyle;
  /** First number ("number" only); null counts on after the numbers already in the folder. */
  start: number | null;
  digits: NumberDigits;
};

export type NamingPattern = {
  parts: NamePart[];
  separator: NameSeparator;
  /** Lower case, ä → ae, no spaces or special characters, for websites. */
  webSafe: boolean;
  /** With images and other files mixed: only the images get the pattern. */
  imagesOnly: boolean;
  order: NameOrder;
};

/** One file to name, with everything its parts can show. */
export type NamingEntry = {
  key: string;
  /** Current name with extension (the original one on upload). */
  fileName: string;
  image: boolean;
  /** When it was taken: YYYY-MM-DD, optionally with THH:MM(:SS). */
  taken: string;
  customer: string;
  customerNumber: string;
  folder: string;
  category: string;
  /** Where the file ends up (customer and folder): numbers continue and clashes count per place. */
  place: string;
  /** Position in which it was added or selected. */
  index: number;
};

export type NamedFile = { base: string; position: number };

export type NamingResult = {
  /** New names without extension, for the files the pattern applies to. */
  names: Map<string, NamedFile>;
  /** Those files in the order of their numbers. */
  affected: NamingEntry[];
  number: NamePart | null;
  start: number;
  /** The number after the highest one that already exists with this pattern in the place (1 when there is none). */
  suggested: number;
  digits: number;
  /** New names that would repeat within the batch; they get _2, _3 … */
  duplicates: number;
  /** New names that a file in the same place already has. */
  clashes: number;
  emptyText: boolean;
  /** Parts without a value for at least one file (no folder chosen, no or several customers). */
  missing: NamePartKind[];
  /** Images and other files mixed: the scope ("Nur Bilder" / "Alle Dateien") matters. */
  mixed: boolean;
  images: number;
  separator: string;
};

export const MAX_NAME_PARTS = 6;
export const MAX_PART_TEXT = 60;
/** Titles may have 200 characters; the download name adds at most the extension. */
export const MAX_NAME = 200;
export const MAX_FILE_NAME = 255;

export const namePartKinds: Record<NamePartKind, { label: string; hint: string }> = {
  text: { label: "Eigener Text", hint: "Begriff" },
  customer: { label: "Kunde", hint: "Firmenname" },
  customerNumber: { label: "Kundennummer", hint: "KD-…" },
  folder: { label: "Ordner", hint: "Zielordner" },
  category: { label: "Kategorie", hint: "je Datei" },
  date: { label: "Datum", hint: "Aufnahmetag" },
  year: { label: "Jahr", hint: "Aufnahmejahr" },
  number: { label: "Nummer", hint: "01, 02, 03 …" },
  original: { label: "Alter Name", hint: "je Datei" },
};

export const namePartGroups: { label: string; kinds: NamePartKind[] }[] = [
  { label: "Eigenes", kinds: ["text"] },
  { label: "Aus dem Hub", kinds: ["customer", "customerNumber", "folder", "category"] },
  { label: "Datum", kinds: ["date", "year"] },
  { label: "Zählen", kinds: ["number"] },
  { label: "Datei", kinds: ["original"] },
];

const kinds = Object.keys(namePartKinds) as NamePartKind[];
const isKind = (value: unknown): value is NamePartKind => typeof value === "string" && kinds.includes(value as NamePartKind);

let partCount = 0;
/** A new position; ids only tell the positions of one pattern apart. */
export function namePart(kind: NamePartKind, change: Partial<Omit<NamePart, "id" | "kind">> = {}): NamePart {
  partCount += 1;
  return { id: `part-${partCount}`, kind, text: "", dateStyle: "iso", start: null, digits: "auto", ...change };
}

export const builtInTemplates: { id: string; label: string; kinds: NamePartKind[] }[] = [
  { id: "customer-folder-number", label: "Kunde · Ordner · Nummer", kinds: ["customer", "folder", "number"] },
  { id: "customer-text-year-number", label: "Kunde · Begriff · Jahr · Nummer", kinds: ["customer", "text", "year", "number"] },
  { id: "date-text-number", label: "Datum · Begriff · Nummer", kinds: ["date", "text", "number"] },
  { id: "customer-original", label: "Kunde · alter Name", kinds: ["customer", "original"] },
];

export const defaultPattern = (): NamingPattern => ({ parts: builtInTemplates[0].kinds.map((kind) => namePart(kind)), separator: "_", webSafe: false, imagesOnly: true, order: "taken" });

/* ---------- Names and extensions ---------- */

const extensionPattern = /\.([a-z0-9]{1,10})$/i;

/** ".jpg" for "IMG_4790.JPG"; empty without one. Lower case, like the formats in the lists. */
export function nameExtension(fileName: string) {
  const match = extensionPattern.exec(fileName.trim());
  return match ? `.${match[1].toLowerCase()}` : "";
}

/** The name without its extension. */
export function nameBase(fileName: string) {
  const trimmed = fileName.trim();
  const match = extensionPattern.exec(trimmed);
  return match ? trimmed.slice(0, -match[0].length) : trimmed;
}

/** A name as people type it, safe as a download name: no \ / : * ? " < > |, no control characters, single spaces. */
export function cleanName(value: unknown, max = MAX_NAME) {
  const visible = Array.from(String(value ?? "")).filter((char) => { const code = char.charCodeAt(0); return code > 31 && code !== 127; }).join("");
  return visible.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

/** Lower case, umlauts written out, everything else a hyphen: "Café Müller & Söhne" → "cafe-mueller-soehne". */
export function webSafeName(value: string) {
  return value.toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const imageExtensions = new Set(["jpg", "jpeg", "png", "heic", "heif", "webp", "gif", "tif", "tiff", "avif", "bmp", "dng", "cr2", "cr3", "nef", "arw", "raf", "orf", "rw2"]);
export const isImageName = (fileName: string, mimeType = "") => mimeType.startsWith("image/") || imageExtensions.has(nameExtension(fileName).slice(1));

/** Names from cameras and messengers ("IMG-20261102-WA0007", "PXL_…", "DSC_0042", long runs of digits). */
export function looksLikeCameraName(fileName: string) {
  const base = nameBase(fileName);
  return /^(IMG|PXL|DSC|DSCF|DCIM|VID|MVIMG|Screenshot|WhatsApp|Bildschirmfoto|photo|image|P\d{5,})[-_ ]?/i.test(base) || (base.match(/\d/g) ?? []).length >= 6;
}

/* ---------- When a photo was taken ---------- */

function validDay(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const nameDate = /(?:^|[^0-9])((?:19|20)\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?![0-9])(?:(?:[-_ T.]|\s(?:at|um)\s)([01]\d|2[0-3])[-_.:]?([0-5]\d)(?:[-_.:]?([0-5]\d))?)?/i;

/**
 * The day (and time) in names from phones and messengers: WhatsApp "IMG-20261028-WA0003", Android "IMG_20261028_101544",
 * Pixel "PXL_20261101_142233118", "Screenshot_20261029-101544", "WhatsApp Image 2026-10-28 at 10.02.15",
 * "Bildschirmfoto 2026-10-29 um 10.15.44". WhatsApp removes the photo data, so the name is often all there is.
 */
export function dateFromFileName(fileName: string) {
  const match = nameDate.exec(nameBase(fileName));
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  if (!validDay(Number(year), Number(month), Number(day))) return null;
  return `${year}-${month}-${day}${hour ? `T${hour}:${minute}${second ? `:${second}` : ""}` : ""}`;
}

/** "2026-10-28T10:02" in the computer's own time, for a file date. */
export function localDateTime(date: Date) {
  const two = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
}

/**
 * The moment a JPEG photo was taken (EXIF DateTimeOriginal, else DateTime), from the first bytes of the file; null for
 * other formats and photos without it. HEIC keeps its data elsewhere, so phones' HEIC photos fall back to the file date.
 */
export function photoDate(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    // Start of the image data or its end: no metadata after this.
    if (marker === 0xda || marker === 0xd9) return null;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) return null;
    const end = Math.min(bytes.length, offset + 2 + length);
    if (marker === 0xe1 && end - offset >= 18 && String.fromCharCode(...bytes.subarray(offset + 4, offset + 10)) === "Exif\0\0") {
      return tiffDate(new DataView(bytes.buffer, bytes.byteOffset + offset + 10, end - offset - 10));
    }
    offset += 2 + length;
  }
  return null;
}

function tiffDate(view: DataView) {
  if (view.byteLength < 8) return null;
  const order = view.getUint16(0);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const little = order === 0x4949;
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);
  if (u16(2) !== 42) return null;
  const entries = (at: number) => {
    const found = new Map<number, number>();
    if (at < 8 || at + 2 > view.byteLength) return found;
    const count = Math.min(u16(at), 400);
    for (let index = 0; index < count; index++) {
      const entry = at + 2 + index * 12;
      if (entry + 12 > view.byteLength) break;
      found.set(u16(entry), entry);
    }
    return found;
  };
  const dateAt = (entry: number | undefined) => {
    if (entry === undefined || u32(entry + 4) < 19) return null;
    const at = u32(entry + 8);
    if (at + 19 > view.byteLength) return null;
    let text = "";
    for (let index = 0; index < 19; index++) text += String.fromCharCode(view.getUint8(at + index));
    const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(text);
    if (!match || !validDay(Number(match[1]), Number(match[2]), Number(match[3])) || Number(match[4]) > 23 || Number(match[5]) > 59) return null;
    return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`;
  };
  const first = entries(u32(4));
  const pointer = first.get(0x8769);
  if (pointer !== undefined) {
    const exif = entries(u32(pointer + 8));
    const taken = dateAt(exif.get(0x9003)) ?? dateAt(exif.get(0x9004));
    if (taken) return taken;
  }
  return dateAt(first.get(0x0132));
}

/* ---------- Names after the pattern ---------- */

const collator = new Intl.Collator("de", { numeric: true, sensitivity: "base" });
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Stands for the number while the pattern is compared with the names already in the folder. */
const NUMBER_SLOT = "";

export const formatNumber = (value: number, digits: number) => String(value).padStart(digits, "0");

export function dateText(taken: string, style: DateStyle) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(taken);
  if (!match) return "";
  const [, year, month, day] = match;
  return style === "compact" ? `${year}${month}${day}` : style === "de" ? `${day}-${month}-${year}` : `${year}-${month}-${day}`;
}

/** One position's text for one file: cleaned, spaces as hyphens unless the separator is a space. */
export function partValue(part: NamePart, entry: NamingEntry, pattern: Pick<NamingPattern, "separator" | "webSafe">) {
  const text = (value: string) => {
    const clean = cleanName(value);
    if (pattern.webSafe) return webSafeName(clean);
    return pattern.separator === " " ? clean : clean.replace(/ /g, "-");
  };
  switch (part.kind) {
    case "text": return text(part.text);
    case "customer": return text(entry.customer);
    case "customerNumber": return text(entry.customerNumber);
    case "folder": return text(entry.folder);
    case "category": return text(entry.category);
    case "date": return dateText(entry.taken, part.dateStyle);
    case "year": return /^\d{4}/.test(entry.taken) ? entry.taken.slice(0, 4) : "";
    case "original": return text(nameBase(entry.fileName));
    case "number": return "";
  }
}

export function orderEntries(list: NamingEntry[], order: NameOrder) {
  const copy = [...list];
  if (order === "taken") copy.sort((a, b) => a.taken.localeCompare(b.taken) || collator.compare(a.fileName, b.fileName) || a.index - b.index);
  else if (order === "name") copy.sort((a, b) => collator.compare(a.fileName, b.fileName) || a.index - b.index);
  else copy.sort((a, b) => a.index - b.index);
  return copy;
}

/**
 * New names for the files the pattern applies to. `existing` lists the names (titles and download names without
 * extension) of the other files per place: the number continues after the highest one with the same pattern there,
 * and names that are already taken count as clashes. Files in `own` were named by hand and keep their names.
 */
export function nameFiles(entries: NamingEntry[], pattern: NamingPattern, existing: ReadonlyMap<string, readonly string[]>, own: ReadonlySet<string> = new Set()): NamingResult {
  const separator = pattern.webSafe && pattern.separator === " " ? "-" : pattern.separator;
  const images = entries.filter((entry) => entry.image).length;
  const mixed = images > 0 && images < entries.length;
  const affected = orderEntries(entries.filter((entry) => !own.has(entry.key) && (!pattern.imagesOnly || !mixed || entry.image)), pattern.order);
  const number = pattern.parts.find((part) => part.kind === "number") ?? null;
  const join = (entry: NamingEntry, numberText: string) => pattern.parts
    .map((part) => part.kind === "number" ? numberText : partValue(part, entry, pattern))
    .filter(Boolean).join(separator);
  const known = (place: string) => existing.get(place) ?? [];

  let suggested = 1;
  if (number) {
    const shapes = new Map<string, RegExp>();
    for (const entry of affected) {
      const source = `${entry.place}\n${join(entry, NUMBER_SLOT)}`;
      if (shapes.has(source)) continue;
      const shape = new RegExp(`^${escapeRegExp(join(entry, NUMBER_SLOT)).replace(NUMBER_SLOT, "(\\d{1,6})")}$`, "i");
      shapes.set(source, shape);
      for (const name of known(entry.place)) {
        const match = shape.exec(name);
        if (match) suggested = Math.max(suggested, Number(match[1]) + 1);
      }
    }
  }
  const start = number ? number.start ?? suggested : 1;
  const last = start + Math.max(affected.length, 1) - 1;
  const digits = !number ? 0 : number.digits === "auto" ? Math.max(2, String(last).length) : Number(number.digits);

  const names = new Map<string, NamedFile>();
  affected.forEach((entry, index) => {
    const base = join(entry, formatNumber(start + index, digits)) || nameBase(entry.fileName);
    names.set(entry.key, { base: base.slice(0, MAX_NAME), position: index + 1 });
  });
  const seen = new Map<string, number>();
  let duplicates = 0;
  for (const named of names.values()) {
    const key = named.base.toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count > 1) { named.base = `${named.base}${separator}${count}`; duplicates++; }
  }
  let clashes = 0;
  for (const entry of affected) {
    const base = names.get(entry.key)?.base.toLowerCase();
    if (base && known(entry.place).some((name) => name.toLowerCase() === base)) clashes++;
  }
  const missing = (["customer", "customerNumber", "folder"] as const).filter((kind) => pattern.parts.some((part) => part.kind === kind)
    && affected.some((entry) => !partValue({ id: "", kind, text: "", dateStyle: "iso", start: null, digits: "auto" }, entry, pattern)));
  const emptyText = pattern.parts.some((part) => part.kind === "text" && !cleanName(part.text));
  return { names, affected, number, start, suggested, digits, duplicates, clashes, emptyText, missing, mixed, images, separator };
}

/* ---------- Saving patterns (templates, the last one used) ---------- */

export type StoredPattern = { parts: Omit<NamePart, "id">[]; separator: NameSeparator; webSafe: boolean; imagesOnly: boolean; order: NameOrder };

export function storePattern(pattern: NamingPattern): StoredPattern {
  return { ...pattern, parts: pattern.parts.map(({ kind, text, dateStyle, start, digits }) => ({ kind, text, dateStyle, start, digits })) };
}

/** A pattern read back from the browser's storage; anything unknown or broken gives null, never a half pattern. */
export function readPattern(value: unknown): NamingPattern | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.parts) || !raw.parts.length || raw.parts.length > MAX_NAME_PARTS) return null;
  const parts: NamePart[] = [];
  for (const item of raw.parts) {
    const part = item as Record<string, unknown> | null;
    if (!part || !isKind(part.kind)) return null;
    const start = typeof part.start === "number" && Number.isInteger(part.start) && part.start >= 0 && part.start < 100000 ? part.start : null;
    parts.push(namePart(part.kind, {
      text: typeof part.text === "string" ? part.text.slice(0, MAX_PART_TEXT) : "",
      dateStyle: part.dateStyle === "compact" || part.dateStyle === "de" ? part.dateStyle : "iso",
      start,
      digits: part.digits === "1" || part.digits === "2" || part.digits === "3" || part.digits === "4" ? part.digits : "auto",
    }));
  }
  return {
    parts,
    separator: raw.separator === "-" || raw.separator === " " ? raw.separator : "_",
    webSafe: raw.webSafe === true,
    imagesOnly: raw.imagesOnly !== false,
    order: raw.order === "name" || raw.order === "added" ? raw.order : "taken",
  };
}

/** The name of the built-in template with the same positions, or null for an own pattern. */
export function builtInTemplateOf(pattern: NamingPattern) {
  const shape = pattern.parts.map((part) => part.kind).join(",");
  return builtInTemplates.find((template) => template.kinds.join(",") === shape) ?? null;
}

export const samePattern = (a: NamingPattern, b: NamingPattern) => JSON.stringify(storePattern(a)) === JSON.stringify(storePattern(b));
