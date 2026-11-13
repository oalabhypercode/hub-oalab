import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  builtInTemplateOf, cleanName, dateFromFileName, dateText, defaultPattern, isImageName, looksLikeCameraName, nameBase, nameExtension,
  nameFiles, namePart, photoDate, readPattern, samePattern, storePattern, webSafeName,
} from "../lib/hub-files/naming.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8").then((text) => text.replace(/\r\n/g, "\n"));

const entry = (key, fileName, change = {}) => ({
  key, fileName, image: isImageName(fileName), taken: "2026-11-02", customer: "Nordlicht Studio", customerNumber: "KD-24017",
  folder: "Baustelle", category: "Design", place: "ns:baustelle", index: Number(key.replace(/\D/g, "")) || 0, ...change,
});
const pattern = (kinds, change = {}) => ({ ...defaultPattern(), parts: kinds.map((kind) => typeof kind === "string" ? namePart(kind) : namePart(kind.kind, kind)), ...change });
const names = (result) => [...result.affected].map((item) => result.names.get(item.key).base);

test("dates come from the names phones and messengers give their photos", () => {
  assert.equal(dateFromFileName("IMG-20261028-WA0003.jpg"), "2026-10-28");
  assert.equal(dateFromFileName("IMG_20261028_101544.jpg"), "2026-10-28T10:15:44");
  assert.equal(dateFromFileName("PXL_20261101_142233118.jpg"), "2026-11-01T14:22:33");
  assert.equal(dateFromFileName("Screenshot_20261029-101544.png"), "2026-10-29T10:15:44");
  assert.equal(dateFromFileName("WhatsApp Image 2026-10-28 at 10.02.15.jpeg"), "2026-10-28T10:02:15");
  assert.equal(dateFromFileName("Bildschirmfoto 2026-10-29 um 10.15.44.png"), "2026-10-29T10:15:44");
  assert.equal(dateFromFileName("20261028_101544.jpg"), "2026-10-28T10:15:44");
  // No date, a customer number, an impossible day and a longer number are no dates.
  for (const name of ["IMG_4790.HEIC", "Angebot_final_v3 (1).pdf", "KD-24017 Logo.svg", "Rechnung_20260230.pdf", "Auftrag 2026110155.pdf"]) assert.equal(dateFromFileName(name), null, name);
});

/** A JPEG start with an EXIF block: IFD0 points to the EXIF IFD, which holds DateTimeOriginal (0x9003). */
function jpegWithExif(taken, little = true) {
  const tiff = new DataView(new ArrayBuffer(64));
  const u16 = (at, value) => tiff.setUint16(at, value, little);
  const u32 = (at, value) => tiff.setUint32(at, value, little);
  tiff.setUint16(0, little ? 0x4949 : 0x4d4d);
  u16(2, 42); u32(4, 8);
  u16(8, 1); u16(10, 0x8769); u16(12, 4); u32(14, 1); u32(18, 26); u32(22, 0);
  u16(26, 1); u16(28, 0x9003); u16(30, 2); u32(32, 20); u32(36, 44); u32(40, 0);
  [...`${taken}\0`].forEach((char, index) => tiff.setUint8(44 + index, char.charCodeAt(0)));
  const head = [0xff, 0xd8, 0xff, 0xe1, 0x00, 2 + 6 + 64, ..."Exif\0\0"].map((item) => typeof item === "string" ? item.charCodeAt(0) : item);
  return new Uint8Array([...head, ...new Uint8Array(tiff.buffer), 0xff, 0xda, 0x00, 0x02]);
}

test("JPEG photos tell when they were taken; anything else gives nothing instead of an error", () => {
  assert.equal(photoDate(jpegWithExif("2026:10:28 10:02:15")), "2026-10-28T10:02:15");
  assert.equal(photoDate(jpegWithExif("2026:10:28 10:02:15", false)), "2026-10-28T10:02:15");
  assert.equal(photoDate(jpegWithExif("0000:00:00 00:00:00")), null);
  assert.equal(photoDate(jpegWithExif("2026:10:28 10:02:15").subarray(0, 40)), null);
  assert.equal(photoDate(new TextEncoder().encode("%PDF-1.7 nothing here")), null);
  assert.equal(photoDate(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2])), null);
});

test("names stay safe as download names; web-safe names are lower case without umlauts", () => {
  assert.equal(cleanName('  Team: Fotos / "Eingang" <neu>?  '), "Team Fotos Eingang neu");
  assert.equal(cleanName("Zeile\u0000eins\u0007"), "Zeileeins");
  assert.equal(webSafeName("Café Müller & Söhne Größe"), "cafe-mueller-soehne-groesse");
  assert.equal(nameExtension("IMG_4790.HEIC"), ".heic");
  assert.equal(nameBase("Angebot_final_v3 (1).pdf"), "Angebot_final_v3 (1)");
  assert.equal(nameBase("ohne Endung"), "ohne Endung");
  assert.ok(isImageName("IMG_4790.HEIC") && isImageName("scan", "image/png") && !isImageName("Angebot.pdf"));
  assert.ok(looksLikeCameraName("IMG-20261102-WA0007.jpg") && looksLikeCameraName("PXL_20261101_142233118.jpg") && looksLikeCameraName("DSC_0042.JPG"));
  assert.ok(!looksLikeCameraName("Logo Nordlicht Studio.svg") && !looksLikeCameraName("Angebot_final_v3 (1).pdf"));
});

test("customer, folder and number: the number continues after the ones already in the folder", () => {
  const files = ["IMG-20261102-WA0011.jpg", "IMG-20261102-WA0007.jpg", "PXL_20261101_142233118.jpg"].map((name, index) => entry(`u${index + 1}`, name, { taken: dateFromFileName(name) }));
  const existing = new Map([["ns:baustelle", ["Nordlicht-Studio_Baustelle_01", "Nordlicht-Studio_Baustelle_02", "nordlicht-studio_baustelle_04", "Logo"]]]);
  const result = nameFiles(files, defaultPattern(), existing);
  assert.equal(result.suggested, 5);
  assert.equal(result.start, 5);
  assert.deepEqual(names(result), ["Nordlicht-Studio_Baustelle_05", "Nordlicht-Studio_Baustelle_06", "Nordlicht-Studio_Baustelle_07"]);
  // Taken first: the Pixel photo of 1 November, then WhatsApp 0007 and 0011 of 2 November.
  assert.deepEqual(result.affected.map((item) => item.key), ["u3", "u2", "u1"]);
  assert.equal(result.clashes, 0);
  // A start by hand and fixed digits win; a clash counts when the name is taken.
  const fixed = nameFiles(files, pattern(["customer", "folder", { kind: "number", start: 4, digits: "3" }]), existing);
  assert.deepEqual(names(fixed), ["Nordlicht-Studio_Baustelle_004", "Nordlicht-Studio_Baustelle_005", "Nordlicht-Studio_Baustelle_006"]);
  const clash = nameFiles(files, pattern(["customer", "folder", { kind: "number", start: 1 }]), existing);
  assert.equal(clash.clashes, 2);
});

test("separators, web-safe names, dates and the old name", () => {
  const one = [entry("u1", "IMG-20261028-WA0003.jpg", { taken: "2026-10-28", folder: "Team Fotos", customer: "Café Müller" })];
  assert.deepEqual(names(nameFiles(one, pattern(["customer", "folder", "number"], { separator: " " }), new Map())), ["Café Müller Team Fotos 01"]);
  assert.deepEqual(names(nameFiles(one, pattern(["customer", "folder", "number"], { separator: "-" }), new Map())), ["Café-Müller-Team-Fotos-01"]);
  assert.deepEqual(names(nameFiles(one, pattern(["customer", "folder", "number"], { separator: " ", webSafe: true }), new Map())), ["cafe-mueller-team-fotos-01"]);
  assert.deepEqual(names(nameFiles(one, pattern([{ kind: "date", dateStyle: "compact" }, { kind: "text", text: "Eingang" }]), new Map())), ["20261028_Eingang"]);
  assert.deepEqual(names(nameFiles(one, pattern(["customerNumber", "year", "original"]), new Map())), ["KD-24017_2026_IMG-20261028-WA0003"]);
  assert.equal(dateText("2026-10-28T10:02", "de"), "28-10-2026");
});

test("only images get the pattern when files are mixed; names by hand stay; repeats get a counter", () => {
  const mixed = [entry("u1", "IMG_1.jpg"), entry("u2", "Angebot_final_v3 (1).pdf"), entry("u3", "IMG_2.jpg")];
  const images = nameFiles(mixed, defaultPattern(), new Map());
  assert.equal(images.mixed, true);
  assert.deepEqual([...images.names.keys()].sort(), ["u1", "u3"]);
  assert.equal(nameFiles(mixed, { ...defaultPattern(), imagesOnly: false }, new Map()).names.size, 3);
  assert.deepEqual([...nameFiles(mixed, defaultPattern(), new Map(), new Set(["u1"])).names.keys()], ["u3"]);
  const repeat = nameFiles([entry("u1", "a.jpg"), entry("u2", "b.jpg")], pattern(["customer", "folder"]), new Map());
  assert.deepEqual(names(repeat), ["Nordlicht-Studio_Baustelle", "Nordlicht-Studio_Baustelle_2"]);
  assert.equal(repeat.duplicates, 1);
});

test("missing values drop out with a hint instead of leaving gaps", () => {
  const result = nameFiles([entry("u1", "IMG_1.jpg", { folder: "" })], defaultPattern(), new Map());
  assert.deepEqual(result.missing, ["folder"]);
  assert.deepEqual(names(result), ["Nordlicht-Studio_01"]);
  const empty = nameFiles([entry("u1", "IMG_1.jpg")], pattern([{ kind: "text", text: "  " }]), new Map());
  assert.equal(empty.emptyText, true);
  // Nothing left of the pattern: the old name stays.
  assert.deepEqual(names(empty), ["IMG_1"]);
});

test("renaming is for admins, keeps the extension and the stored file, and sends no notice", async () => {
  const actions = await source("lib/hub-files/actions.ts");
  const rename = actions.slice(actions.indexOf("export async function renameFiles"), actions.indexOf("export async function deleteFiles"));
  assert.match(rename, /const supabase = await adminClient\(\);\n {2}if \(!supabase\) return denied;/);
  assert.match(rename, /nameExtension\(row\.file_name\) !== nameExtension\(wanted\.get\(row\.id\)\?\.fileName \?\? ""\)/);
  assert.match(rename, /\.update\(\{ title: change\.title, file_name: change\.fileName \}\)/);
  assert.doesNotMatch(rename, /notifyFileShared|storage/);
  // A new download name on upload keeps the extension of the stored file; the stored copy keeps the original name.
  assert.match(actions, /if \(nameExtension\(fileName\) !== nameExtension\(path\)\) \{/);
  const upload = await source("components/hub/screens/files-upload.tsx");
  assert.match(upload, /const prepared = await prepareUpload\(file\.name, file\.size\);/);
  assert.match(upload, /fileName: meta\.fileName \?\? file\.name/);
});

test("the Asset Management selects all files, a folder's files, and renames the ticked ones", async () => {
  const screen = await source("components/hub/screens/asset-management.tsx");
  assert.match(screen, /<label className=\{`am-select-all\$\{minimal \? "" : " is-detail"\}`\}>/);
  assert.match(screen, /<span className="am-min-section-check">\{group\.files\.length > 0 && <GroupCheck \{\.\.\.groupCheck\(group\.files, group\.label\)\} \/>\}<\/span>/);
  assert.match(screen, /actions=\{folderActions\(group\)\} select=\{groupCheck\(group\.files, group\.label\)\}/);
  assert.match(screen, /\{canRename && <button type="button" className="sheet-action" aria-pressed=\{renaming\}/);
  assert.match(screen, /onRename=\{store\.renameFiles\}/);
  const sheet = await source("components/hub/sheet.tsx");
  assert.match(sheet, /ref\.current\.indeterminate = mixed && !checked;/);
});

test("saved patterns come back whole or not at all", () => {
  const original = pattern(["customer", { kind: "text", text: "Baustelle" }, { kind: "number", start: 7, digits: "3" }], { separator: "-", webSafe: true, order: "name" });
  const back = readPattern(JSON.parse(JSON.stringify(storePattern(original))));
  assert.ok(back && samePattern(back, original));
  assert.equal(builtInTemplateOf(defaultPattern())?.label, "Kunde · Ordner · Nummer");
  assert.equal(builtInTemplateOf(original), null);
  for (const broken of [null, "x", {}, { parts: [] }, { parts: [{ kind: "script" }] }, { parts: Array.from({ length: 7 }, () => ({ kind: "text" })) }]) assert.equal(readPattern(broken), null);
  assert.equal(readPattern({ parts: [{ kind: "number", start: -3, digits: "9" }] })?.parts[0].start, null);
});
