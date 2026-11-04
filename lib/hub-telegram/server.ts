import "server-only";
import { telegramConfig } from "./rules";

// The admins' Telegram group, through the official Bot API: one HTTPS request per message, no server of our own, no
// webhook. The token travels in the request's address, so nothing here ever logs an address or an error text.

/** Whether the bot's token and the group are set in the environment. */
export const telegramReady = () => telegramConfig(process.env) !== null;

/** Sends one message to the admins' group. Never throws: a message that does not arrive costs only the message. */
export async function sendTelegram(message: Record<string, unknown>): Promise<"sent" | "off" | "failed"> {
  const config = telegramConfig(process.env);
  if (!config) return "off";
  try {
    const response = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: config.chatId, link_preview_options: { is_disabled: true }, ...message }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return "sent";
    console.error("[hub-telegram] Meldung nicht angenommen", response.status);
    return "failed";
  } catch (error) {
    console.error("[hub-telegram] Meldung nicht angekommen", error instanceof Error ? error.name : "unbekannt");
    return "failed";
  }
}
