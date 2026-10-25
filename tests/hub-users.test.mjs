import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  cleanCustomerNumber, cleanEmail, cleanLine, cleanPhone, cleanText, cleanWebsite, displayStatus, nextCustomerNumber, normalizeCompany,
  readCustomer, readPerson, readRegistration, servicePackageIds, suggestCustomer,
} from "../lib/hub-users/rules.ts";

// Windows checkouts may carry CRLF line endings; the source checks below compare LF text.
const source = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const migration = () => source("supabase/migrations/20261022190000_hub_user_management.sql");

const registration = {
  email: " Jana@Nordlicht.Example ", firstName: " Jana ", lastName: "Sommer", companyName: "Nordlicht Studio GmbH", phone: "+49 30 1234567",
  position: "Geschäftsführung", website: "nordlicht.example", customerNumberHint: "kd-24017", message: "Hallo\r\n\r\n\r\nTeam",
};

test("registration input is complete, trimmed and normalised before it reaches Supabase", () => {
  const checked = readRegistration(registration);
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.value, {
    email: "jana@nordlicht.example", firstName: "Jana", lastName: "Sommer", companyName: "Nordlicht Studio GmbH", phone: "+49 30 1234567",
    position: "Geschäftsführung", website: "https://nordlicht.example", customerNumberHint: "KD-24017", message: "Hallo\n\nTeam",
  });
  for (const [field, value] of [["firstName", ""], ["lastName", "  "], ["companyName", ""], ["phone", ""], ["email", "jana@"], ["phone", "12"], ["firstName", "J4na"]]) {
    assert.equal(readRegistration({ ...registration, [field]: value }).ok, false, `${field}=${value}`);
  }
  // Optional fields may stay empty.
  assert.equal(readRegistration({ ...registration, position: "", website: "", customerNumberHint: "", message: "" }).ok, true);
});

test("single fields reject what an admin form or a crafted request could send", () => {
  assert.equal(cleanLine("a\u0000b\n c", 10), "a b c");
  assert.equal(cleanLine({ evil: true }, 10), "");
  assert.equal(cleanText("x\u0007y\r\nz", 10), "xy\nz");
  assert.equal(cleanEmail("info@oalab.de").ok, true);
  assert.equal(cleanEmail("info@oalab").ok, false);
  assert.equal(cleanPhone("030 / 123 45-67", true).ok, true);
  assert.equal(cleanPhone("call me", true).ok, false);
  assert.equal(cleanPhone("", false).ok, true);
  assert.equal(cleanWebsite("javascript:alert(1)").ok, false);
  assert.equal(cleanWebsite("ftp://oalab.de").ok, false);
  assert.equal(cleanWebsite("https://user:pw@oalab.de").ok, false);
  assert.equal(cleanWebsite("localhost").ok, false);
  assert.deepEqual(cleanWebsite("oalab.de/"), { ok: true, value: "https://oalab.de" });
  assert.deepEqual(cleanCustomerNumber(" kd-24017 ", true), { ok: true, value: "KD-24017" });
  assert.equal(cleanCustomerNumber("KD 24017; drop", true).ok, false);
  assert.equal(readPerson({ firstName: "Ben", lastName: "Fischer", phone: "" }).ok, true);
  assert.equal(readPerson({ firstName: "Ben", lastName: "" }).ok, false);
});

test("customers keep a unique-looking number and only known service packages", () => {
  assert.equal(nextCustomerNumber(["KD-24017", "KD-24031", "KD-24023", "SONDER-1"]), "KD-24032");
  assert.equal(nextCustomerNumber([]), "KD-10001");
  const customer = readCustomer({ company: " Form & Feld ", customerNumber: "kd-24023", servicePackages: ["website-max", "website-lite", "website-lite"], website: "formfeld.example", postalCode: "10115" });
  assert.equal(customer.ok, true);
  assert.deepEqual(customer.value.servicePackages, ["website-lite", "website-max"]);
  assert.equal(customer.value.country, "Deutschland");
  assert.equal(readCustomer({ company: "X", customerNumber: "KD-1", servicePackages: ["gold"] }).ok, false);
  assert.equal(readCustomer({ company: "", customerNumber: "KD-1" }).ok, false);
  assert.equal(readCustomer({ company: "X", customerNumber: "KD-1", contactEmail: "kein-mail" }).ok, false);
});

test("a registration is matched to its customer by number first, then by company name", () => {
  const customers = [{ id: "a", customerNumber: "KD-24017", company: "Nordlicht Studio" }, { id: "b", customerNumber: "KD-24023", company: "Form & Feld" }];
  assert.equal(suggestCustomer({ customerNumberHint: "kd-24023", companyName: "Nordlicht Studio" }, customers)?.id, "b");
  assert.equal(suggestCustomer({ customerNumberHint: "", companyName: "Nordlicht Studio GmbH" }, customers)?.id, "a");
  assert.equal(suggestCustomer({ customerNumberHint: "", companyName: "form und feld" }, customers)?.id, "b");
  assert.equal(suggestCustomer({ customerNumberHint: "", companyName: "Unbekannt AG" }, customers), null);
  assert.equal(normalizeCompany("Nordlicht Studio GmbH & Co. KG"), normalizeCompany("nordlicht studio und"));
});

test("an active login that never signed in still waits for its activation", () => {
  assert.equal(displayStatus("active", null), "invited");
  assert.equal(displayStatus("active", "2026-10-22T10:00:00Z"), "active");
  assert.equal(displayStatus("pending", null), "pending");
  assert.equal(displayStatus("disabled", "2026-10-22T10:00:00Z"), "disabled");
});

test("service package ids agree between rules, catalogue and database", async () => {
  const catalogue = await source("lib/service-packages.ts");
  const ids = [...catalogue.match(/export type ServicePackageId = ([^;]+);/)[1].matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, [...servicePackageIds]);
  const sql = await migration();
  const allowed = [...sql.match(/service_packages <@ array\[([^\]]+)\]/)[1].matchAll(/'([a-z-]+)'/g)].map((match) => match[1]);
  assert.deepEqual(allowed, [...servicePackageIds]);
});

test("the migration lets only active logins reach data and keeps writes on the server", async () => {
  const sql = await migration();
  assert.match(sql, /alter table public\.hub_profiles enable row level security/);
  assert.match(sql, /alter table public\.hub_admin_events enable row level security/);
  // Browsers read only: no insert, update or delete grants for the Data API roles.
  assert.match(sql, /revoke all on public\.hub_profiles, public\.hub_admin_events from anon, authenticated;\s*grant select on public\.hub_profiles, public\.hub_admin_events to authenticated;/);
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*hub_profiles[^;]*to authenticated/);
  // Admin role and active status come from the database, not from the access token.
  const isAdmin = sql.match(/function public\.is_hub_admin\(\)[\s\S]+?\$\$;/)[0];
  assert.match(isAdmin, /security definer\s+set search_path = ''/);
  assert.match(isAdmin, /from auth\.users u\s+join public\.hub_profiles p/);
  assert.match(isAdmin, /p\.status = 'active'/);
  assert.doesNotMatch(isAdmin, /auth\.jwt\(\)/);
  // Memberships open all customer data; reading them needs an active profile.
  assert.match(sql, /drop policy "Users read their memberships" on public\.hub_customer_members;/);
  assert.match(sql, /for select to authenticated using \(user_id = \(select auth\.uid\(\)\) and \(select public\.hub_is_active\(\)\)\)/);
  // New logins wait for approval unless the service role gave them a role.
  const trigger = sql.match(/function public\.hub_handle_new_user\(\)[\s\S]+?\$\$;/)[0];
  assert.match(trigger, /security definer\s+set search_path = ''/);
  assert.match(trigger, /new\.raw_app_meta_data ->> 'app_role'/);
  assert.match(trigger, /case when has_role then 'active' else 'pending' end/);
  assert.match(sql, /after insert on auth\.users\s+for each row execute function public\.hub_handle_new_user\(\)/);
  // Calendar occupancy, request withdrawal and WhatsApp linking need an active login too.
  for (const name of ["hub_calendar_busy", "hub_withdraw_appointment_request", "hub_create_whatsapp_link_code"]) {
    assert.match(sql.match(new RegExp(`function public\\.${name}\\([\\s\\S]+?\\$\\$;`))[0], /hub_is_active\(\)/, name);
  }
  assert.match(sql, /revoke execute on function public\.hub_handle_new_user\(\) from public, anon, authenticated;/);
});

test("every user management action checks the admin first and guards lock-outs", async () => {
  const actions = await source("lib/hub-users/actions.ts");
  const chunks = actions.split("export async function ").slice(1);
  assert.ok(chunks.length >= 8);
  for (const chunk of chunks) {
    // The admin check is the very first statement of every action.
    const start = chunk.indexOf("\n  const ctx = await context();\n  if (!ctx) return denied;\n");
    assert.ok(start > 0, chunk.slice(0, 40));
    assert.doesNotMatch(chunk.slice(0, start), /await|ctx\./, chunk.slice(0, 40));
  }
  assert.match(actions, /const admin = await verifyHubAdmin\(\);/);
  for (const change of ['"role"', '"status"', '"delete"']) assert.match(actions, new RegExp(`guardAccountChange\\(ctx, user, ${change}\\)`));
  assert.match(actions, /Das ist der letzte aktive Admin/);
  assert.match(actions, /Demo-Konten werden per Seed verwaltet/);
  // Links are credentials: the link value is never handed to the log.
  for (const call of actions.matchAll(/await log\(([^;]+)\);/g)) assert.doesNotMatch(call[1], /\blink\b/);
  const server = await source("lib/hub-users/server.ts");
  assert.match(server, /supabase\.rpc\("is_hub_admin"\)/);
  assert.match(await source("lib/supabase/admin.ts"), /^import "server-only";/);
});

test("waiting, rejected and deactivated logins never reach the hub, the assistant or WhatsApp answers", async () => {
  const session = await source("lib/hub-session.ts");
  assert.match(session, /if \(!account \|\| \(account\.status !== "active" && account\.status !== "unknown"\)\) redirect\("\/auth\/pending"\);/);
  const assistant = await source("app/api/assistant/route.ts");
  assert.match(assistant, /supabase\.rpc\("hub_is_active"\)/);
  assert.match(assistant, /active !== true\) return failure\(403/);
  const whatsapp = await source("lib/hub-whatsapp/server.ts");
  assert.match(whatsapp, /if \(!\(await isActiveLogin\(db, link\.user_id\)\)\) return reply\(replies\.inactive\);/);
  const page = await source("components/hub/screens/users.tsx");
  assert.match(page, /export function UserManagementScreen/);
  const route = await source("app/dashboard/[section]/page.tsx");
  assert.match(route, /adminSections\.includes\(validSection\) && \(identity\.publicDemo \|\| identity\.account\?\.role !== "oalab_admin"\)\) notFound\(\)/);
});

test("the registration form sends what the trigger reads and shows the privacy notice", async () => {
  const form = await source("components/auth-form.tsx");
  // The form hands its fields to the sign-up server action, which writes them as user_metadata.
  const signUp = await source("lib/hub-auth/actions.ts");
  const trigger = (await migration()).match(/function public\.hub_handle_new_user\(\)[\s\S]+?\$\$;/)[0];
  for (const key of ["first_name", "last_name", "company_name", "phone", "position", "website", "customer_number_hint", "message", "privacy_noted"]) {
    assert.match(signUp, new RegExp(`${key}: `), key);
    assert.match(trigger, new RegExp(`'${key}'`), key);
  }
  assert.match(form, /Art\. 6 Abs\. 1 lit\. b DSGVO/);
  // Contract initiation, not consent: no checkbox that blocks the registration.
  assert.doesNotMatch(form, /type="checkbox"/);
  const legal = await source("lib/legal-links.ts");
  assert.match(legal, /\^https:\\\/\\\//);
});
