import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { cleanConversation } from "@/lib/hub-assistant/conversation";
import { assistantConfigured, assistantRequest, REFUSAL_TEXT } from "@/lib/hub-assistant/claude";
import type { AssistantAccess } from "@/lib/hub-assistant/knowledge";
import { loadAssistantData } from "@/lib/hub-assistant/data";
import { describeContext, readContext, runAssistantTool, toolStatus, type AssistantData } from "@/lib/hub-assistant/tools";
import { secondFactorMissing } from "@/lib/hub-auth/second-factor";
import { verifyHubAdmin } from "@/lib/hub-users/server";

// The hub assistant: answers questions about the platform with Claude. Only signed-in Supabase users reach it (public
// demo and preview never do). Customers get help only; verified admins with a confirmed second factor may also let it
// read customers, projects and tasks through read-only tools. Nothing here writes.
// The answer streams back as one JSON object per line: {"t":"text"|"tool"|"error","v":"…"}.

export const maxDuration = 120;

/** Tool rounds per question; more means the question is too broad. */
const MAX_ROUNDS = 8;

const failure = (status: number, error: string) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

function errorText(error: unknown) {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return "Der Assistent ist nicht richtig eingerichtet (API-Schlüssel prüfen).";
  if (error instanceof Anthropic.RateLimitError) return "Gerade kommen zu viele Fragen an. Bitte versuche es gleich noch einmal.";
  if (error instanceof Anthropic.BadRequestError) return "Diese Frage konnte nicht verarbeitet werden. Bitte starte den Chat neu.";
  return "Der Assistent ist gerade nicht erreichbar. Bitte versuche es später erneut.";
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return failure(401, "Der Assistent ist nur mit echtem Login verfügbar.");
  if (await secondFactorMissing(supabase, data.claims.aal)) return failure(401, "Bitte bestätige zuerst deinen Sicherheitscode.");
  // Only approved logins may ask (each question costs money). Before the user management migration the
  // function is missing; then the earlier rule (any signed-in login) still applies.
  const { data: active, error: activeError } = await supabase.rpc("hub_is_active");
  const missing = activeError?.code === "PGRST202" || activeError?.code === "42883";
  if (activeError && !missing) return failure(503, "Der Assistent ist gerade nicht erreichbar. Bitte versuche es später erneut.");
  if (!activeError && active !== true) return failure(403, "Der Assistent steht dir zur Verfügung, sobald dein Zugang freigegeben ist.");
  if (!assistantConfigured()) return failure(503, "Der Assistent ist noch nicht eingerichtet. Es fehlt der API-Schlüssel (ANTHROPIC_API_KEY).");

  const body = await request.json().catch(() => null) as { messages?: unknown; context?: unknown } | null;
  const conversation = cleanConversation(body?.messages);
  if (!conversation.ok) return failure(400, conversation.error);
  // The role comes from the verified token, never from the browser.
  const admin = (data.claims.app_metadata as Record<string, unknown> | undefined)?.app_role === "oalab_admin";

  // Data tools only for an admin the database confirms, signed in with a confirmed second factor.
  let access: AssistantAccess = "none";
  let store: AssistantData | null = null;
  if (admin && data.claims.aal !== "aal2") access = "needs-second-factor";
  else if (admin && await verifyHubAdmin()) {
    store = await loadAssistantData();
    access = store ? "tools" : "unavailable";
  }

  const messages: Anthropic.Beta.BetaMessageParam[] = [...conversation.turns];
  // The open page as an operator note after the question: the cached prefix stays the same, and a project id from
  // the browser only reaches Claude if this admin can see that project.
  const context = store ? describeContext(readContext(body?.context), store) : null;
  if (context) messages.push({ role: "system", content: context });

  const client = new Anthropic();
  const encoder = new TextEncoder();
  let current: { abort: () => void } | null = null;

  return new Response(new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (t: "text" | "tool" | "error", v: string) => controller.enqueue(encoder.encode(`${JSON.stringify({ t, v })}\n`));
      let wroteText = false;
      try {
        for (let round = 0; ; round++) {
          const stream = client.beta.messages.stream(assistantRequest(messages, admin ? "admin" : "customer", "web", access), { signal: request.signal });
          current = stream;
          // Text of a later round starts on a new paragraph after what the assistant said before its tool calls.
          let breakFirst = wroteText;
          for await (const event of stream) {
            if (event.type !== "content_block_delta" || event.delta.type !== "text_delta" || !event.delta.text) continue;
            send("text", breakFirst ? `\n\n${event.delta.text}` : event.delta.text);
            breakFirst = false;
            wroteText = true;
          }
          const message = await stream.finalMessage();
          if (message.stop_reason === "refusal") { send("text", wroteText ? `\n\n${REFUSAL_TEXT}` : REFUSAL_TEXT); break; }
          if (message.stop_reason === "max_tokens") { send("text", " …"); break; }
          if (message.stop_reason !== "tool_use" || !store) break;
          if (round + 1 >= MAX_ROUNDS) { send("text", "\n\nDafür bräuchte ich zu viele Schritte. Bitte stell die Frage etwas genauer."); break; }
          // The assistant's turn goes back unchanged (thinking and tool calls included), followed by all results at once.
          messages.push({ role: "assistant", content: message.content });
          const results: Anthropic.Beta.BetaToolResultBlockParam[] = message.content.flatMap((block) => {
            if (block.type !== "tool_use") return [];
            send("tool", toolStatus(block.name, block.input, store));
            const outcome = runAssistantTool(block.name, block.input, store);
            return [outcome.ok
              ? { type: "tool_result" as const, tool_use_id: block.id, content: outcome.content }
              : { type: "tool_result" as const, tool_use_id: block.id, content: outcome.error, is_error: true }];
          });
          messages.push({ role: "user", content: results });
        }
      } catch (cause) {
        if (!request.signal.aborted) send("error", errorText(cause));
      }
      controller.close();
    },
    cancel() {
      current?.abort();
    },
  }), { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
