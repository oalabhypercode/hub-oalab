"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, NotebookPen, Plus } from "lucide-react";
import { createMeetingNote, createNotePage, projectNotes, taskMentions } from "@/lib/hub-notes/actions";
import { hubHref } from "@/lib/hub-data";
import { EmojiGlyph } from "./notes-blocks";

// Back references to the notes (plan 4.5): „Erwähnt in“ at a task (board and calendar) and „Notizen“ in a project's
// window. Both ask the server, which reads with the person's own session, so only pages they may see appear.

type PageLink = { id: string; title: string; icon: string; customerId: string };

const noteHref = (preview: boolean, page: PageLink) => `${hubHref(preview, "projects")}/notes?customer=${encodeURIComponent(page.customerId)}&page=${encodeURIComponent(page.id)}`;

function Row({ page, preview }: { page: PageLink; preview: boolean }) {
  return (
    <Link className="nz-link-row" href={noteHref(preview, page)}>
      <span className="nz-row-icon">{page.icon ? <EmojiGlyph char={page.icon} size={16} /> : <FileText size={16} aria-hidden="true" />}</span>
      <span>{page.title}</span>
    </Link>
  );
}

/** „Erwähnt in“: the notes that name this task. Nothing in the preview, which has no notes for its board. */
export function NoteMentions({ taskId, preview }: { taskId: string; preview: boolean }) {
  const [pages, setPages] = useState<PageLink[] | null>(preview ? [] : null);
  useEffect(() => {
    if (preview) return;
    let live = true;
    void taskMentions({ taskId }).then((result) => { if (live) setPages(result.ok ? result.data : []); });
    return () => { live = false; };
  }, [taskId, preview]);
  if (!pages?.length) return null;
  return (
    <section className="um-sec nz-links">
      <div className="um-sec-head"><h3><NotebookPen size={15} aria-hidden="true" />Erwähnt in</h3></div>
      {pages.map((page) => <Row key={page.id} page={page} preview={preview} />)}
    </section>
  );
}

/**
 * „Notizen“ in a project's window: its pages the person sees and, for the team and freelancers, „Neue Notiz zu diesem
 * Projekt“, which opens the new page in the notes.
 */
export function ProjectNotes({ projectId, customerId, preview, canCreate }: { projectId: string; customerId: string | null | undefined; preview: boolean; canCreate: boolean }) {
  const router = useRouter();
  const [pages, setPages] = useState<PageLink[] | null>(preview ? [] : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (preview) return;
    let live = true;
    void projectNotes({ projectId }).then((result) => { if (live) setPages(result.ok ? result.data : []); });
    return () => { live = false; };
  }, [projectId, preview]);
  const create = async () => {
    if (!customerId || busy) return;
    setBusy(true);
    const result = await createNotePage({ customerId, projectId });
    setBusy(false);
    if (result.ok) router.push(noteHref(preview, { id: result.data.id, title: result.data.title, icon: "", customerId }));
    else setError(result.error);
  };
  if (!canCreate && !pages?.length) return null;
  return (
    <section className="um-sec nz-links">
      <div className="um-sec-head"><h3><NotebookPen size={15} aria-hidden="true" />Notizen</h3></div>
      {pages?.map((page) => <Row key={page.id} page={page} preview={preview} />)}
      {pages && !pages.length && <p className="nz-links-empty">Noch keine Notiz zu diesem Projekt.</p>}
      {canCreate && customerId && !preview && <button type="button" className="nz-link-row is-new" disabled={busy} onClick={() => void create()}><Plus size={16} aria-hidden="true" /><span>{busy ? "Legt an …" : "Neue Notiz zu diesem Projekt"}</span></button>}
      {error && <p className="nz-links-empty" role="alert">{error}</p>}
    </section>
  );
}

/**
 * „Besprechungsnotiz“ at an appointment in the calendar (plan 5.2): the team creates it (one per appointment, „Nur
 * Team“, with the meeting template) or opens it; customers see „Notiz öffnen“ only once the page is shared with them.
 */
export function MeetingNote({ appointmentId, note, canCreate, preview }: { appointmentId: string; note: { id: string; customerId: string; title: string } | null; canCreate: boolean; preview: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!note && !canCreate) return null;
  const create = async () => {
    if (busy) return;
    if (preview) { setError("In der Vorschau wird keine Notiz angelegt."); return; }
    setBusy(true);
    const result = await createMeetingNote({ appointmentId });
    setBusy(false);
    if (result.ok) router.push(noteHref(preview, { id: result.data.id, title: "", icon: "", customerId: result.data.customerId }));
    else setError(result.error);
  };
  return (
    <section className="um-sec nz-links">
      <div className="um-sec-head"><h3><NotebookPen size={15} aria-hidden="true" />Besprechungsnotiz</h3></div>
      {note ? (
        <Link className="nz-link-row" href={noteHref(preview, { id: note.id, title: note.title, icon: "", customerId: note.customerId })}>
          <span className="nz-row-icon"><NotebookPen size={16} aria-hidden="true" /></span><span>Notiz öffnen<small className="nz-link-sub">{note.title}</small></span>
        </Link>
      ) : (
        <button type="button" className="nz-link-row is-new" disabled={busy} onClick={() => void create()}><Plus size={16} aria-hidden="true" /><span>{busy ? "Legt an …" : "Notiz anlegen"}</span></button>
      )}
      {!note && <p className="nz-links-empty">Mit der Vorlage Besprechung, zuerst nur für das Team sichtbar.</p>}
      {error && <p className="nz-links-empty" role="alert">{error}</p>}
    </section>
  );
}
