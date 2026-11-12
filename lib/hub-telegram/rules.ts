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

export const telegramTestMessage = () => ({
  text: "Testmeldung aus dem oalab Client Hub: Telegram ist eingerichtet. Schreibt ein Kunde im privaten Chat, kommt seine Nachricht hier an.",
});
