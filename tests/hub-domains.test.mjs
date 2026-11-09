import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  LOOK_LIMIT, LOOK_WINDOW_MINUTES, REVEAL_SECONDS, domainCheckIds, domainStatusIds, loginKindIds, mailboxKindIds, mailSecurities, normalizeDomain, normalizeEmail, normalizeHost,
  normalizeUrl, readDomain, readLogin, readMailbox, readMailServer, readSecret, readVaultOwner, renewalPassed, renewingSoon,
} from "../lib/hub-domains/rules.ts";
import { keyFingerprint, openSecret, parseVaultKey, sealSecret, VAULT_KEY_VERSION } from "../lib/hub-vault/crypto.ts";
import { contractFixtures } from "../lib/hub-contracts/fixtures.ts";

// Windows checkouts may carry CRLF line endings; the source checks below compare LF text.
const source = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const sources = async (dir) => Promise.all((await readdir(new URL(`../${dir}`, import.meta.url))).filter((name) => /\.tsx?$/.test(name)).map(async (name) => [`${dir}/${name}`, await source(`${dir}/${name}`)]));

const ID = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

test("domains, host names and addresses read as typed, in lower case and with umlauts as xn--", () => {
  for (const [typed, domain] of [["kunde.de", "kunde.de"], ["Kunde.DE.", "kunde.de"], ["https://www.Müller.de/pfad?x=1", "www.xn--mller-kva.de"], ["shop.kunde.de:443", "shop.kunde.de"], ["xn--mller-kva.de", "xn--mller-kva.de"]]) {
    assert.equal(normalizeDomain(typed), domain, typed);
  }
  for (const typed of ["kunde", "-kunde.de", "kunde..de", "kun de.de", "info@kunde.de", "kunde.d", "", " ", "[::1]", 5, null]) assert.equal(normalizeDomain(typed), null, String(typed));
  assert.equal(normalizeHost("Mail.Kunde.de"), "mail.kunde.de");
  assert.equal(normalizeHost("mail kunde"), null);
  for (const [typed, address] of [["Info@Kunde.de ", "info@kunde.de"], ["jana.sommer+news@müller.de", "jana.sommer+news@xn--mller-kva.de"]]) assert.equal(normalizeEmail(typed), address, typed);
  for (const typed of ["info@", "@kunde.de", "in fo@kunde.de", ".info@kunde.de", "info..x@kunde.de", "info@kunde", "https://x@kunde.de", "info@kunde.de/x"]) assert.equal(normalizeEmail(typed), null, typed);
  // Links: https for webmail, http(s) for logins, never scripts or credentials in the link.
  assert.equal(normalizeUrl("webmail.kunde.de", true), "https://webmail.kunde.de/");
  assert.equal(normalizeUrl("http://webmail.kunde.de", true), null);
  assert.equal(normalizeUrl("http://panel.anbieter.de/login", false), "http://panel.anbieter.de/login");
  for (const typed of ["javascript:alert(1)", "data:text/html,x", "https://user:pw@kunde.de", "https://kun de.de", "ftp://kunde.de"]) assert.equal(normalizeUrl(typed, false), null, typed);
  assert.equal(normalizeUrl("  ", true), "");
});

test("a domain needs a name, a status and an owner; the six checks only count when really true", () => {
  const domain = readDomain({ domain: "https://Kunde.de/", status: "transfer", owner: "oalab", registrar: "  netcup ", dnsProvider: "Cloud\nflare", websiteHost: "", renewsOn: "2027-01-31", checks: { ssl: true, mx: "true", spf: 1, gold: true }, note: "intern\r\n\r\n\r\nzweite Zeile" });
  assert.equal(domain.ok, true);
  assert.deepEqual(domain.value, {
    domain: "kunde.de", registrar: "netcup", dnsProvider: "Cloud flare", websiteHost: "", owner: "oalab", renewsOn: "2027-01-31", status: "transfer",
    checks: { website: false, ssl: true, mx: false, spf: false, dkim: false, dmarc: false }, note: "intern\n\nzweite Zeile",
  });
  assert.equal(readDomain({ domain: "kunde.de", status: "active", owner: "customer", renewsOn: "" }).value.renewsOn, null);
  assert.equal(readDomain({ domain: "kunde", status: "active", owner: "customer" }).ok, false);
  assert.equal(readDomain({ domain: "kunde.de", status: "paused", owner: "customer" }).ok, false);
  assert.equal(readDomain({ domain: "kunde.de", status: "active", owner: "agency" }).ok, false);
  assert.equal(readDomain({ domain: "kunde.de", status: "active", owner: "customer", renewsOn: "2027-02-30" }).ok, false);
  assert.deepEqual(domainCheckIds, ["website", "ssl", "mx", "spf", "dkim", "dmarc"], "the six checks of the plan, as the database names them");
  assert.deepEqual(domainStatusIds, ["active", "setup", "transfer", "cancelled", "ended"]);
});

test("domain renewals: the next 60 days, never ended ones; a passed renewal of a running domain needs a new date", () => {
  const domains = [
    { id: "a", status: "active", renewsOn: "2026-12-01" },
    { id: "b", status: "cancelled", renewsOn: "2026-11-10" },
    { id: "c", status: "ended", renewsOn: "2026-11-20" },
    { id: "d", status: "active", renewsOn: "2027-03-01" },
    { id: "e", status: "active", renewsOn: null },
    { id: "f", status: "active", renewsOn: "2026-10-01" },
  ];
  assert.deepEqual(renewingSoon(domains, "2026-11-05").map((domain) => domain.id), ["b", "a"]);
  assert.equal(renewalPassed(domains[5], "2026-11-05"), true);
  assert.equal(renewalPassed({ status: "cancelled", renewsOn: "2026-10-01" }, "2026-11-05"), false, "a cancelled domain simply runs out");
  assert.equal(renewalPassed(domains[0], "2026-11-05"), false);
});

test("the mail server: each server with its port and an encryption, webmail over https", () => {
  const server = readMailServer({ provider: " netcup ", imapHost: "Mail.Kunde.de", imapPort: "993", imapSecurity: "ssl", smtpHost: "mail.kunde.de", smtpPort: 587, smtpSecurity: "starttls", webmailUrl: "webmail.kunde.de" });
  assert.equal(server.ok, true);
  assert.deepEqual(server.value, { provider: "netcup", imapHost: "mail.kunde.de", imapPort: 993, imapSecurity: "ssl", smtpHost: "mail.kunde.de", smtpPort: 587, smtpSecurity: "starttls", webmailUrl: "https://webmail.kunde.de/" });
  // A port without a server is dropped, a server without a port refused (the database pairs them too).
  assert.deepEqual(readMailServer({ imapHost: "", imapPort: "993", imapSecurity: "ssl", smtpSecurity: "ssl" }).value, { provider: "", imapHost: "", imapPort: null, imapSecurity: "ssl", smtpHost: "", smtpPort: null, smtpSecurity: "ssl", webmailUrl: "" });
  assert.equal(readMailServer({ imapHost: "mail.kunde.de", imapPort: "", imapSecurity: "ssl", smtpSecurity: "ssl" }).ok, false);
  assert.equal(readMailServer({ imapHost: "mail.kunde.de", imapPort: "70000", imapSecurity: "ssl", smtpSecurity: "ssl" }).ok, false);
  assert.equal(readMailServer({ imapSecurity: "none", smtpSecurity: "ssl" }).ok, false, "never unencrypted");
  assert.equal(readMailServer({ imapSecurity: "ssl", smtpSecurity: "ssl", webmailUrl: "http://webmail.kunde.de" }).ok, false);
  assert.deepEqual(mailSecurities.ssl.ports, { imap: 993, smtp: 465 });
  assert.deepEqual(mailSecurities.starttls.ports, { imap: 143, smtp: 587 });
});

test("mailboxes, forwards and aliases: targets as the database stores them", () => {
  const dbTarget = /^[^\s,]+@[^\s,]+(, [^\s,]+@[^\s,]+)*$/;
  assert.deepEqual(readMailbox({ address: "Info@Kunde.de", kind: "mailbox", person: " Jana  Sommer ", target: "egal@x.de" }).value, { address: "info@kunde.de", person: "Jana Sommer", kind: "mailbox", target: "" });
  const forward = readMailbox({ address: "hallo@kunde.de", kind: "forward", target: "info@kunde.de; Jana@Kunde.de\ninfo@kunde.de" });
  assert.equal(forward.value.target, "info@kunde.de, jana@kunde.de");
  assert.match(forward.value.target, dbTarget);
  assert.equal(readMailbox({ address: "kontakt@kunde.de", kind: "alias", target: "info@kunde.de" }).value.target, "info@kunde.de");
  assert.equal(readMailbox({ address: "kontakt@kunde.de", kind: "alias", target: "info@kunde.de, jana@kunde.de" }).ok, false, "an alias belongs to one mailbox");
  assert.equal(readMailbox({ address: "hallo@kunde.de", kind: "forward", target: "" }).ok, false);
  assert.equal(readMailbox({ address: "hallo@kunde.de", kind: "forward", target: "Hallo@kunde.de" }).ok, false, "never to itself");
  assert.equal(readMailbox({ address: "hallo@kunde.de", kind: "forward", target: "kein-ziel" }).ok, false);
  assert.equal(readMailbox({ address: "hallo@kunde.de", kind: "forward", target: Array.from({ length: 11 }, (_, i) => `p${i}@x.de`).join(",") }).ok, false);
  assert.equal(readMailbox({ address: "hallo@kunde.de", kind: "redirect" }).ok, false);
  assert.equal(readMailbox({ address: "kein-postfach", kind: "mailbox" }).ok, false);
  assert.deepEqual(mailboxKindIds, ["mailbox", "forward", "alias"]);
});

test("provider logins and passwords: known kinds, safe links, passwords exactly as typed", () => {
  assert.deepEqual(readLogin({ kind: "hosting", label: "  netcup   WCP ", loginUrl: "wcp.netcup.de", username: " kd-4711 " }).value, { kind: "hosting", label: "netcup WCP", loginUrl: "https://wcp.netcup.de/", username: "kd-4711" });
  assert.equal(readLogin({ kind: "email", label: "x" }).ok, false);
  assert.equal(readLogin({ kind: "dns", label: " " }).ok, false);
  assert.equal(readLogin({ kind: "dns", label: "x", loginUrl: "javascript:alert(1)" }).ok, false);
  assert.deepEqual(loginKindIds, ["registrar", "dns", "hosting", "other"]);
  assert.deepEqual(readSecret("  mit Leerzeichen  "), { ok: true, value: "  mit Leerzeichen  " }, "never trimmed");
  assert.equal(readSecret("äöü😀").ok, true);
  assert.equal(readSecret("😀".repeat(500)).ok, true, "500 characters, whatever their bytes");
  for (const bad of ["", "zwei\nZeilen", "tab\there", "x".repeat(501), 42, null]) assert.equal(readSecret(bad).ok, false, JSON.stringify(bad));
  assert.deepEqual(readVaultOwner({ kind: "mailbox", id: ID }), { kind: "mailbox", id: ID });
  for (const bad of [{ kind: "domain", id: ID }, { kind: "login", id: "1" }, null, "login"]) assert.equal(readVaultOwner(bad), null);
  assert.equal(REVEAL_SECONDS, 30, "shown for 30 seconds, as approved");
  assert.equal(LOOK_LIMIT, 30);
  assert.equal(LOOK_WINDOW_MINUTES, 10);
});

test("vault: AES-256-GCM bound to its owner; a wrong key, owner or byte opens nothing", () => {
  const raw = Buffer.alloc(32, 7);
  const key = parseVaultKey(raw.toString("base64"));
  assert.ok(key && key.length === 32);
  for (const bad of [undefined, "", "kurz", Buffer.alloc(16).toString("base64"), Buffer.alloc(32).toString("hex"), `${raw.toString("base64")}x`]) assert.equal(parseVaultKey(bad), null, String(bad));
  const owner = { kind: "mailbox", id: ID };
  const secret = "Geheim äöü 😀 mit Leerzeichen ";
  const sealed = sealSecret(key, owner, secret);
  assert.equal(sealed.keyVersion, VAULT_KEY_VERSION);
  // The formats the database checks (migration 202611050002).
  assert.match(sealed.iv, /^[A-Za-z0-9+/]{16}$/);
  assert.match(sealed.authTag, /^[A-Za-z0-9+/]{22}==$/);
  assert.match(sealed.ciphertext, /^[A-Za-z0-9+/]+={0,2}$/);
  assert.ok(!sealed.ciphertext.includes(Buffer.from(secret).toString("base64").slice(0, 8)), "no plain text inside");
  assert.equal(openSecret(key, owner, sealed), secret);
  assert.notEqual(sealSecret(key, owner, secret).iv, sealed.iv, "a fresh IV each time");
  assert.equal(openSecret(key, { kind: "mailbox", id: OTHER }, sealed), null, "copied to another mailbox it does not open");
  assert.equal(openSecret(key, { kind: "login", id: ID }, sealed), null, "nor as a login");
  assert.equal(openSecret(parseVaultKey(Buffer.alloc(32, 8).toString("base64")), owner, sealed), null, "another key opens nothing");
  const flipped = Buffer.from(sealed.ciphertext, "base64");
  flipped[0] ^= 1;
  assert.equal(openSecret(key, owner, { ...sealed, ciphertext: flipped.toString("base64") }), null, "a changed byte opens nothing");
  assert.equal(openSecret(key, owner, { ...sealed, authTag: Buffer.alloc(16).toString("base64") }), null);
  assert.equal(openSecret(key, owner, { ...sealed, keyVersion: 2 }), null);
  // The longest password still fits the database's 3000 characters.
  assert.ok(sealSecret(key, owner, "😀".repeat(500)).ciphertext.length <= 3000);
  // The key's short name compares Vercel with .env.local: stable, short, different per key, no part of the key.
  const id = keyFingerprint(key);
  assert.match(id, /^[0-9A-F]{4}-[0-9A-F]{4}$/);
  assert.equal(keyFingerprint(parseVaultKey(raw.toString("base64"))), id);
  assert.notEqual(keyFingerprint(parseVaultKey(Buffer.alloc(32, 8).toString("base64"))), id);
  assert.ok(!raw.toString("hex").toUpperCase().includes(id.replace("-", "")), "not a piece of the key");
});

test("the examples: admins see everything but no password, customers only names, addresses and server settings", () => {
  const admin = contractFixtures({ admin: true, customerNumber: null }).domainMail;
  assert.ok(admin.domains.every((domain) => domain.details), "admins see the details");
  assert.ok(admin.logins.length > 0 && admin.mailboxes.some((mailbox) => mailbox.hasPassword));
  assert.deepEqual(admin.vault, { keyReady: false, keyId: null, confirmed: false }, "examples never open a password");
  assert.ok(admin.mailServers.every((server) => typeof server.provider === "string"));
  const customer = contractFixtures({ admin: false, customerNumber: "KD-24017" }).domainMail;
  assert.ok(customer.domains.length > 0 && customer.domains.every((domain) => domain.customerId === "KD-24017" && !("details" in domain)));
  assert.ok(customer.mailboxes.length > 0 && customer.mailboxes.every((mailbox) => !("hasPassword" in mailbox)));
  assert.equal(customer.mailServers.length, 1);
  assert.ok(!("provider" in customer.mailServers[0]), "the provider stays internal");
  assert.deepEqual(customer.logins, []);
  assert.equal(customer.vault, null);
  assert.deepEqual(contractFixtures({ admin: false, customerNumber: "KD-24023" }).domainMail.mailServers, [], "OALAB Domain alone has no mail server");
});

test("passwords: every vault action checks aal2 and the admin first, logs each look before it leaves and talks to nobody else", async () => {
  const actions = await source("lib/hub-vault/actions.ts");
  const lines = actions.split("\n");
  const exported = lines.flatMap((line, index) => line.startsWith("export async function ") ? [{ name: line.match(/^export async function (\w+)/)[1], next: lines.slice(index + 1, index + 3) }] : []);
  assert.deepEqual(exported.map((action) => action.name), ["revealSecret", "saveSecret", "removeSecret", "saveLogin", "deleteLogin"]);
  for (const action of exported) {
    assert.match(action.next[0], /^ {2}const checked = await context\((true|false)\);$/, `${action.name} checks first`);
    assert.equal(action.next[1], "  if (!checked.ok) return checked;", action.name);
  }
  const contextBody = actions.slice(actions.indexOf("async function context("), actions.indexOf("/** Writes the admin log"));
  assert.ok(contextBody.indexOf('data.claims.aal !== "aal2"') > 0 && contextBody.indexOf('data.claims.aal !== "aal2"') < contextBody.indexOf("verifyHubAdmin()"), "aal2 before anything else");
  const reveal = actions.slice(actions.indexOf("export async function revealSecret"), actions.indexOf("export async function saveSecret"));
  assert.ok(reveal.indexOf("tooManyLooks(ctx)") > 0 && reveal.indexOf("await log(ctx,") < reveal.indexOf("return { ok: true, data: { secret } }"), "throttled, and logged before the password is returned");
  assert.match(reveal, /if \(!await log\(ctx, copy \? "vault\.copied" : "vault\.revealed", /);
  // The log never carries the password.
  for (const call of actions.matchAll(/await log\(ctx, [^;]+;/g)) assert.doesNotMatch(call[0], /secret(\.value)?[,)}]|typed\.value/, call[0]);
  for (const [path, text] of [["lib/hub-vault/actions.ts", actions], ["lib/hub-vault/crypto.ts", await source("lib/hub-vault/crypto.ts")], ["lib/hub-vault/key.ts", await source("lib/hub-vault/key.ts")]]) {
    assert.doesNotMatch(text, /hub-notify|hub-mail|hub-telegram|hub-assistant|hub-whatsapp/, `${path} reaches no messenger`);
    assert.doesNotMatch(text, /console\./, `${path} writes nothing to the server log`);
  }
  // The key is read in one place, on the server only.
  const everywhere = [...await sources("lib/hub-vault"), ...await sources("lib/hub-domains"), ...await sources("lib/hub-contracts"), ...await sources("components/hub/screens")];
  assert.deepEqual(everywhere.filter(([, text]) => /process\.env\.HUB_VAULT_KEY/.test(text)).map(([path]) => path), ["lib/hub-vault/key.ts"]);
  assert.match(await source("lib/hub-vault/key.ts"), /^import "server-only";/);
  assert.ok(!everywhere.some(([, text]) => /NEXT_PUBLIC_HUB_VAULT/.test(text)));
});

test("the page knows only whether a password exists; customers read with their own session the columns the database grants", async () => {
  const server = await source("lib/hub-domains/server.ts");
  assert.match(server, /db\.from\("hub_vault_secrets"\)\.select\("mailbox_id, login_id"\)/);
  assert.doesNotMatch(server, /ciphertext|auth_tag/);
  // The same columns as the grants of migration 202611050002 in service-oalab.
  const columns = (name) => server.match(new RegExp(`export const ${name} = "([^"]+)"`))[1].split(", ");
  assert.deepEqual(columns("CUSTOMER_DOMAIN_COLUMNS"), ["id", "customer_id", "domain"]);
  assert.deepEqual(columns("CUSTOMER_MAIL_SERVER_COLUMNS"), ["customer_id", "imap_host", "imap_port", "imap_security", "smtp_host", "smtp_port", "smtp_security", "webmail_url"]);
  assert.deepEqual(columns("CUSTOMER_MAILBOX_COLUMNS"), ["id", "customer_id", "address", "person", "kind", "target"]);
  const customerLoad = server.slice(server.indexOf("export async function loadDomainMailForCustomer"));
  assert.doesNotMatch(customerLoad, /ADMIN_|LOGIN_COLUMNS|hub_customer_logins|hub_vault_secrets/);
  const contracts = await source("lib/hub-contracts/server.ts");
  const customerPart = contracts.slice(contracts.indexOf("async function loadForCustomer"), contracts.indexOf("export async function loadContractsForIdentity"));
  assert.match(customerPart, /loadDomainMailForCustomer\(supabase, ids\)/, "with the login's own session");
  assert.match(contracts, /const confirmed = claims\?\.claims\?\.aal === "aal2";/);

  // Neither the assistant nor any notification ever reads the new tables or the vault.
  for (const dir of ["lib/hub-assistant", "lib/hub-notify", "lib/hub-mail", "lib/hub-telegram"]) {
    for (const [path, text] of await sources(dir)) assert.doesNotMatch(text, /hub_customer_(domains|mail_servers|mailboxes|logins)|hub_vault|hub-vault|hub-domains/, path);
  }
  // Inputs for passwords are no password fields in a form, so the browser does not keep them as the admin's own.
  const access = await source("components/hub/screens/contracts-access.tsx");
  assert.doesNotMatch(access, /type="password"|<form/);
  assert.match(access, /className=\{visible \? undefined : "is-masked"\}/);
  assert.match(await source("app/glass.css"), /\.dm-secret-field input\.is-masked \{ -webkit-text-security: disc; \}/);
  // Domain actions check the admin before anything; the vault is not theirs.
  const domainActions = await source("lib/hub-domains/actions.ts");
  const lines = domainActions.split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.startsWith("export async function ")) assert.deepEqual(lines.slice(index + 1, index + 3), ["  const ctx = await context();", "  if (!ctx) return denied;"], line);
  }
  assert.doesNotMatch(domainActions, /hub_vault_secrets"\)\.(insert|update|upsert)|sealSecret|openSecret/);
});

test("„Domain & Mail“ and „Zugangsdaten“ sit between „Vertrag“ and „Verlauf“; the overview lists domain renewals", async () => {
  const screen = await source("components/hub/screens/contracts.tsx");
  const tabs = [...screen.matchAll(/\{ id: "(\w+)", label: "[^"]+", name: /g)].map((match) => match[1]);
  assert.deepEqual(tabs, ["contract", "domains", "access", "timeline"]);
  assert.match(screen, /label: "Domain & Mail"/);
  assert.match(screen, /label: "Zugangsdaten"/);
  const overview = await source("components/hub/screens/contracts-overview.tsx");
  assert.match(overview, /const soon = upcoming\(state, asOf\)/);
  assert.match(overview, /renewingSoon\(state\.domainMail\.domains/);
  assert.match(screen, /<CustomerContractSheet customer=\{customer\} state=\{state\} files=\{fileState\.files\} preview=\{preview\} \/>/);
});
