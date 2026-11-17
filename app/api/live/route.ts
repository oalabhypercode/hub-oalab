import { createClient } from "@/lib/supabase/server";
import { LIVE_LINES, liveVersion } from "@/lib/hub-notify/rules";

// The live check (stage 1 of „Echtzeit“, 18.11.2026): every open, visible tab asks here every 15 seconds and when
// it comes back whether something is new for its login (components/hub/use-live-sync.ts). The answer is only a short
// version of the bell and, for admins, of the waiting registrations, built like the page builds it from its own
// data (lib/hub-notify/rules.ts liveVersion); the page itself reads the news with the person's rights. Everything is
// read with the person's own session, so RLS decides: their own notices, and only active admins count registrations.

const fresh = { "Cache-Control": "no-store" };

export async function GET() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) return Response.json({ version: null }, { status: 401, headers: fresh });
  const admin = (claims.app_metadata as Record<string, unknown> | undefined)?.app_role === "oalab_admin";
  const [unread, latest, pending] = await Promise.all([
    supabase.from("hub_inbox").select("id", { count: "exact", head: true }).is("read_at", null),
    supabase.from("hub_inbox").select("id, created_at, read_at, title, body").order("created_at", { ascending: false }).limit(LIVE_LINES)
      .returns<{ id: number; created_at: string; read_at: string | null; title: string; body: string }[]>(),
    admin ? supabase.from("hub_profiles").select("user_id", { count: "exact", head: true }).eq("status", "pending") : null,
  ]);
  // Without the bell (no table, no connection) there is nothing to compare; the tab simply asks again later.
  if (unread.error || latest.error) return Response.json({ version: null }, { headers: fresh });
  const version = liveVersion({
    unread: unread.count ?? 0,
    items: (latest.data ?? []).map((row) => ({ id: row.id, createdAt: row.created_at, read: Boolean(row.read_at), title: row.title, body: row.body })),
    // As the layout counts them (countPendingRegistrations): a failed count is none.
    pending: pending && !pending.error ? pending.count ?? 0 : 0,
  });
  return Response.json({ version }, { headers: fresh });
}
