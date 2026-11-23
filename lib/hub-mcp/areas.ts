import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { readArchive } from "@/lib/hub-archive/server";
import { fileInSight, isArchivedCustomer, isArchivedOrganization } from "@/lib/hub-archive/rules";
import { readAssistantLog } from "@/lib/hub-assistant/log";
import { addDays, appointmentStatuses, dayOf, formatDayShort, isAppointmentStatus, timeOf, wallTimeToUtc } from "@/lib/hub-calendar/rules";
import { readCustomerPackages } from "@/lib/hub-contracts/packages";
import { timelineKinds } from "@/lib/hub-contracts/rules";
import { CUSTOMER_TIMELINE_COLUMNS } from "@/lib/hub-contracts/server";
import { loadThread, readConversations } from "@/lib/hub-conversations/server";
import { domainChecks, domainOwners, domainStatuses, mailboxKinds } from "@/lib/hub-domains/rules";
import { loadDomainMailForAdmin } from "@/lib/hub-domains/server";
import { fileCategories } from "@/lib/hub-files/catalog";
import { shareAreas, type ShareArea } from "@/lib/hub-freelancer-customers/rules";
import { loadFreelancerSharesForAdmin } from "@/lib/hub-freelancer-customers/server";
import { chatUnread, isChatSide } from "@/lib/hub-private-chat/rules";
import { todayIso } from "@/lib/hub-routes";
import { quotaStatus, usageLine } from "@/lib/hub-service-quota/rules";
import { loadServiceQuotaForAdmin } from "@/lib/hub-service-quota/server";
import { packageCatalog, packageGroups } from "@/lib/service-packages";
import type { ToolResult } from "./protocol";
import type { Connection } from "./store";

// Stage 3 of the connector (lib/hub-mcp/area-tools.ts): reading the rest of the hub for an admin's connection, with the
// server key after the connection's check, as the admins' other reading tools and the hub's own admin pages read. What
// the hub keeps out of sight stays out: archived customers, their files, conversations and contracts (lib/hub-archive).
// Never part of an answer: passwords, provider logins (they belong to the Schlüsselbund, which stays closed without a
// session), codes, the second factor and signed download links. Reading never marks a chat as read for the team.
// The answers carry the IDs that the writing tools of stage 4 take (lib/hub-mcp/area-writes.ts); reading stays here.

type Json = Record<string, unknown>;
type Db = NonNullable<ReturnType<typeof createAdminClient>>;

const json = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const refuse = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const lower = (value: string) => value.toLowerCase();
const noCustomer = "Diesen Kunden gibt es nicht oder er ist archiviert. Nimm die ID aus search.";
const failedRead = "Das konnte gerade nicht geladen werden. Bitte versuche es erneut.";
const LOCKED = { status: "locked", attemptsLeft: 0, recoveryLeft: 0 } as const;

/** Runs one reading tool of stage 3 for an admin's checked connection (lib/hub-mcp/server.ts checks the right first). */
export async function runAreaTool(connection: Connection, name: string, args: Json, origin: string): Promise<ToolResult> {
  const db = createAdminClient();
  if (!db) return refuse("Der Hub kann gerade nicht lesen. Bitte versuche es gleich noch einmal.");
  try {
    switch (name) {
      case "get_customer_contacts": return await customerContacts(db, args, origin);
      case "list_files": return await listFiles(db, args, origin);
      case "get_contract": return await contract(db, args, origin);
      case "list_conversations": return await listConversations(db, connection.userId, args, origin);
      case "read_conversation": return await readConversation(db, args, origin);
      case "get_admin_log": return await adminLog(db, args, origin);
      case "get_insights": return await insights(db, origin);
      default: return refuse("Dieses Werkzeug gibt es nicht.");
    }
  } catch (error) {
    console.error("[hub-mcp] reading failed", name, error instanceof Error ? error.message : "unknown");
    return refuse(failedRead);
  }
}

type CustomerRow = { id: string; company: string; customer_number: string; kind: string | null; organization_id: string | null };

/** A customer or freelancer entry the hub shows (not archived); `customers` = only entries of the kind customer. */
export async function entryOf(db: Db, customerId: unknown, kinds: "any" | "customers" = "any"): Promise<CustomerRow | null> {
  if (typeof customerId !== "string" || !uuid.test(customerId)) return null;
  const [{ data }, archive] = await Promise.all([
    db.from("hub_customers").select("id, company, customer_number, kind, organization_id").eq("id", lower(customerId)).maybeSingle<CustomerRow>(),
    readArchive(db),
  ]);
  if (!data || isArchivedCustomer(archive, data.id) || isArchivedOrganization(archive, data.organization_id)) return null;
  return kinds === "customers" && (data.kind ?? "customer") !== "customer" ? null : data;
}

async function namesOf(db: Db, ids: (string | null | undefined)[]) {
  const wanted = [...new Set(ids.filter((value): value is string => Boolean(value)))];
  if (!wanted.length) return new Map<string, string>();
  const { data } = await db.from("hub_profiles").select("user_id, first_name, last_name").in("user_id", wanted).returns<{ user_id: string; first_name: string | null; last_name: string | null }[]>();
  return new Map((data ?? []).map((row) => [row.user_id, `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "Teammitglied"]));
}

const sizeOf = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const euros = (cents: number | null) => (cents === null ? null : new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100));

/* ---------- Contact data and logins ---------- */

const STATUS_WORDS: Record<string, string> = { active: "aktiv", disabled: "deaktiviert", pending: "wartet auf Freigabe", rejected: "abgelehnt", invited: "eingeladen" };

async function customerContacts(db: Db, args: Json, origin: string): Promise<ToolResult> {
  const entry = await entryOf(db, args.customer_id);
  if (!entry) return refuse(noCustomer);
  const [details, members] = await Promise.all([
    db.from("hub_customers").select("contact_email, phone, website, street, postal_code, city, country").eq("id", entry.id)
      .maybeSingle<{ contact_email: string | null; phone: string | null; website: string | null; street: string | null; postal_code: string | null; city: string | null; country: string | null }>(),
    db.from("hub_customer_members").select("user_id").eq("customer_id", entry.id).returns<{ user_id: string }[]>(),
  ]);
  if (details.error) return refuse(failedRead);
  const ids = (members.data ?? []).map((row) => row.user_id).slice(0, 30);
  const profiles = ids.length
    ? (await db.from("hub_profiles").select("user_id, first_name, last_name, phone, position, status").in("user_id", ids)
      .returns<{ user_id: string; first_name: string | null; last_name: string | null; phone: string | null; position: string | null; status: string }[]>()).data ?? []
    : [];
  // The address and the last sign-in of each login come from the login itself, as in the user management.
  const logins = await Promise.all(ids.map(async (id) => {
    const found = await db.auth.admin.getUserById(id).catch(() => null);
    const user = found?.data?.user;
    const profile = profiles.find((row) => row.user_id === id);
    return {
      name: `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim() || null,
      email: user?.email ?? null,
      phone: profile?.phone || null,
      position: profile?.position || null,
      status: STATUS_WORDS[profile?.status ?? ""] ?? profile?.status ?? null,
      last_sign_in: user?.last_sign_in_at ?? null,
    };
  }));
  const row = details.data;
  const address = [row?.street, [row?.postal_code, row?.city].filter(Boolean).join(" "), row?.country].filter((part) => part && String(part).trim()).join(", ");
  return json({
    customer: { customer_id: entry.id, company: entry.company, customer_number: entry.customer_number, kind: (entry.kind ?? "customer") === "freelancer" ? "Freelancer" : "Kunde" },
    contact: { email: row?.contact_email || null, phone: row?.phone || null, website: row?.website || null, address: address || null },
    logins,
    note: "Passwörter, Codes und der zweite Faktor stehen hier nie; Zugänge ändert ein Admin im User Management.",
    link: `${origin}/dashboard/users?customer=${entry.id}`,
  });
}

/* ---------- Asset Management ---------- */

const AUDIENCE_WORDS: Record<string, string> = { both: "Kunde und Freelancer", customer: "Nur Kunde", freelancer: "Nur Freelancer" };
type FileRow = {
  id: string; title: string; file_name: string; category: string; description: string; mime_type: string; size_bytes: number; created_at: string;
  hub_file_assignments: { customer_id: string; folder_id: string | null; audience: string | null }[] | null;
};
const FILE_COLUMNS = "id, title, file_name, category, description, mime_type, size_bytes, created_at";
const MAX_FILES = 100;

async function listFiles(db: Db, args: Json, origin: string): Promise<ToolResult> {
  const query = typeof args.query === "string" ? args.query.trim().replace(/[%_,()\\]/g, " ").slice(0, 100) : "";
  const entry = args.customer_id === undefined ? null : await entryOf(db, args.customer_id);
  if (args.customer_id !== undefined && !entry) return refuse(noCustomer);
  const archive = await readArchive(db);
  let files = db.from("hub_files").select(`${FILE_COLUMNS}, hub_file_assignments${entry ? "!inner" : ""}(customer_id, folder_id, audience)`);
  if (entry) files = files.eq("hub_file_assignments.customer_id", entry.id);
  const [found, folders, customers] = await Promise.all([
    files.order("created_at", { ascending: false }).limit(entry ? 500 : 400).returns<FileRow[]>(),
    entry ? db.from("hub_folders").select("id, name").eq("customer_id", entry.id).order("name").returns<{ id: string; name: string }[]>() : db.from("hub_folders").select("id, name").limit(1000).returns<{ id: string; name: string }[]>(),
    db.from("hub_customers").select("id, company").returns<{ id: string; company: string }[]>(),
  ]);
  if (found.error) return refuse(failedRead);
  const company = new Map((customers.data ?? []).map((row) => [row.id, row.company]));
  const folderName = new Map((folders.data ?? []).map((row) => [row.id, row.name]));
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = (found.data ?? [])
    .filter((row) => fileInSight(archive, (row.hub_file_assignments ?? []).map((item) => item.customer_id)))
    .filter((row) => !words.length || words.every((word) => `${row.title} ${row.file_name}`.toLowerCase().includes(word)));
  return json({
    ...(entry ? { customer: { customer_id: entry.id, company: entry.company }, folders: (folders.data ?? []).map((row) => ({ folder_id: row.id, name: row.name })) } : {}),
    total: rows.length,
    shown: Math.min(rows.length, MAX_FILES),
    files: rows.slice(0, MAX_FILES).map((row) => {
      const assignments = (row.hub_file_assignments ?? []).filter((item) => !isArchivedCustomer(archive, item.customer_id));
      const own = entry ? assignments.find((item) => item.customer_id === entry.id) : undefined;
      return {
        file_id: row.id,
        title: row.title,
        file_name: row.file_name,
        category: (fileCategories as Record<string, string>)[row.category] ?? row.category,
        type: row.mime_type,
        size: sizeOf(Number(row.size_bytes)),
        uploaded_at: row.created_at,
        description: row.description || null,
        ...(own
          ? { folder: own.folder_id ? folderName.get(own.folder_id) ?? null : null, folder_id: own.folder_id, visibility: AUDIENCE_WORDS[own.audience ?? "both"] ?? "Kunde und Freelancer" }
          : { customers: assignments.map((item) => ({ customer_id: item.customer_id, company: company.get(item.customer_id) ?? "Kunde" })), in_inbox: !assignments.length }),
      };
    }),
    note: rows.length ? "Herunterladen geht im Asset Management über den Link." : entry ? "Diesem Kunden ist noch keine Datei zugeordnet." : "Keine passende Datei.",
    link: `${origin}/dashboard/files${entry ? `?customer=${entry.id}` : ""}`,
  });
}

/* ---------- Vertrag & Domain ---------- */

type TimelineRow = { id: string; occurred_on: string; kind: string; title: string; amount_cents: number | null; file_id: string | null; customer_visible: boolean; created_at: string; note: string | null; source: string | null; created_by: string | null };

async function contract(db: Db, args: Json, origin: string): Promise<ToolResult> {
  const entry = await entryOf(db, args.customer_id, "customers");
  if (!entry) return refuse(noCustomer);
  const [packages, timeline, domainMail, quota, shares] = await Promise.all([
    readCustomerPackages(db, [entry.id]),
    db.from("hub_customer_timeline").select(`${CUSTOMER_TIMELINE_COLUMNS}, note, source, created_by`).eq("customer_id", entry.id)
      .order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).limit(200).returns<TimelineRow[]>(),
    // The Schlüsselbund stays locked: no password and no provider login leaves the hub this way.
    loadDomainMailForAdmin(db, LOCKED, null).catch(() => null),
    loadServiceQuotaForAdmin(db).catch(() => null),
    loadFreelancerSharesForAdmin(db).catch(() => null),
  ]);
  const authors = await namesOf(db, (timeline.data ?? []).map((row) => row.created_by));
  const own = <T extends { customerId: string }>(rows: readonly T[] | undefined) => (rows ?? []).filter((row) => row.customerId === entry.id);
  const quotaRow = quota?.customers.find((row) => row.customerId === entry.id);
  return json({
    customer: { customer_id: entry.id, company: entry.company, customer_number: entry.customer_number },
    packages: packages.ready
      ? (packages.byCustomer.get(entry.id) ?? []).map((item) => ({
        group: packageGroups[item.group].name,
        package: item.packageId ? packageCatalog[item.packageId].name : "keins",
        since: item.since,
        until: item.until,
      }))
      : null,
    timeline: timeline.error ? null : (timeline.data ?? []).map((row) => ({
      entry_id: row.id,
      day: row.occurred_on,
      kind: (timelineKinds as Record<string, { label: string }>)[row.kind]?.label ?? row.kind,
      title: row.title,
      amount: euros(row.amount_cents),
      customer_sees: row.customer_visible,
      with_file: Boolean(row.file_id),
      note: row.note || null,
      by: row.source === "package" ? "automatisch (Paket)" : row.created_by ? authors.get(row.created_by) ?? "oalab-Team" : "oalab-Team",
    })),
    domains: domainMail ? own(domainMail.domains).map((domain) => ({
      domain_id: domain.id,
      domain: domain.display,
      registrar: domain.details?.registrar || null,
      dns: domain.details?.dnsProvider || null,
      website_host: domain.details?.websiteHost || null,
      owner: domain.details ? domainOwners[domain.details.owner] : null,
      renews_on: domain.details?.renewsOn ?? null,
      status: domain.details ? domainStatuses[domain.details.status].label : null,
      checks: domain.details ? Object.fromEntries(Object.entries(domain.details.checks).map(([check, ok]) => [(domainChecks as Record<string, { label: string }>)[check]?.label ?? check, ok])) : null,
      note: domain.details?.note || null,
    })) : null,
    mail_server: domainMail ? own(domainMail.mailServers).map((server) => ({
      imap: `${server.imapHost}${server.imapPort ? `:${server.imapPort}` : ""} (${server.imapSecurity})`,
      smtp: `${server.smtpHost}${server.smtpPort ? `:${server.smtpPort}` : ""} (${server.smtpSecurity})`,
      webmail: server.webmailUrl || null,
      provider: server.provider || null,
    }))[0] ?? null : null,
    mailboxes: domainMail ? own(domainMail.mailboxes).map((box) => ({ mailbox_id: box.id, address: box.display, person: box.person || null, kind: mailboxKinds[box.kind].label, target: box.targetDisplay || null })) : null,
    service_quota: quotaRow ? { usage: usageLine(quotaRow), state: quotaStatus(quotaRow), exempted: quotaRow.exempted, enforced: quota?.enforced ?? false } : null,
    freelancers: shares ? shares.assignments.filter((item) => item.customerId === entry.id).map((item) => ({
      freelancer_id: item.freelancerId,
      freelancer: item.freelancerName,
      number: item.freelancerNumber,
      sees: (Object.keys(item.shares) as ShareArea[]).filter((area) => item.shares[area]).map((area) => shareAreas[area].label),
      note: item.note || null,
    })) : null,
    note: "Passwörter und Zugangsdaten zu Domains, Postfächern und Anbietern stehen im Schlüsselbund und bleiben dort.",
    link: `${origin}/dashboard/contracts?customer=${entry.id}`,
  });
}

/* ---------- Conversations ---------- */

type ChatRow = { customer_id: string; author_id: string | null; side: string; body: string; created_at: string };
const SENDER_WORDS: Record<string, string> = { client: "Kunde", oalab: "oalab", assistant: "Assistent", system: "System" };
const MAX_LISTED = 50;

async function listConversations(db: Db, userId: string, args: Json, origin: string): Promise<ToolResult> {
  const kind = args.kind ?? "all";
  if (kind !== "all" && kind !== "service" && kind !== "private") return refuse("kind ist all, service oder private.");
  const entry = args.customer_id === undefined ? null : await entryOf(db, args.customer_id, "customers");
  if (args.customer_id !== undefined && !entry) return refuse(noCustomer);
  const answer: Json = {};

  if (kind !== "private") {
    const service = await readConversations(db);
    if (service.error) answer.service_error = service.error;
    const rows = service.conversations.filter((item) => !entry || item.customerId === entry.id);
    answer.service = rows.slice(0, MAX_LISTED).map((item) => ({
      request_id: item.id,
      reference: item.reference,
      title: item.title,
      state: item.stateLabel,
      company: item.company,
      customer_id: item.customerId,
      last_at: item.lastAt,
      last_message: item.lastMessage ? { from: item.lastMessage.name ?? SENDER_WORDS[item.lastMessage.sender] ?? item.lastMessage.sender, text: item.lastMessage.body.slice(0, 300) } : null,
    }));
  }

  if (kind !== "service") {
    const [customers, archive] = await Promise.all([
      db.from("hub_customers").select("id, company, customer_number, kind").returns<{ id: string; company: string; customer_number: string; kind: string | null }[]>(),
      readArchive(db),
    ]);
    const shown = (customers.data ?? []).filter((row) => (row.kind ?? "customer") === "customer" && !isArchivedCustomer(archive, row.id) && (!entry || row.id === entry.id));
    const messages = db.from("hub_private_messages").select("customer_id, author_id, side, body, created_at");
    const [list, reads] = await Promise.all([
      (entry ? messages.eq("customer_id", entry.id) : messages).order("created_at", { ascending: false }).limit(1000).returns<ChatRow[]>(),
      db.from("hub_private_reads").select("customer_id, read_at").eq("user_id", userId).returns<{ customer_id: string; read_at: string }[]>(),
    ]);
    if (list.error) answer.private_error = "Der private Chat konnte gerade nicht geladen werden.";
    const byCustomer = new Map<string, ChatRow[]>();
    for (const row of list.data ?? []) byCustomer.set(row.customer_id, [...(byCustomer.get(row.customer_id) ?? []), row]);
    const readAt = new Map((reads.data ?? []).map((row) => [row.customer_id, row.read_at]));
    const people = await namesOf(db, [...byCustomer.values()].map((rows) => rows[0]?.author_id));
    answer.private = shown
      .flatMap((customer) => {
        const rows = byCustomer.get(customer.id) ?? [];
        const last = rows.find((row) => isChatSide(row.side));
        if (!last) return [];
        const lastCustomer = rows.find((row) => row.side === "customer")?.created_at ?? null;
        const lastTeam = rows.find((row) => row.side === "oalab")?.created_at ?? null;
        return [{
          customer_id: customer.id,
          company: customer.company,
          last_at: last.created_at,
          last_message: { from: last.side === "oalab" ? `oalab${last.author_id && people.get(last.author_id) ? ` (${people.get(last.author_id)})` : ""}` : people.get(last.author_id ?? "") ?? customer.company, text: last.body.slice(0, 300) },
          unread: chatUnread({ lastOtherAt: lastCustomer, lastOwnSideAt: lastTeam, readAt: readAt.get(customer.id) ?? null }),
          link: `${origin}/dashboard/messages?chat=${customer.id}`,
        }];
      })
      .sort((a, b) => b.last_at.localeCompare(a.last_at))
      .slice(0, MAX_LISTED);
  }
  return json({ ...answer, link: `${origin}/dashboard/messages` });
}

async function readConversation(db: Db, args: Json, origin: string): Promise<ToolResult> {
  if (args.kind === "service") {
    if (typeof args.request_id !== "string" || !uuid.test(args.request_id)) return refuse("Bitte die Anfrage angeben (request_id aus list_conversations).");
    const [thread, archive, request] = await Promise.all([
      loadThread(db, lower(args.request_id)),
      readArchive(db),
      db.from("service_requests").select("organization_id").eq("id", lower(args.request_id)).maybeSingle<{ organization_id: string }>(),
    ]);
    if (!thread || !request.data || isArchivedOrganization(archive, request.data.organization_id)) return refuse("Diese Anfrage gibt es nicht (mehr), oder ihr Kunde ist archiviert. Nimm die ID aus list_conversations.");
    return json({
      request: { request_id: thread.conversation.id, reference: thread.conversation.reference, title: thread.conversation.title, state: thread.conversation.stateLabel, company: thread.conversation.company },
      messages: thread.messages.map((message) => ({ from: message.name ?? SENDER_WORDS[message.sender] ?? message.sender, side: SENDER_WORDS[message.sender] ?? message.sender, at: message.at, text: message.body })),
      note: "Antworten geht auf der Serviceplattform.",
      link: `${origin}/dashboard/messages`,
    });
  }
  if (args.kind === "private") {
    const entry = await entryOf(db, args.customer_id, "customers");
    if (!entry) return refuse(noCustomer);
    const { data, error } = await db.from("hub_private_messages").select("customer_id, author_id, side, body, created_at").eq("customer_id", entry.id)
      .order("created_at", { ascending: false }).limit(300).returns<ChatRow[]>();
    if (error) return refuse("Der private Chat konnte gerade nicht geladen werden.");
    const rows = (data ?? []).filter((row) => isChatSide(row.side)).reverse();
    const people = await namesOf(db, rows.map((row) => row.author_id));
    return json({
      chat: { customer_id: entry.id, company: entry.company },
      messages: rows.map((row) => ({ from: row.author_id ? people.get(row.author_id) ?? (row.side === "oalab" ? "oalab" : entry.company) : row.side === "oalab" ? "oalab" : entry.company, side: row.side === "oalab" ? "oalab" : "Kunde", at: row.created_at, text: row.body })),
      note: rows.length ? "Für das Team bleibt der Chat so ungelesen, wie er war. Antworten geht im Hub." : "In diesem Chat steht noch nichts.",
      link: `${origin}/dashboard/messages?chat=${entry.id}`,
    });
  }
  return refuse("kind ist service (mit request_id) oder private (mit customer_id).");
}

/* ---------- Admin log and AI log ---------- */

type EventRow = { id: number; created_at: string; actor_id: string | null; action: string; summary: string; target_customer_id: string | null };
const MAX_EVENTS = 100;

async function adminLog(db: Db, args: Json, origin: string): Promise<ToolResult> {
  const days = args.days === undefined ? 14 : Number(args.days);
  if (!Number.isInteger(days) || days < 1 || days > 90) return refuse("days ist eine ganze Zahl von 1 bis 90.");
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  if (args.source === "ai") {
    const log = await readAssistantLog(db, 300);
    if (log.error) return refuse(log.error);
    const rows = log.rows.filter((row) => row.createdAt >= since).slice(0, MAX_EVENTS);
    return json({ source: "KI-Protokoll", days, entries: rows.map((row) => ({ at: row.createdAt, by: row.actor, kind: row.kind, outcome: row.outcome, target: row.target, summary: row.summary })), link: `${origin}/dashboard/ai-log` });
  }
  if (args.source !== undefined && args.source !== "hub") return refuse("source ist hub oder ai.");
  if (args.action !== undefined && (typeof args.action !== "string" || !/^[a-z][a-z_.]{0,39}$/.test(args.action))) return refuse("action ist der Anfang einer Aktion, etwa claude. oder note.");
  const entry = args.customer_id === undefined ? null : await entryOf(db, args.customer_id);
  if (args.customer_id !== undefined && !entry) return refuse(noCustomer);
  let query = db.from("hub_admin_events").select("id, created_at, actor_id, action, summary, target_customer_id").gte("created_at", since);
  if (entry) query = query.eq("target_customer_id", entry.id);
  if (typeof args.action === "string") query = query.like("action", `${args.action.replace(/_/g, "\\_")}%`);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(MAX_EVENTS).returns<EventRow[]>();
  if (error) return refuse(failedRead);
  const rows = data ?? [];
  const [actors, customers] = await Promise.all([
    namesOf(db, rows.map((row) => row.actor_id)),
    db.from("hub_customers").select("id, company").in("id", [...new Set(rows.flatMap((row) => (row.target_customer_id ? [row.target_customer_id] : [])))]).returns<{ id: string; company: string }[]>(),
  ]);
  const company = new Map((customers.data ?? []).map((row) => [row.id, row.company]));
  return json({
    source: "Admin-Protokoll",
    days,
    shown: rows.length,
    entries: rows.map((row) => ({ at: row.created_at, by: row.actor_id ? actors.get(row.actor_id) ?? "Gelöschter Zugang" : "System", action: row.action, summary: row.summary, customer: row.target_customer_id ? company.get(row.target_customer_id) ?? null : null })),
    ...(rows.length === MAX_EVENTS ? { note: `Die neuesten ${MAX_EVENTS}; für ältere weniger Tage oder einen Kunden wählen.` } : {}),
    link: `${origin}/dashboard/users`,
  });
}

/* ---------- Insights ---------- */

type AppointmentRow = { id: string; title: string; starts_at: string; ends_at: string; status: string; customer: { id: string; company: string } | null };

async function insights(db: Db, origin: string): Promise<ToolResult> {
  const today = todayIso();
  const [appointments, quota, archive, customers] = await Promise.all([
    db.from("hub_appointments").select("id, title, starts_at, ends_at, status, customer:hub_customers(id, company)")
      .gte("starts_at", new Date(wallTimeToUtc(today, "00:00")).toISOString()).lt("starts_at", new Date(wallTimeToUtc(addDays(today, 31), "00:00")).toISOString())
      .in("status", ["confirmed", "requested"]).order("starts_at").limit(200).returns<AppointmentRow[]>(),
    loadServiceQuotaForAdmin(db).catch(() => null),
    readArchive(db),
    db.from("hub_customers").select("id, company, customer_number").returns<{ id: string; company: string; customer_number: string }[]>(),
  ]);
  const shown = (appointments.data ?? []).filter((row) => !row.customer || !isArchivedCustomer(archive, row.customer.id));
  const view = (row: AppointmentRow) => {
    const start = Date.parse(row.starts_at);
    return {
      appointment_id: row.id, title: row.title, day: dayOf(start), weekday_day: formatDayShort(dayOf(start)), start: timeOf(start), end: timeOf(Date.parse(row.ends_at)),
      status: isAppointmentStatus(row.status) ? appointmentStatuses[row.status] : row.status, customer: row.customer?.company ?? "intern",
      link: `${origin}/dashboard/projects/calendar?appointment=${row.id}`,
    };
  };
  const names = new Map((customers.data ?? []).map((row) => [row.id, row]));
  return json({
    today,
    appointments_today: shown.filter((row) => row.status === "confirmed" && dayOf(Date.parse(row.starts_at)) === today).map(view),
    open_requests: shown.filter((row) => row.status === "requested").map(view),
    service_quota: quota ? {
      enforced: quota.enforced,
      month: quota.window ? { from: quota.window.startsAt, until: quota.window.endsAt } : null,
      customers: quota.customers
        .filter((row) => row.packageId && !isArchivedCustomer(archive, row.customerId))
        .map((row) => ({ company: names.get(row.customerId)?.company ?? "Kunde", customer_number: names.get(row.customerId)?.customer_number ?? null, usage: usageLine(row), state: quotaStatus(row) }))
        .sort((a, b) => a.company.localeCompare(b.company, "de")),
    } : null,
    link: `${origin}/dashboard/insights`,
  });
}
