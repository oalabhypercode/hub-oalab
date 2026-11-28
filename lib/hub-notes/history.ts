import "server-only";
import { loadArchive } from "@/lib/hub-archive/server";
import { isNoteAudience, isUuid } from "./rules";
import { namesOf, notesCustomers, readPage, type NotesContext } from "./server";
import { fail, logNoteEvent } from "./write";
import type { NotePage, NoteResult, NoteRevision, NoteSearchHit } from "./types";

// Step 3 (plan 1.3): the history of a page (team only, kept by the database: at most one version every 10 minutes and
// always one before „Sichtbar für“ changes, 90 days), „bearbeitet gerade“ (a mark every 15 seconds while a page is open
// for writing) and the notes in the hub's search. All with the person's own session.

type RevisionRow = { id: string; version: number; title: string; icon: string; audience: string; reason: string; saved_by: string | null; saved_at: string; created_at: string; content_text: string };

/** The former versions of a page, newest first, with the names of who saved them. */
export async function noteHistoryAs(ctx: NotesContext, input: { pageId: string }): Promise<NoteResult<NoteRevision[]>> {
  if (ctx.viewer !== "admin") return fail("Den Verlauf sieht das oalab-Team.");
  if (!isUuid(input?.pageId)) return fail("Diese Seite gibt es nicht mehr.");
  const { data, error } = await ctx.session.from("hub_note_revisions").select("id, version, title, icon, audience, reason, saved_by, saved_at, created_at, content_text")
    .eq("page_id", input.pageId).order("created_at", { ascending: false }).limit(60).returns<RevisionRow[]>();
  if (error) return fail(error.code === "42P01" || error.code === "PGRST205" ? "Der Verlauf ist noch nicht eingerichtet: Die Datenbank kennt ihn noch nicht." : "Der Verlauf konnte gerade nicht geladen werden.");
  const names = await namesOf(ctx, (data ?? []).map((row) => row.saved_by));
  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      id: row.id, version: row.version, title: row.title, icon: row.icon, audience: isNoteAudience(row.audience) ? row.audience : "team",
      reason: row.reason === "audience" || row.reason === "restore" ? row.reason : "edit",
      savedBy: row.saved_by ? names[row.saved_by] ?? "Teammitglied" : null, savedAt: row.saved_at, createdAt: row.created_at,
      text: row.content_text.slice(0, 4000),
    })),
  };
}

/**
 * Brings a former version back (team only) while the page still has the version the person saw; the database keeps
 * the current state as a version first. Returns the page as it is now.
 */
export async function restoreRevisionAs(ctx: NotesContext, input: { revisionId: string; version: number }): Promise<NoteResult<NotePage>> {
  if (ctx.viewer !== "admin") return fail("Frühere Fassungen stellt das oalab-Team wieder her.");
  if (!isUuid(input?.revisionId) || !Number.isInteger(input?.version)) return fail("Diese Fassung gibt es nicht mehr.");
  const { data, error } = await ctx.session.rpc("hub_restore_note_revision", { revision_id: input.revisionId, expected_version: input.version });
  if (error) return fail(/HUB_NOTE_(REVISION|PAGE)_MISSING/.test(error.message ?? "") ? "Diese Fassung oder ihre Seite gibt es nicht mehr." : "Die Fassung konnte gerade nicht wiederhergestellt werden.");
  if (data === null) return fail("Die Seite wurde inzwischen geändert. Lade sie neu und wähle die Fassung noch einmal.");
  const revision = await ctx.session.from("hub_note_revisions").select("page_id").eq("id", input.revisionId).maybeSingle<{ page_id: string }>();
  const page = revision.data ? await readPage(ctx, revision.data.page_id) : null;
  if (!page) return fail("Die Fassung ist wiederhergestellt; lade die Seite neu.");
  await logNoteEvent(ctx, "note.restored", `Frühere Fassung einer Notiz wiederhergestellt (Version ${input.version} → ${page.version})`, page.customerId);
  return { ok: true, data: page };
}

const PRESENT_SECONDS = 40;

/**
 * „bearbeitet gerade“: marks the person on a page they may write (every 15 seconds while it is open), removes the mark
 * when they leave, and says who else is on it. Pages one may only read leave no mark.
 */
export async function presenceAs(ctx: NotesContext, input: { pageId: string; editing: boolean; leave?: boolean }): Promise<NoteResult<{ id: string; name: string }[]>> {
  if (!isUuid(input?.pageId)) return { ok: true, data: [] };
  if (input.leave) {
    await ctx.session.from("hub_note_presence").delete().eq("page_id", input.pageId).eq("user_id", ctx.userId);
    return { ok: true, data: [] };
  }
  // Who may edit marks the page (the rules of hub_note_presence decide; customers too where they write along).
  if (input.editing) {
    await ctx.session.from("hub_note_presence").upsert({ page_id: input.pageId, user_id: ctx.userId, seen_at: new Date().toISOString() }, { onConflict: "page_id,user_id" });
  }
  const since = new Date(Date.now() - PRESENT_SECONDS * 1000).toISOString();
  const { data } = await ctx.session.from("hub_note_presence").select("user_id").eq("page_id", input.pageId).gt("seen_at", since).neq("user_id", ctx.userId).limit(10).returns<{ user_id: string }[]>();
  const ids = (data ?? []).map((row) => row.user_id);
  if (!ids.length) return { ok: true, data: [] };
  const names = await namesOf(ctx, ids);
  // Old marks of anyone go after a day (with the hub's key: everybody removes only their own).
  if (ctx.db && Math.random() < 0.05) await ctx.db.from("hub_note_presence").delete().lt("seen_at", new Date(Date.now() - 86_400_000).toISOString()).then(() => undefined, () => undefined);
  return { ok: true, data: ids.map((id) => ({ id, name: names[id] ?? (ctx.viewer === "customer" ? "oalab" : "Jemand") })) };
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);
type HitRow = { id: string; title: string; icon: string; customer_id: string; content_text: string | null; updated_at: string };

/** The hub's search: pages whose title or text holds the words, only what the person sees, newest first. */
export async function searchNotesAs(ctx: NotesContext, input: { query: string }): Promise<NoteResult<NoteSearchHit[]>> {
  const term = String(input?.query ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (term.length < 2) return { ok: true, data: [] };
  const pattern = `%${escapeLike(term)}%`;
  const fields = "id, title, icon, customer_id, content_text, updated_at";
  // Two simple searches instead of one combined filter: the words never become part of a filter expression.
  const [byTitle, byText, customers, archive] = await Promise.all([
    ctx.session.from("hub_note_pages").select(fields).is("deleted_at", null).ilike("title", pattern).order("updated_at", { ascending: false }).limit(8).returns<HitRow[]>(),
    ctx.session.from("hub_note_pages").select(fields).is("deleted_at", null).ilike("content_text", pattern).order("updated_at", { ascending: false }).limit(8).returns<HitRow[]>(),
    notesCustomers(ctx),
    ctx.viewer === "admin" ? loadArchive() : null,
  ]);
  if (byTitle.error && byText.error) return { ok: true, data: [] };
  const names = new Map((customers ?? []).map((customer) => [customer.id, customer.name]));
  const seen = new Set<string>();
  const hits: NoteSearchHit[] = [];
  for (const row of [...(byTitle.data ?? []), ...(byText.data ?? [])]) {
    if (seen.has(row.id) || !names.has(row.customer_id) || archive?.customerIds.has(row.customer_id)) continue;
    seen.add(row.id);
    hits.push({ id: row.id, title: row.title, icon: row.icon, customerId: row.customer_id, customer: names.get(row.customer_id) ?? "", snippet: snippetOf(row.content_text ?? "", term) });
  }
  return { ok: true, data: hits.slice(0, 8) };
}

/** A short piece of text around the first match, on one line. */
export function snippetOf(text: string, term: string) {
  const flat = text.replace(/\s+/g, " ").trim();
  const at = flat.toLowerCase().indexOf(term.toLowerCase());
  if (at < 0) return flat.slice(0, 90);
  const from = Math.max(0, at - 30);
  return `${from > 0 ? "…" : ""}${flat.slice(from, at + term.length + 60)}${at + term.length + 60 < flat.length ? "…" : ""}`;
}
