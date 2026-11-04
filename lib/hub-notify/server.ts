import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { mailSettings, sendMail } from "@/lib/hub-mail/send";
import { noticeDigestMail } from "@/lib/hub-mail/templates";
import { calendarLinks, calendarLinkSecret } from "@/lib/hub-calendar/links";
import { isDemoUser, listAllUsers, roleOf } from "@/lib/hub-users/server";
import { sendTelegram } from "@/lib/hub-telegram/server";
import { telegramChatMessage } from "@/lib/hub-telegram/rules";
import {
  CURSOR, MAIL_ITEMS, STUDIO_EVENTS, calendarRows, chatHref, chatNotice, detectStudioNotices, dueDigests, mailsWanted, nextCursor, noticeAppointment, readFrom, skipsMail,
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

/**
 * A file at these customers: their logins get the notice unless it is only for the freelancers, and the freelancers
 * who look after a customer unless it is only for the customer. `only` narrows it to the side that newly sees the
 * file (a changed "Sichtbar für"). Without the freelancer migration everything goes to the customers, as before.
 */
export async function notifyFileShared(fileId: string, customerIds: string[], notice: Notice, only: { customer: boolean; freelancer: boolean } = { customer: true, freelancer: true }) {
  const db = createAdminClient();
  if (!db || !customerIds.length) return;
  try {
    const [assignments, links] = await Promise.all([
      db.from("hub_file_assignments").select("customer_id, audience").eq("file_id", fileId).in("customer_id", customerIds).returns<{ customer_id: string; audience: string }[]>(),
      db.from("hub_freelancer_customers").select("freelancer_id, customer_id").in("customer_id", customerIds).returns<{ freelancer_id: string; customer_id: string }[]>(),
    ]);
    if (assignments.error || links.error) {
      if (only.customer) await insertNotices(db, await customerLogins(db, customerIds), notice);
      return;
    }
    const audienceOf = new Map((assignments.data ?? []).map((row) => [row.customer_id, row.audience]));
    const forCustomers = only.customer ? customerIds.filter((id) => audienceOf.get(id) !== "freelancer") : [];
    const freelancers = only.freelancer ? [...new Set((links.data ?? []).filter((link) => audienceOf.get(link.customer_id) !== "customer").map((link) => link.freelancer_id))] : [];
    const recipients = new Set([...(await customerLogins(db, forCustomers)), ...(await customerLogins(db, freelancers))]);
    await insertNotices(db, [...recipients], notice);
  } catch {
    // The action succeeded; the bell simply misses this one.
  }
}

/** Admins who can sign in and act: the admin role and an active profile; the demo logins stay out. */
async function activeAdminLogins(db: SupabaseClient) {
  const admins = (await listAllUsers(db)).filter((user) => roleOf(user) === "oalab_admin" && !isDemoUser(user)).map((user) => user.id);
  if (!admins.length) return [];
  const active = await db.from("hub_profiles").select("user_id").in("user_id", admins).eq("status", "active").returns<{ user_id: string }[]>();
  return (active.data ?? []).map((row) => row.user_id);
}

/**
 * A new message in a private chat: a customer's goes to every admin (chat.message), oalab's to the company's logins
 * (chat.reply), never to the writer. While a recipient has an unread notice of this chat whose mail is still to come,
 * that notice takes the new line instead of a second one, so a conversation fills the bell with one line. Every
 * message a customer writes also reaches the admins' Telegram group, with company, name and text (decision of
 * 4.11.2026), so the team reads it on the phone and answers in the hub.
 */
export async function notifyChat(input: { side: "customer" | "oalab"; customerId: string; company: string; authorId: string; body: string; origin: string }) {
  const db = createAdminClient();
  if (!db) return;
  try {
    const kind = input.side === "customer" ? "chat.message" : "chat.reply";
    const [author, recipients] = await Promise.all([
      db.from("hub_profiles").select("first_name, last_name").eq("user_id", input.authorId).maybeSingle<{ first_name: string; last_name: string }>(),
      input.side === "customer" ? activeAdminLogins(db) : customerLogins(db, [input.customerId]),
    ]);
    const name = author.data ? `${author.data.first_name} ${author.data.last_name}`.trim() : "";
    // The group hears of every customer message, also when no admin login would get a notice.
    if (kind === "chat.message") await sendTelegram(telegramChatMessage({ company: input.company, author: name, body: input.body, url: `${input.origin}${chatHref(input.customerId)}` }));
    const to = recipients.filter((id) => id !== input.authorId);
    if (!to.length) return;
    const notice = { kind, customerId: input.customerId, company: input.company, author: name, body: input.body } as const;
    const open = await db.from("hub_inbox").select("id, user_id").eq("kind", kind).eq("href", chatHref(input.customerId))
      .in("user_id", to).is("read_at", null).eq("mail_state", "pending").returns<{ id: number; user_id: string }[]>();
    const waiting = new Map((open.data ?? []).map((row) => [row.user_id, row.id]));
    if (waiting.size) {
      const more = chatNotice({ ...notice, more: true });
      await db.from("hub_inbox").update({ title: more.title, body: more.body }).in("id", [...waiting.values()]);
    }
    await insertNotices(db, to.filter((id) => !waiting.has(id)), chatNotice(notice));
  } catch {
    // The message is saved; only its notice is lost.
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

/** State of the appointments the notices link to, for the calendar buttons; empty when it cannot be read. */
async function linkedAppointments(db: SupabaseClient, rows: Pick<PendingRow, "href">[]) {
  const ids = [...new Set(rows.flatMap((row) => noticeAppointment(row.href) ?? []))];
  if (!ids.length) return new Map<string, { status: string; ends_at: string }>();
  const { data } = await db.from("hub_appointments").select("id, status, ends_at").in("id", ids)
    .returns<{ id: string; status: string; ends_at: string }[]>();
  return new Map((data ?? []).map((row) => [row.id, row]));
}

/** Sends the bundled mails that are due; claims rows first, so two runs never send the same notice. */
async function sendDueMails(db: SupabaseClient, origin: string, now: Date) {
  const pending = await db.from("hub_inbox").select("id, user_id, created_at, read_at, kind, title, body, href")
    .eq("mail_state", "pending").order("created_at").limit(2000).returns<PendingRow[]>();
  if (pending.error) return { error: "inbox" };
  const counts = { sent: 0, skipped: 0, failed: 0 };
  const legal = mailSettings().legal;
  // Chat messages already read in the hub need no mail any more.
  const seen = (pending.data ?? []).filter(skipsMail).map((row) => row.id);
  if (seen.length) await db.from("hub_inbox").update({ mail_state: "skipped" }).in("id", seen).eq("mail_state", "pending");
  const digests = dueDigests((pending.data ?? []).filter((row) => !skipsMail(row)), now);
  // Without the token there are no signed links, and the mails go out without calendar buttons.
  const secret = calendarLinkSecret();
  const appointments = secret ? await linkedAppointments(db, digests.flatMap((digest) => digest.rows)) : new Map();

  for (const digest of digests) {
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
      const calendar = calendarRows(items, appointments, now);
      const content = noticeDigestMail({
        firstName: profile.data?.first_name ?? "",
        items: items.slice(0, MAIL_ITEMS).map((row) => {
          const appointmentId = calendar.get(row.id);
          return {
            kind: row.kind,
            title: row.title,
            body: row.body,
            url: `${origin}${row.href}`,
            calendar: appointmentId && secret ? { ...calendarLinks(origin, appointmentId, secret), moved: row.kind === "appointment.changed" } : undefined,
          };
        }),
        more: Math.max(0, items.length - MAIL_ITEMS),
        hubUrl: `${origin}/dashboard`,
        settingsUrl: `${origin}/dashboard/settings`,
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
