import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ANNOUNCE_DAYS_AHEAD, announceDays, berlinDayKey, checkLogins, customerLoginState, INVITE_BATCH, isAnnounceable, isFirstAnnouncement, isFirstInvitation, isFirstReminder, isInvitable,
  isRemindable, LAUNCH_DAY, launchDays, LOGIN_BATCH, loginDrafts, loginStateLabels, readAnnounceDay, readLaunchDay,
  isFirstStartMail, isStartMailKind, START_MAILS, startMailAction, suggestedStartMail,
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

test("the announcement goes to customer logins without sign-in, for a day within the coming week", () => {
  const login = (extra = {}) => ({ id: "a", displayStatus: "invited", invitedAt: null, role: "oalab_customer", announcedAt: null, ...extra });
  assert.ok(isAnnounceable(login()));
  assert.ok(!isAnnounceable(login({ role: "oalab_freelancer" })), "freelancers have neither projects nor contracts");
  assert.ok(!isAnnounceable(login({ role: "oalab_admin" })));
  assert.ok(!isAnnounceable(login({ displayStatus: "active" })), "never someone who signed in");
  assert.ok(isFirstAnnouncement(login()));
  assert.ok(!isFirstAnnouncement(login({ announcedAt: "2026-11-10T08:00:00Z" })), "a second announcement is ticked on purpose");
  assert.ok(!isFirstAnnouncement(login({ invitedAt: "2026-11-09T08:00:00Z" })), "an invited login needs no announcement");

  // 23:30 UTC on 10 November is already Wednesday, 11 November, in Berlin.
  const now = new Date("2026-11-10T23:30:00Z");
  assert.equal(berlinDayKey(now), "2026-11-11");
  assert.equal(ANNOUNCE_DAYS_AHEAD, 6, "within a week the weekday names the day");
  assert.deepEqual(announceDays(now), { min: "2026-11-11", max: "2026-11-17", suggested: "2026-11-12" });
  assert.equal(readAnnounceDay("2026-11-11", now)?.toISOString(), "2026-11-11T12:00:00.000Z");
  assert.equal(readAnnounceDay("2026-11-17", now)?.toISOString(), "2026-11-17T12:00:00.000Z");
  for (const bad of ["2026-11-10", "2026-11-18", "11.11.2026", "2026-11-1", "", null, 20261112]) assert.equal(readAnnounceDay(bad, now), null, String(bad));
  // Across the end of a month.
  assert.deepEqual(announceDays(new Date("2026-11-28T10:00:00Z")), { min: "2026-11-28", max: "2026-12-04", suggested: "2026-11-29" });
});

test("the reminder before the start goes to every customer login, signed in or not yet, for a day from tomorrow on", () => {
  const login = (extra = {}) => ({ id: "a", displayStatus: "active", invitedAt: null, role: "oalab_customer", remindedAt: null, ...extra });
  assert.ok(isRemindable(login()), "signed in already");
  assert.ok(isRemindable(login({ displayStatus: "invited" })), "still waiting for the first sign-in");
  for (const displayStatus of ["pending", "disabled", "rejected"]) assert.ok(!isRemindable(login({ displayStatus })), displayStatus);
  for (const role of ["oalab_freelancer", "oalab_admin", null]) assert.ok(!isRemindable(login({ role })), String(role));
  assert.ok(isFirstReminder(login()));
  assert.ok(!isFirstReminder(login({ remindedAt: "2026-11-23T15:00:00Z" })), "a second reminder is ticked on purpose");

  // Monday, 23 November 2026: the start on Wednesday lies ahead and is suggested; today is never the day of the start.
  const monday = new Date("2026-11-23T15:00:00Z");
  assert.equal(LAUNCH_DAY, "2026-11-25");
  assert.deepEqual(launchDays(monday), { min: "2026-11-24", max: "2026-11-29", suggested: "2026-11-25" });
  assert.equal(readLaunchDay("2026-11-25", monday)?.toISOString(), "2026-11-25T12:00:00.000Z");
  for (const bad of ["2026-11-23", "2026-11-30", "25.11.2026", "2026-11-2", "", null]) assert.equal(readLaunchDay(bad, monday), null, String(bad));
  // 23:30 UTC on Monday is Tuesday in Berlin; from the day of the start on, tomorrow is suggested.
  assert.deepEqual(launchDays(new Date("2026-11-23T23:30:00Z")), { min: "2026-11-25", max: "2026-11-30", suggested: "2026-11-25" });
  assert.deepEqual(launchDays(new Date("2026-11-25T08:00:00Z")), { min: "2026-11-26", max: "2026-12-01", suggested: "2026-11-26" });
});

test("the start mails go one at a time to customer logins that still want info mails", () => {
  assert.deepEqual(START_MAILS.map((mail) => [mail.kind, mail.day]), [["launch", "2026-11-26"], ["service", "2026-12-04"], ["hub", "2026-12-11"], ["outlook", "2026-12-18"]]);
  assert.ok(START_MAILS.every((mail) => isStartMailKind(mail.kind)));
  for (const bad of ["", "Start", "reminder", null, undefined, 1]) assert.ok(!isStartMailKind(bad), String(bad));
  assert.equal(startMailAction("service"), "user.start_mail.service");

  // The window opens on the newest mail whose day has come, in Berlin time.
  assert.equal(suggestedStartMail(new Date("2026-11-26T09:00:00Z")), "launch");
  assert.equal(suggestedStartMail(new Date("2026-12-03T22:59:00Z")), "launch", "still Thursday in Berlin");
  assert.equal(suggestedStartMail(new Date("2026-12-03T23:30:00Z")), "service", "Friday has begun in Berlin");
  assert.equal(suggestedStartMail(new Date("2026-12-11T10:00:00Z")), "hub");
  assert.equal(suggestedStartMail(new Date("2027-01-20T10:00:00Z")), "outlook");
  assert.equal(suggestedStartMail(new Date("2026-11-20T10:00:00Z")), "launch", "before the start the launch mail");

  const login = (extra = {}) => ({ id: "a", displayStatus: "active", invitedAt: null, role: "oalab_customer", remindedAt: null, startMails: {}, infoMails: true, ...extra });
  assert.ok(isFirstStartMail(login(), "launch"));
  assert.ok(isFirstStartMail(login({ displayStatus: "invited" }), "launch"), "not activated yet gets it too");
  assert.ok(!isFirstStartMail(login({ startMails: { launch: "2026-11-26T10:00:00Z" } }), "launch"), "has it already");
  assert.ok(isFirstStartMail(login({ startMails: { launch: "2026-11-26T10:00:00Z" } }), "service"), "the next one is still due");
  assert.ok(!isFirstStartMail(login({ infoMails: false }), "launch"), "stopped the info mails");
  assert.ok(!isFirstStartMail(login({ role: "oalab_freelancer" }), "launch"), "customers only");
  assert.ok(!isFirstStartMail(login({ displayStatus: "disabled" }), "launch"), "never deactivated logins");
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

  // „Erinnerung senden“: admins only, customer logins that are active, the version by the first sign-in, in the admin log.
  const remind = body("sendLaunchReminders");
  assert.match(remind, /const ctx = await context\(\);\s*if \(!ctx\) return denied;/, "admins only");
  assert.match(remind, /if \(!mailSettings\(\)\.configured\) return failed\(/, "nothing starts without a mail server");
  assert.match(remind, /ids\.length > INVITE_BATCH/);
  assert.match(remind, /if \(roleOf\(user\) !== "oalab_customer"\) \{ results\.push\(\{ userId, outcome: "skipped"/, "customer logins only");
  assert.match(remind, /if \(await profileStatus\(ctx, user\.id\) !== "active"\) \{ results\.push\(\{ userId, outcome: "skipped"/, "never deactivated, rejected or waiting ones");
  assert.match(remind, /mailLaunchReminder\(user\.email, \{ \.\.\.reminder, active: Boolean\(user\.last_sign_in_at\) \}\)/, "the version follows the first sign-in");
  assert.match(remind, /mail === "sent" \? "user\.launch_reminder" : "user\.launch_reminder_failed"/);
  assert.match(body("sendLaunchReminderTest"), /for \(const active of \[true, false\]\) \{\s*const mail = await mailLaunchReminder\(admin\.email, \{ \.\.\.reminder, active, test: true \}\);/, "the admin gets both versions");

  const server = await source("lib/hub-users/server.ts");
  assert.match(server, /\.eq\("kind", "user\.activation"\)\.eq\("status", "sent"\)/, "invited means a mail really went out");
  assert.match(server, /\.in\("action", \["user\.announcement", "user\.launch_reminder", \.\.\.START_MAIL_ACTIONS\]\)/, "announced, reminded and the start mails come from the admin log");
  assert.match(server, /const seen = row\.action === "user\.launch_reminder" \? remindedAt : announcedAt;/);
  assert.match(server, /const START_MAIL_ACTIONS = START_MAILS\.map\(\(mail\) => startMailAction\(mail\.kind\)\);/);
  assert.match(server, /startMails: startMails\.get\(user\.id\) \?\? \{\},\n\s*infoMails: infoMailsWanted\(user\.user_metadata\),/);

  // „Startmails senden“: admins only, a mail server and the key for the opt-out links, customer logins that are active
  // and still want info mails, the version by the first sign-in, in the admin log under its own kind.
  const start = body("sendStartMails");
  assert.match(start, /const ctx = await context\(\);\s*if \(!ctx\) return denied;/, "admins only");
  assert.match(start, /if \(!mailSettings\(\)\.configured\) return failed\(/, "nothing starts without a mail server");
  assert.match(start, /const setup = await startMailInput\(input\?\.kind\);\s*if \(!setup\.ok\) return setup;/);
  assert.match(start, /ids\.length > INVITE_BATCH/);
  assert.match(start, /if \(roleOf\(user\) !== "oalab_customer"\) \{ results\.push\(\{ userId, outcome: "skipped"/, "customer logins only");
  assert.match(start, /if \(await profileStatus\(ctx, user\.id\) !== "active"\) \{ results\.push\(\{ userId, outcome: "skipped"/);
  assert.match(start, /if \(!infoMailsWanted\(user\.user_metadata\)\) \{ results\.push\(\{ userId, outcome: "skipped", error: "Hat die Infomails abbestellt\." \}\); continue; \}/, "who stopped them gets none");
  assert.match(start, /mailStartSeries\(user\.email, \{ \.\.\.setup\.data, userId: user\.id, active: Boolean\(user\.last_sign_in_at\) \}\)/, "each login gets its own link, the version follows the first sign-in");
  assert.match(start, /mail === "sent" \? startMailAction\(kind\) : "user\.start_mail_failed"/);
  assert.match(actions, /if \(!secret\) return failed\("Der Schlüssel für die Abmelde-Links fehlt auf dem Server \(HUB_NOTIFY_TOKEN\)\. Ohne ihn geht keine Infomail raus\."\);/, "no info mail without its way to object");
  assert.match(body("sendStartMailTest"), /for \(const active of \[true, false\]\) \{\s*const mail = await mailStartSeries\(admin\.email, \{ \.\.\.setup\.data, userId: admin\.id, active, test: true \}\);/, "the admin gets both versions");
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
  assert.match(screen, /dialog\?\.kind === "remind" && <LaunchRemindersDialog users=\{users\} customers=\{entries\} mailConfigured=\{state\.mailConfigured\}/);
  assert.match(dialogs, /sendLaunchReminders\(\{ userIds: batch, day \}\)/);
  assert.match(dialogs, /new Set\(users\.filter\(isFirstReminder\)\.map\(\(user\) => user\.id\)\)/, "the ones without a reminder start ticked");
  assert.match(dialogs, /const range = useMemo\(\(\) => launchDays\(new Date\(\)\), \[\]\);/);
  const knowledge = await source("lib/hub-assistant/knowledge.ts");
  for (const title of ["Zugänge anlegen", "Einladungen", "Zugänge, Kunden und Freelancer"]) assert.match(knowledge, new RegExp(`^- ${title} \\(nur Admin\\): `, "m"), title);
});
