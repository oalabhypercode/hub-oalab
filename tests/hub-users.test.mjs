import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  cleanCustomerNumber, cleanEmail, cleanLine, cleanPhone, cleanText, cleanWebsite, displayStatus, normalizeCompany,
  readCustomer, readPerson, readRegistration, serviceCustomerRefusal, suggestCustomer,
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

test("customers keep a unique-looking number; their packages are no longer part of the master data", () => {
  const customer = readCustomer({ company: " Form & Feld ", customerNumber: "kd-24023", servicePackages: ["website-max"], website: "formfeld.example", postalCode: "10115" });
  assert.equal(customer.ok, true);
  assert.equal("servicePackages" in customer.value, false);
  assert.equal(customer.value.country, "Deutschland");
  assert.equal(readCustomer({ company: "", customerNumber: "KD-1" }).ok, false);
  assert.equal(readCustomer({ company: "X", customerNumber: "KD-1", contactEmail: "kein-mail" }).ok, false);
});

test("new customers start in Service, and Service customers keep company and number on their organization", async () => {
  assert.equal(serviceCustomerRefusal({ company: "Muster GmbH", customerNumber: "OA-48213" }), null);
  assert.equal(serviceCustomerRefusal({ company: "KalaClo", customerNumber: "OA-KALACLO" }), null);
  for (const number of ["KD-24017", "OA-12", "OA-48213-X"]) assert.match(serviceCustomerRefusal({ company: "Muster GmbH", customerNumber: number }), /beginnen mit „OA-“/, number);
  assert.match(serviceCustomerRefusal({ company: "x".repeat(161), customerNumber: "OA-48213" }), /höchstens 160 Zeichen/);

  const actions = await source("lib/hub-users/actions.ts");
  // The organization comes first; Service's trigger adds the Hub customer, which gets the rest and the admin as author.
  const create = actions.slice(actions.indexOf("async function createServiceCustomer"), actions.indexOf("async function removeNewCustomer"));
  assert.ok(create.indexOf('from("organizations").insert(') > 0 && create.indexOf('from("organizations").insert(') < create.indexOf('from("hub_customers").update('));
  assert.match(create, /kind: "client", status: "active", plan_id: plan\.id/);
  assert.match(create, /\.update\(\{ \.\.\.customerDetails\(input\), updated_by: ctx\.actorId \}\)\.eq\("organization_id", organizationId\)/);
  assert.doesNotMatch(actions, /from\("hub_customers"\)\.insert\(/);
  // Taking a new customer back: memberships before the Hub customer (Service's sync would rebuild it), organization last.
  const remove = actions.slice(actions.indexOf("async function removeServiceCustomer"));
  const order = ['from("memberships").delete()', 'from("business_customer_profiles").delete()', 'from("hub_customers").delete()', 'from("organizations").delete()'].map((call) => remove.indexOf(call));
  assert.ok(order.every((at, index) => at > 0 && (index === 0 || at > order[index - 1])), String(order));
  // Editing: company and number of a Service customer go to its organization, the rest to the Hub customer. The form
  // and the import from the accounting write through the same function.
  const save = actions.slice(actions.indexOf("export async function saveCustomer"));
  assert.match(save, /const written = await writeCustomer\(ctx, id, current\.data\.organization_id, customer\.value\);/);
  const write = actions.slice(actions.indexOf("async function writeCustomer"));
  assert.match(write, /from\("organizations"\)\.update\(\{ name: value\.company, customer_number: value\.customerNumber \}\)\.eq\("id", organizationId\)/);
  assert.match(write, /const row = organizationId \? customerDetails\(value\) : customerRow\(value\);/);
  assert.match(write, /\.update\(\{ \.\.\.row, updated_by: ctx\.actorId \}\)/);
  // Service's audit trail hears about a new customer only once the whole step worked.
  for (const flow of ["export async function approveRegistration", "export async function createHubUser"]) {
    const chunk = actions.slice(actions.indexOf(flow));
    const note = chunk.indexOf("if (customer.data.created) await noteServiceCustomer(ctx, customer.data);");
    assert.ok(chunk.indexOf("removeNewCustomer(ctx,") > 0 && chunk.indexOf("removeNewCustomer(ctx,") < note, flow);
  }
  // Customers the assistant creates name their author too.
  assert.match(await source("lib/hub-assistant/actions.ts"), /update\(\{ \.\.\.contactColumns\(proposal\.contact\), updated_by: ctx\.userId \}\)/);
  // The suggested number follows the rule of 29.10.2026 and avoids numbers taken in Service.
  assert.match(await source("lib/hub-users/server.ts"), /newCustomerNumber\(new Set\(\[\.\.\.customerRows, \.\.\.\(organizations\.data \?\? \[\]\)\]\.map\(\(row\) => row\.customer_number\)\)\)/);
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

test("the hub no longer reads or writes the old package column; packages come from hub_customer_packages", async () => {
  for (const path of ["lib/hub-users/server.ts", "lib/hub-users/actions.ts", "lib/hub-assistant/data.ts"]) {
    assert.doesNotMatch(await source(path), /service_packages/, path);
  }
  const server = await source("lib/hub-users/server.ts");
  assert.match(server, /readCustomerPackages\(db\),\n {4}\]\);/);
  // A customer login reads its packages with its own session (RLS: its own customers only).
  assert.match(server, /const packageRead = readCustomerPackages\(supabase\);/);
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

test("logins are deleted together with their Service client membership, or not at all", async () => {
  const actions = await source("lib/hub-users/actions.ts");
  // The membership row Service keeps for every hub customer login blocks a plain auth delete.
  assert.doesNotMatch(actions, /auth\.admin\.deleteUser/);
  assert.match(actions, /ctx\.db\.rpc\("hub_delete_login", \{ target: userId \}\)/);
  const remove = actions.slice(actions.indexOf("export async function deleteHubUser"));
  assert.match(remove, /const removed = await removeLogin\(ctx, user\.id\);\n  if \(removed !== "deleted"\) return failed\(removalErrors\[removed\]\);/);
  assert.match(actions, /in_use: "Auf dieses Konto verweisen noch Einträge in der Serviceplattform[^"]*Deaktiviere es stattdessen\."/);
  // A login whose setup failed halfway is removed the same way, even after its customer assignment.
  assert.match(actions, /const undo = async \(customerId\?: string \| null\) => \{\n    await removeLogin\(ctx, user\.id\);/);
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
  // The notice links the hub's own privacy policy in a new tab, so the entries stay in the form.
  assert.match(form, /<a href=\{LEGAL_PATHS\.privacy\} target="_blank" rel="noopener">Datenschutzerklärung<\/a>/);
});

test("a failed account read shows a load error instead of 'pending' or 'no company'", async () => {
  const server = await source("lib/hub-users/server.ts");
  assert.match(server, /if \(failed\(\[profile, memberships\]\)\) \[profile, memberships\] = await read\(\);/);
  assert.match(server, /if \(failed\(\[profile, memberships\]\)\) throw new Error\(/);
  assert.doesNotMatch(server, /if \(profile\.error \|\| !profile\.data\) return/);
  const layout = await source("app/dashboard/layout.tsx");
  assert.match(layout, /<HubLoadBoundary><Suspense/);
  const boundary = await source("components/hub/load-error.tsx");
  assert.match(boundary, /catchError\(WorkspaceLoadError\)/);
  assert.match(boundary, /onClick=\{\(\) => retry\(\)\}/);
  assert.match(await source("app/auth/pending/error.tsx"), /<AuthLoadError retry=\{retry\} \/>/);
});

test("logins, registrations, customers and freelancers open in a panel beside the table, in its look (user 9.11.2026)", async () => {
  const panels = await source("components/hub/screens/users-dialogs.tsx");
  // No glass windows any more: every view is the shared panel, floating at the right edge.
  assert.doesNotMatch(panels, /<Modal /);
  const opened = panels.match(/<AssetPanel [^>]*/g) ?? [];
  assert.ok(opened.length >= 6, "registration, login (new, created, waiting, existing), customer and freelancer");
  for (const tag of opened) assert.match(tag, /^<AssetPanel className="um-panel"/, tag.slice(0, 80));
  // Speichern in the footer submits the form, so the browser checks the required fields, also from another tab.
  assert.match(panels, /formRef\.current\.requestSubmit\(\)/);
  // A login's tabs; access actions act at once and say so.
  assert.match(panels, /\{ id: "profile", label: "Profil" \}, \{ id: "access", label: "Zugang" \}/);
  assert.match(panels, /<PanelSection title="Zugang und Sicherheit" info=\{info\.button\} meta="wirkt sofort">/);
  // After saving, the form starts again from the saved data, so a second save cannot create a customer twice.
  assert.match(panels, /if \(seen !== source\) \{\n\s+const next = fresh\(\);/);

  const page = await source("components/hub/screens/users.tsx");
  // The open row is marked, ↑/↓ follow the table as it is shown, unsaved changes are asked about.
  assert.match(page, /\$\{openId === user\.id \? " is-open" : ""\}/);
  assert.match(page, /onPrev: at > 0 \?/);
  assert.match(page, /window\.confirm\("Deine Änderungen sind noch nicht gespeichert\. Verwerfen\?"\)/);
  assert.match(await source("components/hub/screens/users-panel.tsx"), /export function useDirtyReport\(dirty: boolean, onDirty\?: \(dirty: boolean\) => void\)/);
  // Escape in a ⓘ card or the logo window closes only that, not the panel.
  assert.match(await source("components/hub/screens/asset-panel.tsx"), /closest\("dialog, \[popover\]"\)/);

  const css = await source("app/glass.css");
  assert.match(css, /\.am-panel\.um-panel \{ position: fixed; z-index: 50; top: 12px; right: 12px; bottom: 12px;/);
  assert.match(css, /\.hub-app\.has-assistant-dock \.am-panel\.um-panel \{ right: calc\(var\(--assistant-dock\) \+ 24px\); \}/, "left of the docked assistant");
  assert.match(css, /@media \(max-width: 767px\) \{\n {2}\.am-panel\.um-panel \{ inset: 0;/, "phones: the whole screen");
  assert.match(css, /\.data-table tbody tr\.is-open td \{/);
});
