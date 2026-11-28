/*
 * The customers' upload area (plan „Meeting-Knöpfe und Upload-Bereich“, preview „Version 3“ approved 27.11.2026):
 * customers send large files to oalab; a file waits at most 7 days until an admin takes it over into the customer's
 * files. The database keeps the limits and the rows (service-oalab 202611280001_hub_customer_uploads); these are the
 * rules the hub shows. No imports, so tests/hub-uploads.test.mjs loads this file as it is; the check before an upload,
 * which needs the file catalog, lives in ./check.ts.
 */

const extensionOf = (fileName: string) => /\.([a-z0-9]{1,10})$/i.exec(fileName.trim())?.[1]?.toLowerCase() ?? "";
const berlinDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" });

export const GiB = 1024 ** 3;
/** One file at most, as in the database. */
export const UPLOAD_MAX_BYTES = 5 * GiB;
/** Parts of a multipart upload: below Cloudflare's 100 MB per request, so 5 GB take 80 parts. */
export const UPLOAD_PART_BYTES = 64 * 1024 ** 2;
export const UPLOAD_KEEP_DAYS = 7;
/** The admin's choices for a limit („Speicher“), in bytes. */
export const UPLOAD_LIMIT_CHOICES = [1, 2, 5, 10, 20, 50].map((gb) => gb * GiB);
/** Parallel part uploads of one file in the browser. */
export const UPLOAD_PARALLEL_PARTS = 3;

export const partCount = (size: number) => Math.max(1, Math.ceil(size / UPLOAD_PART_BYTES));
/** Byte range [start, end) of part `number` (1-based). */
export const partRange = (size: number, number: number) => ({ start: (number - 1) * UPLOAD_PART_BYTES, end: Math.min(size, number * UPLOAD_PART_BYTES) });

export type UploadKind = "video" | "archive" | "image" | "doc";
const kindByExtension: Record<string, UploadKind> = {
  mp4: "video", mov: "video", m4v: "video", webm: "video", avi: "video", mkv: "video", mxf: "video", wmv: "video",
  zip: "archive", rar: "archive", "7z": "archive", tar: "archive", gz: "archive", tgz: "archive",
  jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image", heic: "image", heif: "image", tif: "image", tiff: "image",
  svg: "image", psd: "image", ai: "image", eps: "image", raw: "image", cr2: "image", nef: "image", arw: "image", dng: "image",
};
/** Which icon a file gets in the list: video, archive, image or document. */
export function uploadKind(fileName: string, mimeType = ""): UploadKind {
  const byName = kindByExtension[extensionOf(fileName)];
  if (byName) return byName;
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("image/")) return "image";
  return "doc";
}

const DAY_MS = 86_400_000;
/** Whole calendar days in Berlin between two instants (0 = the same day). */
export function daysBetween(from: number, to: number) {
  return Math.round((Date.parse(`${berlinDay.format(to)}T00:00:00Z`) - Date.parse(`${berlinDay.format(from)}T00:00:00Z`)) / DAY_MS);
}

export type ExpiryTone = "off" | "todo" | "bad";
/**
 * How long a waiting upload stays: „läuft heute ab“, „noch 1 Tag“, „noch 6 Tage“. Admins see time left calmly (grey
 * from three days, yellow below, red on its last day); customers see their waiting files yellow, red on the last day.
 */
export function expiryOf(expiresAt: number, now: number, audience: "admin" | "customer") {
  const days = Math.max(0, daysBetween(now, expiresAt));
  const text = days === 0 ? "läuft heute ab" : days === 1 ? "noch 1 Tag" : `noch ${days} Tage`;
  // The phone's narrow column „Rest“.
  const short = days === 0 ? "heute" : days === 1 ? "1 Tag" : `${days} Tage`;
  const tone: ExpiryTone = audience === "admin"
    ? days === 0 ? "bad" : days <= 2 ? "todo" : "off"
    : days <= 1 ? "bad" : "todo";
  return { days, text, short, tone };
}

/** A limit as the admin chooses it: „5 GB“; `null` is the default. */
export const limitLabel = (bytes: number) => `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(bytes / GiB)} GB`;

/** The meter of the space: share used, and its tone (yellow from 75 %, red from 90 %). */
export function spaceMeter(used: number, limit: number) {
  const share = limit > 0 ? Math.min(1, used / limit) : 1;
  return { percent: Math.round(share * 100), tone: share >= 0.9 ? "full" : share >= 0.75 ? "warn" : "" } as const;
}
