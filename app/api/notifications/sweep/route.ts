import { createHash, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { siteOrigin } from "@/lib/site-origin";
import { runNotificationSweep } from "@/lib/hub-notify/server";

// The schedule for notifications: pg_cron in the database calls this every five minutes with the token from Vault
// (migration hub_notifications). Without HUB_NOTIFY_TOKEN, or with another token, nothing happens. A run only does
// what is due, so an extra call never sends twice.

// Room for the mails that run after the response.
export const maxDuration = 60;

const digest = (value: string) => createHash("sha256").update(value).digest();

function authorized(header: string | null, token: string) {
  return timingSafeEqual(digest(header ?? ""), digest(`Bearer ${token}`));
}

export async function POST(request: Request) {
  const token = process.env.HUB_NOTIFY_TOKEN?.trim();
  if (!token) return new Response("Benachrichtigungen sind nicht eingerichtet.", { status: 503 });
  if (!authorized(request.headers.get("authorization"), token)) return new Response("Unauthorized", { status: 401 });
  const origin = siteOrigin(request.headers) ?? "https://hub.oalab.de";
  // Answer at once (pg_net waits ten seconds at most); the run follows in the background.
  after(async () => {
    const result = await runNotificationSweep(origin);
    console.info(`[hub-notify] ${JSON.stringify(result)}`);
  });
  return new Response(null, { status: 202 });
}
