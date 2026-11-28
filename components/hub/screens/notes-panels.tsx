"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, ExternalLink, FileText, History, Lock, RotateCcw, Trash2, X } from "lucide-react";
import { editedAgo } from "@/lib/hub-notes/rules";
import { TEMPLATE_CHOICES } from "@/lib/hub-notes/templates";
import type { NotePageMeta, NoteRevision, NoteTaskView, NoteTemplateId, NoteTrashItem, NoteViewer } from "@/lib/hub-notes/types";
import { EmojiGlyph } from "./notes-blocks";
import { useDismiss } from "./notes-settings";

// The notes' side windows (plan 1.3 and 4): the trash of a customer, a task's window with „Erwähnt in“, and the
// templates an empty new page offers.

/** The red trash at the top right (and „In den Papierkorb“ in the gear) asks once, naming the subpages that go along. */
export function TrashAsk({ page, subpages, onConfirm, onClose }: { page: NotePageMeta; subpages: number; onConfirm: () => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useDismiss(box, onClose, "[data-bin-button]");
  const text = subpages
    ? `„${page.title}“ und ${subpages} ${subpages === 1 ? "Unterseite" : "Unterseiten"} liegen dann 30 Tage im Papierkorb unten in der Seitenliste und lassen sich bis dahin wiederherstellen.`
    : `„${page.title}“ liegt dann 30 Tage im Papierkorb unten in der Seitenliste und lässt sich bis dahin wiederherstellen.`;
  return (
    <div ref={box} className="nz-pop nz-bin-pop nz-glass" role="dialog" aria-label="In den Papierkorb legen?">
      <div className="nz-pop-head"><strong>In den Papierkorb legen?</strong><button type="button" className="nz-ibtn" aria-label="Schließen" onClick={onClose}><X size={16} aria-hidden="true" /></button></div>
      <p className="nz-pop-note is-pad">{text}</p>
      <div className="nz-actions is-end">
        <button type="button" className="nz-btn" onClick={onClose}>Abbrechen</button>
        <button type="button" className="nz-btn is-danger-fill" onClick={onConfirm}><Trash2 size={15} aria-hidden="true" />In den Papierkorb</button>
      </div>
    </div>
  );
}

/** The trash (team only): pages stay 30 days; restoring brings their subpages back, deleting for good removes them. */
export function TrashPanel({ items, loading, onRestore, onPurge, onClose }: { items: NoteTrashItem[]; loading: boolean; onRestore: (id: string) => void; onPurge: (id: string) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState<string | null>(null);
  useDismiss(box, onClose, "[data-trash-button]");
  return (
    <div ref={box} className="nz-pop nz-trash-pop nz-glass" role="dialog" aria-label="Papierkorb">
      <div className="nz-pop-head"><strong>Papierkorb</strong><button type="button" className="nz-ibtn" aria-label="Schließen" onClick={onClose}><X size={16} aria-hidden="true" /></button></div>
      <p className="nz-pop-note is-pad">Gelöschte Seiten bleiben 30 Tage hier, mit ihren Unterseiten. Danach sind sie endgültig weg.</p>
      {loading && <p className="nz-pop-note is-pad">Lädt …</p>}
      {!loading && !items.length && <p className="nz-pop-note is-pad">Der Papierkorb ist leer.</p>}
      <div className="nz-trash-list">
        {items.map((item) => (
          <div key={item.id} className="nz-trash-row">
            <span className="nz-row-icon">{item.icon ? <EmojiGlyph char={item.icon} size={16} /> : <FileText size={16} aria-hidden="true" />}</span>
            <span className="nz-trash-text"><strong>{item.title}</strong><span>gelöscht {editedAgo(item.deletedAt)}</span></span>
            {asking === item.id ? (
              <span className="nz-trash-ask">
                <button type="button" className="nz-btn is-danger" onClick={() => { setAsking(null); onPurge(item.id); }}>Endgültig löschen</button>
                <button type="button" className="nz-btn" onClick={() => setAsking(null)}>Abbrechen</button>
              </span>
            ) : (
              <>
                <button type="button" className="nz-ibtn" aria-label={`„${item.title}“ wiederherstellen`} data-tip="Wiederherstellen" onClick={() => onRestore(item.id)}><RotateCcw size={15} aria-hidden="true" /></button>
                <button type="button" className="nz-ibtn" aria-label={`„${item.title}“ endgültig löschen`} data-tip="Endgültig löschen" onClick={() => setAsking(item.id)}><Trash2 size={15} aria-hidden="true" /></button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<NoteTaskView["status"], string> = { backlog: "Backlog", todo: "Offen", progress: "In Arbeit", review: "In Prüfung", done: "Erledigt" };
const AUDIENCE_LABEL = { team: "Nur Team", shared: "+ Freelancer", customer: "+ Kunde" } as const;
const longDay = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

type Mention = { id: string; title: string; icon: string; customerId: string };

/**
 * A task's window next to the note: what the board shows of it, „Erwähnt in“ with the pages that name it (only those
 * the person sees), the tick, and the way into the board, where its details, checklist and comments are edited.
 */
export function TaskPeek({ task, viewer, canTick, boardHref, loadMentions, onToggle, onOpenPage, onClose }: {
  task: NoteTaskView;
  viewer: NoteViewer;
  canTick: boolean;
  boardHref: string;
  loadMentions: (taskId: string) => Promise<Mention[]>;
  onToggle: () => void;
  onOpenPage: (mention: Mention) => void;
  onClose: () => void;
}) {
  const [mentions, setMentions] = useState<Mention[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadMentions(task.id).then((found) => { if (live) setMentions(found); });
    return () => { live = false; };
  }, [task.id, loadMentions]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const done = task.status === "done";
  return (
    <aside className="nz-peek-panel nz-glass" aria-label={`Aufgabe #${task.number}`}>
      <div className="nz-pop-head">
        <strong>#{task.number} · {task.projectName}</strong>
        <button type="button" className="nz-ibtn" aria-label="Schließen" onClick={onClose}><X size={16} aria-hidden="true" /></button>
      </div>
      <div className="nz-peek-body">
        <h3 className={`nz-peek-title${done ? " is-done" : ""}`}>{task.title}</h3>
        <dl className="nz-peek-props">
          <dt>Stand</dt><dd>{STATUS_LABEL[task.status]}{task.customerTurn ? (viewer === "customer" ? " · Du bist am Zug" : " · Beim Kunden") : ""}</dd>
          <dt>Fällig</dt><dd>{task.dueOn ? longDay.format(new Date(`${task.dueOn}T00:00:00Z`)) : "Kein Datum"}</dd>
          {viewer !== "customer" && <><dt>Zuständig</dt><dd>{task.assignees.length ? task.assignees.map((person) => person.name).join(", ") : "Noch niemand"}</dd></>}
          {viewer !== "customer" && task.audience && <><dt>Sichtbar für</dt><dd>{AUDIENCE_LABEL[task.audience]}{task.audience === "team" ? <Lock size={13} aria-hidden="true" /> : null}</dd></>}
        </dl>
        <div className="nz-peek-actions">
          {canTick && <button type="button" className="nz-btn" onClick={onToggle}>{done ? <Circle size={15} aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />}{done ? "Wieder öffnen" : "Erledigt"}</button>}
          <a className="nz-btn is-primary" href={boardHref}><ExternalLink size={15} aria-hidden="true" />{viewer === "customer" ? "Im Projekt ansehen" : "Im Board öffnen"}</a>
        </div>
        <h4 className="nz-peek-sec">Erwähnt in</h4>
        {mentions === null && <p className="nz-pop-note">Lädt …</p>}
        {mentions?.map((mention) => (
          <button key={mention.id} type="button" className="nz-peek-mention" onClick={() => onOpenPage(mention)}>
            <span className="nz-row-icon">{mention.icon ? <EmojiGlyph char={mention.icon} size={16} /> : <FileText size={16} aria-hidden="true" />}</span><span>{mention.title}</span>
          </button>
        ))}
        {mentions && !mentions.length && <p className="nz-pop-note">Noch in keiner Notiz erwähnt, die du sehen kannst.</p>}
      </div>
    </aside>
  );
}

/** An empty new page offers its templates under the title (step 2): a click fills the page, „Leere Seite“ hides them. */
export function TemplateChips({ onPick }: { onPick: (id: NoteTemplateId) => void }) {
  return (
    <div className="nz-templates" role="group" aria-label="Vorlage wählen">
      <span className="nz-templates-label">Mit einer Vorlage beginnen:</span>
      {TEMPLATE_CHOICES.map((choice) => (
        <button key={choice.id} type="button" className="nz-ghost" data-tip={choice.hint} onClick={() => onPick(choice.id)}>
          {choice.icon && <EmojiGlyph char={choice.icon} size={16} />}<span>{choice.label}</span>
        </button>
      ))}
    </div>
  );
}

const whenFormat = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const REASON: Record<NoteRevision["reason"], string> = { edit: "", audience: "vor einer Änderung von „Sichtbar für“", restore: "vor dem Wiederherstellen" };

/**
 * „Verlauf“ (team, step 3): the page's former versions, newest first. One shows its text; restoring it replaces title,
 * symbol and text of the page, and the state before becomes a version itself. „Sichtbar für“ stays as it is.
 */
export function HistoryPanel({ items, error, onRestore, onClose }: { items: NoteRevision[] | null; error: string; onRestore: (revision: NoteRevision) => Promise<void>; onClose: () => void }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const revision = items?.find((item) => item.id === chosen) ?? items?.[0] ?? null;
  return (
    <aside className="nz-peek-panel nz-history nz-glass" aria-label="Verlauf">
      <div className="nz-pop-head"><strong><History size={15} aria-hidden="true" />Verlauf</strong><button type="button" className="nz-ibtn" aria-label="Schließen" onClick={onClose}><X size={16} aria-hidden="true" /></button></div>
      <p className="nz-pop-note is-pad">Frühere Fassungen: höchstens eine alle 10 Minuten beim Schreiben und immer eine vor einer Änderung von „Sichtbar für“. Sie bleiben 90 Tage.</p>
      {items === null && !error && <p className="nz-pop-note is-pad">Lädt …</p>}
      {error && <p className="nz-pop-note is-pad is-warn" role="alert">{error}</p>}
      {items && !items.length && <p className="nz-pop-note is-pad">Noch keine frühere Fassung. Sie entsteht beim nächsten Bearbeiten.</p>}
      {items && items.length > 0 && revision && (
        <div className="nz-history-body">
          <div className="nz-history-list" role="listbox" aria-label="Fassungen">
            {items.map((item) => (
              <button key={item.id} type="button" role="option" aria-selected={item.id === revision.id} className={`nz-history-row${item.id === revision.id ? " is-on" : ""}`} onClick={() => { setChosen(item.id); setAsking(false); }}>
                <strong>{whenFormat.format(new Date(item.savedAt))}</strong>
                <span>{item.savedBy ?? "Teammitglied"}{REASON[item.reason] ? ` · ${REASON[item.reason]}` : ""}</span>
              </button>
            ))}
          </div>
          <div className="nz-history-view">
            <h4 className="nz-history-title">{revision.icon ? <EmojiGlyph char={revision.icon} size={18} /> : null}{revision.title}</h4>
            <div className="nz-history-text">{revision.text || "Diese Fassung hatte noch keinen Text."}</div>
            <div className="nz-peek-actions">
              {asking ? (
                <>
                  <button type="button" className="nz-btn is-primary" disabled={busy} onClick={async () => { setBusy(true); await onRestore(revision); setBusy(false); setAsking(false); }}><RotateCcw size={15} aria-hidden="true" />{busy ? "Stellt wieder her …" : "Ja, wiederherstellen"}</button>
                  <button type="button" className="nz-btn" onClick={() => setAsking(false)}>Abbrechen</button>
                </>
              ) : <button type="button" className="nz-btn" onClick={() => setAsking(true)}><RotateCcw size={15} aria-hidden="true" />Diese Fassung wiederherstellen</button>}
            </div>
            {asking && <p className="nz-pop-note">Titel, Symbol und Text der Seite werden durch diese Fassung ersetzt. Der jetzige Stand bleibt im Verlauf.</p>}
          </div>
        </div>
      )}
    </aside>
  );
}
