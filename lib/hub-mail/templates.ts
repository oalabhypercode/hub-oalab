/**
 * The hub's e-mails in the oalab look (redesign of 30 October 2026): the hub's background behind a white card, a header
 * with logo and area, the headline, what happened, what to do and one button across the card. Each mail comes as HTML
 * (light and dark, phone and Outlook) and as plain text. Everything that comes from people (names, companies, messages,
 * notes) is escaped; links must be http(s), apart from the mailto and tel links built here. The pictures travel inside
 * the mail (cid:…, see images.ts); `images` names the ones a mail shows. Self-contained (no imports), so `node --test`
 * renders them directly.
 */

export type MailContent = { subject: string; html: string; text: string; images: string[] };
/** Imprint and privacy addresses for the footer; empty strings leave the links out. */
export type MailLegal = { imprint: string; privacy: string };

/**
 * "In deinen Kalender eintragen" under an appointment notice: signed hub links (lib/hub-calendar/links.ts). The .ics
 * file serves Apple Kalender and every other app; `moved` adds the reminder to remove the old private entry.
 */
export type MailCalendar = { ics: string; google: string; outlook: string; moved?: boolean };

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

type Area = "projects" | "files" | "calendar" | "account" | "security" | "users" | "news";
const AREAS: Record<Area, { label: string; text: string; dark: string }> = {
  projects: { label: "Projekte", text: "#7F2100", dark: "#FFC680" },
  files: { label: "Dateien", text: "#3533A1", dark: "#BDBCFF" },
  calendar: { label: "Kalender", text: "#800F0B", dark: "#FFB3AD" },
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
${s(".card")}{background:#1C181B !important;border-color:#2E262B !important}
${s(".ink")}{color:#F6F0F3 !important}
${s(".body")}{color:#D3C9CE !important}
${s(".muted")}{color:#A1959B !important}
${s(".panel")}{background:#241E22 !important;border-color:#332A30 !important}
${s(".rule")}{border-color:#332A30 !important}
${s(".link")}{color:#F4A6C9 !important}
${s(".vcard")}{background:#231D21 !important;border-color:#382E34 !important}
${s(".calbtn,.calpill")}{background:#2E262B !important;border-color:#43383F !important}
${s(".calpill")}{color:#F6F0F3 !important}
${(Object.keys(AREAS) as Area[]).map((id) => `${s(`.area-${id}`)}{color:${AREAS[id].dark} !important}`).join("\n")}
${s(".tone-todo")}{background:#3A2614 !important;color:#FFBE8A !important}
${s(".tone-info")}{background:#14263F !important;color:#9CC7FF !important}
${s(".tone-ok")}{background:#16301D !important;color:#9EE2AE !important}
${s(".tone-off")}{background:#2C262A !important;color:#C2B7BD !important}
${s(".tone-bad")}{background:#3D1A18 !important;color:#FFB1AA !important}
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

const panel = (content: string, padding = "6px 24px") => table(`<tr><td style="padding:${padding};">${content}</td></tr>`, ` class="panel" style="background:${C.panel};border:1px solid ${C.panelLine};border-radius:18px;"`);

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

const MOVED_HINT = "Schon in deinem Kalender? Lösch dort den alten Eintrag. Private Kalender ändern sich nicht von selbst.";

/** The ways into a calendar, each with a safe link; an empty list when none is usable. */
function calendarEntries(calendar: MailCalendar) {
  const entries = [
    { label: "Apple Kalender", hint: "iPhone, iPad, Mac", short: "Apple", url: calendar.ics, glyph: "calendar-add" },
    { label: "Google Kalender", hint: "Android, Gmail, Web", short: "Google", url: calendar.google, glyph: "calendar-add" },
    { label: "Outlook", hint: "Microsoft 365 im Browser", short: "Outlook", url: calendar.outlook, glyph: "calendar-add" },
    { label: "Andere Kalender-App", hint: ".ics-Datei herunterladen", short: ".ics-Datei", url: calendar.ics, glyph: "calendar-file" },
  ];
  return entries.map((entry) => ({ ...entry, url: safeUrl(entry.url) })).filter((entry) => entry.url);
}

/** "In deinen Kalender eintragen": four ways, two by two on a computer, one below the other on a phone. */
function calendarBlock(calendar: MailCalendar) {
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
${table(grid.join(""), ` style="margin-top:16px;"`)}${hint}
</td></tr>`, ` class="panel" style="background:${C.panel};border:1px solid ${C.panelLine};border-radius:18px;"`);
}

/** The compact version in a mail with several notices: small pills under the appointment. */
function calendarPills(calendar: MailCalendar) {
  const pill = (entry: ReturnType<typeof calendarEntries>[number]) => `<a class="calpill" href="${esc(entry.url)}" style="display:inline-block;margin:6px 6px 0 0;padding:6px 12px;border:1px solid #E7DDE1;border-radius:999px;background:#FFFFFF;${t(13, 18, 600, C.ink, "text-decoration:none;white-space:nowrap;")}">${esc(entry.short)}</a>`;
  return `<div style="padding-top:12px;"><div class="muted" style="${t(12, 16, 600, C.muted)}"><img src="cid:calendar-small@hub.oalab.de" width="14" height="14" alt="" style="width:14px;height:14px;border:0;vertical-align:-3px;">&nbsp;&nbsp;In deinen Kalender eintragen:</div>
<div>${calendarEntries(calendar).map(pill).join("")}</div>${calendar.moved ? `<div class="muted" style="padding-top:8px;${t(12, 18, 400, C.muted)}">${MOVED_HINT}</div>` : ""}</div>`;
}

function calendarText(calendar: MailCalendar) {
  const [ics, google, outlook] = [calendar.ics, calendar.google, calendar.outlook].map(safeUrl);
  const lines = [
    ics && `Apple Kalender und andere Apps (.ics): ${ics}`,
    google && `Google Kalender: ${google}`,
    outlook && `Outlook (Microsoft 365): ${outlook}`,
  ].filter(Boolean);
  return lines.length ? ["In deinen Kalender eintragen:", ...lines, ...(calendar.moved ? [MOVED_HINT] : [])] : [];
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
  details?: Row[];
  notice?: Notice;
  calendar?: MailCalendar;
  list?: Notice[];
  more?: string;
  quote?: { label: string; value: string };
  note?: { tone: NoteTone; text: string };
  /** The button; left out without a usable link. */
  cta?: { label: string; url: string };
  small?: string;
  reason: string;
  /** Where the notification mails are switched off (notice mails only). */
  manage?: string;
  legal?: MailLegal;
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
  // Buttons lead to http(s) pages, or write a mail through a mailto link built above.
  const ctaUrl = mail.cta ? safeUrl(mail.cta.url) || (/^mailto:[^\s"'<>]+$/.test(mail.cta.url) ? mail.cta.url : "") : "";
  const cta = mail.cta && ctaUrl ? { label: mail.cta.label, url: ctaUrl } : undefined;
  const calendar = mail.calendar && calendarEntries(mail.calendar).length ? mail.calendar : undefined;
  const list = mail.list?.map((item) => ({ ...item, calendar: item.calendar && calendarEntries(item.calendar).length ? item.calendar : undefined }));
  const section = (content: string, top = 28) => `<tr><td class="px" style="padding:${top}px 44px 0;">${content}</td></tr>`;

  const rows = [header(mail.area, shortDate.format(new Date()))];
  rows.push(section(`<h1 class="h1 ink" style="margin:0;${t(32, 38, 700, C.ink, "letter-spacing:-0.025em;")}">${esc(mail.heading)}</h1>`, 32));
  rows.push(section(`<p class="body" style="margin:0;${t(17, 27, 400, C.body)}">${esc(mail.lead)}</p>`, 12));
  if (mail.code) rows.push(section(codePanel(mail.code.value, mail.code.note)));
  if (mail.card) rows.push(section(contactCard(mail.card)));
  if (mail.details?.length) rows.push(section(details(mail.details)));
  if (mail.notice) rows.push(section(noticeCard(mail.notice)));
  if (calendar) rows.push(section(calendarBlock(calendar), 16));
  if (list?.length) rows.push(section(noticeList(list), 16));
  if (mail.more) rows.push(section(`<p class="muted" style="margin:0;${t(14, 21, 400, C.muted)}">${esc(mail.more)}</p>`, 4));
  if (mail.quote) rows.push(section(quote(mail.quote.label, mail.quote.value), 24));
  if (mail.note) rows.push(section(note(mail.note.tone, mail.note.text), 24));
  if (cta) {
    rows.push(section(button(cta.label, cta.url), 32));
    if (!cta.url.startsWith("mailto:")) rows.push(section(`<p class="muted" style="margin:0;${t(12, 18, 400, C.muted)}">Button funktioniert nicht? Öffne diesen Link:<br><a class="link" href="${esc(cta.url)}" style="color:${C.bordeaux};word-break:break-all;">${esc(cta.url)}</a></p>`, 14));
  }
  if (mail.small) rows.push(section(`<p class="muted" style="margin:0;${t(12, 18, 400, C.muted)}">${esc(mail.small)}</p>`, cta ? 12 : 22));
  rows.push(`<tr><td style="height:44px;line-height:44px;font-size:0;">&nbsp;</td></tr>`);

  const legal = legalLinks(mail.legal).map(([label, url]) => `<a href="${esc(url)}" style="color:#D9BFCB;text-decoration:underline;">${label}</a>&nbsp;&middot;&nbsp;`).join("");
  const footer = `
<tr><td align="center" style="padding:30px 24px 0;">${image("logo", 32, "oalab", "margin:0 auto;border-radius:8px;")}</td></tr>
<tr><td align="center" style="padding:12px 32px 0;${t(12, 19, 400, "#F3E6EC")}">${esc(mail.reason)}<br>${manage ? `<a href="${esc(manage)}" style="color:#FFFFFF;text-decoration:underline;">Benachrichtigungen verwalten</a>&nbsp;&middot;&nbsp;` : ""}Fragen? Antworte einfach auf diese E-Mail.</td></tr>
<tr><td align="center" style="padding:12px 32px 48px;${t(12, 18, 400, "#D9BFCB")}">${legal}oalab Client Hub</td></tr>`;

  const html = `<!doctype html>
<html lang="de" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table{border-collapse:separate}
img{-ms-interpolation-mode:bicubic}
a[x-apple-data-detectors]{color:inherit !important;text-decoration:none !important}
${PHONE}
@media (prefers-color-scheme:dark){${darkRules("")}}
${darkRules("[data-ogsc] ")}
</style>
</head>
<body style="margin:0;padding:0;background:${C.canvas};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(mail.preheader)}${"&#8199;&#65279;&#847; ".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.canvas}" style="${CANVAS}"><tr><td class="outer" align="center" style="padding:40px 14px 0;">
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
  if (mail.details?.length) lines.push(...mail.details.map((row) => `${row.label}: ${row.value}`), "");
  if (mail.notice) lines.push(mail.notice.title, ...(mail.notice.body ? [mail.notice.body] : []), "");
  if (calendar) lines.push(...calendarText(calendar), "");
  for (const item of list ?? []) {
    lines.push(`${item.label}: ${item.title}`, ...(item.body ? [item.body] : []), ...(item.calendar ? calendarText(item.calendar) : []), ...(item.link ? [`${item.link.label}: ${item.link.url}`] : []), "");
  }
  if (mail.more) lines.push(mail.more, "");
  if (mail.quote) lines.push(`${mail.quote.label}:`, mail.quote.value, "");
  if (mail.note) lines.push(`${NOTES[mail.note.tone].title}: ${mail.note.text}`, "");
  if (cta) lines.push(`${cta.label}: ${cta.url.startsWith("mailto:") ? cta.url.slice(7).split("?")[0] : cta.url}`, "");
  if (mail.small) lines.push(mail.small, "");
  lines.push("—", mail.reason, ...(manage ? [`Benachrichtigungen verwalten: ${manage}`] : []), "Fragen? Antworte einfach auf diese E-Mail.", ...legalLinks(mail.legal).map(([label, url]) => `${label}: ${url}`));

  const images = [...new Set([...html.matchAll(/src="cid:([a-z0-9-]+)@hub\.oalab\.de"/g)].map((match) => match[1]))];
  return { subject, html, text: lines.join("\n"), images };
}

// ---------- The mails ----------

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

/** To the person: a one-time link to set the first (activation) or a new password. */
export function passwordLinkMail(input: { firstName: string; link: string; activation: boolean; email?: string }, legal?: MailLegal): MailContent {
  const first = firstNameOf(input.firstName);
  if (input.activation) {
    return render({
      subject: "Dein Zugang zum oalab Client Hub",
      preheader: "Lege dein Passwort fest, dann bist du direkt angemeldet.",
      area: "account",
      heading: "Dein Zugang ist eingerichtet",
      lead: `Dein oalab-Team hat dir einen Zugang zum oalab Client Hub angelegt${first ? `, ${first}` : ""}.`,
      details: [...(input.email ? [{ label: "Anmeldung mit", value: input.email }] : []), LINK_VALIDITY],
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
 * To the person, right after the password: the six-digit code that confirms this sign-in (second factor). The code
 * stays out of subject and preheader, so it never shows on a lock screen.
 */
export function loginCodeMail(input: { firstName: string; code: string; minutes: number }, legal?: MailLegal): MailContent {
  const first = firstNameOf(input.firstName);
  return render({
    subject: "Dein Sicherheitscode für oalab",
    preheader: `Er gilt ${input.minutes} Minuten für deine Anmeldung.`,
    area: "security",
    heading: "Dein Sicherheitscode",
    lead: `${first ? `Hallo ${first}, gib` : "Gib"} diesen Code ein, um deine Anmeldung im oalab Client Hub und auf der Serviceplattform zu bestätigen.`,
    code: { value: input.code, note: `Gilt ${input.minutes} Minuten · nur für diese Anmeldung` },
    note: { tone: "security", text: "Gib den Code nie weiter, auch nicht an dein oalab-Team. Du hast dich gerade nicht angemeldet? Dann kennt jemand dein Passwort: Ändere es über „Passwort vergessen“ und sag deinem oalab-Team Bescheid." },
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
};
const OTHER_NOTICE: NoticeView = { area: "news", label: "Neuigkeit", prefix: "", heading: "Neu im Client Hub", lead: "Im Client Hub gibt es etwas Neues für dich.", cta: "Im Client Hub ansehen", link: "Ansehen", note: { tone: "info", text: "Mehr dazu findest du im Client Hub." } };
const NOTICE_REASON = "Du bekommst diese E-Mail, weil im oalab Client Hub etwas für dich neu ist. Abschalten kannst du sie unter „Profil & Zugang“.";

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
    const calendar = item.calendar && calendarEntries(item.calendar).length ? item.calendar : undefined;
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
  const first = input.items[0]?.title ?? "";
  return render({
    subject: `Neu im Client Hub: ${count} Neuigkeiten`,
    preheader: `${first} – und ${count - 1} weitere`,
    area: "news",
    heading: `${count} Neuigkeiten für dich`,
    lead: `Im Client Hub hat sich einiges getan.${tasks ? ` ${waiting}${tasks < count ? ", der Rest ist zur Info." : "."}` : " Alles hier ist zur Info."}`,
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
