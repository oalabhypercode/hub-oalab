import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { cleanConversation, MAX_ADMIN_QUESTION_CHARS, MAX_QUESTION_CHARS } from "@/lib/hub-assistant/conversation";
import { assistantConfigured, assistantRequest, REFUSAL_TEXT } from "@/lib/hub-assistant/claude";
import type { AssistantAccess } from "@/lib/hub-assistant/knowledge";
import { loadAssistantData, loadCustomerContext } from "@/lib/hub-assistant/data";
import { describeContext, readContext, runAssistantTool, toolStatus, type AssistantData, type ToolOutcome } from "@/lib/hub-assistant/tools";
import { prepareTaskProposal } from "@/lib/hub-assistant/proposals";
import { saveProposal, saveTaskProposal } from "@/lib/hub-assistant/action-store";
import { prepareProjectUpdate, prepareTaskUpdates } from "@/lib/hub-assistant/updates";
import { prepareCustomerProposal } from "@/lib/hub-assistant/customers";
import { secondFactorMissing } from "@/lib/hub-auth/second-factor";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { cleanEmail, cleanLine, cleanPhone, cleanWebsite, normalizeCompany, readPerson } from "@/lib/hub-users/rules";

// The hub assistant: answers questions about the platform with Claude. Only signed-in Supabase users reach it (public
// demo and preview never do). Customers get help only; verified admins with a confirmed second factor may also let it
// read customers, projects and tasks, and propose new tasks, changes and customers. Nothing here writes to Studio or
// Service: a proposal is only stored for the admin to confirm in the chat (lib/hub-assistant/actions.ts).
// The answer streams back as one JSON object per line: {"t":"text"|"tool"|"proposal"|"error","v":"…"}.

export const maxDuration = 120;

/** Tool rounds per question; more means the question is too broad. */
const MAX_ROUNDS = 8;

type StreamEvent = "text" | "tool" | "proposal" | "error";

/**
 * propose_project_update / propose_task_updates: check the change against what the admin sees (with the Studio
 * versions read now), store it and show "old → new" as a preview card; nothing is saved in Studio here.
 */
async function proposeChange(name: "propose_project_update" | "propose_task_updates", input: unknown, store: AssistantData, userId: string, send: (t: StreamEvent, v: string) => void): Promise<ToolOutcome> {
  const prepared = name === "propose_project_update" ? prepareProjectUpdate(input, store) : prepareTaskUpdates(input, store);
  if (!prepared.ok) return prepared;
  const kind = name === "propose_project_update" ? "project.update" : "tasks.update";
  const saved = await saveProposal(userId, kind, prepared.proposal, prepared.proposal);
  if (!saved.ok) return saved;
  send("proposal", JSON.stringify({ kind, ...prepared.proposal, id: saved.id, expiresAt: saved.expiresAt }));
  return {
    ok: true,
    content: JSON.stringify({
      proposal_id: saved.id,
      state: "Vorschau alt → neu angezeigt, NICHT gespeichert. Der Nutzer prüft und speichert selbst.",
      changes: "changes" in prepared.proposal ? prepared.proposal.changes.length : prepared.proposal.tasks.length,
    }),
  };
}

/**
 * propose_customer: check the new customer against the existing ones, the active Service packages and the logins,
 * store it and show it as a preview card; nothing is created here. Same input rules as the user management form.
 */
async function proposeCustomer(input: unknown, store: AssistantData, userId: string, send: (t: StreamEvent, v: string) => void): Promise<ToolOutcome> {
  const context = await loadCustomerContext();
  if (!context) return { ok: false, error: "Pakete und Logins sind gerade nicht erreichbar. Bitte gleich noch einmal versuchen." };
  const prepared = prepareCustomerProposal(input, store, context, { cleanEmail, cleanLine, cleanPhone, cleanWebsite, normalizeCompany, readPerson });
  if (!prepared.ok) return prepared;
  const saved = await saveProposal(userId, "customer.create", { organizationId: null, projectId: null }, prepared.proposal);
  if (!saved.ok) return saved;
  send("proposal", JSON.stringify({ kind: "customer.create", ...prepared.proposal, id: saved.id, expiresAt: saved.expiresAt }));
  const { login, plans, planId, similar } = prepared.proposal;
  return {
    ok: true,
    content: JSON.stringify({
      proposal_id: saved.id,
      state: "Vorschau angezeigt, NICHT angelegt. Der Nutzer wählt Paket und Login und legt selbst an; die Kundennummer vergibt der Hub dabei.",
      package: plans.find((plan) => plan.id === planId)?.name,
      login_offered: Boolean(login && !login.taken),
      ...(login?.taken ? { login_note: "Für diese E-Mail gibt es schon einen Login; die Vorschau bietet keinen neuen an." } : {}),
      similar_customers: similar.map((item) => `${item.company} (${item.customerNumber})`),
    }),
  };
}

/**
 * propose_tasks: check the proposal against the user's own messages, store it for the admin and show it as a preview
 * card; nothing is saved in Studio. The quotes go only to the preview, never into the database.
 */
async function proposeTasks(input: unknown, store: AssistantData, userId: string, sources: readonly string[], send: (t: StreamEvent, v: string) => void): Promise<ToolOutcome> {
  const prepared = prepareTaskProposal(input, store, sources);
  if (!prepared.ok) return prepared;
  const saved = await saveTaskProposal(userId, prepared.proposal);
  if (!saved.ok) return saved;
  send("proposal", JSON.stringify({ kind: "tasks.create", ...saved.view, evidence: prepared.evidence }));
  const duplicates = saved.view.tasks.filter((task) => task.duplicate).length;
  const unsupported = saved.view.tasks.filter((task) => task.unsupported).length;
  return {
    ok: true,
    content: JSON.stringify({
      proposal_id: saved.view.id,
      state: "Vorschau angezeigt, NICHT gespeichert. Der Nutzer prüft und speichert selbst.",
      tasks: saved.view.tasks.length,
      possible_duplicates: duplicates,
      // Deselected in the preview; the assistant should say which quotes it could not back up.
      quotes_not_found: unsupported,
    }),
  };
}

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

  // The role comes from the verified token, never from the browser.
  const admin = (data.claims.app_metadata as Record<string, unknown> | undefined)?.app_role === "oalab_admin";
  const userId = data.claims.sub;
  const body = await request.json().catch(() => null) as { messages?: unknown; context?: unknown } | null;
  // Admins may paste meeting transcripts; customers keep the short question limit.
  const conversation = cleanConversation(body?.messages, admin ? MAX_ADMIN_QUESTION_CHARS : MAX_QUESTION_CHARS);
  if (!conversation.ok) return failure(400, conversation.error);

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
  // What the user wrote in this conversation; quotes behind proposed tasks have to come from here.
  const sources = conversation.turns.filter((turn) => turn.role === "user").map((turn) => turn.content);
  if (context) messages.push({ role: "system", content: context });

  const client = new Anthropic();
  const encoder = new TextEncoder();
  let current: { abort: () => void } | null = null;

  return new Response(new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (t: StreamEvent, v: string) => controller.enqueue(encoder.encode(`${JSON.stringify({ t, v })}\n`));
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
          const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
          for (const block of message.content) {
            if (block.type !== "tool_use") continue;
            send("tool", toolStatus(block.name, block.input, store));
            const outcome = block.name === "propose_tasks" ? await proposeTasks(block.input, store, userId, sources, send)
              : block.name === "propose_project_update" || block.name === "propose_task_updates" ? await proposeChange(block.name, block.input, store, userId, send)
              : block.name === "propose_customer" ? await proposeCustomer(block.input, store, userId, send)
              : runAssistantTool(block.name, block.input, store);
            results.push(outcome.ok
              ? { type: "tool_result", tool_use_id: block.id, content: outcome.content }
              : { type: "tool_result", tool_use_id: block.id, content: outcome.error, is_error: true });
          }
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
