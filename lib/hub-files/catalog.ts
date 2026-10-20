/**
 * Shared rules for the hub's file exchange: categories, limits and formatting.
 * Self-contained (no imports) so client, server and tests use the same rules.
 */

export const fileCategories = {
  contract: "Vertrag",
  offer: "Angebot",
  invoice: "Rechnung",
  brand: "Logo & Marke",
  design: "Design",
  website: "Website & Inhalte",
  documentation: "Dokumentation",
  other: "Sonstiges",
} as const;

export type FileCategory = keyof typeof fileCategories;
export const fileCategoryIds = Object.keys(fileCategories) as FileCategory[];
export const isFileCategory = (value: unknown): value is FileCategory => typeof value === "string" && value in fileCategories;

/** Matches the bucket limit in supabase/migrations. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const HUB_FILES_BUCKET = "hub-files";

/** Executable or script formats are never accepted, whatever the browser reports as type. */
const blockedExtensions = ["exe", "msi", "bat", "cmd", "com", "scr", "ps1", "vbs", "js", "mjs", "jar", "sh", "app", "dmg", "html", "htm", "php"];

export function fileExtension(fileName: string) {
  const match = /\.([a-z0-9]{1,10})$/i.exec(fileName.trim());
  return match ? match[1].toLowerCase() : "";
}

/** Readable format label for the table, e.g. "PDF" or "SVG". */
export function fileFormat(fileName: string) {
  return fileExtension(fileName).toUpperCase() || "Datei";
}

export type UploadCheck = { ok: true } | { ok: false; error: string };

export function checkUpload(fileName: string, sizeBytes: number): UploadCheck {
  if (!fileName.trim() || fileName.length > 255) return { ok: false, error: "Der Dateiname ist leer oder zu lang." };
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return { ok: false, error: "Die Datei ist leer." };
  if (sizeBytes > MAX_FILE_BYTES) return { ok: false, error: "Die Datei ist größer als 50 MB." };
  if (blockedExtensions.includes(fileExtension(fileName))) return { ok: false, error: "Ausführbare Dateien und Skripte können nicht hochgeladen werden." };
  return { ok: true };
}

/** Storage key segment: ASCII only, no path separators; the original name is kept separately for downloads. */
export function storageSafeName(fileName: string) {
  const extension = fileExtension(fileName);
  const trimmed = fileName.trim();
  const base = (extension ? trimmed.slice(0, -(extension.length + 1)) : trimmed)
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80) || "datei";
  return extension ? `${base}.${extension}` : base;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)} ${units[unit]}`;
}

/** Fixture timestamps without zone are UTC wall time; Supabase timestamps carry their zone. Same output on server and client. */
const parseTimestamp = (iso: string) => Date.parse(iso.length <= 10 ? `${iso}T00:00:00Z` : /T\d\d:\d\d$/.test(iso) ? `${iso}:00Z` : iso);

export function formatFileDate(iso: string) {
  return new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "short", year: "numeric" }).format(parseTimestamp(iso));
}

export function formatFileDateTime(iso: string) {
  return new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(parseTimestamp(iso));
}
