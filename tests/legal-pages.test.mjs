import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { OPERATOR, PRIVACY_POLICY_DATE } from "../lib/legal-details.ts";
import { LEGAL_PATHS, legalMailLinks } from "../lib/legal-links.ts";
import { PUBLIC_DEMO_COOKIE } from "../lib/public-demo-policy.ts";
import { AUTH_COOKIE_NAME } from "../lib/supabase/cookies.ts";

// Windows checkouts may carry CRLF line endings; the source checks below compare LF text.
const source = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

const LIVE = { imprint: "https://hub.oalab.de/impressum", privacy: "https://hub.oalab.de/datenschutz" };

test("imprint and privacy policy are the hub's own pages, open to everyone", async () => {
  assert.deepEqual(LEGAL_PATHS, { imprint: "/impressum", privacy: "/datenschutz" });
  assert.match(await source("app/impressum/page.tsx"), /export default function ImprintPage/);
  assert.match(await source("app/datenschutz/page.tsx"), /export default function PrivacyPage/);
  // Public like the sign-in pages: no login, no redirect for a login that still owes its code.
  assert.match(await source("lib/supabase/proxy.ts"), /const isPublic = [^;]*\|\| pathname === LEGAL_PATHS\.imprint \|\| pathname === LEGAL_PATHS\.privacy\n/);
});

test("mails link both pages absolutely, on the hub's https address", async () => {
  assert.deepEqual(legalMailLinks({ NEXT_PUBLIC_SITE_URL: " https://hub.oalab.de/ " }), LIVE);
  assert.deepEqual(legalMailLinks({ NEXT_PUBLIC_SITE_URL: "https://oalab-client-hub.vercel.app" }).privacy, "https://oalab-client-hub.vercel.app/datenschutz");
  // Without an https origin the links still lead to the live hub.
  for (const value of [undefined, "", "http://localhost:3000", "javascript:alert(1)", "https://hub.oalab.de/pfad"]) {
    assert.deepEqual(legalMailLinks({ NEXT_PUBLIC_SITE_URL: value }), LIVE, String(value));
  }
  assert.match(await source("lib/hub-mail/send.ts"), /legal: legalMailLinks\(\),/);
});

test("every way in: footers, the account menu, Mehr and the profile, two clicks from any page", async () => {
  const links = await source("components/legal-links.tsx");
  assert.match(links, /<Link href=\{LEGAL_PATHS\.imprint\}>Impressum<\/Link>/);
  assert.match(links, /<Link href=\{LEGAL_PATHS\.privacy\}>Datenschutz<\/Link>/);
  // Never hidden behind a setting.
  assert.doesNotMatch(links, /return null/);
  for (const file of ["components/auth-frame.tsx", "app/not-found.tsx", "components/legal/legal-page.tsx"]) {
    assert.match(await source(file), /<LegalLinks className="legal-links auth-legal-links" \/>/, file);
  }
  const sidebar = await source("components/hub/glass-sidebar.tsx");
  for (const key of ["imprint", "privacy"]) assert.match(sidebar, new RegExp(`<Link role="menuitem" href=\\{LEGAL_PATHS\\.${key}\\}`), key);
  const workspace = await source("components/hub/screens/workspace.tsx");
  assert.match(workspace, /<SectionHeader title="Rechtliches" \/>/);
  assert.match(workspace, /<ListRow compact href=\{LEGAL_PATHS\.imprint\} .* title="Impressum" \/>/);
  assert.match(workspace, /<ListRow compact href=\{LEGAL_PATHS\.privacy\} .* title="Datenschutz" \/>/);
  assert.match(workspace, /<LegalLinks className="legal-links hub-legal-links" \/>/);
});

test("the imprint follows § 5 DDG, without the outdated references of older texts", async () => {
  const imprint = await source("app/impressum/page.tsx");
  const policy = await source("components/legal/privacy-policy.tsx");
  assert.match(imprint, /§ 5 Digitale-Dienste-Gesetz \(DDG\)/);
  for (const key of ["name", "partners", "street", "city", "country", "phone", "email", "vatId"]) assert.match(imprint, new RegExp(`OPERATOR\\.${key}`), key);
  assert.match(imprint, /an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen/);
  // TMG and RStV are replaced (DDG, MStV); the EU platform for online dispute resolution is gone since July 2025.
  for (const text of [imprint, policy]) assert.doesNotMatch(text, /TMG|Telemediengesetz|RStV|ec\.europa\.eu\/consumers\/odr|OS-Plattform|Online-Streitbeilegung/);
  assert.equal(OPERATOR.vatId, "DE451293303");
  assert.equal(OPERATOR.email, "info@oalab.de");
});

test("the privacy policy names every service the hub uses and carries its date", async () => {
  const policy = await source("components/legal/privacy-policy.tsx");
  for (const name of ["Vercel Inc.", "Supabase Pte. Ltd.", "netcup GmbH", "Anthropic Ireland, Limited", "Telegram Messenger Inc.", "Landesbeauftragte für Datenschutz und Informationsfreiheit Nordrhein-Westfalen"]) {
    assert.ok(policy.includes(name), name);
  }
  // The cookies it names are the ones the code sets.
  for (const cookie of [AUTH_COOKIE_NAME, PUBLIC_DEMO_COOKIE]) assert.ok(policy.includes(cookie), cookie);
  // Telegram as it is meant to run with real customers: the company name and a link only. During the internal test
  // phase lib/hub-telegram still sends the whole message (decision of 4.11.2026); switch it back before real
  // customer data arrives (README, "Telegram für Admins").
  assert.match(policy, /Die Meldung enthält nur den Namen des Unternehmens und einen Link in den Hub, keine Namen von Personen und nicht den Text\./);
  // The objection right stands apart; no automated decisions.
  assert.match(policy, /<strong>Widerspruchsrecht nach Art\. 21 DSGVO:<\/strong>/);
  assert.match(policy, /automatisierte Entscheidungen nach Art\. 22 DSGVO gibt es nicht/);
  assert.match(PRIVACY_POLICY_DATE, /^\d{1,2}\. (Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember) 20\d\d$/);
  assert.match(await source("app/datenschutz/page.tsx"), /stand=\{PRIVACY_POLICY_DATE\}/);
  // Each entry of the table of contents has exactly one section.
  const ids = [...policy.matchAll(/\{ id: "([a-z-]+)", title: /g)].map((match) => match[1]);
  assert.equal(ids.length, 13);
  for (const id of ids) assert.equal(policy.split(`<LegalSection id="${id}"`).length - 1, 1, id);
});

test("customers read at the chat that Telegram hears of new messages, with the way to the details", async () => {
  const chat = await source("components/hub/screens/private-chat.tsx");
  assert.match(chat, /neue Nachrichten meldet der Hub unserem Team auch über Telegram, ohne den Text\. <Link href=\{`\$\{LEGAL_PATHS\.privacy\}#nachrichten`\}>Mehr dazu<\/Link>/);
  assert.match(await source("components/legal/privacy-policy.tsx"), /\{ id: "nachrichten", title: /);
});
