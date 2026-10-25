import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { safeAuthRedirect } from "../lib/auth-redirect.ts";
import { readSmtpResult, readSmtpSettings, smtpError, smtpMessage, smtpTransport } from "../lib/hub-mail/smtp.ts";
import {
  accessApprovedMail, cleanSubject, escapeHtml, passwordLinkMail, registrationReceivedMail, registrationRejectedMail, safeUrl, teamRegistrationMail,
} from "../lib/hub-mail/templates.ts";

// Windows checkouts may carry CRLF line endings; the source checks below compare LF text.
const source = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const legal = { imprint: "https://oalab.de/impressum", privacy: "https://oalab.de/datenschutz" };

const registration = {
  firstName: "Jana", lastName: "Sommer", position: "Geschäftsführung", companyName: "Nordlicht <Studio> & Co.", email: "jana@nordlicht.example",
  phone: "+49 30 1234567", website: "https://nordlicht.example", customerNumberHint: "KD-24017", message: "Hallo Team,\n<b>bitte</b> freischalten.",
  registeredAt: "22. Oktober 2026 um 19:34",
};

test("everything people typed is escaped, subjects stay one line and links stay http(s)", () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  assert.equal(cleanSubject("Neu\r\nBcc: alle@example.com\tjetzt"), "Neu Bcc: alle@example.com jetzt");
  assert.equal(cleanSubject("x".repeat(400)).length, 180);
  assert.equal(safeUrl("https://hub.oalab.de/auth/login"), "https://hub.oalab.de/auth/login");
  for (const bad of ["javascript:alert(1)", "data:text/html,hi", "mailto:info@oalab.de", "/auth/login", ""]) assert.equal(safeUrl(bad), "", bad);
});

test("the team mail carries every registration detail, escaped, with the review link", () => {
  const mail = teamRegistrationMail(registration, "https://hub.oalab.de/dashboard/users", legal);
  assert.equal(mail.subject, "Neue Registrierung: Jana Sommer (Nordlicht <Studio> & Co.)");
  for (const value of ["Jana Sommer", "Geschäftsführung", "Nordlicht &lt;Studio&gt; &amp; Co.", "jana@nordlicht.example", "+49 30 1234567", "https://nordlicht.example", "KD-24017", "22. Oktober 2026 um 19:34", "&lt;b&gt;bitte&lt;/b&gt;"]) {
    assert.ok(mail.html.includes(value), value);
  }
  assert.doesNotMatch(mail.html, /<b>bitte|<Studio>/);
  assert.match(mail.html, /<a href="https:\/\/hub\.oalab\.de\/dashboard\/users"/);
  assert.match(mail.html, /<a href="https:\/\/oalab\.de\/impressum"[^>]*>Impressum<\/a>/);
  // The plain-text version has the same facts, unescaped.
  for (const line of ["Unternehmen: Nordlicht <Studio> & Co.", "Telefon: +49 30 1234567", "Nachricht:\nHallo Team,", "Im User Management prüfen: https://hub.oalab.de/dashboard/users", "Datenschutz: https://oalab.de/datenschutz"]) {
    assert.ok(mail.text.includes(line), line);
  }
  // Empty optional fields leave no empty rows, and without legal addresses there are no footer links.
  const short = teamRegistrationMail({ ...registration, position: "", website: "", customerNumberHint: "", message: "" }, "https://hub.oalab.de/dashboard/users");
  assert.doesNotMatch(short.text, /^(Position|Website|Kundennummer \(Angabe\)|Nachricht):/m);
  assert.doesNotMatch(short.html, /Impressum|Datenschutz/);
});

test("the person gets a receipt, the approval with the login link or the rejection with the team's note", () => {
  const receipt = registrationReceivedMail({ firstName: "Jana", contact: "info@oalab.de" }, legal);
  assert.equal(receipt.subject, "Deine Registrierung beim oalab Client Hub");
  assert.match(receipt.text, /^Danke, Jana!/);
  assert.match(receipt.text, /info@oalab\.de/);
  // A receipt links to nothing but the legal pages.
  for (const link of receipt.html.matchAll(/href="([^"]+)"/g)) assert.ok(Object.values(legal).includes(link[1]), link[1]);

  const input = { firstName: "Jana", email: "jana@nordlicht.example", loginUrl: "https://hub.oalab.de/auth/login", company: "Nordlicht Studio", customerNumber: "KD-24017" };
  const approved = accessApprovedMail(input);
  assert.equal(approved.subject, "Dein Zugang zum oalab Client Hub ist freigeschaltet");
  assert.match(approved.text, /freigeschaltet für Nordlicht Studio \(Kundennummer KD-24017\)\. Du meldest dich mit deiner E-Mail-Adresse jana@nordlicht\.example/);
  assert.match(approved.text, /Zum Client Hub: https:\/\/hub\.oalab\.de\/auth\/login/);
  assert.match(accessApprovedMail({ ...input, company: null, customerNumber: null }).text, /ist freigeschaltet\. Du meldest/);
  // Without a usable origin the button is left out rather than sent as a relative link.
  assert.doesNotMatch(accessApprovedMail({ ...input, loginUrl: "/auth/login" }).html, /href="\/auth/);

  const rejected = registrationRejectedMail({ firstName: "Jana", note: "Bitte meldet euch <telefonisch>." });
  assert.match(rejected.html, /Bitte meldet euch &lt;telefonisch&gt;\./);
  assert.match(rejected.text, /Hinweis deines oalab-Teams:\nBitte meldet euch <telefonisch>\./);
  assert.doesNotMatch(registrationRejectedMail({ firstName: "Jana", note: "" }).text, /Hinweis/);
});

test("activation and password links go out as a button with a copyable fallback", () => {
  const link = "https://hub.oalab.de/auth/confirm?token_hash=abc&type=recovery&next=/auth/update-password";
  const activation = passwordLinkMail({ firstName: "Ben", link, activation: true });
  assert.equal(activation.subject, "Dein Zugang zum oalab Client Hub");
  assert.match(activation.text, /^Passwort festlegen: https:\/\/hub\.oalab\.de\/auth\/confirm\?token_hash=abc&type=recovery&next=\/auth\/update-password$/m);
  // Button, fallback link and fallback text, each with escaped ampersands.
  assert.equal(activation.html.split("token_hash=abc&amp;type=recovery&amp;next=/auth/update-password").length - 1, 3);
  const reset = passwordLinkMail({ firstName: "Ben", link, activation: false });
  assert.equal(reset.subject, "Neues Passwort für den oalab Client Hub");
  assert.match(reset.text, /^Neues Passwort festlegen: https:/m);
  assert.doesNotMatch(passwordLinkMail({ firstName: "Ben", link: "javascript:alert(1)", activation: true }).html, /javascript:/);
});

test("SMTP access needs host, mailbox and password, and the connection is always encrypted", () => {
  const env = { SMTP_HOST: " mxe989.netcup.net ", SMTP_USER: "hub@oalab.de", SMTP_PASSWORD: "geheim" };
  assert.deepEqual(readSmtpSettings(env), { host: "mxe989.netcup.net", port: 465, secure: true, user: "hub@oalab.de", password: "geheim" });
  assert.equal(readSmtpSettings({ ...env, SMTP_PORT: "587" }).secure, false);
  for (const broken of [{ SMTP_HOST: "" }, { SMTP_HOST: "localhost" }, { SMTP_HOST: "mx.netcup.net/x" }, { SMTP_USER: " " }, { SMTP_PASSWORD: "" }, { SMTP_PORT: "25" }]) {
    assert.equal(readSmtpSettings({ ...env, ...broken }), null, JSON.stringify(broken));
  }
  // 465 speaks TLS from the first byte; 587 must upgrade with STARTTLS before the login, or it fails.
  assert.equal(smtpTransport(readSmtpSettings(env)).requireTLS, false);
  const starttls = smtpTransport(readSmtpSettings({ ...env, SMTP_PORT: "587" }));
  assert.equal(starttls.requireTLS, true);
  assert.ok(starttls.connectionTimeout <= 10_000 && starttls.socketTimeout <= 20_000);
});

test("the SMTP message carries sender, reply address and kind, and at most 50 recipients", () => {
  const message = smtpMessage("oalab Client Hub <hub@oalab.de>", {
    to: Array.from({ length: 60 }, (_, index) => `p${index}@example.com`), subject: "Hallo", html: "<p>Hallo</p>", text: "Hallo", replyTo: "info@oalab.de", kind: "registration.team",
  });
  assert.deepEqual(Object.keys(message).sort(), ["from", "headers", "html", "replyTo", "subject", "text", "to"]);
  assert.equal(message.from, "oalab Client Hub <hub@oalab.de>");
  assert.equal(message.to.length, 50);
  assert.deepEqual(message.headers, { "X-Hub-Mail": "registration.team" });
  assert.equal(smtpMessage("hub@oalab.de", { to: ["a@example.com"], subject: "s", html: "h", text: "t", kind: "a\r\nBcc: x" }).headers["X-Hub-Mail"], "a__Bcc__x");
  assert.deepEqual(Object.keys(smtpMessage("hub@oalab.de", { to: ["a@example.com"], subject: "s", html: "h", text: "t" })).sort(), ["from", "html", "subject", "text", "to"]);
});

test("server answers become a short status without addresses", () => {
  assert.deepEqual(readSmtpResult({ messageId: "<abc@oalab.de>", accepted: ["info@oalab.de"], rejected: [] }), { ok: true, id: "<abc@oalab.de>" });
  assert.deepEqual(readSmtpResult({ accepted: [], rejected: ["x@example.com"] }), { ok: false, error: "Empfänger abgelehnt (1)" });
  assert.equal(smtpError({ code: "EAUTH", responseCode: 535, response: "535 5.7.8 Error: authentication failed for hub@oalab.de" }), "EAUTH 535: 535 5.7.8 Error: authentication failed for [Adresse]");
  assert.equal(smtpError(Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" })), "ETIMEDOUT: Connection timeout");
  assert.equal(smtpError(null), "SMTP");
  assert.equal(smtpError({ message: "y".repeat(500) }).length, 300);
});

test("the notification log keeps no addresses or contents, sends registration mails once and is read by admins only", async () => {
  const sql = await source("supabase/migrations/20261022210000_hub_notifications.sql");
  const table = sql.match(/create table public\.hub_notifications \(([\s\S]+?)\n\);/)[1];
  assert.doesNotMatch(table, /email|subject|address|html|body|link/i);
  assert.match(sql, /create unique index hub_notifications_once_idx on public\.hub_notifications \(kind, user_id\)\s+where kind in \('registration\.team', 'registration\.received'\) and status <> 'failed';/);
  assert.match(sql, /alter table public\.hub_notifications enable row level security;/);
  assert.match(sql, /for select to authenticated using \(\(select public\.is_hub_admin\(\)\)\);/);
  assert.match(sql, /revoke all on public\.hub_notifications from anon, authenticated;\s*grant select on public\.hub_notifications to authenticated;/);
  assert.doesNotMatch(sql, /grant (insert|update|delete|all)[^;]*to (anon|authenticated)/);
  // Every kind the server sends is allowed by the table.
  const notify = await source("lib/hub-mail/notify.ts");
  const kinds = [...notify.match(/export type NotificationKind = ([^;]+);/)[1].matchAll(/"([a-z.]+)"/g)].map((match) => match[1]);
  // The newest definition counts: the shared login (25.10.2026) widened the check constraint.
  const sharedLogin = await source("supabase/migrations/20261025120000_hub_shared_login.sql");
  const constraint = sharedLogin.match(/add constraint hub_notifications_kind_check check \(\s*kind in \(([^)]+)\)/)?.[1] ?? table.match(/kind in \(([^)]+)\)/)[1];
  const allowed = [...constraint.matchAll(/'([a-z.]+)'/g)].map((match) => match[1]);
  assert.deepEqual(kinds, allowed);
});

test("mails go out from the server only, after the waiting page and from the admin actions", async () => {
  for (const path of ["lib/hub-mail/send.ts", "lib/hub-mail/notify.ts", "lib/site-origin.ts"]) assert.match(await source(path), /^import "server-only";/, path);
  const send = await source("lib/hub-mail/send.ts");
  assert.match(send, /^import "server-only";\nimport nodemailer from "nodemailer";/);
  assert.match(send, /readSmtpSettings\(process\.env\)/);
  assert.doesNotMatch(send, /NEXT_PUBLIC_[A-Z_]*(SMTP|MAIL)/);
  assert.match(await source("package.json"), /"nodemailer": "\d+\.\d+\.\d+"/);
  // The password, subjects (they carry names), addresses and contents never reach the logs.
  const logs = [...send.matchAll(/console\.(?:info|warn|error|log)\(([^;]+)\);/g)].map((match) => match[1]);
  assert.ok(logs.length >= 3);
  for (const line of logs) assert.doesNotMatch(line, /password|settings\.smtp|mail\.(subject|html|text)|mail\.to\b(?!\.length)/, line);

  const pending = await source("app/auth/pending/page.tsx");
  // Request data is read during the render; `after` only gets plain values.
  assert.match(pending, /if \(account\.status === "pending"\) \{[\s\S]+?const origin = siteOrigin\(await headers\(\)\);\s+const userId = account\.userId;\s+after\(\(\) => notifyConfirmedRegistration\(userId, origin\)\);/);
  const notify = await source("lib/hub-mail/notify.ts");
  // Registration mails need a confirmed address and a waiting profile, and are claimed before they are sent.
  assert.match(notify, /if \(!user\?\.email \|\| !user\.email_confirmed_at\) return;/);
  assert.match(notify, /if \(!profile \|\| profile\.status !== "pending"\) return;/);
  assert.match(notify, /if \(claim\.error\) return claim\.error\.code === "23505" \? "already" : "failed";\s+const result = await sendMail/);
  assert.match(notify, /const result = await sendMail\(\{ \.\.\.mail, kind \}\);/);

  const actions = await source("lib/hub-users/actions.ts");
  // The approval mail follows the active status, so its login link works when it arrives.
  const approve = actions.match(/export async function approveRegistration[\s\S]+?\n}\n/)[0];
  assert.ok(approve.indexOf("const mail = await mailApproval(") > approve.indexOf('update({ status: "active"'));
  assert.match(actions, /const mail = await mailRejection\(/);
  assert.match(actions, /input\.mailLink === true \? await mailPasswordLink\(/);
  // A link sent by mail is not handed to the admin as well.
  assert.match(actions, /return \{ ok: true, data: \{ link: null, activation, mail \} \};/);
});

test("the Supabase templates link through /auth/confirm with the token hash and land on allowed pages", async () => {
  const config = await source("supabase/config.toml");
  for (const [name, type, next] of [["confirmation", "email", "/dashboard"], ["recovery", "recovery", "/auth/update-password"]]) {
    const html = await source(`supabase/templates/${name}.html`);
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(links.length, 2, name);
    for (const link of links) assert.equal(link, `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=${type}&amp;next=${next}`, name);
    assert.equal(safeAuthRedirect(next), next);
    // No PKCE link (it works only in the browser that registered) and no scripts.
    assert.doesNotMatch(html, /ConfirmationURL|<script/i, name);
    assert.match(html, /<html lang="de">/, name);
    assert.match(config, new RegExp(`\\[auth\\.email\\.template\\.${name}\\]\\nsubject = "[^"]+"\\ncontent_path = "\\./supabase/templates/${name}\\.html"`), name);
  }
});
