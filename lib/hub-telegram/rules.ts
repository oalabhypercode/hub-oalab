// Telegram for admins (4 November 2026): every message a customer writes in the private chat also reaches the admins'
// Telegram group, with company, name and the text itself, so the team reads it on the phone; answers stay in the hub.
// Decision of the user on 12 November 2026 (the group deletes its messages after 24 hours). Pure rules for the server
// and the tests; this file imports nothing.

export type TelegramConfig = { readonly token: string; readonly chatId: string };

/**
 * The bot's token from BotFather ("123456789:AA…") and the number of the admins' group ("-100…"). Null while one of
 * them is missing or does not look right, so the hub simply sends nothing.
 */
export function telegramConfig(env: Readonly<Record<string, string | undefined>>): TelegramConfig | null {
  const token = env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const chatId = env.TELEGRAM_CHAT_ID?.trim() ?? "";
  if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token) || !/^-?\d{5,}$/.test(chatId)) return null;
  return { token, chatId };
}

/** Telegram takes up to 4096 characters per message; longer chat messages (up to 5000 in the hub) are cut. */
export const TELEGRAM_TEXT_LIMIT = 3500;

const oneLine = (text: string, max: number) => text.replace(/\s+/g, " ").trim().slice(0, max);

/**
 * A customer's message for the group: company and writer in bold on top, the text below, a button into the hub.
 * The bold line comes as an entity, so the customer's text needs no escaping and is never read as formatting.
 * Telegram takes only public https addresses for buttons; elsewhere (a local test) the address stands in the text.
 */
export function telegramChatMessage(input: { company: string; author: string; body: string; url: string }) {
  const company = oneLine(input.company, 120) || "Kunde";
  const author = oneLine(input.author, 120);
  const head = author ? `${company} · ${author}` : company;
  const body = input.body.replace(/\r\n/g, "\n").trim();
  const text = body.length > TELEGRAM_TEXT_LIMIT ? `${body.slice(0, TELEGRAM_TEXT_LIMIT).trimEnd()} …\n\n(gekürzt, die ganze Nachricht steht im Hub)` : body;
  const button = /^https:\/\/[^\s/]+\.[^\s/]+\//.test(input.url);
  return {
    text: `${head}\n${text}${button ? "" : `\n\n${input.url}`}`,
    // Offsets count UTF-16 code units, as JavaScript strings do.
    entities: [{ type: "bold", offset: 0, length: head.length }],
    ...(button ? { reply_markup: { inline_keyboard: [[{ text: "Im Hub öffnen", url: input.url }]] } } : {}),
  };
}

/**
 * A customer's message on the service platform for the group (23.11.2026): „Neue Anfrage OA-12 · Firma · Name“ or
 * „OA-12 · Firma · Name“ in bold, then the request's title and the text, and a button into Nachrichten › Service.
 */
export function telegramServiceMessage(input: { company: string; author: string; reference: string; title: string; body: string; url: string; first: boolean }) {
  const company = oneLine(input.company, 120) || "Kunde";
  const author = oneLine(input.author, 120);
  const head = [`${input.first ? "Neue Anfrage " : ""}${oneLine(input.reference, 20)}`, company, author].filter(Boolean).join(" · ");
  return telegramChatMessage({ company: head, author: "", body: `${oneLine(input.title, 200)}\n${input.body}`, url: input.url });
}

/**
 * A customer's „Gefällt mir“ on a result for the group (27.11.2026): „Gefällt mir · OA-12 · Firma · Name“ in bold,
 * then the request's title and what it means, and a button into Nachrichten › Service.
 */
export function telegramServiceApproval(input: { company: string; author: string; reference: string; title: string; url: string }) {
  const head = ["Gefällt mir", oneLine(input.reference, 20), oneLine(input.company, 120) || "Kunde", oneLine(input.author, 120)].filter(Boolean).join(" · ");
  return telegramChatMessage({ company: head, author: "", body: `${oneLine(input.title, 200)}\nÄnderung auf der Testseite passt, bereit für live.`, url: input.url });
}

/**
 * A request for an appointment for the group (24.11.2026, decision 9 of the chat plan): „Neue Terminanfrage · Firma ·
 * Name“ in bold, then title and time, and a button into the calendar. Answered in the hub, in the calendar or the chat.
 */
export function telegramAppointmentRequest(input: { company: string; author: string; title: string; when: string; url: string; freelancer?: boolean }) {
  const company = oneLine(input.company, 120) || (input.freelancer ? "Freelancer" : "Kunde");
  const head = ["Neue Terminanfrage", input.freelancer && input.company ? `${company} (Freelancer)` : company, oneLine(input.author, 120)].filter(Boolean).join(" · ");
  return telegramChatMessage({ company: head, author: "", body: `${oneLine(input.title, 200)}\n${oneLine(input.when, 120)}`, url: input.url });
}

/**
 * A customer's file in the upload area for the group (28.11.2026): „Neuer Upload · Firma · Name“ in bold, then the file
 * with its size, and a button into Asset Management › Upload-Bereich.
 */
export function telegramUploadReceived(input: { company: string; uploader: string; fileName: string; size: string; url: string }) {
  const head = ["Neuer Upload", oneLine(input.company, 120) || "Kunde", oneLine(input.uploader, 120)].filter(Boolean).join(" · ");
  return telegramChatMessage({ company: head, author: "", body: `${oneLine(input.fileName, 200)}\n${oneLine(input.size, 40)} · wartet bis zu 7 Tage im Upload-Bereich`, url: input.url });
}

export const telegramTestMessage = () => ({
  text: "Testmeldung aus dem oalab Client Hub: Telegram ist eingerichtet. Schreibt ein Kunde im privaten Chat, kommt seine Nachricht hier an.",
});
