import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { mailSettings, sendMail } from "@/lib/hub-mail/send";
import { noticeDigestMail } from "@/lib/hub-mail/templates";
import { calendarLinks, calendarLinkSecret } from "@/lib/hub-calendar/links";
import { CALENDAR_PATH } from "@/lib/hub-calendar/paths";
import { feedReady, loginsWithFeed } from "@/lib/hub-calendar/feed-store";
import { listAllUsers, roleOf } from "@/lib/hub-users/server";
import { sendTelegram } from "@/lib/hub-telegram/server";
import { telegramChatMessage } from "@/lib/hub-telegram/rules";
import {
  CURSOR, MAIL_ITEMS, STUDIO_EVENTS, TASK_NOTICE_KINDS, calendarRows, chatHref, chatNotice, detectStudioNotices, dueDigests, fileNotice, fileNoticeLine, hasTaskChange, mailsWanted, mergeFileNotice,
  mergeShareNotice, mergeTaskNotice, nextCursor,
  noticeAppointment, projectHref, readFrom, shareNotice, skipsMail, taskAudience, taskBoardHref, taskChangeParts, taskNotice, taskNoticePrefix, taskState,
  type ActivityRow, type Notice, type NoticeDetails, type NoticeProject, type NoticeTask, type PendingRow, type TaskChange, type TaskNoticeDraft, type TaskSight,
} from "./rules";

// Notices reach customers in the bell and as one bundled mail. Rows are written only with the service role; the
// person reads and marks their own rows with their session (RLS in the migration hub_notifications). Nothing here
// throws: a notice that cannot be written never breaks the action that caused it. It says so in the server log,
// with the kind of notice and the database's code only (no names, no addresses).

function logFailure(what: string, error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message = error instanceof Error ? error.message.slice(0, 120) : "";
  console.error(`[hub-notify] ${what} failed`, code || message || "unknown");
}

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

async function insertNotices(db: SupabaseClient, userIds: string[], notice: Notice, mail: "pending" | "skipped" = "pending") {
  if (!userIds.length) return 0;
  // Bell-only notices (admins hear of freelancers' task changes) never wait for a mail.
  const { error } = await db.from("hub_inbox").insert(userIds.map((userId) => ({ user_id: userId, ...notice, ...(mail === "skipped" ? { mail_state: "skipped" } : {}) })));
  if (error) logFailure(`notice ${notice.kind}`, error);
  return error ? -1 : userIds.length;
}

/** A notice for every active login of these hub customers (files, appointments). */
export async function notifyCustomers(customerIds: string[], notice: Notice) {
  const db = createAdminClient();
  if (!db) return;
  try {
    await insertNotices(db, await customerLogins(db, customerIds), notice);
  } catch (error) {
    // The action succeeded; the bell simply misses this one.
    logFailure(`notice ${notice.kind}`, error);
  }
}

/**
 * A note page newly visible (or changed, „Änderung mitteilen“): the customer's logins when the customer gained sight,
 * the logins of the freelancers who look after the customer when they did. Bundled into the mail like files.
 */
export async function notifyNote(customerId: string, notice: Notice, to: { customer: boolean; freelancer: boolean }) {
  const db = createAdminClient();
  if (!db || (!to.customer && !to.freelancer)) return;
  try {
    const links = to.freelancer ? await db.from("hub_freelancer_customers").select("freelancer_id").eq("customer_id", customerId).returns<{ freelancer_id: string }[]>() : null;
    const freelancers = [...new Set((links?.data ?? []).map((row) => row.freelancer_id))];
    const recipients = new Set([...(to.customer ? await customerLogins(db, [customerId]) : []), ...(await customerLogins(db, freelancers))]);
    await insertNotices(db, [...recipients], notice);
  } catch (error) {
    // The release itself succeeded; the bell simply misses this one.
    logFailure(`notice ${notice.kind}`, error);
  }
}

/**
 * Writes file notices for these logins, each file given as its single-file notice, newest first: into the file line
 * each one has not read yet and whose mail is not on its way, else as a new line, several files in one (19.11.2026).
 * A merged line moves to the top of the bell and waits its quarter of an hour for the mail again, so an upload or a
 * drop of many files becomes one line and one item in the mail.
 */
async function deliverFileNotice(db: SupabaseClient, userIds: string[], notices: Notice[]) {
  if (!userIds.length || !notices.length) return;
  const open = await db.from("hub_inbox").select("id, user_id, title").in("user_id", userIds).eq("kind", "file.shared").is("read_at", null).eq("mail_state", "pending")
    .order("created_at", { ascending: false }).returns<{ id: number; user_id: string; title: string }[]>();
  if (open.error) logFailure("file notice: read", open.error);
  const latest = new Map<string, { id: number; title: string }>();
  for (const row of open.data ?? []) if (!latest.has(row.user_id)) latest.set(row.user_id, row);
  const at = new Date().toISOString();
  for (const row of latest.values()) {
    const merged = mergeFileNotice(row.title, notices);
    const { error } = await db.from("hub_inbox").update({ title: merged.title, body: merged.body, href: merged.href, created_at: at }).eq("id", row.id);
    if (error) logFailure("file notice: merge", error);
  }
  await insertNotices(db, userIds.filter((id) => !latest.has(id)), fileNoticeLine(notices));
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
      // Without the freelancer columns only the customers hear of it; say so, a freelancer misses this one.
      logFailure("file notice: freelancer read", assignments.error ?? links.error);
      if (only.customer) await deliverFileNotice(db, await customerLogins(db, customerIds), [notice]);
      return;
    }
    const audienceOf = new Map((assignments.data ?? []).map((row) => [row.customer_id, row.audience]));
    const forCustomers = only.customer ? customerIds.filter((id) => audienceOf.get(id) !== "freelancer") : [];
    const freelancers = only.freelancer ? [...new Set((links.data ?? []).filter((link) => audienceOf.get(link.customer_id) !== "customer").map((link) => link.freelancer_id))] : [];
    const recipients = new Set([...(await customerLogins(db, forCustomers)), ...(await customerLogins(db, freelancers))]);
    await deliverFileNotice(db, [...recipients], [notice]);
  } catch (error) {
    // The action succeeded; the bell simply misses this one.
    logFailure(`notice ${notice.kind}`, error);
  }
}

/**
 * Several files newly at one customer (Zuordnen and drag & drop, 19.11.2026): the customer's logins hear of those not
 * only for the freelancers, the freelancers who look after the customer of those not only for the customer, and each
 * login gets one line for all of them.
 */
export async function notifyFilesShared(files: { id: string; title: string }[], customerId: string) {
  const db = createAdminClient();
  if (!db || !files.length) return;
  const noticesOf = (list: { id: string; title: string }[]) => list.map((file) => fileNotice(file.title, file.id));
  try {
    const [assignments, links] = await Promise.all([
      db.from("hub_file_assignments").select("file_id, audience").eq("customer_id", customerId).in("file_id", files.map((file) => file.id)).returns<{ file_id: string; audience: string }[]>(),
      db.from("hub_freelancer_customers").select("freelancer_id").eq("customer_id", customerId).returns<{ freelancer_id: string }[]>(),
    ]);
    if (assignments.error || links.error) {
      // Without the freelancer columns only the customer hears of them; say so, a freelancer misses these.
      logFailure("file notice: freelancer read", assignments.error ?? links.error);
      await deliverFileNotice(db, await customerLogins(db, [customerId]), noticesOf(files));
      return;
    }
    const audienceOf = new Map((assignments.data ?? []).map((row) => [row.file_id, row.audience]));
    const customerSide = await customerLogins(db, [customerId]);
    const freelancerSide = (await customerLogins(db, [...new Set((links.data ?? []).map((link) => link.freelancer_id))])).filter((id) => !customerSide.includes(id));
    await deliverFileNotice(db, customerSide, noticesOf(files.filter((file) => audienceOf.get(file.id) !== "freelancer")));
    await deliverFileNotice(db, freelancerSide, noticesOf(files.filter((file) => audienceOf.get(file.id) !== "customer")));
  } catch (error) {
    // The action succeeded; the bell simply misses these.
    logFailure("notice file.shared", error);
  }
}

/**
 * An admin released an area of a customer for a freelancer (18.11.2026): the freelancer's active logins hear of it in
 * the bell, never by mail. A line still unread for this customer takes the new area; otherwise a new line.
 */
export async function notifyFreelancerShare(input: { freelancerId: string; customerId: string; company: string; area: string }) {
  const db = createAdminClient();
  if (!db) return;
  try {
    const userIds = await customerLogins(db, [input.freelancerId]);
    if (!userIds.length) return;
    const fresh = shareNotice(input.company, [input.area], input.customerId);
    const open = await db.from("hub_inbox").select("id, user_id, body").in("user_id", userIds).eq("kind", "share.granted").eq("href", fresh.href)
      .is("read_at", null).order("created_at", { ascending: false }).returns<{ id: number; user_id: string; body: string }[]>();
    if (open.error) logFailure("share notice: read", open.error);
    const latest = new Map<string, { id: number; body: string }>();
    for (const row of open.data ?? []) if (!latest.has(row.user_id)) latest.set(row.user_id, row);
    const at = new Date().toISOString();
    for (const row of latest.values()) {
      const merged = mergeShareNotice(row, input.company, input.area, input.customerId);
      const { error } = await db.from("hub_inbox").update({ title: merged.title, body: merged.body, created_at: at }).eq("id", row.id);
      if (error) logFailure("share notice: merge", error);
    }
    await insertNotices(db, userIds.filter((id) => !latest.has(id)), fresh, "skipped");
  } catch (error) {
    // The release is saved; the bell simply misses this one.
    logFailure("notice share.granted", error);
  }
}

/** The card's fields that decide who sees it (the rest of TaskSnapshot does not matter here). */
type SightRow = { status: string; labels: string[] | null; client_visible: boolean; team_only?: boolean | null; archived?: boolean };
const sightOf = (row: SightRow): TaskSight => ({
  teamOnly: Boolean(row.team_only),
  clientVisible: Boolean(row.client_visible),
  archived: Boolean(row.archived),
  customerState: taskState({ status: row.status, labels: row.labels, client_visible: Boolean(row.client_visible), archived: Boolean(row.archived) }),
});

/**
 * Writes a card's notice for these logins: into the line each one has not read yet (and whose mail is not on its
 * way), else as a new line. A merged line moves to the top of the bell and waits its quarter of an hour for the mail
 * again, so a burst of changes still becomes one mail.
 */
async function deliverTaskNotice(db: SupabaseClient, userIds: string[], draft: TaskNoticeDraft, mail: "pending" | "skipped") {
  if (!userIds.length) return;
  const open = await db.from("hub_inbox").select("id, user_id, kind, body").in("user_id", userIds).eq("href", draft.href).in("kind", [...TASK_NOTICE_KINDS])
    .is("read_at", null).in("mail_state", ["pending", "skipped"]).order("created_at", { ascending: false }).returns<{ id: number; user_id: string; kind: string; body: string }[]>();
  if (open.error) logFailure("task notice: read", open.error);
  const latest = new Map<string, { id: number; kind: string; body: string }>();
  for (const row of open.data ?? []) if (!latest.has(row.user_id)) latest.set(row.user_id, row);
  const at = new Date().toISOString();
  for (const row of latest.values()) {
    const merged = mergeTaskNotice(row, draft);
    const { error } = await db.from("hub_inbox").update({ kind: merged.kind, title: merged.title, body: merged.body, created_at: at }).eq("id", row.id);
    if (error) logFailure("task notice: merge", error);
  }
  await insertNotices(db, userIds.filter((id) => !latest.has(id)), taskNotice(draft), mail);
}

/** The company of an organization's customer, for the team's task lines; empty when there is none or it fails. */
async function customerCompany(db: SupabaseClient, organizationId: string) {
  const row = await db.from("hub_customers").select("company").eq("organization_id", organizationId).eq("kind", "customer").limit(1).maybeSingle<{ company: string | null }>();
  if (row.error) logFailure("task notice: company", row.error);
  return row.data?.company?.trim() ?? "";
}

/**
 * Someone changed a card on the task board (the board, the assistant or the Claude connector; decision of
 * 17.11.2026): the project's freelancers hear of it unless the card is „Nur Team“, the customer when it is released to
 * them and the change is one they see, the admins (bell only) when a freelancer made it. Never the person who made
 * it. `before` is the card before the change when it may have changed who sees it or whom it waits for; without it
 * the card counts as unchanged in that respect (null for a new card).
 */
export async function notifyTaskChange(input: { taskId: string; actorId: string; actorFreelancer: boolean; change: TaskChange; before?: SightRow | null }) {
  if (!hasTaskChange(input.change)) return;
  const db = createAdminClient();
  if (!db) return;
  try {
    const task = await db.from("studio_tasks").select("project_id, task_number, title, status, labels, client_visible, team_only, archived").eq("id", input.taskId)
      .maybeSingle<{ project_id: string; task_number: number | string; title: string } & SightRow>();
    if (task.error || !task.data) {
      if (task.error) logFailure("task notice: card", task.error);
      return;
    }
    const card = task.data;
    const [project, details, actor] = await Promise.all([
      db.from("customer_projects").select("id, organization_id, display_name, status").eq("id", card.project_id).maybeSingle<NoticeProject>(),
      db.from("studio_project_details").select("client_visible").eq("project_id", card.project_id).maybeSingle<{ client_visible: boolean }>(),
      db.from("hub_profiles").select("first_name").eq("user_id", input.actorId).maybeSingle<{ first_name: string | null }>(),
    ]);
    if (!project.data || project.data.status === "archived") return;
    const after = sightOf(card);
    const before = input.before === undefined ? (input.change.created ? null : after) : input.before && sightOf(input.before);
    const audience = taskAudience({ before, after, projectReleased: Boolean(details.data?.client_visible), change: input.change });
    const number = Number(card.task_number);
    // The team reads which customer a card belongs to (bell V3, 22.11.2026); customers know their own name.
    const company = audience.freelancers || input.actorFreelancer ? await customerCompany(db, project.data.organization_id) : "";
    const draft = (kind: TaskNoticeDraft["kind"], viewer: "team" | "customer", href: string): TaskNoticeDraft => ({
      kind, taskTitle: card.title, prefix: taskNoticePrefix(project.data!.display_name, number, viewer === "team" ? company : ""), href,
      parts: taskChangeParts(input.change, viewer, viewer === "team" ? actor.data?.first_name ?? "" : ""),
    });
    const others = (ids: string[]) => ids.filter((id) => id !== input.actorId);
    const board = taskBoardHref(card.project_id, number);

    if (audience.freelancers) {
      const onProject = await db.from("studio_project_freelancers").select("freelancer_id").eq("project_id", card.project_id).returns<{ freelancer_id: string }[]>();
      if (onProject.error) logFailure("task notice: freelancers", onProject.error);
      const logins = others(await customerLogins(db, (onProject.data ?? []).map((row) => row.freelancer_id)));
      await deliverTaskNotice(db, logins, draft(audience.freelancers, "team", board), "pending");
    }
    if (input.actorFreelancer) {
      // The admins see every card; for them a card is only new when it was created.
      await deliverTaskNotice(db, others(await activeAdminLogins(db)), draft(input.change.created ? "task.created" : "task.changed", "team", board), "skipped");
    }
    if (audience.customers) {
      const customers = await db.from("hub_customers").select("id").eq("organization_id", project.data.organization_id).eq("kind", "customer").returns<{ id: string }[]>();
      if (customers.error) logFailure("task notice: customers", customers.error);
      const logins = others(await customerLogins(db, (customers.data ?? []).map((row) => row.id)));
      await deliverTaskNotice(db, logins, draft(audience.customers, "customer", projectHref(card.project_id)), "pending");
    }
  } catch (error) {
    // The change is saved; only its notice is lost.
    logFailure("task notice", error);
  }
}

/** Admins who can sign in and act: the admin role and an active profile. */
async function activeAdminLogins(db: SupabaseClient) {
  const admins = (await listAllUsers(db)).filter((user) => roleOf(user) === "oalab_admin").map((user) => user.id);
  if (!admins.length) return [];
  const active = await db.from("hub_profiles").select("user_id").in("user_id", admins).eq("status", "active").returns<{ user_id: string }[]>();
  return (active.data ?? []).map((row) => row.user_id);
}

/**
 * A new message in a private chat: a customer's goes to every admin (chat.message), oalab's to the company's logins
 * (chat.reply), never to the writer. While a recipient has an unread notice of this chat whose mail is still to come,
 * that notice takes the new line instead of a second one, so a conversation fills the bell with one line. Every
 * message a customer writes also reaches the admins' Telegram group, with company, name and text (decision of
 * 12.11.2026), so the team reads it on the phone and answers in the hub.
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
  } catch (error) {
    // The message is saved; only its notice is lost.
    logFailure(`notice ${input.side === "customer" ? "chat.message" : "chat.reply"}`, error);
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
  // Without the token there are no signed links, and the mails go out without calendar buttons. Recipients with an
  // active calendar subscription get one sentence instead (lib/hub-calendar/feed-store.ts); a failed check keeps the buttons.
  const secret = calendarLinkSecret();
  const subscribers = feedReady() && digests.length
    ? await loginsWithFeed([...new Set(digests.map((digest) => digest.userId))]).catch(() => new Set<string>())
    : new Set<string>();
  const appointments = secret || subscribers.size ? await linkedAppointments(db, digests.flatMap((digest) => digest.rows)) : new Map();

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
          const subscribed = subscribers.has(digest.userId);
          const links = appointmentId && secret ? calendarLinks(origin, appointmentId, secret) : null;
          return {
            kind: row.kind,
            title: row.title,
            body: row.body,
            url: `${origin}${row.href}`,
            calendar: appointmentId && (links || subscribed)
              ? { ...(links ?? { ics: "", google: "", outlook: "" }), moved: row.kind === "appointment.changed", subscribed, subscribe: `${origin}${CALENDAR_PATH}?abo=1` }
              : undefined,
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
