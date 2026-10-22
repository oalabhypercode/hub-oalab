import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { askAssistant, assistantConfigured } from "@/lib/hub-assistant/claude";
import { cleanConversation } from "@/lib/hub-assistant/conversation";
import {
  DAILY_QUESTION_LIMIT, DEFAULT_SUPPORT_CONTACT, GRAPH_API_VERSION, HISTORY_HOURS, HISTORY_TURNS, historyTurns, isTeamRequest,
  parseLinkCode, replies, RETENTION_HOURS, toWhatsAppText, UNLINKED_REPLY_LIMIT, type IncomingMessage, type StoredTurn,
} from "./messages";

// The WhatsApp webhook has no user session, so it works with the service role. It only ever touches the
// WhatsApp tables and reads the role of a linked login; it never reads customer data.

export function whatsappConfig() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!accessToken || !phoneNumberId || !appSecret || !verifyToken || !supabaseUrl || !secretKey) return null;
  return { accessToken, phoneNumberId, appSecret, verifyToken, supabaseUrl, secretKey, supportContact: process.env.WHATSAPP_SUPPORT_CONTACT?.trim() || DEFAULT_SUPPORT_CONTACT };
}

type WhatsAppConfig = NonNullable<ReturnType<typeof whatsappConfig>>;

const since = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

async function graph(config: WhatsAppConfig, body: Record<string, unknown>) {
  const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${config.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`WhatsApp API antwortet mit ${response.status}`);
  return response.json() as Promise<{ messages?: { id?: string }[] }>;
}

async function send(config: WhatsAppConfig, db: SupabaseClient, to: string, text: string) {
  const sent = await graph(config, { recipient_type: "individual", to, type: "text", text: { preview_url: false, body: text } });
  const id = sent.messages?.[0]?.id;
  await db.from("hub_whatsapp_messages").insert({ ...(id ? { id } : {}), phone: to, role: "assistant", content: text });
}

/** Links the number to the login whose valid code it sent; a number belongs to one login at a time. */
async function linkNumber(db: SupabaseClient, phone: string, code: string) {
  const { data: pending } = await db.from("hub_whatsapp_link_codes").select("user_id").eq("code", code).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (!pending) return false;
  await db.from("hub_whatsapp_links").delete().eq("phone", phone);
  const { error } = await db.from("hub_whatsapp_links").upsert({ user_id: pending.user_id, phone, linked_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new Error(`Verknüpfung fehlgeschlagen: ${error.message}`);
  await db.from("hub_whatsapp_link_codes").delete().eq("user_id", pending.user_id);
  return true;
}

async function roleOf(db: SupabaseClient, userId: string) {
  const { data } = await db.auth.admin.getUserById(userId);
  return (data.user?.app_metadata as Record<string, unknown> | undefined)?.app_role === "oalab_admin" ? "admin" : "customer";
}

/** Only approved, active logins get answers; before the user management migration every linked login counts. */
async function isActiveLogin(db: SupabaseClient, userId: string) {
  const { data, error } = await db.from("hub_profiles").select("status").eq("user_id", userId).maybeSingle<{ status: string }>();
  if (error) return error.code === "42P01" || error.code === "PGRST205";
  return data?.status === "active";
}

/** Answers one incoming message. Runs after the webhook has already confirmed the delivery to Meta. */
export async function handleIncoming(config: WhatsAppConfig, message: IncomingMessage) {
  const db = createClient(config.supabaseUrl, config.secretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

  // Store first: a repeated delivery of the same message id stops here.
  const stored = await db.from("hub_whatsapp_messages").insert({ id: message.id, phone: message.from, role: "user", content: message.text ?? "" });
  if (stored.error) {
    if (stored.error.code === "23505") return;
    throw new Error(`Nachricht konnte nicht gespeichert werden: ${stored.error.message}`);
  }
  await db.from("hub_whatsapp_messages").delete().lt("created_at", since(RETENTION_HOURS));
  // Read receipt and typing indicator are a courtesy; a failure there must not stop the answer.
  graph(config, { status: "read", message_id: message.id, typing_indicator: { type: "text" } }).catch(() => undefined);

  const reply = (text: string) => send(config, db, message.from, text);
  const [{ data: link }, { count }] = await Promise.all([
    db.from("hub_whatsapp_links").select("user_id").eq("phone", message.from).maybeSingle(),
    db.from("hub_whatsapp_messages").select("id", { count: "exact", head: true }).eq("phone", message.from).eq("role", "user").gt("created_at", since(24)),
  ]);
  const today = count ?? 0;

  // Unknown numbers get a few replies a day (instructions or code checks), then silence.
  if (!link && today > UNLINKED_REPLY_LIMIT) return;
  if (link && today > DAILY_QUESTION_LIMIT) {
    if (today === DAILY_QUESTION_LIMIT + 1) await reply(replies.limit);
    return;
  }

  const code = message.text ? parseLinkCode(message.text) : null;
  if (code) return reply(await linkNumber(db, message.from, code) ? replies.linked : replies.invalidCode);
  if (!link) return reply(replies.notLinked);
  if (message.text && isTeamRequest(message.text)) return reply(replies.team(config.supportContact));
  if (!(await isActiveLogin(db, link.user_id))) return reply(replies.inactive);
  if (!message.text) return reply(replies.textOnly);
  if (!assistantConfigured()) return reply(replies.unavailable);

  const { data: rows } = await db.from("hub_whatsapp_messages").select("role, content")
    .eq("phone", message.from).gt("created_at", since(HISTORY_HOURS))
    .order("created_at", { ascending: false }).limit(HISTORY_TURNS * 2).returns<StoredTurn[]>();
  const conversation = cleanConversation(historyTurns([...(rows ?? [])].reverse()));
  const turns = conversation.ok ? conversation.turns : [{ role: "user" as const, content: message.text }];

  let answer: string;
  try {
    answer = await askAssistant(turns, await roleOf(db, link.user_id), "whatsapp");
  } catch (error) {
    console.error("WhatsApp-Assistent fehlgeschlagen", error instanceof Anthropic.APIError ? error.status : error);
    return reply(replies.unavailable);
  }
  return reply(toWhatsAppText(answer) || replies.unavailable);
}
