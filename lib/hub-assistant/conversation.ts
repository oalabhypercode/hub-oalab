/**
 * Limits for the conversation the browser sends to the assistant. Self-contained (no imports)
 * so the route, the chat panel and the tests share the same rules.
 */

export type AssistantTurn = { role: "user" | "assistant"; content: string };

/** The last turns that go to Claude; older ones are dropped. */
export const MAX_TURNS = 20;
export const MAX_QUESTION_CHARS = 1000;
const MAX_ANSWER_CHARS = 8000;

type ConversationCheck = { ok: true; turns: AssistantTurn[] } | { ok: false; error: string };

/** Validates and trims the history: alternating turns, starting and ending with a question. */
export function cleanConversation(input: unknown): ConversationCheck {
  if (!Array.isArray(input)) return { ok: false, error: "Bitte eine Frage eingeben." };
  const turns: AssistantTurn[] = [];
  for (const item of input.slice(-MAX_TURNS)) {
    const role = (item as { role?: unknown })?.role;
    const content = (item as { content?: unknown })?.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return { ok: false, error: "Der Verlauf ist ungültig. Bitte den Chat neu starten." };
    const text = content.trim().slice(0, role === "user" ? MAX_QUESTION_CHARS : MAX_ANSWER_CHARS);
    if (!text) return { ok: false, error: "Bitte eine Frage eingeben." };
    turns.push({ role, content: text });
  }
  // Cutting the history to MAX_TURNS can leave an answer at the start.
  while (turns[0]?.role === "assistant") turns.shift();
  if (!turns.length || turns.at(-1)!.role !== "user") return { ok: false, error: "Bitte eine Frage eingeben." };
  if (turns.some((turn, index) => index > 0 && turn.role === turns[index - 1].role)) return { ok: false, error: "Der Verlauf ist ungültig. Bitte den Chat neu starten." };
  return { ok: true, turns };
}
