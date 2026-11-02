/**
 * Customer logos (Asset Management, step 2): an image per customer instead of the initials, private like the files.
 * The bucket, its limits and who may read which logo come from the Service migration 202611020001_hub_customer_logos.
 */

export const LOGO_BUCKET = "hub-logos";
/** The bucket takes up to 2 MB; the migration sets the same limit. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
/** Links for showing a logo live an hour; every page load signs them anew. */
export const LOGO_URL_SECONDS = 60 * 60;

export const logoTypes = { "image/svg+xml": "svg", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;
export type LogoType = keyof typeof logoTypes;
export const LOGO_ACCEPT = Object.keys(logoTypes).join(",");
const typeByExtension: Record<string, LogoType> = { svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

export const logoBackgrounds = ["light", "dark", "brand"] as const;
export type LogoBackground = (typeof logoBackgrounds)[number];
export const logoBackgroundLabels: Record<LogoBackground, string> = { light: "Hell", dark: "Dunkel", brand: "Markenfarbe" };
export const DEFAULT_BRAND_COLOR = "#7e004b";

/** What a page shows: a short-lived link and the tile the logo sits on (the colour only for "brand"). */
export type CustomerLogo = { url: string; background: LogoBackground; color: string | null };

export const isLogoBackground = (value: unknown): value is LogoBackground => typeof value === "string" && (logoBackgrounds as readonly string[]).includes(value);

/** "#7E004B" or "7e004b" become "#7e004b"; anything else is no colour. */
export function cleanLogoColor(value: unknown) {
  const match = typeof value === "string" ? /^#?([0-9a-f]{6})$/i.exec(value.trim()) : null;
  return match ? `#${match[1].toLowerCase()}` : null;
}

/** The browser's type, or the one of the file name when the browser gives none (some systems leave SVG empty). */
export function logoTypeOf(fileName: string, mimeType: string): LogoType | null {
  if (mimeType in logoTypes) return mimeType as LogoType;
  if (mimeType && mimeType !== "application/octet-stream") return null;
  return typeByExtension[fileName.toLowerCase().split(".").pop() ?? ""] ?? null;
}

export function checkLogoFile(fileName: string, sizeBytes: number, mimeType: string): { ok: true; type: LogoType } | { ok: false; error: string } {
  const type = logoTypeOf(fileName, mimeType);
  if (!type) return { ok: false, error: "Als Logo gehen SVG, PNG, JPG oder WebP." };
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return { ok: false, error: "Die Datei ist leer." };
  if (sizeBytes > MAX_LOGO_BYTES) return { ok: false, error: "Ein Logo darf höchstens 2 MB groß sein." };
  return { ok: true, type };
}

/** Files of a customer that may become the logo: an image type and at most 2 MB. */
export const canBeLogo = (file: { fileName: string; mimeType: string; sizeBytes: number }) => checkLogoFile(file.fileName, file.sizeBytes, file.mimeType).ok;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A fresh place in the customer's own folder; the migration accepts no other path for this customer. */
export function newLogoPath(customerId: string, type: LogoType) {
  if (!uuid.test(customerId)) throw new Error("Unknown customer");
  return `logos/${customerId.toLowerCase()}/${crypto.randomUUID()}.${logoTypes[type]}`;
}

export const isLogoPathOf = (path: string, customerId: string) =>
  uuid.test(customerId) && new RegExp(`^logos/${customerId.toLowerCase()}/[0-9a-f-]{36}\\.(svg|png|jpg|webp)$`).test(path);
