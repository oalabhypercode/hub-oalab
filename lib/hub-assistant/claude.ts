import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { AssistantTurn } from "./conversation";
import { ASSISTANT_MODEL, assistantSystem, type AssistantChannel, type AssistantRole } from "./knowledge";

// One Claude request for both channels: the hub chat streams it, WhatsApp waits for the whole answer.

export const assistantConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

export const REFUSAL_TEXT = "Dazu kann ich leider nichts sagen. Frag mich gern etwas zu den Funktionen des Client Hub.";

export function assistantRequest(turns: AssistantTurn[], role: AssistantRole, channel: AssistantChannel) {
  return {
    model: ASSISTANT_MODEL,
    max_tokens: 16000,
    // Short help answers: low effort keeps them quick; a refused request is retried on a fallback model.
    output_config: { effort: "low" as const },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
    system: assistantSystem(role, channel),
    messages: turns,
  };
}

/** The complete answer as text. Throws the SDK's typed errors (Anthropic.APIError and subclasses). */
export async function askAssistant(turns: AssistantTurn[], role: AssistantRole, channel: AssistantChannel) {
  const message = await new Anthropic().beta.messages.create(assistantRequest(turns, role, channel));
  if (message.stop_reason === "refusal") return REFUSAL_TEXT;
  return message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("").trim();
}
