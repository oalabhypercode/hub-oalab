"use client";

import { useEffect, useRef, type RefObject } from "react";
import { SendHorizontal } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { MAX_MESSAGE_LENGTH } from "@/lib/hub-conversations/rules";
import type { ConversationResult, ConversationThread } from "@/lib/hub-conversations/types";

// What the fields of a service conversation share (a customer's request in ./conversations.tsx, a report of the team in
// ./team-issue.tsx): the growing field with its send button, and a step that stays one step.

/** The key and version of a step that got no answer; sending the same again repeats exactly that step. */
export type Attempt = { current: { key: string; version: number } | null };

/**
 * One step on an open conversation. It carries the request's version and one key per draft or click, so a double click or
 * a resend after a lost answer stays one step. True when it worked; the fresh conversation arrives either way.
 */
export async function runStep({ attempt, id, version, call, onChanged, onError }: {
  attempt: Attempt; id: string; version: number;
  call: (input: { id: string; version: number; key: string }) => Promise<ConversationResult<ConversationThread>>;
  onChanged: (thread: ConversationThread) => void; onError: (error: string) => void;
}): Promise<boolean> {
  attempt.current ??= { key: crypto.randomUUID(), version };
  try {
    const result = await call({ id, ...attempt.current });
    // The server answered: the next click is a new step.
    attempt.current = null;
    if (result.data) onChanged(result.data);
    if (!result.ok) onError(result.error);
    return result.ok;
  } catch {
    onError("Keine Verbindung. Bitte versuche es erneut.");
    return false;
  }
}

/** The ref of a field that grows with its text up to a few lines. */
export function useGrowingField(value: string) {
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [value]);
  return field;
}

/** The field and its send button; Enter sends, Shift + Enter makes a new line. */
export function ComposeRow({ id, label, sendLabel, field, value, placeholder, disabled, sending, canSend, onChange }: {
  id: string; label: string; sendLabel: string; field: RefObject<HTMLTextAreaElement | null>; value: string; placeholder: string;
  disabled: boolean; sending: boolean; canSend: boolean; onChange: (value: string) => void;
}) {
  return (
    <div className="chat-compose-row">
      <label className="visually-hidden" htmlFor={id}>{label}</label>
      <textarea id={id} ref={field} rows={1} value={value} maxLength={MAX_MESSAGE_LENGTH} placeholder={placeholder} disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
      <button type="submit" className="chat-send" disabled={!canSend} aria-label={sendLabel}>{sending ? <MiniLoader size={18} /> : <SendHorizontal size={18} aria-hidden="true" />}</button>
    </div>
  );
}
