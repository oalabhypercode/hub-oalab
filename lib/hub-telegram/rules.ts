// Telegram for admins (4 November 2026): when a customer writes in the private chat, the admins' Telegram group hears
// of it too, with the company and a way into the hub, never with the text itself (bot chats are not end-to-end
// encrypted). Pure rules for the server and the tests; this file imports nothing.

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

/**
 * The message for a new chat: the company and a button into the hub. Telegram takes only public https addresses for
 * buttons; elsewhere (a local test) the address stands in the text.
 */
export function telegramChatMessage(input: { company: string; url: string }) {
  const company = input.company.replace(/\s+/g, " ").trim().slice(0, 120) || "einem Kunden";
  const button = /^https:\/\/[^\s/]+\.[^\s/]+\//.test(input.url);
  return {
    text: `Neue Nachricht von ${company} im privaten Chat des Client Hub.${button ? "" : `\n${input.url}`}`,
    ...(button ? { reply_markup: { inline_keyboard: [[{ text: "Im Hub öffnen", url: input.url }]] } } : {}),
  };
}

export const telegramTestMessage = () => ({
  text: "Testmeldung aus dem oalab Client Hub: Telegram ist eingerichtet. Schreibt ein Kunde im privaten Chat, kommt hier eine Meldung an.",
});
