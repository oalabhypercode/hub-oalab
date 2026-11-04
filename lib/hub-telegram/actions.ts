"use server";

import { verifyHubAdmin } from "@/lib/hub-users/server";
import { telegramTestMessage } from "./rules";
import { sendTelegram, telegramReady } from "./server";

// Every action is a public POST endpoint: only active admins learn whether Telegram is set up or send a test.

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const adminsOnly = { ok: false as const, error: "Das geht nur mit einem Admin-Login." };

/** Whether the admins' Telegram group is set up, for the profile. */
export async function getTelegramStatus(): Promise<Result<{ ready: boolean }>> {
  if (!(await verifyHubAdmin())) return adminsOnly;
  return { ok: true, data: { ready: telegramReady() } };
}

/** A test message into the admins' group, to check the setup after it is entered. */
export async function sendTelegramTest(): Promise<Result<null>> {
  if (!(await verifyHubAdmin())) return adminsOnly;
  const result = await sendTelegram(telegramTestMessage());
  if (result === "off") return { ok: false, error: "Telegram ist noch nicht eingerichtet: Bot-Token und Gruppen-Nummer fehlen." };
  if (result === "failed") return { ok: false, error: "Telegram hat die Meldung nicht angenommen. Stimmen Bot-Token und Gruppen-Nummer, und ist der Bot in der Gruppe?" };
  return { ok: true, data: null };
}
