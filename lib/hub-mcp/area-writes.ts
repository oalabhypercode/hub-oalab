import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { connectorClaims } from "@/lib/platform/auth";
import { createOwnClaimsClient } from "@/lib/platform/client";
import { fileInSight } from "@/lib/hub-archive/rules";
import { readArchive } from "@/lib/hub-archive/server";
import { centsToInput, formatCents, readTimelineEntry, timelineKinds } from "@/lib/hub-contracts/rules";
import { saveTimelineEntryAs } from "@/lib/hub-contracts/write";
import { readMessage } from "@/lib/hub-conversations/rules";
import { domainCheckIds, domainOwners, domainStatuses, mailboxKinds, readDomain, readMailbox } from "@/lib/hub-domains/rules";
import { saveDomainAs, saveMailboxAs } from "@/lib/hub-domains/write";
import { cleanFolderName } from "@/lib/hub-files/catalog";
import { cleanName, MAX_NAME, nameExtension } from "@/lib/hub-files/naming";
import { isFileAudience, type FileAudience } from "@/lib/hub-files/types";
import { assignFilesAs, renameFilesAs, setFileAudienceAs, type FileClient } from "@/lib/hub-files/write";
import { cleanShareNote, isShareArea, shareAreaIds, shareAreas, type ShareArea } from "@/lib/hub-freelancer-customers/rules";
import { saveFreelancerNoteAs, setFreelancerShareAs } from "@/lib/hub-freelancer-customers/write";
import { notifyChat } from "@/lib/hub-notify/server";
import { CHAT_NOT_SET_UP, isMissingChat, markPrivateRead } from "@/lib/hub-private-chat/server";
import { writeCustomerAs } from "@/lib/hub-users/customer-write";
import { readEntriesWithoutActiveLogin } from "@/lib/hub-users/deactivated";
import { readCustomer } from "@/lib/hub-users/rules";
import { entryOf } from "./areas";
import type { ToolResult } from "./protocol";
import { logEvent, type Connection } from "./store";

// Stage 4 of the connector (lib/hub-mcp/area-tools.ts): writing in the rest of the hub for an admin's connection with
// the right to write, through the very code the hub's own windows save with. Where a window saves with the admin's
// session (the private chat, the Asset Management's assigning, renaming and folders), Claude saves with a key that
// carries the admin's claims, so Row Level Security has the last word; where it saves with the service role after its
// admin check (contact data, „Sichtbar für“, Vertrag & Domain, the freelancers' shares), Claude does the same after the
// connection's check. Every change gets a line in the admin log (`claude.*`); the cores of Vertrag & Domain and of the
// shares write theirs themselves. Archived customers stay out of reach, as in the hub. Never here: logins, invitations,
// the second factor, the Schlüsselbund and passwords, packages, the quota lock, and deleting anything.

type Json = Record<string, unknown>;
type Db = NonNullable<ReturnType<typeof createAdminClient>>;
type Writer = { userId: string; db: Db; own: SupabaseClient; origin: string };

const json = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const refuse = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && uuid.test(value);
const lower = (value: string) => value.toLowerCase();
const noCustomer = "Diesen Kunden gibt es nicht oder er ist archiviert. Nimm die ID aus search.";
const failedRead = "Das konnte gerade nicht geladen werden. Bitte versuche es erneut.";
const AUDIENCE_WORDS: Record<FileAudience, string> = { both: "Kunde und Freelancer", customer: "Nur Kunde", freelancer: "Nur Freelancer" };

/** Runs one writing tool of stage 4 for an admin's checked connection (lib/hub-mcp/server.ts checks role and right). */
export async function runAreaWriteTool(connection: Connection, name: string, args: Json, origin: string): Promise<ToolResult> {
  const db = createAdminClient();
  const claims = await connectorClaims(connection.userId).catch(() => null);
  if (!db || !claims) return refuse("Der Hub kann gerade nicht speichern. Bitte versuche es gleich noch einmal.");
  const w: Writer = { userId: connection.userId, db, own: createOwnClaimsClient(claims), origin };
  try {
    switch (name) {
      case "send_chat_message": return await sendChatMessage(w, args);
      case "update_customer_contact": return await updateCustomerContact(w, args);
      case "assign_files": return await assignFiles(w, args);
      case "set_file_visibility": return await setFileVisibility(w, args);
      case "rename_files": return await renameFiles(w, args);
      case "create_folder": return await createFolder(w, args);
      case "save_timeline_entry": return await saveTimelineEntry(w, args);
      case "save_domain": return await saveDomain(w, args);
      case "save_mailbox": return await saveMailbox(w, args);
      case "set_freelancer_access": return await setFreelancerAccess(w, args);
      default: return refuse("Dieses Werkzeug gibt es nicht.");
    }
  } catch (error) {
    console.error("[hub-mcp] write failed", name, error instanceof Error ? error.message : "unknown");
    return refuse("Das hat gerade nicht geklappt. Nichts Neues wurde gespeichert, oder nur ein Teil; sieh im Hub nach und versuche es erneut.");
  }
}

/* ---------- Private chat ---------- */

/**
 * An answer as oalab, as „Senden“ under Nachrichten saves it: with the admin's claims (the database checks the side),
 * then the team's read mark and the customer's notice. The log names the customer, never the text.
 */
async function sendChatMessage(w: Writer, args: Json): Promise<ToolResult> {
  const entry = await entryOf(w.db, args.customer_id, "customers");
  if (!entry) return refuse(noCustomer);
  const message = readMessage(args.text);
  if (!message.ok) return refuse(message.error);
  const { error } = await w.own.from("hub_private_messages").insert({ customer_id: entry.id, side: "oalab", body: message.value, client_id: crypto.randomUUID() });
  if (error) return refuse(isMissingChat(error) ? CHAT_NOT_SET_UP : "Die Nachricht ist nicht angekommen. Bitte versuche es erneut.");
  await markPrivateRead({ userId: w.userId, side: "oalab", customerIds: [] }, entry.id);
  after(() => notifyChat({ side: "oalab", customerId: entry.id, company: entry.company, authorId: w.userId, body: message.value, origin: w.origin }));
  await logEvent(w.userId, "claude.chat.sent", `Antwort im privaten Chat mit „${entry.company}“ über Claude geschrieben`, entry.id);
  return json({
    sent: true,
    chat: { customer_id: entry.id, company: entry.company },
    characters: message.value.length,
    note: "Der Kunde sieht die Nachricht sofort und bekommt eine Meldung in der Glocke, später eine E-Mail, falls er sie nicht liest.",
    link: `${w.origin}/dashboard/messages?chat=${entry.id}`,
  });
}

/* ---------- Contact data ---------- */

const CONTACT = [
  ["contact_email", "contactEmail", "E-Mail"],
  ["phone", "phone", "Telefon"],
  ["website", "website", "Website"],
  ["street", "street", "Straße"],
  ["postal_code", "postalCode", "PLZ"],
  ["city", "city", "Ort"],
  ["country", "country", "Land"],
] as const;
type ContactColumn = (typeof CONTACT)[number][0];
type StoredCustomer = { organization_id: string | null; company: string; customer_number: string } & Record<ContactColumn, string | null>;

/**
 * Contact data as the window in the user management saves it (lib/hub-users/customer-write.ts): the named fields over
 * the stored ones, company and number unchanged, checked with the window's own rules.
 */
async function updateCustomerContact(w: Writer, args: Json): Promise<ToolResult> {
  const entry = await entryOf(w.db, args.customer_id, "customers");
  if (!entry) return refuse(noCustomer);
  const given = CONTACT.filter(([column]) => args[column] !== undefined);
  if (!given.length) return refuse("Bitte mindestens ein Feld angeben, das sich ändern soll.");
  const wrong = given.find(([column]) => typeof args[column] !== "string");
  if (wrong) return refuse(`${wrong[2]} bitte als Text angeben (leer leert das Feld).`);
  const stored = await w.db.from("hub_customers").select("organization_id, company, customer_number, contact_email, phone, website, street, postal_code, city, country")
    .eq("id", entry.id).maybeSingle<StoredCustomer>();
  if (stored.error || !stored.data) return refuse(failedRead);
  const row = stored.data;
  const merged: Json = { company: row.company, customerNumber: row.customer_number };
  for (const [column, key] of CONTACT) merged[key] = args[column] !== undefined ? args[column] : row[column] ?? "";
  const customer = readCustomer(merged);
  if (!customer.ok) return refuse(customer.error);
  const changed = given.filter(([column, key]) => customer.value[key] !== (row[column] ?? ""));
  const contact = { contact_email: customer.value.contactEmail || null, phone: customer.value.phone || null, website: customer.value.website || null, street: customer.value.street || null, postal_code: customer.value.postalCode || null, city: customer.value.city || null, country: customer.value.country || null };
  const link = `${w.origin}/dashboard/users?customer=${entry.id}`;
  if (!changed.length) return json({ saved: false, customer: { customer_id: entry.id, company: entry.company }, contact, note: "Diese Kontaktdaten sind schon so eingetragen.", link });
  const written = await writeCustomerAs(w.db, w.userId, entry.id, row.organization_id, customer.value);
  if (!written.ok) return refuse(written.error);
  await logEvent(w.userId, "claude.customer.updated", `Kontaktdaten von „${entry.company}“ über Claude geändert: ${changed.map(([, , label]) => label).join(", ")}`, entry.id);
  return json({ saved: true, customer: { customer_id: entry.id, company: entry.company, customer_number: entry.customer_number }, changed: changed.map(([, , label]) => label), contact, note: row.organization_id ? "Die Kontaktdaten gelten auch auf der Serviceplattform." : undefined, link });
}

/* ---------- Asset Management ---------- */

/** The admin's claims as the Asset Management's own session: its cores take that client. */
const fileClient = (w: Writer) => w.own as unknown as FileClient;

/** Files the hub shows: at a customer who is not archived, or not assigned yet. */
async function filesInSight(w: Writer, ids: string[]) {
  const [assignments, archive] = await Promise.all([
    w.db.from("hub_file_assignments").select("file_id, customer_id").in("file_id", ids).returns<{ file_id: string; customer_id: string }[]>(),
    readArchive(w.db),
  ]);
  if (assignments.error) return false;
  return ids.every((id) => fileInSight(archive, (assignments.data ?? []).filter((row) => row.file_id === id).map((row) => row.customer_id)));
}

const notInSight = "Mindestens eine Datei gibt es nicht (mehr) oder sie liegt nur bei archivierten Kunden. Nimm die IDs aus list_files.";

/** „Zuordnen“ (lib/hub-files/write.ts): to a customer, into one of their folders, carrying „Sichtbar für“ along or moved. */
async function assignFiles(w: Writer, args: Json): Promise<ToolResult> {
  const ids = Array.isArray(args.file_ids) ? [...new Set(args.file_ids.filter(isId).map(lower))] : [];
  if (!ids.length || ids.length > 50 || ids.length !== (args.file_ids as unknown[]).length) return refuse("Bitte 1 bis 50 Dateien angeben, jede mit ihrer file_id aus list_files.");
  const entry = await entryOf(w.db, args.customer_id);
  if (!entry) return refuse(noCustomer);
  // As in „Zuordnen“: a freelancer whose logins are all deactivated is no target (lib/hub-users/deactivated.ts).
  if (entry.kind === "freelancer") {
    const inactive = await readEntriesWithoutActiveLogin(w.db, [entry.id]);
    if (!inactive) return refuse(failedRead);
    if (inactive.has(entry.id)) return refuse("Dieser Freelancer ist deaktiviert und bekommt keine Dateien mehr.");
  }
  const from = args.from_customer_id === undefined ? null : await entryOf(w.db, args.from_customer_id);
  if (args.from_customer_id !== undefined && !from) return refuse("Den bisherigen Kunden gibt es nicht oder er ist archiviert. Nimm die ID aus search.");
  if (args.move === true && !from) return refuse("Zum Verschieben bitte auch from_customer_id angeben.");
  let folder: { id: string; name: string } | null = null;
  if (args.folder_id !== undefined) {
    const found = isId(args.folder_id)
      ? await w.db.from("hub_folders").select("id, name").eq("id", lower(args.folder_id)).eq("customer_id", entry.id).maybeSingle<{ id: string; name: string }>()
      : null;
    if (!found?.data) return refuse("Diesen Ordner gibt es bei diesem Kunden nicht. Nimm die folder_id aus list_files mit customer_id oder lege ihn mit create_folder an.");
    folder = found.data;
  }
  if (!await filesInSight(w, ids)) return refuse(notInSight);
  const result = await assignFilesAs(fileClient(w), { fileIds: ids, customerId: entry.id, folderId: folder?.id ?? null, from: from?.id ?? null, move: args.move === true });
  if (!result.ok) return refuse(result.error);
  const { added, moved } = result.data;
  if (added || moved || folder) {
    const what = ids.length === 1 ? "1 Datei" : `${ids.length} Dateien`;
    await logEvent(w.userId, "claude.files.assigned", `${what} über Claude ${moved && from ? `von „${from.company}“ zu „${entry.company}“ verschoben` : `„${entry.company}“ zugeordnet`}${folder ? ` (Ordner „${folder.name}“)` : ""}`, entry.id);
  }
  return json({
    added,
    moved,
    already_there: ids.length - added,
    customer: { customer_id: entry.id, company: entry.company },
    folder: folder ? { folder_id: folder.id, name: folder.name } : null,
    note: added ? "Wer die Dateien neu sieht, bekommt eine Meldung in der Glocke." : "Die Dateien lagen schon bei diesem Kunden.",
    link: `${w.origin}/dashboard/files?customer=${entry.id}`,
  });
}

/**
 * „Sichtbar für“ at one customer (lib/hub-files/write.ts, with the service role as the hub's action); like the details
 * panel, only at customers, as freelancers' own entries have no freelancers.
 */
async function setFileVisibility(w: Writer, args: Json): Promise<ToolResult> {
  const entry = await entryOf(w.db, args.customer_id, "customers");
  if (!entry) return refuse(noCustomer);
  if (!isId(args.file_id)) return refuse("Bitte die Datei angeben (file_id aus list_files).");
  if (!isFileAudience(args.visibility)) return refuse("visibility ist both, customer oder freelancer.");
  const fileId = lower(args.file_id);
  const [file, assignment] = await Promise.all([
    w.db.from("hub_files").select("title").eq("id", fileId).maybeSingle<{ title: string }>(),
    w.db.from("hub_file_assignments").select("audience").eq("file_id", fileId).eq("customer_id", entry.id).maybeSingle<{ audience: string | null }>(),
  ]);
  if (!file.data) return refuse("Diese Datei gibt es nicht. Nimm die file_id aus list_files.");
  if (!assignment.data) return refuse("Die Datei liegt nicht bei diesem Kunden. Ordne sie zuerst mit assign_files zu.");
  const link = `${w.origin}/dashboard/files?customer=${entry.id}`;
  const visibility = AUDIENCE_WORDS[args.visibility];
  if ((assignment.data.audience ?? "both") === args.visibility) return json({ saved: false, file: { file_id: fileId, title: file.data.title }, visibility, note: "Das steht schon so.", link });
  const result = await setFileAudienceAs(w.db, fileId, entry.id, args.visibility);
  if (!result.ok) return refuse(result.error);
  await logEvent(w.userId, "claude.file.visibility", `„${file.data.title}“ bei „${entry.company}“ über Claude auf „${visibility}“ gestellt`, entry.id);
  return json({ saved: true, file: { file_id: fileId, title: file.data.title }, customer: { customer_id: entry.id, company: entry.company }, visibility, note: "Wer die Datei dadurch neu sieht, bekommt eine Meldung in der Glocke.", link });
}

/** „Umbenennen“ (lib/hub-files/write.ts): title and download name become the new name, the extension stays. */
async function renameFiles(w: Writer, args: Json): Promise<ToolResult> {
  const items = Array.isArray(args.files) ? args.files : [];
  if (!items.length || items.length > 50) return refuse("Bitte 1 bis 50 Dateien mit ihrem neuen Namen angeben.");
  const wanted = new Map<string, string>();
  for (const item of items) {
    const value = (item && typeof item === "object" ? item : {}) as Json;
    if (!isId(value.file_id)) return refuse("Jede Datei braucht ihre file_id aus list_files.");
    const name = cleanName(value.name, MAX_NAME);
    if (!name) return refuse("Bitte jeder Datei einen Namen geben.");
    wanted.set(lower(value.file_id), name);
  }
  const ids = [...wanted.keys()];
  const [files, sight] = await Promise.all([
    w.db.from("hub_files").select("id, title, file_name").in("id", ids).returns<{ id: string; title: string; file_name: string }[]>(),
    filesInSight(w, ids),
  ]);
  if (files.error) return refuse(failedRead);
  if ((files.data ?? []).length < ids.length || !sight) return refuse(notInSight);
  const changes = (files.data ?? []).flatMap((file) => {
    const title = wanted.get(file.id) ?? file.title;
    const fileName = `${title}${nameExtension(file.file_name)}`;
    return title === file.title && fileName === file.file_name ? [] : [{ id: file.id, title, fileName, before: file.title }];
  });
  const link = `${w.origin}/dashboard/files`;
  if (!changes.length) return json({ renamed: 0, note: "Die Dateien heißen schon so.", link });
  const result = await renameFilesAs(fileClient(w), changes.map(({ id, title, fileName }) => ({ id, title, fileName })));
  if (!result.ok) return refuse(result.error);
  await logEvent(w.userId, "claude.files.renamed", changes.length === 1 ? `Datei „${changes[0].before}“ über Claude in „${changes[0].title}“ umbenannt` : `${changes.length} Dateien über Claude umbenannt`);
  return json({ renamed: result.data.count, files: changes.map((change) => ({ file_id: change.id, title: change.title, file_name: change.fileName })), link });
}

/** A folder at a customer, as „Neuer Ordner“ in the Asset Management saves it (the admin's claims, RLS). */
async function createFolder(w: Writer, args: Json): Promise<ToolResult> {
  const entry = await entryOf(w.db, args.customer_id);
  if (!entry) return refuse(noCustomer);
  const clean = cleanFolderName(args.name);
  if (!clean.ok) return refuse(clean.error);
  const { data, error } = await w.own.from("hub_folders").insert({ customer_id: entry.id, name: clean.name }).select("id, name").single<{ id: string; name: string }>();
  if (error || !data) {
    const missing = error && (error.code === "42P01" || error.code === "PGRST205" || /hub_folders|schema cache/i.test(error.message ?? ""));
    return refuse(error?.code === "23505" ? "Einen Ordner mit diesem Namen gibt es bei diesem Kunden schon." : missing ? "Ordner sind in der Datenbank noch nicht eingerichtet. Die Migration steht noch aus." : "Der Ordner konnte nicht angelegt werden.");
  }
  await logEvent(w.userId, "claude.folder.created", `Ordner „${data.name}“ bei „${entry.company}“ über Claude angelegt`, entry.id);
  return json({ created: true, folder: { folder_id: data.id, name: data.name }, customer: { customer_id: entry.id, company: entry.company }, note: "Dateien kommen mit assign_files und dieser folder_id hinein.", link: `${w.origin}/dashboard/files?customer=${entry.id}` });
}

/* ---------- Vertrag & Domain ---------- */

const contractLink = (w: Writer, customerId: string) => `${w.origin}/dashboard/contracts?customer=${customerId}`;
/** An argument when Claude named it, else what is stored (or the window's default for something new). */
const pick = (args: Json, key: string, fallback: unknown) => (args[key] !== undefined ? args[key] : fallback);

type StoredEntry = { occurred_on: string; kind: string; title: string; amount_cents: number | null; file_id: string | null; note: string | null; customer_visible: boolean };

/** A timeline entry as the window under „Vertrag & Domain“ saves it (lib/hub-contracts/write.ts logs it as claude.*). */
async function saveTimelineEntry(w: Writer, args: Json): Promise<ToolResult> {
  const entry = await entryOf(w.db, args.customer_id, "customers");
  if (!entry) return refuse(noCustomer);
  let stored: StoredEntry | null = null;
  if (args.entry_id !== undefined) {
    const found = isId(args.entry_id)
      ? await w.db.from("hub_customer_timeline").select("occurred_on, kind, title, amount_cents, file_id, note, customer_visible").eq("id", lower(args.entry_id)).eq("customer_id", entry.id).maybeSingle<StoredEntry>()
      : null;
    if (!found?.data) return refuse("Diesen Eintrag gibt es bei diesem Kunden nicht. Nimm die entry_id aus get_contract.");
    stored = found.data;
  } else if (args.day === undefined || args.kind === undefined || args.title === undefined) {
    return refuse("Für einen neuen Eintrag bitte day, kind und title angeben.");
  }
  const input = {
    id: stored ? lower(args.entry_id as string) : undefined,
    customerId: entry.id,
    occurredOn: pick(args, "day", stored?.occurred_on),
    kind: pick(args, "kind", stored?.kind),
    title: pick(args, "title", stored?.title),
    amount: pick(args, "amount", stored ? centsToInput(stored.amount_cents) : null),
    note: pick(args, "note", stored?.note ?? ""),
    customerVisible: pick(args, "customer_visible", stored?.customer_visible ?? false),
    fileId: args.file_id !== undefined ? (typeof args.file_id === "string" ? lower(args.file_id) : args.file_id) : stored?.file_id ?? null,
  };
  const checked = readTimelineEntry(input);
  if (!checked.ok) return refuse(checked.error);
  const result = await saveTimelineEntryAs({ db: w.db, actorId: w.userId, via: "claude" }, input);
  if (!result.ok) return refuse(result.error);
  const value = checked.value;
  return json({
    saved: true,
    created: !stored,
    entry_id: result.data.id,
    customer: { customer_id: entry.id, company: entry.company },
    entry: { day: value.occurredOn, kind: timelineKinds[value.kind].label, title: value.title, amount: value.amountCents === null ? null : formatCents(value.amountCents), customer_sees: value.customerVisible, with_file: Boolean(value.fileId), note: value.note || null },
    link: contractLink(w, entry.id),
  });
}

type StoredDomain = {
  domain: string; registrar: string | null; dns_provider: string | null; website_host: string | null; owner: string; renews_on: string | null; status: string; note: string | null;
} & Record<`${(typeof domainCheckIds)[number]}_ok`, boolean | null>;

/** A domain as the window „Domain“ saves it (lib/hub-domains/write.ts logs it as claude.*); never its logins. */
async function saveDomain(w: Writer, args: Json): Promise<ToolResult> {
  const entry = await entryOf(w.db, args.customer_id, "customers");
  if (!entry) return refuse(noCustomer);
  let stored: StoredDomain | null = null;
  if (args.domain_id !== undefined) {
    const found = isId(args.domain_id)
      ? await w.db.from("hub_customer_domains").select("domain, registrar, dns_provider, website_host, owner, renews_on, status, note, website_ok, ssl_ok, mx_ok, spf_ok, dkim_ok, dmarc_ok")
        .eq("id", lower(args.domain_id)).eq("customer_id", entry.id).maybeSingle<StoredDomain>()
      : null;
    if (!found?.data) return refuse("Diese Domain gibt es bei diesem Kunden nicht. Nimm die domain_id aus get_contract.");
    stored = found.data;
  } else if (args.domain === undefined) {
    return refuse("Für eine neue Domain bitte domain angeben, zum Beispiel kunde.de.");
  }
  if (args.checks !== undefined && (!args.checks || typeof args.checks !== "object" || Array.isArray(args.checks))) return refuse("checks nennt Prüfungen mit true oder false.");
  const given = (args.checks ?? {}) as Json;
  const input = {
    id: stored ? lower(args.domain_id as string) : undefined,
    customerId: entry.id,
    domain: pick(args, "domain", stored?.domain),
    // New domains start as the window's do: active, owned by the customer.
    status: pick(args, "status", stored?.status ?? "active"),
    owner: pick(args, "owner", stored?.owner ?? "customer"),
    registrar: pick(args, "registrar", stored?.registrar ?? ""),
    dnsProvider: pick(args, "dns_provider", stored?.dns_provider ?? ""),
    websiteHost: pick(args, "website_host", stored?.website_host ?? ""),
    renewsOn: pick(args, "renews_on", stored?.renews_on ?? null),
    note: pick(args, "note", stored?.note ?? ""),
    checks: Object.fromEntries(domainCheckIds.map((check) => [check, given[check] !== undefined ? given[check] === true : stored?.[`${check}_ok`] === true])),
  };
  const checked = readDomain(input);
  if (!checked.ok) return refuse(checked.error);
  const result = await saveDomainAs({ db: w.db, actorId: w.userId, via: "claude" }, input);
  if (!result.ok) return refuse(result.error);
  const value = checked.value;
  return json({
    saved: true,
    created: !stored,
    domain_id: result.data.id,
    customer: { customer_id: entry.id, company: entry.company },
    domain: {
      domain: value.domain, status: domainStatuses[value.status].label, owner: domainOwners[value.owner], registrar: value.registrar || null, dns: value.dnsProvider || null,
      website_host: value.websiteHost || null, renews_on: value.renewsOn, checks: value.checks, note: value.note || null,
    },
    note: "Zugangsdaten zur Domain stehen im Schlüsselbund und ändern sich nur im Hub.",
    link: contractLink(w, entry.id),
  });
}

type StoredMailbox = { address: string; person: string | null; kind: string; target: string | null };

/** A mailbox, forward or alias as its window saves it (lib/hub-domains/write.ts logs it as claude.*); never its password. */
async function saveMailbox(w: Writer, args: Json): Promise<ToolResult> {
  const entry = await entryOf(w.db, args.customer_id, "customers");
  if (!entry) return refuse(noCustomer);
  let stored: StoredMailbox | null = null;
  if (args.mailbox_id !== undefined) {
    const found = isId(args.mailbox_id)
      ? await w.db.from("hub_customer_mailboxes").select("address, person, kind, target").eq("id", lower(args.mailbox_id)).eq("customer_id", entry.id).maybeSingle<StoredMailbox>()
      : null;
    if (!found?.data) return refuse("Diese Adresse gibt es bei diesem Kunden nicht. Nimm die mailbox_id aus get_contract.");
    stored = found.data;
  } else if (args.address === undefined) {
    return refuse("Für eine neue Adresse bitte address angeben, zum Beispiel info@kunde.de.");
  }
  const input = {
    id: stored ? lower(args.mailbox_id as string) : undefined,
    customerId: entry.id,
    address: pick(args, "address", stored?.address),
    kind: pick(args, "kind", stored?.kind ?? "mailbox"),
    person: pick(args, "person", stored?.person ?? ""),
    target: pick(args, "target", stored?.target ?? ""),
  };
  const checked = readMailbox(input);
  if (!checked.ok) return refuse(checked.error);
  const result = await saveMailboxAs({ db: w.db, actorId: w.userId, via: "claude" }, input);
  if (!result.ok) return refuse(result.error);
  const value = checked.value;
  return json({
    saved: true,
    created: !stored,
    mailbox_id: result.data.id,
    customer: { customer_id: entry.id, company: entry.company },
    mailbox: { address: value.address, kind: mailboxKinds[value.kind].label, person: value.person || null, target: value.target || null },
    note: "Passwörter von Postfächern stehen im Schlüsselbund und ändern sich nur im Hub.",
    link: contractLink(w, entry.id),
  });
}

/* ---------- Freelancers' shares ---------- */

type StoredShares = Record<`${ShareArea}_since`, string | null> & { note: string | null };

/**
 * What a freelancer sees of a customer they look after, as the tab „Freelancer“ switches it
 * (lib/hub-freelancer-customers/write.ts logs it as claude.* and tells the freelancer of a new release). Only areas
 * that change are written, so nobody hears of a release twice.
 */
async function setFreelancerAccess(w: Writer, args: Json): Promise<ToolResult> {
  const entry = await entryOf(w.db, args.customer_id, "customers");
  if (!entry) return refuse(noCustomer);
  if (!isId(args.freelancer_id)) return refuse("Bitte den Freelancer angeben (freelancer_id aus get_contract).");
  const freelancerId = lower(args.freelancer_id);
  if (args.areas !== undefined && (!args.areas || typeof args.areas !== "object" || Array.isArray(args.areas))) return refuse("areas nennt Bereiche mit true oder false.");
  const wanted = Object.entries((args.areas ?? {}) as Json);
  if (wanted.some(([area, on]) => !isShareArea(area) || typeof on !== "boolean")) return refuse("areas kennt domains, mail, packages und contact, jeweils mit true oder false.");
  if (args.note !== undefined && typeof args.note !== "string") return refuse("note ist ein Text; leer entfernt die Hinweise.");
  if (!wanted.length && args.note === undefined) return refuse("Bitte Bereiche (areas) oder Hinweise (note) angeben.");

  const [link, current, freelancer] = await Promise.all([
    w.db.from("hub_freelancer_customers").select("freelancer_id").eq("freelancer_id", freelancerId).eq("customer_id", entry.id).maybeSingle(),
    w.db.from("hub_freelancer_shares").select("domains_since, mail_since, packages_since, contact_since, note").eq("freelancer_id", freelancerId).eq("customer_id", entry.id).maybeSingle<StoredShares>(),
    w.db.from("hub_customers").select("company").eq("id", freelancerId).maybeSingle<{ company: string }>(),
  ]);
  // Without the current switches a release could be written (and announced) twice, so a failed read stops here.
  if (link.error || current.error) return refuse(failedRead);
  if (!link.data) return refuse("Dieser Freelancer betreut den Kunden nicht. Wer wen betreut, legt ein Admin im Hub fest; die freelancer_id steht in get_contract.");
  const ctx = { db: w.db, actorId: w.userId, via: "claude" as const };
  const changed: string[] = [];
  const now = { ...Object.fromEntries(shareAreaIds.map((area) => [area, Boolean(current.data?.[`${area}_since`])])) } as Record<ShareArea, boolean>;
  for (const [area, on] of wanted as [ShareArea, boolean][]) {
    if (now[area] === on) continue;
    const result = await setFreelancerShareAs(ctx, { customerId: entry.id, freelancerId, area, on });
    if (!result.ok) return refuse(changed.length ? `${result.error} Schon geändert: ${changed.join(", ")}.` : result.error);
    now[area] = on;
    changed.push(`${shareAreas[area].label} ${on ? "an" : "aus"}`);
  }
  let noteSaved = false;
  if (args.note !== undefined && cleanShareNote(args.note) !== (current.data?.note ?? "")) {
    const result = await saveFreelancerNoteAs(ctx, { customerId: entry.id, freelancerId, note: args.note });
    if (!result.ok) return refuse(changed.length ? `${result.error} Schon geändert: ${changed.join(", ")}.` : result.error);
    noteSaved = true;
  }
  return json({
    saved: changed.length > 0 || noteSaved,
    changed,
    hints_saved: noteSaved,
    freelancer: { freelancer_id: freelancerId, name: freelancer.data?.company ?? null },
    customer: { customer_id: entry.id, company: entry.company },
    sees: shareAreaIds.filter((area) => now[area]).map((area) => shareAreas[area].label),
    note: changed.length || noteSaved ? (changed.some((item) => item.endsWith(" an")) ? "Neue Freigaben meldet die Glocke des Freelancers." : undefined) : "Das steht schon so.",
    link: contractLink(w, entry.id),
  });
}
