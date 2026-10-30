import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Renders the pictures of the hub's mails into lib/hub-mail/images.ts: the app icon, a tile per hub area and the small
// symbols, from the hub's own artwork and Lucide symbols, plus the marks of Apple, Google and Microsoft for the calendar
// buttons. Mail programs show no SVG, so each is a PNG at twice its shown size; the mails carry them as inline
// attachments. Run again after changing a colour or symbol:
//   node scripts/mail-images.mjs
// sharp comes with Next.js.

const root = new URL("../", import.meta.url);
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

/** A Lucide symbol as SVG elements, read from the installed lucide-react. */
async function symbol(name) {
  const source = await readFile(new URL(`node_modules/lucide-react/dist/esm/icons/${name}.js`, root), "utf8");
  const start = source.indexOf("const __iconNode = ") + "const __iconNode = ".length;
  const nodes = Function(`return ${source.slice(start, source.indexOf("];", start) + 1)}`)();
  return nodes.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([key]) => key !== "key").map(([key, value]) => `${key}="${value}"`).join(" ")}/>`).join("");
}

const png = async (input) => (await sharp(input).png({ compressionLevel: 9, palette: true, quality: 92 }).toBuffer()).toString("base64");

/** A rounded tile in the area colour (translucent, so it works on light and dark cards) with the symbol. */
async function tile(name, color, size = 40) {
  const s = size * 2, glyph = Math.round(s * 0.5), offset = (s - glyph) / 2;
  return png(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><rect width="${s}" height="${s}" rx="${Math.round(s * 0.28)}" fill="${color}" fill-opacity="0.16"/><g transform="translate(${offset} ${offset}) scale(${glyph / 24})" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${await symbol(name)}</g></svg>`));
}

/** A bare symbol. */
async function glyph(name, color, size = 16) {
  return png(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size * 2}" height="${size * 2}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${await symbol(name)}</svg>`));
}

// The calendar buttons show the mark of their calendar in one colour. Apple and Google as in Simple Icons (CC0,
// simple-icons 15.22.0); Microsoft's four squares are drawn here, as Simple Icons no longer carries them. The scale
// draws the wide Google G a little smaller, so the three look alike in size next to each other.
const brands = {
  apple: ["M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701", 1],
  google: ["M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z", 0.9],
  microsoft: ["M2.5 2.5h8.7v8.7H2.5zM12.8 2.5h8.7v8.7h-8.7zM2.5 12.8h8.7v8.7H2.5zM12.8 12.8h8.7v8.7h-8.7z", 1],
};

/** A brand mark, filled in one colour. */
async function mark(name, color, size = 16) {
  const [path, scale] = brands[name], shift = 12 * (1 - scale);
  return png(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size * 2}" height="${size * 2}" viewBox="0 0 24 24"><path fill="${color}" transform="translate(${shift} ${shift}) scale(${scale})" d="${path}"/></svg>`));
}

// Area colours as in the hub; account, security and users in a lighter bordeaux, so the symbol stays visible on a dark card.
const areas = { projects: ["folder-open", "#FF9500"], files: ["files", "#5856D6"], calendar: ["calendar-days", "#FF3B30"], account: ["user-round", "#B5236F"], security: ["shield-check", "#B5236F"], users: ["user-cog", "#B5236F"], news: ["bell", "#F37222"] };
const GREY = "#8A7E85";

const images = {
  // The supplied app icon, only scaled down (shown at 44 and 32 px).
  logo: (await sharp(fileURLToPath(new URL("public/brand/oalab-icon.png", root))).resize(88, 88, { fit: "contain", background: transparent }).png({ compressionLevel: 9 }).toBuffer()).toString("base64"),
};
for (const [area, [name, color]] of Object.entries(areas)) images[`area-${area}`] = await tile(name, color);
for (const name of ["mail", "phone", "globe", "hash", "badge-check", "history"]) images[`glyph-${name}`] = await glyph(name, GREY);
images["calendar-tile"] = await tile("calendar-plus", areas.calendar[1]);
for (const name of Object.keys(brands)) images[`brand-${name}`] = await mark(name, "#B5236F", 20);
images["calendar-file"] = await glyph("download", "#B5236F", 20);
images["calendar-small"] = await glyph("calendar-plus", GREY, 14);

const lines = Object.entries(images).map(([id, data]) => `  "${id}": "${data}",`);
await writeFile(new URL("lib/hub-mail/images.ts", root), `/**
 * The pictures of the hub's mails as PNG (base64), generated by scripts/mail-images.mjs from the app icon, the hub's
 * Lucide symbols and the calendar marks. Each mail carries the ones it shows as inline attachments
 * (cid:<id>@hub.oalab.de), so logo and symbols appear without loading anything from the web, in Outlook too. Do not
 * edit by hand.
 */
export const MAIL_IMAGES = {
${lines.join("\n")}
} as const;

export type MailImage = keyof typeof MAIL_IMAGES;
`);
const total = Object.values(images).reduce((sum, data) => sum + Math.ceil(data.length * 3 / 4), 0);
console.log(`${Object.keys(images).length} Bilder, zusammen ${(total / 1024).toFixed(1)} KB`);
for (const [id, data] of Object.entries(images)) console.log(`  ${id}: ${(data.length * 3 / 4 / 1024).toFixed(1)} KB`);
