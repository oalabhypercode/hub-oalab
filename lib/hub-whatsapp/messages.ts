/**
 * Rules of the WhatsApp channel: Meta's webhook signature, incoming messages, link codes and reply texts.
 * Self-contained (only node:crypto) so the webhook and the tests share the same rules.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const GRAPH_API_VERSION = "v26.0";
/** WhatsApp text messages may be up to 4096 characters long. */
export const MAX_REPLY_CHARS = 4000;
export const DAILY_QUESTION_LIMIT = 30;
/** Replies to numbers that are not linked yet, per day, so unknown senders cost little. */
export const UNLINKED_REPLY_LIMIT = 3;
export const HISTORY_TURNS = 10;
export const HISTORY_HOURS = 24;
/** Stored messages older than this are deleted (Meta retries undelivered webhooks for up to 36 hours). */
export const RETENTION_HOURS = 48;
export const DEFAULT_SUPPORT_CONTACT = "info@oalab.de";

/** Meta signs every webhook body with HMAC-SHA256 and the app secret: "sha256=<hex>". */
export function verifySignature(body: Uint8Array, header: string | null, appSecret: string) {
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header ?? "");
  if (!match || !appSecret) return false;
  const expected = createHmac("sha256", appSecret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(match[1], "hex"));
}

export type IncomingMessage = { id: string; from: string; type: string; text: string | null };

const phonePattern = /^[1-9][0-9]{6,14}$/;

/** The messages of a webhook body that were sent to our number; statuses and other numbers are skipped. */
export function extractMessages(payload: unknown, phoneNumberId: string): IncomingMessage[] {
  const body = payload as { object?: unknown; entry?: { changes?: { field?: unknown; value?: { metadata?: { phone_number_id?: unknown }; messages?: unknown[] } }[] }[] };
  if (body?.object !== "whatsapp_business_account" || !Array.isArray(body.entry)) return [];
  return body.entry.flatMap((entry) => (Array.isArray(entry?.changes) ? entry.changes : []))
    .filter((change) => change?.field === "messages" && change.value?.metadata?.phone_number_id === phoneNumberId)
    .flatMap((change) => (Array.isArray(change.value?.messages) ? change.value.messages : []))
    .flatMap((raw) => {
      const message = raw as { id?: unknown; from?: unknown; type?: unknown; text?: { body?: unknown } };
      if (typeof message?.id !== "string" || typeof message.from !== "string" || !phonePattern.test(message.from)) return [];
      const type = typeof message.type === "string" ? message.type : "unknown";
      const text = type === "text" && typeof message.text?.body === "string" ? message.text.body.trim().slice(0, 1000) : null;
      return [{ id: message.id.slice(0, 200), from: message.from, type, text }];
    });
}

/** "VERBINDEN 123456" (spaces and case do not matter) links the sender's number. */
export function parseLinkCode(text: string) {
  return /^\s*verbinden\s*:?\s*(\d{6})\s*[.!]?\s*$/i.exec(text)?.[1] ?? null;
}

export const isTeamRequest = (text: string) => /^\s*(team|mensch|support)\s*[.!?]*\s*$/i.test(text);

export type StoredTurn = { role: "user" | "assistant"; content: string };

/**
 * Stored WhatsApp history (oldest first) as alternating turns for Claude: non-text messages (empty content)
 * drop out, consecutive messages of one side are joined, and the turns start and end with the user.
 */
export function historyTurns(rows: StoredTurn[]) {
  const turns: StoredTurn[] = [];
  for (const row of rows) {
    const content = row.content.trim();
    if (!content) continue;
    const last = turns.at(-1);
    if (last?.role === row.role) last.content = `${last.content}\n${content}`;
    else turns.push({ role: row.role, content });
  }
  while (turns[0]?.role === "assistant") turns.shift();
  while (turns.at(-1)?.role === "assistant") turns.pop();
  return turns;
}

/** The assistant writes **bold**; WhatsApp shows *bold*. */
export function toWhatsAppText(text: string) {
  const converted = text.replace(/\*\*([^*\n]+)\*\*/g, "*$1*").trim();
  return converted.length > MAX_REPLY_CHARS ? `${converted.slice(0, MAX_REPLY_CHARS - 1).trimEnd()}…` : converted;
}

/** "+49 … 5678": enough to recognise one's own number, without showing it in full. */
export const maskPhone = (phone: string) => `+${phone.slice(0, 2)} … ${phone.slice(-4)}`;

/** wa.me link that opens a chat with the business number and the link message already typed. */
export const linkMessageUrl = (businessNumber: string, code: string) => `https://wa.me/${businessNumber.replace(/\D/g, "")}?text=${encodeURIComponent(`VERBINDEN ${code}`)}`;

export const replies = {
  linked: "Verbunden! Diese Nummer gehört jetzt zu deinem oalab Client Hub. Frag mich einfach, wie etwas im Hub funktioniert. Mit „TEAM“ erreichst du jederzeit einen Menschen.",
  invalidCode: "Dieser Code ist ungültig oder abgelaufen. Erzeuge im Client Hub unter Profil → „WhatsApp verbinden“ einen neuen Code (er gilt 15 Minuten).",
  notLinked: "Hallo! Ich bin der KI-Assistent des oalab Client Hub. Diese Nummer ist noch nicht verbunden. Melde dich im Client Hub an, öffne Profil → „WhatsApp verbinden“ und sende den angezeigten Code hierher.",
  textOnly: "Ich kann bisher nur Textnachrichten beantworten. Schreib mir deine Frage gern als Text.",
  limit: `Für heute sind die ${DAILY_QUESTION_LIMIT} Fragen über WhatsApp aufgebraucht. Morgen geht es weiter; im Client Hub hilft dir der Assistent jederzeit über „Assistent & Hilfe“.`,
  unavailable: "Der Assistent ist gerade nicht erreichbar. Bitte versuche es später noch einmal oder schreib „TEAM“ für den direkten Kontakt.",
  team: (contact: string) => `Gern verbinde ich dich mit einem Menschen: Schreib dem OALAB-Team an ${contact}. Wir melden uns so schnell wie möglich.`,
};
