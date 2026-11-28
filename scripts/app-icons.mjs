// App icons of the web app (decision of 16.11.2026, variant A: the mark alone, the name stands under the icon).
// The oalab gradient of app/brand.css (160°, bordeaux → red → orange) to the edge, the white mark of
// public/brand/oalab-logo.png in the middle, inside the round safe zone of maskable icons (80 %).
//   node scripts/app-icons.mjs
// Writes public/app-icons/. sharp comes with Next.js; run it again only when the logo changes.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const SIZE = 1024;
/** The mark is 59 % of the icon wide: clear on the home screen, its corners inside the maskable circle. */
const MARK_WIDTH = 600;
/** Rounded corners of the "any" icons (desktops and install dialogs show them as they are). */
const CORNER = 0.225;
const out = new URL("../public/app-icons/", import.meta.url);

const gradient = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <defs><linearGradient id="g" x1="0.33" y1="0" x2="0.67" y2="1">
    <stop offset="0" stop-color="#7e004b"/><stop offset="0.48" stop-color="#8f1d21"/><stop offset="1" stop-color="#f37222"/>
  </linearGradient></defs>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#g)"/>
</svg>`);
const corners = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><rect width="${SIZE}" height="${SIZE}" rx="${SIZE * CORNER}" ry="${SIZE * CORNER}"/></svg>`);

// The logo holds the mark on top and the wordmark below, with empty rows between; the icon takes the mark only.
const logo = sharp(fileURLToPath(new URL("../public/brand/oalab-logo.png", import.meta.url)));
const { data, info } = await logo.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const visible = (y) => { for (let x = 0; x < info.width; x += 1) if (data[(y * info.width + x) * 4 + 3] > 24) return true; return false; };
let markEnd = 0;
while (markEnd < info.height && (visible(markEnd) || markEnd === 0)) markEnd += 1;
const mark = await logo.clone().extract({ left: 0, top: 0, width: info.width, height: markEnd }).trim({ threshold: 1 }).resize({ width: MARK_WIDTH }).png().toBuffer({ resolveWithObject: true });

const full = await sharp(gradient)
  .composite([{ input: mark.data, left: Math.round((SIZE - mark.info.width) / 2), top: Math.round((SIZE - mark.info.height) / 2) - 6 }])
  .png().toBuffer();
const rounded = await sharp(full).composite([{ input: corners, blend: "dest-in" }]).png().toBuffer();

await mkdir(out, { recursive: true });
const write = async (name, input, size) => writeFile(new URL(name, out), await sharp(input).resize(size, size).png({ compressionLevel: 9 }).toBuffer());
await write("icon-192.png", rounded, 192);
await write("icon-512.png", rounded, 512);
await write("icon-maskable-512.png", full, 512);
// The iPhone rounds the corners itself and fills transparent ones black: edge to edge, no transparency.
await write("apple-touch-icon.png", await sharp(full).flatten({ background: "#7e004b" }).toBuffer(), 180);
console.log(`mark ${mark.info.width}×${mark.info.height} of ${SIZE}, written to public/app-icons/`);
