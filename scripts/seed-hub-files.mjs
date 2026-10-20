import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "./lib/local-env.mjs";
import { sampleCustomers, sampleFiles } from "./lib/sample-files.mjs";

// Seeds the three demo customers (with customer numbers), links the demo logins to them and uploads
// a fictional "Servicevertrag" and "Logo-Datei" per customer. Idempotent; uses the local secret key only.
await loadLocalEnv();
const blueprint = JSON.parse(await readFile(new URL("../config/demo-accounts.json", import.meta.url), "utf8"));
const checkOnly = process.argv.includes("--check");
const bucket = "hub-files";

function fail(message) { throw new Error(message); }

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || new URL(url).hostname !== `${blueprint.projectRef}.supabase.co`) fail(`Nur für das Client-Hub-Projekt ${blueprint.projectRef} vorgesehen.`);
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (checkOnly) {
    console.table(sampleCustomers.flatMap((customer) => sampleFiles(customer).map((file) => ({ kunde: customer.customerNumber, datei: file.fileName, kategorie: file.category, bytes: file.bytes.length }))));
    console.log(`Administrative Konfiguration: ${secret ? "vorhanden" : "fehlt"}. Es wurde nichts verändert.`);
    return;
  }
  if (!secret) fail("SUPABASE_SECRET_KEY fehlt in .env.local.");
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

  const { data: customers, error: customerError } = await admin
    .from("hub_customers")
    .upsert(sampleCustomers.map(({ customerNumber, company }) => ({ customer_number: customerNumber, company })), { onConflict: "customer_number" })
    .select("id, customer_number");
  if (customerError) fail(`Kunden konnten nicht angelegt werden (Migration ausgeführt?): ${customerError.message}`);
  const customerId = (number) => customers.find((row) => row.customer_number === number)?.id ?? fail(`Kunde ${number} fehlt.`);

  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail(`Benutzer konnten nicht gelesen werden: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  for (const customer of sampleCustomers) {
    const user = users.find((item) => item.email === customer.email);
    if (!user) { console.warn(`Hinweis: Kein Login ${customer.email} gefunden – Kunde ${customer.customerNumber} ohne Mitglied.`); continue; }
    const { error } = await admin.from("hub_customer_members").upsert({ customer_id: customerId(customer.customerNumber), user_id: user.id }, { onConflict: "customer_id,user_id" });
    if (error) fail(`Zuordnung für ${customer.email} fehlgeschlagen: ${error.message}`);
  }

  for (const customer of sampleCustomers) {
    for (const file of sampleFiles(customer)) {
      const path = `seed/${customer.customerNumber.toLowerCase()}/${file.key}.${file.fileName.split(".").pop()}`;
      const upload = await admin.storage.from(bucket).upload(path, file.bytes, { contentType: file.mimeType, upsert: true });
      if (upload.error) fail(`Upload ${path} fehlgeschlagen: ${upload.error.message}`);
      const { data: row, error } = await admin
        .from("hub_files")
        .upsert({
          storage_path: path, title: file.title, description: file.description, category: file.category, file_name: file.fileName,
          mime_type: file.mimeType, size_bytes: file.bytes.length, sha256: createHash("sha256").update(file.bytes).digest("hex"),
        }, { onConflict: "storage_path" })
        .select("id")
        .single();
      if (error) fail(`Datei ${path} konnte nicht gespeichert werden: ${error.message}`);
      const assigned = await admin.from("hub_file_assignments").upsert({ file_id: row.id, customer_id: customerId(customer.customerNumber) }, { onConflict: "file_id,customer_id" });
      if (assigned.error) fail(`Zuordnung von ${path} fehlgeschlagen: ${assigned.error.message}`);
      console.log(`OK: ${customer.customerNumber} · ${file.title} (${file.bytes.length} Bytes)`);
    }
  }
}

main().catch((error) => { console.error(error.message); process.exit(1); });
