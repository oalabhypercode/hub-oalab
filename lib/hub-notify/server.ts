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
import { telegramAppointmentRequest, telegramChatMessage, telegramServiceMessage } from "@/lib/hub-telegram/rules";
import { postChatEvent, postChatEvents, type ChatPost } from "@/lib/hub-chat-events/server";
import { contractItemLine, eventKey, type AppointmentFacts, type ChatEvent, type ContractItem } from "@/lib/hub-chat-events/rules";
import { requestReference } from "@/lib/hub-conversations/rules";
import {
  CURSOR, INBOX_LATEST, INBOX_UNREAD, MAIL_ITEMS, STUDIO_EVENTS, TASK_NOTICE_KINDS, appointmentHref, appointmentRequestNotice, calendarRows, chatHref, chatNotice, contractNotice, detectStudioNotices, dueDigests,
  fileNotice, fileNoticeLine, fileNoticeName, formatMoment, hasTaskChange, mailsWanted, mergeContractNotice, mergeFileNotice,
  mergeInboxRows, mergeShareNotice, mergeTaskNotice, nextCursor, noteEditNotice, SERVICE_CURSOR, SERVICE_OVERLAP_MINUTES, serviceHref, serviceMark, serviceNotice, teamNoteNotice,
  noticeAppointment, projectHref, readFrom, shareNotice, skipsMail, taskAudience, taskBoardHref, taskChangeParts, taskNotice, taskNoticePrefix, taskState,
  type ActivityRow, type Notice, type NoticeDetails, type NoticeProject, type NoticeTask, type PendingRow, type StudioCard, type TaskChange, type TaskNoticeDraft, type TaskSight,
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

/** A card the caller already built (the person who made the change and what changed). */
export type CardOf = { event: ChatEvent; authorId: string | null };

/**
 * The same change as a card in these customers' chats (24.11.2026, lib/hub-chat-events), on oalab's side, as each
 * chat's subscriptions say. `subject` names the thing (an appointment, files) in the card's key.
 */
const oalabCards = (customerIds: readonly string[], card: CardOf, subject: string): ChatPost[] =>
  customerIds.map((customerId) => ({ customerId, side: "oalab", authorId: card.authorId, event: card.event, key: eventKey(card.event.kind, subject, crypto.randomUUID()) }));

/** A notice for every active login of these hub customers (files, appointments), and with `card` its card in the chat. */
export async function notifyCustomers(customerIds: string[], notice: Notice, card?: CardOf) {
  const db = createAdminClient();
  if (!db) return;
  try {
    await insertNotices(db, await customerLogins(db, customerIds), notice);
  } catch (error) {
    // The action succeeded; the bell simply misses this one.
    logFailure(`notice ${notice.kind}`, error);
  }
  if (card) await postChatEvents(oalabCards(customerIds, card, noticeAppointment(notice.href) ?? notice.kind));
}

/**
 * Who is acting in this request (the session's login), for a card where the caller does not say it: the file windows
 * act as the signed-in admin. Null without a session (the Claude connector passes its admin itself).
 */
async function requestActor(): Promise<string | null> {
  try {
    const { data } = await (await createClient()).auth.getClaims();
    return data?.claims?.sub ?? null;
  } catch {
    return null;
  }
}

/** The card of files newly at a customer: one card, which further files join while nobody of the customer looked. */
const fileCards = (customerIds: readonly string[], files: { id: string; name: string }[], actorId: string | null): ChatPost[] =>
  files.length ? oalabCards(customerIds, { authorId: actorId, event: { v: 1, kind: "file.shared", files: files.slice(0, 20), total: files.length } }, files[0].id) : [];

/**
 * A note page newly visible (or changed, „Änderung mitteilen“): the customer's logins when the customer gained sight,
 * the logins of the freelancers who look after the customer when they did. Bundled into the mail like files.
 */
export async function notifyNote(customerId: string, notice: Notice, to: { customer: boolean; freelancer: boolean }, card?: CardOf) {
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
  // Only what the customer sees comes into the customer's chat.
  if (card && to.customer) await postChatEvents(oalabCards([customerId], card, notice.href));
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
export async function notifyFileShared(fileId: string, customerIds: string[], notice: Notice, only: { customer: boolean; freelancer: boolean } = { customer: true, freelancer: true }, actorId?: string | null) {
  const db = createAdminClient();
  if (!db || !customerIds.length) return;
  const file = [{ id: fileId, name: fileNoticeName(notice) }];
  const actor = actorId === undefined ? await requestActor() : actorId;
  try {
    const [assignments, links] = await Promise.all([
      db.from("hub_file_assignments").select("customer_id, audience").eq("file_id", fileId).in("customer_id", customerIds).returns<{ customer_id: string; audience: string }[]>(),
      db.from("hub_freelancer_customers").select("freelancer_id, customer_id").in("customer_id", customerIds).returns<{ freelancer_id: string; customer_id: string }[]>(),
    ]);
    if (assignments.error || links.error) {
      // Without the freelancer columns only the customers hear of it; say so, a freelancer misses this one.
      logFailure("file notice: freelancer read", assignments.error ?? links.error);
      if (only.customer) {
        await deliverFileNotice(db, await customerLogins(db, customerIds), [notice]);
        await postChatEvents(fileCards(customerIds, file, actor));
      }
      return;
    }
    const audienceOf = new Map((assignments.data ?? []).map((row) => [row.customer_id, row.audience]));
    const forCustomers = only.customer ? customerIds.filter((id) => audienceOf.get(id) !== "freelancer") : [];
    const freelancers = only.freelancer ? [...new Set((links.data ?? []).filter((link) => audienceOf.get(link.customer_id) !== "customer").map((link) => link.freelancer_id))] : [];
    const recipients = new Set([...(await customerLogins(db, forCustomers)), ...(await customerLogins(db, freelancers))]);
    await deliverFileNotice(db, [...recipients], [notice]);
    // A file only for the freelancers never comes into the customer's chat.
    await postChatEvents(fileCards(forCustomers, file, actor));
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
export async function notifyFilesShared(files: { id: string; title: string }[], customerId: string, actorId?: string | null) {
  const db = createAdminClient();
  if (!db || !files.length) return;
  const actor = actorId === undefined ? await requestActor() : actorId;
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
      await postChatEvents(fileCards([customerId], files.map((file) => ({ id: file.id, name: file.title })), actor));
      return;
    }
    const audienceOf = new Map((assignments.data ?? []).map((row) => [row.file_id, row.audience]));
    const customerSide = await customerLogins(db, [customerId]);
    const freelancerSide = (await customerLogins(db, [...new Set((links.data ?? []).map((link) => link.freelancer_id))])).filter((id) => !customerSide.includes(id));
    const forCustomer = files.filter((file) => audienceOf.get(file.id) !== "freelancer");
    await deliverFileNotice(db, customerSide, noticesOf(forCustomer));
    await deliverFileNotice(db, freelancerSide, noticesOf(files.filter((file) => audienceOf.get(file.id) !== "customer")));
    await postChatEvents(fileCards([customerId], forCustomer.map((file) => ({ id: file.id, name: file.title })), actor));
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
      const customerIds = (customers.data ?? []).map((row) => row.id);
      const logins = others(await customerLogins(db, customerIds));
      await deliverTaskNotice(db, logins, draft(audience.customers, "customer", projectHref(card.project_id)), "pending");
      // What the customer reads in the bell, as a card (area Aufgaben, off unless the chat subscribed).
      const event: ChatEvent = { v: 1, kind: audience.customers, task: { projectId: card.project_id, number, title: card.title, project: project.data.display_name, parts: taskChangeParts(input.change, "customer") } };
      await postChatEvents(oalabCards(customerIds, { event, authorId: input.actorId }, `${card.project_id}:${number}`));
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

/**
 * A customer (or a freelancer) asked for an appointment (24.11.2026, decision 9 of the chat plan): every admin gets
 * „Neue Terminanfrage von …“ in the bell, the admins' Telegram group a line with a button into the calendar, and the
 * customer's chat the request as a card on the customer's side, where admins confirm it. Freelancers' chats get no cards
 * yet (decision 11). Never throws.
 */
export async function notifyAppointmentRequest(input: { appointment: AppointmentFacts; customerId: string; authorId: string; origin: string }) {
  const db = createAdminClient();
  if (!db) return;
  const facts = input.appointment;
  try {
    const [customer, author, admins] = await Promise.all([
      db.from("hub_customers").select("company, kind").eq("id", input.customerId).maybeSingle<{ company: string; kind: string | null }>(),
      db.from("hub_profiles").select("first_name, last_name").eq("user_id", input.authorId).maybeSingle<{ first_name: string | null; last_name: string | null }>(),
      activeAdminLogins(db),
    ]);
    const freelancer = (customer.data?.kind ?? "customer") === "freelancer";
    const company = customer.data?.company ?? "";
    const name = author.data ? `${author.data.first_name ?? ""} ${author.data.last_name ?? ""}`.trim() : "";
    // The group hears of every request, also when no admin login would get a notice.
    await sendTelegram(telegramAppointmentRequest({ company, author: name, title: facts.title, when: formatMoment(facts.startsAt), url: `${input.origin}${appointmentHref(facts.id)}`, freelancer }));
    await insertNotices(db, admins.filter((id) => id !== input.authorId), appointmentRequestNotice({ id: facts.id, title: facts.title, startsAt: facts.startsAt, company, author: name, freelancer }));
  } catch (error) {
    // The request is saved; only its notice is lost.
    logFailure("notice appointment.requested", error);
  }
  await postChatEvent({ customerId: input.customerId, side: "customer", authorId: input.authorId, event: { v: 1, kind: "appointment.requested", appointment: facts }, key: eventKey("appointment.requested", facts.id, "request") });
}

/** The team answered a request (calendar, chat or Claude), or it was withdrawn: its line leaves every admin's bell. */
export async function settleAppointmentRequest(appointmentId: string) {
  const db = createAdminClient();
  if (!db) return;
  const { error } = await db.from("hub_inbox").update({ read_at: new Date().toISOString() }).eq("kind", "appointment.requested").eq("href", appointmentHref(appointmentId)).is("read_at", null);
  if (error) logFailure("settle appointment.requested", error);
}

/** A customer withdrew a request: the admins' line goes, and the chat gets a grey line where the request card stands. */
export async function notifyRequestWithdrawn(input: { appointment: AppointmentFacts; customerId: string; authorId: string }) {
  await settleAppointmentRequest(input.appointment.id);
  await postChatEvent({ customerId: input.customerId, side: "customer", authorId: input.authorId, event: { v: 1, kind: "appointment.withdrawn", appointment: input.appointment }, key: eventKey("appointment.withdrawn", input.appointment.id, "withdrawn") });
}

/**
 * Something new under „Vertrag & Domain“ that the customer sees (24.11.2026, decision 10): a visible timeline entry, a
 * domain, an e-mail address or a package. The customer's logins get one line that further changes join while it is
 * unread and its mail not on its way; the chat gets the card. Never a password or access data. Never throws.
 */
export async function notifyContractChange(input: { customerId: string; item: ContractItem; actorId: string | null }) {
  const db = createAdminClient();
  if (!db) return;
  const line = contractItemLine(input.item);
  try {
    const logins = await customerLogins(db, [input.customerId]);
    if (logins.length) {
      const open = await db.from("hub_inbox").select("id, user_id, title, body").in("user_id", logins).eq("kind", "contract.changed").is("read_at", null).eq("mail_state", "pending")
        .order("created_at", { ascending: false }).returns<{ id: number; user_id: string; title: string; body: string }[]>();
      if (open.error) logFailure("contract notice: read", open.error);
      const latest = new Map<string, { id: number; title: string; body: string }>();
      for (const row of open.data ?? []) if (!latest.has(row.user_id)) latest.set(row.user_id, row);
      const at = new Date().toISOString();
      for (const row of latest.values()) {
        const merged = mergeContractNotice(row, line);
        const { error } = await db.from("hub_inbox").update({ title: merged.title, body: merged.body, created_at: at }).eq("id", row.id);
        if (error) logFailure("contract notice: merge", error);
      }
      await insertNotices(db, logins.filter((id) => !latest.has(id)), contractNotice([line]));
    }
  } catch (error) {
    // The change is saved; only its notice is lost.
    logFailure("notice contract.changed", error);
  }
  await postChatEvents(oalabCards([input.customerId], { authorId: input.actorId, event: { v: 1, kind: "contract.changed", items: [input.item] } }, input.item.what));
}

/** Edits from outside the team reach the bell once per page and writer in this long, not with every autosave. */
const EDIT_NOTICE_PAUSE_MS = 2 * 60_000;
const lastEditNotice = new Map<string, number>();

/**
 * A customer or a freelancer wrote on a note page (23.11.2026): every admin gets „Notiz bearbeitet: …“ in the bell, one
 * line per page that moves up with the next edit while nobody of the team has opened the page; the bundled mail
 * follows a quarter of an hour later unless the line was read in the hub.
 */
export async function notifyNoteEdit(input: { pageId: string; customerId: string; title: string; authorId: string; side: "customer" | "freelancer" }) {
  const key = `${input.pageId}:${input.authorId}`;
  const now = Date.now();
  if ((lastEditNotice.get(key) ?? 0) + EDIT_NOTICE_PAUSE_MS > now) return;
  lastEditNotice.set(key, now);
  if (lastEditNotice.size > 1000) for (const [entry, at] of lastEditNotice) if (at + EDIT_NOTICE_PAUSE_MS <= now) lastEditNotice.delete(entry);
  const db = createAdminClient();
  if (!db) return;
  try {
    const [author, customer, recipients] = await Promise.all([
      db.from("hub_profiles").select("first_name, last_name").eq("user_id", input.authorId).maybeSingle<{ first_name: string | null; last_name: string | null }>(),
      db.from("hub_customers").select("company").eq("id", input.customerId).maybeSingle<{ company: string }>(),
      activeAdminLogins(db),
    ]);
    const to = recipients.filter((id) => id !== input.authorId);
    if (!to.length) return;
    const name = author.data ? `${author.data.first_name ?? ""} ${author.data.last_name ?? ""}`.trim() : "";
    const notice = noteEditNotice({ title: input.title, customerId: input.customerId, pageId: input.pageId, company: customer.data?.company ?? "", author: name, side: input.side });
    const open = await db.from("hub_inbox").select("id, user_id").eq("kind", "note.edited").eq("href", notice.href)
      .in("user_id", to).is("read_at", null).eq("mail_state", "pending").returns<{ id: number; user_id: string }[]>();
    const waiting = new Map((open.data ?? []).map((row) => [row.user_id, row.id]));
    if (waiting.size) await db.from("hub_inbox").update({ title: notice.title, body: notice.body, created_at: new Date(now).toISOString() }).in("id", [...waiting.values()]);
    await insertNotices(db, to.filter((id) => !waiting.has(id)), notice);
  } catch (error) {
    // The page is saved; only its notice is lost.
    logFailure("notice note.edited", error);
  }
}

/**
 * „Team informieren“ on one of oalab's own pages (stage 2): every other active admin gets „… hat ‚Seite‘ geteilt“ in the
 * bell, with the sender's sentence; the sender gets none. A colleague who still has an unread line about the page gets
 * the new one in its place, so a page fills the bell with one line. The mail follows a quarter of an hour later unless
 * the line was read in the hub (opening the page reads it). Returns how many got the line, -1 when it failed.
 */
export async function notifyTeamNote(input: { pageId: string; customerId: string; title: string; authorId: string; message: string }): Promise<number> {
  const db = createAdminClient();
  if (!db) return -1;
  try {
    const [author, admins] = await Promise.all([
      db.from("hub_profiles").select("first_name, last_name").eq("user_id", input.authorId).maybeSingle<{ first_name: string | null; last_name: string | null }>(),
      activeAdminLogins(db),
    ]);
    const to = admins.filter((id) => id !== input.authorId);
    if (!to.length) return 0;
    const name = author.data ? `${author.data.first_name ?? ""} ${author.data.last_name ?? ""}`.trim() : "";
    const notice = teamNoteNotice({ title: input.title, customerId: input.customerId, pageId: input.pageId, author: name, message: input.message });
    const open = await db.from("hub_inbox").select("id, user_id").eq("kind", "note.team").eq("href", notice.href)
      .in("user_id", to).is("read_at", null).eq("mail_state", "pending").returns<{ id: number; user_id: string }[]>();
    const waiting = new Map((open.data ?? []).map((row) => [row.user_id, row.id]));
    if (waiting.size) {
      const { error } = await db.from("hub_inbox").update({ title: notice.title, body: notice.body, created_at: new Date().toISOString() }).in("id", [...waiting.values()]);
      if (error) { logFailure("notice note.team: merge", error); return -1; }
    }
    const written = await insertNotices(db, to.filter((id) => !waiting.has(id)), notice);
    return written < 0 ? -1 : to.length;
  } catch (error) {
    // The page is saved; only its notice is lost.
    logFailure("notice note.team", error);
    return -1;
  }
}

/**
 * An admin opened a request in Nachrichten › Service: it counts as seen by the team, so every admin's line about it
 * leaves the bell (and the mail that would still come), as with the private chat. True when something was unread.
 */
export async function markServiceRead(requestId: string): Promise<boolean> {
  const db = createAdminClient();
  if (!db) return false;
  const { data, error } = await db.from("hub_inbox").update({ read_at: new Date().toISOString() }).eq("kind", "service.message").eq("href", serviceHref(requestId)).is("read_at", null).select("id").returns<{ id: number }[]>();
  return !error && Boolean(data?.length);
}

type ServiceMessageRow = { id: string; request_id: string; sender_user_id: string | null; body: string; created_at: string };
type ServiceRequestRow = { id: string; request_number: number; title: string; organization_id: string; created_at: string };

/**
 * Customers' messages on the service platform (23.11.2026): new requests and new messages in requests reach every
 * admin in the bell („Neue Anfrage von …“, one line per request while unread), by mail a few minutes later unless read
 * in the hub, and in the admins' Telegram group. Messages of the team (also entered for a customer) and archived
 * customers stay out. Read from a cursor with marks, like Studio's activity, so a run never reports twice.
 */
async function collectServiceNotices(db: SupabaseClient, origin: string) {
  const cursorRow = await db.from("hub_notice_marks").select("state").eq("subject", SERVICE_CURSOR).maybeSingle<{ state: string }>();
  if (cursorRow.error) return { error: "marks" };
  if (!cursorRow.data) {
    // The first run starts now: earlier messages were read on the service platform already.
    await db.from("hub_notice_marks").upsert({ subject: SERVICE_CURSOR, state: new Date().toISOString(), updated_at: new Date().toISOString() });
    return { created: 0 };
  }
  const cursor = Date.parse(cursorRow.data.state);
  if (Number.isNaN(cursor)) return { error: "cursor" };
  const from = new Date(cursor - SERVICE_OVERLAP_MINUTES * 60_000).toISOString();
  const read = await db.from("request_messages").select("id, request_id, sender_user_id, body, created_at")
    .eq("sender_type", "client").eq("visibility", "client").gte("created_at", from).order("created_at").limit(200).returns<ServiceMessageRow[]>();
  if (read.error) return { error: "messages" };
  const rows = read.data ?? [];
  if (!rows.length) return { created: 0 };
  const marks = await db.from("hub_notice_marks").select("subject").in("subject", rows.map((row) => serviceMark(row.id))).returns<{ subject: string }[]>();
  if (marks.error) return { error: "marks" };
  const done = new Set((marks.data ?? []).map((row) => row.subject));
  const fresh = rows.filter((row) => !done.has(serviceMark(row.id)));
  const newest = new Date(rows.reduce((latest, row) => Math.max(latest, Date.parse(row.created_at) || 0), cursor)).toISOString();
  const at = new Date().toISOString();
  if (!fresh.length) {
    await db.from("hub_notice_marks").upsert({ subject: SERVICE_CURSOR, state: newest, updated_at: at });
    return { created: 0 };
  }

  const requestIds = [...new Set(fresh.map((row) => row.request_id))];
  const [requests, admins] = await Promise.all([
    db.from("service_requests").select("id, request_number, title, organization_id, created_at").in("id", requestIds).is("trashed_at", null).returns<ServiceRequestRow[]>(),
    activeAdminLogins(db),
  ]);
  if (requests.error) return { error: "requests" };
  const byId = new Map((requests.data ?? []).map((row) => [row.id, row]));
  const organizationIds = [...new Set((requests.data ?? []).map((row) => row.organization_id))];
  const [customers, earlier, people] = await Promise.all([
    organizationIds.length ? db.from("hub_customers").select("id, company, organization_id, archived_at").in("organization_id", organizationIds).returns<{ id: string; company: string; organization_id: string; archived_at: string | null }[]>() : null,
    // A request's first message from the customer makes it a new request.
    db.from("request_messages").select("id, request_id, created_at").in("request_id", requestIds).eq("sender_type", "client").eq("visibility", "client").order("created_at").limit(1000).returns<{ id: string; request_id: string; created_at: string }[]>(),
    db.from("hub_profiles").select("user_id, first_name, last_name").in("user_id", [...new Set(fresh.flatMap((row) => row.sender_user_id ? [row.sender_user_id] : []))]).returns<{ user_id: string; first_name: string | null; last_name: string | null }[]>(),
  ]);
  const company = new Map((customers?.data ?? []).map((row) => [row.organization_id, row]));
  const firstOf = new Map<string, string>();
  for (const row of earlier.data ?? []) if (!firstOf.has(row.request_id)) firstOf.set(row.request_id, row.id);
  const names = new Map((people.data ?? []).map((row) => [row.user_id, `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim()]));
  const team = new Set(admins);

  let created = 0;
  for (const message of fresh) {
    const request = byId.get(message.request_id);
    const customer = request ? company.get(request.organization_id) : undefined;
    // The team's own entries for a customer, trashed requests and archived customers stay quiet.
    if (!request || (message.sender_user_id && team.has(message.sender_user_id)) || customer?.archived_at) continue;
    const input = {
      requestId: request.id, reference: requestReference(request.request_number), title: request.title, company: customer?.company ?? "",
      author: message.sender_user_id ? names.get(message.sender_user_id) ?? "" : "", body: message.body, first: firstOf.get(request.id) === message.id,
    };
    await sendTelegram(telegramServiceMessage({ ...input, url: `${origin}${serviceHref(request.id)}` }));
    if (!admins.length) continue;
    const open = await db.from("hub_inbox").select("id, user_id").eq("kind", "service.message").eq("href", serviceHref(request.id))
      .in("user_id", admins).is("read_at", null).eq("mail_state", "pending").returns<{ id: number; user_id: string }[]>();
    const waiting = new Map((open.data ?? []).map((row) => [row.user_id, row.id]));
    if (waiting.size) {
      const more = serviceNotice({ ...input, more: true });
      await db.from("hub_inbox").update({ title: more.title, body: more.body }).in("id", [...waiting.values()]);
    }
    const written = await insertNotices(db, admins.filter((id) => !waiting.has(id)), serviceNotice(input));
    if (written < 0) return { error: "inbox" };
    created += written;
  }
  // Marks and cursor only after the notices are in: a failed run is simply repeated next time. Marks older than a day
  // are no longer needed (the overlap is ten minutes).
  const saved = await db.from("hub_notice_marks").upsert([
    ...fresh.map((row) => ({ subject: serviceMark(row.id), state: "notified", updated_at: at })),
    { subject: SERVICE_CURSOR, state: newest, updated_at: at },
  ]);
  if (saved.error) return { error: "marks" };
  await db.from("hub_notice_marks").delete().like("subject", "service-message:%").lt("updated_at", new Date(Date.now() - 86_400_000).toISOString()).then(() => undefined, () => undefined);
  return { created };
}

async function customersOfOrganizations(db: SupabaseClient, organizationIds: string[]) {
  if (!organizationIds.length) return new Map<string, string[]>();
  const { data } = await db.from("hub_customers").select("id, organization_id").in("organization_id", organizationIds).returns<{ id: string; organization_id: string }[]>();
  const map = new Map<string, string[]>();
  for (const row of data ?? []) map.set(row.organization_id, [...(map.get(row.organization_id) ?? []), row.id]);
  return map;
}

/** The chat's card of a Studio notice. */
function studioCardEvent(card: StudioCard): ChatEvent {
  return card.kind === "task.customer"
    ? { v: 1, kind: "task.customer", task: { projectId: card.projectId, number: card.number, title: card.title, project: card.project, parts: [] } }
    : { v: 1, kind: "project.changed", project: { id: card.projectId, name: card.name, change: card.change } };
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
    const customerIds = customers.get(item.organizationId) ?? [];
    const written = await insertNotices(db, await customerLogins(db, customerIds), item.notice);
    if (written < 0) return { error: "inbox" };
    created += written;
    // The studio reports these by itself: the card comes from „oalab“. Its key is the change, so a repeated run of the
    // same batch (marks not saved) writes no second card.
    const event = studioCardEvent(item.card);
    await postChatEvents(customerIds.map((customerId) => ({ customerId, side: "oalab" as const, authorId: null, event, key: eventKey(event.kind, item.key, "studio") })));
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
  // A failed read of the service platform never stops the rest of the run.
  const service = await collectServiceNotices(db, origin).catch(() => ({ error: "service" }));
  const mails = await sendDueMails(db, origin, now);
  return { ok: true as const, studio, service, mails };
}

type InboxRow = { id: number; kind: string; title: string; body: string; href: string; created_at: string; read_at: string | null };
const INBOX_COLUMNS = "id, kind, title, body, href, created_at, read_at";

/**
 * The bell of the signed-in login and how many notices are unread. Null when the table is missing. The newest lines
 * (read or not) feed „Früher“ in the overview and the live check; every unread one (up to INBOX_UNREAD) comes along,
 * because the bell lists only those (lib/hub-notify/rules.ts mergeInboxRows).
 */
export async function loadInbox(): Promise<InboxState | null> {
  const supabase = await createClient();
  const [latest, open, unread] = await Promise.all([
    supabase.from("hub_inbox").select(INBOX_COLUMNS).order("created_at", { ascending: false }).limit(INBOX_LATEST).returns<InboxRow[]>(),
    supabase.from("hub_inbox").select(INBOX_COLUMNS).is("read_at", null).order("created_at", { ascending: false }).limit(INBOX_UNREAD).returns<InboxRow[]>(),
    supabase.from("hub_inbox").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);
  if (latest.error || open.error || unread.error) return null;
  return {
    items: mergeInboxRows(latest.data ?? [], open.data ?? [])
      .map((row) => ({ id: row.id, kind: row.kind, title: row.title, body: row.body, href: row.href, createdAt: row.created_at, read: Boolean(row.read_at) })),
    unread: unread.count ?? 0,
  };
}
