import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyHubAdmin, verifyHubFreelancer } from "@/lib/hub-users/server";
import { loadArchive } from "@/lib/hub-archive/server";
import { loadCustomerLogos, signCustomerLogos } from "@/lib/hub-logos/server";
import type { CustomerLogo } from "@/lib/hub-logos/rules";
import { loadFreelancerCustomerList } from "@/lib/hub-freelancer-customers/list";
import { loadLiveProjects } from "@/lib/hub-projects/server";
import { HUB_FILES_BUCKET } from "@/lib/hub-files/catalog";
import { notePageHref } from "@/lib/hub-notify/rules";
import { loadTeamNotesEntry } from "@/lib/hub-team/server";
import { cleanCoverPosition, isGalleryCover } from "./covers";
import { ownImages, refsIn, resolveRefs } from "./refs";
import { childrenOf, emptyNoteDoc, fitRights, isNoteAudience, isNoteWidth, isUuid } from "./rules";
import { NO_REFS, type NoteCover, type NoteCustomer, type NoteDoc, type NotePage, type NotePageMeta, type NoteProject, type NoteReaders, type NotesArea, type NoteSettings, type NotesCustomerView, type NoteTemplateId, type NoteViewer } from "./types";

// Notes (plan docs/planung/notizen.md) are read with the person's *own* session: the rules of hub_note_pages decide
// (migration 202611221001 in service-oalab). Admins pass the user management's check (hub role, second factor,
// is_hub_admin()), freelancers the board's (active, confirmed code), customers need an active profile. Only names come
// with the server key: of the customers' projects for admins, of a freelancer's own projects, and of the people who last
// edited a page (never for customers, who only learn that oalab shared a page). Without the migration the page says
// that notes are not set up yet instead of failing.

export const NOTES_CUSTOMER_COOKIE = "oalab-notes-customer";
export const PAGE_COLUMNS = "id, customer_id, project_id, parent_id, appointment_id, title, icon, cover_kind, cover_value, cover_position, width, audience, customer_edits, freelancer_edits, outside_edited_at, dated_on, position, version, updated_by, updated_at, created_at";

export type PageRow = {
  id: string;
  customer_id: string;
  project_id: string | null;
  parent_id: string | null;
  appointment_id: string | null;
  title: string;
  icon: string;
  cover_kind: string | null;
  cover_value: string | null;
  cover_position: number;
  width: string;
  audience: string;
  customer_edits?: boolean | null;
  freelancer_edits?: boolean | null;
  outside_edited_at?: string | null;
  dated_on: string | null;
  position: number;
  version: number;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
  content?: unknown;
};

/**
 * Who works on notes, with which session. `via: "claude"` is the Claude connector (lib/hub-mcp/notes.ts): its session
 * carries the person's claims without a browser, so nothing is signed for display (logos, covers), and the admin log
 * says that the change came through Claude.
 */
export type NotesContext = { viewer: NoteViewer; userId: string; session: SupabaseClient; db: SupabaseClient | null; via?: "claude" };

/** The table or a column of the notes migration is missing. */
export const notesMissing = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST200" || error.code === "42703" || /hub_note/i.test(error.message ?? "")));

export const NOT_READY = "Notizen sind noch nicht eingerichtet: Die Datenbank kennt sie noch nicht.";
const LOAD_ERROR = "Die Notizen konnten gerade nicht geladen werden. Bitte versuche es erneut.";

export const DEFAULT_SETTINGS: NoteSettings = { defaultAudience: "team", notifyOnShare: true, groupByProject: true, meetingTemplate: "meeting", defaultWidth: "normal", customerAccess: "edit" };
const templates: readonly NoteTemplateId[] = ["meeting", "briefing", "acceptance", "blank"];

type SettingsRow = { default_audience: string; notify_on_share: boolean; group_by_project: boolean; meeting_template: string; default_width: string; customer_access?: string | null };
export const SETTINGS_COLUMNS = "default_audience, notify_on_share, group_by_project, meeting_template, default_width, customer_access";

export function toSettings(row: SettingsRow | null | undefined): NoteSettings {
  if (!row) return DEFAULT_SETTINGS;
  return {
    defaultAudience: isNoteAudience(row.default_audience) ? row.default_audience : "team",
    notifyOnShare: row.notify_on_share !== false,
    groupByProject: row.group_by_project !== false,
    meetingTemplate: templates.includes(row.meeting_template as NoteTemplateId) ? row.meeting_template as NoteTemplateId : "meeting",
    defaultWidth: isNoteWidth(row.default_width) ? row.default_width : "normal",
    customerAccess: row.customer_access === "read" ? "read" : "edit",
  };
}

function toCover(row: PageRow): NoteCover | null {
  if (!row.cover_kind || !row.cover_value) return null;
  const position = cleanCoverPosition(row.cover_position);
  if (row.cover_kind === "gallery") return isGalleryCover(row.cover_value) ? { kind: "gallery", value: row.cover_value, position } : null;
  if (row.cover_kind === "file" || row.cover_kind === "upload") return { kind: row.cover_kind, value: row.cover_value, position, url: null };
  return null;
}

export function toMeta(row: PageRow): NotePageMeta {
  const rights = fitRights({ audience: isNoteAudience(row.audience) ? row.audience : "team", customerEdits: row.customer_edits === true, freelancerEdits: row.freelancer_edits === true });
  return {
    id: row.id,
    customerId: row.customer_id,
    projectId: row.project_id,
    parentId: row.parent_id,
    appointmentId: row.appointment_id,
    title: row.title,
    icon: row.icon ?? "",
    cover: toCover(row),
    width: isNoteWidth(row.width) ? row.width : "normal",
    ...rights,
    outsideEditedAt: row.outside_edited_at ?? null,
    datedOn: row.dated_on,
    position: Number(row.position) || 0,
    version: row.version,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

export const toDoc = (value: unknown): NoteDoc => value && typeof value === "object" && (value as NoteDoc).type === "doc" ? value as NoteDoc : emptyNoteDoc();

/** Who looks, with which session; null for logins that may not open notes (or must confirm their code first). */
export const notesContext = cache(async (): Promise<NotesContext | null> => {
  const admin = await verifyHubAdmin();
  if (admin) return { viewer: "admin", userId: admin.userId, session: await createClient() as unknown as SupabaseClient, db: createAdminClient() };
  const freelancer = await verifyHubFreelancer();
  if (freelancer) return { viewer: "freelancer", userId: freelancer.userId, session: freelancer.supabase as unknown as SupabaseClient, db: createAdminClient() };
  const session = await createClient();
  const { data } = await session.auth.getClaims();
  const role = (data?.claims?.app_metadata as Record<string, unknown> | undefined)?.app_role;
  if (!data?.claims || role === "oalab_admin" || role === "oalab_freelancer") return null;
  const { data: profile } = await session.from("hub_profiles").select("status").eq("user_id", data.claims.sub).maybeSingle<{ status: string }>();
  if (profile?.status !== "active") return null;
  return { viewer: "customer", userId: data.claims.sub, session: session as unknown as SupabaseClient, db: createAdminClient() };
});

type CustomerRow = { id: string; company: string; customer_number: string; organization_id?: string | null; logo_path?: string | null; logo_background?: string | null; logo_color?: string | null };
type Listed = NoteCustomer & { organizationId: string | null };

/**
 * The customers whose notes the viewer may open: admins every customer (not archived) and, first, oalab's own entry once
 * the database takes notes for it (stage 2 of the plan „oalab als Unternehmen“; read error-tolerantly, so without the
 * migration the list is as before), freelancers theirs, customers their own.
 */
export async function notesCustomers(ctx: NotesContext): Promise<Listed[] | null> {
  if (ctx.viewer === "admin") {
    const [rows, archive, links, team] = await Promise.all([
      ctx.session.from("hub_customers").select("id, company, customer_number, organization_id, kind").eq("kind", "customer").order("company").returns<CustomerRow[]>(),
      loadArchive(),
      ctx.session.from("hub_freelancer_customers").select("freelancer_id, customer_id").returns<{ freelancer_id: string; customer_id: string }[]>(),
      loadTeamNotesEntry(ctx.db),
    ]);
    if (rows.error) return null;
    const shown = (rows.data ?? []).filter((row) => !archive.customerIds.has(row.id));
    const logos = ctx.via ? new Map<string, CustomerLogo>() : await loadCustomerLogos(ctx.session, [...(team ? [team.id] : []), ...shown.map((row) => row.id)]);
    const served = new Set((links.error ? [] : links.data ?? []).filter((link) => !archive.customerIds.has(link.freelancer_id)).map((link) => link.customer_id));
    // oalab has no freelancers yet: they come with stage 3.
    const internal: Listed[] = team ? [{ id: team.id, name: team.company, number: team.customerNumber, organizationId: team.organizationId, hasFreelancer: false, team: true, ...(logos.get(team.id) ? { logo: logos.get(team.id) } : {}) }] : [];
    return [...internal, ...shown.map((row) => ({ id: row.id, name: row.company, number: row.customer_number, organizationId: row.organization_id ?? null, hasFreelancer: served.has(row.id), ...(logos.get(row.id) ? { logo: logos.get(row.id) } : {}) }))];
  }
  if (ctx.viewer === "freelancer") {
    const listed = await loadFreelancerCustomerList(ctx.session);
    const rows: CustomerRow[] = listed ?? (await ctx.session.from("hub_customers").select("id, company, customer_number, organization_id, kind").eq("kind", "customer").returns<CustomerRow[]>()).data ?? [];
    const logos = ctx.via ? new Map<string, CustomerLogo>() : await signCustomerLogos(ctx.session, rows.map((row) => ({ id: row.id, logo_path: row.logo_path ?? null, logo_background: row.logo_background ?? null, logo_color: row.logo_color ?? null })));
    return rows
      .map((row) => ({ id: row.id, name: row.company, number: row.customer_number, organizationId: row.organization_id ?? null, hasFreelancer: true, ...(logos.get(row.id) ? { logo: logos.get(row.id) } : {}) }))
      .sort((a, b) => a.name.localeCompare(b.name, "de"));
  }
  const members = await ctx.session.from("hub_customer_members").select("customer_id").eq("user_id", ctx.userId).returns<{ customer_id: string }[]>();
  const ids = (members.data ?? []).map((row) => row.customer_id);
  if (members.error) return null;
  if (!ids.length) return [];
  const rows = await ctx.session.from("hub_customers").select("id, company, customer_number").in("id", ids).returns<CustomerRow[]>();
  if (rows.error) return null;
  const logos = await loadCustomerLogos(ctx.session, ids);
  // Customers do not learn who looks after them.
  return (rows.data ?? []).map((row) => ({ id: row.id, name: row.company, number: row.customer_number, organizationId: null, hasFreelancer: false, ...(logos.get(row.id) ? { logo: logos.get(row.id) } : {}) }));
}

/** The projects a page of this customer may hang under, as the viewer may name them. */
export async function notesProjects(ctx: NotesContext, customer: Listed): Promise<NoteProject[]> {
  if (ctx.viewer === "customer") {
    const live = await loadLiveProjects();
    return live.projects.filter((project) => project.customerId === customer.id).map((project) => ({ id: project.id, name: project.name }));
  }
  const db = ctx.db;
  if (!db || !customer.organizationId) return [];
  if (ctx.viewer === "admin") {
    const rows = await db.from("customer_projects").select("id, display_name").eq("organization_id", customer.organizationId).neq("status", "archived").order("display_name").returns<{ id: string; display_name: string }[]>();
    return (rows.data ?? []).map((row) => ({ id: row.id, name: row.display_name }));
  }
  // Freelancers name only the projects an admin put them on (as on their board).
  const own = await ctx.session.from("studio_project_freelancers").select("project_id").returns<{ project_id: string }[]>();
  const ids = [...new Set((own.data ?? []).map((row) => row.project_id))];
  if (!ids.length) return [];
  const rows = await db.from("customer_projects").select("id, display_name").in("id", ids).eq("organization_id", customer.organizationId).neq("status", "archived").order("display_name").returns<{ id: string; display_name: string }[]>();
  return (rows.data ?? []).map((row) => ({ id: row.id, name: row.display_name }));
}

/** Names of the people who last edited, for the team and freelancers; customers see none. */
export async function namesOf(ctx: NotesContext, ids: (string | null)[]): Promise<Record<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (ctx.viewer === "customer" || !ctx.db || !wanted.length) return {};
  const { data } = await ctx.db.from("hub_profiles").select("user_id, first_name, last_name").in("user_id", wanted).returns<{ user_id: string; first_name: string | null; last_name: string | null }[]>();
  return Object.fromEntries((data ?? []).map((row) => [row.user_id, `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "Teammitglied"]));
}

/** The pages of one customer the viewer may see, without their documents. */
export async function readPages(ctx: NotesContext, customerId: string) {
  return ctx.session.from("hub_note_pages").select(PAGE_COLUMNS).eq("customer_id", customerId).is("deleted_at", null).order("position").returns<PageRow[]>();
}

/**
 * A page as the viewer may know it: customers do not learn who looks after them, so „Kunde und Freelancer“ reads as
 * „Nur Kunde“ for them and the freelancers' rights stay out; the time of outside edits is the team's.
 */
export function shownTo<T extends NotePageMeta>(viewer: NoteViewer, page: T): T {
  if (viewer !== "customer") return page;
  return { ...page, audience: page.audience === "both" ? "customer" : page.audience, freelancerEdits: false, outsideEditedAt: null };
}

/** When the viewer last opened each page, for the team's mark on pages with news from outside. */
async function seenAtOf(ctx: NotesContext, pageIds: string[]): Promise<Map<string, string>> {
  if (ctx.viewer !== "admin" || !pageIds.length) return new Map();
  const { data } = await ctx.session.from("hub_note_views").select("page_id, seen_at").eq("user_id", ctx.userId).in("page_id", pageIds).returns<{ page_id: string; seen_at: string }[]>();
  return new Map((data ?? []).map((row) => [row.page_id, row.seen_at]));
}

/** The customer's pages as the list shows them to the viewer; null when they cannot be read. */
export async function listPages(ctx: NotesContext, customerId: string): Promise<NotePageMeta[] | null> {
  const pages = await readPages(ctx, customerId);
  if (pages.error) return null;
  const metas = (pages.data ?? []).map(toMeta);
  if (ctx.viewer !== "admin") return metas.map((meta) => shownTo(ctx.viewer, meta));
  const seen = await seenAtOf(ctx, metas.map((meta) => meta.id));
  return metas.map((meta) => ({ ...meta, seenAt: seen.get(meta.id) ?? null }));
}

/**
 * The viewer opened a page: when (hub_note_views, written with the server key after the person's own session read the
 * page) and, for the team, the bell's lines about edits from outside on it, for every admin, as the team has seen them.
 * Never fails what the person does.
 */
export async function markSeen(ctx: NotesContext, page: Pick<NotePageMeta, "id" | "customerId">): Promise<void> {
  if (!ctx.db || ctx.via) return;
  const at = new Date().toISOString();
  try {
    await ctx.db.from("hub_note_views").upsert({ page_id: page.id, user_id: ctx.userId, seen_at: at }, { onConflict: "page_id,user_id" });
    if (ctx.viewer === "admin") {
      const href = notePageHref(page.customerId, page.id);
      await Promise.all([
        ctx.db.from("hub_inbox").update({ read_at: at }).eq("kind", "note.edited").eq("href", href).is("read_at", null),
        // „Team informieren“ told each colleague on their own: opening the page settles only the own line.
        ctx.db.from("hub_inbox").update({ read_at: at }).eq("kind", "note.team").eq("href", href).eq("user_id", ctx.userId).is("read_at", null),
      ]);
    }
  } catch {
    // „Zuletzt geöffnet“ is a convenience; opening the page succeeded.
  }
}

/**
 * Who of the customer and of the customer's freelancers may open the page, and when they last did (team only): the
 * active logins, as the sight of the page reaches them.
 */
export async function noteReadersAs(ctx: NotesContext, input: { pageId: string }): Promise<{ ok: true; data: NoteReaders } | { ok: false; error: string }> {
  if (ctx.viewer !== "admin") return { ok: false, error: "Das sieht das oalab-Team." };
  const page = await readPage(ctx, input?.pageId, false);
  if (!page) return { ok: false, error: "Diese Seite gibt es nicht mehr." };
  const db = ctx.db;
  if (!db) return { ok: true, data: { customer: [], freelancer: [] } };
  const links = await db.from("hub_freelancer_customers").select("freelancer_id").eq("customer_id", page.customerId).returns<{ freelancer_id: string }[]>();
  const freelancers = [...new Set((links.data ?? []).map((row) => row.freelancer_id))];
  const members = await db.from("hub_customer_members").select("customer_id, user_id").in("customer_id", [page.customerId, ...freelancers]).returns<{ customer_id: string; user_id: string }[]>();
  const ids = [...new Set((members.data ?? []).map((row) => row.user_id))];
  if (!ids.length) return { ok: true, data: { customer: [], freelancer: [] } };
  const [profiles, views] = await Promise.all([
    db.from("hub_profiles").select("user_id, first_name, last_name, status").in("user_id", ids).returns<{ user_id: string; first_name: string | null; last_name: string | null; status: string }[]>(),
    db.from("hub_note_views").select("user_id, seen_at").eq("page_id", page.id).in("user_id", ids).returns<{ user_id: string; seen_at: string }[]>(),
  ]);
  const active = new Map((profiles.data ?? []).filter((row) => row.status === "active").map((row) => [row.user_id, `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "Zugang"]));
  const seen = new Map((views.data ?? []).map((row) => [row.user_id, row.seen_at]));
  const of = (customerIds: string[]) => [...new Set((members.data ?? []).filter((row) => customerIds.includes(row.customer_id)).map((row) => row.user_id))]
    .filter((id) => active.has(id))
    .map((id) => ({ id, name: active.get(id)!, seenAt: seen.get(id) ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
  return { ok: true, data: { customer: of([page.customerId]), freelancer: of(freelancers) } };
}

/** One page with its document, as the viewer may see it; null when it is gone or not visible. */
export async function readPage(ctx: NotesContext, id: string, withRefs = true): Promise<NotePage | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await ctx.session.from("hub_note_pages").select(`${PAGE_COLUMNS}, content`).eq("id", id).is("deleted_at", null).maybeSingle<PageRow>();
  if (error || !data) return null;
  const meta = shownTo(ctx.viewer, toMeta(data));
  const content = toDoc(data.content);
  if (!withRefs) return { ...meta, content };
  const [refs, cover] = await Promise.all([resolveRefs(ctx, content, meta.customerId).catch(() => NO_REFS), signCover(ctx, meta.cover)]);
  return { ...meta, cover, content, refs };
}

/**
 * The link of a cover from the files or an upload, with the viewer's rights: an upload is as visible as its page (the
 * server signs it once the viewer has read the page); an image from the files only for who may see that file, else a
 * calm colour (url null).
 */
export async function signCover(ctx: NotesContext, cover: NoteCover | null): Promise<NoteCover | null> {
  if (!cover || cover.kind === "gallery") return cover;
  // Claude reads no pictures: no link is signed for it.
  if (ctx.via) return { ...cover, url: null };
  if (cover.kind === "upload") {
    const signed = ctx.db ? await ctx.db.storage.from(HUB_FILES_BUCKET).createSignedUrl(cover.value, 60 * 60) : null;
    return { ...cover, url: signed?.data?.signedUrl ?? null };
  }
  const file = await ctx.session.from("hub_files").select("id, title, storage_path, mime_type").eq("id", cover.value).maybeSingle<{ id: string; title: string; storage_path: string; mime_type: string }>();
  if (!file.data || !file.data.mime_type.startsWith("image/")) return { ...cover, url: null };
  const signed = await ctx.session.storage.from(HUB_FILES_BUCKET).createSignedUrl(file.data.storage_path, 60 * 60);
  return { ...cover, url: signed.data?.signedUrl ?? null, name: file.data.title };
}

/**
 * New links for pictures of a page whose links ran out (they hold an hour, a page may stay open longer; 27.11.2026):
 * only pictures the page names as it is stored, of its own customer, for a viewer who may read the page.
 */
export async function noteImageUrlsAs(ctx: NotesContext, input: { pageId: string; paths: string[] }): Promise<{ ok: true; data: Record<string, string> } | { ok: false; error: string }> {
  const asked = Array.isArray(input?.paths) ? input.paths.filter((path): path is string => typeof path === "string").slice(0, 100) : [];
  const page = await readPage(ctx, input?.pageId, false);
  if (!page) return { ok: false, error: "Diese Seite gibt es nicht mehr, oder sie ist nicht für dich freigegeben." };
  const named = new Set(ownImages(refsIn(page.content).images, page.customerId));
  const paths = asked.filter((path) => named.has(path));
  if (!paths.length || !ctx.db || ctx.via) return { ok: true, data: {} };
  const signed = await ctx.db.storage.from(HUB_FILES_BUCKET).createSignedUrls(paths, 60 * 60);
  return { ok: true, data: Object.fromEntries((signed.data ?? []).flatMap((item) => item.path && item.signedUrl ? [[item.path, item.signedUrl]] : [])) };
}

/** List, projects and names for one customer the viewer may open; null when they may not. */
export async function customerView(ctx: NotesContext, customers: Listed[], customerId: string): Promise<NotesCustomerView | null> {
  const customer = customers.find((item) => item.id === customerId);
  if (!customer) return null;
  const [metas, projects] = await Promise.all([listPages(ctx, customer.id), notesProjects(ctx, customer)]);
  if (!metas) return null;
  return { customerId: customer.id, projects, pages: metas, people: await namesOf(ctx, metas.map((page) => page.updatedBy)) };
}

const failed = (viewer: NoteViewer, error: string, ready = true): NotesArea => ({ viewer, viewerId: "", customers: [], customerId: null, projects: [], pages: [], page: null, settings: DEFAULT_SETTINGS, people: {}, taskWriter: false, ready, error });

/** Tasks from a note are written like on the board: freelancers always confirmed a code, admins need one too (aal2). */
export async function canWriteTasks(ctx: NotesContext) {
  if (ctx.viewer === "freelancer") return true;
  if (ctx.viewer !== "admin") return false;
  const { data } = await ctx.session.auth.getClaims();
  return data?.claims?.aal === "aal2";
}

/** The first page of the list: the first top-level page in the order of the list. */
const firstPage = (pages: NotePageMeta[]) => childrenOf(pages, null)[0] ?? null;

/**
 * The notes page for the signed-in login: the customers they may open, for the chosen one (address, then the page's
 * customer, then the last one an admin opened in this browser, then the first) the projects and the pages, and the open
 * page with its document. `customer` and `page` come from the address (?customer=, ?page=).
 */
export const loadNotes = cache(async (customer?: string, page?: string): Promise<NotesArea> => {
  const ctx = await notesContext();
  if (!ctx) return failed("customer", "Notizen öffnest du mit einem aktiven Zugang; Freelancer bestätigen ihre Anmeldung mit einem Code.");
  const settings = await ctx.session.from("hub_note_settings").select(SETTINGS_COLUMNS).maybeSingle<SettingsRow>();
  if (notesMissing(settings.error)) return failed(ctx.viewer, NOT_READY, false);
  const customers = await notesCustomers(ctx);
  if (!customers) return failed(ctx.viewer, LOAD_ERROR);
  const base = { viewer: ctx.viewer, viewerId: ctx.userId, settings: toSettings(settings.data), ready: true, error: null, taskWriter: await canWriteTasks(ctx) };
  const list: NotesArea["customers"] = customers.map((item) => ({ id: item.id, name: item.name, number: item.number, hasFreelancer: item.hasFreelancer, ...(item.team ? { team: true } : {}), ...(item.logo ? { logo: item.logo } : {}) }));
  if (!customers.length) return { ...base, customers: list, customerId: null, projects: [], pages: [], page: null, people: {} };

  const opened = page && isUuid(page) ? await readPage(ctx, page) : null;
  const remembered = ctx.viewer === "admin" ? (await cookies()).get(NOTES_CUSTOMER_COOKIE)?.value : undefined;
  const known = (id: string | null | undefined) => id && customers.some((item) => item.id === id) ? id : null;
  const customerId = known(opened?.customerId) ?? known(customer) ?? known(remembered) ?? customers[0].id;
  const view = await customerView(ctx, customers, customerId);
  if (!view) return { ...failed(ctx.viewer, LOAD_ERROR), customers: list };
  const shown = opened && opened.customerId === customerId ? opened : null;
  const fallback = shown ? null : firstPage(view.pages);
  const openPage = shown ?? (fallback ? await readPage(ctx, fallback.id) : null);
  if (!openPage) return { ...base, customers: list, ...view, page: null };
  // The open page counts as seen: its mark in the list goes, and so do the team's bell lines about it.
  after(() => markSeen(ctx, openPage));
  const now = new Date().toISOString();
  return { ...base, customers: list, ...view, pages: view.pages.map((item) => item.id === openPage.id && ctx.viewer === "admin" ? { ...item, seenAt: now } : item), page: openPage };
});
