/**
 * Turning a stored image into its preview (lib/hub-files/preview.ts says which files get one). Server only, through
 * lib/hub-files/preview-server.ts; no imports at run time, so the tests call it directly.
 */

export type RenderedPreview = { data: Buffer; width: number; height: number };

/**
 * One preview: the image turned upright, at most `edge` pixels on its longest side (never larger than it is, except a
 * vector graphic, which is drawn at the size the box needs), as WebP without its metadata. `width` and `height` are the
 * original's, upright. null when the bytes are no image the server can read (HEIC, a PDF, a broken file) or have more
 * than `maxPixels`.
 */
export async function renderPreview(bytes: Uint8Array, { edge, quality, maxPixels }: { edge: number; quality: number; maxPixels: number }): Promise<RenderedPreview | null> {
  try {
    const sharp = (await import("sharp")).default;
    const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const meta = await sharp(input, { limitInputPixels: maxPixels }).metadata();
    if (!meta.width || !meta.height) return null;
    const turned = (meta.orientation ?? 1) >= 5;
    const width = turned ? meta.height : meta.width;
    const height = turned ? meta.width : meta.height;
    const vector = meta.format === "svg";
    // A small SVG (a logo of 120 × 40 units, say) is drawn at a density that fills the box, so it stays sharp.
    const density = vector ? Math.min(2400, Math.max(72, Math.ceil((72 * edge) / Math.max(width, height)))) : undefined;
    const data = await sharp(input, { limitInputPixels: maxPixels, ...(density ? { density } : {}) })
      .rotate()
      .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: !vector })
      .webp({ quality, alphaQuality: 90 })
      .toBuffer();
    return { data, width, height };
  } catch {
    return null;
  }
}
