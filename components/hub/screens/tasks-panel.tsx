"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, CalendarDays, Check, Eye, FileText, History, ImageIcon, Link2, ListChecks, Lock, MessageSquare, Plus, Send, SignalHigh, Tag, Trash2, Users, X } from "lucide-react";
import { addComment, deleteSubtask, loadTaskDetail, saveSubtask, taskFileLink } from "@/lib/hub-tasks/actions";
import { taskDetailFixture } from "@/lib/hub-tasks/fixtures";
import { audienceOf, dueInfo, MAX_TITLE, PRIORITY_NAMES, STATUS_NAMES, TASK_PRIORITIES, TASK_STATUSES } from "@/lib/hub-tasks/rules";
import type { BoardPerson, BoardProject, BoardTask, TaskAudience, TaskComment, TaskDetail, TaskPatch, TaskPriority, TaskStatus, TaskSubtask } from "@/lib/hub-tasks/types";
import { MiniLoader } from "@/components/brand-loader";
import { useInfo } from "../info-box";
import { Select, SuggestInput } from "../select";
import { AssetPanel } from "./asset-panel";
import { Avatar, CompanyMark, LabelPill, PriorityIcon, RoleTag, TaskGlyph } from "./tasks-parts";

const moment = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dayLong = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "numeric", month: "long", year: "numeric" });
const when = (iso: string) => { const value = Date.parse(iso); return Number.isNaN(value) ? "" : moment.format(value); };

/** Grows with its text, like the hub's other free-text fields. */
function useAutosize(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const area = ref.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
  }, [value]);
  return ref;
}

type Fields = { status: TaskStatus; title: string; description: string; priority: TaskPriority; dueOn: string | null; labels: string[]; assigneeIds: string[]; audience: TaskAudience };

/**
 * „Sichtbar für“: the team chooses one of three (`choose`, user 16.11.2026 as in the design); freelancers read who sees
 * the card (`text`), because what they see is decided by the team and the database.
 */
export type AudienceView = { mode: "choose"; hasFreelancers: boolean } | { mode: "text"; text: string };

const audienceOptions = (hasFreelancers: boolean) => [
  { id: "team" as const, label: "Nur Team", icon: Lock, tip: "Nur das oalab-Team" },
  // Without freelancers on the project the middle choice is the team, and whoever joins later.
  { id: "shared" as const, label: hasFreelancers ? "+ Freelancer" : "Team", icon: Users, tip: hasFreelancers ? "Team und Freelancer des Projekts" : "Team und künftige Freelancer des Projekts" },
  { id: "customer" as const, label: "+ Kunde", icon: Eye, tip: "Zusätzlich der Kunde im Projektfenster" },
];

function AudienceChoice({ value, hasFreelancers, disabled, onChange }: { value: TaskAudience; hasFreelancers: boolean; disabled: boolean; onChange: (value: TaskAudience) => void }) {
  return (
    <span className="kb-seg3" role="group" aria-label="Sichtbar für">
      {audienceOptions(hasFreelancers).map(({ id, label, icon: Icon, tip }) => (
        <button key={id} type="button" aria-pressed={value === id} disabled={disabled} data-tip={tip} onClick={() => value !== id && onChange(id)}>
          <Icon size={13} strokeWidth={2.2} aria-hidden="true" />{label}
        </button>
      ))}
    </span>
  );
}

/** The properties shared by the task window and „Neue Aufgabe“. */
function Properties({ fields, assignees, people, knownLabels, today, canEdit, audience, onChange }: {
  fields: Fields;
  /** Who may be assigned: the team, then the project's freelancers (rules.ts assignableIn). */
  assignees: BoardPerson[];
  people: ReadonlyMap<string, BoardPerson>;
  knownLabels: string[];
  today: string;
  canEdit: boolean;
  audience: AudienceView;
  onChange: (patch: Partial<Fields>) => void;
}) {
  const [label, setLabel] = useState("");
  const info = useInfo("Sichtbar für", {
    steps: [
      <><b>Nur Team:</b> Freelancer und Kunde sehen sie nicht.</>,
      <><b>+ Freelancer:</b> alle Beteiligten des Projekts.</>,
      <><b>+ Kunde:</b> zusätzlich im Projektfenster des Kunden.</>,
    ],
    ask: "Wer sieht welche Aufgaben im Board?",
  });
  const free = assignees.filter((person) => !fields.assigneeIds.includes(person.id));
  const addLabel = () => {
    const value = label.replace(/\s+/g, " ").trim();
    if (!value) return;
    if (!fields.labels.some((known) => known.toLowerCase() === value.toLowerCase())) onChange({ labels: [...fields.labels, value] });
    setLabel("");
  };
  const due = dueInfo(fields.dueOn, today, fields.status === "done");
  return (
    <dl className="kb-props">
      <dt><Users size={15} aria-hidden="true" />Zuständig</dt>
      <dd>
        {fields.assigneeIds.map((id) => (
          <span key={id} className="kb-chip"><Avatar person={people.get(id)} />{people.get(id)?.name.split(" ")[0] ?? "Unbekannt"}
            {canEdit && <button type="button" onClick={() => onChange({ assigneeIds: fields.assigneeIds.filter((value) => value !== id) })} aria-label={`${people.get(id)?.name ?? "Person"} entfernen`}><X size={12} aria-hidden="true" /></button>}
          </span>
        ))}
        {canEdit && free.length > 0 && (
          <span className="kb-add-select">
            <Select variant="bare" chevron={false} label="Person zuweisen" placeholder={fields.assigneeIds.length ? "+" : "Person zuweisen"} value="" onChange={(id) => onChange({ assigneeIds: [...fields.assigneeIds, id] })}
              options={free.map((person) => ({ value: person.id, label: person.name, lead: <Avatar person={person} />, group: person.kind === "freelancer" ? "Freelancer im Projekt" : "oalab-Team", meta: person.kind === "freelancer" ? "Freelancer" : undefined }))} />
          </span>
        )}
        {!fields.assigneeIds.length && !canEdit && <span className="kb-muted">Niemand</span>}
      </dd>

      <dt><CalendarDays size={15} aria-hidden="true" />Fällig</dt>
      <dd>
        {canEdit
          ? <input type="date" className="am-input kb-date" value={fields.dueOn ?? ""} aria-label="Fällig am" onChange={(event) => onChange({ dueOn: event.target.value || null })} />
          : <span>{fields.dueOn ? dayLong.format(Date.parse(`${fields.dueOn}T12:00:00Z`)) : "Kein Datum"}</span>}
        {due && <span className={`kb-due-hint ${due.tone}`}>{due.hint}</span>}
        {canEdit && fields.dueOn && <button type="button" className="kb-plain" onClick={() => onChange({ dueOn: null })}>Kein Datum</button>}
      </dd>

      <dt><SignalHigh size={15} aria-hidden="true" />Priorität</dt>
      <dd>
        {canEdit
          ? <Select variant="bare" chevron label="Priorität" value={fields.priority} onChange={(value) => onChange({ priority: value as TaskPriority })}
            options={TASK_PRIORITIES.map((priority) => ({ value: priority, label: PRIORITY_NAMES[priority], lead: priority === "none" ? <span className="kb-prio-none" /> : <span className={`kb-prio-${priority}`}><PriorityIcon priority={priority} /></span> }))} />
          : <span>{PRIORITY_NAMES[fields.priority]}</span>}
      </dd>

      <dt><Tag size={15} aria-hidden="true" />Labels</dt>
      <dd>
        {fields.labels.map((item) => <LabelPill key={item} label={item} onRemove={canEdit ? () => onChange({ labels: fields.labels.filter((value) => value !== item) }) : undefined} />)}
        {canEdit && (
          <span className="kb-label-add">
            <SuggestInput value={label} onValueChange={setLabel} suggestions={knownLabels.filter((item) => !fields.labels.includes(item))} label="Label hinzufügen" placeholder="Label + Enter" className="am-input kb-label-input" maxLength={64}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addLabel(); } }} onBlur={addLabel} />
          </span>
        )}
        {!fields.labels.length && !canEdit && <span className="kb-muted">Keine</span>}
      </dd>

      <dt><Eye size={15} aria-hidden="true" />Sichtbar für</dt>
      <dd className="kb-visible">
        {audience.mode === "choose" ? <>
          <AudienceChoice value={fields.audience} hasFreelancers={audience.hasFreelancers} disabled={!canEdit} onChange={(value) => onChange({ audience: value })} />
          {info.button}
          {info.box}
        </> : <span className="kb-readonly-note">{fields.audience === "customer" ? <Eye size={14} aria-hidden="true" /> : <Users size={14} aria-hidden="true" />}{audience.text}</span>}
      </dd>
    </dl>
  );
}

function StatusBar({ value, onChange, disabled }: { value: TaskStatus; onChange: (status: TaskStatus) => void; disabled: boolean }) {
  return (
    <div className="kb-steps" role="group" aria-label="Status">
      {TASK_STATUSES.map((status) => (
        <button key={status} type="button" className="kb-step" aria-pressed={value === status} disabled={disabled} onClick={() => value !== status && onChange(status)}>
          <TaskGlyph status={status} size={12} />{STATUS_NAMES[status]}
        </button>
      ))}
    </div>
  );
}

/** One card's window: its status as steps, its properties, description, checklist, images, history and comments. */
export function TaskPanel({ task, project, people, assignees, knownLabels, today, preview, viewerId, canEdit, canArchive, audience, readers, confirmHref, onClose, onPatch, onMove, onArchive, onCopyLink, onCounts }: {
  task: BoardTask;
  project: BoardProject | undefined;
  people: ReadonlyMap<string, BoardPerson>;
  /** Who may be assigned in this card's project. */
  assignees: BoardPerson[];
  knownLabels: string[];
  today: string;
  preview: boolean;
  /** The signed-in person: the author of new comments in the preview. */
  viewerId: string;
  canEdit: boolean;
  /** Only the team archives; freelancers never see the button (and the database refuses it). */
  canArchive: boolean;
  audience: AudienceView;
  /** Who reads the comments, under the comment field (rules.ts commentReaders). */
  readers: string;
  /**
   * Read-only because the session has not confirmed a code: the way to the code page, as above the board. The window
   * covers that note on the right (seen live 16.11.2026), so its footer offers the code as well. Null otherwise.
   */
  confirmHref: string | null;
  onClose: () => void;
  onPatch: (patch: TaskPatch) => Promise<boolean>;
  onMove: (status: TaskStatus) => void;
  onArchive: () => Promise<boolean>;
  onCopyLink: () => void;
  /** The card's counters follow what happens in the window (comments, checklist). */
  onCounts: (counts: Partial<Pick<BoardTask, "comments" | "checklist">>) => void;
}) {
  // The window is keyed by its card (tasks.tsx), so it starts fresh for every card; the preview has its examples at once.
  const [detail, setDetail] = useState<TaskDetail | null>(() => (preview ? taskDetailFixture(task) : null));
  const [error, setError] = useState("");
  const [title, setTitle] = useState(task.title);
  const [titleSeen, setTitleSeen] = useState(task.title);
  const [description, setDescription] = useState(() => (preview ? taskDetailFixture(task).description : ""));
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [point, setPoint] = useState("");
  const [archiving, setArchiving] = useState(false);
  const titleRef = useAutosize(title);
  const commentRef = useAutosize(comment);
  const descriptionDirty = useRef(false);

  // A newer title from the server (somebody else renamed the card) replaces the field.
  if (task.title !== titleSeen) {
    setTitleSeen(task.title);
    setTitle(task.title);
  }
  useEffect(() => {
    if (preview) return;
    let active = true;
    void loadTaskDetail({ taskId: task.id }).then((result) => {
      if (!active) return;
      if (result.ok) { setDetail(result.data); setDescription(result.data.description); descriptionDirty.current = false; }
      else setError(result.error);
    });
    return () => { active = false; };
  }, [task.id, preview]);

  const subtasks = detail?.subtasks ?? [];
  const setSubtasks = (next: TaskSubtask[]) => {
    setDetail((current) => (current ? { ...current, subtasks: next } : current));
    onCounts({ checklist: { done: next.filter((item) => item.done).length, total: next.length } });
  };

  const saveTitle = async () => {
    const value = title.replace(/\s+/g, " ").trim();
    if (!value) { setTitle(task.title); return; }
    if (value !== task.title) await onPatch({ title: value.slice(0, MAX_TITLE) });
  };
  const saveDescription = async () => {
    if (!descriptionDirty.current || !detail) return;
    descriptionDirty.current = false;
    if (description !== detail.description && await onPatch({ description })) setDetail({ ...detail, description });
  };

  const toggle = async (item: TaskSubtask) => {
    const optimistic = subtasks.map((entry) => (entry.id === item.id ? { ...entry, done: !entry.done } : entry));
    setSubtasks(optimistic);
    if (preview) return;
    const result = await saveSubtask({ taskId: task.id, subtaskId: item.id, done: !item.done, expectedVersion: item.version });
    if (result.ok) setSubtasks(optimistic.map((entry) => (entry.id === item.id ? result.data : entry)));
    else { setSubtasks(subtasks); setError(result.error); }
  };
  const addPoint = async () => {
    const value = point.replace(/\s+/g, " ").trim();
    if (!value) return;
    setPoint("");
    if (preview) { setSubtasks([...subtasks, { id: `local-${Date.now()}`, title: value, done: false, order: subtasks.length + 1, version: 1 }]); return; }
    const result = await saveSubtask({ taskId: task.id, title: value });
    if (result.ok) setSubtasks([...subtasks, result.data]);
    else { setError(result.error); setPoint(value); }
  };
  const removePoint = async (item: TaskSubtask) => {
    const rest = subtasks.filter((entry) => entry.id !== item.id);
    setSubtasks(rest);
    if (preview) return;
    const result = await deleteSubtask({ taskId: task.id, subtaskId: item.id, expectedVersion: item.version });
    if (!result.ok) { setSubtasks(subtasks); setError(result.error); }
  };

  const send = async () => {
    const body = comment.trim();
    if (!body || sending || !detail) return;
    setSending(true);
    let saved: TaskComment | null = null;
    if (preview) saved = { id: `local-${Date.now()}`, authorId: viewerId, body, createdAt: new Date().toISOString() };
    else {
      const result = await addComment({ taskId: task.id, body });
      if (result.ok) saved = result.data;
      else setError(result.error);
    }
    setSending(false);
    if (!saved) return;
    setComment("");
    const comments = [...detail.comments, saved];
    setDetail({ ...detail, comments });
    onCounts({ comments: comments.length });
  };

  const openFile = async (fileId: string) => {
    if (preview) return;
    const result = await taskFileLink({ fileId });
    if (result.ok) window.open(result.data, "_blank", "noopener,noreferrer");
    else setError(result.error);
  };

  const feed = useMemo(() => {
    if (!detail) return [];
    const created = detail.events.find((event) => event.kind === "task.insert");
    const changed = [...detail.events].reverse().find((event) => event.kind === "task.update");
    const items: { key: string; at: string; node: React.ReactNode }[] = [];
    items.push({ key: "created", at: task.createdAt, node: <div className="kb-event"><Plus size={14} aria-hidden="true" /><span><b>{people.get(created?.actorId ?? task.createdBy)?.name ?? "Jemand"}</b> hat die Aufgabe angelegt · {when(task.createdAt)}</span></div> });
    for (const entry of detail.comments) {
      const author = people.get(entry.authorId);
      items.push({
        key: entry.id,
        at: entry.createdAt,
        node: (
          <div className="kb-comment">
            <Avatar person={author} size="m" />
            <div><div className="kb-comment-head"><strong>{author?.name ?? "Unbekannt"}</strong><RoleTag person={author} /><span>{when(entry.createdAt)}</span></div><div className="kb-comment-body">{entry.body}</div></div>
          </div>
        ),
      });
    }
    items.sort((a, b) => a.at.localeCompare(b.at));
    if (changed && changed.createdAt > task.createdAt) items.push({ key: "changed", at: changed.createdAt, node: <div className="kb-event"><History size={14} aria-hidden="true" /><span>Zuletzt geändert von <b>{people.get(changed.actorId ?? "")?.name ?? "jemandem"}</b> · {when(changed.createdAt)}</span></div> });
    return items;
  }, [detail, people, task.createdAt, task.createdBy]);

  const doneCount = subtasks.filter((item) => item.done).length;
  const fields: Fields = { status: task.status, title: task.title, description, priority: task.priority, dueOn: task.dueOn, labels: task.labels, assigneeIds: task.assigneeIds, audience: audienceOf(task) };

  return (
    <AssetPanel
      className="um-panel kb-panel"
      label={`Aufgabe ${task.number}`}
      icon={<TaskGlyph status={task.status} size={20} />}
      title={`#${task.number} · ${project?.name ?? "Projekt"}`}
      subtitle={<>{project?.company}{project?.company ? " · " : ""}angelegt von {people.get(task.createdBy)?.name ?? "jemandem"}, {when(task.createdAt)}</>}
      onClose={onClose}
      actions={<>
        <button type="button" className="chat-icon-button is-muted" onClick={onCopyLink} aria-label="Link zur Aufgabe kopieren" data-tip="Link kopieren"><Link2 size={18} aria-hidden="true" /></button>
        {canEdit && canArchive && (archiving
          ? <button type="button" className="sheet-action kb-archive-confirm" onClick={async () => { if (!(await onArchive())) setArchiving(false); }}>Archivieren?</button>
          : <button type="button" className="chat-icon-button is-muted" onClick={() => setArchiving(true)} aria-label="Aufgabe archivieren" data-tip="Archivieren" data-tip-sub="verschwindet aus dem Board, bleibt im Studio"><Archive size={18} aria-hidden="true" /></button>)}
      </>}
      bar={<StatusBar value={task.status} onChange={onMove} disabled={!canEdit} />}
      footer={canEdit ? (
        <div className="kb-reply">
          <div className="kb-reply-box">
            <textarea ref={commentRef} rows={1} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Kommentar schreiben …" aria-label="Kommentar"
              onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); } }} />
            <div className="kb-reply-row">
              <small>{fields.audience === "team" ? <Lock size={12} aria-hidden="true" /> : <Users size={12} aria-hidden="true" />} {readers}</small>
              <button type="button" className="sheet-action is-primary" onClick={() => void send()} disabled={sending || !comment.trim() || !detail}>{sending ? <MiniLoader size={14} /> : <Send size={14} aria-hidden="true" />}Senden</button>
            </div>
          </div>
        </div>
      ) : confirmHref ? (
        <div className="kb-locked" role="status">
          <Lock size={15} aria-hidden="true" />
          <span><b>Nur lesen.</b> Bearbeiten und Kommentieren gehen nach einem Code aus der Mail.</span>
          <a className="sheet-action is-primary" href={confirmHref}>Mit Code bestätigen</a>
        </div>
      ) : undefined}
    >
      <textarea ref={titleRef} className="kb-title-input" rows={1} value={title} readOnly={!canEdit} aria-label="Titel" maxLength={MAX_TITLE}
        onChange={(event) => setTitle(event.target.value)} onBlur={() => void saveTitle()}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } if (event.key === "Escape") { event.stopPropagation(); setTitle(task.title); event.currentTarget.blur(); } }} />
      <Properties fields={fields} assignees={assignees} people={people} knownLabels={knownLabels} today={today} canEdit={canEdit} audience={audience} onChange={(patch) => void onPatch(patch)} />
      {error && <p role="alert" className="form-error">{error}</p>}

      <section className="um-sec">
        <div className="um-sec-head"><h3><FileText size={15} aria-hidden="true" />Beschreibung</h3></div>
        {detail ? (
          <textarea className="kb-desc" value={description} readOnly={!canEdit} placeholder={canEdit ? "Was ist zu tun? Links, Maße, Abgabeformat …" : "Keine Beschreibung."} aria-label="Beschreibung"
            onChange={(event) => { setDescription(event.target.value); descriptionDirty.current = true; }} onBlur={() => void saveDescription()} />
        ) : <div className="kb-skel-line" aria-hidden="true" />}
      </section>

      <section className="um-sec">
        <div className="um-sec-head"><h3><ListChecks size={15} aria-hidden="true" />Checkliste</h3>{subtasks.length > 0 && <span className="kb-sec-meta">{doneCount} von {subtasks.length}</span>}</div>
        {subtasks.length > 0 && <div className="kb-checkbar" aria-hidden="true"><span style={{ width: `${Math.round((doneCount / subtasks.length) * 100)}%` }} /></div>}
        <div className="kb-check-list">
          {subtasks.map((item) => (
            <div key={item.id} className={`kb-check${item.done ? " is-done" : ""}`}>
              <button type="button" role="checkbox" aria-checked={item.done} className="kb-check-box" disabled={!canEdit} onClick={() => void toggle(item)} aria-label={item.title}>{item.done && <Check size={13} strokeWidth={3} aria-hidden="true" />}</button>
              <span>{item.title}</span>
              {canEdit && <button type="button" className="kb-mini kb-check-x" onClick={() => void removePoint(item)} aria-label={`„${item.title}“ entfernen`} data-tip="Entfernen"><Trash2 size={14} aria-hidden="true" /></button>}
            </div>
          ))}
        </div>
        {canEdit && detail && (
          <label className="kb-check-add"><Plus size={15} aria-hidden="true" />
            <input value={point} onChange={(event) => setPoint(event.target.value)} placeholder="Punkt hinzufügen, Enter drücken" aria-label="Punkt zur Checkliste hinzufügen" maxLength={MAX_TITLE}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addPoint(); } }} />
          </label>
        )}
      </section>

      {detail && detail.files.length > 0 && (
        <section className="um-sec">
          <div className="um-sec-head"><h3><ImageIcon size={15} aria-hidden="true" />Bilder</h3><span className="kb-sec-meta">{detail.files.length}</span></div>
          <div className="kb-files">
            {detail.files.map((file) => (
              <button key={file.id} type="button" className="kb-file" onClick={() => void openFile(file.id)}>
                <span className="kb-file-icon"><ImageIcon size={18} aria-hidden="true" /></span>
                <span className="kb-file-text"><strong>{file.name}</strong><span>{people.get(file.createdBy)?.name ?? "Jemand"} · {when(file.createdAt)}</span></span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="um-sec">
        <div className="um-sec-head"><h3><MessageSquare size={15} aria-hidden="true" />Verlauf und Kommentare</h3></div>
        {detail ? <div className="kb-feed">{feed.map((item) => <div key={item.key}>{item.node}</div>)}</div> : <div className="kb-loading"><MiniLoader size={18} /></div>}
      </section>
    </AssetPanel>
  );
}

/** „Neue Aufgabe“: the same properties, nothing saved before „Aufgabe anlegen“. On „Alle Projekte“ it asks for the project. */
export function NewTaskPanel({ projects, initialProjectId, assigneesFor, audienceFor, initialAssignees, people, knownLabels, initialStatus, today, onClose, onCreate }: {
  projects: BoardProject[];
  initialProjectId: string | null;
  /** Who may be assigned in a project (the team and its freelancers). */
  assigneesFor: (projectId: string) => BoardPerson[];
  /** „Sichtbar für“ in a project: a choice for the team, a plain text for freelancers. */
  audienceFor: (projectId: string, audience: TaskAudience) => AudienceView;
  /** Freelancers start as the assignee of what they create (as in the design). */
  initialAssignees: string[];
  people: ReadonlyMap<string, BoardPerson>;
  knownLabels: string[];
  initialStatus: TaskStatus;
  today: string;
  onClose: () => void;
  onCreate: (projectId: string, status: TaskStatus, title: string, patch: TaskPatch) => Promise<boolean>;
}) {
  const [fields, setFields] = useState<Fields>({ status: initialStatus, title: "", description: "", priority: "none", dueOn: null, labels: [], assigneeIds: initialAssignees, audience: "shared" });
  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titleRef = useAutosize(fields.title);
  useEffect(() => { titleRef.current?.focus(); }, [titleRef]);
  const project = projects.find((item) => item.id === projectId);
  const assignees = project ? assigneesFor(project.id) : assigneesFor("");
  const audience = audienceFor(project?.id ?? "", fields.audience);
  const change = (patch: Partial<Fields>) => setFields((current) => ({ ...current, ...patch }));
  // Another project has other freelancers: whoever is not on it drops out of the assignees.
  const chooseProject = (value: string) => {
    const allowed = new Set(assigneesFor(value).map((person) => person.id));
    setProjectId(value);
    setFields((current) => ({ ...current, assigneeIds: current.assigneeIds.filter((id) => allowed.has(id)) }));
    setError("");
  };
  const create = async () => {
    const title = fields.title.replace(/\s+/g, " ").trim();
    if (!project) { setError("Bitte wähle das Projekt."); return; }
    if (!title) { setError("Bitte gib der Aufgabe einen Titel."); titleRef.current?.focus(); return; }
    setBusy(true);
    const ok = await onCreate(project.id, fields.status, title, { description: fields.description, priority: fields.priority, dueOn: fields.dueOn, labels: fields.labels, assigneeIds: fields.assigneeIds, ...(audience.mode === "choose" ? { audience: fields.audience } : {}) });
    setBusy(false);
    if (!ok) setError("Die Aufgabe konnte nicht angelegt werden.");
  };
  return (
    <AssetPanel
      className="um-panel kb-panel"
      label="Neue Aufgabe"
      icon={project ? <CompanyMark company={project.company} size="m" /> : <span className="kb-mark is-m is-all" aria-hidden="true"><Plus size={14} /></span>}
      title="Neue Aufgabe"
      subtitle={project ? <>{project.name} · {project.company}</> : "Projekt wählen"}
      onClose={onClose}
      bar={<StatusBar value={fields.status} onChange={(status) => change({ status })} disabled={busy} />}
      footer={<>
        <button type="button" className="kb-plain" onClick={onClose}>Abbrechen</button>
        <button type="button" className="sheet-action is-primary kb-create" onClick={() => void create()} disabled={busy}>{busy ? <MiniLoader size={14} /> : <Plus size={15} aria-hidden="true" />}Aufgabe anlegen</button>
      </>}
    >
      {!initialProjectId && (
        <div className="kb-project-field">
          <span className="am-label">Projekt</span>
          <Select label="Projekt" placeholder="Projekt wählen" value={projectId} onChange={chooseProject} search
            options={projects.map((item) => ({ value: item.id, label: item.name, group: item.company || "Ohne Kunde", lead: <CompanyMark company={item.company} size="s" /> }))} />
        </div>
      )}
      <textarea ref={titleRef} className="kb-title-input" rows={1} value={fields.title} placeholder="Titel der Aufgabe" aria-label="Titel" maxLength={MAX_TITLE}
        onChange={(event) => { change({ title: event.target.value }); setError(""); }}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void create(); } }} />
      <Properties fields={fields} assignees={assignees} people={people} knownLabels={knownLabels} today={today} canEdit audience={audience} onChange={change} />
      {error && <p role="alert" className="form-error">{error}</p>}
      <section className="um-sec">
        <div className="um-sec-head"><h3><FileText size={15} aria-hidden="true" />Beschreibung</h3></div>
        <textarea className="kb-desc" value={fields.description} placeholder="Was ist zu tun? Links, Maße, Abgabeformat …" aria-label="Beschreibung" onChange={(event) => change({ description: event.target.value })} />
      </section>
    </AssetPanel>
  );
}
