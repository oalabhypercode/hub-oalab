import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { AssistantTurn } from "./conversation";
import { ASSISTANT_MODEL, assistantSystem, type AssistantAccess, type AssistantChannel, type AssistantRole } from "./knowledge";
import { ASSISTANT_TOOLS } from "./tools";
import { PROPOSE_TASKS_TOOL } from "./proposals";

// One Claude request for both channels: the hub chat streams it, WhatsApp waits for the whole answer.

export const assistantConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

export const REFUSAL_TEXT = "Dazu kann ich leider nichts sagen. Frag mich gern etwas zu den Funktionen des Client Hub.";

export function assistantRequest(messages: Anthropic.Beta.BetaMessageParam[], role: AssistantRole, channel: AssistantChannel, access: AssistantAccess = "none") {
  const tools = access === "tools";
  return {
    model: ASSISTANT_MODEL,
    max_tokens: 16000,
    // Short help answers: low effort keeps them quick. Data questions with tools get one level more, so the
    // assistant picks the right tools and reads the results carefully. A refused request is retried on a fallback model.
    output_config: { effort: tools ? "medium" as const : "low" as const },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
    system: assistantSystem(role, channel, access),
    // Read tools plus one proposal tool; nothing the assistant calls writes to Studio.
    ...(tools ? { tools: [...ASSISTANT_TOOLS, PROPOSE_TASKS_TOOL] } : {}),
    messages,
  };
}

/** The complete answer as text (WhatsApp: help only, never tools). Throws the SDK's typed errors (Anthropic.APIError and subclasses). */
export async function askAssistant(turns: AssistantTurn[], role: AssistantRole, channel: AssistantChannel) {
  const message = await new Anthropic().beta.messages.create(assistantRequest(turns, role, channel));
  if (message.stop_reason === "refusal") return REFUSAL_TEXT;
  return message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("").trim();
}
