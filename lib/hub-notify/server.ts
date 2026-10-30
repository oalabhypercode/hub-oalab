import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { mailSettings, sendMail } from "@/lib/hub-mail/send";
import { noticeDigestMail } from "@/lib/hub-mail/templates";
import {
  CURSOR, MAIL_ITEMS, STUDIO_EVENTS, detectStudioNotices, dueDigests, mailsWanted, nextCursor, readFrom,
  type ActivityRow, type Notice, type NoticeDetails, type NoticeProject, type NoticeTask, type PendingRow,
} from "./rules";

// Notices reach customers in the bell and as one bundled mail. Rows are written only with the service role; the
// person reads and marks their own rows with their session (RLS in the migration hub_notifications). Nothing here
// throws: a notice that cannot be written never breaks the action that caused it.

export type InboxItem = { id: number; kind: string; title: string; body: string; href: string; createdAt: string; read: boolean };
export type InboxState = { items: InboxItem[]; unread: number };

/** Active customer logins of the given hub customers; admins need no notices (they see everything). */
async function customerLogins(db: SupabaseClient, customerIds: string[]) {
  if (!customerIds.length) return [];
  const members = await db.from("hub_customer_members").select("user_id").in("customer_id", customerIds).returns<{ user_id: string }[]>();
  const ids = [...new Set((members.data ?? []).map((row) => row.user_id))];
  if (!ids.length) return [];
  const active = await db.from("hub_profiles").select("user_id").in("user_id", ids).eq("status", "active").returns<{ user_id: string }[]>();
  return (active.data ?? []).map((row) => row.user_id);
}

async function insertNotices(db: SupabaseClient, userIds: string[], notice: Notice) {
  if (!userIds.length) return 0;
  const { error } = await db.from("hub_inbox").insert(userIds.map((userId) => ({ user_id: userId, ...notice })));
  return error ? -1 : userIds.length;
}

/** A notice for every active login of these hub customers (files, appointments). */
export async function notifyCustomers(customerIds: string[], notice: Notice) {
  const db = createAdminClient();
  if (!db) return;
  try {
    await insertNotices(db, await customerLogins(db, customerIds), notice);
  } catch {
    // The action succeeded; the bell simply misses this one.
  }
}

async function customersOfOrganizations(db: SupabaseClient, organizationIds: string[]) {
  if (!organizationIds.length) return new Map<string, string[]>();
  const { data } = await db.from("hub_customers").select("id, organization_id").in("organization_id", organizationIds).returns<{ id: string; organization_id: string }[]>();
  const map = new Map<string, string[]>();
  for (const row of data ?? []) map.set(row.organization_id, [...(map.get(row.organization_id) ?? []), row.id]);
  return map;
}

/** Reads new Studio activity, writes the notices and stores marks and cursor. */
async function collectStudioNotices(db: SupabaseClient) {
  const cursorRow = await db.from("hub_notice_marks").select("state").eq("subject", CURSOR).maybeSingle<{ state: string }>();
  if (cursorRow.error) return { error: "marks" };
  if (!cursorRow.data) {
    await db.from("hub_notice_marks").upsert({ subject: CURSOR, state: new Date().toISOString(), updated_at: new Date().toISOString() });
    return { created: 0 };
  }
  const from = readFrom(cursorRow.data.state);
  if (!from) return { error: "cursor" };

  const activityRead = await db.from("studio_activity").select("created_at, event_type, project_id, task_id")
    .gte("created_at", from).in("event_type", STUDIO_EVENTS).order("created_at").limit(1000).returns<ActivityRow[]>();
  if (activityRead.error) return { error: "activity" };
  const activity = activityRead.data ?? [];
  if (!activity.length) return { created: 0 };

  const taskIds = [...new Set(activity.flatMap((row) => row.task_id ? [row.task_id] : []))];
  const tasks = taskIds.length
    ? await db.from("studio_tasks").select("id, project_id, task_number, title, status, labels, client_visible, archived").in("id", taskIds).returns<NoticeTask[]>()
    : { data: [] as NoticeTask[], error: null };
  if (tasks.error) return { error: "tasks" };
  const projectIds = [...new Set([...activity.map((row) => row.project_id), ...(tasks.data ?? []).map((task) => task.project_id)])];
  const subjects = [...taskIds.map((id) => `task:${id}`), ...projectIds.map((id) => `project:${id}`)];
  const [details, projects, marks] = await Promise.all([
    db.from("studio_project_details").select("project_id, status, due_date, client_visible").in("project_id", projectIds).returns<NoticeDetails[]>(),
    db.from("customer_projects").select("id, organization_id, display_name, status").in("id", projectIds).returns<NoticeProject[]>(),
    db.from("hub_notice_marks").select("subject, state").in("subject", subjects).returns<{ subject: string; state: string }[]>(),
  ]);
  if (details.error || projects.error || marks.error) return { error: "studio" };

  const found = detectStudioNotices({
    activity, tasks: tasks.data ?? [], details: details.data ?? [], projects: projects.data ?? [],
    marks: new Map((marks.data ?? []).map((row) => [row.subject, row.state])),
  });
  const customers = await customersOfOrganizations(db, [...new Set(found.notices.map((item) => item.organizationId))]);
  let created = 0;
  for (const item of found.notices) {
    const written = await insertNotices(db, await customerLogins(db, customers.get(item.organizationId) ?? []), item.notice);
    if (written < 0) return { error: "inbox" };
    created += written;
  }
  // Marks and cursor only after the notices are in: a failed run is simply repeated next time.
  const at = new Date().toISOString();
  const rows = [...found.marks.entries()].map(([subject, state]) => ({ subject, state, updated_at: at }));
  rows.push({ subject: CURSOR, state: nextCursor(cursorRow.data.state, activity), updated_at: at });
  const saved = await db.from("hub_notice_marks").upsert(rows);
  return saved.error ? { error: "marks" } : { created };
}

/** Sends the bundled mails that are due; claims rows first, so two runs never send the same notice. */
async function sendDueMails(db: SupabaseClient, origin: string, now: Date) {
  const pending = await db.from("hub_inbox").select("id, user_id, created_at, read_at, title, body, href")
    .eq("mail_state", "pending").order("created_at").limit(2000).returns<PendingRow[]>();
  if (pending.error) return { error: "inbox" };
  const counts = { sent: 0, skipped: 0, failed: 0 };
  const legal = mailSettings().legal;

  for (const digest of dueDigests(pending.data ?? [], now)) {
    const claimed = await db.from("hub_inbox").update({ mail_state: "sending" })
      .in("id", digest.rows.map((row) => row.id)).eq("mail_state", "pending").select("id").returns<{ id: number }[]>();
    const ids = new Set((claimed.data ?? []).map((row) => row.id));
    if (!ids.size) continue;
    const items = digest.rows.filter((row) => ids.has(row.id));

    const [login, profile] = await Promise.all([
      db.auth.admin.getUserById(digest.userId),
      db.from("hub_profiles").select("first_name, status").eq("user_id", digest.userId).maybeSingle<{ first_name: string; status: string }>(),
    ]);
    const email = login.data.user?.email;
    const wanted = items.length > 0 && email && profile.data?.status === "active" && mailsWanted(login.data.user?.user_metadata);
    let state: "sent" | "skipped" | "failed" = "skipped";
    if (wanted) {
      const content = noticeDigestMail({
        firstName: profile.data?.first_name ?? "",
        items: items.slice(0, MAIL_ITEMS).map((row) => ({ title: row.title, body: row.body })),
        more: Math.max(0, items.length - MAIL_ITEMS),
        hubUrl: `${origin}/dashboard`,
      }, legal);
      state = (await sendMail({ to: [email], ...content, kind: "notice.digest" })).status;
    }
    await db.from("hub_inbox").update({ mail_state: state, mailed_at: state === "sent" ? now.toISOString() : null }).in("id", [...ids]);
    counts[state] += 1;
  }
  return counts;
}

/** One run of the schedule: Studio changes into notices, then the mails that are due. */
export async function runNotificationSweep(origin: string, now = new Date()) {
  const db = createAdminClient();
  if (!db) return { ok: false as const, error: "Server-Schlüssel fehlt." };
  const studio = await collectStudioNotices(db);
  const mails = await sendDueMails(db, origin, now);
  return { ok: true as const, studio, mails };
}

/** The bell of the signed-in login: the latest notices and how many are unread. Null when the table is missing. */
export async function loadInbox(): Promise<InboxState | null> {
  const supabase = await createClient();
  const [list, unread] = await Promise.all([
    supabase.from("hub_inbox").select("id, kind, title, body, href, created_at, read_at").order("created_at", { ascending: false }).limit(30)
      .returns<{ id: number; kind: string; title: string; body: string; href: string; created_at: string; read_at: string | null }[]>(),
    supabase.from("hub_inbox").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);
  if (list.error || unread.error) return null;
  return {
    items: (list.data ?? []).map((row) => ({ id: row.id, kind: row.kind, title: row.title, body: row.body, href: row.href, createdAt: row.created_at, read: Boolean(row.read_at) })),
    unread: unread.count ?? 0,
  };
}
