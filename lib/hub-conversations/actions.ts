"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import { markServiceRead } from "@/lib/hub-notify/server";
import { conversationReader, loadConversations, loadThread, withUnread } from "./server";
import type { ConversationResult, ConversationsState, ConversationThread } from "./types";

// Every action is a public POST endpoint: authenticate and authorise inside each one. Only active admins read service
// conversations in the hub, and only to follow along; the only write is the team's read mark in the bell.

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = { ok: false as const, error: "Dieses Gespräch gibt es nicht oder nicht für dich." };
const unavailable = { ok: false as const, error: "Die Gespräche konnten gerade nicht geladen werden. Bitte versuche es erneut." };

/** The list again, for the screen's regular look for news. */
export async function refreshConversations(): Promise<ConversationResult<ConversationsState>> {
  const state = await loadConversations();
  return state.error ? { ok: false, error: state.error } : { ok: true, data: await withUnread(state) };
}

/** Open a conversation to read along; its lines in the bell count as read for the whole team. */
export async function openConversation(input: { id: string }): Promise<ConversationResult<ConversationThread>> {
  if (!uuid.test(String(input?.id))) return notFound;
  const db = createAdminClient();
  if (!db || !(await conversationReader())) return unavailable;
  const thread = await loadThread(db, input.id);
  if (!thread) return notFound;
  // The counts in the sidebar and the tab bar come from the layout.
  if (await markServiceRead(input.id)) refreshWorkspace();
  return { ok: true, data: thread };
}
