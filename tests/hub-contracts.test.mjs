import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { heldPackages, isPackageId, packageCatalog, packageGroupOrder, packageGroups, packageIds, packagesByGroup, readPackageChoices } from "../lib/service-packages.ts";
import { addDays, byNewest, centsToInput, endingSoon, formatCents, formatDay, isIsoDay, lastPayment, parseAmount, readTimelineEntry, timelineKindIds } from "../lib/hub-contracts/rules.ts";
import { contractFixtures } from "../lib/hub-contracts/fixtures.ts";

// Windows checkouts may carry CRLF line endings; the source checks below compare LF text.
const source = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

test("two package groups with two packages each, named as in the database's hub_package_name", () => {
  assert.deepEqual([...packageGroupOrder], ["domain", "service"]);
  assert.deepEqual([...packageGroups.domain.packages], ["domain", "domain-mail"]);
  assert.deepEqual([...packageGroups.service.packages], ["service-lite", "service-max"]);
  // service-oalab migration 202611050001 writes the same names into the timeline (its test lists them too).
  assert.deepEqual(Object.fromEntries(packageIds.map((id) => [id, packageCatalog[id].name])), {
    domain: "OALAB Domain", "domain-mail": "OALAB Domain & Mail", "service-lite": "OALAB Service Lite", "service-max": "OALAB Service Max",
  });
  for (const id of packageIds) assert.ok(packageGroups[packageCatalog[id].group].packages.includes(id), id);
  assert.equal(isPackageId("website-extra"), false, "the old packages are gone");
  assert.equal(isPackageId("toString"), false);
});

test("a customer holds at most one package per group; both groups are always there", () => {
  const rows = packagesByGroup([{ group: "service", packageId: "service-max", since: "2026-10-01", until: null }]);
  assert.deepEqual(rows.map((row) => [row.group, row.packageId]), [["domain", null], ["service", "service-max"]]);
  assert.deepEqual(heldPackages(rows), ["service-max"]);
  assert.deepEqual(heldPackages(packagesByGroup([])), []);
});

test("package choices: known package of the right group, days only with a package, the end never before the start", () => {
  const ok = readPackageChoices([
    { group: "domain", packageId: "domain-mail", since: "2026-03-01", until: "" },
    { group: "service", packageId: null, since: "2026-03-01", until: "2026-04-01" },
  ]);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, [
    { group: "domain", packageId: "domain-mail", since: "2026-03-01", until: null },
    { group: "service", packageId: null, since: null, until: null },
  ]);
  assert.equal(readPackageChoices([{ group: "domain", packageId: "service-max" }]).ok, false, "package of the other group");
  assert.equal(readPackageChoices([{ group: "service", packageId: "website-extra" }]).ok, false, "unknown package");
  assert.equal(readPackageChoices([{ group: "service", packageId: "service-lite", since: "2026-05-01", until: "2026-04-30" }]).ok, false, "end before start");
  assert.equal(readPackageChoices([{ group: "service", packageId: "service-lite", since: "2026-02-30" }]).ok, false, "no such day");
  // Nothing sent means no package in either group.
  assert.deepEqual(readPackageChoices(undefined).value.map((row) => row.packageId), [null, null]);
});

test("amounts read as typed in German, empty means none", () => {
  for (const [typed, cents] of [["89", 8900], ["89,5", 8950], ["89,00 €", 8900], ["1.234,56", 123456], ["1234.56", 123456], ["1.234", 123400], ["0", 0]]) {
    assert.deepEqual(parseAmount(typed), { ok: true, cents }, typed);
  }
  assert.deepEqual(parseAmount(""), { ok: true, cents: null });
  assert.deepEqual(parseAmount(undefined), { ok: true, cents: null });
  for (const typed of ["-5", "zwölf", "1,234,5", "89,999", "1000000,01"]) assert.equal(parseAmount(typed).ok, false, typed);
  assert.equal(formatCents(8900).replace(/\s/g, " "), "89,00 €");
  assert.equal(centsToInput(123456), "1234,56");
  assert.equal(centsToInput(null), "");
});

test("a timeline entry needs a real day, a known kind and a title; the note stays multi-line", () => {
  const entry = readTimelineEntry({ occurredOn: "2026-11-03", kind: "invoice_paid", title: "  Rechnung   Oktober bezahlt ", amount: "89,00", fileId: "", note: "Per Überweisung\r\n\r\n\r\nintern", customerVisible: true });
  assert.equal(entry.ok, true);
  assert.deepEqual(entry.value, { occurredOn: "2026-11-03", kind: "invoice_paid", title: "Rechnung Oktober bezahlt", amountCents: 8900, fileId: null, note: "Per Überweisung\n\nintern", customerVisible: true });
  assert.equal(readTimelineEntry({ occurredOn: "2026-13-01", kind: "other", title: "x" }).ok, false);
  assert.equal(readTimelineEntry({ occurredOn: "2026-11-03", kind: "payment", title: "x" }).ok, false);
  assert.equal(readTimelineEntry({ occurredOn: "2026-11-03", kind: "other", title: "  " }).ok, false);
  assert.equal(readTimelineEntry({ occurredOn: "2026-11-03", kind: "other", title: "x", fileId: "nicht-uuid" }).ok, false);
  assert.equal(readTimelineEntry({ occurredOn: "2026-11-03", kind: "other", title: "x", customerVisible: "true" }).value.customerVisible, false, "only a real true releases");
  assert.deepEqual(timelineKindIds, ["invoice_paid", "invoice_sent", "package", "domain", "mail", "other"], "the kinds the database allows");
});

test("days, ends within 60 days and the last payment", () => {
  assert.equal(formatDay("2026-11-03"), "03.11.2026");
  assert.equal(addDays("2026-12-20", 15), "2027-01-04");
  assert.equal(isIsoDay("2026-02-29"), false);
  assert.equal(isIsoDay("2028-02-29"), true);
  const customers = [
    { id: "a", packages: packagesByGroup([{ group: "service", packageId: "service-lite", since: null, until: "2026-11-30" }]) },
    { id: "b", packages: packagesByGroup([{ group: "domain", packageId: "domain", since: null, until: "2027-03-01" }]) },
    { id: "c", packages: packagesByGroup([{ group: "domain", packageId: "domain", since: null, until: "2026-10-01" }]) },
  ];
  assert.deepEqual(endingSoon(customers, "2026-10-15").map((item) => [item.customer.id, item.until]), [["a", "2026-11-30"]]);
  const entries = [
    { customerId: "a", kind: "invoice_paid", occurredOn: "2026-09-03", createdAt: "2026-09-03T10:00:00Z" },
    { customerId: "a", kind: "invoice_paid", occurredOn: "2026-10-06", createdAt: "2026-10-06T10:00:00Z" },
    { customerId: "a", kind: "invoice_sent", occurredOn: "2026-11-01", createdAt: "2026-11-01T10:00:00Z" },
  ];
  assert.equal(lastPayment(entries, "a").occurredOn, "2026-10-06");
  assert.equal(lastPayment(entries, "b"), null);
  assert.deepEqual([...entries].sort(byNewest).map((entry) => entry.occurredOn), ["2026-11-01", "2026-10-06", "2026-09-03"]);
});

test("the examples: admins see every demo customer with notes, a customer only its released entries without them", () => {
  const admin = contractFixtures({ admin: true, customerNumber: null, contractFiles: { "KD-24017": "nordlicht-servicevertrag" } });
  assert.deepEqual(admin.customers.map((customer) => customer.customerNumber), ["KD-24017", "KD-24023", "KD-24031"]);
  assert.ok(admin.timeline.some((entry) => !entry.customerVisible), "admins also see internal entries");
  assert.ok(admin.timeline.some((entry) => entry.fileId === "nordlicht-servicevertrag"), "an entry links the example contract");
  assert.equal(admin.canManage, false, "examples can never be saved");
  const customer = contractFixtures({ admin: false, customerNumber: "KD-24017" });
  assert.deepEqual(customer.customers.map((item) => item.customerNumber), ["KD-24017"]);
  assert.ok(customer.timeline.length > 0 && customer.timeline.every((entry) => entry.customerVisible && entry.customerId === "KD-24017"));
  for (const entry of customer.timeline) assert.deepEqual(["note", "source", "authorName"].filter((key) => key in entry), [], entry.title);
  assert.deepEqual(contractFixtures({ admin: false, customerNumber: null }).customers, []);
});

test("customers read released entries only and never the internal note; every admin action checks the admin first", async () => {
  const server = await source("lib/hub-contracts/server.ts");
  const columns = server.match(/export const CUSTOMER_TIMELINE_COLUMNS = "([^"]+)"/)[1].split(", ");
  // The same columns the migration grants to logins.
  assert.deepEqual(columns, ["id", "customer_id", "occurred_on", "kind", "title", "amount_cents", "file_id", "customer_visible", "created_at"]);
  const customerLoad = server.slice(server.indexOf("async function loadForCustomer"), server.indexOf("export async function loadContractsForIdentity"));
  assert.match(customerLoad, /const supabase = await createClient\(\);/, "with the login's own session");
  assert.match(customerLoad, /\.select\(CUSTOMER_TIMELINE_COLUMNS\)\.in\("customer_id", ids\)\.eq\("customer_visible", true\)/);
  assert.doesNotMatch(customerLoad, /createAdminClient|ADMIN_TIMELINE_COLUMNS/);
  assert.match(server.slice(server.indexOf("async function loadForAdmin"), server.indexOf("async function loadForCustomer")), /if \(!await verifyHubAdmin\(\)\) return empty\("admin"/);

  const actions = await source("lib/hub-contracts/actions.ts");
  const lines = actions.split("\n");
  const exported = lines.flatMap((line, index) => line.startsWith("export async function ") ? [{ name: line.match(/^export async function (\w+)/)[1], next: lines.slice(index + 1, index + 3) }] : []);
  assert.deepEqual(exported.map((action) => action.name), ["saveCustomerPackages", "saveTimelineEntry", "setTimelineVisible", "deleteTimelineEntry"]);
  for (const action of exported) assert.deepEqual(action.next, ["  const ctx = await context();", "  if (!ctx) return denied;"], `${action.name} checks the admin first`);
  assert.match(actions, /const admin = await verifyHubAdmin\(\);/);
  // The admin log keeps no titles, amounts or notes.
  for (const call of actions.matchAll(/await log\(ctx, "[^"]+", ([^,]+), /g)) assert.match(call[1], /^("[^"]+"|input\.visible \? "[^"]+" : "[^"]+")$/, call[0]);

  // Nothing of it reaches the assistant: it reads the package names only.
  assert.doesNotMatch(await source("lib/hub-assistant/data.ts"), /hub_customer_timeline/);
});

test("„Vertrag & Domain“ sits below the asset management, freelancers have no entry and get a 404", async () => {
  const categories = await source("lib/categories.ts");
  assert.match(categories, /export const categoryOrder: CategoryId\[\] = \["projects", "files", "contracts", "messages", "calendar"\];/);
  assert.match(categories, /contracts: \{ id: "contracts", name: "Vertrag & Domain", section: "contracts"/);
  assert.match(await source("components/hub/screens/workspace.tsx"), /const shownCategories = categoriesFor\(freelancer\)\.filter\(/);
  assert.match(await source("app/dashboard/[section]/page.tsx"), /if \(validSection === "contracts" && identity\.account\?\.role === "oalab_freelancer"\) notFound\(\);/);
  const screen = await source("components/hub/screens/contracts.tsx");
  // The full name is too wide for the sidebar (230 px of text, 199 px room): the page carries it for admins.
  assert.match(screen, /<LargeTitleHeader title="Contract & Domain Management"/);
  assert.match(screen, /<LargeTitleHeader title="Vertrag & Domain"/);
  // The colour of the new area is defined for both themes.
  const css = await source("app/glass.css");
  assert.equal((css.match(/--cat-contracts-text: #[0-9a-f]{6};/g) ?? []).length, 2);
  // The user management keeps master data and logins and links to the packages.
  assert.match(await source("components/hub/screens/users-dialogs.tsx"), /href=\{`\$\{hubHref\(false, "contracts"\)\}\?customer=\$\{customer\.id\}`\}/);
});

test("customers read „Vertrag & Domain“ like „Dateien“: two figures, one sheet in groups, nothing internal", async () => {
  const sheet = await source("components/hub/screens/contracts-customer.tsx");
  assert.match(sheet, /<div className="metric-grid section-first">/);
  assert.equal((sheet.match(/className="glass glass-card metric-card"/g) ?? []).length, 2, "Pakete and Zahlungen");
  assert.match(sheet, /<div className="sheet section-first cdm-sheet">\s*<SheetToolbar/);
  const groups = [...sheet.matchAll(/<TableGroup colSpan=\{COLUMNS\} label="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(groups, ["Pakete", "Domains", "E-Mail-Adressen", "Dokumente", "Verlauf"]);
  assert.match(sheet, /\{ id: "all", label: "Alles"[^}]*\},\s*\{ id: "contract", label: "Vertrag"[^}]*\},\s*\{ id: "domain", label: "Domain & E-Mail"/);
  // What only admins see of domains and addresses never shows: no status, provider, renewal, checks, password state.
  assert.doesNotMatch(sheet, /\.details|hasPassword|\.provider|renewsOn|\.checks|\.note\b|authorName/);
  // Mail settings in three steps, servers and ports to copy, never a password.
  assert.deepEqual([...sheet.matchAll(/<h3>([^<]+)<\/h3>/g)].map((match) => match[1]), ["Konto hinzufügen", "Server eintragen", "Anmelden"]);
  assert.match(sheet, /<CopyButton value=\{host\}/);
  assert.match(sheet, /Passwörter zeigt der Hub nicht an\./);
  // Documents download like in „Dateien“; the newest three entries first.
  assert.match(sheet, /<DownloadButton file=\{file\} onError=\{setNotice\} \/>/);
  assert.match(sheet, /const RECENT = 3;/);
  const screen = await source("components/hub/screens/contracts.tsx");
  assert.doesNotMatch(screen, /settings-grid|CustomerDomainCard/, "the old cards are gone");
  assert.doesNotMatch(await source("components/hub/screens/contracts-domains.tsx"), /export function CustomerDomainCard/);
});

test("the admins' overview is one table in the asset management's frame: what needs a hand first", async () => {
  const overview = await source("components/hub/screens/contracts-overview.tsx");
  const groups = [...overview.matchAll(/<TableGroup colSpan=\{COLUMNS\} label="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(groups, ["Handlungsbedarf", "Demnächst", "Pakete", "Zuletzt im Verlauf"]);
  // Customers without packages or service, passed renewals and open checks of running domains.
  for (const reason of ['"Keine Pakete"', '"Kein Servicepaket"', '"Verlängerung prüfen"', '"Prüfung" : "Prüfungen"']) assert.ok(overview.includes(reason), reason);
  assert.match(overview, /renewalPassed\(details, today\)/);
  assert.match(overview, /details\.status === "active" && open\.length/);
  // A row opens its customer on the fitting tab; „Ohne Servicepaket“ filters the list on the left.
  assert.match(overview, /onOpenCustomer\(row\.customer\.id, row\.tab\)/);
  assert.match(overview, /onClick=\{onShowMissing\}/);
  assert.match(overview, /<SheetToolbar query=\{query\} onQuery=\{setQuery\}/);
  const screen = await source("components/hub/screens/contracts.tsx");
  assert.match(screen, /const openCustomer = \(id: string, nextTab: Tab = "contract"\) => choose\(\{ kind: "customer", id \}, nextTab\);/);
  assert.doesNotMatch(screen, /cdm-tiles|cdm-all|function upcoming/, "the tiles and the table of all customers are gone");
  // The templates join as a group of rows below.
  assert.match(await source("components/hub/screens/contract-template-versions.tsx"), /<TableGroup colSpan=\{2\} label="Vertragsvorlagen"/);
  const css = await source("app/glass.css");
  assert.match(css, /\.am \.cdm-admin-table \.cell-file \{ width: 100%; max-width: 0; \}/, "long names shorten, nothing scrolls sideways");
  assert.match(css, /@container sheet \(max-width: 1099px\) \{\n  \.am \.cdm-table tbody tr\.file-row > td:first-child \{ padding-left: 20px; \}/);
});

test("the customer's tabs are tables: tabs in the toolbar, packages chosen in their row, a save bar only for changes", async () => {
  const screen = await source("components/hub/screens/contracts.tsx");
  assert.match(screen, /<SheetToolbar\s+leading=\{<SegmentedControl label="Ansicht"/, "the tabs sit in the toolbar, the search beside them");
  assert.match(screen, /paid \? `bezahlt \$\{formatDay\(paid\.occurredOn\)\}` : ""/, "the head names the newest payment");
  assert.doesNotMatch(screen, /chat-filter cdm-tabs|cdm-body/);
  const parts = await source("components/hub/screens/contracts-parts.tsx");
  // „Kein | Domain | Domain & Mail“ and „Kein | Lite | Max“ as radios inside the row.
  assert.match(parts, /role="radiogroup" aria-label=\{`\$\{name\}-Paket`\}/);
  assert.match(parts, /\[null, \.\.\.packageGroups\[item\.group\]\.packages\]\.map/);
  assert.match(parts, /const pickLabel = \(id: PackageId \| null\) => id \? packageCatalog\[id\]\.short\.replace\(\/\^Service \/, ""\) : "Kein";/);
  // The bar appears only with a change, names it and saves through the same action as before.
  assert.match(parts, /\{canManage && changes\.length > 0 && \(\s*<div className="sheet-selection cdm-savebar"/);
  assert.match(parts, /saveCustomerPackages\(\{ customerId: customer\.id, packages: draft \}\)/);
  assert.match(parts, /data-tip="Kündigung eintragen"/);
  // The timeline by month, each entry with its release chip.
  assert.match(parts, /const months = \[\.\.\.new Set\(shown\.map\(\(entry\) => entry\.occurredOn\.slice\(0, 7\)\)\)\];/);
  assert.match(parts, /setTimelineVisible\(\{ id: entry\.id, visible: !entry\.customerVisible \}\)/);
  assert.match(parts, /\{entry\.customerVisible \? "Kunde" : "Intern"\}/);
  // Domains with their six checks as dots, the mail server changed in a dialog behind the pencil.
  const domains = await source("components/hub/screens/contracts-domains.tsx");
  assert.match(domains, /domainCheckIds\.map\(\(id\) => <i key=\{id\} className=\{details\.checks\[id\] \? "is-ok" : undefined\}/);
  assert.match(domains, /<MailServerForm customerId=\{customer\.id\} server=\{server\} canManage=\{canManage\} onSaved=\{\(message\) => \{ onNotice\(message\); setDialog\(null\); \}\} \/>/);
  // The vault: its state as a bar above the table, the password control unchanged in each row.
  const access = await source("components/hub/screens/contracts-access.tsx");
  assert.match(access, /<div className="cdm-lock is-todo" role="status">/);
  assert.equal((access.match(/<SecretControl key=/g) ?? []).length, 2);
  for (const file of [parts, domains, access]) assert.doesNotMatch(file, /className="cdm-body"|className="dm-list"|className="cdm-entries"/, "the old lists are gone");
});
