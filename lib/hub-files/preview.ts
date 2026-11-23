/**
 * Image previews of stored files (user 23.11.2026): a small WebP made on the server, so every image shows itself in a
 * file's details (and later as a tile), whatever its size and whatever type the browser reported when it was uploaded.
 * Before, the details loaded the original through a 60-second link and showed only images up to 8 MB with an image
 * type, so large photos and logos uploaded without a type showed just their symbol.
 *
 * Self-contained (no imports at run time) so the server, the browser and the tests share the same rules.
 */

/** „s“ for small pictures (lists, tiles), „l“ for the details panel. */
export type PreviewSize = "s" | "l";
export const isPreviewSize = (value: unknown): value is PreviewSize => value === "s" || value === "l";

/** The longest edge of a preview in pixels: sharp on a phone's screen, small enough to load at once. */
export const PREVIEW_EDGE: Record<PreviewSize, number> = { s: 480, l: 1200 };

/** At most about 50 megapixels per image: more would take too long and too much memory on the server. */
export const PREVIEW_MAX_PIXELS = 50_000_000;

/** Formats the server turns into a preview. Decided by the name first: a type the browser left out does not matter. */
const imageExtensions = new Set(["png", "jpg", "jpeg", "jfif", "gif", "webp", "avif", "svg", "tif", "tiff"]);
/** iPhone photos: browsers and the server's image library cannot read them, so the details explain it instead. */
const heicExtensions = new Set(["heic", "heif"]);
/** Formats that may be see-through, so they stand on a chequered ground (light, or dark for a light logo). */
const clearExtensions = new Set(["png", "gif", "webp", "avif", "svg"]);

const extensionOf = (fileName: string) => /\.([a-z0-9]{1,10})$/i.exec(fileName.trim())?.[1].toLowerCase() ?? "";

/** "image": a preview can be made; "heic": an iPhone photo without one; null: no image (a PDF, say). */
export function previewKind(fileName: string, mimeType: string): "image" | "heic" | null {
  const extension = extensionOf(fileName);
  const type = mimeType.toLowerCase();
  if (heicExtensions.has(extension) || type === "image/heic" || type === "image/heif") return "heic";
  if (imageExtensions.has(extension)) return "image";
  if (!extension && type.startsWith("image/")) return "image";
  return null;
}

/** Whether the image may have see-through parts (it then gets a chequered ground). */
export const mayBeClear = (fileName: string) => clearExtensions.has(extensionOf(fileName));

/** The address of a file's preview. `v` changes with the stored bytes, so the browser may keep it for a day. */
export function previewUrl(file: { id: string; sha256: string | null; createdAt: string }, size: PreviewSize) {
  const version = file.sha256 ? file.sha256.slice(0, 12) : String(Date.parse(file.createdAt) || 0);
  return `/api/files/${encodeURIComponent(file.id)}/preview?size=${size}&v=${version}`;
}

/** The shape of the preview box: the image's own, kept between 4:3 upright and 12:5 wide, so nothing gets tiny. */
export const previewRatio = (width: number, height: number) => width > 0 && height > 0 ? Math.min(2.4, Math.max(0.75, width / height)) : 4 / 3;

/** "1600x1067" from the preview's header, else null. */
export function parseImageSize(value: string | null): { width: number; height: number } | null {
  const match = /^(\d{1,6})x(\d{1,6})$/.exec(value ?? "");
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

