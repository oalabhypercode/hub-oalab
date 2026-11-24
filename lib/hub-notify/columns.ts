/**
 * The bell in three columns (design „Glocke V3“, user 21.11.2026): where something happened, the message and who it
 * came from. Built from a notice as it is stored (kind, title, body; see rules.ts), so lines written before keep
 * reading the same way. Self-contained (no imports) so `node --test` checks it directly.
 */

export type NoticeViewer = "admin" | "freelancer" | "customer";

export type NoticeColumns = {
  /** Where: the customer for the team, the project or area for customers. */
  where: string;
  /** The way below it: „Website › #12 Startseite“. */
  path: string;
  /** The message: what happened, then what changed. */
  title: string;
  body: string;
  /** Who it came from and what they are; the team's own changes come from oalab. */
  from: string;
  fromDetail: string;
};

const SEP = " · ";
const OALAB = { from: "oalab", fromDetail: "Team" };

/** "Aufgabe geändert: Startseite" → ["Aufgabe geändert", "Startseite"]; a title without a colon is all event. */
function splitTitle(title: string): [string, string] {
  const at = title.indexOf(": ");
  return at < 0 ? [title, ""] : [title.slice(0, at), title.slice(at + 2)];
}

/** The area a notice belongs to, for lines that carry no place of their own. */
function areaOf(kind: string) {
  if (kind.startsWith("task.")) return "Aufgaben";
  if (kind === "project.changed") return "Projekte";
  if (kind === "file.shared") return "Dateien";
  if (kind === "share.granted") return "Kunden";
  if (kind.startsWith("note.")) return "Notizen";
  if (kind.startsWith("chat.") || kind.startsWith("service.")) return "Nachrichten";
  if (kind.startsWith("appointment.")) return "Kalender";
  if (kind === "contract.changed") return "Vertrag & Domain";
  return "Hub";
}

const CHAT_LEADS = ["Neue Nachrichten von ", "Neue Nachricht von "];
const SERVICE_LEADS = ["Neue Nachrichten von ", "Neue Nachricht von ", "Neue Anfrage von "];
const FREELANCER_MARK = " (Freelancer)";
const SHARE_LEAD = "Neu freigegeben bei ";

export function noticeColumns(notice: { kind: string; title: string; body: string }, viewer: NoticeViewer): NoticeColumns {
  const { kind, title, body } = notice;
  const [event, subject] = splitTitle(title);
  const fallback = areaOf(kind);

  // Cards of the board: "[Firma · ]Projekt · #12 · Status: … · von Lena" (the firm for the team since 22.11.2026).
  if (kind === "task.created" || kind === "task.changed") {
    const parts = body.split(SEP);
    const at = parts.findIndex((part) => /^#\d+$/.test(part));
    const before = at < 0 ? [] : parts.slice(0, at);
    const rest = at < 0 ? parts : parts.slice(at + 1);
    const company = before.length > 1 ? before[0] : "";
    const project = before.length > 1 ? before.slice(1).join(SEP) : before[0] ?? "";
    const task = [at < 0 ? "" : parts[at], subject].filter(Boolean).join(" ");
    const actor = rest.find((part) => part.startsWith("von "))?.slice("von ".length) ?? "";
    return {
      where: company || project || fallback,
      path: (company ? [project, task] : [task]).filter(Boolean).join(" › "),
      title: event,
      body: rest.filter((part) => !part.startsWith("von ")).join(SEP),
      // Admins hear of a card only when a freelancer changed it; others may hear of anyone in the team.
      ...(actor ? { from: actor, fromDetail: viewer === "admin" ? "Freelancer" : "" } : OALAB),
    };
  }

  // „Du bist am Zug: Startseite“ with "Website · Aufgabe #12".
  if (kind === "task.customer") {
    const parts = body.split(SEP);
    const numbered = parts.find((part) => /^Aufgabe #\d+$/.test(part));
    return {
      where: parts.filter((part) => part !== numbered).join(SEP) || fallback,
      path: [numbered?.slice("Aufgabe ".length), subject].filter(Boolean).join(" "),
      title: event,
      body: "Die Aufgabe liegt jetzt bei dir.",
      ...OALAB,
    };
  }

  if (kind === "project.changed") return { where: subject || fallback, path: "Projekt", title: event, body, ...OALAB };

  // One file („Neue Datei: logo.svg“, body „Im Bereich Dateien“) or several („3 neue Dateien“ with their names).
  if (kind === "file.shared") {
    const single = title.startsWith("Neue Datei: ");
    return { where: fallback, path: "", title: single ? "Neue Datei" : title, body: single ? subject : body, ...OALAB };
  }

  // „Neu freigegeben bei Nordlicht Studio“ with "E-Mail, Pakete · Unter Kunden › Vertrag & Domain".
  if (kind === "share.granted") {
    const cut = body.lastIndexOf(`${SEP}Unter `);
    return {
      where: title.startsWith(SHARE_LEAD) ? title.slice(SHARE_LEAD.length) : fallback,
      path: cut < 0 ? "Vertrag & Domain" : body.slice(cut + `${SEP}Unter `.length),
      title: "Neu freigegeben",
      body: cut < 0 ? body : body.slice(0, cut),
      ...OALAB,
    };
  }

  // „Neue Notiz: Kickoff“ or „Notiz geändert: Kickoff“, from the team.
  if (kind === "note.shared" || kind === "note.changed") return { where: fallback, path: "Projekte › Notizen", title: event, body: subject, ...OALAB };

  // To the team (23.11.2026): „Notiz bearbeitet: Feedback“ with "Jana Sommer · Nordlicht Studio".
  if (kind === "note.edited") {
    const cut = body.lastIndexOf(SEP);
    const who = cut < 0 ? body : body.slice(0, cut);
    const freelancer = who.endsWith(FREELANCER_MARK);
    return { where: cut < 0 ? fallback : body.slice(cut + SEP.length), path: "Projekte › Notizen", title: event, body: subject, from: freelancer ? who.slice(0, -FREELANCER_MARK.length) : who, fromDetail: freelancer ? "Freelancer" : "Kunde" };
  }

  // To the team (23.11.2026): „Neue Anfrage von Nordlicht Studio: OA-12 Texte freigeben“ with "Jana: Text".
  if (kind === "service.message") {
    const lead = SERVICE_LEADS.find((prefix) => event.startsWith(prefix));
    const company = lead ? event.slice(lead.length) : "";
    const colon = body.indexOf(": ");
    const author = colon > 0 && colon <= 60 ? body.slice(0, colon) : "";
    return {
      where: company || fallback,
      path: subject ? `Serviceplattform › ${subject}` : "Serviceplattform",
      title: lead ? lead.slice(0, -" von ".length) : event,
      body: author ? body.slice(colon + 2) : body,
      from: author || company,
      fromDetail: "Kunde",
    };
  }

  // „Neue Nachricht von Müller Holzbau“ with "Jonas Müller: Text"; the customer's line comes „von oalab“.
  if (kind === "chat.message" || kind === "chat.reply") {
    const lead = CHAT_LEADS.find((prefix) => title.startsWith(prefix));
    const sender = lead ? title.slice(lead.length) : "";
    const colon = body.indexOf(": ");
    const author = colon > 0 && colon <= 60 ? body.slice(0, colon) : "";
    const text = author ? body.slice(colon + 2) : body;
    const heading = lead ? lead.slice(0, -" von ".length) : title;
    return kind === "chat.message"
      ? { where: sender || fallback, path: "Nachrichten › Privater Chat", title: heading, body: text, from: author || sender, fromDetail: "Kunde" }
      : { where: fallback, path: "Chat mit oalab", title: heading, body: text, from: author || "oalab", fromDetail: author ? "oalab" : "Team" };
  }

  // To the team (24.11.2026): „Neue Terminanfrage von Nordlicht Studio“ with "Abstimmung · Di., 24. November um 10:00 Uhr · Jana Sommer".
  if (kind === "appointment.requested") {
    const lead = "Neue Terminanfrage von ";
    const company = title.startsWith(lead) ? title.slice(lead.length) : "";
    const freelancer = company.endsWith(FREELANCER_MARK);
    const parts = body.split(SEP);
    const who = parts.length > 2 ? parts[parts.length - 1] : "";
    const name = freelancer ? company.slice(0, -FREELANCER_MARK.length) : company;
    return {
      where: name || fallback, path: "Kalender › Anfrage", title: "Neue Terminanfrage", body: (who ? parts.slice(0, -1) : parts).join(SEP),
      from: who || name, fromDetail: freelancer ? "Freelancer" : "Kunde",
    };
  }

  // „Termin bestätigt: Abstimmung“ with the time and a note.
  if (kind.startsWith("appointment.")) return { where: fallback, path: subject, title: event, body, ...OALAB };

  // To the customer (24.11.2026): „Neu unter Vertrag & Domain“ with "Domain eingetragen: nordlicht.de".
  if (kind === "contract.changed") return { where: fallback, path: "", title, body, ...OALAB };

  return { where: fallback, path: "", title, body, from: "", fromDetail: "" };
}

// The time column left of the symbol (plan docs/planung/chat-ereignisse-und-glocke.md 2.2, 23.11.2026) -----------------

const BERLIN = "Europe/Berlin";
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: BERLIN, year: "numeric", month: "2-digit", day: "2-digit" });
const clockOf = new Intl.DateTimeFormat("de-DE", { timeZone: BERLIN, hour: "2-digit", minute: "2-digit" });
const weekdayOf = new Intl.DateTimeFormat("de-DE", { timeZone: BERLIN, weekday: "short" });
const dayMonthOf = new Intl.DateTimeFormat("de-DE", { timeZone: BERLIN, day: "numeric", month: "short" });
const shortDateOf = new Intl.DateTimeFormat("de-DE", { timeZone: BERLIN, day: "2-digit", month: "2-digit", year: "2-digit" });
const fullOf = new Intl.DateTimeFormat("de-DE", { timeZone: BERLIN, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** A day of the German calendar as a whole number, so two instants count their days apart in German time. */
const dayNumber = (time: number) => Date.parse(`${dayKey.format(time)}T00:00:00Z`) / 86_400_000;

export type BellTime = { day: string; clock: string; full: string };

/**
 * When a notice came, in German time, for the column left of its symbol: above „Heute“, „Gestern“, the weekday within
 * a week („Mo.“), the day in this year („22. Nov.“), else the date („22.11.25“); below the clock („09:40“). `full` is
 * the whole date for the hint. Without the current time (`now` 0) the day is the date.
 */
export function bellTime(iso: string, now: number): BellTime {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return { day: "", clock: "", full: "" };
  const days = now > 0 ? dayNumber(now) - dayNumber(time) : Number.NaN;
  const sameYear = now > 0 && dayKey.format(time).slice(0, 4) === dayKey.format(now).slice(0, 4);
  // „Mo.“ everywhere: some engines write the short weekday without the point.
  const day = days <= 0 ? "Heute" : days === 1 ? "Gestern" : days < 7 ? `${weekdayOf.format(time).replace(/\.$/, "")}.`
    : sameYear ? dayMonthOf.format(time) : shortDateOf.format(time);
  return { day, clock: clockOf.format(time), full: fullOf.format(time) };
}
