/**
 * The hub's e-mails: one HTML and one plain-text version each, in the oalab look (brand gradient bar,
 * white card, bordeaux button). Everything that comes from people (names, companies, messages, notes) is
 * escaped; links must be http(s). Self-contained (no imports), so `node --test` can render them directly.
 */

export type MailContent = { subject: string; html: string; text: string };
/** Imprint and privacy addresses for the footer; empty strings leave the links out. */
export type MailLegal = { imprint: string; privacy: string };

const BRAND = { ink: "#252027", muted: "#6F626B", paper: "#FAF8F7", line: "#E9E2E5", bordeaux: "#7E004B" };
const FONT = "Inter, 'Segoe UI', Arial, sans-serif";

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

/** Subjects are one line: line breaks would let a value smuggle in extra mail headers. */
export function cleanSubject(value: string) {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
}

/** Only absolute http(s) links make it into a mail; anything else is dropped. */
export function safeUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

type Block =
  | { kind: "text"; value: string }
  | { kind: "details"; rows: [string, string][] }
  | { kind: "quote"; label: string; value: string }
  | { kind: "button"; label: string; url: string }
  | { kind: "small"; value: string };

type Mail = { subject: string; preheader: string; heading: string; blocks: Block[]; footer: string; legal?: MailLegal };

const paragraph = (value: string) => `<p style="margin:0 0 14px;font-family:${FONT};font-size:16px;line-height:24px;color:${BRAND.ink};">${escapeHtml(value)}</p>`;

function renderBlock(block: Block) {
  switch (block.kind) {
    case "text":
      return paragraph(block.value);
    case "small":
      return `<p style="margin:0 0 14px;font-family:${FONT};font-size:13px;line-height:19px;color:${BRAND.muted};">${escapeHtml(block.value)}</p>`;
    case "quote":
      return `<div style="margin:0 0 16px;padding:12px 14px;border-radius:12px;background:${BRAND.paper};border-left:3px solid ${BRAND.bordeaux};font-family:${FONT};">`
        + `<p style="margin:0 0 4px;font-size:12px;line-height:16px;font-weight:600;color:${BRAND.muted};">${escapeHtml(block.label)}</p>`
        + `<p style="margin:0;font-size:15px;line-height:22px;color:${BRAND.ink};white-space:pre-line;">${escapeHtml(block.value)}</p></div>`;
    case "details": {
      const rows = block.rows.filter(([, value]) => value).map(([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;vertical-align:top;font-family:${FONT};font-size:13px;line-height:20px;color:${BRAND.muted};white-space:nowrap;">${escapeHtml(label)}</td>`
        + `<td style="padding:6px 0;vertical-align:top;font-family:${FONT};font-size:15px;line-height:20px;color:${BRAND.ink};">${escapeHtml(value)}</td></tr>`).join("");
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 16px;border-top:1px solid ${BRAND.line};border-bottom:1px solid ${BRAND.line};">${rows}</table>`;
    }
    case "button": {
      const url = safeUrl(block.url);
      if (!url) return "";
      const href = escapeHtml(url);
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;"><tr><td style="border-radius:999px;background:${BRAND.bordeaux};">`
        + `<a href="${href}" style="display:inline-block;padding:13px 24px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">${escapeHtml(block.label)}</a></td></tr></table>`
        + `<p style="margin:0 0 16px;font-family:${FONT};font-size:12px;line-height:18px;color:${BRAND.muted};">Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:<br><a href="${href}" style="color:${BRAND.bordeaux};word-break:break-all;">${escapeHtml(url)}</a></p>`;
    }
  }
}

function legalLinks(legal?: MailLegal) {
  const links: [string, string][] = [];
  if (legal && safeUrl(legal.imprint)) links.push(["Impressum", safeUrl(legal.imprint)]);
  if (legal && safeUrl(legal.privacy)) links.push(["Datenschutz", safeUrl(legal.privacy)]);
  return links;
}

function legalHtml(legal?: MailLegal) {
  const links = legalLinks(legal).map(([label, url]) => `<a href="${escapeHtml(url)}" style="color:${BRAND.muted};text-decoration:underline;">${label}</a>`);
  return links.length ? `<br>${links.join(" · ")}` : "";
}

function render(mail: Mail): MailContent {
  const subject = cleanSubject(mail.subject);
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(subject)}</title></head>`
    + `<body style="margin:0;padding:0;background:${BRAND.paper};">`
    + `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(mail.preheader)}</div>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.paper};"><tr><td align="center" style="padding:32px 16px;">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;">`
    + `<tr><td style="background:${BRAND.bordeaux};background-image:linear-gradient(160deg,#7e004b 0%,#8f1d21 48%,#f37222 100%);padding:22px 28px;">`
    + `<span style="font-family:${FONT};font-size:21px;line-height:26px;font-weight:700;color:#ffffff;">oalab</span>`
    + `<span style="font-family:${FONT};font-size:15px;line-height:26px;color:#ffffff;opacity:0.86;"> Client Hub</span></td></tr>`
    + `<tr><td style="padding:28px 28px 10px;">`
    + `<h1 style="margin:0 0 14px;font-family:${FONT};font-size:22px;line-height:28px;font-weight:700;color:${BRAND.ink};">${escapeHtml(mail.heading)}</h1>`
    + mail.blocks.map(renderBlock).join("")
    + `</td></tr>`
    + `<tr><td style="padding:16px 28px 26px;border-top:1px solid ${BRAND.line};font-family:${FONT};font-size:12px;line-height:18px;color:${BRAND.muted};">${escapeHtml(mail.footer)}${legalHtml(mail.legal)}</td></tr>`
    + `</table></td></tr></table></body></html>`;

  const lines = [mail.heading, ""];
  for (const block of mail.blocks) {
    if (block.kind === "text" || block.kind === "small") lines.push(block.value, "");
    if (block.kind === "quote") lines.push(`${block.label}:`, block.value, "");
    if (block.kind === "details") lines.push(...block.rows.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`), "");
    if (block.kind === "button" && safeUrl(block.url)) lines.push(`${block.label}: ${safeUrl(block.url)}`, "");
  }
  lines.push("—", mail.footer, ...legalLinks(mail.legal).map(([label, url]) => `${label}: ${url}`));
  return { subject, html, text: lines.join("\n") };
}

const greetingName = (firstName: string) => firstName.trim() || "du";

export type RegistrationDetails = {
  firstName: string;
  lastName: string;
  position: string;
  companyName: string;
  email: string;
  phone: string;
  website: string;
  customerNumberHint: string;
  message: string;
  /** Already formatted, e.g. "22. Oktober 2026 um 19:34". */
  registeredAt: string;
};

/** To the oalab team: a confirmed registration waits for approval. */
export function teamRegistrationMail(details: RegistrationDetails, reviewUrl: string, legal?: MailLegal): MailContent {
  const name = `${details.firstName} ${details.lastName}`.trim() || details.email;
  return render({
    subject: `Neue Registrierung: ${name}${details.companyName ? ` (${details.companyName})` : ""}`,
    preheader: `${name} wartet auf die Freigabe im Client Hub.`,
    heading: "Neue Registrierung im Client Hub",
    blocks: [
      { kind: "text", value: `${name} hat sich für den oalab Client Hub registriert und die E-Mail-Adresse bestätigt. Die Registrierung wartet auf eure Freigabe.` },
      { kind: "details", rows: [["Name", name], ["Position", details.position], ["Unternehmen", details.companyName], ["E-Mail", details.email], ["Telefon", details.phone], ["Website", details.website], ["Kundennummer (Angabe)", details.customerNumberHint], ["Registriert", details.registeredAt]] },
      ...(details.message ? [{ kind: "quote" as const, label: "Nachricht", value: details.message }] : []),
      { kind: "button", label: "Im User Management prüfen", url: reviewUrl },
      { kind: "small", value: "Antwortet ihr auf diese E-Mail, geht die Antwort direkt an die Person." },
    ],
    footer: "Diese Nachricht hat der oalab Client Hub automatisch verschickt, weil eine neue Registrierung bestätigt wurde.",
    legal,
  });
}

/** To the person: their registration arrived and is being reviewed. */
export function registrationReceivedMail(input: { firstName: string; contact: string }, legal?: MailLegal): MailContent {
  return render({
    subject: "Deine Registrierung beim oalab Client Hub",
    preheader: "Dein oalab-Team prüft jetzt deine Angaben.",
    heading: `Danke, ${greetingName(input.firstName)}!`,
    blocks: [
      { kind: "text", value: "Deine Registrierung für den oalab Client Hub ist bei uns eingegangen. Dein oalab-Team prüft jetzt deine Angaben und schaltet deinen Zugang frei. Sobald das passiert ist, bekommst du eine weitere E-Mail." },
      { kind: "text", value: "Bis dahin siehst du nach der Anmeldung den Stand deiner Registrierung." },
      { kind: "small", value: `Du hast dich nicht registriert? Dann kannst du diese E-Mail ignorieren oder uns unter ${input.contact} Bescheid geben.` },
    ],
    footer: "Diese Nachricht hat der oalab Client Hub automatisch verschickt.",
    legal,
  });
}

/**
 * To the person, right after the registration form: confirm the e-mail address. The hub sends it itself since the
 * shared Supabase project of Hub and Service keeps public sign-ups closed; wording as supabase/templates/confirmation.html.
 */
export function registrationConfirmationMail(input: { firstName: string; link: string }, legal?: MailLegal): MailContent {
  return render({
    subject: "Bestätige deine E-Mail-Adresse für den oalab Client Hub",
    preheader: "Ein Klick, dann prüft dein oalab-Team deine Registrierung.",
    heading: "Bestätige deine E-Mail-Adresse",
    blocks: [
      { kind: "text", value: `Schön, dass du dich für den oalab Client Hub registriert hast, ${greetingName(input.firstName)}. Bestätige bitte noch deine E-Mail-Adresse. Danach prüft dein oalab-Team deine Angaben und schaltet deinen Zugang frei.` },
      { kind: "button", label: "E-Mail-Adresse bestätigen", url: input.link },
      { kind: "small", value: "Der Link funktioniert einmal und ist zeitlich begrenzt gültig. Du hast dich nicht registriert? Dann kannst du diese E-Mail ignorieren." },
    ],
    footer: "Diese Nachricht hat der oalab Client Hub automatisch verschickt.",
    legal,
  });
}

/** To the person: access approved, with the login link. */
export function accessApprovedMail(input: { firstName: string; email: string; loginUrl: string; company: string | null; customerNumber: string | null }, legal?: MailLegal): MailContent {
  const forCustomer = input.company ? ` für ${input.company}${input.customerNumber ? ` (Kundennummer ${input.customerNumber})` : ""}` : "";
  return render({
    subject: "Dein Zugang zum oalab Client Hub ist freigeschaltet",
    preheader: "Du kannst dich ab sofort anmelden.",
    heading: `Willkommen im Client Hub, ${greetingName(input.firstName)}!`,
    blocks: [
      { kind: "text", value: `Dein Zugang zum oalab Client Hub ist freigeschaltet${forCustomer}. Du meldest dich mit deiner E-Mail-Adresse ${input.email} und deinem Passwort an.` },
      { kind: "button", label: "Zum Client Hub", url: input.loginUrl },
      { kind: "text", value: "Dort findest du deine Projekte, Dateien und Termine an einem Ort." },
    ],
    footer: "Diese Nachricht hat der oalab Client Hub automatisch verschickt. Fragen? Antworte einfach auf diese E-Mail.",
    legal,
  });
}

/** To the person: the registration was not approved, with the team's note if there is one. */
export function registrationRejectedMail(input: { firstName: string; note: string }, legal?: MailLegal): MailContent {
  return render({
    subject: "Deine Registrierung beim oalab Client Hub",
    preheader: "Wir konnten deinen Zugang leider nicht freischalten.",
    heading: `Hallo ${greetingName(input.firstName)},`,
    blocks: [
      { kind: "text", value: "wir haben deine Registrierung für den oalab Client Hub geprüft und können dir leider keinen Zugang freischalten." },
      ...(input.note ? [{ kind: "quote" as const, label: "Hinweis deines oalab-Teams", value: input.note }] : []),
      { kind: "text", value: "Wenn du glaubst, dass das ein Irrtum ist, antworte einfach auf diese E-Mail." },
    ],
    footer: "Diese Nachricht hat der oalab Client Hub automatisch verschickt.",
    legal,
  });
}

/** To the person: a one-time link to set the first (activation) or a new password. */
export function passwordLinkMail(input: { firstName: string; link: string; activation: boolean }, legal?: MailLegal): MailContent {
  return render(input.activation ? {
    subject: "Dein Zugang zum oalab Client Hub",
    preheader: "Lege dein Passwort fest und melde dich an.",
    heading: `Willkommen, ${greetingName(input.firstName)}!`,
    blocks: [
      { kind: "text", value: "Dein oalab-Team hat dir einen Zugang zum oalab Client Hub eingerichtet. Lege über den Button dein Passwort fest; danach bist du direkt angemeldet." },
      { kind: "button", label: "Passwort festlegen", url: input.link },
      { kind: "small", value: "Der Link funktioniert einmal und ist zeitlich begrenzt gültig. Ist er abgelaufen, schickt dir dein oalab-Team gern einen neuen." },
    ],
    footer: "Diese Nachricht hat der oalab Client Hub automatisch verschickt. Fragen? Antworte einfach auf diese E-Mail.",
    legal,
  } : {
    subject: "Neues Passwort für den oalab Client Hub",
    preheader: "Lege über den Link ein neues Passwort fest.",
    heading: `Hallo ${greetingName(input.firstName)},`,
    blocks: [
      { kind: "text", value: "über den Button legst du ein neues Passwort für den oalab Client Hub fest; danach bist du direkt angemeldet." },
      { kind: "button", label: "Neues Passwort festlegen", url: input.link },
      { kind: "small", value: "Der Link funktioniert einmal und ist zeitlich begrenzt gültig. Hast du kein neues Passwort angefordert, sprich bitte kurz mit deinem oalab-Team." },
    ],
    footer: "Diese Nachricht hat der oalab Client Hub automatisch verschickt.",
    legal,
  });
}
