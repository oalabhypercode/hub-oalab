/**
 * The hub's e-mails in the oalab look (redesign of 30 October 2026): the hub's background behind a white card, a header
 * with logo and area, the headline, what happened, what to do and one button across the card. Each mail comes as HTML
 * (light and dark, phone and Outlook) and as plain text. Everything that comes from people (names, companies, messages,
 * notes) is escaped; links must be http(s), apart from the mailto and tel links built here. The pictures travel inside
 * the mail (cid:…, see images.ts); `images` names the ones a mail shows. Self-contained (no imports), so `node --test`
 * renders them directly.
 */

/** `unsubscribe` (info mails only) is the one-click address for the List-Unsubscribe header (RFC 8058). */
export type MailContent = { subject: string; html: string; text: string; images: string[]; unsubscribe?: string };

/**
 * Where a reader stops the info mails: the page behind the link at the foot (it asks before it switches anything, as
 * mail scanners open links), and the address mail programs post to for their own „Abbestellen“ button.
 */
export type MailOptOut = { page: string; oneClick: string };

/**
 * The objection notice of § 7 Abs. 3 Nr. 4 UWG and Art. 21 Abs. 4 DSGVO, at the foot of every info mail (26.11.2026).
 */
export const OPT_OUT_NOTICE = "Du kannst der Nutzung deiner E-Mail-Adresse für diese Infomails jederzeit widersprechen, ohne dass dir dafür andere als die Übermittlungskosten nach den Basistarifen entstehen.";
/** Imprint and privacy addresses for the footer; empty strings leave the links out. */
export type MailLegal = { imprint: string; privacy: string };

/**
 * "In deinen Kalender eintragen" under an appointment notice: signed hub links (lib/hub-calendar/links.ts). The .ics
 * file serves Apple Kalender and every other app; `moved` adds the reminder to remove the old private entry.
 * `subscribed`: the recipient holds an active calendar subscription (Kalender-Abo, 22.11.2026), so one sentence says
 * the appointment is in the calendar „oalab“ already instead of the four buttons. `subscribe`: where the others can
 * subscribe („Immer aktuell: Kalender abonnieren“).
 */
export type MailCalendar = { ics: string; google: string; outlook: string; moved?: boolean; subscribed?: boolean; subscribe?: string };

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

/** A mailto link for a plain address (no spaces, quotes or brackets), with an optional subject; empty otherwise. */
function mailtoUrl(email: string, subject = "") {
  const address = email.trim();
  if (!/^[^\s@<>"'(),;:\\]+@[^\s@<>"'(),;:\\]+\.[^\s@<>"'(),;:\\]+$/.test(address)) return "";
  return `mailto:${address}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;
}

/** A tel link from a typed phone number: digits and a leading plus only. */
function telUrl(phone: string) {
  const digits = phone.trim().replace(/(?!^\+)[^\d]/g, "");
  return digits.replace(/\D/g, "").length >= 5 ? `tel:${digits}` : "";
}

/** A typed website, also without "https://"; the link and the address as shown. */
function website(value: string) {
  const typed = value.trim();
  const url = safeUrl(/^https?:\/\//i.test(typed) ? typed : `https://${typed}`);
  return url ? { url, shown: url.replace(/^https?:\/\//, "").replace(/\/$/, "") } : null;
}

// ---------- Design ----------

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const MONO = "'SF Mono',SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";
const C = {
  canvas: "#3A0624", card: "#FFFFFF", ink: "#1E191C", body: "#4A4146", muted: "#7A6E75", line: "#EEE6E8",
  panel: "#FAF6F5", panelLine: "#EFE6E8", bordeaux: "#7E004B", red: "#8F1D21", orange: "#F37222",
};
// The hub's background: deep wine with bordeaux, red and orange light. The top layer fades back to the base colour at
// the very bottom, so the mail meets the plain body without an edge. Outlook for Windows shows the base colour.
const CANVAS = `background-color:${C.canvas};background-image:linear-gradient(180deg,rgba(58,6,36,0) 78%,rgba(58,6,36,1) 100%),radial-gradient(circle at 0% 0%,rgba(126,0,75,0.95) 0%,rgba(126,0,75,0) 52%),radial-gradient(circle at 100% 42%,rgba(143,29,33,0.85) 0%,rgba(143,29,33,0) 50%),radial-gradient(circle at 35% 100%,rgba(180,64,15,0.9) 0%,rgba(180,64,15,0) 55%);`;

type Area = "projects" | "files" | "contracts" | "calendar" | "messages" | "account" | "security" | "users" | "news";
const AREAS: Record<Area, { label: string; text: string; dark: string }> = {
  projects: { label: "Projekte", text: "#7F2100", dark: "#FFC680" },
  files: { label: "Dateien", text: "#3533A1", dark: "#BDBCFF" },
  contracts: { label: "Vertrag & Domain", text: "#0E4A20", dark: "#9FE0B0" },
  calendar: { label: "Kalender", text: "#800F0B", dark: "#FFB3AD" },
  messages: { label: "Nachrichten", text: "#004285", dark: "#9CC7FF" },
  account: { label: "Konto", text: C.bordeaux, dark: "#F6A9CE" },
  security: { label: "Sicherheit", text: C.bordeaux, dark: "#F6A9CE" },
  users: { label: "User Management", text: C.bordeaux, dark: "#F6A9CE" },
  news: { label: "Neuigkeiten", text: "#8A3A0C", dark: "#FFBA8C" },
};

type Tone = "todo" | "info" | "ok" | "off" | "bad";
const TONES: Record<Tone, { bg: string; text: string }> = {
  todo: { bg: "#FFF0E3", text: "#9A3A00" }, info: { bg: "#E6F0FF", text: "#004285" }, ok: { bg: "#E5F5E9", text: "#124E20" },
  off: { bg: "#F1EDEF", text: "#62575D" }, bad: { bg: "#FDECEB", text: "#8A1C14" },
};

type NoteTone = "todo" | "info" | "security" | "team";
const NOTES: Record<NoteTone, { title: string; bar: string; bg: string; text: string }> = {
  todo: { title: "Das ist zu tun", bar: C.orange, bg: "#FFF6EE", text: "#9A3A00" },
  info: { title: "Zur Info", bar: "#B9ADB4", bg: "#F7F3F4", text: "#62575D" },
  security: { title: "Sicherheitshinweis", bar: C.bordeaux, bg: "#FBEFF5", text: C.bordeaux },
  team: { title: "Für das oalab-Team", bar: C.bordeaux, bg: "#FBEFF5", text: C.bordeaux },
};

const esc = escapeHtml;
const t = (size: number, line: number, weight: number, color: string, extra = "") => `font-family:${FONT};font-size:${size}px;line-height:${line}px;font-weight:${weight};color:${color};${extra}`;
const caps = (color: string) => t(11, 16, 700, color, "letter-spacing:0.08em;text-transform:uppercase;");
const image = (id: string, size: number, alt = "", extra = "") => `<img src="cid:${id}@hub.oalab.de" width="${size}" height="${size}" alt="${alt}" style="display:block;width:${size}px;height:${size}px;border:0;${extra}">`;
const table = (content: string, attributes = "") => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"${attributes}>${content}</table>`;

// Dark mode (Apple Mail, iOS, Outlook for Mac and the web): the card turns dark, background, logo and symbols stay.
function darkRules(scope: string) {
  const s = (selectors: string) => selectors.split(",").map((selector) => `${scope}${selector.trim()}`).join(",");
  return `
${s(".canvas")}{background-color:${C.canvas} !important}
${s(".card")}{background:#1C181B !important;border-color:#2E262B !important}
${s(".ink")}{color:#F6F0F3 !important}
${s(".body")}{color:#D3C9CE !important}
${s(".muted")}{color:#A1959B !important}
${s(".panel")}{background:#241E22 !important;border-color:#332A30 !important}
${s(".rule")}{border-color:#332A30 !important}
${s(".link")}{color:#F4A6C9 !important}
${s(".vcard")}{background:#231D21 !important;border-color:#382E34 !important}
${s(".calbtn,.calpill")}{background:#2E262B !important;border-color:#43383F !important}
${s(".stage")}{background:#221C20 !important;border-color:#332A30 !important}
${s(".floor")}{border-color:#3A3036 !important}
${s(".bubble")}{background:#2E262B !important;border-color:#43383F !important}
${s(".stepline")}{background-image:linear-gradient(#3F343A,#3F343A) !important}
${s(".calpill")}{color:#F6F0F3 !important}
${(Object.keys(AREAS) as Area[]).map((id) => `${s(`.area-${id}`)}{color:${AREAS[id].dark} !important}`).join("\n")}
${s(".tone-todo")}{background:#3A2614 !important;color:#FFBE8A !important}
${s(".tone-info")}{background:#14263F !important;color:#9CC7FF !important}
${s(".tone-ok")}{background:#16301D !important;color:#9EE2AE !important}
${s(".tone-off")}{background:#2C262A !important;color:#C2B7BD !important}
${s(".tone-bad")}{background:#3D1A18 !important;color:#FFB1AA !important}
${s(".okbox")}{background:#16301D !important}
${s(".okink")}{color:#9EE2AE !important}
${s(".oktile")}{background:#1C181B !important}
${s(".note-todo")}{background:#2A1E15 !important}
${s(".note-info")}{background:#221D20 !important}
${s(".note-security,.note-team")}{background:#2A1622 !important}
${s(".note-title-todo")}{color:#FFBE8A !important}
${s(".note-title-info")}{color:#C2B7BD !important}
${s(".note-title-security,.note-title-team")}{color:#F6A9CE !important}`;
}

const PHONE = `
@media only screen and (max-width:620px){
  .outer{padding:20px 10px 0 !important}
  .card{border-radius:22px !important}
  .px{padding-left:24px !important;padding-right:24px !important}
  .h1{font-size:27px !important;line-height:33px !important}
  .stack{display:block !important;width:100% !important;padding-right:0 !important}
  .label{padding-bottom:2px !important}
  .vc-name{white-space:normal !important}
  .vc-badge{text-align:left !important}
  .code{font-size:34px !important;letter-spacing:8px !important}
  .hide-mobile{display:none !important}
  .show-mobile{display:block !important;max-height:none !important;overflow:visible !important}
  .vcol{display:block !important;width:100% !important;padding:0 0 10px !important}
  .calpanel{padding:18px 16px 8px !important}
  .guidepanel{padding:18px 16px 14px !important}
  .floor{padding:0 !important}
  .speech{display:block !important;width:auto !important;padding:18px 12px 4px !important}
  .host-cell{display:block !important;width:auto !important}
  .host-img{width:104px !important;height:104px !important}
  .host-left .host-img{margin:0 auto 0 14px !important}
  .host-right .host-img{margin:0 14px 0 auto !important}
  .bubble-pad{padding:11px 16px 13px !important}
  .hello{font-size:19px !important;line-height:24px !important}
}`;

// ---------- Building blocks ----------

type Row = { label: string; value: string; tone?: Tone };
type Reach = { glyph: "mail" | "phone" | "globe" | "hash"; text: string; href?: string; note?: string };
type Card = { label: string; badge?: { text: string; tone: Tone }; name: string; role: string; company: string; reach: Reach[]; footnote: string };
type Notice = { area: Area; label: string; title: string; chip?: [string, Tone]; body: string; calendar?: MailCalendar; link?: { label: string; url: string } };

function toneChip(text: string, tone: Tone) {
  const c = TONES[tone];
  return `<span class="tone-${tone}" style="display:inline-block;padding:3px 10px;border-radius:999px;background:${c.bg};${t(13, 18, 600, c.text, "white-space:nowrap;")}">${esc(text)}</span>`;
}

function header(area: Area, date: string) {
  const a = AREAS[area];
  return `<tr><td class="px" style="padding:28px 44px 22px;">
${table(`<tr>
<td width="44" valign="middle" style="width:44px;">${image("logo", 44, "oalab", "border-radius:11px;")}</td>
<td valign="middle" style="padding-left:12px;"><div class="ink" style="${t(17, 20, 700, C.ink, "letter-spacing:-0.01em;")}">oalab</div><div class="muted" style="${t(13, 18, 400, C.muted)}">Client Hub</div></td>
<td align="right" valign="middle">
<table role="presentation" cellpadding="0" cellspacing="0" align="right"><tr>
<td width="40" valign="middle" style="width:40px;">${image(`area-${area}`, 40)}</td>
<td valign="middle" style="padding-left:10px;"><div class="area-${area}" style="${t(15, 19, 700, a.text, "letter-spacing:-0.005em;white-space:nowrap;")}">${a.label}</div><div class="muted hide-mobile" style="${t(12, 17, 400, C.muted, "white-space:nowrap;")}">${date}</div></td>
</tr></table>
</td>
</tr>`)}</td></tr>
<tr><td class="px" style="padding:0 44px;"><div class="rule" style="height:1px;line-height:1px;font-size:0;border-top:1px solid ${C.line};">&nbsp;</div></td></tr>`;
}

const panel = (content: string, padding = "6px 24px", inner = "") => table(`<tr><td${inner ? ` class="${inner}"` : ""} style="padding:${padding};">${content}</td></tr>`, ` class="panel" style="background:${C.panel};border:1px solid ${C.panelLine};border-radius:18px;"`);

function details(rows: Row[]) {
  const body = rows.map((row, index) => `
<tr><td class="rule" style="padding:13px 0;${index ? `border-top:1px solid ${C.panelLine};` : ""}">
${table(`<tr>
<td class="stack label muted" width="128" valign="top" style="width:128px;padding-right:16px;${caps(C.muted)}line-height:22px;">${esc(row.label)}</td>
<td class="stack" valign="top">${row.tone ? toneChip(row.value, row.tone) : `<span class="ink" style="${t(15, 22, 400, C.ink)}">${esc(row.value)}</span>`}</td>
</tr>`)}</td></tr>`).join("");
  return panel(table(body));
}

function codePanel(code: string, note: string) {
  return panel(`<div class="code ink" style="font-family:${MONO};font-size:42px;line-height:50px;font-weight:700;letter-spacing:12px;color:${C.ink};padding-left:12px;text-align:center;"><span>${esc(code.slice(0, 3))}</span><span style="padding-left:14px;">${esc(code.slice(3))}</span></div>
<div class="muted" style="padding-top:8px;text-align:center;${t(13, 18, 400, C.muted)}">${esc(note)}</div>`, "26px 16px 22px");
}

/** A business card for a person: monogram, name and role, company, then the ways to reach them, each with a symbol. */
function contactCard(card: Card) {
  const initials = card.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => Array.from(part)[0] ?? "").join("").toUpperCase() || "?";
  const line = (glyph: Reach["glyph"], content: string) => `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td width="16" valign="top" style="width:16px;padding-top:3px;">${image(`glyph-${glyph}`, 16)}</td>
<td valign="top" style="padding-left:10px;">${content}</td></tr></table>`;
  const reach = card.reach.map((item) => line(item.glyph, item.href
    ? `<a class="link" href="${esc(item.href)}" style="${t(15, 22, 500, C.bordeaux, "text-decoration:none;word-break:break-all;")}">${esc(item.text)}</a>`
    : `<span class="ink" style="${t(15, 22, 400, C.ink)}">${esc(item.text)}</span>${item.note ? `<br><span class="muted" style="${t(12, 17, 400, C.muted)}">${esc(item.note)}</span>` : ""}`));
  const cell = (content: string) => `<td class="vcol" width="50%" valign="top" style="width:50%;padding:0 12px 12px 0;">${content}</td>`;
  const rows: string[] = [];
  for (let index = 0; index < reach.length; index += 2) rows.push(`<tr>${cell(reach[index])}${cell(reach[index + 1] ?? "")}</tr>`);
  // Name and company side by side, both large; between them a fine line in the brand colours that reaches from the
  // name down past the role. On a phone the company moves under the name and the line goes.
  const company = card.company ? `
<td class="hide-mobile" width="2" valign="top" style="width:2px;padding-top:6px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="2" height="46" bgcolor="#B5236F" style="width:2px;height:46px;font-size:0;line-height:0;border-radius:1px;background:#B5236F;background-image:linear-gradient(180deg,#B5236F 0%,${C.orange} 100%);">&nbsp;</td></tr></table></td>
<td class="hide-mobile" valign="top" style="padding-left:18px;"><div class="body" style="${t(22, 30, 500, C.body, "letter-spacing:-0.01em;")}">${esc(card.company)}</div></td>` : "";
  const identity = `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td valign="top" style="padding-right:18px;">
<div class="ink vc-name" style="${t(22, 30, 700, C.ink, "letter-spacing:-0.015em;white-space:nowrap;")}">${esc(card.name)}</div>
${card.company ? `<div class="body show-mobile" style="display:none;max-height:0;overflow:hidden;mso-hide:all;${t(19, 25, 500, C.body, "letter-spacing:-0.01em;")}">${esc(card.company)}</div>` : ""}
${card.role ? `<div class="muted" style="padding-top:4px;${t(15, 21, 400, C.muted)}">${esc(card.role)}</div>` : ""}
</td>${company}
</tr></table>`;
  return `${table(`
<tr><td height="5" style="height:5px;line-height:5px;font-size:0;background:${C.bordeaux};background-image:linear-gradient(90deg,${C.bordeaux} 0%,${C.red} 55%,${C.orange} 100%);border-radius:22px 22px 0 0;">&nbsp;</td></tr>
<tr><td style="padding:16px 26px 0;">${table(`<tr>
<td class="muted hide-mobile" valign="middle" style="${caps(C.muted)}white-space:nowrap;">${esc(card.label)}</td>
<td class="vc-badge" align="right" valign="middle">${card.badge ? toneChip(card.badge.text, card.badge.tone) : ""}</td>
</tr>`)}</td></tr>
<tr><td style="padding:18px 26px 6px;">${table(`<tr>
<td width="60" valign="middle" style="width:60px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="60" height="60" align="center" valign="middle" bgcolor="${C.bordeaux}" style="width:60px;height:60px;border-radius:30px;background:${C.bordeaux};background-image:linear-gradient(135deg,${C.bordeaux} 0%,${C.red} 60%,${C.orange} 100%);${t(21, 60, 700, "#FFFFFF", "letter-spacing:0.02em;text-align:center;")}">${esc(initials)}</td></tr></table></td>
<td valign="middle" style="padding-left:18px;">${identity}</td>
</tr>`)}</td></tr>
${rows.length ? `<tr><td style="padding:14px 26px 0;"><div class="rule" style="height:1px;line-height:1px;font-size:0;border-top:1px dashed #E2D6DB;">&nbsp;</div></td></tr>
<tr><td style="padding:18px 26px 10px;">${table(rows.join(""))}</td></tr>` : `<tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>`}`, ` class="vcard" style="background:#FFFFFF;background-image:linear-gradient(160deg,#FFFFFF 0%,#FBF7F5 100%);border:1px solid #ECE2E6;border-radius:22px;box-shadow:0 1px 2px rgba(30,25,28,0.05),0 16px 36px rgba(58,6,36,0.10);"`)}
${card.footnote ? `<p class="muted" style="margin:12px 0 0;${t(13, 19, 400, C.muted)}"><img src="cid:glyph-badge-check@hub.oalab.de" width="14" height="14" alt="" style="width:14px;height:14px;border:0;vertical-align:-2px;">&nbsp;&nbsp;${esc(card.footnote)}</p>` : ""}`;
}

/** One notice on its own: what it is about (with its state), the notice and its line. */
function noticeCard(notice: Notice) {
  return panel(`${table(`<tr>
<td valign="middle" class="area-${notice.area}" style="${caps(AREAS[notice.area].text)}">${esc(notice.label)}</td>
<td align="right" valign="middle">${notice.chip ? toneChip(...notice.chip) : ""}</td>
</tr>`)}
<div class="ink" style="padding-top:8px;${t(19, 26, 600, C.ink, "letter-spacing:-0.01em;")}">${esc(notice.title)}</div>
${notice.body ? `<div class="body" style="padding-top:6px;${t(15, 23, 400, C.body)}">${esc(notice.body)}</div>` : ""}`, "18px 24px 20px");
}

/** Several notices, each with the symbol of its area, its line and its own link. */
function noticeList(list: Notice[]) {
  return table(list.map((item, index) => `
<tr><td class="rule" style="padding:18px 0;${index ? `border-top:1px solid ${C.line};` : ""}">
${table(`<tr>
<td width="36" valign="top" style="width:36px;padding-top:2px;">${image(`area-${item.area}`, 36)}</td>
<td valign="top" style="padding-left:14px;">
<div class="area-${item.area}" style="${caps(AREAS[item.area].text)}">${esc(item.label)}</div>
<div class="ink" style="padding-top:4px;${t(16, 22, 600, C.ink)}">${esc(item.title)}${item.chip ? `&nbsp;&nbsp;${toneChip(...item.chip)}` : ""}</div>
${item.body ? `<div class="muted" style="padding-top:3px;${t(14, 21, 400, C.muted)}">${esc(item.body)}</div>` : ""}
${item.calendar ? calendarPills(item.calendar) : ""}
${item.link ? `<div style="padding-top:8px;"><a class="link" href="${esc(item.link.url)}" style="${t(14, 20, 600, C.bordeaux, "text-decoration:none;")}">${esc(item.link.label)}&nbsp;&rarr;</a></div>` : ""}
</td></tr>`)}</td></tr>`).join(""));
}

function quote(label: string, value: string) {
  return table(`<tr><td style="border-left:3px solid ${C.bordeaux};padding:2px 0 2px 16px;">
<div class="muted" style="${caps(C.muted)}">${esc(label)}</div>
<div class="body" style="padding-top:6px;white-space:pre-line;${t(15, 24, 400, C.body, "font-style:italic;")}">&bdquo;${esc(value)}&ldquo;</div></td></tr>`);
}

function note(tone: NoteTone, text: string) {
  const n = NOTES[tone];
  return table(`<tr>
<td width="4" style="width:4px;background:${n.bar};border-radius:14px 0 0 14px;font-size:0;line-height:0;">&nbsp;</td>
<td style="padding:14px 18px 15px;">
<div class="note-title-${tone}" style="${caps(n.text)}">${n.title}</div>
<div class="body" style="padding-top:5px;${t(15, 23, 400, C.body)}">${esc(text)}</div>
</td></tr>`, ` class="note-${tone}" style="background:${n.bg};border-radius:14px;"`);
}

/** A host of the hub (Ali) or of the service platform (Omed): his cut-out picture (cid image), who he is, what he says. */
type Host = { image: string; name: string; hello: string; line: string; side: "left" | "right" };

/**
 * The hosts in conversation, as in the hub's welcome: each stands on a line, his bubble beside him, the first on the
 * left, the next on the right. The bubble's sharp corner points to him. Two soft lights in the brand colours sit behind
 * them; Outlook for Windows shows the plain panel.
 */
function hostStage(hosts: Host[]) {
  // Bubble first, picture second in the source, so on a phone each bubble stacks above its host; dir="rtl" puts the
  // left host's picture back on the left on a computer.
  const rows = hosts.map((host, index) => {
    const left = host.side === "left";
    const last = index === hosts.length - 1;
    const avatar = `<td class="host-cell host-${host.side}" dir="ltr" width="132" valign="bottom" style="width:132px;font-size:0;line-height:0;"><img class="host-img" src="cid:${host.image}@hub.oalab.de" width="132" height="132" alt="${esc(host.name.split(" ")[0])}" style="display:block;width:132px;height:132px;border:0;"></td>`;
    // Words with a hyphen ("KI-Plattform", "oalab-Kunde") stay on one line in the narrow bubbles.
    const keep = (text: string) => esc(text).replace(/[^\s-]+(?:-[^\s-]+)+/g, (word) => `<span style="white-space:nowrap;">${word}</span>`);
    const bubble = table(`<tr><td class="bubble-pad" style="padding:12px 18px 14px;">
<div class="muted" style="${t(13, 18, 600, C.muted)}">${esc(host.name)}</div>
<div class="ink hello" style="padding-top:2px;${t(21, 26, 700, C.ink, "letter-spacing:-0.015em;")}">${keep(host.hello)}</div>
<div class="body" style="padding-top:5px;${t(15, 22, 400, C.body)}">${keep(host.line)}</div>
</td></tr>`, ` class="bubble" bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid #F0E4EA;border-radius:${left ? "20px 20px 20px 6px" : "20px 20px 6px 20px"};box-shadow:0 1px 2px rgba(60,0,30,0.05),0 10px 24px rgba(60,0,30,0.10);"`);
    const speech = `<td class="speech" dir="ltr" valign="middle" style="padding:${left ? "24px 22px 24px 4px" : "24px 4px 24px 22px"};">${bubble}</td>`;
    return `<tr><td class="floor" style="padding:${left ? "0 0 0 10px" : "0 10px 0 0"};${last ? "" : "border-bottom:1px solid #EADCE2;"}">${table(`<tr>${speech}${avatar}</tr>`, left ? ` dir="rtl"` : "")}</td></tr>`;
  });
  return table(rows.join(""), ` class="stage" bgcolor="#FBF6F8" style="background:#FBF6F8;background-image:radial-gradient(circle at 4% 50%,rgba(181,35,111,0.14) 0%,rgba(181,35,111,0) 34%),radial-gradient(circle at 96% 100%,rgba(243,114,34,0.14) 0%,rgba(243,114,34,0) 34%);border:1px solid #F0E4EA;border-radius:22px;"`);
}

/** One step of a short guide: what to do, how, and optionally a link. */
type Step = { title: string; text: string; link?: { label: string; url: string } };

/** A short guide for a day: a tile, the date and a line, then the steps. */
type Guide = { tile: string; date: string; line: string; steps: Step[] };

/**
 * Numbered steps: a round number in the brand colours, a fine line down to the next number (not in Outlook for
 * Windows, which shows the numbers alone), the title and what to do.
 */
function stepList(steps: Step[]) {
  return table(steps.map((step, index) => {
    const last = index === steps.length - 1;
    const line = last ? "" : `background-image:linear-gradient(#E6D7DE,#E6D7DE);background-size:2px 100%;background-position:center top;background-repeat:no-repeat;`;
    const url = step.link ? safeUrl(step.link.url) : "";
    const link = url && step.link ? `<div style="padding-top:6px;"><a class="link" href="${esc(url)}" style="${t(15, 22, 600, C.bordeaux, "text-decoration:none;")}">${esc(step.link.label)}&nbsp;&rarr;</a></div>` : "";
    return `<tr>
<td class="${last ? "" : "stepline"}" width="28" valign="top" style="width:28px;${line}"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="28" height="28" align="center" valign="middle" bgcolor="${C.bordeaux}" style="width:28px;height:28px;border-radius:14px;background:${C.bordeaux};background-image:linear-gradient(135deg,${C.bordeaux} 0%,${C.red} 60%,${C.orange} 100%);${t(13, 28, 700, "#FFFFFF", "text-align:center;")}">${index + 1}</td></tr></table></td>
<td valign="top" style="padding:3px 0 ${last ? 4 : 20}px 14px;">
<div class="ink" style="${t(16, 22, 700, C.ink, "letter-spacing:-0.005em;")}">${esc(step.title)}</div>
<div class="body" style="padding-top:4px;${t(15, 23, 400, C.body)}">${esc(step.text)}</div>
${link}
</td></tr>`;
  }).join(""));
}

function guidePanel(guide: Guide) {
  return panel(`${table(`<tr>
<td width="36" valign="top" style="width:36px;padding-top:2px;">${image(guide.tile, 36)}</td>
<td valign="middle" style="padding-left:14px;"><div class="ink" style="${t(17, 22, 700, C.ink, "letter-spacing:-0.01em;")}">${esc(guide.date)}</div><div class="muted" style="padding-top:3px;${t(14, 20, 400, C.muted)}">${esc(guide.line)}</div></td>
</tr>`)}
${table(`<tr><td class="rule" style="padding:20px 0 0;border-top:1px solid ${C.panelLine};">${stepList(guide.steps)}</td></tr>`, ` style="margin-top:16px;"`)}`, "20px 24px 18px", "guidepanel");
}

const MOVED_HINT = "Schon in deinem Kalender? Lösch dort den alten Eintrag. Private Kalender ändern sich nicht von selbst.";
/** For subscribers (Kalender-Abo): the appointment is in the calendar „oalab“ already and follows every change. */
const SUBSCRIBED_TITLE = "Steht automatisch in deinem Kalender „oalab“";
const subscribedLine = (calendar: MailCalendar) => calendar.moved
  ? "Die neue Zeit kommt beim nächsten Abruf von selbst. Du musst nichts tun."
  : "Verschiebt oder sagt oalab den Termin ab, ändert sich der Eintrag von selbst. Du musst nichts tun.";
/** A mail calendar worth showing: a subscriber's sentence, or at least one usable link. */
const showsCalendar = (calendar: MailCalendar | undefined): calendar is MailCalendar => Boolean(calendar && (calendar.subscribed || calendarEntries(calendar).length));

/** The ways into a calendar, each with a safe link; an empty list when none is usable. */
function calendarEntries(calendar: MailCalendar) {
  const entries = [
    { label: "Apple Kalender", hint: "iPhone, iPad, Mac", short: "Apple", url: calendar.ics, glyph: "brand-apple" },
    { label: "Google Kalender", hint: "Android, Gmail, Web", short: "Google", url: calendar.google, glyph: "brand-google" },
    { label: "Outlook", hint: "Microsoft 365 im Browser", short: "Outlook", url: calendar.outlook, glyph: "brand-microsoft" },
    { label: "Andere Kalender-App", hint: ".ics-Datei herunterladen", short: ".ics-Datei", url: calendar.ics, glyph: "calendar-file" },
  ];
  return entries.map((entry) => ({ ...entry, url: safeUrl(entry.url) })).filter((entry) => entry.url);
}

/** For subscribers: one green box instead of the four buttons (approved preview „Kalender-Abo“, 22.11.2026). */
function subscribedBlock(calendar: MailCalendar) {
  return table(`<tr><td class="okbox" style="padding:16px;border-radius:14px;background:${TONES.ok.bg};">
${table(`<tr>
<td width="36" valign="top" style="width:36px;"><div class="oktile" style="width:36px;height:36px;border-radius:10px;background:#FFFFFF;text-align:center;">${image("glyph-badge-check", 20, "", "display:inline-block;margin-top:8px;")}</div></td>
<td valign="middle" style="padding-left:12px;"><div class="okink" style="${t(16, 21, 700, TONES.ok.text)}">${esc(SUBSCRIBED_TITLE)}</div><div class="okink" style="padding-top:2px;${t(13.5, 19, 400, TONES.ok.text)}">${esc(subscribedLine(calendar))}</div></td>
</tr>`)}
</td></tr>`);
}

/** Under the buttons for everyone without a subscription: the way to one that stays current by itself. */
function subscribeHint(calendar: MailCalendar) {
  const url = safeUrl(calendar.subscribe ?? "");
  return url ? `<p class="body" style="margin:14px 0 0;${t(13, 19, 400, C.body)}">Immer aktuell statt einer Kopie: <a class="link" href="${esc(url)}" style="color:${C.bordeaux};font-weight:600;text-decoration:underline;">Kalender abonnieren</a></p>` : "";
}

/** "In deinen Kalender eintragen": four ways, two by two on a computer, one below the other on a phone. */
function calendarBlock(calendar: MailCalendar) {
  if (calendar.subscribed) return subscribedBlock(calendar);
  const button = (entry: ReturnType<typeof calendarEntries>[number]) => {
    const href = esc(entry.url);
    // Both cells link, so Outlook for Windows keeps the link too.
    return table(`<tr>
<td width="40" valign="middle" style="width:40px;"><a href="${href}" style="display:block;padding:14px 0 14px 16px;text-decoration:none;">${image(entry.glyph, 20)}</a></td>
<td valign="middle"><a href="${href}" style="display:block;padding:11px 14px 11px 10px;text-decoration:none;"><span class="ink" style="display:block;${t(15, 20, 600, C.ink)}">${esc(entry.label)}</span><span class="muted" style="display:block;${t(12, 17, 400, C.muted)}">${esc(entry.hint)}</span></a></td>
</tr>`, ` class="calbtn" bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid #E7DDE1;border-radius:14px;"`);
  };
  const cells = calendarEntries(calendar).map(button);
  const grid: string[] = [];
  for (let index = 0; index < cells.length; index += 2) {
    grid.push(`<tr><td class="vcol" width="50%" valign="top" style="width:50%;padding:0 5px 10px 0;">${cells[index]}</td><td class="vcol" width="50%" valign="top" style="width:50%;padding:0 0 10px 5px;">${cells[index + 1] ?? ""}</td></tr>`);
  }
  const hint = calendar.moved ? table(`<tr><td class="rule" style="padding:12px 0 8px;border-top:1px dashed #E2D6DB;">${table(`<tr>
<td width="16" valign="top" style="width:16px;padding-top:2px;">${image("glyph-history", 16)}</td>
<td valign="top" class="muted" style="padding-left:10px;${t(13, 19, 400, C.muted)}">${MOVED_HINT}</td>
</tr>`)}</td></tr>`) : "";
  return table(`<tr><td class="calpanel" style="padding:20px 20px 10px;">
${table(`<tr>
<td width="36" valign="top" style="width:36px;">${image("calendar-tile", 36)}</td>
<td valign="middle" style="padding-left:14px;"><div class="ink" style="${t(16, 21, 700, C.ink, "letter-spacing:-0.005em;")}">${calendar.moved ? "Neue Zeit in deinen Kalender" : "In deinen Kalender eintragen"}</div><div class="muted" style="padding-top:2px;${t(13, 19, 400, C.muted)}">Mit allen Angaben und dem Link zum Hub. Ein Tipp genügt.</div></td>
</tr>`)}
${table(grid.join(""), ` style="margin-top:16px;"`)}${hint}${subscribeHint(calendar)}
</td></tr>`, ` class="panel" style="background:${C.panel};border:1px solid ${C.panelLine};border-radius:18px;"`);
}

/** The compact version in a mail with several notices: small pills under the appointment. */
function calendarPills(calendar: MailCalendar) {
  if (calendar.subscribed) {
    return `<div class="muted" style="padding-top:12px;${t(12, 16, 600, C.muted)}"><img src="cid:glyph-badge-check@hub.oalab.de" width="14" height="14" alt="" style="width:14px;height:14px;border:0;vertical-align:-3px;">&nbsp;&nbsp;${esc(SUBSCRIBED_TITLE)}</div>`;
  }
  const pill = (entry: ReturnType<typeof calendarEntries>[number]) => `<a class="calpill" href="${esc(entry.url)}" style="display:inline-block;margin:6px 6px 0 0;padding:6px 12px;border:1px solid #E7DDE1;border-radius:999px;background:#FFFFFF;${t(13, 18, 600, C.ink, "text-decoration:none;white-space:nowrap;")}">${esc(entry.short)}</a>`;
  return `<div style="padding-top:12px;"><div class="muted" style="${t(12, 16, 600, C.muted)}"><img src="cid:calendar-small@hub.oalab.de" width="14" height="14" alt="" style="width:14px;height:14px;border:0;vertical-align:-3px;">&nbsp;&nbsp;In deinen Kalender eintragen:</div>
<div>${calendarEntries(calendar).map(pill).join("")}</div>${calendar.moved ? `<div class="muted" style="padding-top:8px;${t(12, 18, 400, C.muted)}">${MOVED_HINT}</div>` : ""}</div>`;
}

function calendarText(calendar: MailCalendar) {
  if (calendar.subscribed) return [`${SUBSCRIBED_TITLE}. ${subscribedLine(calendar)}`];
  const [ics, google, outlook] = [calendar.ics, calendar.google, calendar.outlook].map(safeUrl);
  const lines = [
    ics && `Apple Kalender und andere Apps (.ics): ${ics}`,
    google && `Google Kalender: ${google}`,
    outlook && `Outlook (Microsoft 365): ${outlook}`,
  ].filter(Boolean);
  const subscribe = safeUrl(calendar.subscribe ?? "");
  return lines.length ? ["In deinen Kalender eintragen:", ...lines, ...(calendar.moved ? [MOVED_HINT] : []), ...(subscribe ? [`Immer aktuell statt einer Kopie, Kalender abonnieren: ${subscribe}`] : [])] : [];
}

/** The call to action spans the card's full width (512 px inside the margins; Outlook for Windows needs it fixed). */
function button(label: string, url: string) {
  const text = `${esc(label)}&nbsp;&nbsp;&rarr;`;
  const href = esc(url);
  return table(`<tr><td align="center" bgcolor="${C.bordeaux}" style="border-radius:14px;background:${C.bordeaux};background-image:linear-gradient(120deg,${C.bordeaux} 0%,#9B1440 100%);box-shadow:0 10px 24px rgba(126,0,75,0.28);">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:56px;v-text-anchor:middle;width:512px;" arcsize="25%" stroke="f" fillcolor="${C.bordeaux}"><w:anchorlock/><center style="color:#ffffff;font-family:'Segoe UI',Arial,sans-serif;font-size:16px;font-weight:600;">${text}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${href}" style="display:block;padding:18px 24px;border-radius:14px;text-align:center;${t(16, 20, 600, "#FFFFFF", "text-decoration:none;letter-spacing:0.01em;")}">${text}</a><!--<![endif]-->
</td></tr>`, ` style="width:100%;"`);
}

// ---------- One mail ----------

type Mail = {
  subject: string;
  preheader: string;
  area: Area;
  heading: string;
  lead: string;
  code?: { value: string; note: string };
  card?: Card;
  hosts?: Host[];
  guide?: Guide;
  details?: Row[];
  notice?: Notice;
  calendar?: MailCalendar;
  /** A small caption above the list. */
  listTitle?: string;
  list?: Notice[];
  more?: string;
  quote?: { label: string; value: string };
  note?: { tone: NoteTone; text: string };
  /** Closing words at the end of the card, signed by `from`. */
  signoff?: { text: string; from: string };
  /** The button; left out without a usable link. */
  cta?: { label: string; url: string };
  small?: string;
  reason: string;
  /** Where the notification mails are switched off (notice mails only). */
  manage?: string;
  /** How the reader stops this kind of mail (the start series): a link and the objection notice at the foot. */
  unsubscribe?: MailOptOut;
  legal?: MailLegal;
  /** The dark card in light mode too, not only by the reader's setting (launch reminder, 25.11.2026). */
  dark?: boolean;
  /** The list above the guide instead of below it (launch mail, 26.11.2026). */
  listFirst?: boolean;
};

const shortDate = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "numeric", month: "short", year: "numeric" });

function legalLinks(legal?: MailLegal) {
  const links: [string, string][] = [];
  if (legal && safeUrl(legal.imprint)) links.push(["Impressum", safeUrl(legal.imprint)]);
  if (legal && safeUrl(legal.privacy)) links.push(["Datenschutz", safeUrl(legal.privacy)]);
  return links;
}

function render(mail: Mail): MailContent {
  const subject = cleanSubject(mail.subject);
  const manage = mail.manage ? safeUrl(mail.manage) : "";
  const optOut = mail.unsubscribe && safeUrl(mail.unsubscribe.page) && safeUrl(mail.unsubscribe.oneClick)
    ? { page: safeUrl(mail.unsubscribe.page), oneClick: safeUrl(mail.unsubscribe.oneClick) }
    : null;
  // Buttons lead to http(s) pages, or write a mail through a mailto link built above.
  const ctaUrl = mail.cta ? safeUrl(mail.cta.url) || (/^mailto:[^\s"'<>]+$/.test(mail.cta.url) ? mail.cta.url : "") : "";
  const cta = mail.cta && ctaUrl ? { label: mail.cta.label, url: ctaUrl } : undefined;
  const calendar = showsCalendar(mail.calendar) ? mail.calendar : undefined;
  const list = mail.list?.map((item) => ({ ...item, calendar: showsCalendar(item.calendar) ? item.calendar : undefined }));
  const section = (content: string, top = 28) => `<tr><td class="px" style="padding:${top}px 44px 0;">${content}</td></tr>`;

  const rows = [header(mail.area, shortDate.format(new Date()))];
  rows.push(section(`<h1 class="h1 ink" style="margin:0;${t(32, 38, 700, C.ink, "letter-spacing:-0.025em;")}">${esc(mail.heading)}</h1>`, 32));
  rows.push(section(`<p class="body" style="margin:0;${t(17, 27, 400, C.body)}">${esc(mail.lead)}</p>`, 12));
  if (mail.code) rows.push(section(codePanel(mail.code.value, mail.code.note)));
  if (mail.card) rows.push(section(contactCard(mail.card)));
  if (mail.hosts?.length) rows.push(section(hostStage(mail.hosts), 26));
  if (mail.details?.length) rows.push(section(details(mail.details)));
  if (mail.notice) rows.push(section(noticeCard(mail.notice)));
  if (calendar) rows.push(section(calendarBlock(calendar), 16));
  // The guide comes after the facts: close under the hosts (announcement), with room under a panel (launch reminder).
  // `listFirst` puts the list above the guide (launch mail: what hub and service are for, then the info mails ahead).
  const listRows = () => {
    if (list?.length && mail.listTitle) rows.push(section(`<div class="muted" style="${caps(C.muted)}">${esc(mail.listTitle)}</div>`, 34));
    if (list?.length) rows.push(section(noticeList(list), mail.listTitle ? 2 : 16));
  };
  if (mail.listFirst) listRows();
  if (mail.guide) rows.push(section(guidePanel(mail.guide), mail.details?.length || mail.notice || calendar || (mail.listFirst && list?.length) ? 28 : 16));
  if (!mail.listFirst) listRows();
  if (mail.more) rows.push(section(`<p class="muted" style="margin:0;${t(14, 21, 400, C.muted)}">${esc(mail.more)}</p>`, 4));
  if (mail.quote) rows.push(section(quote(mail.quote.label, mail.quote.value), 24));
  if (mail.note) rows.push(section(note(mail.note.tone, mail.note.text), 24));
  if (cta) {
    rows.push(section(button(cta.label, cta.url), 32));
    if (!cta.url.startsWith("mailto:")) rows.push(section(`<p class="muted" style="margin:0;${t(12, 18, 400, C.muted)}">Button funktioniert nicht? Öffne diesen Link:<br><a class="link" href="${esc(cta.url)}" style="color:${C.bordeaux};word-break:break-all;">${esc(cta.url)}</a></p>`, 14));
  }
  if (mail.small) rows.push(section(`<p class="muted" style="margin:0;${t(12, 18, 400, C.muted)}">${esc(mail.small)}</p>`, cta ? 12 : 22));
  if (mail.signoff) rows.push(section(`<p class="body" style="margin:0;${t(16, 25, 400, C.body)}">${esc(mail.signoff.text)}</p>
<p class="body" style="margin:16px 0 0;${t(16, 25, 400, C.body)}">Viele Grüße<br><span class="ink" style="font-weight:700;color:${C.ink};">${esc(mail.signoff.from)}</span></p>`, 30));
  rows.push(`<tr><td style="height:44px;line-height:44px;font-size:0;">&nbsp;</td></tr>`);

  const legal = legalLinks(mail.legal).map(([label, url]) => `<a href="${esc(url)}" style="color:#D9BFCB;text-decoration:underline;">${label}</a>&nbsp;&middot;&nbsp;`).join("");
  const footer = `
<tr><td align="center" style="padding:30px 24px 0;">${image("logo", 32, "oalab", "margin:0 auto;border-radius:8px;")}</td></tr>
<tr><td align="center" style="padding:12px 32px 0;${t(12, 19, 400, "#F3E6EC")}">${esc(mail.reason)}<br>${manage ? `<a href="${esc(manage)}" style="color:#FFFFFF;text-decoration:underline;">Benachrichtigungen verwalten</a>&nbsp;&middot;&nbsp;` : ""}Fragen? Antworte einfach auf diese E-Mail.</td></tr>
${optOut ? `<tr><td align="center" style="padding:12px 32px 0;${t(12, 19, 400, "#F3E6EC")}"><a href="${esc(optOut.page)}" style="color:#FFFFFF;font-weight:600;text-decoration:underline;">Infomails abbestellen</a><br><span style="color:#D9BFCB;">${esc(OPT_OUT_NOTICE)}</span></td></tr>\n` : ""}<tr><td align="center" style="padding:12px 32px 48px;${t(12, 18, 400, "#D9BFCB")}">${legal}oalab Client Hub</td></tr>`;

  // Light and dark by the reader's setting, or always dark (`dark`): then the dark rules apply without the media query,
  // except in classic Outlook for Windows (if !mso), which takes class rules only in part and keeps the light card.
  // Outlook on the web marks what its own dark mode recoloured with data-ogsc (text) and data-ogsb (backgrounds).
  const scheme = mail.dark ? "dark" : "light dark";
  const html = `<!doctype html>
<html lang="de" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<meta name="color-scheme" content="${scheme}">
<meta name="supported-color-schemes" content="${scheme}">
<title>${esc(subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
:root{color-scheme:${scheme};supported-color-schemes:${scheme}}
body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table{border-collapse:separate}
img{-ms-interpolation-mode:bicubic}
a[x-apple-data-detectors]{color:inherit !important;text-decoration:none !important}
${PHONE}
${mail.dark ? "" : `@media (prefers-color-scheme:dark){${darkRules("")}}\n`}${darkRules("[data-ogsc] ")}${mail.dark ? darkRules("[data-ogsb] ") : ""}
</style>
${mail.dark ? `<!--[if !mso]><!--><style>${darkRules("")}</style><!--<![endif]-->\n` : ""}</head>
<body style="margin:0;padding:0;background:${C.canvas};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(mail.preheader)}${"&#8199;&#65279;&#847; ".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.canvas}" class="canvas" style="${CANVAS}"><tr><td class="outer" align="center" style="padding:40px 14px 0;">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
<tr><td>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="card" style="background:${C.card};border:1px solid rgba(255,255,255,0.65);border-radius:28px;box-shadow:0 2px 6px rgba(20,0,10,0.18),0 30px 60px rgba(20,0,10,0.32);">
${rows.join("\n")}
</table>
</td></tr>
${footer}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>`;

  // The plain-text version: the same facts in the same order, unescaped.
  const lines = [mail.heading, "", mail.lead, ""];
  if (mail.code) lines.push(mail.code.value, mail.code.note, "");
  if (mail.card) {
    const card = mail.card;
    lines.push(`${card.label}${card.badge ? ` (${card.badge.text})` : ""}`, `Name: ${card.name}`);
    if (card.role) lines.push(`Position: ${card.role}`);
    if (card.company) lines.push(`Unternehmen: ${card.company}`);
    for (const item of card.reach) lines.push(`${{ mail: "E-Mail", phone: "Telefon", globe: "Website", hash: "Kundennummer (Angabe)" }[item.glyph]}: ${item.glyph === "globe" && item.href ? item.href : item.text}`);
    if (card.footnote) lines.push(card.footnote);
    lines.push("");
  }
  for (const host of mail.hosts ?? []) lines.push(`${host.name}: ${host.hello} ${host.line}`, "");
  if (mail.details?.length) lines.push(...mail.details.map((row) => `${row.label}: ${row.value}`), "");
  if (mail.notice) lines.push(mail.notice.title, ...(mail.notice.body ? [mail.notice.body] : []), "");
  const guideLines = () => {
    if (!mail.guide) return;
    lines.push(mail.guide.date, mail.guide.line);
    mail.guide.steps.forEach((step, index) => lines.push("", `${index + 1}. ${step.title}`, step.text, ...(step.link && safeUrl(step.link.url) ? [safeUrl(step.link.url)] : [])));
    lines.push("");
  };
  const listLines = (withCalendar: boolean) => {
    if (list?.length && mail.listTitle) lines.push(`${mail.listTitle}:`, "");
    if (withCalendar && calendar) lines.push(...calendarText(calendar), "");
    for (const item of list ?? []) {
      lines.push(`${item.label}: ${item.title}`, ...(item.body ? [item.body] : []), ...(item.calendar ? calendarText(item.calendar) : []), ...(item.link ? [`${item.link.label}: ${item.link.url}`] : []), "");
    }
  };
  if (mail.listFirst) listLines(false);
  guideLines();
  if (mail.listFirst) {
    if (calendar) lines.push(...calendarText(calendar), "");
  } else listLines(true);
  if (mail.more) lines.push(mail.more, "");
  if (mail.quote) lines.push(`${mail.quote.label}:`, mail.quote.value, "");
  if (mail.note) lines.push(`${NOTES[mail.note.tone].title}: ${mail.note.text}`, "");
  if (cta) lines.push(`${cta.label}: ${cta.url.startsWith("mailto:") ? cta.url.slice(7).split("?")[0] : cta.url}`, "");
  if (mail.small) lines.push(mail.small, "");
  if (mail.signoff) lines.push(mail.signoff.text, "", "Viele Grüße", mail.signoff.from, "");
  lines.push("—", mail.reason, ...(manage ? [`Benachrichtigungen verwalten: ${manage}`] : []), "Fragen? Antworte einfach auf diese E-Mail.", ...(optOut ? [`Infomails abbestellen: ${optOut.page}`, OPT_OUT_NOTICE] : []),...legalLinks(mail.legal).map(([label, url]) => `${label}: ${url}`));

  const images = [...new Set([...html.matchAll(/src="cid:([a-z0-9-]+)@hub\.oalab\.de"/g)].map((match) => match[1]))];
  return { subject, html, text: lines.join("\n"), images, ...(optOut ? { unsubscribe: optOut.oneClick } : {}) };
}

// ---------- The mails ----------

const weekdayName = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", weekday: "long" });
const dayOfMonth = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "numeric", month: "long" });
const fullDay = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long", year: "numeric" });

/**
 * To a customer login before its invitation (User Management → Zugänge → „Ankündigung senden“, 10.11.2026): the day
 * the activation link comes, Ali and Omed as the faces of hub and service platform, a short guide to the first
 * sign-in, what the hub offers and what to do now. The same text for everyone, without names (user's wish). `day` is
 * the day of the invitations (at most a week ahead, so the text names it by its weekday; the subject adds the date, as
 * the mail arrives days before and stays in the inbox, 17.11.2026), `sender` the hub's address, `days` how long the
 * activation link lives, `hubUrl` where to sign in later.
 */
export function accessAnnouncementMail(input: { day: Date; sender: string; days: number; hubUrl: string }, legal?: MailLegal): MailContent {
  const weekday = weekdayName.format(input.day);
  const hub = safeUrl(input.hubUrl);
  return render({
    subject: `Ab ${weekday}, ${dayOfMonth.format(input.day)}: dein Zugang zum oalab Client Hub`,
    preheader: `Am ${fullDay.format(input.day)} kommt dein persönlicher Aktivierungslink von ${input.sender}.`,
    area: "account",
    heading: `Dein Zugang kommt am ${weekday}`,
    lead: "Damit unsere Zusammenarbeit noch einfacher wird, bekommst du einen eigenen Zugang zum oalab Client Hub, unserem Kundenportal.",
    hosts: [
      { image: "host-ali", side: "left", name: "Ali von oalab · Client Hub", hello: "Hallo, lieber oalab-Kunde!", line: `Ab ${weekday} begrüße ich dich im Client Hub. Dort findest du alles rund um unsere Zusammenarbeit.` },
      { image: "host-omed", side: "right", name: "Omed von oalab · Serviceplattform", hello: "Was sollen wir verbessern?", line: "Mit unserer eigens entwickelten KI-Plattform sind Anpassungen an deinen Projekten jetzt direkt möglich." },
    ],
    // The guide follows the real flow: the activation mail (passwordLinkMail, subject and button as named here), the
    // page „Ein neues Passwort“ (button „Passwort speichern“, at least eight characters), then signed in. Customers have
    // no second factor unless they choose one in their profile.
    guide: {
      tile: "mail-tile",
      date: fullDay.format(input.day),
      line: "So kommst du Schritt für Schritt in den Client Hub:",
      steps: [
        { title: "Einladung öffnen", text: `Am ${weekday} kommt eine E-Mail von ${input.sender} mit dem Betreff „Dein Zugang zum oalab Client Hub“. Nicht im Posteingang? Dann schau bitte im Spam-Ordner nach.` },
        { title: "Passwort festlegen", text: `Tippe in der E-Mail auf „Passwort festlegen“. Gib dein neues Passwort zweimal ein (mindestens acht Zeichen) und tippe auf „Passwort speichern“. Der Link ist ${input.days === 1 ? "einen Tag" : `${input.days} Tage`} gültig.` },
        hub
          ? { title: "Anmelden", text: "Danach bist du direkt angemeldet. Später meldest du dich hier mit deiner E-Mail-Adresse und deinem Passwort an:", link: { label: new URL(hub).host, url: hub } }
          : { title: "Anmelden", text: "Danach bist du direkt angemeldet. Später meldest du dich mit deiner E-Mail-Adresse und deinem Passwort an." },
        { title: "Loslegen", text: "Nicht wundern: Am Anfang siehst du noch nicht alle deine Daten. Wir pflegen sie nach und nach ein, auch deinen Servicevertrag und die dazugehörigen Rechnungen. Schreiben kannst du uns aber sofort unter „Nachrichten“." },
      ],
    },
    listTitle: "Das erwartet dich im Client Hub",
    list: [
      { area: "projects", label: "Projekte anpassen", title: "Änderungen direkt beauftragen", body: "Über unser automatisches Anpassungssystem gibst du Änderungen an deinen Projekten direkt bei uns in Auftrag und siehst jederzeit, wie weit sie sind." },
      { area: "files", label: "Deine Dateien", title: "Alles zum Herunterladen", body: "Alles, was wir für dich erstellt haben, kannst du jederzeit herunterladen." },
      { area: "messages", label: "Nachrichten", title: "Direkter Draht zu uns", body: "Unter „Nachrichten“ schreibst du uns direkt." },
      { area: "calendar", label: "Termine", title: "Termin anfragen", body: "Im Kalender siehst du, wann wir Zeit haben, und fragst einen Termin bei uns an. Er ist mit unserem Kalender abgestimmt." },
      { area: "contracts", label: "Vertrag & Domain", title: "Domain und Postfächer im Blick", body: "Hier siehst du den aktuellen Stand deiner gebuchten Domain und deiner E-Mail-Postfächer." },
    ],
    note: { tone: "todo", text: `Damit die Einladung sicher ankommt: Speichere ${input.sender} am besten gleich in deinen Kontakten.` },
    signoff: { text: "Wir freuen uns auf dich im Client Hub!", from: "Dein oalab-Team" },
    reason: "Du bekommst diese E-Mail, weil du bei oalab einen Zugang zum Client Hub bekommst.",
    legal,
  });
}

/**
 * Before the official start of hub and service platform (25.11.2026), to every customer login, signed in already or
 * not yet: the day of the start, Ali and Omed again, the address the login uses with the question whether it should be
 * another one (answered by reply, as the hub cannot change a login's address itself), what hub and service platform
 * offer and, for logins nobody has signed in with, the way in through „Passwort vergessen?“, which works without a
 * password ever set. The same text for everyone, without names; only the address and that way in differ. `day` is the
 * day of the start (named by its weekday, like the announcement), `email` the login's address, `active` whether anybody
 * has signed in with it, `sender` the hub's address, `hubUrl` and `serviceUrl` where hub and service platform live.
 */
export function launchReminderMail(input: { day: Date; email: string; active: boolean; sender: string; hubUrl: string; serviceUrl: string }, legal?: MailLegal): MailContent {
  const weekday = weekdayName.format(input.day);
  const date = dayOfMonth.format(input.day);
  const hub = safeUrl(input.hubUrl);
  const service = safeUrl(input.serviceUrl);
  const forgot = hub ? safeUrl(new URL("/auth/forgot-password", hub).toString()) : "";
  const start = `Am ${date} starten der oalab Client Hub und unsere Serviceplattform offiziell.`;
  return render({
    subject: `Start am ${weekday}, ${date}: Client Hub und Serviceplattform`,
    preheader: "Was dich erwartet und eine kurze Bitte: Prüf, ob dein Zugang auf die richtige E-Mail-Adresse läuft.",
    area: "news",
    heading: `Am ${weekday} geht’s los`,
    lead: input.active
      ? `${start} Schön, dass du schon dabei bist! Hier noch einmal das Wichtigste.`
      : `${start} Dein Zugang ist schon eingerichtet, es fehlt nur noch dein Passwort. Hier noch einmal das Wichtigste.`,
    hosts: [
      { image: "host-ali", side: "left", name: "Ali von oalab · Client Hub", hello: "Hallo, lieber oalab-Kunde!", line: `Am ${weekday} starten wir offiziell. Im Client Hub findest du alles rund um unsere Zusammenarbeit.` },
      { image: "host-omed", side: "right", name: "Omed von oalab · Serviceplattform", hello: "Was sollen wir verbessern?", line: "Auf unserer eigens entwickelten KI-Plattform beauftragst du Anpassungen an deinen Projekten direkt bei uns." },
    ],
    details: [
      { label: "Anmeldung mit", value: input.email },
      { label: "Gilt für", value: "Client Hub und Serviceplattform" },
      input.active ? { label: "Status", value: "Aktiv", tone: "ok" } : { label: "Status", value: "Noch nicht aktiviert", tone: "todo" },
    ],
    notice: {
      area: "account",
      label: "Dein Zugang",
      title: "Passt diese E-Mail-Adresse?",
      chip: ["Bitte prüfen", "todo"],
      body: `Soll dein Zugang über eine andere Adresse laufen, etwa deine persönliche statt einer Sammeladresse? Dann antworte einfach auf diese E-Mail und nenn uns die neue Adresse, am besten noch vor ${weekday}. ${input.active ? "Wir stellen deinen Zugang dann um." : "Passt sie, aktivierst du deinen Zugang wie unten beschrieben."}`,
    },
    // Logins without a first sign-in: „Passwort vergessen?“ mails a fresh link to every login that is neither
    // deactivated nor rejected (requestPasswordResetAction), so it works when the invitation has run out; the link mail
    // is passwordLinkMail without activation (button „Neues Passwort festlegen“), the page saves with „Passwort speichern“.
    guide: input.active ? undefined : {
      tile: "mail-tile",
      date: "Dein Zugang wartet auf dich",
      line: "So aktivierst du ihn in drei Schritten:",
      steps: [
        { title: "Link anfordern", text: `Auf der Anmeldeseite unter „Passwort vergessen?“ gibst du ${input.email} ein. Das klappt auch, wenn du noch nie ein Passwort hattest. Kurz darauf kommt eine E-Mail von ${input.sender}.`, ...(forgot ? { link: { label: "Link anfordern", url: forgot } } : {}) },
        { title: "Passwort festlegen", text: "Tippe in der E-Mail auf „Neues Passwort festlegen“, gib dein Passwort zweimal ein (mindestens acht Zeichen) und tippe auf „Passwort speichern“. Keine E-Mail da? Dann schau bitte im Spam-Ordner nach." },
        { title: "Loslegen", text: "Danach bist du angemeldet, im Client Hub und mit demselben Zugang auch auf der Serviceplattform." },
      ],
    },
    listTitle: "Das erwartet dich",
    list: [
      { area: "projects", label: "Serviceplattform", title: "Anpassungen direkt beauftragen", body: `${service ? `Auf ${new URL(service).host}` : "Auf der Serviceplattform"} beschreibst du, was wir an deiner Website oder deinen Projekten ändern sollen, und siehst jederzeit, wie weit es ist. Mit demselben Zugang und im Rahmen deines Servicepakets.`, ...(service ? { link: { label: "Zur Serviceplattform", url: service } } : {}) },
      { area: "messages", label: "Nachrichten", title: "Direkter Draht zu uns", body: "Fragen und Absprachen schreibst du uns unter „Nachrichten“, so oft du willst. Das zählt nicht als Service-Anfrage." },
      { area: "projects", label: "Projekte & Notizen", title: "Immer auf dem aktuellen Stand", body: "Status, Fortschritt und Zieltermine deiner Projekte, die Aufgaben, bei denen du am Zug bist, und unsere gemeinsamen Notizen." },
      { area: "files", label: "Dateien", title: "Alles zum Herunterladen", body: "Alles, was wir für dich erstellt haben, jederzeit zum Herunterladen." },
      { area: "calendar", label: "Termine", title: "Termin anfragen", body: "Im Kalender siehst du, wann wir Zeit haben, und fragst einen Termin an. Mit dem Kalender-Abo stehen deine Termine auch in deinem eigenen Kalender." },
      { area: "contracts", label: "Vertrag & Domain", title: "Pakete, Domain und Postfächer", body: "Hier siehst du deine Pakete, den Stand deiner Domain und deine E-Mail-Postfächer." },
    ],
    cta: input.active ? { label: "Zum Client Hub", url: hub } : { label: "Zugang aktivieren", url: forgot },
    small: input.active ? "Passwort nicht mehr zur Hand? Auf der Anmeldeseite schickt dir „Passwort vergessen?“ jederzeit einen neuen Link." : undefined,
    signoff: { text: "Wir freuen uns auf den Start mit dir!", from: "Dein oalab-Team" },
    reason: "Du bekommst diese E-Mail, weil du einen Zugang zum oalab Client Hub hast.",
    legal,
    // Only the dark version (user, 25.11.2026): the same look in light and dark mode.
    dark: true,
  });
}

// ---------- The start series (26.11.2026): the launch mail and three info mails on the Fridays after it ----------

/**
 * What every mail of the series needs: the login's address, whether anybody has signed in with it (else the button
 * activates the login, as in launchReminderMail), the hub's sender address, where hub and service platform live,
 * oalab's phone number for questions and the login's own signed links to stop the info mails.
 */
export type StartSeriesInput = { email: string; active: boolean; sender: string; hubUrl: string; serviceUrl: string; phone: string; optOut: MailOptOut };
export type StartSeriesKind = "launch" | "service" | "hub" | "outlook";

/**
 * The launch bonus (user, 26.11.2026): six months with more requests on the service platform. The platform knows no
 * credits, only new requests a month (Service Lite 5, Max 20), counted only while „Service-Kontingente“ is switched on;
 * it is off, so the bonus reads as no monthly limit, which also holds for customers without a service package.
 */
const START_BONUS_UNTIL = "Ende Mai 2027";
const START_BONUS = `Bis ${START_BONUS_UNTIL} gilt auf der Serviceplattform für dich keine monatliche Grenze: Du stellst so viele neue Anfragen, wie du brauchst.`;

/** The three info mails after the start, one each Friday (user, 26.11.2026); the launch mail announces them in this order. */
export const START_INFO_MAILS: { kind: Exclude<StartSeriesKind, "launch">; day: string; title: string; text: string }[] = [
  { kind: "service", day: "2026-12-04", title: "Die Serviceplattform", text: "Wofür sie da ist, wie du eine Anfrage stellst, was sie kann und was nicht und ab wann du das Ergebnis auf deiner Website siehst." },
  { kind: "hub", day: "2026-12-11", title: "Der Client Hub", text: "Projekte, Notizen, Dateien und Nachrichten: wie der Hub unsere Zusammenarbeit und unsere Kommunikation einfacher macht." },
  { kind: "outlook", day: "2026-12-18", title: "Ein Blick nach vorn", text: "Woran wir gerade arbeiten, darunter unsere eigene SEO-Plattform, und wie es mit den Servicepaketen weitergeht." },
];

const seriesDay = (day: string) => { const date = new Date(`${day}T12:00:00Z`); return `${weekdayName.format(date)}, ${dayOfMonth.format(date)}`; };
const START_REASON = "Du bekommst diese E-Mail, weil du einen Zugang zum oalab Client Hub hast.";
const ALI = { image: "host-ali", side: "left" as const, name: "Ali von oalab · Client Hub" };
const OMED = { image: "host-omed", side: "right" as const, name: "Omed von oalab · Serviceplattform" };

/** The way in for logins nobody has signed in with: „Passwort vergessen?“ works without a password ever set. */
function startSeriesButton(input: StartSeriesInput, cta: { label: string; url: string }): Pick<Mail, "cta" | "small"> {
  if (input.active) return { cta };
  const hub = safeUrl(input.hubUrl);
  return {
    cta: { label: "Zugang aktivieren", url: hub ? safeUrl(new URL("/auth/forgot-password", hub).toString()) : "" },
    small: `Dein Zugang wartet noch auf dich: Auf der Anmeldeseite unter „Passwort vergessen?“ gibst du ${input.email} ein und legst über den Link aus der E-Mail dein Passwort fest. Das klappt auch, wenn du noch nie ein Passwort hattest.`,
  };
}

/** The line under each info mail that names the next one. */
function nextInfoMail(kind: StartSeriesKind) {
  const index = START_INFO_MAILS.findIndex((mail) => mail.kind === kind);
  const next = START_INFO_MAILS[index + 1];
  return next ? `Nächste Infomail am ${seriesDay(next.day)}: ${next.title}.` : undefined;
}

/**
 * On the day of the start (26.11.2026), to every customer login: congratulations on being there from the start, the
 * launch bonus, what hub and service platform are for, the three info mails ahead and how to reach oalab.
 */
export function launchDayMail(input: StartSeriesInput, legal?: MailLegal): MailContent {
  const hub = safeUrl(input.hubUrl);
  const service = safeUrl(input.serviceUrl);
  return render({
    subject: "Wir sind live: Client Hub und Serviceplattform starten heute",
    preheader: "Danke, dass du von Anfang an dabei bist: dein Startbonus und was dich in den nächsten drei Wochen erwartet.",
    area: "news",
    heading: "Wir sind live!",
    lead: `Heute starten der oalab Client Hub und unsere Serviceplattform offiziell, und du bist von Anfang an dabei. Herzlichen Glückwunsch und danke, dass du diesen Weg mit uns gehst!${input.active ? "" : " Dein Zugang ist schon eingerichtet, es fehlt nur noch dein Passwort."}`,
    hosts: [
      { ...ALI, hello: "Herzlichen Glückwunsch!", line: "Du gehörst zu unseren ersten Kunden im Client Hub. Ab heute läuft hier unsere ganze Zusammenarbeit zusammen." },
      { ...OMED, hello: "Dein Startbonus ist da!", line: "Als Dankeschön gilt auf unserer Serviceplattform sechs Monate lang keine Grenze für deine Anfragen." },
    ],
    notice: {
      area: "news",
      label: "Startbonus",
      title: "Sechs Monate ohne Anfragen-Grenze",
      chip: ["Für dich", "ok"],
      body: `${START_BONUS} In dieser Zeit schauen wir uns an, wie viele Anfragen wirklich gebraucht werden, und passen danach unsere Servicepakete daran an. Darüber informieren wir dich rechtzeitig.`,
    },
    listTitle: "Wofür Client Hub und Serviceplattform da sind",
    list: [
      { area: "projects", label: "Client Hub", title: "Unsere Zusammenarbeit an einem Ort", body: "Projekte, Termine, Notizen, Dateien und Nachrichten: Im Client Hub siehst du jederzeit, woran wir für dich arbeiten und wo deine Rückmeldung gefragt ist.", ...(hub ? { link: { label: "Zum Client Hub", url: hub } } : {}) },
      { area: "news", label: "Serviceplattform", title: "Änderungen direkt beauftragen", body: `${service ? `Auf ${new URL(service).host}` : "Auf der Serviceplattform"} beschreibst du, was sich an deiner Website ändern soll, prüfst das Ergebnis auf einer Testseite und gibst es mit „Gefällt mir“ frei. Mit demselben Zugang wie im Client Hub.`, ...(service ? { link: { label: "Zur Serviceplattform", url: service } } : {}) },
      { area: "messages", label: "Nachrichten", title: "Direkter Draht zu uns", body: `Fragen und Absprachen schreibst du uns im Client Hub unter „Nachrichten“, so oft du willst; das zählt nicht als Service-Anfrage. Lieber telefonieren? Ruf uns an: ${input.phone}.` },
    ],
    listFirst: true,
    guide: {
      tile: "calendar-tile",
      date: "Deine nächsten drei Wochen",
      line: "Jeden Freitag bekommst du eine kurze Infomail zu einem Thema:",
      steps: START_INFO_MAILS.map((mail) => ({ title: `${seriesDay(mail.day)}: ${mail.title}`, text: mail.text })),
    },
    ...startSeriesButton(input, { label: "Zum Client Hub", url: hub }),
    signoff: { text: "Danke für dein Vertrauen. Wir freuen uns auf alles, was wir gemeinsam umsetzen!", from: "Dein oalab-Team" },
    reason: START_REASON,
    unsubscribe: input.optOut,
    legal,
    dark: true,
  });
}

/** Info mail 1 (Friday, 4.12.2026): what the service platform is for, how a request works, its limits and results. */
export function serviceInfoMail(input: StartSeriesInput, legal?: MailLegal): MailContent {
  const service = safeUrl(input.serviceUrl);
  const host = service ? new URL(service).host : "der Serviceplattform";
  return render({
    subject: "Infomail 1 von 3: So nutzt du die Serviceplattform",
    preheader: "Wofür die Serviceplattform da ist, wie du eine Anfrage stellst und ab wann du das Ergebnis auf deiner Website siehst.",
    area: "news",
    heading: "Die Serviceplattform im Detail",
    lead: "Wie angekündigt, heute das erste Thema unserer kleinen Reihe: die Serviceplattform. Hier erfährst du, wofür sie da ist, wie du eine Anfrage stellst, was sie kann und was nicht und ab wann du das Ergebnis auf deiner Website siehst.",
    // Facts from service-oalab (26.11.2026): the new-request page greets with Omed and „Was sollen wir für dich
    // verbessern?“; one text field with images (plus button, Strg+V, dragging; PNG, JPEG or WebP up to 25 MB) and
    // dictation, the website to choose only with more than one, „Anfrage senden“, then the conversation. Every change is
    // built on the test site first; „Gefällt mir“ is required before the team's „Live schalten“ for exactly that version.
    // No duration is promised anywhere, and whether AI replies go out at once or after a team check is a setting.
    hosts: [{ ...OMED, hello: "Was sollen wir für dich verbessern?", line: `Mit dieser Frage begrüße ich dich bei jeder neuen Anfrage auf ${host}. Beschreib in deinen Worten, was sich ändern soll, den Rest übernehmen wir.` }],
    notice: {
      area: "news",
      label: "Wofür sie da ist",
      title: "Änderungen an deiner Website, direkt beauftragt",
      body: "Dir fällt ein Fehler auf, ein Text soll sich ändern oder du hast eine Idee für deine Website? Dafür ist die Serviceplattform da. Jede Anfrage bekommt ihr eigenes Gespräch, in dem sich unser KI-Assistent und das oalab-Team bei dir melden. Jede Änderung entsteht zuerst auf einer Testseite; deine Live-Website bleibt bis zu deinem Okay, wie sie ist.",
    },
    guide: {
      tile: "mail-tile",
      date: "So stellst du eine Anfrage",
      line: "In drei Schritten:",
      steps: [
        { title: "Neues Gespräch starten", text: `Öffne ${host} und tippe auf „Neues Gespräch“. Aus dem Client Hub kommst du unter „Nachrichten“ mit „Anfrage stellen“ direkt hin. Bist du im Hub angemeldet, bist du es dort auch.`, ...(service ? { link: { label: "Zur Serviceplattform", url: service } } : {}) },
        { title: "Beschreiben, was sich ändern soll", text: "Schreib oder diktier in deinen Worten, was du brauchst. Screenshots helfen uns sehr: über den Plus-Knopf, mit Strg+V oder einfach ins Feld ziehen. Hast du mehrere Websites, wählst du noch aus, um welche es geht." },
        { title: "Anfrage senden", text: "Tippe auf „Anfrage senden“. Danach öffnet sich das Gespräch zu deiner Anfrage. Dort stellen wir Rückfragen, und du kannst jederzeit etwas ergänzen." },
      ],
    },
    listTitle: "Gut zu wissen",
    list: [
      { area: "projects", label: "Das kann sie", title: "Jede Anfrage im Blick", body: "In der Liste deiner Gespräche siehst du, was auf dich wartet, was in Arbeit und was erledigt ist, und oben im Gespräch den Fortschritt: Angekommen, In Arbeit, Testseite, Live. Brauchst du eine Anfrage nicht mehr, schließt du sie selbst." },
      { area: "security", label: "Das kann sie nicht", title: "Allgemeine Fragen und andere Dateien", body: "Die Serviceplattform ist für Änderungen an deinen Websites da. Fragen und Absprachen ohne Auftrag schreibst du uns im Client Hub unter „Nachrichten“. Als Anhang nimmt sie Bilder (PNG, JPG oder WebP bis 25 MB), keine anderen Dateien." },
      { area: "files", label: "Das Ergebnis", title: "Zuerst auf der Testseite", body: "Ist deine Änderung fertig, steht sie auf „Testseite bereit“. Im Gespräch öffnest du die Testvorschau und siehst Vorher, Nachher und was wir geprüft haben. Dann entscheidest du: „Gefällt mir“ oder „Gefällt mir noch nicht“, und wir arbeiten weiter." },
      { area: "news", label: "Auf deiner Website", title: "Live nach deinem „Gefällt mir“", body: "Erst wenn dir die Änderung gefällt, schaltet das oalab-Team sie auf deiner Website live; ohne deine Zustimmung geht nichts online. Ob sie schon live ist, zeigt dir der Schritt „Live“ im Gespräch. Oben im Gespräch führen „Testseite“ und „Live-Website“ direkt zu beiden Fassungen." },
      { area: "messages", label: "Benachrichtigung", title: "Du verpasst keine Antwort", body: "Antworten wir dir, sagen wir Bescheid: mit einer Mitteilung auf deinem Gerät, wenn du sie erlaubt hast, sonst nach einer Viertelstunde per E-Mail." },
    ],
    more: nextInfoMail("service"),
    note: { tone: "info", text: `Startbonus: ${START_BONUS} Fragen und Absprachen im Client Hub zählen ohnehin nie als Anfrage.` },
    ...startSeriesButton(input, { label: "Zur Serviceplattform", url: service }),
    signoff: { text: "Wir freuen uns auf deine Anfragen!", from: "Dein oalab-Team" },
    reason: START_REASON,
    unsubscribe: input.optOut,
    legal,
    dark: true,
  });
}

/** Info mail 2 (Friday, 11.12.2026): the client hub, area by area, as the place of collaboration and communication. */
export function hubInfoMail(input: StartSeriesInput, legal?: MailLegal): MailContent {
  const hub = safeUrl(input.hubUrl);
  return render({
    subject: "Infomail 2 von 3: Der Client Hub im Detail",
    preheader: "Projekte, Notizen, Dateien und Nachrichten: So macht der Client Hub unsere Zusammenarbeit einfacher.",
    area: "news",
    heading: "Der Client Hub im Detail",
    lead: "Heute geht es um den Client Hub, den Ort, an dem unsere Zusammenarbeit und unsere Kommunikation zusammenlaufen. Statt verstreuter E-Mails, Anhänge und Telefonnotizen hast du hier alles an einem Platz, und wir beide sehen jederzeit denselben Stand.",
    hosts: [{ ...ALI, hello: "Schön, dass du da bist!", line: "Ich zeige dir, was im Client Hub alles steckt. Du triffst mich übrigens jedes Mal in deiner Übersicht." }],
    listTitle: "Das findest du im Client Hub",
    list: [
      { area: "news", label: "Übersicht", title: "Auf einen Blick, was neu ist", body: "Deine Pakete, die neuesten Benachrichtigungen und der direkte Weg zur Serviceplattform. Die Glocke oben rechts zeigt, was ungelesen ist; Neuigkeiten kommen zusätzlich gebündelt per Mail." },
      { area: "projects", label: "Projekte", title: "Immer wissen, wo dein Projekt steht", body: "Deine Projekte mit uns stehen im Hub, mit Status, Fortschritt, Meilenstein und nächstem Termin. Wie in einem gemeinsamen Projektmanagement siehst du in den Details die Aufgaben und ob gerade wir oder du am Zug sind. Was auf deine Rückmeldung wartet, steht unter „Dein Feedback“." },
      { area: "projects", label: "Notizen", title: "Gemeinsame Seiten statt verstreuter Mails", body: "Unter Projekte › Notizen teilen wir Seiten mit dir, etwa Besprechungsnotizen, Briefings oder Abnahmen. Wo wir es freigeben, schreibst du direkt mit; gespeichert wird von selbst." },
      { area: "files", label: "Dateien", title: "Alles zum Herunterladen", body: "Logos, Designs, Dokumente, Verträge und Rechnungen, die wir für dich bereitstellen, lädst du einzeln oder als ZIP herunter und sortierst sie in eigene Ordner." },
      { area: "messages", label: "Nachrichten", title: "Dein direkter Draht zu uns", body: "Ein privater Chat für dein Unternehmen, den alle Zugänge deiner Firma sehen. Zwei Häkchen zeigen, dass wir gelesen haben, und was wir für dich ändern, etwa neue Dateien oder Termine, erscheint dort als Karte." },
      { area: "calendar", label: "Kalender", title: "Termine direkt anfragen", body: "Unter Projekte › Kalender siehst du, wann wir Zeit haben, und fragst einen Termin an. Mit dem Kalender-Abo stehen deine Termine auch in deinem eigenen Kalender." },
      { area: "contracts", label: "Vertrag & Domain", title: "Pakete, Domain und Postfächer", body: "Deine Pakete, Zahlungen, Domain und E-Mail-Adressen und, wenn wir deine E-Mail betreuen, eine Anleitung zum Einrichten deines Mailprogramms." },
    ],
    more: nextInfoMail("hub"),
    note: { tone: "info", text: "Auf dem Handy holst du dir den Client Hub mit „App installieren“ neben der Glocke als App auf den Startbildschirm." },
    ...startSeriesButton(input, { label: "Zum Client Hub", url: hub }),
    signoff: { text: "Schau gern gleich mal rein!", from: "Dein oalab-Team" },
    reason: START_REASON,
    unsubscribe: input.optOut,
    legal,
    dark: true,
  });
}

/** Info mail 3 (Friday, 18.12.2026): a sneak peek at oalab's own SEO platform and what follows the launch bonus. */
export function outlookInfoMail(input: StartSeriesInput, legal?: MailLegal): MailContent {
  const hub = safeUrl(input.hubUrl);
  return render({
    subject: "Infomail 3 von 3: Ein Blick hinter die Kulissen",
    preheader: "Woran wir gerade arbeiten: unsere eigene SEO-Plattform und wie es nach dem Startbonus mit den Servicepaketen weitergeht.",
    area: "news",
    heading: "Woran wir gerade arbeiten",
    lead: "Zum Abschluss unserer kleinen Reihe werfen wir einen Blick nach vorn: woran wir gerade arbeiten, damit du mit oalab noch besser fährst, und wie es nach deinem Startbonus weitergeht.",
    hosts: [
      { ...OMED, hello: "Ein kleiner Sneak Peek!", line: "Wir bauen gerade unsere eigene SEO-Plattform. Was dahintersteckt, liest du unten." },
      { ...ALI, hello: "Danke fürs Mitlesen!", line: "Das war unsere kleine Reihe. Im Client Hub bleibst du ab jetzt immer auf dem Laufenden." },
    ],
    notice: {
      area: "news",
      label: "Sneak Peek",
      title: "Unsere eigene SEO-Plattform",
      chip: ["In Arbeit", "info"],
      body: "Wir entwickeln gerade eine eigene SEO-Plattform, damit deine Website in Suchmaschinen wie Google noch besser gefunden wird und du ein noch besseres Erlebnis mit uns hast. Sobald es so weit ist, erfährst du es hier zuerst.",
    },
    listTitle: "Was als Nächstes kommt",
    list: [
      { area: "contracts", label: "Servicepakete", title: "Neue Preismodelle nach dem Startbonus", body: `Dein Startbonus ohne Anfragen-Grenze läuft bis ${START_BONUS_UNTIL}. Bis dahin sehen wir uns an, wie viele Anfragen tatsächlich gebraucht werden. Danach kommen angepasste Preismodelle, die mit deinem Servicevertrag verknüpft sind. Wir informieren dich rechtzeitig, bevor sich etwas ändert.` },
      { area: "messages", label: "Kontakt", title: "Fragen? Wir sind für dich da", body: `Schreib uns im Client Hub unter „Nachrichten“ oder ruf uns an: ${input.phone}.` },
    ],
    ...startSeriesButton(input, { label: "Zum Client Hub", url: hub }),
    signoff: { text: "Danke, dass du von Anfang an dabei bist. Wir wünschen dir schöne Feiertage und einen guten Start ins neue Jahr!", from: "Dein oalab-Team" },
    reason: START_REASON,
    unsubscribe: input.optOut,
    legal,
    dark: true,
  });
}

/** One mail of the start series by its kind (User Management → „Startmails senden“). */
export function startSeriesMail(kind: StartSeriesKind, input: StartSeriesInput, legal?: MailLegal): MailContent {
  return { launch: launchDayMail, service: serviceInfoMail, hub: hubInfoMail, outlook: outlookInfoMail }[kind](input, legal);
}

const REGISTRATION_REASON = "Diese E-Mail gehört zu deiner Registrierung beim oalab Client Hub.";
const ACCOUNT_REASON = "Diese E-Mail gehört zu deinem Zugang zum oalab Client Hub.";
const LINK_VALIDITY: Row = { label: "Link gültig", value: "einmal, zeitlich begrenzt" };
const firstNameOf = (firstName: string) => firstName.trim();

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

/** To the oalab team: a confirmed registration waits for approval, the person as a contact card. */
export function teamRegistrationMail(details: RegistrationDetails, reviewUrl: string, legal?: MailLegal): MailContent {
  const name = `${details.firstName} ${details.lastName}`.trim() || details.email;
  const site = website(details.website);
  const reach: Reach[] = [];
  if (details.email) reach.push({ glyph: "mail", text: details.email, href: mailtoUrl(details.email) || undefined });
  if (details.phone.trim()) reach.push({ glyph: "phone", text: details.phone.trim(), href: telUrl(details.phone) || undefined });
  if (site) reach.push({ glyph: "globe", text: site.shown, href: site.url });
  else if (details.website.trim()) reach.push({ glyph: "globe", text: details.website.trim() });
  if (details.customerNumberHint.trim()) reach.push({ glyph: "hash", text: details.customerNumberHint.trim(), note: "Kundennummer laut Angabe" });
  return render({
    subject: `Neue Registrierung: ${name}${details.companyName ? ` (${details.companyName})` : ""}`,
    preheader: `${name} wartet auf die Freigabe im Client Hub.`,
    area: "users",
    heading: "Neue Registrierung wartet auf Freigabe",
    lead: `${name} hat sich für den oalab Client Hub registriert und die E-Mail-Adresse bestätigt.`,
    card: {
      label: "Neue Registrierung", badge: { text: "Wartet auf Freigabe", tone: "todo" }, name, role: details.position.trim(), company: details.companyName.trim(), reach,
      footnote: details.registeredAt ? `Registriert am ${details.registeredAt} · E-Mail-Adresse bestätigt` : "E-Mail-Adresse bestätigt",
    },
    quote: details.message.trim() ? { label: "Nachricht", value: details.message.trim() } : undefined,
    note: { tone: "team", text: `Prüfe die Angaben und schalte den Zugang frei oder lehne ab. Eine Antwort auf diese E-Mail geht direkt an ${name}.` },
    cta: { label: "Registrierung prüfen", url: reviewUrl },
    reason: "Du bekommst diese E-Mail als Admin des oalab Client Hub.",
    legal,
  });
}

/** To the person: their registration arrived and is being reviewed. */
export function registrationReceivedMail(input: { firstName: string; contact: string; email?: string; loginUrl?: string }, legal?: MailLegal): MailContent {
  const first = firstNameOf(input.firstName);
  return render({
    subject: "Deine Registrierung ist eingegangen",
    preheader: "Dein oalab-Team prüft jetzt deine Angaben.",
    area: "account",
    heading: first ? `Danke, ${first} – deine Registrierung ist da` : "Danke – deine Registrierung ist da",
    lead: "Dein oalab-Team prüft jetzt deine Angaben und schaltet deinen Zugang frei.",
    details: [
      { label: "Stand", value: "In Prüfung", tone: "info" },
      { label: "Nächster Schritt", value: "Freischaltung durch dein oalab-Team" },
      { label: "Bescheid", value: input.email ? `per E-Mail an ${input.email}` : "per E-Mail" },
    ],
    note: { tone: "info", text: "Du musst nichts tun. Nach der Anmeldung siehst du jederzeit den Stand deiner Registrierung." },
    cta: input.loginUrl ? { label: "Stand ansehen", url: input.loginUrl } : undefined,
    small: `Du hast dich nicht registriert? Dann ignoriere diese E-Mail oder schreib uns an ${input.contact}.`,
    reason: REGISTRATION_REASON,
    legal,
  });
}

/**
 * To the person, right after the registration form: confirm the e-mail address. The hub sends it itself since the
 * shared Supabase project of Hub and Service keeps public sign-ups closed; wording as supabase/templates/confirmation.html.
 */
export function registrationConfirmationMail(input: { firstName: string; link: string; email?: string }, legal?: MailLegal): MailContent {
  const first = firstNameOf(input.firstName);
  return render({
    subject: "Bestätige deine E-Mail-Adresse für den oalab Client Hub",
    preheader: "Ein Klick, dann prüft dein oalab-Team deine Registrierung.",
    area: "account",
    heading: "Bestätige deine E-Mail-Adresse",
    lead: `Schön, dass du dich registriert hast${first ? `, ${first}` : ""}. Ein Klick noch, dann geht deine Registrierung an dein oalab-Team.`,
    details: [...(input.email ? [{ label: "E-Mail-Adresse", value: input.email }] : []), LINK_VALIDITY],
    note: { tone: "todo", text: "Bestätige deine Adresse über den Button. Danach prüft dein oalab-Team deine Angaben und schaltet deinen Zugang frei." },
    cta: { label: "E-Mail-Adresse bestätigen", url: input.link },
    small: "Du hast dich nicht registriert? Dann kannst du diese E-Mail ignorieren.",
    reason: REGISTRATION_REASON,
    legal,
  });
}

/** To the person: access approved, with the login link. */
export function accessApprovedMail(input: { firstName: string; email: string; loginUrl: string; company: string | null; customerNumber: string | null }, legal?: MailLegal): MailContent {
  const first = firstNameOf(input.firstName);
  return render({
    subject: "Dein Zugang zum oalab Client Hub ist freigeschaltet",
    preheader: "Du kannst dich ab sofort anmelden.",
    area: "account",
    heading: first ? `Willkommen im Client Hub, ${first}!` : "Willkommen im Client Hub!",
    lead: "Dein Zugang ist freigeschaltet. Deine Projekte, Dateien und Termine liegen ab jetzt an einem Ort.",
    details: [
      ...(input.company ? [{ label: "Unternehmen", value: input.company }] : []),
      ...(input.customerNumber ? [{ label: "Kundennummer", value: input.customerNumber }] : []),
      { label: "Anmeldung mit", value: input.email },
      { label: "Stand", value: "Freigeschaltet", tone: "ok" as const },
    ],
    note: { tone: "todo", text: "Melde dich mit deiner E-Mail-Adresse und deinem Passwort an." },
    cta: { label: "Zum Client Hub", url: input.loginUrl },
    reason: ACCOUNT_REASON,
    legal,
  });
}

/** To the person: the registration was not approved, with the team's note if there is one. */
export function registrationRejectedMail(input: { firstName: string; note: string; contact?: string }, legal?: MailLegal): MailContent {
  const reply = input.contact ? mailtoUrl(input.contact, "Registrierung Client Hub") : "";
  return render({
    subject: "Deine Registrierung beim oalab Client Hub",
    preheader: "Wir konnten deinen Zugang leider nicht freischalten.",
    area: "account",
    heading: "Deine Registrierung wurde nicht freigegeben",
    lead: "Wir haben deine Angaben geprüft und können dir leider keinen Zugang zum oalab Client Hub freischalten.",
    details: [{ label: "Stand", value: "Nicht freigegeben", tone: "off" }],
    quote: input.note.trim() ? { label: "Hinweis deines oalab-Teams", value: input.note.trim() } : undefined,
    note: { tone: "info", text: "Ist das ein Irrtum? Antworte einfach auf diese E-Mail, wir melden uns." },
    cta: reply ? { label: "Dem oalab-Team antworten", url: reply } : undefined,
    reason: REGISTRATION_REASON,
    legal,
  });
}

const linkUntil = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** „Mittwoch, 18. November 2026, 20:15 Uhr“, in German time. */
export const formatLinkUntil = (until: Date) => `${linkUntil.format(until).replace(" um ", ", ")} Uhr`;

/**
 * To the person: a one-time link to set the first (activation) or a new password. `validUntil` names the end of an
 * activation link when the hub knows it (own platform: a week, see lib/platform/config.ts).
 */
export function passwordLinkMail(input: { firstName: string; link: string; activation: boolean; email?: string; validUntil?: Date | null }, legal?: MailLegal): MailContent {
  const first = firstNameOf(input.firstName);
  if (input.activation) {
    const validity: Row = input.validUntil ? { label: "Link gültig bis", value: formatLinkUntil(input.validUntil) } : LINK_VALIDITY;
    return render({
      subject: "Dein Zugang zum oalab Client Hub",
      preheader: input.validUntil ? `Lege dein Passwort fest. Der Link gilt bis ${formatLinkUntil(input.validUntil)}.` : "Lege dein Passwort fest, dann bist du direkt angemeldet.",
      area: "account",
      heading: "Dein Zugang ist eingerichtet",
      lead: `Dein oalab-Team hat dir einen Zugang zum oalab Client Hub angelegt${first ? `, ${first}` : ""}.`,
      details: [...(input.email ? [{ label: "Anmeldung mit", value: input.email }] : []), validity],
      note: { tone: "todo", text: "Lege über den Button dein Passwort fest. Danach bist du direkt angemeldet." },
      cta: { label: "Passwort festlegen", url: input.link },
      small: "Ist der Link abgelaufen, schickt dir dein oalab-Team gern einen neuen.",
      reason: ACCOUNT_REASON,
      legal,
    });
  }
  return render({
    subject: "Neues Passwort für den oalab Client Hub",
    preheader: "Lege über den Button ein neues Passwort fest.",
    area: "security",
    heading: "Neues Passwort festlegen",
    lead: `Für deinen Zugang zum oalab Client Hub wurde ein neues Passwort angefordert${first ? `, ${first}` : ""}. Danach bist du direkt angemeldet.`,
    details: [...(input.email ? [{ label: "Zugang", value: input.email }] : []), LINK_VALIDITY],
    note: { tone: "security", text: "Du hast kein neues Passwort angefordert? Dann ignoriere diese E-Mail und sag deinem oalab-Team kurz Bescheid." },
    cta: { label: "Neues Passwort festlegen", url: input.link },
    reason: ACCOUNT_REASON,
    legal,
  });
}

/**
 * An admin gave a login another e-mail address (User Management › Zugang › Profil, since 23.11.2026), e.g. after the
 * launch reminder asked customers whether their login runs on the right one. The same login keeps its data and its
 * password and signs in with the new address only; the change ended its sessions and the links sent before. One mail
 * to each address, in its own words: `to: "new"` says how to sign in now (before the first sign-in: how to set the
 * password), `to: "old"` says, as a security notice, that this address no longer signs in, so a change nobody asked for
 * gets noticed. `email` is the new address as this recipient sees it: the old one gets it shortened ("an***@…", made by
 * the caller). `previous` is the old address, `activated` whether anybody signed in with the login, `serviceToo` whether
 * it reaches the service platform as well (not for freelancers), `hubUrl` where the hub lives.
 */
export function loginEmailChangedMail(input: { to: "new" | "old"; firstName: string; email: string; previous: string; activated: boolean; serviceToo: boolean; hubUrl: string }, legal?: MailLegal): MailContent {
  const first = firstNameOf(input.firstName);
  const hello = first ? `Hallo ${first}, dein` : "Dein";
  if (input.to === "old") {
    return render({
      subject: "Dein oalab-Zugang hat eine neue E-Mail-Adresse",
      preheader: "Mit dieser Adresse meldest du dich ab sofort nicht mehr an.",
      area: "security",
      heading: "Neue Adresse für deinen Zugang",
      lead: `${hello} oalab-Team hat deinen Zugang auf eine andere E-Mail-Adresse umgestellt. Mit dieser Adresse meldest du dich ab sofort nicht mehr an${input.serviceToo ? ", weder im Client Hub noch auf der Serviceplattform" : ""}.`,
      details: [{ label: "Bisher", value: input.previous }, { label: "Jetzt", value: input.email }],
      note: { tone: "security", text: "Du hast das nicht veranlasst? Dann antworte bitte sofort auf diese E-Mail. Dein Zugang wurde überall abgemeldet, und ältere Links zum Passwort gelten nicht mehr." },
      reason: "Du bekommst diese E-Mail, weil dein Zugang zum oalab Client Hub bisher über diese Adresse lief.",
      legal,
    });
  }
  const hub = safeUrl(input.hubUrl);
  const page = (path: string) => (hub ? safeUrl(new URL(path, hub).toString()) : "");
  return render({
    subject: "Dein oalab-Zugang läuft jetzt über diese Adresse",
    preheader: `Ab sofort meldest du dich mit ${input.email} an${input.activated ? ", dein Passwort bleibt" : ""}.`,
    area: "account",
    heading: "Deine neue Anmeldeadresse",
    lead: `${hello} oalab-Team hat deinen Zugang auf diese E-Mail-Adresse umgestellt. Ab sofort meldest du dich nur noch mit ihr an, ${input.serviceToo ? "im Client Hub und auf der Serviceplattform" : "im Client Hub"}.`,
    details: [
      { label: "Anmeldung mit", value: input.email },
      { label: "Bisher", value: input.previous },
      input.activated ? { label: "Passwort", value: "bleibt gleich" } : { label: "Status", value: "Noch nicht aktiviert", tone: "todo" },
    ],
    note: input.activated
      ? { tone: "todo", text: "Wir haben dich dabei überall abgemeldet. Melde dich einfach mit der neuen Adresse und deinem bisherigen Passwort wieder an." }
      : { tone: "todo", text: "Lege jetzt dein Passwort fest: Tippe auf den Button und gib unter „Passwort vergessen?“ diese Adresse ein, dann kommt der Link. Ältere Aktivierungslinks gelten nicht mehr." },
    // Before the first sign-in „Passwort vergessen?“ is the way in: it mails a fresh link to every active login, also
    // one that never had a password (requestPasswordResetAction).
    cta: input.activated ? { label: "Zum Client Hub", url: page("/auth/login") } : { label: "Zugang aktivieren", url: page("/auth/forgot-password") },
    small: "Du hast keinen Zugang bei oalab? Dann antworte bitte kurz auf diese E-Mail.",
    reason: ACCOUNT_REASON,
    legal,
  });
}

const codeClock = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });

/**
 * To the person, right after the password: the six-digit code that confirms this sign-in (second factor). The code
 * stays out of subject and preheader, so it never shows on a lock screen. The time of the request is in both: every
 * code mail is a thread of its own, and the code page names the mail that counts (5.11.2026: mail apps stacked the
 * mails under one subject and showed an older code first). Freelancers work in the hub only (`hubOnly`).
 */
export function loginCodeMail(input: { firstName: string; code: string; minutes: number; issuedAt: Date; hubOnly?: boolean }, legal?: MailLegal): MailContent {
  const first = firstNameOf(input.firstName);
  const sentAt = codeClock.format(input.issuedAt);
  const until = codeClock.format(new Date(input.issuedAt.getTime() + input.minutes * 60_000));
  const where = input.hubOnly ? "im oalab Client Hub" : "im oalab Client Hub und auf der Serviceplattform";
  return render({
    subject: `Dein Sicherheitscode für oalab · ${sentAt} Uhr`,
    preheader: `Angefordert um ${sentAt} Uhr, gültig bis ${until} Uhr.`,
    area: "security",
    heading: "Dein Sicherheitscode",
    lead: `${first ? `Hallo ${first}, gib` : "Gib"} diesen Code ein, um deine Anmeldung ${where} zu bestätigen.`,
    code: { value: input.code, note: `Gilt ${input.minutes} Minuten, bis ${until} Uhr · nur für diese Anmeldung` },
    note: { tone: "security", text: "Gib den Code nie weiter, auch nicht an dein oalab-Team. Du hast dich gerade nicht angemeldet? Dann kennt jemand dein Passwort: Ändere es über „Passwort vergessen“ und sag deinem oalab-Team Bescheid." },
    reason: ACCOUNT_REASON,
    legal,
  });
}

/**
 * The six-digit code before an admin links the authenticator app of the Schlüsselbund. Like the login code: the code
 * stays out of subject and preheader, the time of the request is in both.
 */
export function keychainCodeMail(input: { firstName: string; code: string; minutes: number; issuedAt: Date }, legal?: MailLegal): MailContent {
  const first = firstNameOf(input.firstName);
  const sentAt = codeClock.format(input.issuedAt);
  const until = codeClock.format(new Date(input.issuedAt.getTime() + input.minutes * 60_000));
  return render({
    subject: `Code für den Schlüsselbund · ${sentAt} Uhr`,
    preheader: `Angefordert um ${sentAt} Uhr, gültig bis ${until} Uhr.`,
    area: "security",
    heading: "Schlüsselbund einrichten",
    lead: `${first ? `Hallo ${first}, gib` : "Gib"} diesen Code im Client Hub ein, um deine Authenticator-App mit dem Schlüsselbund zu verbinden.`,
    code: { value: input.code, note: `Gilt ${input.minutes} Minuten, bis ${until} Uhr · nur für diese Anmeldung` },
    note: { tone: "security", text: "Gib den Code nie weiter. Du hast den Schlüsselbund gerade nicht eingerichtet? Dann ist jemand mit deinem Zugang angemeldet: Ändere dein Passwort und sag deinem oalab-Team Bescheid." },
    reason: ACCOUNT_REASON,
    legal,
  });
}

/** One notice of lib/hub-notify: its kind, title and line, the absolute link to its place, and calendar links if any. */
export type MailNotice = { kind: string; title: string; body: string; url?: string; calendar?: MailCalendar };

type NoticeView = {
  area: Area;
  /** What the notice is about, above its title. */
  label: string;
  /** The start of the notice title that the headline already says; left out on the card. */
  prefix: string;
  heading: string;
  lead: string;
  /** The button of a mail with this notice alone, and the link in a list. */
  cta: string;
  link: string;
  chip?: [string, Tone];
  note: { tone: NoteTone; text: string };
};

const NOTICE_VIEWS: Record<string, NoticeView> = {
  "task.customer": { area: "projects", label: "Aufgabe", prefix: "Du bist am Zug: ", heading: "Du bist am Zug", lead: "Eine Aufgabe wartet auf deine Rückmeldung.", cta: "Aufgabe öffnen", link: "Aufgabe öffnen", chip: ["Wartet auf dich", "todo"], note: { tone: "todo", text: "Sieh dir die Aufgabe an und gib deinem oalab-Team dort deine Freigabe oder dein Feedback." } },
  "project.changed": { area: "projects", label: "Projekt", prefix: "Projekt aktualisiert: ", heading: "Dein Projekt wurde aktualisiert", lead: "In einem deiner Projekte hat sich etwas geändert.", cta: "Projekt öffnen", link: "Projekt öffnen", note: { tone: "info", text: "Du musst nichts tun. Fragen dazu? Antworte einfach auf diese E-Mail." } },
  "file.shared": { area: "files", label: "Datei", prefix: "Neue Datei: ", heading: "Eine neue Datei ist da", lead: "Dein oalab-Team hat dir eine Datei im Client Hub bereitgestellt.", cta: "Datei ansehen", link: "Datei ansehen", note: { tone: "info", text: "Öffne die Datei im Client Hub und lade sie bei Bedarf herunter." } },
  "appointment.created": { area: "calendar", label: "Termin", prefix: "Neuer Termin: ", heading: "Ein neuer Termin für dich", lead: "Dein oalab-Team hat einen Termin mit dir eingetragen.", cta: "Termin im Hub ansehen", link: "Termin ansehen", note: { tone: "info", text: "Passt dir der Termin nicht? Antworte einfach auf diese E-Mail." } },
  "appointment.confirmed": { area: "calendar", label: "Termin", prefix: "Termin bestätigt: ", heading: "Deine Terminanfrage ist bestätigt", lead: "Dein oalab-Team hat deine Anfrage angenommen. Der Termin steht.", cta: "Termin im Hub ansehen", link: "Termin ansehen", chip: ["Bestätigt", "ok"], note: { tone: "info", text: "Passt dir der Termin doch nicht mehr? Antworte einfach auf diese E-Mail." } },
  "appointment.changed": { area: "calendar", label: "Termin", prefix: "Termin verschoben: ", heading: "Dein Termin wurde verschoben", lead: "Ein Termin findet zu einer neuen Zeit statt.", cta: "Termin im Hub ansehen", link: "Termin ansehen", chip: ["Neue Zeit", "todo"], note: { tone: "todo", text: "Trag dir die neue Zeit ein. Passt sie nicht, antworte einfach auf diese E-Mail." } },
  "appointment.cancelled": { area: "calendar", label: "Termin", prefix: "Termin abgesagt: ", heading: "Dein Termin wurde abgesagt", lead: "Ein Termin fällt aus.", cta: "Neuen Termin anfragen", link: "Kalender öffnen", chip: ["Abgesagt", "bad"], note: { tone: "info", text: "Du musst nichts tun. Einen neuen Termin kannst du jederzeit im Kalender anfragen." } },
  "appointment.declined": { area: "calendar", label: "Terminanfrage", prefix: "Terminanfrage abgelehnt: ", heading: "Deine Terminanfrage wurde abgelehnt", lead: "Dein oalab-Team kann den angefragten Termin leider nicht wahrnehmen.", cta: "Neuen Termin anfragen", link: "Kalender öffnen", chip: ["Abgelehnt", "off"], note: { tone: "info", text: "Frag gern einen anderen Termin im Kalender an oder antworte einfach auf diese E-Mail." } },
  // The private chat (4.11.2026): to the admins when a customer writes, to the customer when oalab answers.
  "chat.message": { area: "messages", label: "Privater Chat", prefix: "", heading: "Ein Kunde hat geschrieben", lead: "Im privaten Chat des Client Hub wartet eine Nachricht auf euch.", cta: "Chat öffnen", link: "Chat öffnen", chip: ["Wartet auf Antwort", "todo"], note: { tone: "team", text: "Antworte direkt im Client Hub unter Nachrichten. Diese E-Mail kommt nur, solange niemand aus dem Team den Chat gelesen hat." } },
  "chat.reply": { area: "messages", label: "Nachricht", prefix: "", heading: "Neue Nachricht von oalab", lead: "Dein oalab-Team hat dir im Client Hub geschrieben.", cta: "Nachricht lesen", link: "Nachricht lesen", note: { tone: "info", text: "Antworte einfach im Client Hub unter Nachrichten." } },
  // To the admins (23.11.2026): a customer's request or message on the service platform, and a customer writing in a note.
  "service.message": { area: "messages", label: "Serviceplattform", prefix: "", heading: "Ein Kunde hat auf der Serviceplattform geschrieben", lead: "Auf der Serviceplattform wartet eine Anfrage auf euch.", cta: "Anfrage im Hub öffnen", link: "Anfrage öffnen", chip: ["Wartet auf Antwort", "todo"], note: { tone: "team", text: "Antworten geht in NoteTree Business. Diese E-Mail kommt nur, solange niemand aus dem Team die Anfrage im Hub geöffnet hat." } },
  "note.edited": { area: "projects", label: "Notiz", prefix: "Notiz bearbeitet: ", heading: "Neues in einer geteilten Notiz", lead: "Auf einer Notizseite hat jemand außerhalb des Teams geschrieben.", cta: "Notiz öffnen", link: "Notiz öffnen", chip: ["Neu", "info"], note: { tone: "team", text: "Diese E-Mail kommt nur, solange niemand aus dem Team die Seite geöffnet hat." } },
  // Inside the team (stage 2 of „oalab als Unternehmen“): „Team informieren“ on one of oalab's own pages.
  "note.team": { area: "projects", label: "Interne Notiz", prefix: "", heading: "Eine Notiz aus dem Team", lead: "Jemand aus dem Team hat dich auf eine interne Notizseite von oalab hingewiesen.", cta: "Notiz öffnen", link: "Notiz öffnen", chip: ["Intern", "info"], note: { tone: "team", text: "Diese E-Mail kommt nur, solange du die Seite im Hub noch nicht geöffnet hast." } },
  // The task board (17.11.2026): to the project's freelancers and, for released tasks, to the customer.
  "task.created": { area: "projects", label: "Aufgabe", prefix: "Neue Aufgabe: ", heading: "Eine neue Aufgabe", lead: "In einem deiner Projekte ist eine Aufgabe dazugekommen.", cta: "Aufgabe öffnen", link: "Aufgabe öffnen", chip: ["Neu", "info"], note: { tone: "info", text: "Die Einzelheiten findest du im Client Hub. Fragen dazu? Antworte einfach auf diese E-Mail." } },
  "task.changed": { area: "projects", label: "Aufgabe", prefix: "Aufgabe geändert: ", heading: "Eine Aufgabe wurde geändert", lead: "An einer Aufgabe in deinen Projekten hat sich etwas getan.", cta: "Aufgabe öffnen", link: "Aufgabe öffnen", note: { tone: "info", text: "Was sich geändert hat, steht oben. Die Einzelheiten findest du im Client Hub." } },
};
const OTHER_NOTICE: NoticeView = { area: "news", label: "Neuigkeit", prefix: "", heading: "Neu im Client Hub", lead: "Im Client Hub gibt es etwas Neues für dich.", cta: "Im Client Hub ansehen", link: "Ansehen", note: { tone: "info", text: "Mehr dazu findest du im Client Hub." } };
const NOTICE_REASON = "Du bekommst diese E-Mail, weil im oalab Client Hub etwas für dich neu ist. Abschalten kannst du sie im Hub unter „Profil“.";

/**
 * To a customer: what is new for them in the hub (lib/hub-notify). One notice comes as a mail of its own (headline by
 * kind, the notice, calendar block for new, confirmed and moved appointments, a button to its place); several come as
 * a list, each with the symbol of its area, its own link and compact calendar links, and one button into the hub.
 */
export function noticeDigestMail(input: { firstName?: string; items: MailNotice[]; more: number; hubUrl: string; settingsUrl?: string }, legal?: MailLegal): MailContent {
  const count = input.items.length + input.more;
  const viewOf = (item: MailNotice) => NOTICE_VIEWS[item.kind] ?? OTHER_NOTICE;
  if (count === 1 && input.items.length === 1) {
    const item = input.items[0];
    const view = viewOf(item);
    const title = view.prefix && item.title.startsWith(view.prefix) ? item.title.slice(view.prefix.length) : item.title;
    const calendar = showsCalendar(item.calendar) ? item.calendar : undefined;
    return render({
      subject: item.title,
      preheader: item.body || view.lead,
      area: view.area,
      heading: view.heading,
      lead: view.lead,
      notice: { area: view.area, label: view.label, title, chip: view.chip, body: item.body },
      calendar,
      // With the calendar block right above, the moved appointment needs no second call to enter it.
      note: item.kind === "appointment.changed" && calendar ? { tone: "info", text: "Passt die neue Zeit nicht? Antworte einfach auf diese E-Mail." } : view.note,
      cta: { label: view.cta, url: safeUrl(item.url ?? "") || input.hubUrl },
      reason: NOTICE_REASON,
      manage: input.settingsUrl,
      legal,
    });
  }

  const tasks = input.items.filter((item) => item.kind === "task.customer").length;
  const waiting = tasks === 1 ? "Eine Aufgabe wartet auf dich" : `${tasks} Aufgaben warten auf dich`;
  // Admins get chat messages and, since 23.11.2026, messages on the service platform: customers who wait for an answer.
  const chats = input.items.filter((item) => item.kind === "chat.message").length;
  const service = input.items.filter((item) => item.kind === "service.message").length;
  const first = input.items[0]?.title ?? "";
  return render({
    subject: `Neu im Client Hub: ${count} Neuigkeiten`,
    preheader: `${first} – und ${count - 1} weitere`,
    area: "news",
    heading: `${count} Neuigkeiten für dich`,
    lead: service && chats
      ? `Im Chat und auf der Serviceplattform warten ${chats + service} Nachrichten von Kunden auf eine Antwort.`
      : service
      ? `Auf der Serviceplattform ${service === 1 ? "wartet ein Kunde" : `warten ${service} Nachrichten von Kunden`} auf eine Antwort.`
      : chats
      ? `Im privaten Chat des Client Hub ${chats === 1 ? "wartet ein Kunde" : `warten ${chats} Kunden`} auf eine Antwort.`
      : `Im Client Hub hat sich einiges getan.${tasks ? ` ${waiting}${tasks < count ? ", der Rest ist zur Info." : "."}` : " Alles hier ist zur Info."}`,
    list: input.items.map((item) => {
      const view = viewOf(item);
      const url = safeUrl(item.url ?? "");
      return { area: view.area, label: AREAS[view.area].label, title: item.title, chip: view.chip, body: item.body, calendar: item.calendar, link: url ? { label: view.link, url } : undefined };
    }),
    more: input.more ? (input.more === 1 ? "Eine weitere Neuigkeit findest du im Hub." : `${input.more} weitere Neuigkeiten findest du im Hub.`) : undefined,
    cta: { label: "Alles im Client Hub ansehen", url: input.hubUrl },
    reason: NOTICE_REASON,
    manage: input.settingsUrl,
    legal,
  });
}
