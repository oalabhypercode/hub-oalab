"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { conversationReader, loadConversations, loadThread } from "./server";
import type { ConversationResult, ConversationsState, ConversationThread } from "./types";

// Every action is a public POST endpoint: authenticate and authorise inside each one. Only active admins read service
// conversations in the hub, and only to follow along; nothing here writes.

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = { ok: false as const, error: "Dieses Gespräch gibt es nicht oder nicht für dich." };
const unavailable = { ok: false as const, error: "Die Gespräche konnten gerade nicht geladen werden. Bitte versuche es erneut." };

/** The list again, for the screen's regular look for news. */
export async function refreshConversations(): Promise<ConversationResult<ConversationsState>> {
  const state = await loadConversations();
  return state.error ? { ok: false, error: state.error } : { ok: true, data: state };
}

/** Open a conversation to read along. */
export async function openConversation(input: { id: string }): Promise<ConversationResult<ConversationThread>> {
  if (!uuid.test(String(input?.id))) return notFound;
  const db = createAdminClient();
  if (!db || !(await conversationReader())) return unavailable;
  const thread = await loadThread(db, input.id);
  return thread ? { ok: true, data: thread } : notFound;
}
