import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { cleanConversation } from "@/lib/hub-assistant/conversation";
import { ASSISTANT_MODEL, assistantSystem } from "@/lib/hub-assistant/knowledge";

// The hub assistant: answers questions about the platform's functions with Claude.
// Only signed-in Supabase users reach it (public demo and preview never do); only the conversation
// itself goes to Anthropic, no customer data. The answer streams back as plain text.

const failure = (status: number, error: string) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

function describeError(error: unknown) {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return failure(503, "Der Assistent ist nicht richtig eingerichtet (API-Schlüssel prüfen).");
  if (error instanceof Anthropic.RateLimitError) return failure(429, "Gerade kommen zu viele Fragen an. Bitte versuche es gleich noch einmal.");
  if (error instanceof Anthropic.BadRequestError) return failure(400, "Diese Frage konnte nicht verarbeitet werden. Bitte starte den Chat neu.");
  if (error instanceof Anthropic.APIError) return failure(502, "Der Assistent ist gerade nicht erreichbar. Bitte versuche es später erneut.");
  return failure(500, "Der Assistent ist gerade nicht erreichbar. Bitte versuche es später erneut.");
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return failure(401, "Der Assistent ist nur mit echtem Login verfügbar.");
  if (!process.env.ANTHROPIC_API_KEY) return failure(503, "Der Assistent ist noch nicht eingerichtet. Es fehlt der API-Schlüssel (ANTHROPIC_API_KEY).");

  const body = await request.json().catch(() => null);
  const conversation = cleanConversation((body as { messages?: unknown } | null)?.messages);
  if (!conversation.ok) return failure(400, conversation.error);
  // The role comes from the verified token, never from the browser.
  const admin = (data.claims.app_metadata as Record<string, unknown> | undefined)?.app_role === "oalab_admin";

  const stream = new Anthropic().beta.messages.stream({
    model: ASSISTANT_MODEL,
    max_tokens: 16000,
    // Short help answers: low effort keeps them quick; a refused request is retried on a fallback model.
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: assistantSystem(admin ? "admin" : "customer"),
    messages: conversation.turns,
  }, { signal: request.signal });

  // Wait for the first event so connection and key problems still become a proper error status.
  const events = stream[Symbol.asyncIterator]();
  let first: IteratorResult<Anthropic.Beta.Messages.BetaRawMessageStreamEvent>;
  try {
    first = await events.next();
  } catch (cause) {
    return describeError(cause);
  }

  const encoder = new TextEncoder();
  const text = (event: Anthropic.Beta.Messages.BetaRawMessageStreamEvent) =>
    event.type === "content_block_delta" && event.delta.type === "text_delta" ? event.delta.text : "";

  return new Response(new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (let next = first; !next.done; next = await events.next()) {
          const chunk = text(next.value);
          if (chunk) controller.enqueue(encoder.encode(chunk));
        }
        const message = await stream.finalMessage();
        if (message.stop_reason === "refusal") controller.enqueue(encoder.encode("Dazu kann ich leider nichts sagen. Frag mich gern etwas zu den Funktionen des Client Hub."));
        if (message.stop_reason === "max_tokens") controller.enqueue(encoder.encode(" …"));
      } catch {
        if (!request.signal.aborted) controller.enqueue(encoder.encode("\n\nDie Antwort wurde unterbrochen. Bitte versuche es erneut."));
      }
      controller.close();
    },
    cancel() {
      stream.abort();
    },
  }), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
