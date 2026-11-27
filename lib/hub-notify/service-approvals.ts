import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTelegram } from "@/lib/hub-telegram/server";
import { telegramServiceApproval } from "@/lib/hub-telegram/rules";
import { requestReference } from "@/lib/hub-conversations/rules";
import { SERVICE_APPROVAL_CURSOR, SERVICE_OVERLAP_MINUTES, serviceApprovalMark, serviceApprovalNotice, serviceHref, type Notice } from "./rules";

// „Gefällt mir“ on the service platform (27.11.2026): a customer approved a result of oalab on the test site. Service
// stores it once as `audit_events` `client.preview_approved` (migration 202610180001, target = the result message,
// `safe_metadata.requestId`), and a trigger kicks the hub's sweep right away (migration 202611270003). Every admin gets
// a line in the bell, the bundled mail a few minutes later unless read in the hub, and the admins' Telegram group a
// message. Read from a cursor with marks, like the customers' messages, so a run never reports twice.

type ApprovalRow = { id: string; organization_id: string; actor_id: string | null; occurred_at: string; safe_metadata: { requestId?: unknown } | null };
type RequestRow = { id: string; request_number: number; title: string; organization_id: string };

export type ApprovalDeps = {
  /** Active admin logins: the recipients. */
  admins: () => Promise<string[]>;
  /** Writes the line for these logins; the number written, -1 when it failed. */
  insert: (userIds: string[], notice: Notice) => Promise<number>;
};

const requestOf = (row: ApprovalRow) => {
  const id = row.safe_metadata?.requestId;
  return typeof id === "string" && /^[0-9a-f-]{36}$/.test(id) ? id : null;
};

export async function collectServiceApprovals(db: SupabaseClient, origin: string, deps: ApprovalDeps) {
  const cursorRow = await db.from("hub_notice_marks").select("state").eq("subject", SERVICE_APPROVAL_CURSOR).maybeSingle<{ state: string }>();
  if (cursorRow.error) return { error: "marks" };
  if (!cursorRow.data) {
    // The first run starts now: earlier approvals reached the team in NoteTree Business already.
    await db.from("hub_notice_marks").upsert({ subject: SERVICE_APPROVAL_CURSOR, state: new Date().toISOString(), updated_at: new Date().toISOString() });
    return { created: 0 };
  }
  const cursor = Date.parse(cursorRow.data.state);
  if (Number.isNaN(cursor)) return { error: "cursor" };
  const read = await db.from("audit_events").select("id, organization_id, actor_id, occurred_at, safe_metadata")
    .eq("action", "client.preview_approved").eq("result", "success")
    .gte("occurred_at", new Date(cursor - SERVICE_OVERLAP_MINUTES * 60_000).toISOString())
    .order("occurred_at").limit(200).returns<ApprovalRow[]>();
  if (read.error) return { error: "approvals" };
  const rows = read.data ?? [];
  if (!rows.length) return { created: 0 };
  const marks = await db.from("hub_notice_marks").select("subject").in("subject", rows.map((row) => serviceApprovalMark(row.id))).returns<{ subject: string }[]>();
  if (marks.error) return { error: "marks" };
  const done = new Set((marks.data ?? []).map((row) => row.subject));
  const fresh = rows.filter((row) => !done.has(serviceApprovalMark(row.id)));
  const newest = new Date(rows.reduce((latest, row) => Math.max(latest, Date.parse(row.occurred_at) || 0), cursor)).toISOString();
  const at = new Date().toISOString();

  let created = 0;
  if (fresh.length) {
    const requestIds = [...new Set(fresh.flatMap((row) => requestOf(row) ?? []))];
    const [requests, admins] = await Promise.all([
      requestIds.length
        ? db.from("service_requests").select("id, request_number, title, organization_id").in("id", requestIds).is("trashed_at", null).returns<RequestRow[]>()
        : { data: [] as RequestRow[], error: null },
      deps.admins(),
    ]);
    if (requests.error) return { error: "requests" };
    const byId = new Map((requests.data ?? []).map((row) => [row.id, row]));
    const organizationIds = [...new Set((requests.data ?? []).map((row) => row.organization_id))];
    const actorIds = [...new Set(fresh.flatMap((row) => row.actor_id ? [row.actor_id] : []))];
    const [organizations, customers, people] = await Promise.all([
      organizationIds.length
        ? db.from("organizations").select("id, name").in("id", organizationIds).returns<{ id: string; name: string }[]>()
        : null,
      organizationIds.length
        ? db.from("hub_customers").select("company, organization_id, archived_at").in("organization_id", organizationIds).returns<{ company: string; organization_id: string; archived_at: string | null }[]>()
        : null,
      actorIds.length
        ? db.from("hub_profiles").select("user_id, first_name, last_name").in("user_id", actorIds).returns<{ user_id: string; first_name: string | null; last_name: string | null }[]>()
        : null,
    ]);
    const company = new Map((customers?.data ?? []).map((row) => [row.organization_id, row]));
    const organizationName = new Map((organizations?.data ?? []).map((row) => [row.id, row.name]));
    const names = new Map((people?.data ?? []).map((row) => [row.user_id, `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim()]));

    for (const approval of fresh) {
      const requestId = requestOf(approval);
      const request = requestId ? byId.get(requestId) : undefined;
      const customer = request ? company.get(request.organization_id) : undefined;
      // Trashed requests and archived customers stay quiet.
      if (!request || request.organization_id !== approval.organization_id || customer?.archived_at) continue;
      const input = {
        requestId: request.id, reference: requestReference(request.request_number), title: request.title,
        company: customer?.company || organizationName.get(request.organization_id) || "", author: approval.actor_id ? names.get(approval.actor_id) ?? "" : "",
      };
      // The line first: a run that cannot write it (an older database without the kind) is repeated and must not send
      // the group the same approval again.
      const written = await deps.insert(admins, serviceApprovalNotice(input));
      if (written < 0) return { error: "inbox" };
      created += written;
      await sendTelegram(telegramServiceApproval({ ...input, url: `${origin}${serviceHref(request.id)}` }));
    }
  }
  // Marks and cursor only after the lines are in: a failed run is simply repeated next time. Marks older than a day are
  // no longer needed (the overlap is ten minutes).
  const saved = await db.from("hub_notice_marks").upsert([
    ...fresh.map((row) => ({ subject: serviceApprovalMark(row.id), state: "notified", updated_at: at })),
    { subject: SERVICE_APPROVAL_CURSOR, state: newest, updated_at: at },
  ]);
  if (saved.error) return { error: "marks" };
  await db.from("hub_notice_marks").delete().like("subject", "service-approval:%").lt("updated_at", new Date(Date.now() - 86_400_000).toISOString()).then(() => undefined, () => undefined);
  return { created };
}
