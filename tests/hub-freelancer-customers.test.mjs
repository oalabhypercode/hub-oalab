import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  cleanShareNote, hostingOf, isShareArea, MAX_SHARE_NOTE, parseCards, readShareNote, readShareToggle, releasedAreas, releasedCount, shareAreaIds,
} from "../lib/hub-freelancer-customers/rules.ts";
import { freelancerCustomerFixtures, freelancerShareFixtures } from "../lib/hub-freelancer-customers/fixtures.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const A = "2a000000-0000-4000-8000-000000000001";
const B = "2a000000-0000-4000-8000-000000000002";
const F = "1f000000-0000-4000-8000-000000000001";
const D = "3d000000-0000-4000-8000-000000000001";

test("four areas can be released; a switch and a note are read strictly", () => {
  assert.deepEqual(shareAreaIds, ["domains", "mail", "packages", "contact"]);
  assert.equal(isShareArea("passwords"), false);
  assert.deepEqual(readShareToggle({ customerId: A, freelancerId: F, area: "mail", on: true }), { ok: true, value: { customerId: A, freelancerId: F, area: "mail", on: true } });
  assert.equal(readShareToggle({ customerId: A, freelancerId: F, area: "logins", on: true }).ok, false);
  assert.equal(readShareToggle({ customerId: A, freelancerId: F, area: "mail", on: "true" }).ok, false);
  assert.equal(readShareToggle({ customerId: "KD-1", freelancerId: F, area: "mail", on: true }).ok, false);
  assert.deepEqual(readShareNote({ customerId: A, freelancerId: F, note: "  WordPress\r\n\r\n\r\nTestseite \t\n" }), { ok: true, value: { customerId: A, freelancerId: F, note: "WordPress\n\nTestseite" } });
  assert.equal(readShareNote({ customerId: A, freelancerId: F, note: "x".repeat(MAX_SHARE_NOTE + 1) }).ok, false);
  assert.equal(cleanShareNote("a\u0000b"), "ab");
});

test("the database's cards are read field by field: off stays null, unknown values fall back, broken rows go", () => {
  const raw = [
    {
      customerId: A, freelancerId: F, company: "Nordlicht Studio", customerNumber: "KD-1", organizationId: null, assignedAt: "2026-09-01T09:00:00Z",
      shares: { domains: "2026-10-12T10:00:00Z", mail: "2026-10-12T10:00:00Z", packages: null, contact: null }, note: "Testseite zuerst.", noteUpdatedAt: "2026-10-12T10:00:00Z",
      domains: [{ id: D, domain: "xn--mller-kva.example", status: "weird", owner: "oalab", registrar: "INWX", dnsProvider: "Cloudflare", websiteHost: "netcup", renewsOn: "2027-03-15", checks: { ssl: true, website: "yes" } }],
      mailServer: { imapHost: "mail.example", imapPort: 993, imapSecurity: "plain", smtpHost: "mail.example", smtpPort: 465, smtpSecurity: "ssl", webmailUrl: "http://insecure.example", provider: "netcup" },
      mailboxes: [{ id: D, address: "info@xn--mller-kva.example", person: "Jana", kind: "alias", target: "a@xn--mller-kva.example, b@example.org" }],
      packages: null, contact: null,
    },
    { customerId: A, freelancerId: F, company: "Doppelt" },
    { customerId: "kaputt", freelancerId: F },
    { customerId: B, freelancerId: F, company: "Form & Feld", customerNumber: "KD-2", shares: {}, domains: null, packages: [{ group: "service", packageId: "service-max", since: "2026-10-01" }, { packageId: "gold" }] },
  ];
  const readable = (domain) => domain.replace("xn--mller-kva", "müller");
  const [first, second, ...rest] = parseCards(raw, readable);
  assert.equal(rest.length, 0, "the double and the broken row are dropped");
  assert.equal(first.domains[0].display, "müller.example");
  assert.equal(first.domains[0].status, "active");
  assert.deepEqual(first.domains[0].checks, { website: false, ssl: true, mx: false, spf: false, dkim: false, dmarc: false });
  assert.equal(first.mailServer.imapSecurity, "ssl");
  assert.equal(first.mailServer.webmailUrl, "", "only https links are opened");
  assert.equal(first.mailboxes[0].targetDisplay, "a@müller.example, b@example.org");
  assert.equal(first.packages, null);
  assert.equal(first.contact, null);
  assert.deepEqual(second.shares, { domains: null, mail: null, packages: null, contact: null });
  assert.deepEqual(second.packages.map((item) => item.packageId), ["service-max"]);
  assert.deepEqual(releasedAreas(first.shares), ["domains", "mail"]);
});

test("„Wo liegt was?“: one row per provider, forwarding domains have no website", () => {
  const [, nordlicht] = freelancerCustomerFixtures().cards;
  assert.deepEqual(hostingOf(nordlicht).map((row) => `${row.kind}:${row.provider}`), ["website:netcup", "registrar:INWX", "dns:Cloudflare", "mail:netcup"]);
  assert.equal(hostingOf(nordlicht)[1].detail, "2 Domains registriert");
  assert.equal(releasedCount(nordlicht), 4 + 2 + 3 + 3);
  const [, , horizont] = freelancerCustomerFixtures().cards;
  assert.equal(releasedCount(horizont), 0);
  assert.equal(freelancerShareFixtures().length, 3);
});

test("„Kunden“ is the freelancers' page: everybody else is turned away, and it reads only through the database's cards", async () => {
  const page = await source("app/dashboard/[section]/page.tsx");
  assert.match(page, /if \(validSection === "customers" && identity\.account\?\.role === "oalab_admin"\) redirect\(hubHref\(false, "contracts"\)\);/);
  assert.match(page, /if \(validSection === "customers" && identity\.account\?\.role !== "oalab_freelancer"\) notFound\(\);/);
  const server = await source("lib/hub-freelancer-customers/server.ts");
  assert.match(server, /const freelancer = await verifyHubFreelancer\(\);/);
  assert.match(server, /freelancer\.supabase\.rpc\("hub_freelancer_customer_cards"\)/);
  assert.doesNotMatch(server.slice(server.indexOf("export async function loadFreelancerCustomers"), server.indexOf("type LinkRow")), /createAdminClient|hub_customer_domains|hub_vault/);
  const data = await source("lib/hub-data.ts");
  assert.match(data, /export const freelancerSections: readonly HubSection\[\] = \["customers"\];/);
  const sidebar = await source("components/hub/glass-sidebar.tsx");
  assert.match(sidebar, /if \(id === "files" && account\.freelancer\) \{/);
  assert.match(sidebar, /<Link \{\.\.\.item\("customers"\)\}><Building2 /);
  assert.match(await source("components/hub/app-shell.tsx"), /\(account\.freelancer \? key !== "contracts" : !freelancerSections\.includes\(key\)\)/);
  assert.match(await source("components/hub/screens/workspace.tsx"), /id === "files" && freelancer \? \[<ListRow key="customers"/);
});

test("admins release per freelancer: every action checks the admin first, logs, and never writes passwords", async () => {
  const actions = await source("lib/hub-freelancer-customers/actions.ts");
  assert.match(actions, /^"use server";/);
  for (const name of ["setFreelancerShare", "saveFreelancerNote"]) {
    const body = actions.slice(actions.indexOf(`export async function ${name}(`));
    assert.match(body, /^export async function \w+\([^)]*\)[^\n]*\{\r?\n {2}const ctx = await context\(\);\r?\n {2}if \(!ctx\) return denied;/, name);
  }
  assert.match(actions, /const admin = await verifyHubAdmin\(\);/);
  assert.match(actions, /from\("hub_admin_events"\)\.insert/);
  assert.doesNotMatch(actions, /hub_vault|password/i);
  const contracts = await source("lib/hub-contracts/server.ts");
  assert.match(contracts, /loadFreelancerSharesForAdmin\(db\)/);
  assert.match(contracts, /!archive\.customerIds\.has\(item\.customerId\) && !archive\.customerIds\.has\(item\.freelancerId\)/);
});

test("the screens follow the design rules: hub building blocks, the small switch, no native select or title", async () => {
  for (const file of ["components/hub/screens/freelancer-customers.tsx", "components/hub/screens/contracts-freelancers.tsx"]) {
    const screen = await source(file);
    // No browser list and no native hover text on an HTML element (component props named title are fine).
    assert.doesNotMatch(screen, /<select|<datalist|<[a-z][a-z0-9]*\b[^>]*\stitle=/, file);
    assert.match(screen, /TableGroup/, file);
  }
  const tab = await source("components/hub/screens/contracts-freelancers.tsx");
  assert.match(tab, /<Switch size="sm" /);
  assert.match(tab, /Nicht freigebbar/);
  assert.match(await source("components/hub/controls.tsx"), /className=\{size === "sm" \? "switch is-sm" : "switch"\}/);
  const css = await source("app/glass.css");
  assert.match(css, /\.switch\.is-sm \{ width: 34px; height: 20px;/);
  assert.match(css, /--switch-on-calm: rgb\(var\(--accent-rgb\) \/ 0\.62\);/);
  assert.match(css, /--switch-on-calm: rgb\(var\(--accent-rgb\) \/ 0\.55\);/);
  const contracts = await source("components/hub/screens/contracts.tsx");
  assert.match(contracts, /\{ id: "freelancer", label: "Freelancer", name: "Freelancer", count: counts\.freelancer \}/);
});
