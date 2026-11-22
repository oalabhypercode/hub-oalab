import "server-only";
import { isGalleryCover, cleanCoverPosition } from "./covers";
import {
  AUDIENCE_LABELS, childrenOf, cleanIcon, cleanNoteTitle, emptyNoteDoc, isIsoDate, isNoteAudience, isNoteWidth, isUuid, narrowedBelow,
  newPageAudience, positionAfter, validateNoteDoc, within,
} from "./rules";
import { namesOf, notesCustomers, PAGE_COLUMNS, readPage, readPages, SETTINGS_COLUMNS, toDoc, toMeta, toSettings, type NotesContext, type PageRow } from "./server";
import type { NoteAudience, NoteDoc, NotePage, NotePageMeta, NotePatch, NoteResult, NoteSaved, NoteSettings } from "./types";

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

/** Writes an entry of the admin log with the server key; a failed entry never fails the change itself. */
export async function logNoteEvent(ctx: NotesContext, action: string, summary: string, customerId: string) {
  if (!ctx.db) return;
  await ctx.db.from("hub_admin_events").insert({ actor_id: ctx.userId, action, summary: summary.slice(0, 300), target_customer_id: customerId }).then(() => undefined, () => undefined);
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
  return { ok: true, data: { id: data.id, version: data.version, updatedAt: data.updated_at, updatedBy: data.updated_by } };
}

export type CreateInput = { customerId: string; projectId?: string | null; parentId?: string | null; title?: string; icon?: string; content?: NoteDoc };

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
  const parent = input.parentId ? await readPage(ctx, input.parentId) : null;
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
  const projectId = parent ? parent.projectId : input.projectId && isUuid(input.projectId) ? input.projectId : null;
  const metas = (siblings.data ?? []).map(toMeta);
  const position = positionAfter(childrenOf(metas, parent?.id ?? null));
  const { data, error } = await ctx.session.from("hub_note_pages").insert({
    customer_id: customer.id, project_id: projectId, parent_id: parent?.id ?? null, title, icon, audience, width: settings.defaultWidth,
    content: checked.doc, content_text: checked.text, position,
  }).select(`${PAGE_COLUMNS}, content`).single<PageRow>();
  if (error || !data) return fail(noteError(error, "Die Seite konnte gerade nicht angelegt werden. Bitte versuche es erneut."));
  await logNoteEvent(ctx, "note.created", `Notiz angelegt · Sichtbar für: ${AUDIENCE_LABELS[audience]}`, customer.id);
  return { ok: true, data: { ...toMeta(data), content: toDoc(data.content) } };
}

/**
 * „Sichtbar für“ of a page (only the team): never wider than the page above it; a narrower level takes the subpages
 * along (the database does that itself). Returns the customer's pages afterwards, so the list shows every change.
 */
export async function setAudienceAs(ctx: NotesContext, input: { id: string; audience: NoteAudience }): Promise<NoteResult<{ pages: NotePageMeta[]; narrowed: number }>> {
  if (ctx.viewer !== "admin") return fail("„Sichtbar für“ ändert nur das oalab-Team.");
  if (!isUuid(input?.id) || !isNoteAudience(input?.audience)) return fail("Diese Stufe gibt es nicht.");
  const page = await readPage(ctx, input.id);
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
  const after = await readPages(ctx, customer.id);
  await logNoteEvent(ctx, "note.audience", `Notiz: ${AUDIENCE_LABELS[page.audience]} → ${AUDIENCE_LABELS[input.audience]}${narrowed ? ` (${narrowed} Unterseite${narrowed === 1 ? "" : "n"} mit eingeschränkt)` : ""}`, customer.id);
  return { ok: true, data: { pages: (after.data ?? []).map(toMeta), narrowed } };
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
