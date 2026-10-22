import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { checkUpload, cleanFolderName, fileCategoryIds, fileFormat, formatBytes, MAX_FILE_BYTES, MAX_FOLDER_NAME, storageSafeName, zipEntryNames } from "../lib/hub-files/catalog.ts";
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
