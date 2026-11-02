"use server";

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SERVICE_PLATFORM_URL } from "@/lib/service-packages";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import { conversationViewer, loadConversations, loadThread, markThreadSeen } from "./server";
import { readMessage, replyError } from "./rules";
import type { ConversationResult, ConversationsState, ConversationThread } from "./types";

// Every action is a public POST endpoint: authenticate and authorise inside each one. Reading goes through
// conversationViewer() and loadThread(), which only return what the signed-in login may see.

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = { ok: false as const, error: "Dieses Gespräch gibt es nicht oder nicht für dich." };
const unavailable = { ok: false as const, error: "Die Gespräche konnten gerade nicht geladen werden. Bitte versuche es erneut." };

async function reader() {
  const db = createAdminClient();
  const viewer = await conversationViewer();
  return db && viewer ? { db, viewer } : null;
}

/** The list again, for the screen's regular look for news. */
export async function refreshConversations(): Promise<ConversationResult<ConversationsState>> {
  const state = await loadConversations();
  return state.error ? { ok: false, error: state.error } : { ok: true, data: state };
}

/** Open a conversation: its messages, and for clients the mark that they read it. */
export async function openConversation(input: { id: string }): Promise<ConversationResult<ConversationThread>> {
  if (!uuid.test(String(input?.id))) return notFound;
  const read = await reader();
  if (!read) return unavailable;
  const thread = await loadThread(read.db, read.viewer, input.id);
  if (!thread) return notFound;
  if (thread.conversation.unread) {
    await markThreadSeen(read.db, read.viewer, input.id);
    // The counts in the sidebar and the tab bar come from the layout.
    refreshWorkspace();
  }
  return { ok: true, data: { ...thread, conversation: { ...thread.conversation, unread: false } } };
}

/** The signed-in person's access token. The service platform checks it itself; the hub only passes it on. */
async function accessToken(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function postReply(reference: string, token: string, payload: { clientGeneratedId: string; expectedVersion: number; message: string }) {
  try {
    const response = await fetch(`${SERVICE_PLATFORM_URL}/api/hub/requests/${encodeURIComponent(reference)}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return { ok: true as const };
    const body = await response.json().catch(() => null) as { error?: { code?: string } } | null;
    return { ok: false as const, status: response.status, code: body?.error?.code };
  } catch {
    return { ok: false as const, status: 0, code: undefined };
  }
}

/**
 * A client's reply. It goes to the service platform, which checks the person's session and writes it on the same path
 * as its own chat, so the team, Synara and NoteTree learn of it as usual. If only an internal step changed the request
 * since the person loaded it (no new message to read), the reply goes once more with the current version.
 */
export async function sendConversationMessage(input: { id: string; body: string; clientGeneratedId: string; version: number; lastMessageId: string | null }): Promise<ConversationResult<ConversationThread>> {
  if (!uuid.test(String(input?.id)) || !uuid.test(String(input?.clientGeneratedId))) return notFound;
  if (!Number.isInteger(input.version) || input.version < 0) return notFound;
  const message = readMessage(input.body);
  if (!message.ok) return message;
  const read = await reader();
  if (!read) return unavailable;
  if (read.viewer.admin) return { ok: false, error: "Admins lesen hier mit; Antworten von oalab entstehen in NoteTree Business." };
  const thread = await loadThread(read.db, read.viewer, input.id);
  if (!thread) return notFound;
  if (!thread.conversation.canReply) return { ok: false, error: "Dieses Gespräch ist abgeschlossen. Für etwas Neues starte bitte ein neues Gespräch." };
  const token = await accessToken();
  if (!token) return { ok: false, error: replyError(401, "AUTHENTICATION_REQUIRED") };

  let sent = await postReply(thread.conversation.reference, token, { clientGeneratedId: input.clientGeneratedId, expectedVersion: input.version, message: message.value });
  if (!sent.ok && (sent.code === "STALE_VERSION" || sent.status === 409)) {
    const latest = await loadThread(read.db, read.viewer, input.id);
    const newest = latest?.messages.at(-1)?.id ?? null;
    if (latest && newest === input.lastMessageId) {
      // The first try wrote nothing, so a fresh client id cannot double the message.
      sent = await postReply(latest.conversation.reference, token, { clientGeneratedId: randomUUID(), expectedVersion: latest.conversation.version, message: message.value });
    }
  }
  if (!sent.ok) return { ok: false, error: replyError(sent.status, sent.code) };

  const fresh = await loadThread(read.db, read.viewer, input.id);
  await markThreadSeen(read.db, read.viewer, input.id);
  return { ok: true, data: fresh ? { ...fresh, conversation: { ...fresh.conversation, unread: false } } : thread };
}
