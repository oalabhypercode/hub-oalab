import { after } from "next/server";
import { extractMessages, verifySignature } from "@/lib/hub-whatsapp/messages";
import { handleIncoming, whatsappConfig } from "@/lib/hub-whatsapp/server";

// Webhook for the WhatsApp Cloud API (Meta). Public, because Meta has no session: every POST
// must carry a valid signature made with the app secret, otherwise nothing happens.

// Room for the Claude answer that runs after the response.
export const maxDuration = 60;

const notConfigured = () => new Response("WhatsApp ist nicht eingerichtet.", { status: 503 });

/** Meta checks the webhook URL once: echo the challenge when the verify token matches. */
export async function GET(request: Request) {
  const config = whatsappConfig();
  if (!config) return notConfigured();
  const params = new URL(request.url).searchParams;
  if (params.get("hub.mode") === "subscribe" && params.get("hub.verify_token") === config.verifyToken) {
    return new Response(params.get("hub.challenge") ?? "", { headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const config = whatsappConfig();
  if (!config) return notConfigured();
  const body = new Uint8Array(await request.arrayBuffer());
  if (!verifySignature(body, request.headers.get("x-hub-signature-256"), config.appSecret)) return new Response("Invalid signature", { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const messages = extractMessages(payload, config.phoneNumberId);
  // Confirm at once (Meta retries unconfirmed deliveries); the answers follow in the background.
  if (messages.length) {
    after(async () => {
      for (const message of messages) {
        try {
          await handleIncoming(config, message);
        } catch (error) {
          console.error("WhatsApp-Nachricht nicht verarbeitet", message.id, error);
        }
      }
    });
  }
  return new Response("OK");
}
