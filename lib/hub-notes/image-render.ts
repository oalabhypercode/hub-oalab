/**
 * Turning an uploaded picture into the one a note keeps (app/api/notes/image, 27.11.2026): upright, at most 2400 pixels
 * wide, 16,000 high and 6 megapixels (lib/hub-notes/rules.ts storedSize), never larger than it was, as WebP without its
 * metadata (no camera, place or time). Server only, through lib/hub-notes/write.ts and the hub's one line for image
 * work (lib/hub-files/image-work.ts). Imports only lib/hub-notes/rules.ts, so the tests call it directly.
 */
import { storedSize } from "./rules";

export type RenderedNoteImage = { data: Buffer; width: number; height: number };

/**
 * The most a picture may have to be read at all: PNG and GIF are read in full, so above 24 megapixels the hub refuses it
 * instead of risking its memory. The browser shrinks pictures to 6 megapixels before they go up.
 */
export const NOTE_IMAGE_READ_MAX_PIXELS = 24_000_000;

/**
 * Screenshots carry small text: WebP at quality 88 with sharper colour edges keeps it readable at a fraction of a PNG's
 * size. null when the bytes are no picture the server can read (HEIC, a PDF, a broken file) or too large.
 */
export async function renderNoteImage(bytes: Uint8Array): Promise<RenderedNoteImage | null> {
  try {
    const sharp = (await import("sharp")).default;
    // No image cache in memory (a picture is made once, then kept in storage), one thread per picture.
    sharp.cache(false);
    sharp.concurrency(1);
    const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const meta = await sharp(input, { limitInputPixels: NOTE_IMAGE_READ_MAX_PIXELS }).metadata();
    if (!meta.width || !meta.height || meta.width * meta.height > NOTE_IMAGE_READ_MAX_PIXELS) return null;
    const turned = (meta.orientation ?? 1) >= 5;
    const target = storedSize(turned ? meta.height : meta.width, turned ? meta.width : meta.height);
    const { data, info } = await sharp(input, { limitInputPixels: NOTE_IMAGE_READ_MAX_PIXELS })
      .rotate()
      .resize({ width: target.width, height: target.height, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 88, alphaQuality: 90, smartSubsample: true })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    return null;
  }
}
