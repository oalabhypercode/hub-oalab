import "server-only";
import { after } from "next/server";
import { HUB_FILES_BUCKET } from "@/lib/hub-files/catalog";
import { noteNotice } from "@/lib/hub-notify/rules";
import { notifyNote } from "@/lib/hub-notify/server";
import { fetchLinkPreview } from "./link-preview";
import { isGalleryCover, cleanCoverPosition } from "./covers";
import {
  AUDIENCE_LABELS, childrenOf, cleanIcon, cleanNoteTitle, emptyNoteDoc, gains, isIsoDate, isNoteAudience, isNoteWidth, isUuid, narrowedBelow,
  newPageAudience, positionAfter, validateNoteDoc, within,
} from "./rules";
import { namesOf, notesCustomers, PAGE_COLUMNS, readPage, readPages, SETTINGS_COLUMNS, toDoc, toMeta, toSettings, type NotesContext, type PageRow } from "./server";
import { sweepNoteImages } from "./sweep";
import type { NoteAudience, NoteCover, NoteDoc, NoteLinkPreview, NotePage, NotePageMeta, NotePatch, NoteResult, NoteSaved, NoteSettings, NoteTrashItem } from "./types";

// The core of writing notes, for the hub's actions now and the assistant or the Claude connector later: every write
// goes through the person's own session, so the rules and the guard of hub_note_pages decide (migration 202611221001).
// A save carries the version the browser started from and is written only while it still holds; otherwise the page as
// it is now comes back and nothing is overwritten. Documents are checked here (lib/hub-notes/rules.ts) and stored as
// JSON with their plain text for the search. The admin log records creating and releasing a page, never its content.

export const fail = <T,>(error: string): NoteResult<T> => ({ ok: false, error });

/** The database's refusals in plain words. */
const REFUSALS: Record<string, string> = {
  HUB_NOTE_FIELD_LOCKED: "Das ändert nur das oalab-Team.",
  HUB_NOTE_AUDIENCE_PARENT: "Eine Unterseite ist höchstens so sichtbar wie die Seite darüber.",
  HUB_NOTE_PARENT_CYCLE: "Eine Seite kann nicht unter sich selbst stehen.",
  HUB_NOTE_TOO_DEEP: "Seiten gehen höchstens fünf Ebenen tief.",
  HUB_NOTE_PARENT_OTHER_CUSTOMER: "Die Seite darüber gehört zu einem anderen Kunden.",
  HUB_NOTE_PARENT_IN_TRASH: "Die Seite darüber liegt im Papierkorb.",
  HUB_NOTE_PROJECT_OTHER_CUSTOMER: "Das Projekt gehört zu einem anderen Kunden.",
  HUB_NOTE_APPOINTMENT_OTHER_CUSTOMER: "Der Termin gehört zu einem anderen Kunden.",
  HUB_NOTE_CUSTOMER_FIXED: "Eine Seite bleibt bei ihrem Kunden.",
};

export function noteError(error: { code?: string; message?: string } | null, fallback = "Die Seite konnte gerade nicht gespeichert werden. Bitte versuche es erneut.") {
  const message = error?.message ?? "";
  const known = Object.keys(REFUSALS).find((code) => message.includes(code));
  if (known) return REFUSALS[known];
  if (error?.code === "42501" || /row-level security/i.test(message)) return "Dafür fehlen dir die Rechte.";
  if (/content_size|content_text/i.test(message)) return "Die Seite ist zu groß (höchstens 1 MB). Teile sie in Unterseiten auf.";
  if (/title_check/i.test(message)) return "Der Titel braucht 1 bis 200 Zeichen.";
  return fallback;
}

/**
 * Writes an entry of the admin log with the server key; a failed entry never fails the change itself. Changes through
 * the Claude connector are logged as `claude.note.*`, „über Claude“ (and „(Freelancer)“ for a freelancer's Claude).
 */
export async function logNoteEvent(ctx: NotesContext, action: string, summary: string, customerId: string) {
  if (!ctx.db) return;
  const claude = ctx.via === "claude";
  const line = claude ? `${summary} · über Claude${ctx.viewer === "freelancer" ? " (Freelancer)" : ""}` : summary;
  await ctx.db.from("hub_admin_events").insert({ actor_id: ctx.userId, action: claude ? `claude.${action}` : action, summary: line.slice(0, 300), target_customer_id: customerId }).then(() => undefined, () => undefined);
}

const canWrite = (ctx: NotesContext) => ctx.viewer === "admin" || ctx.viewer === "freelancer";

/** The fields of a save, checked one by one; a string is the reason for refusing. */
function rowOf(patch: NotePatch): Record<string, unknown> | string {
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const title = cleanNoteTitle(patch.title);
    if (!title) return "Der Titel braucht 1 bis 200 Zeichen.";
    row.title = title;
  }
  if (patch.content !== undefined) {
    const checked = validateNoteDoc(patch.content);
    if (!checked.ok) return checked.error;
    row.content = checked.doc;
    row.content_text = checked.text;
  }
  if (patch.icon !== undefined) {
    const icon = cleanIcon(patch.icon);
    if (icon === null) return "Als Symbol geht ein Emoji.";
    row.icon = icon;
  }
  if (patch.cover !== undefined) {
    if (patch.cover === null) Object.assign(row, { cover_kind: null, cover_value: null, cover_position: 50 });
    else if (patch.cover.kind === "gallery" && isGalleryCover(patch.cover.value)) Object.assign(row, { cover_kind: "gallery", cover_value: patch.cover.value, cover_position: cleanCoverPosition(patch.cover.position) });
    // An image from the customer's files: savePageAs checks that the writer may see it at this customer.
    else if (patch.cover.kind === "file" && isUuid(patch.cover.value)) Object.assign(row, { cover_kind: "file", cover_value: patch.cover.value.toLowerCase(), cover_position: cleanCoverPosition(patch.cover.position) });
    // An upload keeps its place; only its position changes here (a new upload goes through app/api/notes/cover).
    else if (patch.cover.kind === "upload") Object.assign(row, { cover_position: cleanCoverPosition(patch.cover.position) });
    else return "Dieses Titelbild geht nicht.";
  }
  if (patch.width !== undefined) {
    if (!isNoteWidth(patch.width)) return "Die Breite ist Normal oder Breit.";
    row.width = patch.width;
  }
  if (patch.datedOn !== undefined) {
    if (patch.datedOn !== null && !isIsoDate(patch.datedOn)) return "Das Datum ist ungültig.";
    row.dated_on = patch.datedOn;
  }
  if (patch.projectId !== undefined) {
    if (patch.projectId !== null && !isUuid(patch.projectId)) return "Das Projekt ist unbekannt.";
    row.project_id = patch.projectId;
  }
  return Object.keys(row).length ? row : "Es gibt nichts zu speichern.";
}

/** Saves a page while the version the browser started from still holds. */
export async function savePageAs(ctx: NotesContext, input: { id: string; version: number; patch: NotePatch }): Promise<NoteResult<NoteSaved>> {
  if (!canWrite(ctx)) return fail("Notizen lesen kannst du; ändern kann sie das oalab-Team.");
  if (!isUuid(input?.id) || !Number.isInteger(input?.version)) return fail("Diese Seite ist unbekannt.");
  const row = rowOf(input.patch ?? {});
  if (typeof row === "string") return fail(row);
  // The cover before, to tidy away an upload that is replaced, and to keep an upload's place when only its position moves.
  const before = input.patch?.cover !== undefined ? await ctx.session.from("hub_note_pages").select("customer_id, cover_kind, cover_value").eq("id", input.id).maybeSingle<{ customer_id: string; cover_kind: string | null; cover_value: string | null }>() : null;
  if (input.patch?.cover?.kind === "upload" && before?.data?.cover_kind !== "upload") return fail("Dieses Titelbild geht nicht.");
  if (input.patch?.cover?.kind === "file") {
    const seen = await ctx.session.from("hub_file_assignments").select("file_id, hub_files!inner(mime_type)").eq("file_id", String(row.cover_value)).eq("customer_id", before?.data?.customer_id ?? "").limit(1).returns<{ file_id: string; hub_files: { mime_type: string } | null }[]>();
    if (!seen.data?.length || !String(seen.data[0].hub_files?.mime_type ?? "").startsWith("image/")) return fail("Als Titelbild geht nur ein Bild aus den Dateien dieses Kunden.");
  }
  const { data, error } = await ctx.session.from("hub_note_pages").update(row).eq("id", input.id).eq("version", input.version).is("deleted_at", null)
    .select("id, version, updated_at, updated_by").maybeSingle<{ id: string; version: number; updated_at: string; updated_by: string | null }>();
  if (error) return fail(noteError(error));
  if (!data) {
    const current = await readPage(ctx, input.id);
    if (current && current.version !== input.version) {
      const names = await namesOf(ctx, [current.updatedBy]);
      const who = current.updatedBy && current.updatedBy !== ctx.userId ? names[current.updatedBy] : null;
      return { ok: false, stale: true, current, error: who ? `Inzwischen von ${who} geändert.` : "Inzwischen an anderer Stelle geändert." };
    }
    return fail("Diese Seite gibt es nicht mehr, oder du darfst sie nicht ändern.");
  }
  if (before?.data?.cover_kind === "upload" && before.data.cover_value && (row.cover_kind !== undefined && (row.cover_kind !== "upload" || row.cover_value !== before.data.cover_value))) await removeStored(ctx, [before.data.cover_value]);
  return { ok: true, data: { id: data.id, version: data.version, updatedAt: data.updated_at, updatedBy: data.updated_by } };
}

/**
 * Removes an uploaded cover the moment its page no longer has it (a cover is never in the history); a failure leaves it
 * to the sweep (lib/hub-notes/sweep.ts) and never fails the change. Link previews only ever go with the sweep.
 */
async function removeStored(ctx: NotesContext, paths: string[]) {
  const own = paths.filter((path) => /^notes\/[0-9a-f-]{36}\//.test(path));
  if (own.length && ctx.db) await ctx.db.storage.from(HUB_FILES_BUCKET).remove(own).then(() => undefined, () => undefined);
}

/** `datedOn` puts the page into the calendar right away (the Claude connector's create_note). */
export type CreateInput = { customerId: string; projectId?: string | null; parentId?: string | null; title?: string; icon?: string; content?: NoteDoc; datedOn?: string | null };

/**
 * A new page: a subpage takes its parent's level and project, a freelancer's page is always „Nur Freelancer“, the
 * team's follows the default for all notes. It goes to the end of its siblings.
 */
export async function createPageAs(ctx: NotesContext, input: CreateInput): Promise<NoteResult<NotePage>> {
  if (!canWrite(ctx)) return fail("Neue Seiten legen das oalab-Team und Freelancer an.");
  if (!isUuid(input?.customerId)) return fail("Der Kunde ist unbekannt.");
  const customers = await notesCustomers(ctx);
  const customer = customers?.find((item) => item.id === input.customerId);
  if (!customer) return fail("Bei diesem Kunden kannst du keine Notizen anlegen.");
  const parent = input.parentId ? await readPage(ctx, input.parentId, false) : null;
  if (input.parentId && (!parent || parent.customerId !== customer.id)) return fail("Die Seite darüber gibt es nicht mehr.");
  const [settingsRow, siblings] = await Promise.all([
    ctx.session.from("hub_note_settings").select(SETTINGS_COLUMNS).maybeSingle(),
    readPages(ctx, customer.id),
  ]);
  const settings = toSettings(settingsRow.data as Parameters<typeof toSettings>[0]);
  const audience = newPageAudience(ctx.viewer, parent, settings, customer.hasFreelancer);
  // A freelancer adds pages only below pages they may write next to: never under „Nur Kunde“ or „Nur Team“.
  if (parent && !within(audience, parent.audience)) return fail("Unter dieser Seite kannst du keine Seite anlegen.");
  const title = input.title === undefined ? "Neue Seite" : cleanNoteTitle(input.title);
  if (!title) return fail("Der Titel braucht 1 bis 200 Zeichen.");
  const icon = cleanIcon(input.icon ?? "");
  if (icon === null) return fail("Als Symbol geht ein Emoji.");
  const checked = validateNoteDoc(input.content ?? emptyNoteDoc());
  if (!checked.ok) return fail(checked.error);
  if (input.datedOn !== undefined && input.datedOn !== null && !isIsoDate(input.datedOn)) return fail("Das Datum ist ungültig.");
  const projectId = parent ? parent.projectId : input.projectId && isUuid(input.projectId) ? input.projectId : null;
  const metas = (siblings.data ?? []).map(toMeta);
  const position = positionAfter(childrenOf(metas, parent?.id ?? null));
  const { data, error } = await ctx.session.from("hub_note_pages").insert({
    customer_id: customer.id, project_id: projectId, parent_id: parent?.id ?? null, title, icon, audience, width: settings.defaultWidth,
    content: checked.doc, content_text: checked.text, position, ...(input.datedOn ? { dated_on: input.datedOn } : {}),
  }).select(`${PAGE_COLUMNS}, content`).single<PageRow>();
  if (error || !data) return fail(noteError(error, "Die Seite konnte gerade nicht angelegt werden. Bitte versuche es erneut."));
  await logNoteEvent(ctx, "note.created", `Notiz angelegt · Sichtbar für: ${AUDIENCE_LABELS[audience]}`, customer.id);
  return { ok: true, data: { ...toMeta(data), content: toDoc(data.content) } };
}

/**
 * „Sichtbar für“ of a page (only the team): never wider than the page above it; a narrower level takes the subpages
 * along (the database does that itself). Returns the customer's pages afterwards, so the list shows every change.
 */
export async function setAudienceAs(ctx: NotesContext, input: { id: string; audience: NoteAudience; notify?: boolean }): Promise<NoteResult<{ pages: NotePageMeta[]; narrowed: number }>> {
  if (ctx.viewer !== "admin") return fail("„Sichtbar für“ ändert nur das oalab-Team.");
  if (!isUuid(input?.id) || !isNoteAudience(input?.audience)) return fail("Diese Stufe gibt es nicht.");
  const page = await readPage(ctx, input.id, false);
  if (!page) return fail("Diese Seite gibt es nicht mehr.");
  const customers = await notesCustomers(ctx);
  const customer = customers?.find((item) => item.id === page.customerId);
  if (!customer) return fail("Diese Seite gibt es nicht mehr.");
  if (!customer.hasFreelancer && (input.audience === "both" || input.audience === "freelancer")) return fail("Diesen Kunden betreut kein Freelancer.");
  const before = await readPages(ctx, customer.id);
  const metas = (before.data ?? []).map(toMeta);
  const parent = page.parentId ? metas.find((item) => item.id === page.parentId) : undefined;
  if (parent && !within(input.audience, parent.audience)) return fail(`Höchstens so sichtbar wie „${parent.title}“.`);
  if (page.audience === input.audience) return { ok: true, data: { pages: metas, narrowed: 0 } };
  const narrowed = narrowedBelow(metas, page.id, input.audience).length;
  const { error } = await ctx.session.from("hub_note_pages").update({ audience: input.audience }).eq("id", page.id).is("deleted_at", null);
  if (error) return fail(noteError(error, "„Sichtbar für“ konnte gerade nicht geändert werden."));
  const fresh = await readPages(ctx, customer.id);
  await logNoteEvent(ctx, "note.audience", `Notiz: ${AUDIENCE_LABELS[page.audience]} → ${AUDIENCE_LABELS[input.audience]}${narrowed ? ` (${narrowed} Unterseite${narrowed === 1 ? "" : "n"} mit eingeschränkt)` : ""}`, customer.id);
  // Who newly sees the page hears of it once (bell and the bundled mail); later changes only with „Änderung mitteilen“.
  const gained = gains(page.audience, input.audience);
  if (input.notify !== false && (gained.customer || gained.freelancer)) {
    const notice = noteNotice("note.shared", page.title, customer.id, page.id);
    after(() => notifyNote(customer.id, notice, gained));
  }
  return { ok: true, data: { pages: (fresh.data ?? []).map(toMeta), narrowed } };
}

/** The defaults for all notes (only the team), checked field by field. */
export async function saveSettingsAs(ctx: NotesContext, patch: Partial<NoteSettings>): Promise<NoteResult<NoteSettings>> {
  if (ctx.viewer !== "admin") return fail("Die Standardwerte legt das oalab-Team fest.");
  const row: Record<string, unknown> = {};
  if (patch.defaultAudience !== undefined) { if (!isNoteAudience(patch.defaultAudience)) return fail("Diese Stufe gibt es nicht."); row.default_audience = patch.defaultAudience; }
  if (patch.notifyOnShare !== undefined) row.notify_on_share = patch.notifyOnShare === true;
  if (patch.groupByProject !== undefined) row.group_by_project = patch.groupByProject === true;
  if (patch.defaultWidth !== undefined) { if (!isNoteWidth(patch.defaultWidth)) return fail("Die Breite ist Normal oder Breit."); row.default_width = patch.defaultWidth; }
  if (patch.meetingTemplate !== undefined) { if (!["meeting", "briefing", "acceptance", "blank"].includes(patch.meetingTemplate)) return fail("Diese Vorlage gibt es nicht."); row.meeting_template = patch.meetingTemplate; }
  if (!Object.keys(row).length) return fail("Es gibt nichts zu speichern.");
  const { data, error } = await ctx.session.from("hub_note_settings").update(row).eq("id", true).select(SETTINGS_COLUMNS).maybeSingle();
  if (error || !data) return fail("Die Standardwerte konnten gerade nicht gespeichert werden.");
  return { ok: true, data: toSettings(data as Parameters<typeof toSettings>[0]) };
}

// ---- Step 2: telling about a change, the trash, link previews and covers ------------------------------------------

/** „Änderung mitteilen“ (team only, decision 6): everybody who sees the page hears of the change once. */
export async function notifyChangeAs(ctx: NotesContext, input: { id: string }): Promise<NoteResult<null>> {
  if (ctx.viewer !== "admin") return fail("Mitteilen kann das oalab-Team.");
  const page = await readPage(ctx, input?.id, false);
  if (!page) return fail("Diese Seite gibt es nicht mehr.");
  const to = gains("team", page.audience);
  if (!to.customer && !to.freelancer) return fail("Diese Seite sieht nur das Team.");
  after(() => notifyNote(page.customerId, noteNotice("note.changed", page.title, page.customerId, page.id), to));
  await logNoteEvent(ctx, "note.changed", "Notiz-Änderung mitgeteilt", page.customerId);
  return { ok: true, data: null };
}

const TRASH_DAYS = 30;

/** „In den Papierkorb“ (team only): the page and its subpages, for 30 days. */
export async function trashPageAs(ctx: NotesContext, input: { id: string }): Promise<NoteResult<{ pages: NotePageMeta[] }>> {
  if (ctx.viewer !== "admin") return fail("Löschen kann das oalab-Team.");
  const page = await readPage(ctx, input?.id, false);
  if (!page) return fail("Diese Seite gibt es nicht mehr.");
  const { error } = await ctx.session.from("hub_note_pages").update({ deleted_at: new Date().toISOString() }).eq("id", page.id).is("deleted_at", null);
  if (error) return fail(noteError(error, "Die Seite konnte gerade nicht gelöscht werden."));
  await logNoteEvent(ctx, "note.trashed", "Notiz in den Papierkorb gelegt", page.customerId);
  const fresh = await readPages(ctx, page.customerId);
  return { ok: true, data: { pages: (fresh.data ?? []).map(toMeta) } };
}

type TrashRow = { id: string; title: string; icon: string; deleted_at: string; deleted_by: string | null; parent_id: string | null; customer_id: string; cover_kind: string | null; cover_value: string | null };

/**
 * The trash of a customer (team only): every page that went there itself (subpages go and come back with it). Pages
 * older than 30 days go for good on the way, with their history; their images follow once nothing names them.
 */
export async function listTrashAs(ctx: NotesContext, input: { customerId: string }): Promise<NoteResult<NoteTrashItem[]>> {
  if (ctx.viewer !== "admin") return fail("Den Papierkorb sieht das oalab-Team.");
  if (!isUuid(input?.customerId)) return fail("Der Kunde ist unbekannt.");
  const limit = new Date(Date.now() - TRASH_DAYS * 86_400_000).toISOString();
  const old = await ctx.session.from("hub_note_pages").select("id").eq("customer_id", input.customerId).lt("deleted_at", limit).returns<{ id: string }[]>();
  if (old.data?.length) {
    const removed = await ctx.session.from("hub_note_pages").delete().in("id", old.data.map((row) => row.id));
    if (!removed.error) after(() => sweepNoteImages(input.customerId));
  }
  const { data, error } = await ctx.session.from("hub_note_pages").select("id, title, icon, deleted_at, deleted_by, parent_id, customer_id, cover_kind, cover_value").eq("customer_id", input.customerId).not("deleted_at", "is", null).order("deleted_at", { ascending: false }).returns<TrashRow[]>();
  if (error) return fail("Der Papierkorb konnte gerade nicht geladen werden.");
  const rows = data ?? [];
  const trashed = new Map(rows.map((row) => [row.id, row]));
  // Only pages that went into the trash themselves: a subpage deleted with its parent shows under it, not on its own.
  const tops = rows.filter((row) => !row.parent_id || trashed.get(row.parent_id)?.deleted_at !== row.deleted_at);
  return { ok: true, data: tops.map((row) => ({ id: row.id, title: row.title, icon: row.icon ?? "", deletedAt: row.deleted_at, deletedBy: row.deleted_by, parentId: row.parent_id })) };
}

/** Back from the trash with the subpages deleted together with it; if its parent is still there, it moves to the top. */
export async function restorePageAs(ctx: NotesContext, input: { id: string }): Promise<NoteResult<{ pages: NotePageMeta[] }>> {
  if (ctx.viewer !== "admin") return fail("Wiederherstellen kann das oalab-Team.");
  if (!isUuid(input?.id)) return fail("Diese Seite ist unbekannt.");
  const { data: row } = await ctx.session.from("hub_note_pages").select("id, customer_id, parent_id").eq("id", input.id).not("deleted_at", "is", null).maybeSingle<{ id: string; customer_id: string; parent_id: string | null }>();
  if (!row) return fail("Diese Seite liegt nicht mehr im Papierkorb.");
  const parent = row.parent_id ? await ctx.session.from("hub_note_pages").select("deleted_at").eq("id", row.parent_id).maybeSingle<{ deleted_at: string | null }>() : null;
  const patch: Record<string, unknown> = { deleted_at: null };
  if (parent?.data?.deleted_at) patch.parent_id = null;
  const { error } = await ctx.session.from("hub_note_pages").update(patch).eq("id", row.id);
  if (error) return fail(noteError(error, "Die Seite konnte gerade nicht wiederhergestellt werden."));
  await logNoteEvent(ctx, "note.restored", "Notiz wiederhergestellt", row.customer_id);
  const fresh = await readPages(ctx, row.customer_id);
  return { ok: true, data: { pages: (fresh.data ?? []).map(toMeta) } };
}

/**
 * „Endgültig löschen“ from the trash (team only): the page with its subpages and their history (the database deletes
 * those along with it). The images they stored go right after the answer if nothing else names them, those younger
 * than a day with a later sweep: a card copied to another page keeps its picture, and so does a version of another
 * page (lib/hub-notes/sweep.ts).
 */
export async function purgePageAs(ctx: NotesContext, input: { id: string }): Promise<NoteResult<null>> {
  if (ctx.viewer !== "admin") return fail("Endgültig löschen kann das oalab-Team.");
  if (!isUuid(input?.id)) return fail("Diese Seite ist unbekannt.");
  const { data: row } = await ctx.session.from("hub_note_pages").select("id, customer_id").eq("id", input.id).not("deleted_at", "is", null).maybeSingle<{ id: string; customer_id: string }>();
  if (!row) return fail("Diese Seite liegt nicht mehr im Papierkorb.");
  const { error } = await ctx.session.from("hub_note_pages").delete().eq("id", row.id);
  if (error) return fail("Die Seite konnte gerade nicht gelöscht werden.");
  after(() => sweepNoteImages(row.customer_id));
  await logNoteEvent(ctx, "note.deleted", "Notiz endgültig gelöscht", row.customer_id);
  return { ok: true, data: null };
}

/**
 * The preview of a pasted address for a link card: read once by the server, its image stored downsized at the customer
 * as soon as the card goes in. If the page never keeps the card, the sweep removes the image a day later.
 */
export async function linkPreviewAs(ctx: NotesContext, input: { customerId: string; url: string }): Promise<NoteResult<NoteLinkPreview & { imageUrl: string | null }>> {
  if (ctx.viewer !== "admin" && ctx.viewer !== "freelancer") return fail("Linkkarten legen das oalab-Team und Freelancer an.");
  const customers = await notesCustomers(ctx);
  if (!customers?.some((item) => item.id === input?.customerId)) return fail("Bei diesem Kunden kannst du keine Linkkarten anlegen.");
  if (!isSafeHrefHttps(input?.url)) return fail("Linkkarten gibt es für Adressen mit https.");
  const fetched = await fetchLinkPreview(input.url);
  if (!fetched.ok) return fail(fetched.error);
  let image: string | null = null;
  let imageUrl: string | null = null;
  if (fetched.data.image && ctx.db) {
    const webp = await toWebp(fetched.data.image, 480, 280);
    if (webp) {
      const path = `notes/${input.customerId.toLowerCase()}/links/${crypto.randomUUID()}.webp`;
      const stored = await ctx.db.storage.from(HUB_FILES_BUCKET).upload(path, webp, { contentType: "image/webp", upsert: false });
      if (!stored.error) {
        image = path;
        imageUrl = (await ctx.db.storage.from(HUB_FILES_BUCKET).createSignedUrl(path, 60 * 60)).data?.signedUrl ?? null;
      }
    }
  }
  return { ok: true, data: { href: fetched.data.href, title: fetched.data.title, description: fetched.data.description, site: fetched.data.site, image, imageUrl } };
}

const isSafeHrefHttps = (value: unknown): value is string => typeof value === "string" && /^https:\/\/[^/?#\s]+/i.test(value) && value.length <= 2048;

/** An image as WebP in the given box (cropped to fill it), without its metadata; null if it is no readable image. */
export async function toWebp(bytes: Buffer | Uint8Array, width: number, height: number): Promise<Buffer | null> {
  try {
    const sharp = (await import("sharp")).default;
    return await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize(width, height, { fit: "cover", position: "attention" }).webp({ quality: 82 }).toBuffer();
  } catch {
    return null;
  }
}

/** Images from the customer's files the writer may see, as covers (thumbnails signed with their own rights). */
export async function coverFilesAs(ctx: NotesContext, input: { customerId: string }): Promise<NoteResult<{ id: string; title: string; url: string | null }[]>> {
  if (ctx.viewer !== "admin" && ctx.viewer !== "freelancer") return { ok: true, data: [] };
  if (!isUuid(input?.customerId)) return fail("Der Kunde ist unbekannt.");
  const { data, error } = await ctx.session.from("hub_file_assignments").select("file_id, hub_files!inner(id, title, mime_type, storage_path)").eq("customer_id", input.customerId).limit(200)
    .returns<{ file_id: string; hub_files: { id: string; title: string; mime_type: string; storage_path: string } | null }[]>();
  if (error) return { ok: true, data: [] };
  const images = (data ?? []).flatMap((row) => row.hub_files && /^image\/(jpeg|png|webp)$/.test(row.hub_files.mime_type) ? [row.hub_files] : []).slice(0, 60);
  if (!images.length) return { ok: true, data: [] };
  const signed = await ctx.session.storage.from(HUB_FILES_BUCKET).createSignedUrls(images.map((file) => file.storage_path), 60 * 30);
  const urls = new Map((signed.data ?? []).flatMap((item) => item.path && item.signedUrl ? [[item.path, item.signedUrl]] : []));
  return { ok: true, data: images.map((file) => ({ id: file.id, title: file.title, url: urls.get(file.storage_path) ?? null })) };
}

/** A new uploaded cover (app/api/notes/cover): stored at the customer as WebP, 1500 × 500, then set on the page. */
export async function saveCoverUploadAs(ctx: NotesContext, input: { id: string; version: number; bytes: Buffer }): Promise<NoteResult<NoteSaved & { cover: NoteCover }>> {
  if (ctx.viewer !== "admin" && ctx.viewer !== "freelancer") return fail("Titelbilder ändert, wer die Seite bearbeiten darf.");
  if (!ctx.db) return fail("Hochladen geht gerade nicht.");
  const page = await readPage(ctx, input?.id, false);
  if (!page || (ctx.viewer === "freelancer" && page.audience !== "freelancer")) return fail("Diese Seite kannst du nicht ändern.");
  const webp = await toWebp(input.bytes, 1500, 500);
  if (!webp) return fail("Das Bild ließ sich nicht lesen. JPG, PNG oder WebP gehen.");
  const path = `notes/${page.customerId.toLowerCase()}/${crypto.randomUUID()}.webp`;
  const stored = await ctx.db.storage.from(HUB_FILES_BUCKET).upload(path, webp, { contentType: "image/webp", upsert: false });
  if (stored.error) return fail("Das Bild konnte gerade nicht gespeichert werden.");
  const previous = page.cover?.kind === "upload" ? page.cover.value : null;
  const { data, error } = await ctx.session.from("hub_note_pages").update({ cover_kind: "upload", cover_value: path, cover_position: 50 }).eq("id", page.id).eq("version", input.version).is("deleted_at", null)
    .select("id, version, updated_at, updated_by").maybeSingle<{ id: string; version: number; updated_at: string; updated_by: string | null }>();
  if (error || !data) {
    await removeStored(ctx, [path]);
    return fail(error ? noteError(error) : "Die Seite wurde inzwischen geändert. Lade sie neu und versuche es noch einmal.");
  }
  if (previous) await removeStored(ctx, [previous]);
  const url = (await ctx.db.storage.from(HUB_FILES_BUCKET).createSignedUrl(path, 60 * 60)).data?.signedUrl ?? null;
  return { ok: true, data: { id: data.id, version: data.version, updatedAt: data.updated_at, updatedBy: data.updated_by, cover: { kind: "upload", value: path, position: 50, url } } };
}

/** The pages of a project the viewer sees (the project window's „Notizen“). */
export async function projectNotesAs(ctx: NotesContext, input: { projectId: string }): Promise<NoteResult<{ id: string; title: string; icon: string; customerId: string; updatedAt: string }[]>> {
  if (!isUuid(input?.projectId)) return { ok: true, data: [] };
  const { data, error } = await ctx.session.from("hub_note_pages").select("id, title, icon, customer_id, updated_at").eq("project_id", input.projectId).is("deleted_at", null).order("updated_at", { ascending: false }).limit(30)
    .returns<{ id: string; title: string; icon: string; customer_id: string; updated_at: string }[]>();
  if (error) return { ok: true, data: [] };
  return { ok: true, data: (data ?? []).map((row) => ({ id: row.id, title: row.title, icon: row.icon ?? "", customerId: row.customer_id, updatedAt: row.updated_at })) };
}

/** „Erwähnt in“ at a task: the pages that name it and the viewer may see (the rules of the pages decide). */
export async function taskMentionsAs(ctx: NotesContext, input: { taskId: string }): Promise<NoteResult<{ id: string; title: string; icon: string; customerId: string }[]>> {
  if (!isUuid(input?.taskId)) return { ok: true, data: [] };
  const { data, error } = await ctx.session.from("hub_note_links").select("page_id, hub_note_pages!inner(id, title, icon, customer_id, deleted_at)").eq("target_kind", "task").eq("target_id", input.taskId).limit(20)
    .returns<{ page_id: string; hub_note_pages: { id: string; title: string; icon: string; customer_id: string; deleted_at: string | null } | null }[]>();
  if (error) return { ok: true, data: [] };
  return { ok: true, data: (data ?? []).flatMap((row) => row.hub_note_pages && !row.hub_note_pages.deleted_at ? [{ id: row.hub_note_pages.id, title: row.hub_note_pages.title, icon: row.hub_note_pages.icon ?? "", customerId: row.hub_note_pages.customer_id }] : []) };
}
