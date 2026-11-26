// Testansicht (26 November 2026, after OA-14): while oalab works on a service request the conversation in
// Nachrichten › Service shows a bubble with lines that take turns, an honest line once it takes long, when the test site
// changed before the AI said a word, and after every result „Neue Testansicht bereit“. The same rules as on the service
// platform (apps/web/features/client-workspace/chat/work-status.ts in service-oalab), from the team's side. Pure rules for
// the server, the screen and the tests; this file imports nothing from the app.

/** States in which oalab owes the customer an answer and the AI or the team is at it. */
export const WORKING_STATES: ReadonlySet<string> = new Set(["submitted", "triage_needed", "queued", "running", "approved_for_beta", "beta_deploying"]);

/** Lines that take turns while the work runs (wish of the admins: „Wir arbeiten gerade an einer Weltverbesserung“). */
export const QUIPS: readonly string[] = [
  "Wir arbeiten gerade an einer kleinen Weltverbesserung …",
  "Die Pixel stehen schon stramm …",
  "Wir rücken Abstände millimetergenau zurecht …",
  "Kaffee ist gekocht, deine Änderung entsteht …",
  "Wir polieren gerade die letzten Kanten …",
  "Die Testseite bekommt frische Farbe …",
  "Wir prüfen alles doppelt, damit es einmal sitzt …",
  "Unsere KI krempelt die Ärmel hoch …",
  "Noch ein letzter Feinschliff, dann ist es so weit …",
];

/** How long one line stays before the next one takes its turn. */
export const QUIP_MS = 4_200;
/** After this long without an answer the jokes stop and an honest line takes over. */
export const SLOW_AFTER_MS = 2 * 60 * 60_000;
/** A test site that changed this long ago without a word from the AI means the AI did not report. */
export const SILENT_AFTER_MS = 30 * 60_000;

/** The test site of a request's project and when it last changed. */
export interface TestSiteView {
  readonly url: string;
  /** Its own `Last-Modified` or the newest result the AI reported, whichever is newer; `null` unknown. */
  readonly updatedAt: string | null;
  /** Where `updatedAt` comes from: the site itself or the newest reported result. */
  readonly source: "site" | "result" | null;
}

export interface WorkFacts {
  readonly state: string;
  /** Newest message of the customer, also one the team wrote for them. */
  readonly lastClientAt: string | null;
  /** Newest message of oalab: a result or an answer of the team. */
  readonly lastResultAt: string | null;
  readonly siteAt: string | null;
  /** The AI waits for a person („KI pausiert“): the team is at it, nobody waits for the AI. */
  readonly paused?: boolean;
  readonly now: Date | string | number;
}

export interface WorkStatus {
  /** oalab owes an answer since the customer's last message; `null` when nobody is at it. */
  readonly working: { readonly since: string; readonly slow: boolean } | null;
  /** The test site changed after the customer's last message and no result came since. */
  readonly siteChangedAt: string | null;
  /** That change is older than half an hour: the AI did not report („Rückmeldung fehlt“). */
  readonly silentSince: string | null;
}

const time = (value: string | null | undefined) => (value ? Date.parse(value) : Number.NaN);
const instant = (value: Date | string | number) => (value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value));

export function statusFromFacts(facts: WorkFacts): WorkStatus {
  const now = instant(facts.now);
  const { lastClientAt, lastResultAt, siteAt } = facts;
  const working = WORKING_STATES.has(facts.state) && lastClientAt !== null && facts.paused !== true;
  // The work runs since the newest word in the chat: the customer's wish or the team's last note.
  const since = lastResultAt !== null && lastClientAt !== null && time(lastResultAt) > time(lastClientAt) ? lastResultAt : lastClientAt;
  const siteChangedAt = working && siteAt !== null && time(siteAt) > time(lastClientAt) && (lastResultAt === null || time(siteAt) > time(lastResultAt)) ? siteAt : null;
  return {
    working: working && since !== null ? { since, slow: now - time(since) > SLOW_AFTER_MS } : null,
    siteChangedAt,
    silentSince: siteChangedAt !== null && now - time(siteChangedAt) > SILENT_AFTER_MS ? siteChangedAt : null,
  };
}

/** The newest message of one side; the customer's side includes what the team wrote for them. */
export function newestAt(messages: readonly { readonly sender: string; readonly at: string }[], sender: "client" | "oalab"): string | null {
  let found: string | null = null;
  for (const message of messages) if (message.sender === sender && (found === null || time(message.at) > time(found))) found = message.at;
  return found;
}

/** The status of an open conversation from its messages and its test site. */
export function threadStatus(input: {
  readonly state: string;
  readonly messages: readonly { readonly sender: string; readonly at: string }[];
  readonly testSite?: TestSiteView | null;
  readonly paused?: boolean;
  readonly now: Date | string | number;
}): WorkStatus {
  return statusFromFacts({
    state: input.state,
    lastClientAt: newestAt(input.messages, "client"),
    lastResultAt: newestAt(input.messages, "oalab"),
    siteAt: input.testSite?.updatedAt ?? null,
    paused: input.paused,
    now: input.now,
  });
}

/** The honest lines for the team once it takes long, with the facts. */
export function teamSlowLines(input: { readonly since: string; readonly siteChangedAt: string | null }, clock: (iso: string) => string): readonly string[] {
  return input.siteChangedAt
    ? [`Noch keine Rückmeldung der KI. Die Testseite ist seit ${clock(input.siteChangedAt)} neu.`, `Die Arbeit läuft seit ${clock(input.since)}. Schau in NoteTree Business, ob der Lauf hängt.`]
    : [`Die Arbeit läuft seit ${clock(input.since)}, länger als sonst.`, "Schau in NoteTree Business, ob der Lauf hängt."];
}

/** A result on the test site: a preview with pictures, or work without pictures. */
export function freshViewLabel(result: string | null | undefined): string | null {
  if (result === "preview") return "Neue Testansicht bereit";
  if (result === "work") return "Neuer Stand auf der Testseite";
  return null;
}

/** That the e-mail „Neue Testansicht bereit“ went out for a result, counted per person. */
export function mailNote(people: number | undefined): string | null {
  if (!people || people < 1) return null;
  return people === 1 ? "E-Mail verschickt" : `E-Mail an ${people} Personen verschickt`;
}

/** The hint above the field when the test site changed and the AI did not report („Rückmeldung fehlt“). */
export function silenceCopy(company: string | null, changedAt: string): { readonly title: string; readonly text: string; readonly action: string } {
  return {
    title: `Testseite seit ${changedAt} neu, die KI meldet sich nicht`,
    text: `Schau kurz auf die Testseite und sag ${company || "dem Kunden"} Bescheid, oder prüf den Lauf in NoteTree Business.`,
    action: "Antwort vorbereiten",
  };
}

/** The draft „Antwort vorbereiten“ puts into the field, as oalab; the admin reads it over before sending. */
export function preparedReply(stamp: string): string {
  return `Deine Änderung ist auf der Testseite, Stand ${stamp}. Schau gern drauf. Passt alles, drück im Chat „Gefällt mir“.`;
}

/** A test site the hub may ask for its date: https on a public host name, no credentials or port. */
export function publicHttpsUrl(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    if (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":")) return null;
    if (/(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host)) return null;
    return url;
  } catch {
    return null;
  }
}
