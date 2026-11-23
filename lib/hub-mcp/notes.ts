import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { connectorClaims } from "@/lib/platform/auth";
import { createOwnClaimsClient } from "@/lib/platform/client";
import { appointmentStatuses, dayOf, formatDayShort, timeOf } from "@/lib/hub-calendar/rules";
import { isStatus, STATUS_NAMES } from "@/lib/hub-tasks/rules";
import { createMeetingNoteAs } from "@/lib/hub-notes/calendar";
import { noteHistoryAs, restoreRevisionAs, searchNotesAs } from "@/lib/hub-notes/history";
import { addToNote, markdownToNote, noteToMarkdown, taskNumbersIn, type MarkdownLabels } from "@/lib/hub-notes/markdown";
import {
  AUDIENCE_LABELS, audienceChoices, audienceLabel, childrenOf, cleanIcon, descendantsOf, gains, isIsoDate, isNoteAudience, isNoteWidth, isUuid, pathOf,
  validateNoteDoc, viewerEdits,
} from "@/lib/hub-notes/rules";
import { namesOf, notesCustomers, notesMissing, notesProjects, NOT_READY, readPage, readPages, toMeta, type NotesContext } from "@/lib/hub-notes/server";
import { noteTemplate } from "@/lib/hub-notes/templates";
import type { NoteDoc, NotePage, NotePageMeta, NotePatch, NoteResult, NoteSaved, NoteTemplateId } from "@/lib/hub-notes/types";
import { createPageAs, logNoteEvent, notifyChangeAs, restorePageAs, savePageAs, setAudienceAs, trashPageAs } from "@/lib/hub-notes/write";
import type { ToolResult } from "./protocol";
import type { Connection } from "./store";

// The notes tools of the connector (lib/hub-mcp/notes-tools.ts). Every read and write goes through the notes' own code
// (lib/hub-notes) with a session carrying the connected person's claims (lib/platform/auth.ts connectorClaims, aal2,
// no session row), so the rules and the guard of hub_note_pages decide exactly as in the hub: admins everything but
// archived customers, freelancers the pages released to them and writing only „Nur Freelancer“. The server key goes
// only where the notes' code passes it in the hub as well (names, project names, the admin log, notices). Changes are
// logged as `claude.note.*`; nothing here deletes for good (the trash keeps a page 30 days).

type Json = Record<string, unknown>;
type Customer = NonNullable<Awaited<ReturnType<typeof notesCustomers>>>[number];
type Run = { ctx: NotesContext; origin: string; args: Json };

const json = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const refuse = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });
const LOAD_ERROR = "Die Notizen konnten gerade nicht geladen werden. Bitte versuche es erneut.";
const TRASH_DAYS = 30;
const MAX_LISTED = 300;
const MAX_REVISION_TEXT = 1500;

const pageLink = (origin: string, id: string) => `${origin}/dashboard/projects/notes?page=${id}`;
const lower = (value: string) => value.toLowerCase();
const noPage = (ctx: NotesContext) => ctx.viewer === "admin"
  ? "Diese Seite gibt es nicht (mehr). Nimm die ID aus list_notes oder search_notes."
  : "Diese Seite gibt es nicht (mehr), oder sie ist nicht für dich freigegeben. Nimm die ID aus list_notes oder search_notes.";

/** Runs one notes tool for a checked connection (lib/hub-mcp/server.ts and freelancer.ts check the right first). */
export async function runNotesTool(connection: Connection, name: string, args: Json, origin: string): Promise<ToolResult> {
  const claims = await connectorClaims(connection.userId).catch(() => null);
  if (!claims) return refuse("Der Hub kann gerade nicht lesen. Bitte versuche es gleich noch einmal.");
  const ctx: NotesContext = {
    viewer: connection.role === "admin" ? "admin" : "freelancer",
    userId: connection.userId,
    session: createOwnClaimsClient(claims) as unknown as SupabaseClient,
    db: createAdminClient(),
    via: "claude",
  };
  const run: Run = { ctx, origin, args };
  try {
    switch (name) {
      case "list_notes": return await listNotes(run);
      case "read_note": return await readNote(run);
      case "search_notes": return await searchNotes(run);
      case "get_note_history": return await noteHistory(run);
      case "list_note_trash": return await listTrash(run);
      case "create_note": return await createNote(run);
      case "update_note": return await updateNote(run);
      case "set_note_visibility": return await setVisibility(run);
      case "notify_note_change": return await notifyChange(run);
      case "create_meeting_note": return await createMeetingNote(run);
      case "trash_note": return await trashNote(run);
      case "restore_note": return await restoreNote(run);
      case "restore_note_version": return await restoreVersion(run);
      default: return refuse("Dieses Werkzeug gibt es nicht.");
    }
  } catch (error) {
    console.error("[hub-mcp] notes failed", name, error instanceof Error ? error.message : "unknown");
    return refuse("Das hat gerade nicht geklappt. Sieh bei einer Änderung im Hub nach, ob sie schon gespeichert ist, und versuche es erneut.");
  }
}

/* ---------- Who and what ---------- */

/** A customer whose notes the person may open (admins: every customer but archived ones; freelancers: theirs). */
async function customerFor(ctx: NotesContext, customerId: unknown): Promise<{ ok: true; customer: Customer } | { ok: false; error: string }> {
  if (!isUuid(customerId)) return { ok: false, error: "Bitte den Kunden angeben (customer_id aus search)." };
  const customers = await notesCustomers(ctx);
  if (!customers) return { ok: false, error: LOAD_ERROR };
  const customer = customers.find((item) => lower(item.id) === lower(customerId));
  if (!customer) return { ok: false, error: ctx.viewer === "admin" ? "Diesen Kunden gibt es nicht oder er ist archiviert. Nimm die ID aus search." : "Diesen Kunden betreust du nicht. Nimm die ID aus search." };
  return { ok: true, customer };
}

/** A page the person sees, at a customer they may open. */
async function pageFor(ctx: NotesContext, pageId: unknown, withRefs: boolean): Promise<{ ok: true; page: NotePage; customer: Customer } | { ok: false; error: string }> {
  if (!isUuid(pageId)) return { ok: false, error: "Bitte die Seite angeben (page_id aus list_notes)." };
  const page = await readPage(ctx, lower(pageId), withRefs);
  if (!page) return { ok: false, error: noPage(ctx) };
  const found = await customerFor(ctx, page.customerId);
  return found.ok ? { ok: true, page, customer: found.customer } : { ok: false, error: noPage(ctx) };
}

/** Pages in the order of the hub's tree: each page, then its subpages; pages under a hidden page stand at the top. */
function treeOrder(pages: readonly NotePageMeta[]): { page: NotePageMeta; level: number }[] {
  const out: { page: NotePageMeta; level: number }[] = [];
  const ids = new Set(pages.map((page) => page.id));
  const walk = (parentId: string, level: number) => {
    if (level > 8) return;
    for (const page of childrenOf(pages, parentId)) {
      out.push({ page, level });
      walk(page.id, level + 1);
    }
  };
  const roots = pages.filter((page) => !page.parentId || !ids.has(page.parentId)).sort((a, b) => a.position - b.position || a.title.localeCompare(b.title, "de"));
  for (const root of roots) {
    out.push({ page: root, level: 1 });
    walk(root.id, 2);
  }
  return out;
}

const whenOf = (start: string, end: string) => {
  const from = Date.parse(start);
  const to = Date.parse(end);
  return Number.isNaN(from) ? "" : `${formatDayShort(dayOf(from))}, ${timeOf(from)}–${Number.isNaN(to) ? "" : timeOf(to)}`;
};

/** What the Markdown says about the blocks of a page: task, project and appointment states, page titles. */
function labelsOf(page: NotePage, pages: readonly NotePageMeta[]): MarkdownLabels {
  const refs = page.refs;
  const byId = <T, R>(record: Record<string, T | null> | undefined, map: (value: T) => R) =>
    Object.fromEntries(Object.entries(record ?? {}).map(([id, value]) => [lower(id), value ? map(value) : null]));
  return {
    pages: Object.fromEntries(pages.map((item) => [lower(item.id), item.title])),
    tasks: byId(refs?.tasks, (task) => ({ number: task.number, title: task.title, status: isStatus(task.status) ? STATUS_NAMES[task.status] : task.status })),
    projects: byId(refs?.projects, (project) => ({ name: project.name, status: project.status })),
    appointments: byId(refs?.appointments, (item) => ({ title: item.title, when: whenOf(item.start, item.end), status: appointmentStatuses[item.status] })),
  };
}

/**
 * Markdown as the page's document: tasks named by project and number are looked up first (in the customer's projects
 * the person sees), and every block that is new on the page must belong to this customer and be visible to the person.
 */
async function documentOf(run: Run, customer: Customer, markdown: string, before: NoteDoc | null): Promise<{ ok: true; doc: NoteDoc } | { ok: false; error: string }> {
  const { ctx } = run;
  const projects = await notesProjects(ctx, customer);
  const projectIds = new Set(projects.map((project) => lower(project.id)));
  const reader = ctx.viewer === "admin" && ctx.db ? ctx.db : ctx.session;
  const found = new Map<string, { id: string; number: number }>();
  const wanted = new Map<string, number[]>();
  for (const item of taskNumbersIn(markdown)) {
    if (projectIds.has(item.projectId)) wanted.set(item.projectId, [...(wanted.get(item.projectId) ?? []), item.number]);
  }
  for (const [projectId, numbers] of wanted) {
    const { data } = await reader.from("studio_tasks").select("id, task_number").eq("project_id", projectId).in("task_number", numbers).eq("archived", false)
      .returns<{ id: string; task_number: number }[]>();
    for (const row of data ?? []) found.set(`${projectId}/${row.task_number}`, { id: lower(row.id), number: Number(row.task_number) });
  }
  const parsed = markdownToNote(markdown, { before, origin: run.origin, task: (projectId, number) => found.get(`${projectId}/${number}`) ?? null });
  if (!parsed.ok) return parsed;
  const problem = await foreignBlocks(ctx, customer, parsed.doc, before, projectIds);
  return problem ? { ok: false, error: problem } : parsed;
}

/** Blocks new on the page that belong to another customer or that the person does not see; null when there are none. */
async function foreignBlocks(ctx: NotesContext, customer: Customer, doc: NoteDoc, before: NoteDoc | null, projectIds: Set<string>): Promise<string | null> {
  const now = validateNoteDoc(doc);
  if (!now.ok) return now.error;
  const old = before ? validateNoteDoc(before) : null;
  const known = new Set(old?.ok ? old.refs.map((ref) => `${ref.kind}:${lower(ref.id)}`) : []);
  const fresh = now.refs.filter((ref) => !known.has(`${ref.kind}:${lower(ref.id)}`));
  if (!fresh.length) return null;
  const idsOf = (kind: string) => fresh.filter((ref) => ref.kind === kind).map((ref) => lower(ref.id));
  const problems: string[] = [];
  for (const id of idsOf("project")) if (!projectIds.has(id)) problems.push(`Projekt ${id}`);

  const tasks = idsOf("task");
  if (tasks.length) {
    const reader = ctx.viewer === "admin" && ctx.db ? ctx.db : ctx.session;
    const { data } = await reader.from("studio_tasks").select("id, project_id").in("id", tasks).eq("archived", false).returns<{ id: string; project_id: string }[]>();
    const seen = new Set((data ?? []).filter((row) => projectIds.has(lower(row.project_id))).map((row) => lower(row.id)));
    for (const id of tasks) if (!seen.has(id)) problems.push(`Aufgabe ${id}`);
  }
  const appointments = idsOf("appointment");
  if (appointments.length) {
    const { data } = await ctx.session.from("hub_appointments").select("id, customer_id").in("id", appointments).returns<{ id: string; customer_id: string | null }[]>();
    const seen = new Set((data ?? []).filter((row) => row.customer_id && lower(row.customer_id) === lower(customer.id)).map((row) => lower(row.id)));
    for (const id of appointments) if (!seen.has(id)) problems.push(`Termin ${id}`);
  }
  const pages = idsOf("page");
  if (pages.length) {
    const { data } = await ctx.session.from("hub_note_pages").select("id, customer_id").in("id", pages).is("deleted_at", null).returns<{ id: string; customer_id: string }[]>();
    const seen = new Set((data ?? []).filter((row) => lower(row.customer_id) === lower(customer.id)).map((row) => lower(row.id)));
    for (const id of pages) if (!seen.has(id)) problems.push(`Seite ${id}`);
  }
  return problems.length
    ? `Diese Blöcke gehören nicht zu ${customer.name} oder sind nicht sichtbar: ${problems.join(", ")}. Nimm IDs aus list_notes, get_project, list_tasks oder list_appointments.`
    : null;
}

const pageJson = (run: Run, page: Pick<NotePageMeta, "id" | "title" | "icon"> & Partial<NotePageMeta>, customer: Customer, extra: Json = {}) => ({
  page_id: page.id,
  title: page.title,
  icon: page.icon || null,
  ...(page.audience ? { visibility: audienceLabel(page.audience, customer.hasFreelancer) } : {}),
  ...extra,
  link: pageLink(run.origin, page.id),
});

/* ---------- Reading ---------- */

async function listNotes(run: Run): Promise<ToolResult> {
  const { ctx, args } = run;
  const found = await customerFor(ctx, args.customer_id);
  if (!found.ok) return refuse(found.error);
  const { customer } = found;
  if (args.project_id !== undefined && !isUuid(args.project_id)) return refuse("project_id muss eine ID aus list_notes sein.");
  const [pages, projects] = await Promise.all([readPages(ctx, customer.id), notesProjects(ctx, customer)]);
  if (pages.error) return refuse(notesMissing(pages.error) ? NOT_READY : LOAD_ERROR);
  const metas = (pages.data ?? []).map(toMeta);
  const people = await namesOf(ctx, metas.map((page) => page.updatedBy));
  const projectName = new Map(projects.map((project) => [lower(project.id), project.name]));
  const only = typeof args.project_id === "string" ? lower(args.project_id) : null;
  const ordered = treeOrder(metas).filter(({ page }) => !only || (page.projectId && lower(page.projectId) === only));
  return json({
    customer: { customer_id: customer.id, company: customer.name, customer_number: customer.number },
    ...(ctx.viewer === "admin" ? { visibility_choices: audienceChoices(customer.hasFreelancer).map((audience) => ({ audience, label: audienceLabel(audience, customer.hasFreelancer) })) } : {}),
    projects: projects.map((project) => ({ project_id: project.id, name: project.name })),
    total: ordered.length,
    shown: Math.min(ordered.length, MAX_LISTED),
    pages: ordered.slice(0, MAX_LISTED).map(({ page, level }) => pageJson(run, page, customer, {
      level,
      parent_id: page.parentId,
      project: page.projectId ? projectName.get(lower(page.projectId)) ?? "nicht sichtbar" : "Allgemein",
      dated_on: page.datedOn,
      meeting_note: Boolean(page.appointmentId),
      updated_at: page.updatedAt,
      updated_by: page.updatedBy ? people[page.updatedBy] ?? null : null,
      subpages: metas.filter((item) => item.parentId === page.id).length,
      can_edit: viewerEdits(ctx.viewer, page.audience),
    })),
    link: `${run.origin}/dashboard/projects/notes?customer=${customer.id}`,
    note: ordered.length ? undefined : only ? "Zu diesem Projekt gibt es noch keine Notizseiten." : "Bei diesem Kunden gibt es noch keine Notizseiten, die du sehen kannst.",
  });
}

async function readNote(run: Run): Promise<ToolResult> {
  const { ctx } = run;
  const loaded = await pageFor(ctx, run.args.page_id, true);
  if (!loaded.ok) return refuse(loaded.error);
  const { page, customer } = loaded;
  const [pages, projects, names] = await Promise.all([readPages(ctx, page.customerId), notesProjects(ctx, customer), namesOf(ctx, [page.updatedBy])]);
  const metas = (pages.data ?? []).map(toMeta);
  const parent = page.parentId ? metas.find((item) => item.id === page.parentId) : undefined;
  const project = page.projectId ? projects.find((item) => lower(item.id) === lower(page.projectId!)) : undefined;
  return json(pageJson(run, page, customer, {
    customer: { customer_id: customer.id, company: customer.name, customer_number: customer.number },
    project: page.projectId ? { project_id: page.projectId, name: project?.name ?? "nicht sichtbar" } : null,
    path: pathOf(metas, page.id).map((item) => item.title),
    parent: parent ? { page_id: parent.id, title: parent.title } : null,
    audience: page.audience,
    dated_on: page.datedOn,
    width: page.width,
    appointment_id: page.appointmentId,
    version: page.version,
    updated_at: page.updatedAt,
    updated_by: page.updatedBy ? names[page.updatedBy] ?? null : null,
    can_edit: viewerEdits(ctx.viewer, page.audience),
    subpages: childrenOf(metas, page.id).map((item) => ({ page_id: item.id, title: item.title, icon: item.icon || null })),
    content_markdown: noteToMarkdown(page.content, labelsOf(page, metas)),
  }));
}

async function searchNotes(run: Run): Promise<ToolResult> {
  const query = typeof run.args.query === "string" ? run.args.query.trim() : "";
  if (query.length < 2) return refuse("Bitte mindestens 2 Zeichen suchen.");
  const result = await searchNotesAs(run.ctx, { query });
  if (!result.ok) return refuse(result.error);
  return json({
    query,
    hits: result.data.map((hit) => ({ page_id: hit.id, title: hit.title, icon: hit.icon || null, customer_id: hit.customerId, customer: hit.customer, snippet: hit.snippet, link: pageLink(run.origin, hit.id) })),
    note: result.data.length ? undefined : "Keine Notizseite enthält diesen Begriff (in dem, was du sehen kannst).",
  });
}

const REASONS: Record<string, string> = { edit: "Bearbeitung", audience: "„Sichtbar für“ geändert", restore: "vor einer Wiederherstellung" };

async function noteHistory(run: Run): Promise<ToolResult> {
  const loaded = await pageFor(run.ctx, run.args.page_id, false);
  if (!loaded.ok) return refuse(loaded.error);
  const { page, customer } = loaded;
  const result = await noteHistoryAs(run.ctx, { pageId: page.id });
  if (!result.ok) return refuse(result.error);
  return json(pageJson(run, page, customer, {
    current_version: page.version,
    revisions: result.data.map((item) => ({
      revision_id: item.id,
      version: item.version,
      title: item.title,
      reason: REASONS[item.reason] ?? item.reason,
      visibility: AUDIENCE_LABELS[item.audience],
      saved_by: item.savedBy,
      saved_at: item.savedAt,
      text: item.text.length > MAX_REVISION_TEXT ? `${item.text.slice(0, MAX_REVISION_TEXT)} …` : item.text,
    })),
    note: result.data.length ? undefined : "Für diese Seite ist noch keine frühere Fassung aufgehoben.",
  }));
}

/** The trash as the hub shows it, but without tidying: pages older than 30 days go when the team opens it in the hub. */
async function listTrash(run: Run): Promise<ToolResult> {
  const { ctx } = run;
  const found = await customerFor(ctx, run.args.customer_id);
  if (!found.ok) return refuse(found.error);
  const since = new Date(Date.now() - TRASH_DAYS * 86_400_000).toISOString();
  const { data, error } = await ctx.session.from("hub_note_pages").select("id, title, icon, deleted_at, deleted_by, parent_id").eq("customer_id", found.customer.id)
    .not("deleted_at", "is", null).gte("deleted_at", since).order("deleted_at", { ascending: false })
    .returns<{ id: string; title: string; icon: string; deleted_at: string; deleted_by: string | null; parent_id: string | null }[]>();
  if (error) return refuse(notesMissing(error) ? NOT_READY : "Der Papierkorb konnte gerade nicht geladen werden.");
  const rows = data ?? [];
  const trashed = new Map(rows.map((row) => [row.id, row]));
  const tops = rows.filter((row) => !row.parent_id || trashed.get(row.parent_id)?.deleted_at !== row.deleted_at);
  const names = await namesOf(ctx, tops.map((row) => row.deleted_by));
  return json({
    customer: { customer_id: found.customer.id, company: found.customer.name },
    pages: tops.map((row) => ({
      page_id: row.id,
      title: row.title,
      icon: row.icon || null,
      deleted_at: row.deleted_at,
      deleted_by: row.deleted_by ? names[row.deleted_by] ?? null : null,
      subpages: rows.filter((item) => item.parent_id === row.id && item.deleted_at === row.deleted_at).length,
      days_left: Math.max(0, TRASH_DAYS - Math.floor((Date.now() - Date.parse(row.deleted_at)) / 86_400_000)),
    })),
    note: tops.length ? undefined : "Der Papierkorb dieses Kunden ist leer.",
  });
}

/* ---------- Writing ---------- */

const TEMPLATES: readonly NoteTemplateId[] = ["meeting", "briefing", "acceptance"];

async function createNote(run: Run): Promise<ToolResult> {
  const { ctx, args } = run;
  const found = await customerFor(ctx, args.customer_id);
  if (!found.ok) return refuse(found.error);
  const { customer } = found;
  if (typeof args.title !== "string") return refuse("Bitte einen Titel angeben.");
  if (args.content !== undefined && args.template !== undefined) return refuse("Gib entweder content oder template an, nicht beides.");
  if (args.content !== undefined && typeof args.content !== "string") return refuse("content muss Markdown-Text sein.");
  if (args.template !== undefined && !TEMPLATES.includes(args.template as NoteTemplateId)) return refuse("template ist meeting, briefing oder acceptance.");
  if (args.icon !== undefined && (typeof args.icon !== "string" || cleanIcon(args.icon) === null)) return refuse("Als Symbol geht ein Emoji.");
  if (args.dated_on !== undefined && !isIsoDate(args.dated_on)) return refuse("dated_on muss ein Tag als JJJJ-MM-TT sein.");
  if (args.parent_id !== undefined && !isUuid(args.parent_id)) return refuse("parent_id muss eine ID aus list_notes sein.");
  let projectId: string | null = null;
  if (args.project_id !== undefined) {
    if (!isUuid(args.project_id)) return refuse("project_id muss eine ID aus list_notes sein.");
    const projects = await notesProjects(ctx, customer);
    if (!projects.some((project) => lower(project.id) === lower(args.project_id as string))) return refuse(`Dieses Projekt gehört nicht zu ${customer.name}, oder du siehst es nicht. Nimm eine ID aus list_notes.`);
    projectId = lower(args.project_id);
  }
  const datedOn = typeof args.dated_on === "string" ? args.dated_on : null;
  let content: NoteDoc | undefined;
  let icon = typeof args.icon === "string" ? args.icon : undefined;
  if (args.template !== undefined) {
    const template = noteTemplate(args.template as NoteTemplateId, { title: args.title, date: datedOn });
    content = template.doc;
    icon ??= template.icon;
  } else if (typeof args.content === "string" && args.content.trim()) {
    const doc = await documentOf(run, customer, args.content, null);
    if (!doc.ok) return refuse(doc.error);
    content = doc.doc;
  }
  const created = await createPageAs(ctx, {
    customerId: customer.id, projectId, parentId: typeof args.parent_id === "string" ? lower(args.parent_id) : null, title: args.title, icon, content, datedOn,
  });
  if (!created.ok) return refuse(created.error);
  const page = created.data;
  const visibility = audienceLabel(page.audience, customer.hasFreelancer);
  return json({
    saved: true,
    message: `Die Seite „${page.title}“ ist bei ${customer.name} angelegt. Sichtbar für: ${visibility}.`,
    page: pageJson(run, page, customer, { version: page.version, parent_id: page.parentId, project_id: page.projectId, dated_on: page.datedOn }),
    ...(ctx.viewer === "admin" && page.audience === "team" ? { next: "Für den Kunden oder Freelancer freigeben: set_note_visibility." } : {}),
  });
}

const MODES = ["replace", "append", "prepend"] as const;
type Mode = (typeof MODES)[number];

async function staleText(ctx: NotesContext, current: Pick<NotePageMeta, "version" | "updatedBy">) {
  const names = await namesOf(ctx, [current.updatedBy]);
  const who = current.updatedBy && current.updatedBy !== ctx.userId ? names[current.updatedBy] : null;
  return `Die Seite wurde inzwischen geändert${who ? ` (zuletzt von ${who})` : ""} und hat jetzt Version ${current.version}. Lies sie mit read_note neu und übertrage deine Änderung darauf; überschrieben wurde nichts.`;
}

async function updateNote(run: Run): Promise<ToolResult> {
  const { ctx, args } = run;
  const loaded = await pageFor(ctx, args.page_id, false);
  if (!loaded.ok) return refuse(loaded.error);
  const { page, customer } = loaded;
  if (!viewerEdits(ctx.viewer, page.audience)) return refuse("Diese Seite kannst du nur lesen: Freelancer ändern nur ihre „Nur Freelancer“-Seiten.");

  const patch: NotePatch = {};
  if (args.title !== undefined) {
    if (typeof args.title !== "string") return refuse("title muss Text sein.");
    patch.title = args.title;
  }
  if (args.icon !== undefined) {
    if (typeof args.icon !== "string" || cleanIcon(args.icon) === null) return refuse("Als Symbol geht ein Emoji; leer nimmt es weg.");
    patch.icon = args.icon;
  }
  if (args.dated_on !== undefined) {
    if (args.dated_on !== null && !isIsoDate(args.dated_on)) return refuse("dated_on ist ein Tag als JJJJ-MM-TT oder null.");
    patch.datedOn = args.dated_on as string | null;
  }
  if (args.width !== undefined) {
    if (!isNoteWidth(args.width)) return refuse("width ist normal oder wide.");
    patch.width = args.width;
  }
  if (args.project_id !== undefined) {
    if (args.project_id !== null) {
      if (!isUuid(args.project_id)) return refuse("project_id ist eine ID aus list_notes oder null.");
      const projects = await notesProjects(ctx, customer);
      if (!projects.some((project) => lower(project.id) === lower(args.project_id as string))) return refuse(`Dieses Projekt gehört nicht zu ${customer.name}, oder du siehst es nicht. Nimm eine ID aus list_notes.`);
    }
    patch.projectId = typeof args.project_id === "string" ? lower(args.project_id) : null;
  }
  const mode = (args.content_mode ?? "replace") as Mode;
  if (!MODES.includes(mode)) return refuse("content_mode ist replace, append oder prepend.");
  if (args.content !== undefined && typeof args.content !== "string") return refuse("content muss Markdown-Text sein.");
  const explicit = args.version !== undefined;
  if (explicit && !Number.isInteger(args.version)) return refuse("version ist die Zahl aus read_note.");
  if (typeof args.content === "string" && mode === "replace" && !explicit) {
    return refuse("Zum Ersetzen des Inhalts brauche ich version aus read_note, damit nichts verloren geht, was inzwischen jemand geschrieben hat. Zum Ergänzen nimm content_mode append oder prepend.");
  }
  if (explicit && args.version !== page.version) return refuse(await staleText(ctx, page));
  if (args.content === undefined && !Object.keys(patch).length) return refuse("Es gibt nichts zu ändern.");

  const attempt = async (current: NotePage): Promise<NoteResult<NoteSaved>> => {
    const next: NotePatch = { ...patch };
    if (typeof args.content === "string") {
      const doc = await documentOf(run, customer, args.content, current.content);
      if (!doc.ok) return { ok: false, error: doc.error };
      next.content = mode === "replace" ? doc.doc : addToNote(current.content, doc.doc, mode === "append" ? "end" : "start");
    }
    return savePageAs(ctx, { id: current.id, version: current.version, patch: next });
  };
  let result = await attempt(page);
  // Adding to a page or changing its fields goes on once on the newer page; replacing the content never does.
  if (!result.ok && result.stale && !explicit) {
    const fresh = await readPage(ctx, page.id, false);
    if (fresh) result = await attempt(fresh);
  }
  if (!result.ok) return refuse(result.stale && result.current ? await staleText(ctx, result.current) : result.error);
  await logNoteEvent(ctx, "note.updated", "Notiz geändert", page.customerId);
  const title = patch.title?.replace(/\s+/g, " ").trim() || page.title;
  return json({
    saved: true,
    message: `„${title}“ ist gespeichert.${typeof args.content === "string" && mode !== "replace" ? mode === "append" ? " Der Text steht am Ende der Seite." : " Der Text steht am Anfang der Seite." : ""}`,
    page: pageJson(run, { id: page.id, title, icon: patch.icon ?? page.icon, audience: page.audience }, customer, { version: result.data.version, updated_at: result.data.updatedAt }),
  });
}

async function setVisibility(run: Run): Promise<ToolResult> {
  const { ctx, args } = run;
  const loaded = await pageFor(ctx, args.page_id, false);
  if (!loaded.ok) return refuse(loaded.error);
  const { page, customer } = loaded;
  if (!isNoteAudience(args.audience)) return refuse("audience ist team, both, customer oder freelancer.");
  if (args.notify !== undefined && typeof args.notify !== "boolean") return refuse("notify ist true oder false.");
  const audience = args.audience;
  const label = audienceLabel(audience, customer.hasFreelancer);
  if (page.audience === audience) return json({ saved: false, message: `„${page.title}“ ist schon „${label}“.`, page: pageJson(run, page, customer) });
  const notify = args.notify !== false;
  const result = await setAudienceAs(ctx, { id: page.id, audience, notify });
  if (!result.ok) return refuse(result.error);
  const gained = gains(page.audience, audience);
  const told = notify && (gained.customer || gained.freelancer);
  const narrowed = result.data.narrowed;
  return json({
    saved: true,
    message: `„${page.title}“ ist jetzt „${label}“.${narrowed ? ` ${narrowed === 1 ? "Eine Unterseite ist" : `${narrowed} Unterseiten sind`} mit eingeschränkt.` : ""}${told ? ` ${gained.customer && gained.freelancer ? "Kunde und Freelancer bekommen" : gained.customer ? "Der Kunde bekommt" : "Die Freelancer bekommen"} eine Meldung.` : ""}`,
    page: pageJson(run, { ...page, audience }, customer),
  });
}

async function notifyChange(run: Run): Promise<ToolResult> {
  const loaded = await pageFor(run.ctx, run.args.page_id, false);
  if (!loaded.ok) return refuse(loaded.error);
  const { page, customer } = loaded;
  const result = await notifyChangeAs(run.ctx, { id: page.id });
  if (!result.ok) return refuse(result.error);
  const to = gains("team", page.audience);
  return json({
    saved: true,
    message: `${to.customer && to.freelancer ? "Kunde und Freelancer bekommen" : to.customer ? "Der Kunde bekommt" : "Die Freelancer bekommen"} eine Meldung, dass sich „${page.title}“ geändert hat.`,
    page: pageJson(run, page, customer),
  });
}

async function createMeetingNote(run: Run): Promise<ToolResult> {
  const { ctx, args } = run;
  if (!isUuid(args.appointment_id)) return refuse("Bitte den Termin angeben (appointment_id aus list_appointments).");
  if (args.content !== undefined && typeof args.content !== "string") return refuse("content muss Markdown-Text sein.");
  const result = await createMeetingNoteAs(ctx, { appointmentId: lower(args.appointment_id) });
  if (!result.ok) return refuse(result.error);
  const loaded = await pageFor(ctx, result.data.id, false);
  if (!loaded.ok) return refuse(loaded.error);
  const { page, customer } = loaded;
  if (!result.data.created) {
    return json({ saved: false, message: `Zu diesem Termin gibt es schon die Besprechungsnotiz „${page.title}“. Ändern geht mit update_note.`, page: pageJson(run, page, customer, { version: page.version }) });
  }
  let version = page.version;
  if (typeof args.content === "string" && args.content.trim()) {
    const doc = await documentOf(run, customer, args.content, page.content);
    const saved = doc.ok ? await savePageAs(ctx, { id: page.id, version: page.version, patch: { content: doc.doc } }) : null;
    if (!doc.ok || !saved?.ok) {
      const why = !doc.ok ? doc.error : saved && !saved.ok ? saved.error : "";
      return refuse(`Die Besprechungsnotiz „${page.title}“ ist angelegt (mit der Vorlage), dein Inhalt aber nicht: ${why} Seite: ${pageLink(run.origin, page.id)}`);
    }
    version = saved.data.version;
  }
  return json({
    saved: true,
    message: `Die Besprechungsnotiz „${page.title}“ ist angelegt (Nur Team) und hängt am Termin.`,
    page: pageJson(run, page, customer, { version, dated_on: page.datedOn }),
  });
}

async function trashNote(run: Run): Promise<ToolResult> {
  const { ctx } = run;
  const loaded = await pageFor(ctx, run.args.page_id, false);
  if (!loaded.ok) return refuse(loaded.error);
  const { page, customer } = loaded;
  const pages = await readPages(ctx, page.customerId);
  const below = descendantsOf((pages.data ?? []).map(toMeta), page.id).length;
  const result = await trashPageAs(ctx, { id: page.id });
  if (!result.ok) return refuse(result.error);
  return json({
    saved: true,
    message: `„${page.title}“${below ? ` mit ${below === 1 ? "einer Unterseite" : `${below} Unterseiten`}` : ""} liegt im Papierkorb und lässt sich 30 Tage lang wiederherstellen (restore_note).`,
    page: { page_id: page.id, title: page.title, customer: customer.name },
  });
}

async function restoreNote(run: Run): Promise<ToolResult> {
  const { ctx, args } = run;
  if (!isUuid(args.page_id)) return refuse("Bitte die Seite angeben (page_id aus list_note_trash).");
  const { data: row } = await ctx.session.from("hub_note_pages").select("id, title, icon, customer_id, deleted_at").eq("id", lower(args.page_id))
    .maybeSingle<{ id: string; title: string; icon: string; customer_id: string; deleted_at: string | null }>();
  if (!row?.deleted_at) return refuse("Diese Seite liegt nicht im Papierkorb. Nimm die ID aus list_note_trash.");
  const found = await customerFor(ctx, row.customer_id);
  if (!found.ok) return refuse(noPage(ctx));
  const result = await restorePageAs(ctx, { id: row.id });
  if (!result.ok) return refuse(result.error);
  return json({ saved: true, message: `„${row.title}“ ist wiederhergestellt.`, page: pageJson(run, row, found.customer) });
}

async function restoreVersion(run: Run): Promise<ToolResult> {
  const { ctx, args } = run;
  if (!isUuid(args.revision_id)) return refuse("Bitte die Fassung angeben (revision_id aus get_note_history).");
  if (!Number.isInteger(args.version)) return refuse("version ist die aktuelle Version der Seite aus read_note.");
  const revision = await ctx.session.from("hub_note_revisions").select("page_id, version").eq("id", lower(args.revision_id)).maybeSingle<{ page_id: string; version: number }>();
  if (!revision.data) return refuse("Diese Fassung gibt es nicht (mehr). Nimm die ID aus get_note_history.");
  const loaded = await pageFor(ctx, revision.data.page_id, false);
  if (!loaded.ok) return refuse(loaded.error);
  const { customer } = loaded;
  const result = await restoreRevisionAs(ctx, { revisionId: lower(args.revision_id), version: args.version as number });
  if (!result.ok) return refuse(result.error);
  return json({
    saved: true,
    message: `„${result.data.title}“ hat wieder den Stand von Version ${revision.data.version}. Der Stand davor liegt im Verlauf.`,
    page: pageJson(run, result.data, customer, { version: result.data.version }),
  });
}
