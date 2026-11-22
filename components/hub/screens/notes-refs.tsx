"use client";

import { createContext, useContext, useImperativeHandle, useState } from "react";
import { Extension, Node, mergeAttributes, type Editor } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, ReactRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { CalendarDays, CheckCircle2, Circle, ExternalLink, FolderOpen, Image as ImageIcon, Lock, SquareKanban, Video } from "lucide-react";
import { filterTasks, isTaskFilter, TASK_FILTERS, type TaskFilter } from "@/lib/hub-notes/rules";
import type { NoteAppointmentView, NoteRefs, NoteTaskView, NoteViewer } from "@/lib/hub-notes/types";

// Blocks that refer to the hub (plan 4, step 2): tasks of the board as rows in a box or as a mention in the text, a
// live task list of a project, a project with its status, and a link card. The document keeps only ids; what they show
// comes from the page's references, resolved with the viewer's rights (lib/hub-notes/refs.ts). What the viewer may
// not see shows as „Nicht freigegeben“, without its title.

export type NoteRefsUi = {
  refs: NoteRefs;
  viewer: NoteViewer;
  viewerId: string;
  /** Ticking tasks off and adding them: the team with a confirmed code and freelancers. */
  taskWriter: boolean;
  editable: boolean;
  today: string;
  toggleTask: (task: NoteTaskView) => void;
  /** Tasks and images newly put on the page (picked, created), so they show at once. */
  addTasks: (tasks: NoteTaskView[]) => void;
  addImage: (path: string, url: string) => void;
  openTask: (task: NoteTaskView) => void;
  boardHref: (projectId: string, number?: number) => string;
  searchTasks: (query: string) => Promise<NoteTaskView[]>;
  /** Step 3: appointments newly put on the page, and the way into the calendar. */
  addAppointments: (appointments: NoteAppointmentView[]) => void;
  calendarHref: (appointmentId: string) => string;
};
export const NoteRefsContext = createContext<NoteRefsUi | null>(null);

const STATUS: Record<NoteTaskView["status"], { label: string; color: string }> = {
  backlog: { label: "Backlog", color: "#e39abd" }, todo: { label: "Offen", color: "#cf5f97" }, progress: { label: "In Arbeit", color: "#b02a72" },
  review: { label: "In Prüfung", color: "#860a54" }, done: { label: "Erledigt", color: "#55003a" },
};
const shortDay = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", timeZone: "UTC" });
function dueLabel(dueOn: string | null, done: boolean, today: string) {
  if (!dueOn) return null;
  if (dueOn === today) return { text: "heute", late: !done };
  const text = shortDay.format(new Date(`${dueOn}T00:00:00Z`));
  return !done && dueOn < today ? { text: `${text} · überfällig`, late: true } : { text, late: false };
}

/** One task as a row: tick, number, title and the facts of the board. */
function TaskRow({ task, ui }: { task: NoteTaskView; ui: NoteRefsUi }) {
  const done = task.status === "done";
  const due = dueLabel(task.dueOn, done, ui.today);
  const canTick = ui.taskWriter && task.version !== null;
  return (
    <div className="nz-trow">
      <button type="button" className={`nz-circle${done ? " is-done" : ""}`} disabled={!canTick} aria-label={done ? `#${task.number} wieder öffnen` : `#${task.number} als erledigt markieren`} data-tip={canTick ? (done ? "Wieder öffnen" : "Erledigt") : undefined} onClick={() => ui.toggleTask(task)}>
        {done ? <CheckCircle2 size={20} aria-hidden="true" /> : <Circle size={20} aria-hidden="true" />}
      </button>
      <button type="button" className="nz-tmain" onClick={() => ui.openTask(task)}>
        <span className="nz-tnum">#{task.number}</span>
        <span className={`nz-ttitle${done ? " is-done" : ""}`}>{task.title}</span>
      </button>
      <span className="nz-tmeta">
        {task.customerTurn && <span className="nz-pill is-todo">{ui.viewer === "customer" ? "Du bist am Zug" : "Beim Kunden"}</span>}
        {ui.viewer === "admin" && task.audience === "team" && <span data-tip="Sichtbar für: Nur Team"><Lock size={14} aria-hidden="true" /></span>}
        {due && <span className={`nz-due${due.late ? " is-late" : ""}`}>{due.text}</span>}
        <span className="nz-status"><span className="nz-dot" style={{ background: STATUS[task.status].color }} />{STATUS[task.status].label}</span>
        {task.assignees.slice(0, 3).map((person) => <span key={person.id} className="nz-av" data-tip={person.name}>{person.initials}</span>)}
      </span>
    </div>
  );
}

function HiddenRow() {
  const ui = useContext(NoteRefsContext);
  return <div className="nz-trow is-hidden"><Lock size={16} aria-hidden="true" /><span>Nicht freigegebene Aufgabe</span><small>{ui?.viewer === "customer" ? "oalab hat sie nicht für dich freigegeben" : "nur für das oalab-Team"}</small></div>;
}

function TaskGroupView({ node }: ReactNodeViewProps) {
  const ui = useContext(NoteRefsContext);
  const first = (node.firstChild?.attrs.refId as string | undefined) ?? "";
  const project = ui?.refs.tasks[first]?.projectName;
  return (
    <NodeViewWrapper className="nz-tasks">
      <div className="nz-tasks-head" contentEditable={false}>
        <SquareKanban size={14} aria-hidden="true" /><span>{project ? `Aufgaben · ${project}` : "Aufgaben"}</span>
        {ui && ui.viewer !== "customer" && ui.refs.tasks[first] && <a className="nz-tasks-link" href={ui.boardHref(ui.refs.tasks[first]!.projectId)}>Im Board</a>}
      </div>
      <NodeViewContent className="nz-tasks-body" />
    </NodeViewWrapper>
  );
}

function TaskItemView({ node }: ReactNodeViewProps) {
  const ui = useContext(NoteRefsContext);
  const task = ui?.refs.tasks[String(node.attrs.refId ?? "")];
  return <NodeViewWrapper className="nz-titem" contentEditable={false}>{ui && task ? <TaskRow task={task} ui={ui} /> : <HiddenRow />}</NodeViewWrapper>;
}

function TaskMentionView({ node }: ReactNodeViewProps) {
  const ui = useContext(NoteRefsContext);
  const task = ui?.refs.tasks[String(node.attrs.refId ?? "")];
  if (!ui || !task) return <NodeViewWrapper as="span" className="nz-mention is-hidden"><Lock size={13} aria-hidden="true" />Nicht freigegeben</NodeViewWrapper>;
  return (
    <NodeViewWrapper as="span" className="nz-mention-wrap">
      <button type="button" className="nz-mention" data-tip={`${STATUS[task.status].label} · Klick öffnet die Aufgabe`} onClick={() => ui.openTask(task)}>
        <span className="nz-dot" style={{ background: STATUS[task.status].color }} />#{task.number} {task.title}
      </button>
    </NodeViewWrapper>
  );
}

function TaskListView({ node, updateAttributes }: ReactNodeViewProps) {
  const ui = useContext(NoteRefsContext);
  const projectId = String(node.attrs.refId ?? "");
  const filter: TaskFilter = isTaskFilter(node.attrs.filter) ? node.attrs.filter : "open";
  const dueBy = typeof node.attrs.dueBy === "string" ? node.attrs.dueBy : null;
  const tasks = ui?.refs.projectTasks[projectId];
  const project = ui?.refs.projects[projectId];
  if (!ui || !tasks || !project) return <NodeViewWrapper className="nz-tasks is-hidden" contentEditable={false}><div className="nz-trow is-hidden"><Lock size={16} aria-hidden="true" /><span>Aufgabenliste eines Projekts, das du nicht siehst</span></div></NodeViewWrapper>;
  const shown = filterTasks(tasks, filter, ui.viewerId, dueBy);
  return (
    <NodeViewWrapper className="nz-tasks" contentEditable={false}>
      <div className="nz-tasks-head">
        <SquareKanban size={14} aria-hidden="true" /><span>Aufgaben · {project.name}</span>
        <span className="nz-tasks-filter" role="group" aria-label="Welche Aufgaben">
          {TASK_FILTERS.filter((item) => ui.viewer !== "customer" || item.id !== "mine").map((item) => (
            <button key={item.id} type="button" className={`nz-chip${filter === item.id ? " is-on" : ""}`} disabled={!ui.editable} aria-pressed={filter === item.id} onClick={() => updateAttributes({ filter: item.id })}>{item.label}</button>
          ))}
          {filter === "due" && <input type="date" className="nz-chip-date" disabled={!ui.editable} value={dueBy ?? ""} aria-label="Fällig bis" onChange={(event) => updateAttributes({ dueBy: event.target.value || null })} />}
        </span>
        {ui.viewer !== "customer" && <a className="nz-tasks-link" href={ui.boardHref(projectId)}>Im Board</a>}
      </div>
      {shown.map((task) => <TaskRow key={task.id} task={task} ui={ui} />)}
      {!shown.length && <p className="nz-tasks-empty">Keine Aufgabe passt gerade.</p>}
    </NodeViewWrapper>
  );
}

function ProjectView({ node }: ReactNodeViewProps) {
  const ui = useContext(NoteRefsContext);
  const project = ui?.refs.projects[String(node.attrs.refId ?? "")];
  if (!ui || !project) return <NodeViewWrapper className="nz-project is-hidden" contentEditable={false}><Lock size={16} aria-hidden="true" /><span>Projekt, das du nicht siehst</span></NodeViewWrapper>;
  const due = project.dueOn ? shortDay.format(new Date(`${project.dueOn}T00:00:00Z`)) : "kein Zieltermin";
  return (
    <NodeViewWrapper className="nz-project" contentEditable={false}>
      <span className="nz-project-icon"><FolderOpen size={18} aria-hidden="true" /></span>
      <span className="nz-project-text"><strong>{project.name}</strong><span>{project.status} · Ziel {due}</span></span>
      <span className="nz-project-progress" aria-label={`Fortschritt ${project.progress} %`}><span className="nz-progress-bar"><span style={{ width: `${project.progress}%` }} /></span><b>{project.progress} %</b></span>
      {ui.viewer !== "customer" && <a className="nz-tasks-link" href={ui.boardHref(project.id)}>Im Board</a>}
    </NodeViewWrapper>
  );
}

function LinkCardView({ node, selected }: ReactNodeViewProps) {
  const ui = useContext(NoteRefsContext);
  const href = String(node.attrs.href ?? "");
  const title = String(node.attrs.title ?? "") || href.replace(/^https:\/\//, "");
  const site = String(node.attrs.site ?? "") || (/^https:\/\/([^/?#]+)/.exec(href)?.[1] ?? "").replace(/^www\./, "");
  const image = typeof node.attrs.image === "string" ? ui?.refs.images[node.attrs.image] : undefined;
  return (
    <NodeViewWrapper className={`nz-card-wrap${selected ? " is-selected" : ""}`} contentEditable={false}>
      <a className="nz-card" href={href} target="_blank" rel="noopener noreferrer nofollow" onClick={(event) => { if (ui?.editable && !(event.metaKey || event.ctrlKey)) event.preventDefault(); }} data-tip={ui?.editable ? "⌘/Strg + Klick öffnet die Seite" : undefined}>
        <span className="nz-card-text">
          <strong>{title}</strong>
          {node.attrs.description && <span className="nz-card-desc">{String(node.attrs.description)}</span>}
          <span className="nz-card-site"><span className="nz-fav" aria-hidden="true">{(site.charAt(0) || "·").toUpperCase()}</span>{site}<ExternalLink size={12} aria-hidden="true" /></span>
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element -- a signed link to the hub's own storage */}
        <span className="nz-card-side" aria-hidden="true">{image ? <img src={image} alt="" /> : <ImageIcon size={22} />}</span>
      </a>
    </NodeViewWrapper>
  );
}

const APPOINTMENT_STATUS: Record<NoteAppointmentView["status"], { label: string; tone: string }> = {
  requested: { label: "Angefragt", tone: "todo" }, confirmed: { label: "Bestätigt", tone: "ok" }, declined: { label: "Abgelehnt", tone: "bad" }, cancelled: { label: "Abgesagt", tone: "off" },
};
const apptDay = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Berlin" });
const apptTime = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const berlinDay = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Berlin" });

/** „/Termin“ (step 3): day, time and status from the calendar, the Teams link while it is confirmed and ahead. */
function AppointmentView({ node }: ReactNodeViewProps) {
  const ui = useContext(NoteRefsContext);
  const appointment = ui?.refs.appointments[String(node.attrs.refId ?? "")];
  if (!ui || !appointment) return <NodeViewWrapper className="nz-appt is-hidden" contentEditable={false}><Lock size={16} aria-hidden="true" /><span>Termin (nicht sichtbar)</span></NodeViewWrapper>;
  const start = new Date(appointment.start);
  const end = new Date(appointment.end);
  const status = APPOINTMENT_STATUS[appointment.status];
  // The Teams link stays until the appointment's day is over (the page renders without a clock of its own).
  const ahead = berlinDay.format(end) >= ui.today;
  return (
    <NodeViewWrapper className={`nz-appt is-${appointment.status}`} contentEditable={false}>
      <a className="nz-appt-main" href={ui.calendarHref(appointment.id)} onClick={(event) => { if (ui.editable && !(event.metaKey || event.ctrlKey)) event.preventDefault(); }} data-tip={ui.editable ? "⌘/Strg + Klick öffnet den Kalender" : "Im Kalender öffnen"}>
        <span className="nz-appt-icon"><CalendarDays size={18} aria-hidden="true" /></span>
        <span className="nz-appt-text"><strong>{appointment.title}</strong><span>{apptDay.format(start)} · {apptTime.format(start)}–{apptTime.format(end)} Uhr</span></span>
        <span className={`nz-appt-status tone-${status.tone}`}>{status.label}</span>
      </a>
      {appointment.teamsUrl && ahead && <a className="nz-appt-teams" href={appointment.teamsUrl} target="_blank" rel="noopener noreferrer"><Video size={15} aria-hidden="true" />Teams-Meeting beitreten</a>}
    </NodeViewWrapper>
  );
}

const refAttrs = (kind: string) => ({
  refKind: { default: kind, renderHTML: () => ({ "data-ref-kind": kind }) },
  refId: { default: null, parseHTML: (element: HTMLElement) => element.getAttribute("data-ref-id"), renderHTML: (attrs: Record<string, unknown>) => ({ "data-ref-id": attrs.refId }) },
});

export const NoteTaskGroup = Node.create({
  name: "noteTaskGroup",
  group: "block",
  content: "noteTaskItem+",
  isolating: true,
  parseHTML() { return [{ tag: "div[data-note-tasks]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-note-tasks": "" }), 0]; },
  addNodeView() { return ReactNodeViewRenderer(TaskGroupView); },
});

export const NoteTaskItem = Node.create({
  name: "noteTaskItem",
  atom: true,
  selectable: true,
  addAttributes() { return { ...refAttrs("task"), number: { default: null } }; },
  parseHTML() { return [{ tag: "div[data-note-task]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-note-task": "" })]; },
  renderText({ node }) { return node.attrs.number ? `#${node.attrs.number}` : ""; },
  addNodeView() { return ReactNodeViewRenderer(TaskItemView); },
});

export const NoteTaskMention = Node.create({
  name: "noteTaskMention",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() { return { ...refAttrs("task"), number: { default: null } }; },
  parseHTML() { return [{ tag: "span[data-note-task-mention]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes(HTMLAttributes, { "data-note-task-mention": "" })]; },
  renderText({ node }) { return node.attrs.number ? `#${node.attrs.number}` : ""; },
  addNodeView() { return ReactNodeViewRenderer(TaskMentionView); },
});

export const NoteTaskList = Node.create({
  name: "noteTaskList",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() { return { ...refAttrs("project"), filter: { default: "open" }, dueBy: { default: null } }; },
  parseHTML() { return [{ tag: "div[data-note-task-list]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-note-task-list": "" })]; },
  addNodeView() { return ReactNodeViewRenderer(TaskListView); },
});

export const NoteProject = Node.create({
  name: "noteProject",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() { return refAttrs("project"); },
  parseHTML() { return [{ tag: "div[data-note-project]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-note-project": "" })]; },
  addNodeView() { return ReactNodeViewRenderer(ProjectView); },
});

export const NoteLinkCard = Node.create({
  name: "noteLinkCard",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() { return { href: { default: null }, title: { default: null }, description: { default: null }, site: { default: null }, image: { default: null } }; },
  parseHTML() { return [{ tag: "div[data-note-link-card]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-note-link-card": "" })]; },
  renderText({ node }) { return String(node.attrs.href ?? ""); },
  addNodeView() { return ReactNodeViewRenderer(LinkCardView); },
});

export const NoteAppointment = Node.create({
  name: "noteAppointment",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() { return refAttrs("appointment"); },
  parseHTML() { return [{ tag: "div[data-note-appointment]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-note-appointment": "" })]; },
  addNodeView() { return ReactNodeViewRenderer(AppointmentView); },
});

// ---- „#“ finds tasks ----------------------------------------------------------------------------------------------

type HashHandle = { onKeyDown: (event: KeyboardEvent) => boolean };
type HashProps = { items: NoteTaskView[]; command: (item: NoteTaskView) => void; query: string; handleRef: React.RefObject<HashHandle | null> };

function HashMenu({ items, command, query, handleRef }: HashProps) {
  const [active, setActive] = useState(0);
  const [lastQuery, setLastQuery] = useState(query);
  if (lastQuery !== query) { setLastQuery(query); setActive(0); }
  useImperativeHandle(handleRef, () => ({
    onKeyDown: (event) => {
      if (event.key === "ArrowDown") { setActive((value) => (value + 1) % Math.max(items.length, 1)); return true; }
      if (event.key === "ArrowUp") { setActive((value) => (value - 1 + items.length) % Math.max(items.length, 1)); return true; }
      if (event.key === "Enter" && items[active]) { command(items[active]); return true; }
      return false;
    },
  }), [items, active, command]);
  return (
    <div className="nz-menu nz-glass" role="listbox" aria-label="Aufgabe einfügen" onMouseDown={(event) => event.preventDefault()}>
      <div className="nz-menu-caption">Aufgabe einfügen</div>
      {items.map((task, index) => (
        <button key={task.id} type="button" role="option" aria-selected={index === active} className={`nz-menu-item${index === active ? " is-active" : ""}`} onMouseEnter={() => setActive(index)} onClick={() => command(task)}>
          <span className="nz-menu-icon"><span className="nz-tnum">#{task.number}</span></span>
          <span className="nz-menu-text"><strong>{task.title}</strong><span>{STATUS[task.status].label} · {task.projectName}</span></span>
        </button>
      ))}
      {!items.length && <p className="nz-menu-empty">{query ? "Keine passende Aufgabe, die du sehen darfst." : "Nummer oder Titel tippen …"}</p>}
      <div className="nz-menu-foot">Enter fügt ein · Esc schließt</div>
    </div>
  );
}

export const hashKey = new PluginKey("noteHash");

type HashStorage = { search: (query: string) => Promise<NoteTaskView[]> };
const hashStorage = (editor: Editor) => (editor.storage as unknown as Record<string, HashStorage>).noteHash;
/** The page hands the editor its task search (it changes with the customer). */
export function setTaskSearch(editor: Editor, search: (query: string) => Promise<NoteTaskView[]>) {
  hashStorage(editor).search = search;
}

/** „#“ plus number or words: tasks of the customer's projects the person may see; Enter puts a mention in the text. */
export function createHashExtension() {
  return Extension.create<Record<string, never>, HashStorage>({
    name: "noteHash",
    addStorage() {
      return { search: async () => [] };
    },
    addProseMirrorPlugins() {
      return [
        Suggestion<NoteTaskView, NoteTaskView>({
          editor: this.editor,
          pluginKey: hashKey,
          char: "#",
          allowSpaces: true,
          placement: "bottom-start",
          debounce: 180,
          items: ({ query, editor }) => hashStorage(editor).search(query),
          command: ({ editor, range, props }) => {
            editor.chain().focus().deleteRange(range).insertContent([{ type: "noteTaskMention", attrs: { refKind: "task", refId: props.id, number: props.number } }, { type: "text", text: " " }]).run();
          },
          // Not at the start of a line: „# “ there makes a heading.
          allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code && range.from > state.doc.resolve(range.from).start(),
          render: () => {
            let renderer: ReactRenderer | null = null;
            let unmount: (() => void) | undefined;
            const handleRef: React.RefObject<HashHandle | null> = { current: null };
            return {
              onStart: (props: SuggestionProps<NoteTaskView, NoteTaskView>) => {
                renderer = new ReactRenderer(HashMenu, { editor: props.editor, props: { items: props.items, command: props.command, query: props.query, handleRef } });
                unmount = props.mount(renderer.element as HTMLElement);
              },
              onUpdate: (props: SuggestionProps<NoteTaskView, NoteTaskView>) => renderer?.updateProps({ items: props.items, command: props.command, query: props.query, handleRef }),
              onKeyDown: (props: SuggestionKeyDownProps) => {
                if (props.event.key === "Escape") { unmount?.(); unmount = undefined; renderer?.destroy(); renderer = null; return true; }
                return handleRef.current?.onKeyDown(props.event) ?? false;
              },
              onExit: () => { unmount?.(); unmount = undefined; renderer?.destroy(); renderer = null; },
            };
          },
        }),
      ];
    },
  });
}
