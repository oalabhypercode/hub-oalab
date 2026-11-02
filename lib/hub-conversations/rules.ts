// Gespräche (2 November 2026): the service platform's requests with their messages for clients, shown as a chat.
// Pure rules for the server, the screen and the tests; this file imports nothing from the app.

export type ConversationSender = "client" | "oalab" | "assistant" | "system";
export type ConversationTone = "todo" | "info" | "ok" | "off";
export type ConversationGroup = "waiting" | "active" | "done";

export interface ConversationStateView {
  readonly label: string;
  readonly tone: ConversationTone;
  readonly group: ConversationGroup;
  /** Finished requests take no more client messages on the service platform either. */
  readonly canReply: boolean;
}

const FINISHED = new Set(["released", "rejected", "cancelled", "superseded", "archived"]);

/** The labels the service platform shows its clients (packages/domain client-status), so both places say the same. */
export function conversationState(state: string): ConversationStateView {
  const view = (label: string, tone: ConversationTone, group: ConversationGroup) => ({ label, tone, group, canReply: !FINISHED.has(state) });
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

/** A conversation is unread while the newest answer from oalab came after the person last looked. */
export function isUnread(lastAnswerAt: string | null, seenAt: string | null): boolean {
  if (!lastAnswerAt) return false;
  return !seenAt || Date.parse(lastAnswerAt) > Date.parse(seenAt);
}

/** Who wrote, as the reader sees it: clients read "Du" for themselves, oalab is the team or its assistant. */
export function senderLabel(sender: ConversationSender, own: boolean, name: string | null): string {
  if (sender === "assistant") return "oalab-Assistent";
  if (sender === "oalab") return name || "oalab-Team";
  if (sender === "system") return "";
  return own ? "Du" : name || "Kunde";
}

/**
 * Which side a message sits on. Clients see their own messages on the right; admins read along from oalab's side,
 * so the team's and the assistant's messages sit on the right for them. Notes from the system sit in the middle.
 */
export function messageSide(sender: ConversationSender, own: boolean, admin: boolean): "out" | "in" | "center" {
  if (sender === "system") return "center";
  if (admin) return sender === "client" ? "in" : "out";
  return own ? "out" : "in";
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

/** What a client may send: text up to the service platform's limit, never only spaces. */
export const MAX_MESSAGE_LENGTH = 5000;
export function readMessage(value: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const text = typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
  if (!text) return { ok: false, error: "Schreib zuerst eine Nachricht." };
  if (text.length > MAX_MESSAGE_LENGTH) return { ok: false, error: `Höchstens ${MAX_MESSAGE_LENGTH} Zeichen pro Nachricht.` };
  return { ok: true, value: text };
}

/** The service platform's answer to a reply, as a sentence for the person. */
export function replyError(status: number, code: string | undefined): string {
  if (code === "STALE_VERSION" || status === 409) return "Inzwischen kam etwas Neues in diesem Gespräch. Schau kurz drüber und sende dann noch einmal.";
  if (code === "RATE_LIMITED" || status === 429) return "Gerade kamen sehr viele Nachrichten. Bitte warte eine Minute.";
  if (code === "AUTHENTICATION_REQUIRED" || status === 401) return "Deine Sitzung ist abgelaufen. Bitte lade die Seite neu und melde dich an.";
  if (code === "AUTHORIZATION_DENIED" || code === "NOT_FOUND" || status === 403 || status === 404) return "In diesem Gespräch kannst du gerade nicht schreiben.";
  if (code === "INVALID_INPUT" || status === 400) return "Bitte prüfe deine Nachricht und versuche es erneut.";
  return "Die Nachricht ist nicht angekommen. Bitte versuche es erneut.";
}
