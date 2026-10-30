import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { actionOutcome, actionSummary, actionTarget, type ActionKind, type ActionOutcome } from "./log-rules";

// The admin page "KI-Protokoll": the latest assistant proposals with their outcome. hub_assistant_actions is only
// open to the service role, so the hub checks the admin first (as the user management does) and reads with the key.

export type AssistantLogRow = {
  id: string;
  createdAt: string;
  decidedAt: string | null;
  actor: string;
  kind: ActionKind;
  outcome: ActionOutcome;
  target: string;
  summary: string;
  errorCode: string | null;
  projectId: string | null;
};
export type AssistantLogState = { rows: AssistantLogRow[]; error: string | null };

type ActionRow = {
  id: string; actor_id: string; kind: ActionKind; status: string; project_id: string | null; payload: unknown; result: unknown;
  error_code: string | null; created_at: string; decided_at: string | null; expires_at: string;
};

/** The latest 500 proposals, newest first; names of the admins from their profiles. */
export async function loadAssistantLog(): Promise<AssistantLogState> {
  if (!await verifyHubAdmin()) return { rows: [], error: "Das KI-Protokoll sehen nur Admins." };
  const db = createAdminClient();
  if (!db) return { rows: [], error: "Das KI-Protokoll ist noch nicht eingerichtet: Es fehlt der Server-Schlüssel (SUPABASE_SECRET_KEY)." };
  const { data, error } = await db.from("hub_assistant_actions")
    .select("id, actor_id, kind, status, project_id, payload, result, error_code, created_at, decided_at, expires_at")
    .order("created_at", { ascending: false }).limit(500).returns<ActionRow[]>();
  if (error) return { rows: [], error: "Das KI-Protokoll konnte gerade nicht geladen werden. Bitte versuche es erneut." };
  const rows = data ?? [];
  const actorIds = [...new Set(rows.map((row) => row.actor_id))];
  const profiles = actorIds.length
    ? (await db.from("hub_profiles").select("user_id, first_name, last_name").in("user_id", actorIds).returns<{ user_id: string; first_name: string; last_name: string }[]>()).data ?? []
    : [];
  const names = new Map(profiles.map((profile) => [profile.user_id, `${profile.first_name} ${profile.last_name}`.trim()]));
  const now = Date.now();
  return {
    error: null,
    rows: rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      decidedAt: row.decided_at,
      actor: names.get(row.actor_id) || "Gelöschtes Konto",
      kind: row.kind,
      outcome: actionOutcome(row.status, row.expires_at, now),
      target: actionTarget(row.kind, row.payload, row.result),
      summary: actionSummary(row.kind, row.payload),
      errorCode: row.error_code,
      projectId: row.project_id,
    })),
  };
}
