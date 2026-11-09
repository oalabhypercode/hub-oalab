import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  checkLogins, customerLoginState, INVITE_BATCH, isFirstInvitation, isInvitable, LOGIN_BATCH, loginDrafts, loginStateLabels,
} from "../lib/hub-invitations/rules.ts";
import { guessMapping, parseCsv, readContacts } from "../lib/hub-customer-import/rules.ts";
import { cleanEmail, normalizeCompany, readPerson } from "../lib/hub-users/rules.ts";
import { ACTIVATION_LINK_HOURS, LINK_HOURS, linkHours } from "../lib/platform/config.ts";
import { formatLinkUntil, passwordLinkMail } from "../lib/hub-mail/templates.ts";

const source = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

/** The hub's rules for a login's address and names, as the dialog passes them in. */
const checks = {
  email: (email) => (cleanEmail(email).ok ? null : "invalid"),
  person: (firstName, lastName) => {
    const person = readPerson({ firstName, lastName, phone: "", position: "" });
    return person.ok ? null : person.error;
  },
};

const customer = (id, company, extra = {}) => ({ id, kind: "customer", customerNumber: `OA-${id}`, company, contactEmail: "", memberIds: [], ...extra });

test("every customer without a login gets one row, the contact person of the file first", () => {
  const customers = [
    customer("1003", "Nalbach & Hinkel GmbH", { contactEmail: "info@nh.example" }),
    customer("1002", "KalaClo", { contactEmail: "Kontakt@KalaClo.example" }),
    customer("1001", "AP Beckum", { memberIds: ["u1"] }),
    customer("FL-1", "Freelancer GbR", { kind: "freelancer" }),
    customer("1004", "Ohne Adresse"),
  ];
  const contacts = { "OA-1003": { firstName: "Max", lastName: "Muster", email: "max@nh.example", line: 3 }, "OA-1002": { firstName: "Lea", lastName: "Kala", email: "", line: 4 } };
  const rows = loginDrafts(customers, (item) => contacts[item.customerNumber] ?? null);
  assert.deepEqual(rows.map((row) => row.company), ["KalaClo", "Nalbach & Hinkel GmbH", "Ohne Adresse"], "only customers without a login, by name");
  const [kala, nh, none] = rows;
  assert.deepEqual([nh.firstName, nh.lastName, nh.email, nh.source], ["Max", "Muster", "max@nh.example", "file"], "the person's own address wins");
  assert.deepEqual([kala.firstName, kala.email, kala.source], ["Lea", "kontakt@kalaclo.example", "customer"], "without one, the customer's address with the person's names");
  assert.deepEqual([none.email, none.source], ["", ""]);
});

test("what stands in the way of a login, row by row", () => {
  const draft = (company, firstName, lastName, email) => ({ customerId: company, company, customerNumber: "OA-1", firstName, lastName, email, source: "customer" });
  const rows = checkLogins([
    draft("A", "Max", "Muster", "MAX@a.example "),
    draft("B", "Eva", "Beispiel", "max@a.example"),
    draft("C", "Tom", "Test", "schon@da.example"),
    draft("D", "", "", "d@d.example"),
    draft("E", "Ann", "Ok", "kein-mail"),
    draft("F", "Ann", "Ok", ""),
    draft("G", "R2D2", "Bot", "g@g.example"),
  ], new Set(["schon@da.example"]), checks);
  assert.deepEqual(rows.map((row) => row.problem), [
    null,
    "Dieselbe Adresse wie bei „A“",
    "Für diese Adresse gibt es schon einen Zugang",
    "Vor- und Nachname fehlen",
    "Keine gültige E-Mail-Adresse",
    "E-Mail-Adresse fehlt",
    "Bitte den Vornamen nur mit Buchstaben angeben.",
  ]);
  assert.equal(rows[0].email, "max@a.example", "addresses are compared and sent in lower case");
});

test("the contact persons of the Sevdesk export, by number and by company", () => {
  const table = parseCsv([
    "Kunden-Nr.;Kategorie;Name;Vorname;Nachname;E-Mail",
    "1003;Kunde;Nalbach & Hinkel GmbH;;;info@nh.example",
    "1004;Kunde;Nalbach & Hinkel GmbH;Max;Muster;",
    "1005;Kunde;Nalbach & Hinkel GmbH;Eva;Beispiel;Eva@NH.example",
    ";Kunde;;Erika;Probe;erika@example.de",
  ].join("\n"));
  const contacts = readContacts(table, guessMapping(table[0]), normalizeCompany);
  assert.deepEqual(contacts.byCompany.get(normalizeCompany("Nalbach & Hinkel")), { firstName: "Eva", lastName: "Beispiel", email: "eva@nh.example", line: 4 }, "a person with an address wins");
  assert.equal(contacts.byNumber.get("OA-1004").firstName, "Max");
  assert.equal(contacts.byNumber.has("OA-1003"), false, "the company's own row is no person");
  assert.equal(contacts.byCompany.get(normalizeCompany("Erika Probe")).email, "erika@example.de", "a person without a company, under their name like the import");
});

test("how far a customer is, and who gets an invitation", () => {
  assert.deepEqual(customerLoginState([]), { state: "none", lastSignInAt: null });
  assert.deepEqual(customerLoginState([{ lastSignInAt: null, invitedAt: null }]), { state: "created", lastSignInAt: null });
  assert.deepEqual(customerLoginState([{ lastSignInAt: null, invitedAt: "2026-11-11T08:00:00Z" }]), { state: "invited", lastSignInAt: null });
  assert.deepEqual(customerLoginState([{ lastSignInAt: "2026-11-12T08:00:00Z", invitedAt: null }, { lastSignInAt: "2026-11-13T09:00:00Z", invitedAt: null }]), { state: "active", lastSignInAt: "2026-11-13T09:00:00Z" });
  assert.deepEqual(Object.values(loginStateLabels), ["kein Zugang", "Zugang angelegt", "eingeladen", "aktiv"]);
  assert.ok(isInvitable({ id: "a", displayStatus: "invited", invitedAt: null }));
  assert.ok(!isInvitable({ id: "c", displayStatus: "active", invitedAt: null }), "never someone who signed in");
  assert.ok(isFirstInvitation({ id: "a", displayStatus: "invited", invitedAt: null }));
  assert.ok(!isFirstInvitation({ id: "d", displayStatus: "invited", invitedAt: "2026-11-11T08:00:00Z" }), "a reminder is ticked on purpose");
  assert.equal(LOGIN_BATCH, 10);
  assert.equal(INVITE_BATCH, 10);
});

test("an activation link lives a week, a reset a day, and the mail says until when", () => {
  assert.equal(ACTIVATION_LINK_HOURS, 168);
  assert.equal(LINK_HOURS, 24);
  assert.equal(linkHours("recovery", false), 168, "never signed in: the first link");
  assert.equal(linkHours("recovery", true), 24, "a reset after the first sign-in");
  assert.equal(linkHours("magiclink", false), 24);
  assert.equal(formatLinkUntil(new Date("2026-11-18T19:15:00Z")), "Mittwoch, 18. November 2026, 20:15 Uhr");
  const mail = passwordLinkMail({ firstName: "Ben", link: "https://hub.oalab.de/auth/confirm?token_hash=x", activation: true, validUntil: new Date("2026-11-18T19:15:00Z") });
  assert.match(mail.text, /^Link gültig bis: Mittwoch, 18\. November 2026, 20:15 Uhr$/m);
  assert.doesNotMatch(passwordLinkMail({ firstName: "Ben", link: "https://hub.oalab.de/x", activation: true }).text, /gültig bis/, "without a known end the old wording stays");
});

test("the platform and the actions use these rules", async () => {
  const auth = await source("lib/platform/auth.ts");
  assert.match(auth, /linkIdentifier\(kind, token\), JSON\.stringify\(\{ userId: user\.id \}\), linkHours\(kind, Boolean\(user\.last_sign_in_at\)\),/);
  assert.doesNotMatch(auth, /const LINK_HOURS/);

  const actions = await source("lib/hub-users/actions.ts");
  const body = (name) => {
    const start = actions.indexOf(`export async function ${name}`);
    return actions.slice(start, actions.indexOf("\n}\n", start));
  };
  const logins = body("createCustomerLogins");
  assert.match(logins, /const ctx = await context\(\);\s*if \(!ctx\) return denied;/, "admins only");
  assert.match(logins, /rows\.length > LOGIN_BATCH/);
  assert.match(logins, /addLogin\(ctx, \{ email: email\.value, person: person\.value, role: "oalab_customer", customer: \{ mode: "existing", customerId \}, withLink: false \}\)/);
  assert.doesNotMatch(logins, /mailPasswordLink|passwordLink\(/, "no mail and no link when creating");

  const invite = body("sendInvitations");
  assert.match(invite, /if \(!mailSettings\(\)\.configured\) return failed\(/, "nothing starts without a mail server");
  assert.match(invite, /ids\.length > INVITE_BATCH/);
  assert.match(invite, /if \(user\.last_sign_in_at\) \{ results\.push\(\{ userId, outcome: "skipped"/, "only logins that never signed in");
  assert.doesNotMatch(invite, /isDemoUser|demo/i, "the demo logins are gone (9.11.2026)");
  assert.match(invite, /mailPasswordLink\(ctx\.db, user, \{ firstName: await firstNameOf\(ctx, user\.id\), link, activation: true, validUntil: activationUntil\(\) \}\)/);

  // „Zugang anlegen“ and „Zugänge anlegen“ share the steps of a new login.
  assert.match(body("createHubUser"), /const added = await addLogin\(ctx, \{ email: email\.value, person: person\.value, role, customer: input\.customer, withLink: true \}\);/);
  assert.match(actions, /const activationUntil = \(\) => usesOwnPlatform\(\) \? new Date\(Date\.now\(\) \+ ACTIVATION_LINK_HOURS \* 60 \* 60 \* 1000\) : null;/);

  const server = await source("lib/hub-users/server.ts");
  assert.match(server, /\.eq\("kind", "user\.activation"\)\.eq\("status", "sent"\)/, "invited means a mail really went out");
});

test("the User Management shows roles, states and the two bulk windows", async () => {
  const screen = await source("components/hub/screens/users.tsx");
  assert.match(screen, /<th scope="col">Rolle<\/th>/);
  assert.match(screen, /<td className="cell-role">\{user\.role \? roleLabels\[user\.role\] : <span className="cell-none">–<\/span>\}<\/td>/);
  assert.match(screen, /customerLoginState\(users\.filter\(\(user\) => customer\.memberIds\.includes\(user\.id\)\)\)/);
  assert.match(screen, /<SortHeader option=\{customerSorts\.login\} className="col-login"/);
  assert.match(screen, /dialog\?\.kind === "logins" && <CustomerLoginsDialog customers=\{customers\} users=\{users\}/);
  assert.match(screen, /dialog\?\.kind === "invite" && <InvitationsDialog users=\{users\} customers=\{entries\} mailConfigured=\{state\.mailConfigured\}/);
  const dialogs = await source("components/hub/screens/users-logins.tsx");
  assert.match(dialogs, /createCustomerLogins\(\{ rows: batch \}\)/);
  assert.match(dialogs, /sendInvitations\(\{ userIds: batch \}\)/);
  assert.match(dialogs, /disabled=\{!selected\.length \|\| running \|\| !mailConfigured\}/, "no sending without a mail server");
  assert.match(dialogs, /new Set\(users\.filter\(isFirstInvitation\)\.map\(\(user\) => user\.id\)\)/, "the never invited start ticked");
  const knowledge = await source("lib/hub-assistant/knowledge.ts");
  for (const title of ["Zugänge anlegen", "Einladungen", "Zugänge, Kunden und Freelancer"]) assert.match(knowledge, new RegExp(`^- ${title} \\(nur Admin\\): `, "m"), title);
});
