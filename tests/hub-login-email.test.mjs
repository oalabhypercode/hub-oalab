import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { hasMailbox, maskEmail } from "../lib/hub-auth/mail-code.ts";
import { MAIL_IMAGES } from "../lib/hub-mail/images.ts";
import { loginEmailChangedMail } from "../lib/hub-mail/templates.ts";
import { emailChangeMailNote, readNewLoginEmail } from "../lib/hub-users/rules.ts";

// An admin changes the e-mail address of an existing login (User Management › Zugang › Profil, 23.11.2026).

// Windows checkouts may carry CRLF line endings; the source checks below compare LF text.
const source = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
/** A top-level function of a source file, from its start to its closing brace. */
function block(text, start) {
  const from = text.indexOf(start);
  assert.ok(from >= 0, start);
  return text.slice(from, text.indexOf("\n}\n", from) + 2);
}

const change = { next: " Jana.Neu@OALAB.de ", current: "jana@nordlicht.example", self: false, status: "active", needsMailbox: false, mailbox: hasMailbox };

test("a new address is checked before anything changes", () => {
  assert.deepEqual(readNewLoginEmail(change), { ok: true, value: "jana.neu@oalab.de" });
  // The admin's own login, a waiting registration, an invalid or the same address are refused.
  assert.match(readNewLoginEmail({ ...change, self: true }).error, /anderer Admin/);
  assert.match(readNewLoginEmail({ ...change, status: "pending" }).error, /„Prüfen“/);
  for (const next of ["", "jana@", "jana neu@oalab.de", "jana@oalab", { email: "jana@oalab.de" }]) assert.equal(readNewLoginEmail({ ...change, next }).ok, false, String(next));
  assert.match(readNewLoginEmail({ ...change, next: " JANA@Nordlicht.example" }).error, /schon die Adresse/);
  // Deactivated and rejected logins may get another address; they only get no info mail.
  for (const status of ["disabled", "rejected", null]) assert.equal(readNewLoginEmail({ ...change, status }).ok, true, String(status));
  // A login that gets sign-in codes by e-mail needs a real mailbox; any other may keep a test address.
  assert.equal(readNewLoginEmail({ ...change, next: "jana@neu.example" }).ok, true);
  assert.match(readNewLoginEmail({ ...change, next: "jana@neu.example", needsMailbox: true }).error, /Testadresse ohne Postfach/);
  assert.equal(readNewLoginEmail({ ...change, needsMailbox: true }).ok, true);
});

test("notice and admin log say which info mails went out, never to whom", () => {
  assert.equal(emailChangeMailNote({ toNew: null, toOld: null }), "");
  assert.equal(emailChangeMailNote({ toNew: "sent", toOld: "sent" }), "Info-Mail an die neue und die alte Adresse verschickt");
  assert.equal(emailChangeMailNote({ toNew: "sent", toOld: null }), "Info-Mail an die neue Adresse verschickt");
  assert.equal(emailChangeMailNote({ toNew: "sent", toOld: "failed" }), "Info-Mail an die neue Adresse verschickt, Info-Mail an die alte Adresse ging nicht raus");
  assert.equal(emailChangeMailNote({ toNew: "failed", toOld: "failed" }), "Info-Mail an die neue und die alte Adresse ging nicht raus");
  assert.equal(emailChangeMailNote({ toNew: "skipped", toOld: "skipped" }), "Info-Mail nicht verschickt (Mailversand nicht eingerichtet)");
});

const mail = { firstName: "Jana", email: "jana.neu@oalab.de", previous: "jana@nordlicht.example", activated: true, serviceToo: true, hubUrl: "https://hub.oalab.de" };

test("the new address learns how to sign in now, in the hub and on the service platform", () => {
  const fresh = loginEmailChangedMail({ ...mail, to: "new" });
  assert.equal(fresh.subject, "Dein oalab-Zugang läuft jetzt über diese Adresse");
  assert.ok(fresh.text.includes("Hallo Jana, dein oalab-Team hat deinen Zugang auf diese E-Mail-Adresse umgestellt. Ab sofort meldest du dich nur noch mit ihr an, im Client Hub und auf der Serviceplattform."));
  for (const line of ["Anmeldung mit: jana.neu@oalab.de", "Bisher: jana@nordlicht.example", "Passwort: bleibt gleich", "Zum Client Hub: https://hub.oalab.de/auth/login"]) assert.ok(fresh.text.includes(line), line);
  assert.match(fresh.text, /überall abgemeldet/);
  assert.match(fresh.html, /<a href="https:\/\/hub\.oalab\.de\/auth\/login"/);
  // Before the first sign-in the button leads to „Passwort vergessen?“, which mails a fresh link to the new address.
  const waiting = loginEmailChangedMail({ ...mail, to: "new", activated: false });
  for (const line of ["Status: Noch nicht aktiviert", "Zugang aktivieren: https://hub.oalab.de/auth/forgot-password"]) assert.ok(waiting.text.includes(line), line);
  assert.match(waiting.text, /Ältere Aktivierungslinks gelten nicht mehr/);
  assert.doesNotMatch(waiting.text, /bleibt gleich|abgemeldet/);
  // Freelancers work in the hub only.
  assert.doesNotMatch(loginEmailChangedMail({ ...mail, to: "new", serviceToo: false }).text, /Serviceplattform/);
  // Without a usable hub address there is no button rather than a broken one; typed values stay escaped.
  assert.doesNotMatch(loginEmailChangedMail({ ...mail, to: "new", hubUrl: "javascript:alert(1)" }).html, /javascript:|Zum Client Hub/);
  const odd = loginEmailChangedMail({ ...mail, to: "new", firstName: "<b>Jana</b>", email: "jana&co@oalab.de" });
  assert.doesNotMatch(odd.html, /<b>Jana/);
  assert.match(odd.html, /jana&amp;co@oalab\.de/);
});

test("the old address gets a security notice that shows the new address only shortened", () => {
  const notice = loginEmailChangedMail({ ...mail, to: "old", email: maskEmail(mail.email) });
  assert.equal(notice.subject, "Dein oalab-Zugang hat eine neue E-Mail-Adresse");
  for (const line of ["Bisher: jana@nordlicht.example", "Jetzt: ja***@oalab.de", "Du hast das nicht veranlasst? Dann antworte bitte sofort auf diese E-Mail."]) assert.ok(notice.text.includes(line), line);
  assert.ok(!notice.html.includes(mail.email) && !notice.text.includes(mail.email));
  assert.match(notice.text, /nicht mehr an, weder im Client Hub noch auf der Serviceplattform\./);
  assert.doesNotMatch(loginEmailChangedMail({ ...mail, to: "old", email: "ja***@oalab.de", serviceToo: false }).text, /Serviceplattform/);
  // Nothing to click: the answer is a reply.
  assert.doesNotMatch(notice.html, /<a href="https:/);
  for (const content of [notice, loginEmailChangedMail({ ...mail, to: "new" })]) {
    const shown = [...new Set([...content.html.matchAll(/src="cid:([a-z0-9-]+)@hub\.oalab\.de"/g)].map((match) => match[1]))];
    assert.deepEqual([...content.images].sort(), shown.sort());
    for (const id of content.images) assert.ok(Object.hasOwn(MAIL_IMAGES, id), id);
  }
  assert.ok(notice.images.includes("area-security"));
});

test("only an admin changes an address, in one step with the sessions and the links of the old one", async () => {
  const auth = await source("lib/platform/auth.ts");
  // The login itself still cannot change its address.
  assert.match(auth, /if \(attributes\.email !== undefined\) return \{ data: \{ user: null \}, error: authError\("email_change_not_supported"/);
  const move = block(auth, "async function moveLogin(");
  // One statement: the address, every session and what went to the old address (the hub's links, Service OALab's
  // password links and a sign-in there that waits for its code), all or nothing.
  assert.match(move, /with moved as \(update auth\.users set email = \$2, updated_at = now\(\) where id = \$1 returning id\)/);
  assert.match(move, /delete from auth\.sessions where user_id = \$1 and exists \(select 1 from moved\)/);
  assert.match(move, /\(identifier like 'hub-link:%' and value = \$3\) or \(\(identifier like 'reset-password:%' or identifier like '2fa-%'\) and value = \$4\)/);
  assert.match(move, /\[userId, email, JSON\.stringify\(\{ userId \}\), userId\]/);
  assert.match(move, /code === "23505"\) return false/);
  // Everything else hangs on the id and stays: password, second factor, profile, customer, subscription.
  assert.doesNotMatch(move, /auth\.accounts|two_factors|hub_|calendar/);
  assert.match(auth, /if \(email !== user\.email && !\(await moveLogin\(user\.id, email\)\)\) return \{ data: \{ user: null \}, error: authError\("email_exists"/);

  const actions = await source("lib/hub-users/actions.ts");
  const action = block(actions, "export async function changeHubUserEmail(");
  // An active admin first, then the own platform, which ends sessions and links with the address.
  assert.ok(action.indexOf("const ctx = await context();") < action.indexOf("updateUserById"));
  assert.match(action, /if \(!usesOwnPlatform\(\)\) return failed\(/);
  assert.match(action, /self: user\.id === ctx\.actorId/);
  assert.match(action, /needsMailbox: role !== "oalab_customer" \|\| method === "email"/);
  assert.match(action, /updateUserById\(user\.id, \{ email: email\.value \}\)/);
  assert.match(action, /error\.code === "email_exists" \? "Für diese E-Mail-Adresse besteht bereits ein Zugang\."/);
  // Info mails only for active logins and only with the tick; the log names neither address.
  assert.match(action, /input\?\.notify === true && status === "active"/);
  const logged = action.slice(action.indexOf('await log(ctx, "user.email_changed", ') + 'await log(ctx, "user.email_changed", '.length);
  assert.doesNotMatch(logged.slice(0, logged.indexOf("\n")), /email\.value|user\.email|previous/);
  // The old address sees the new one only shortened, and an address without a mailbox gets nothing.
  const notify = await source("lib/hub-mail/notify.ts");
  assert.match(notify, /loginEmailChangedMail\(\{ \.\.\.common, to: "old", email: maskEmail\(input\.email\) \}/);
  assert.match(notify, /hasMailbox\(to\) \?/);
});

test("the profile tab offers the change at the address and asks before it acts", async () => {
  const dialogs = await source("components/hub/screens/users-dialogs.tsx");
  assert.match(dialogs, /<LoginEmailField user=\{user\} name=\{fullName\(user\)\} mailConfigured=\{mailConfigured\} locked=\{user\.self\}/);
  const field = await source("components/hub/screens/users-email.tsx");
  // „Weiter“ only shows what will happen; the change runs from the confirmation.
  assert.ok(field.indexOf('setStep("confirm")') > 0 && field.indexOf("changeHubUserEmail(") > field.indexOf("async function confirm()"));
  assert.match(field, /Adresse jetzt ändern<\/button>/);
  // Not part of the profile form: no type="email" or required that would hold up „Speichern“, Enter never saves it.
  assert.doesNotMatch(field, /type="email"|required/);
  assert.match(field, /if \(event\.key === "Enter"\) \{ event\.preventDefault\(\); proceed\(\); \}/);
  assert.match(field, /notify: mailable && notify/);
});
