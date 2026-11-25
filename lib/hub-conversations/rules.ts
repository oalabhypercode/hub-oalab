// Gespräche (2 November 2026): the service platform's requests with their messages for clients, shown as a chat. Since
// 4 November 2026 admins read them in the tab "Service"; the day and time rules and the message check also serve the
// private chat (lib/hub-private-chat). Pure rules for the server, the screen and the tests; this file imports nothing
// from the app.

export type ConversationSender = "client" | "oalab" | "assistant" | "system";
export type ConversationTone = "todo" | "info" | "ok" | "off";
export type ConversationGroup = "waiting" | "active" | "done";

export interface ConversationStateView {
  readonly label: string;
  readonly tone: ConversationTone;
  readonly group: ConversationGroup;
}

/** The labels the service platform shows its clients (packages/domain client-status), so both places say the same. */
export function conversationState(state: string): ConversationStateView {
  const view = (label: string, tone: ConversationTone, group: ConversationGroup) => ({ label, tone, group });
  switch (state) {
    case "draft": return view("Entwurf", "off", "active");
    case "submitted": case "triage_needed": case "queued": return view("Eingegangen", "info", "active");
    case "running": case "approved_for_beta": case "beta_deploying": return view("In Bearbeitung", "info", "active");
    case "awaiting_client": return view("Du bist dran", "todo", "waiting");
    case "beta_ready": return view("Deine Freigabe", "todo", "waiting");
    case "release_review": return view("Testseite bereit", "todo", "waiting");
    case "production_deploying": return view("Wird veröffentlicht", "info", "active");
    case "blocked": case "failed": return view("Wir kümmern uns", "info", "active");
    case "released": return view("Live", "ok", "done");
    case "resolved": return view("Gelöst", "ok", "done");
    default: return view("Abgeschlossen", "off", "done");
  }
}

/** "OA-12": how the service platform names a request, also in its addresses. */
export function requestReference(requestNumber: number | string): string {
  return `OA-${requestNumber}`;
}

export function isSender(value: string): value is ConversationSender {
  return value === "client" || value === "oalab" || value === "assistant" || value === "system";
}

/**
 * Who wrote, as the admins read it: the customer and the team by name, otherwise the team or its assistant. A message
 * the team wrote for the customer names both: „Lena Schneider für Atelier Brandt“.
 */
export function senderLabel(sender: ConversationSender, name: string | null, onBehalf = false, company: string | null = null): string {
  if (sender === "assistant") return "oalab-Assistent";
  if (sender === "oalab") return name || "oalab-Team";
  if (sender === "system") return "";
  if (onBehalf) return `${name || "oalab"} für ${company || "den Kunden"}`;
  return name || "Kunde";
}

/**
 * The filters of the request list: whose turn it is. „Bei uns“ = the team or its AI works on it, also when the AI waits
 * for a person; „Beim Kunden“ = the customer answers or approves; „Erledigt“ = finished or closed.
 */
export type ConversationFilter = "all" | "team" | "customer" | "done";
export const CONVERSATION_FILTERS: readonly { readonly id: ConversationFilter; readonly label: string }[] = [
  { id: "all", label: "Alle" },
  { id: "team", label: "Bei uns" },
  { id: "customer", label: "Beim Kunden" },
  { id: "done", label: "Erledigt" },
];

export function conversationFilter(item: { readonly group: ConversationGroup; readonly aiPaused: boolean }): Exclude<ConversationFilter, "all"> {
  if (item.group === "done") return "done";
  if (item.aiPaused || item.group === "active") return "team";
  return "customer";
}

/** The banner above the field while the AI waits for a person, and its button. */
export function handBackCopy(mode: "client" | "ai", company: string | null): { readonly title: string; readonly text: string; readonly action: string } {
  const who = company || "dem Kunden";
  return mode === "client"
    ? {
      title: "Liegt zur Nachbearbeitung in NoteTree",
      text: `„Wieder freigeben“ gibt die Testseite zurück an ${company || "den Kunden"} zur Zustimmung. Neue Nachrichten von ${who} bearbeitet die KI dann wieder selbst.`,
      action: "Wieder freigeben",
    }
    : {
      title: "Die KI ist angehalten",
      text: `„KI weitermachen lassen“ gibt die Anfrage zurück an die KI. Sie liest alle neuen Nachrichten von ${who} und arbeitet weiter.`,
      action: "KI weitermachen lassen",
    };
}

/**
 * The line under the field: what happens with the message. For the customer it counts as their message and the AI takes
 * it up, unless the AI waits for a person; as oalab it reaches the customer like a published answer.
 */
export function serviceWriteHint(kind: "on_behalf" | "reply", input: { readonly company: string | null; readonly aiState: string | null; readonly paused: boolean }): string {
  const company = input.company || "der Kunde";
  if (kind === "reply") return `${company} liest das als Antwort von oalab und bekommt eine Benachrichtigung.`;
  if (input.paused) return `Zählt wie eine Nachricht von ${company}. Die KI ist angehalten: Nach dem Senden steht oben „KI weitermachen lassen“, erst dann liest sie die Nachricht.`;
  return input.aiState
    ? `Zählt wie eine Nachricht von ${company}: Die KI liest sie und arbeitet weiter. ${company} sieht „oalab für ${company}“.`
    : `Zählt wie eine Nachricht von ${company}. ${company} sieht „oalab für ${company}“.`;
}

/** Read-only line for an admin who is not on the oalab team of the service platform: the database would refuse each step. */
export function serviceTeamHint(paused: boolean): string {
  return `Du liest mit. Eingreifen${paused ? " und Freigeben" : ""} geht erst, wenn dein Login auf der Serviceplattform zum oalab-Team gehört.`;
}

/** What the database answers when a team command cannot run, in words for the admins. */
export function teamCommandError(message: string | undefined | null): string {
  switch (message) {
    case "BUSINESS_TICKET_CHANGED": return "Die Anfrage hat sich gerade geändert. Der neue Stand ist geladen, bitte schau ihn dir kurz an und versuch es noch einmal.";
    case "BUSINESS_HANDBACK_NOT_PAUSED": return "Diese Anfrage ist schon freigegeben.";
    case "BUSINESS_AUTOMATION_STOP_REQUIRED": return "Die KI arbeitet gerade noch an dieser Anfrage. Versuch es in einer Minute noch einmal.";
    case "BUSINESS_TERMINAL_TICKET": return "Diese Anfrage ist abgeschlossen. Neue Wünsche kommen als neue Anfrage.";
    case "BUSINESS_WRONG_TENANT_OR_TICKET": return "Diese Anfrage gibt es nicht mehr, sie liegt im Papierkorb oder die Firma ist gesperrt.";
    case "BUSINESS_STAFF_REQUIRED": return "Dein Login gehört auf der Serviceplattform nicht zum oalab-Team. Ohne diesen Zugang kann der Hub hier nichts ändern.";
    case "BUSINESS_COMMAND_CONFLICT": return "Dieser Schritt wurde gerade schon mit anderem Inhalt gesendet. Der neue Stand ist geladen, bitte versuch es noch einmal.";
    case "BUSINESS_MESSAGE_INVALID": return `Schreib zuerst eine Nachricht, höchstens ${MAX_MESSAGE_LENGTH} Zeichen.`;
    default: return "Das hat gerade nicht geklappt. Bitte versuche es erneut.";
  }
}

/**
 * Which side a message sits on. Admins read along from oalab's side, so the team's and the assistant's messages sit on
 * the right and the customer's on the left. Notes from the system sit in the middle.
 */
export function messageSide(sender: ConversationSender): "out" | "in" | "center" {
  if (sender === "system") return "center";
  return sender === "client" ? "in" : "out";
}

/** One line for the list: Markdown marks and line breaks go, long texts end in an ellipsis. */
export function previewText(body: string, max = 120): string {
  const text = body
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}|>)\s*/gm, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const ZONE = "Europe/Berlin";
const dayKey = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/** The day as a divider in the conversation: "Heute", "Gestern", "Montag, 13. Oktober" or with the year. */
export function dayLabel(iso: string, now: Date): string {
  const date = new Date(iso);
  const days = daysBetween(dayKey(now), dayKey(date));
  if (days === 0) return "Heute";
  if (days === 1) return "Gestern";
  const sameYear = dayKey(now).slice(0, 4) === dayKey(date).slice(0, 4);
  return new Intl.DateTimeFormat("de-DE", { timeZone: ZONE, weekday: sameYear ? "long" : undefined, day: "numeric", month: "long", year: sameYear ? undefined : "numeric" }).format(date);
}

/** Time in the list, as in a messenger: the time today, "Gestern", the weekday within a week, else the date. */
export function listTime(iso: string, now: Date): string {
  const date = new Date(iso);
  const days = daysBetween(dayKey(now), dayKey(date));
  if (days === 0) return clockTime(iso);
  if (days === 1) return "Gestern";
  if (days > 1 && days < 7) return new Intl.DateTimeFormat("de-DE", { timeZone: ZONE, weekday: "short" }).format(date);
  const sameYear = dayKey(now).slice(0, 4) === dayKey(date).slice(0, 4);
  return new Intl.DateTimeFormat("de-DE", { timeZone: ZONE, day: "2-digit", month: "2-digit", year: sameYear ? undefined : "2-digit" }).format(date);
}

export function clockTime(iso: string): string {
  return new Intl.DateTimeFormat("de-DE", { timeZone: ZONE, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export interface ThreadItem<M> {
  readonly message: M;
  /** A new day starts here: show its divider first. */
  readonly day: string | null;
  /** First and last of a run by the same writer: the name shows on the first, the tail on the last. */
  readonly first: boolean;
  readonly last: boolean;
}

/** Messages in order with day dividers and runs of the same writer, like a messenger groups them. */
export function threadItems<M extends { readonly at: string; readonly author: string }>(messages: readonly M[], now: Date): ThreadItem<M>[] {
  return messages.map((message, index) => {
    const previous = messages[index - 1];
    const next = messages[index + 1];
    const key = dayKey(new Date(message.at));
    const newDay = !previous || dayKey(new Date(previous.at)) !== key;
    const nextNewDay = !next || dayKey(new Date(next.at)) !== key;
    return {
      message,
      day: newDay ? dayLabel(message.at, now) : null,
      first: newDay || previous.author !== message.author,
      last: nextNewDay || next.author !== message.author,
    };
  });
}

/** What a chat message may be: text up to 5000 characters (the limit of the database), never only spaces. */
export const MAX_MESSAGE_LENGTH = 5000;
export function readMessage(value: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const text = typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
  if (!text) return { ok: false, error: "Schreib zuerst eine Nachricht." };
  if (text.length > MAX_MESSAGE_LENGTH) return { ok: false, error: `Höchstens ${MAX_MESSAGE_LENGTH} Zeichen pro Nachricht.` };
  return { ok: true, value: text };
}
