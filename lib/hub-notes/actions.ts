"use server";

import { isUuid } from "./rules";
import { customerView, namesOf, notesContext, notesCustomers, readPage } from "./server";
import { coverFilesAs, createPageAs, fail, linkPreviewAs, listTrashAs, notifyChangeAs, projectNotesAs, purgePageAs, restorePageAs, saveSettingsAs, savePageAs, setAudienceAs, taskMentionsAs, trashPageAs, type CreateInput } from "./write";
import { createNoteTaskAs, noteTaskOptionsAs, searchNoteTasksAs, setNoteTaskDoneAs, type NoteTaskInput } from "./tasks";
import type { NoteAudience, NoteLinkPreview, NotePage, NotePageMeta, NotePatch, NoteProject, NoteResult, NoteSaved, NoteSettings, NotesCustomerView, NoteTaskView, NoteTrashItem } from "./types";

// Every action is a public POST endpoint: it checks who asks (lib/hub-notes/server.ts notesContext) and reads and
// writes with that person's own session, so the database's rules decide. None of them re-renders the page: the notes
// screen keeps its own state, and autosave must not reload the hub every second.

const noAccess = "Notizen öffnest du mit einem aktiven Zugang; Freelancer bestätigen ihre Anmeldung mit einem Code.";

/** The list, projects and names of another customer. */
export async function loadNotesCustomer(customerId: string): Promise<NoteResult<NotesCustomerView>> {
  const ctx = await notesContext();
  if (!ctx) return fail(noAccess);
  if (!isUuid(customerId)) return fail("Dieser Kunde ist unbekannt.");
  const customers = await notesCustomers(ctx);
  const view = customers ? await customerView(ctx, customers, customerId) : null;
  return view ? { ok: true, data: view } : fail("Die Notizen dieses Kunden konnten gerade nicht geladen werden.");
}

/** A page with its document, as the person may see it. */
export async function openNotePage(pageId: string): Promise<NoteResult<{ page: NotePage; people: Record<string, string> }>> {
  const ctx = await notesContext();
  if (!ctx) return fail(noAccess);
  const page = await readPage(ctx, pageId);
  if (!page) return fail("Diese Seite gibt es nicht mehr, oder sie ist nicht für dich freigegeben.");
  return { ok: true, data: { page, people: await namesOf(ctx, [page.updatedBy]) } };
}

export async function createNotePage(input: CreateInput): Promise<NoteResult<NotePage>> {
  const ctx = await notesContext();
  return ctx ? createPageAs(ctx, input) : fail(noAccess);
}

export async function saveNotePage(input: { id: string; version: number; patch: NotePatch }): Promise<NoteResult<NoteSaved>> {
  const ctx = await notesContext();
  return ctx ? savePageAs(ctx, input) : fail(noAccess);
}

export async function setNoteAudience(input: { id: string; audience: NoteAudience; notify?: boolean }): Promise<NoteResult<{ pages: NotePageMeta[]; narrowed: number }>> {
  const ctx = await notesContext();
  return ctx ? setAudienceAs(ctx, input) : fail(noAccess);
}

export async function saveNoteSettings(patch: Partial<NoteSettings>): Promise<NoteResult<NoteSettings>> {
  const ctx = await notesContext();
  return ctx ? saveSettingsAs(ctx, patch) : fail(noAccess);
}

// ---- Step 2 ---------------------------------------------------------------------------------------------------------

export async function notifyNoteChange(input: { id: string }): Promise<NoteResult<null>> {
  const ctx = await notesContext();
  return ctx ? notifyChangeAs(ctx, input) : fail(noAccess);
}

export async function trashNotePage(input: { id: string }): Promise<NoteResult<{ pages: NotePageMeta[] }>> {
  const ctx = await notesContext();
  return ctx ? trashPageAs(ctx, input) : fail(noAccess);
}

export async function loadNoteTrash(input: { customerId: string }): Promise<NoteResult<NoteTrashItem[]>> {
  const ctx = await notesContext();
  return ctx ? listTrashAs(ctx, input) : fail(noAccess);
}

export async function restoreNotePage(input: { id: string }): Promise<NoteResult<{ pages: NotePageMeta[] }>> {
  const ctx = await notesContext();
  return ctx ? restorePageAs(ctx, input) : fail(noAccess);
}

export async function purgeNotePage(input: { id: string }): Promise<NoteResult<null>> {
  const ctx = await notesContext();
  return ctx ? purgePageAs(ctx, input) : fail(noAccess);
}

export async function noteTaskOptions(input: { customerId: string; projectId?: string | null }): Promise<NoteResult<{ projects: NoteProject[]; people: { id: string; name: string; initials: string }[] }>> {
  const ctx = await notesContext();
  return ctx ? noteTaskOptionsAs(ctx, input) : fail(noAccess);
}

export async function createNoteTask(input: NoteTaskInput): Promise<NoteResult<NoteTaskView>> {
  const ctx = await notesContext();
  return ctx ? createNoteTaskAs(ctx, input) : fail(noAccess);
}

export async function setNoteTaskDone(input: { taskId: string; done: boolean; version: number }): Promise<NoteResult<NoteTaskView>> {
  const ctx = await notesContext();
  return ctx ? setNoteTaskDoneAs(ctx, input) : fail(noAccess);
}

export async function searchNoteTasks(input: { customerId: string; query: string }): Promise<NoteResult<NoteTaskView[]>> {
  const ctx = await notesContext();
  return ctx ? searchNoteTasksAs(ctx, input) : fail(noAccess);
}

export async function noteLinkPreview(input: { customerId: string; url: string }): Promise<NoteResult<NoteLinkPreview & { imageUrl: string | null }>> {
  const ctx = await notesContext();
  return ctx ? linkPreviewAs(ctx, input) : fail(noAccess);
}

export async function noteCoverFiles(input: { customerId: string }): Promise<NoteResult<{ id: string; title: string; url: string | null }[]>> {
  const ctx = await notesContext();
  return ctx ? coverFilesAs(ctx, input) : fail(noAccess);
}

/** The project window's „Notizen“ (team, customers and freelancers): only pages the person sees. */
export async function projectNotes(input: { projectId: string }): Promise<NoteResult<{ id: string; title: string; icon: string; customerId: string; updatedAt: string }[]>> {
  const ctx = await notesContext();
  return ctx ? projectNotesAs(ctx, input) : { ok: true, data: [] };
}

/** „Erwähnt in“ at a task (board and calendar): only pages the person sees. */
export async function taskMentions(input: { taskId: string }): Promise<NoteResult<{ id: string; title: string; icon: string; customerId: string }[]>> {
  const ctx = await notesContext();
  return ctx ? taskMentionsAs(ctx, input) : { ok: true, data: [] };
}
