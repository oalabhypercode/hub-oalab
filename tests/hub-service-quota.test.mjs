import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { serviceRequestLimit, serviceRequestLimits } from "../lib/service-packages.ts";
import { blockList, formatBerlinDay, QUOTA_WARN_SHARE, quotaMonth, quotaStatus, readExemptReason, readQuotaRow, requestReference, usageLine, warnList } from "../lib/hub-service-quota/rules.ts";
import { quotaFixtures, quotaRequestFixtures } from "../lib/hub-service-quota/fixtures.ts";
import { contractFixtures } from "../lib/hub-contracts/fixtures.ts";

// Windows checkouts may carry CRLF line endings; the source checks below compare LF text.
const source = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const row = (packageId, monthlyUsed, extra = {}) => ({ customerId: `c-${packageId}-${monthlyUsed}`, packageId, monthlyLimit: serviceRequestLimit(packageId), monthlyUsed, exempted: 0, organizationActive: true, logins: 1, ...extra });

test("Service Lite 5 and Max 20 new requests a month, none without a Service package (as hub_service_request_limit)", () => {
  assert.deepEqual(serviceRequestLimits, { "service-lite": 5, "service-max": 20 });
  assert.equal(serviceRequestLimit(null), 0);
  assert.equal(serviceRequestLimit("domain-mail"), 0, "a domain package is no Service package");
  assert.equal(serviceRequestLimit("toString"), 0);
});

test("warning from 80 %, blocked at the limit and without a package", () => {
  assert.equal(QUOTA_WARN_SHARE, 0.8);
  assert.equal(quotaStatus(row("service-lite", 3)), "ok");
  assert.equal(quotaStatus(row("service-lite", 4)), "warn", "4 of 5");
  assert.equal(quotaStatus(row("service-lite", 5)), "full");
  assert.equal(quotaStatus(row("service-lite", 9)), "full");
  assert.equal(quotaStatus(row("service-max", 15)), "ok");
  assert.equal(quotaStatus(row("service-max", 16)), "warn", "16 of 20");
  assert.equal(quotaStatus(row("service-max", 20)), "full");
  assert.equal(quotaStatus(row(null, 0)), "none");
  assert.equal(usageLine(row("service-lite", 3)), "3 von 5");
  assert.equal(usageLine(row(null, 1)), "1 Anfrage");
  assert.equal(usageLine(row(null, 2)), "2 Anfragen");
});

test("the block list: without a package first, then at the limit, only customers who can reach the platform", () => {
  const rows = [
    row("service-lite", 5, { customerId: "full" }),
    row(null, 0, { customerId: "none" }),
    row("service-max", 3, { customerId: "free" }),
    row(null, 0, { customerId: "no-login", logins: 0 }),
    row(null, 0, { customerId: "suspended", organizationActive: false }),
    row("service-max", 17, { customerId: "warn" }),
  ];
  assert.deepEqual(blockList(rows).map((item) => item.customerId), ["none", "full"]);
  assert.deepEqual(warnList(rows).map((item) => item.customerId), ["warn"]);
});

test("the database's rows read defensively", () => {
  assert.equal(readQuotaRow(null), null);
  assert.equal(readQuotaRow({ packageId: "service-lite" }), null, "without a customer");
  assert.deepEqual(readQuotaRow({ customerId: "a", packageId: "service-max", monthlyLimit: 20, monthlyUsed: 4, exempted: 1, organizationActive: true, logins: 3 }),
    { customerId: "a", packageId: "service-max", monthlyLimit: 20, monthlyUsed: 4, exempted: 1, organizationActive: true, logins: 3 });
  assert.deepEqual(readQuotaRow({ customerId: "b", packageId: "website-extra", monthlyUsed: -2 }),
    { customerId: "b", packageId: null, monthlyLimit: 0, monthlyUsed: 0, exempted: 0, organizationActive: true, logins: 1 }, "unknown package, bad numbers");
});

test("the month in German time: November 2026 starts again on 1 December", () => {
  const november = quotaMonth({ startsAt: "2026-10-31T23:00:00.000Z", endsAt: "2026-11-30T23:00:00.000Z" });
  assert.deepEqual(november, { month: "November", monthYear: "November 2026", resetDay: "1. Dezember 2026" });
  assert.equal(quotaMonth({ startsAt: "2026-11-30T23:00:00.000Z", endsAt: "2026-12-31T23:00:00.000Z" }).resetDay, "1. Januar 2027");
  assert.equal(formatBerlinDay("2026-10-31T23:30:00.000Z"), "01.11.2026", "after midnight in Berlin it is the next day");
  assert.equal(requestReference(12), "OA-12");
});

test("an exemption needs a short reason of one line", () => {
  assert.deepEqual(readExemptReason("  Fehler von\n oalab "), { ok: true, reason: "Fehler von oalab" });
  assert.equal(readExemptReason("ok").ok, false);
  assert.equal(readExemptReason(undefined).ok, false);
  assert.equal(readExemptReason("x".repeat(301)).ok, false);
  assert.equal(readExemptReason("x".repeat(300)).ok, true);
});

test("the examples: the switch is off, admins see the counts and the block list, customers see nothing", () => {
  const contracts = contractFixtures({ admin: true, customerNumber: null });
  const quota = quotaFixtures({ admin: true, customerIds: contracts.customers.map((customer) => customer.id) });
  assert.equal(quota.enforced, false);
  assert.equal(quota.ready, true);
  assert.equal(quota.canManage, false, "the examples never write");
  assert.deepEqual(quota.customers.map((item) => [item.customerId, quotaStatus(item)]), [["KD-24017", "warn"], ["KD-24023", "full"], ["KD-24031", "ok"]]);
  assert.deepEqual(blockList(quota.customers).map((item) => item.customerId), ["KD-24023"]);
  for (const item of quota.customers) assert.equal(item.monthlyLimit, serviceRequestLimit(item.packageId), item.customerId);
  // Each demo customer's Service package in the contract examples is the one of its quota row.
  for (const customer of contracts.customers) {
    const service = customer.packages.find((item) => item.group === "service")?.packageId;
    assert.equal(quota.customers.find((item) => item.customerId === customer.id)?.packageId, service, customer.company);
  }
  const listed = quotaRequestFixtures("KD-24017");
  assert.equal(listed.length, 17, "16 that count and one that does not");
  assert.equal(listed.filter((item) => item.exemption).length, 1);
  assert.ok(listed.every((item, index) => index === 0 || listed[index - 1].submittedAt >= item.submittedAt), "newest first");
  for (const item of listed) {
    assert.ok(item.submittedAt >= quota.window.startsAt && item.submittedAt < quota.window.endsAt, `${item.reference} lies in the demo month`);
  }
  assert.deepEqual(quotaFixtures({ admin: false, customerIds: ["KD-24023"] }).customers, [], "customers see nothing while the switch is off");
  assert.deepEqual(quotaFixtures({ admin: true, customerIds: ["KD-24031"] }).customers.map((item) => item.customerId), ["KD-24031"], "only the customers shown");
});

test("admins read everything with the service role after the check, customers only their own with their own session", async () => {
  const server = await source("lib/hub-service-quota/server.ts");
  assert.match(server, /^import "server-only";/);
  assert.match(server, /db\.rpc\("hub_service_quota_overview"\)/);
  assert.match(server, /supabase\.rpc\("hub_member_service_quota"\)/);
  assert.doesNotMatch(server, /createAdminClient/);
  const contracts = await source("lib/hub-contracts/server.ts");
  const adminLoad = contracts.slice(contracts.indexOf("async function loadForAdmin"), contracts.indexOf("async function loadForCustomer"));
  assert.match(adminLoad, /if \(!await verifyHubAdmin\(\)\) return empty\("admin"/);
  assert.match(adminLoad, /loadServiceQuotaForAdmin\(db\)\.catch\(quotaFailed\)/);
  const customerLoad = contracts.slice(contracts.indexOf("async function loadForCustomer"), contracts.indexOf("export async function loadContractsForIdentity"));
  assert.match(customerLoad, /loadServiceQuotaForCustomer\(supabase\)\.catch\(quotaFailed\)/);
  assert.doesNotMatch(customerLoad, /createAdminClient/);
});

test("every quota action checks the admin first and logs no reasons or titles", async () => {
  const actions = await source("lib/hub-service-quota/actions.ts");
  assert.match(actions, /^"use server";/);
  const lines = actions.split("\n");
  const exported = lines.flatMap((line, index) => line.startsWith("export async function ") ? [{ name: line.match(/^export async function (\w+)/)[1], next: lines.slice(index + 1, index + 3) }] : []);
  assert.deepEqual(exported.map((action) => action.name), ["loadServiceQuotaRequests", "setServiceRequestExempt", "setServiceQuotaSwitch"]);
  for (const action of exported) assert.deepEqual(action.next, ["  const ctx = await context();", "  if (!ctx) return denied;"], `${action.name} checks the admin first`);
  assert.match(actions, /const admin = await verifyHubAdmin\(\);/);
  for (const call of actions.matchAll(/await log\(ctx, "([^"]+)", ([^,]+), /g)) {
    assert.match(call[1], /^service\.(request_exempted|request_counted|quota_switch)$/);
    assert.match(call[2], /^("[^"]+"|data\.enforced \? "[^"]+" : "[^"]+")$/, call[0]);
  }
  // Exemptions only for the customer's own organization, and the switch only through the single row.
  assert.match(actions, /organization_id: organizationId, reason: reason\.reason, created_by: ctx\.actorId/);
  assert.match(actions, /\.delete\(\)\.eq\("request_id", input\.requestId\)\.eq\("organization_id", organizationId\)/);
  assert.match(actions, /from\("hub_service_quota_switch"\)\.update\(\{ enforced: input\.enforced, updated_by: ctx\.actorId \}\)\.eq\("id", true\)/);
  // Nothing of it reaches the assistant.
  assert.doesNotMatch(await source("lib/hub-assistant/data.ts"), /hub_service_(quota|request)/);
});

test("the customer's line and the service platform's hints appear only while the switch is on", async () => {
  const screen = await source("components/hub/screens/contracts-quota.tsx");
  assert.match(screen, /const row = quota\.enforced \? quota\.customers\.find\(\(item\) => item\.customerId === customerId\) : undefined;/);
  assert.match(screen, /if \(!quota\.ready\) return null;/, "without the migration the customer card stays away");
  // The table names the count also for customers without a package (seen live on 6.11.: only „kein Paket“ before).
  assert.match(screen, /const text = status === "none" \? `\$\{usageLine\(row\)\} · kein Paket` : usageLine\(row\);/);
  assert.equal(usageLine({ packageId: null, monthlyLimit: 0, monthlyUsed: 1 }), "1 Anfrage");
  const contracts = await source("components/hub/screens/contracts.tsx");
  // The quota is a group of the overview's table.
  assert.match(await source("components/hub/screens/contracts-overview.tsx"), /<ServiceQuotaSection quota=\{state\.serviceQuota\}/);
  assert.match(contracts, /<CustomerQuotaCard key=\{`quota-\$\{current\.id\}`\} customer=\{current\} quota=\{state\.serviceQuota\} fixtures=\{state\.source === "fixtures"\}/);
  // The customer's row sits in the group „Pakete“ of their sheet.
  assert.match(await source("components/hub/screens/contracts-customer.tsx"), /<CustomerQuotaLine quota=\{state\.serviceQuota\} customerId=\{customer\.id\} \/>/);
});
