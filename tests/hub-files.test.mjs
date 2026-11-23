import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { checkUpload, cleanFolderName, fileCategoryIds, fileFormat, formatBytes, MAX_FILE_BYTES, MAX_FOLDER_NAME, storageSafeName, uploadType, zipEntryNames } from "../lib/hub-files/catalog.ts";
import { mayBeClear, parseImageSize, PREVIEW_EDGE, PREVIEW_MAX_PIXELS, previewKind, previewRatio, previewUrl } from "../lib/hub-files/preview.ts";
import { renderPreview } from "../lib/hub-files/preview-render.ts";
import { createTurns } from "../lib/hub-files/turns.ts";
import { sampleCustomers, sampleFiles } from "../scripts/lib/sample-files.mjs";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("uploads respect the size limit and never accept executables", () => {
  assert.equal(checkUpload("Servicevertrag.pdf", 1200).ok, true);
  assert.equal(checkUpload("Logo.svg", MAX_FILE_BYTES).ok, true);
  assert.equal(checkUpload("Video.mp4", MAX_FILE_BYTES + 1).ok, false);
  assert.equal(checkUpload("leer.pdf", 0).ok, false);
  for (const name of ["setup.exe", "run.BAT", "tool.ps1", "page.html", "script.js"]) assert.equal(checkUpload(name, 10).ok, false, name);
});

test("storage keys are ASCII-safe while the original name is kept separately", () => {
  assert.equal(storageSafeName("Servicevertrag Müller & Söhne (final).PDF"), "servicevertrag-muller-sohne-final.pdf");
  assert.equal(storageSafeName("../../etc/passwd"), "etc-passwd");
  assert.equal(storageSafeName("Straße.svg"), "strasse.svg");
  assert.match(storageSafeName("ä".repeat(300) + ".png"), /^[a-z0-9.-]{1,96}$/);
  assert.equal(fileFormat("Logo.svg"), "SVG");
  assert.equal(formatBytes(1097), "1,1 KB");
  assert.equal(formatBytes(52428800), "50 MB");
});

test("file categories in code and migration match", async () => {
  const migrations = await readdir(new URL("../supabase/migrations/", import.meta.url));
  const sql = (await Promise.all(migrations.map((name) => source(`supabase/migrations/${name}`)))).join("\n");
  const allowed = sql.match(/category in \(([^)]+)\)/)[1].match(/'([a-z]+)'/g).map((value) => value.slice(1, -1));
  assert.deepEqual([...allowed].sort(), [...fileCategoryIds].sort());
  assert.match(sql, /size_bytes between 0 and 52428800/);
  assert.match(sql, /'hub-files', 'hub-files', false, 52428800/);
});

test("row level security guards every hub file table and the bucket", async () => {
  const sql = await source("supabase/migrations/20261020120000_hub_files.sql");
  for (const table of ["hub_customers", "hub_customer_members", "hub_files", "hub_file_assignments"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`), table);
  }
  assert.match(sql, /revoke all on public\.hub_customers, public\.hub_customer_members, public\.hub_files, public\.hub_file_assignments from anon/);
  assert.match(sql, /on storage\.objects\s+for select to authenticated using \(\s*bucket_id = 'hub-files'/);
});

test("example PDFs are well-formed and fixture sizes match the static samples", async () => {
  const hubData = await source("lib/hub-data.ts");
  for (const customer of sampleCustomers) {
    const [contract, logo] = sampleFiles(customer);
    const pdf = contract.bytes.toString("latin1");
    assert.ok(pdf.startsWith("%PDF-1.4") && pdf.trimEnd().endsWith("%%EOF"));
    const xref = Number(pdf.match(/startxref\n(\d+)/)[1]);
    assert.equal(pdf.slice(xref, xref + 4), "xref");
    for (const [index, offset] of [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map((match, i) => [i + 1, Number(match[1])])) {
      assert.equal(pdf.slice(offset, offset + `${index} 0 obj`.length), `${index} 0 obj`);
    }
    assert.match(hubData, new RegExp(`${customer.slug}: \\{ contract: ${contract.bytes.length}, logo: ${logo.bytes.length} \\}`), `${customer.slug} sizes`);
    assert.deepEqual(await readFile(new URL(`../public/demo-files/${customer.slug}/servicevertrag.pdf`, import.meta.url)), contract.bytes);
    assert.deepEqual(await readFile(new URL(`../public/demo-files/${customer.slug}/logo.svg`, import.meta.url)), logo.bytes);
  }
});

test("folder names are trimmed, limited and free of path separators", () => {
  assert.deepEqual(cleanFolderName("  Verträge   2026 "), { ok: true, name: "Verträge 2026" });
  assert.equal(cleanFolderName("   ").ok, false);
  assert.equal(cleanFolderName("a".repeat(MAX_FOLDER_NAME + 1)).ok, false);
  assert.equal(cleanFolderName("Logos/alt").ok, false);
  assert.equal(cleanFolderName("Logos\\alt").ok, false);
});

test("ZIP entries get unique names without path separators", () => {
  assert.deepEqual(zipEntryNames(["Logo.svg", "logo.svg", "Logo.svg", "Vertrag", "Vertrag", "../geheim.pdf"]), ["Logo.svg", "logo (2).svg", "Logo (3).svg", "Vertrag", "Vertrag (2)", "..-geheim.pdf"]);
});

test("folders belong to one customer, are guarded by RLS and customers may only change the folder of an assignment", async () => {
  const sql = await source("supabase/migrations/20261022170000_hub_folders.sql");
  assert.match(sql, /alter table public\.hub_folders enable row level security/);
  assert.match(sql, /foreign key \(folder_id, customer_id\) references public\.hub_folders \(id, customer_id\) on delete set null \(folder_id\)/);
  assert.match(sql, /revoke update on public\.hub_file_assignments from authenticated;\s+grant update \(folder_id\) on public\.hub_file_assignments to authenticated;/);
  assert.match(sql, /revoke all on public\.hub_folders from anon/);
  const hubData = await source("lib/hub-data.ts");
  assert.match(hubData, /sampleFolders/);
});

test("every image gets a preview, decided by its name, whatever type the browser reported (23.11.2026)", () => {
  // Logos uploaded without a type, big photos and TIFFs get one; iPhone photos say why not; documents keep their symbol.
  assert.equal(previewKind("Bildmarke Morgenrot.svg", "application/octet-stream"), "image");
  assert.equal(previewKind("Terrasse Abend.JPG", "image/jpeg"), "image");
  assert.equal(previewKind("Scan.tiff", ""), "image");
  assert.equal(previewKind("IMG_4821.HEIC", "image/heic"), "heic");
  assert.equal(previewKind("Foto", "image/heif"), "heic");
  assert.equal(previewKind("Speisekarte.pdf", "application/pdf"), null);
  assert.equal(previewKind("Logo Original.ai", "application/postscript"), null);
  assert.equal(previewKind("Bild", "image/png"), "image");
  assert.equal(mayBeClear("Logo weiß.PNG"), true);
  assert.equal(mayBeClear("Terrasse.jpg"), false);
  // The address changes with the bytes, so the browser may keep a preview for a day.
  assert.equal(previewUrl({ id: "a1", sha256: "0123456789abcdef", createdAt: "2026-11-21T10:12:00Z" }, "l"), "/api/files/a1/preview?size=l&v=0123456789ab");
  assert.match(previewUrl({ id: "a1", sha256: null, createdAt: "2026-11-21T10:12:00Z" }, "s"), /^\/api\/files\/a1\/preview\?size=s&v=\d+$/);
  assert.equal(previewRatio(1600, 1067).toFixed(2), "1.50");
  assert.equal(previewRatio(800, 4000), 0.75);
  assert.equal(previewRatio(4000, 100), 2.4);
  assert.deepEqual(parseImageSize("1600x1067"), { width: 1600, height: 1067 });
  assert.equal(parseImageSize("big"), null);
});

test("an upload without a type from the browser takes the one of its name", () => {
  assert.equal(uploadType("Bildmarke.svg", ""), "image/svg+xml");
  assert.equal(uploadType("Bildmarke.svg", "application/octet-stream"), "image/svg+xml");
  assert.equal(uploadType("Foto.WEBP", ""), "image/webp");
  assert.equal(uploadType("Foto.jpg", "image/jpeg"), "image/jpeg");
  assert.equal(uploadType("Rohdaten.xyz", ""), "application/octet-stream");
});

test("the server turns images of any size into small WebP previews and refuses what it cannot read", async () => {
  const sharp = (await import("sharp")).default;
  // A photo larger than the old limit of 8 MB in pixels: 6000 × 4000, turned by its EXIF orientation.
  const photo = await sharp({ create: { width: 6000, height: 4000, channels: 3, background: "#c8553d" } }).jpeg({ quality: 60 }).withMetadata({ orientation: 6 }).toBuffer();
  const small = await renderPreview(photo, { edge: PREVIEW_EDGE.s, quality: 76, maxPixels: PREVIEW_MAX_PIXELS });
  assert.ok(small);
  assert.deepEqual({ width: small.width, height: small.height }, { width: 4000, height: 6000 }, "the original, upright");
  const meta = await sharp(small.data).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(Math.max(meta.width, meta.height), PREVIEW_EDGE.s);
  assert.ok(meta.height > meta.width, "turned upright");
  // A tiny SVG logo is drawn large enough to stay sharp in the details.
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><rect width="120" height="40" fill="#3b2418"/></svg>');
  const logo = await renderPreview(svg, { edge: PREVIEW_EDGE.l, quality: 82, maxPixels: PREVIEW_MAX_PIXELS });
  assert.ok(logo);
  assert.equal((await sharp(logo.data).metadata()).width, PREVIEW_EDGE.l);
  // Not an image, or too many pixels: no preview.
  assert.equal(await renderPreview(Buffer.from("%PDF-1.7 not an image"), { edge: 480, quality: 76, maxPixels: PREVIEW_MAX_PIXELS }), null);
  assert.equal(await renderPreview(photo, { edge: 480, quality: 76, maxPixels: 1_000_000 }), null);
  // A PNG is read in full: above 24 megapixels it gets none, so one image never fills the hub's memory.
  const hugePng = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: "#3b2418" } }).png().toBuffer();
  assert.equal(await renderPreview(hugePng, { edge: 480, quality: 76, maxPixels: PREVIEW_MAX_PIXELS }), null);
});

test("the preview route answers only for files the session may read, privately, and the details use it", async () => {
  const route = await source("app/api/files/[id]/preview/route.ts");
  assert.match(route, /"Cache-Control": "private, max-age=86400"/);
  assert.match(route, /"X-Content-Type-Options": "nosniff"/);
  const server = await source("lib/hub-files/preview-server.ts");
  assert.match(server, /^import "server-only";/);
  // Signed in, the second factor confirmed, the record readable under RLS, the bytes through the catalog's checks.
  assert.match(server, /if \(await secondFactorMissing\(supabase, claims\.claims\.aal\)\) return \{ status: 401 \};/);
  assert.match(server, /supabase\.from\("hub_files"\)\.select\("storage_path, file_name, mime_type"\)\.eq\("id", fileId\)/);
  assert.match(server, /supabase\.storage\.from\(HUB_FILES_BUCKET\)\.download\(file\.storage_path\)/);
  // The memory answers only after that check.
  assert.ok(server.indexOf("recall(key)") > server.indexOf("if (!file) return { status: 404 };"));
});

test("previews are made two at a time; the others wait without loading anything (live 23.11.2026)", async () => {
  // 40 tiles asked for 36 previews at once and each loaded its original before waiting: the hub ran out of memory.
  const inTurn = createTurns(2, 1000);
  let now = 0;
  let most = 0;
  const job = () => inTurn(async () => { now++; most = Math.max(most, now); await new Promise((resolve) => setTimeout(resolve, 15)); now--; return "ok"; });
  const results = await Promise.all(Array.from({ length: 12 }, job));
  assert.equal(most, 2);
  assert.ok(results.every((result) => result === "ok"));
  // Who waits too long gets "busy" and never runs; the browser asks once more later.
  const slow = createTurns(1, 30);
  let ran = false;
  const first = slow(() => new Promise((resolve) => setTimeout(() => resolve("done"), 120)));
  assert.equal(await slow(async () => { ran = true; return "never"; }), "busy");
  assert.equal(ran, false);
  assert.equal(await first, "done");
  // The original is loaded inside the turn, never before it.
  const server = await source("lib/hub-files/preview-server.ts");
  // One at a time on the server: the hub may use 512 MB in all.
  assert.match(server, /const inTurn = createTurns\(1, 40_000\);/);
  assert.ok(server.indexOf(".download(file.storage_path)") > server.indexOf("const result = await inTurn(async"));
  assert.match(await source("lib/hub-files/preview-render.ts"), /sharp\.cache\(false\);\r?\n {4}sharp\.concurrency\(1\);/);
});
