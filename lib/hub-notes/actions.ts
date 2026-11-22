"use server";

import { isUuid } from "./rules";
import { customerView, namesOf, notesContext, notesCustomers, readPage } from "./server";
import { createPageAs, fail, saveSettingsAs, savePageAs, setAudienceAs, type CreateInput } from "./write";
import type { NoteAudience, NotePage, NotePageMeta, NotePatch, NoteResult, NoteSaved, NoteSettings, NotesCustomerView } from "./types";

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

export async function setNoteAudience(input: { id: string; audience: NoteAudience }): Promise<NoteResult<{ pages: NotePageMeta[]; narrowed: number }>> {
  const ctx = await notesContext();
  return ctx ? setAudienceAs(ctx, input) : fail(noAccess);
}

export async function saveNoteSettings(patch: Partial<NoteSettings>): Promise<NoteResult<NoteSettings>> {
  const ctx = await notesContext();
  return ctx ? saveSettingsAs(ctx, patch) : fail(noAccess);
}
