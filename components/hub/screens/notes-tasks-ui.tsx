"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FolderOpen, Link2, Search, SquareKanban } from "lucide-react";
import type { NoteAudience, NoteLinkPreview, NoteProject, NoteTaskView, NoteViewer } from "@/lib/hub-notes/types";
import { taskAudienceFor } from "@/lib/hub-notes/rules";
import { Modal } from "../modal";
import { Select } from "../select";

// „Als Aufgabe anlegen“ (plan 4.2) for a checklist line, a selected text or all open points at once, and the small
// pickers of the block menu for a task, a task list, a project and a link card.

export type TaskOptions = { projects: NoteProject[]; people: { id: string; name: string; initials: string }[] };
export type TaskDraft = { title: string; projectId: string; assigneeIds: string[]; dueOn: string | null; audience: "team" | "shared" | "customer" };

const AUDIENCES: { id: TaskDraft["audience"]; label: string }[] = [{ id: "team", label: "Nur Team" }, { id: "shared", label: "+ Freelancer" }, { id: "customer", label: "+ Kunde" }];

type ConvertProps = {
  /** One title (a line or a selection) or several open points (they come checked, at most 20 go at once). */
  titles: string[];
  viewer: NoteViewer;
  pageAudience: NoteAudience;
  /** At oalab's own pages there is no customer to release a task to. */
  internal?: boolean;
  projectId: string | null;
  loadOptions: (projectId: string | null) => Promise<TaskOptions | null>;
  onCreate: (drafts: TaskDraft[]) => Promise<void>;
  onClose: () => void;
};

export function TaskConvertDialog({ titles, viewer, pageAudience, internal = false, projectId, loadOptions, onCreate, onClose }: ConvertProps) {
  const many = titles.length > 1;
  const [title, setTitle] = useState(titles[0] ?? "");
  const [picked, setPicked] = useState<boolean[]>(() => titles.map((_, index) => index < 20));
  const [options, setOptions] = useState<TaskOptions | null>(null);
  const [project, setProject] = useState<string>(projectId ?? "");
  const [assignees, setAssignees] = useState<string[]>([]);
  const [dueOn, setDueOn] = useState("");
  const [audience, setAudience] = useState<TaskDraft["audience"]>(taskAudienceFor(pageAudience));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void loadOptions(project || null).then((loaded) => {
      if (!live) return;
      if (!loaded) { setError("Die Projekte konnten gerade nicht geladen werden."); return; }
      setOptions(loaded);
      if (!project && loaded.projects[0]) setProject(loaded.projects[0].id);
    });
    return () => { live = false; };
  }, [loadOptions, project]);
  const count = picked.filter(Boolean).length;
  const valid = Boolean(project) && (many ? count > 0 && count <= 20 : title.trim().length > 0);
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    const base = { projectId: project, assigneeIds: assignees, dueOn: dueOn || null, audience: viewer === "admin" ? audience : "shared" as const };
    const drafts = many ? titles.filter((_, index) => picked[index]).slice(0, 20).map((value) => ({ ...base, title: value })) : [{ ...base, title: title.trim() }];
    await onCreate(drafts);
    setBusy(false);
  };
  return (
    <Modal title={many ? "Offene Punkte als Aufgaben" : "Als Aufgabe anlegen"} onClose={onClose} className="nz-dialog">
      {many ? (
        <div className="nz-convert-list">
          {titles.map((value, index) => (
            <label key={`${value}-${index}`} className="nz-check-row"><input type="checkbox" checked={picked[index]} onChange={(event) => setPicked((list) => list.map((on, at) => at === index ? event.target.checked : on))} /><span>{value}</span></label>
          ))}
          {count > 20 && <p className="nz-pop-note is-warn">Höchstens 20 auf einmal.</p>}
        </div>
      ) : (
        <label className="nz-field is-flat"><span>Titel</span><input value={title} maxLength={240} onChange={(event) => setTitle(event.target.value)} autoFocus /></label>
      )}
      <div className="nz-field is-flat"><span>Projekt</span>
        <Select value={project} onChange={setProject} label="Projekt" placeholder={options ? "Projekt wählen" : "Lädt …"} options={(options?.projects ?? []).map((item) => ({ value: item.id, label: item.name }))} />
      </div>
      <div className="nz-field is-flat"><span>Zuständig</span>
        <span className="nz-people">
          {(options?.people ?? []).map((person) => {
            const on = assignees.includes(person.id);
            return <button key={person.id} type="button" className={`nz-person${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => setAssignees((list) => on ? list.filter((id) => id !== person.id) : [...list, person.id])}><span className="nz-av">{person.initials}</span>{person.name.split(" ")[0]}</button>;
          })}
          {options && !options.people.length && <small className="nz-muted">Niemand wählbar</small>}
        </span>
      </div>
      <label className="nz-field is-flat"><span>Fällig</span><input type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} /></label>
      {viewer === "admin" ? (
        <div className="nz-field is-flat"><span>Sichtbar für</span>
          <span className="nz-seg" role="group" aria-label="Sichtbar für">
            {AUDIENCES.filter((item) => !internal || item.id !== "customer").map((item) => <button key={item.id} type="button" className={`nz-seg-btn${audience === item.id ? " is-on" : ""}`} aria-pressed={audience === item.id} onClick={() => setAudience(item.id)}>{item.label}</button>)}
          </span>
        </div>
      ) : <p className="nz-pop-note">Die Aufgabe sehen das Team und die Freelancer des Projekts.</p>}
      {error && <p className="nz-pop-note is-warn" role="alert">{error}</p>}
      <div className="nz-dialog-actions">
        <button type="button" className="nz-btn" onClick={onClose}>Abbrechen</button>
        <button type="button" className="nz-btn is-primary" disabled={!valid || busy} onClick={() => void submit()}>{busy ? "Legt an …" : many ? `${Math.min(count, 20)} anlegen` : "Anlegen"}</button>
      </div>
    </Modal>
  );
}

export type PickerKind = "task" | "taskList" | "project" | "linkCard";

type PickerProps = {
  kind: PickerKind;
  anchor: DOMRect;
  projects: NoteProject[];
  searchTasks: (query: string) => Promise<NoteTaskView[]>;
  loadPreview: (url: string) => Promise<{ ok: true; data: NoteLinkPreview & { imageUrl: string | null } } | { ok: false; error: string }>;
  onTask: (task: NoteTaskView) => void;
  onProject: (project: NoteProject) => void;
  onLinkCard: (card: NoteLinkPreview & { imageUrl: string | null }) => void;
  onClose: () => void;
};

/** The block menu's small windows: find a task, pick a project, or paste an address for a link card. */
export function RefPicker({ kind, anchor, projects, searchTasks, loadPreview, onTask, onProject, onLinkCard, onClose }: PickerProps) {
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [tasks, setTasks] = useState<NoteTaskView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [place, setPlace] = useState({ left: anchor.left, top: anchor.bottom + 6 });
  useLayoutEffect(() => {
    const height = box.current?.offsetHeight ?? 300;
    setPlace({ left: Math.max(8, Math.min(anchor.left, window.innerWidth - 348)), top: anchor.bottom + 6 + height > window.innerHeight - 8 ? Math.max(8, anchor.top - height - 6) : anchor.bottom + 6 });
    field.current?.focus();
  }, [anchor]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    const onPointer = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node) && !(event.target as HTMLElement).closest?.("[data-hub-select-list]")) onClose(); };
    window.addEventListener("keydown", onKey, true);
    const timer = window.setTimeout(() => document.addEventListener("pointerdown", onPointer), 0);
    return () => { window.removeEventListener("keydown", onKey, true); window.clearTimeout(timer); document.removeEventListener("pointerdown", onPointer); };
  }, [onClose]);
  useEffect(() => {
    if (kind !== "task") return;
    let live = true;
    const timer = window.setTimeout(() => void searchTasks(query).then((found) => { if (live) setTasks(found); }), 160);
    return () => { live = false; window.clearTimeout(timer); };
  }, [kind, query, searchTasks]);
  const shownProjects = projects.filter((project) => project.name.toLowerCase().includes(query.trim().toLowerCase()));
  const fetchCard = async () => {
    const value = query.trim();
    if (!value || busy) return;
    setBusy(true);
    setError("");
    const result = await loadPreview(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    setBusy(false);
    if (result.ok) onLinkCard(result.data); else setError(result.error);
  };
  const heading = kind === "task" ? "Aufgabe einfügen" : kind === "taskList" ? "Aufgabenliste eines Projekts" : kind === "project" ? "Projekt einfügen" : "Linkkarte";
  return createPortal(
    <div ref={box} className="nz-menu nz-glass nz-picker" role="dialog" aria-label={heading} style={{ left: place.left, top: place.top }}>
      <div className="nz-menu-caption">{heading}</div>
      <label className="nz-tsearch is-picker">
        {kind === "linkCard" ? <Link2 size={14} aria-hidden="true" /> : <Search size={14} aria-hidden="true" />}
        <input ref={field} value={query} placeholder={kind === "task" ? "Nummer oder Titel" : kind === "linkCard" ? "https://…" : "Projekt suchen"} onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            if (kind === "linkCard") void fetchCard();
            else if (kind === "task" && tasks[0]) onTask(tasks[0]);
            else if (kind !== "task" && shownProjects[0]) onProject(shownProjects[0]);
          }} />
      </label>
      {kind === "task" && tasks.map((task) => (
        <button key={task.id} type="button" className="nz-menu-item" onClick={() => onTask(task)}>
          <span className="nz-menu-icon"><span className="nz-tnum">#{task.number}</span></span>
          <span className="nz-menu-text"><strong>{task.title}</strong><span>{task.projectName}</span></span>
        </button>
      ))}
      {kind === "task" && !tasks.length && <p className="nz-menu-empty">Keine passende Aufgabe, die du sehen darfst.</p>}
      {(kind === "taskList" || kind === "project") && shownProjects.map((project) => (
        <button key={project.id} type="button" className="nz-menu-item" onClick={() => onProject(project)}>
          <span className="nz-menu-icon">{kind === "taskList" ? <SquareKanban size={15} aria-hidden="true" /> : <FolderOpen size={15} aria-hidden="true" />}</span>
          <span className="nz-menu-text"><strong>{project.name}</strong><span>{kind === "taskList" ? "Offene Aufgaben, lebend wie im Board" : "Status, Fortschritt und Ziel"}</span></span>
        </button>
      ))}
      {(kind === "taskList" || kind === "project") && !shownProjects.length && <p className="nz-menu-empty">Kein Projekt dieses Kunden, das du sehen darfst.</p>}
      {kind === "linkCard" && (
        <div className="nz-actions">
          {error && <span className="nz-pop-note is-warn">{error}</span>}
          <span className="nz-spacer" />
          <button type="button" className="nz-btn is-primary" disabled={!query.trim() || busy} onClick={() => void fetchCard()}>{busy ? "Lädt Vorschau …" : "Karte einfügen"}</button>
        </div>
      )}
      <div className="nz-menu-foot">{kind === "linkCard" ? "Der Hub lädt Titel, Text und Bild einmal von der Seite." : "Enter fügt ein · Esc schließt"}</div>
    </div>,
    document.body,
  );
}
