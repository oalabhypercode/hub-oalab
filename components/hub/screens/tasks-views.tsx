"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronsRightLeft, Eye, GripVertical, ListChecks, MessageSquare, Paperclip, Plus } from "lucide-react";
import { DONE_VISIBLE, dueInfo, PRIORITY_NAMES, STATUS_EMPTY, STATUS_NAMES, TASK_STATUSES } from "@/lib/hub-tasks/rules";
import type { BoardPerson, BoardProject, BoardTask, TaskStatus } from "@/lib/hub-tasks/types";
import { Select } from "../select";
import type { DragState } from "./tasks-drag";
import { AvatarStack, CompanyMark, LabelPill, PriorityIcon, TaskGlyph } from "./tasks-parts";

/** What the board and the list draw; the screen (tasks.tsx) holds the state and does the work. */
export type TaskViewProps = {
  columns: Record<TaskStatus, BoardTask[]>;
  people: ReadonlyMap<string, BoardPerson>;
  projects: ReadonlyMap<string, BoardProject>;
  /** "Alle Projekte": cards name their project. */
  showProject: boolean;
  today: string;
  openId: string | null;
  flash: Readonly<Record<string, string>>;
  drag: DragState | null;
  collapsed: Readonly<Record<TaskStatus, boolean>>;
  showOlderDone: boolean;
  composer: TaskStatus | null;
  canEdit: boolean;
  onOpen: (task: BoardTask) => void;
  onToggleCollapsed: (status: TaskStatus) => void;
  onShowOlder: () => void;
  onCompose: (status: TaskStatus | null) => void;
  onCreate: (status: TaskStatus, title: string) => Promise<boolean>;
  onKeyMove: (task: BoardTask, key: string) => void;
  onStatus: (task: BoardTask, status: TaskStatus) => void;
};

/** The cards a column shows: the done column keeps its newest cards in view, the rest behind „ältere anzeigen“. */
function shownCards(status: TaskStatus, cards: BoardTask[], showOlderDone: boolean) {
  if (status !== "done" || showOlderDone || cards.length <= DONE_VISIBLE) return { shown: cards, hidden: 0 };
  return { shown: cards.slice(0, DONE_VISIBLE), hidden: cards.length - DONE_VISIBLE };
}

/**
 * The cards of a list with the gap where the dragged card would land. The dragged card stays in its place, hidden:
 * its element must stay in the page, or a finger's touch events would stop reaching the page and it would scroll.
 */
function withGap(status: TaskStatus, cards: BoardTask[], drag: DragState | null) {
  const others = drag ? cards.filter((card) => card.id !== drag.id).length : cards.length;
  const gap = drag?.over?.status === status ? Math.min(drag.over.index, others) : -1;
  const items: ({ kind: "card"; task: BoardTask; hidden: boolean } | { kind: "gap" })[] = [];
  let seen = 0;
  for (const task of cards) {
    const hidden = drag?.id === task.id;
    if (!hidden) {
      if (seen === gap) items.push({ kind: "gap" });
      seen += 1;
    }
    items.push({ kind: "card", task, hidden });
  }
  if (gap >= 0 && gap === seen) items.push({ kind: "gap" });
  return { items, gap };
}

function Composer({ status, onCreate, onClose }: { status: TaskStatus; onCreate: TaskViewProps["onCreate"]; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { field.current?.focus(); }, []);
  const save = async () => {
    const value = title.trim();
    if (!value || busy) return;
    setBusy(true);
    const ok = await onCreate(status, value);
    setBusy(false);
    if (ok) setTitle("");
    field.current?.focus();
  };
  return (
    <div className="kb-composer">
      <textarea ref={field} rows={2} value={title} placeholder="Was ist zu tun?" aria-label={`Titel der neuen Aufgabe in „${STATUS_NAMES[status]}“`}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void save(); }
          if (event.key === "Escape") { event.preventDefault(); onClose(); }
        }} />
      <div className="kb-composer-row">
        <small>Enter legt an · Esc bricht ab</small>
        <button type="button" className="kb-plain" onClick={onClose}>Abbrechen</button>
        <button type="button" className="sheet-action is-primary" onClick={() => void save()} disabled={busy || !title.trim()}>Anlegen</button>
      </div>
    </div>
  );
}

function CardMeta({ task, today }: { task: BoardTask; today: string }) {
  const due = dueInfo(task.dueOn, today, task.status === "done");
  return (
    <>
      <span className="kb-meta kb-num">#{task.number}</span>
      {task.priority !== "none" && <span className={`kb-meta kb-prio-${task.priority}`} data-tip={`Priorität: ${PRIORITY_NAMES[task.priority]}`}><PriorityIcon priority={task.priority} /></span>}
      {due && <span className={`kb-meta kb-due ${due.tone}`} data-tip={`Fällig ${due.long}`} data-tip-sub={due.hint}><CalendarDays size={13} aria-hidden="true" />{due.short}</span>}
      {task.checklist.total > 0 && <span className="kb-meta" data-tip="Checkliste"><ListChecks size={13} aria-hidden="true" />{task.checklist.done}/{task.checklist.total}</span>}
      {task.files > 0 && <span className="kb-meta" data-tip={task.files === 1 ? "1 Bild" : `${task.files} Bilder`}><Paperclip size={13} aria-hidden="true" />{task.files}</span>}
      {task.comments > 0 && <span className="kb-meta" data-tip={task.comments === 1 ? "1 Kommentar" : `${task.comments} Kommentare`}><MessageSquare size={13} aria-hidden="true" />{task.comments}</span>}
      {task.visible && <span className="kb-vis is-customer" data-tip="Auch der Kunde sieht diese Aufgabe" data-tip-sub="im Fenster des Projekts"><Eye size={11} strokeWidth={2.4} aria-hidden="true" />Kunde</span>}
    </>
  );
}

function Card({ task, view, hidden = false }: { task: BoardTask; view: TaskViewProps; hidden?: boolean }) {
  const project = view.showProject ? view.projects.get(task.projectId) : undefined;
  return (
    <article
      className={`kb-card${task.status === "done" ? " is-done" : ""}${view.openId === task.id ? " is-open" : ""}${hidden ? " is-hidden-drag" : ""}${view.flash[task.id] ? ` ${view.flash[task.id]}` : ""}`}
      data-card={task.id}
      tabIndex={0}
      aria-label={`${task.title}, Nummer ${task.number}, ${STATUS_NAMES[task.status]}`}
      aria-roledescription={view.canEdit ? "verschiebbare Karte" : undefined}
      onClick={() => view.onOpen(task)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.altKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); view.onKeyMove(task, event.key); }
        else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); view.onOpen(task); }
      }}
    >
      {(project || task.labels.length > 0) && (
        <div className="kb-card-labels">
          {project && <span className="kb-project-tag"><CompanyMark company={project.company} size="s" /><span>{project.name}</span></span>}
          {task.labels.map((label) => <LabelPill key={label} label={label} />)}
        </div>
      )}
      <div className="kb-card-title">{task.title}</div>
      <div className="kb-card-meta">
        <CardMeta task={task} today={view.today} />
        <AvatarStack ids={task.assigneeIds} people={view.people} />
      </div>
    </article>
  );
}

export function TaskBoard(view: TaskViewProps) {
  const template = TASK_STATUSES.map((status) => (view.collapsed[status] ? "44px" : "minmax(204px, 1fr)")).join(" ");
  return (
    <div className="kb-board" style={{ gridTemplateColumns: template }}>
      {TASK_STATUSES.map((status) => {
        const cards = view.columns[status];
        const isTarget = view.drag?.over?.status === status;
        if (view.collapsed[status]) {
          return (
            <section key={status} className={`kb-col is-collapsed${isTarget ? " is-target" : ""}`} data-col={status} data-collapsed="true" aria-label={`${STATUS_NAMES[status]}, eingeklappt, ${cards.length} Aufgaben`}>
              <button type="button" className="kb-col-head" onClick={() => view.onToggleCollapsed(status)} data-tip={`${STATUS_NAMES[status]} aufklappen`}>
                <TaskGlyph status={status} /><span className="kb-col-count">{cards.length}</span><span className="kb-col-name">{STATUS_NAMES[status]}</span>
              </button>
              <div className="kb-list" data-list={status} />
            </section>
          );
        }
        const { shown, hidden } = shownCards(status, cards, view.showOlderDone);
        const { items, gap } = withGap(status, shown, view.drag);
        return (
          <section key={status} className={`kb-col${isTarget ? " is-target" : ""}`} data-col={status} aria-label={`${STATUS_NAMES[status]}, ${cards.length} Aufgaben`}>
            <div className="kb-col-head">
              <TaskGlyph status={status} /><span className="kb-col-name">{STATUS_NAMES[status]}</span><span className="kb-col-count">{cards.length}</span>
              <span className="kb-col-tools">
                {view.canEdit && <button type="button" className="kb-mini" onClick={() => view.onCompose(status)} aria-label={`Aufgabe in ${STATUS_NAMES[status]} anlegen`} data-tip={`Neue Aufgabe in „${STATUS_NAMES[status]}“`}><Plus size={16} aria-hidden="true" /></button>}
                <button type="button" className="kb-mini" onClick={() => view.onToggleCollapsed(status)} aria-label={`${STATUS_NAMES[status]} einklappen`} data-tip="Spalte einklappen"><ChevronsRightLeft size={15} aria-hidden="true" /></button>
              </span>
            </div>
            <div className="kb-list" data-list={status}>
              {items.map((item) => item.kind === "gap"
                ? <div key="gap" className="kb-placeholder" style={{ height: gapHeight(view.drag) }} />
                : <Card key={item.task.id} task={item.task} view={view} hidden={item.hidden} />)}
              {!cards.length && view.composer !== status && gap < 0 && <div className="kb-col-empty">{STATUS_EMPTY[status]}</div>}
              {hidden > 0 && <button type="button" className="kb-older" onClick={view.onShowOlder}>{hidden} ältere anzeigen</button>}
            </div>
            {view.canEdit && (view.composer === status
              ? <Composer status={status} onCreate={view.onCreate} onClose={() => view.onCompose(null)} />
              : <button type="button" className="kb-add" onClick={() => view.onCompose(status)}><Plus size={15} aria-hidden="true" />Aufgabe</button>)}
          </section>
        );
      })}
    </div>
  );
}

const gapHeight = (drag: DragState | null) => (drag?.row ? 42 : undefined);

function Row({ task, view, hidden = false }: { task: BoardTask; view: TaskViewProps; hidden?: boolean }) {
  const project = view.showProject ? view.projects.get(task.projectId) : undefined;
  const due = dueInfo(task.dueOn, view.today, task.status === "done");
  return (
    <div
      className={`kb-row${task.status === "done" ? " is-done" : ""}${view.openId === task.id ? " is-open" : ""}${hidden ? " is-hidden-drag" : ""}${view.flash[task.id] ? ` ${view.flash[task.id]}` : ""}`}
      data-card={task.id}
      tabIndex={0}
      role="row"
      aria-label={`${task.title}, Nummer ${task.number}, ${STATUS_NAMES[task.status]}`}
      onClick={(event) => { if (!(event.target as HTMLElement).closest("button, [data-no-drag]")) view.onOpen(task); }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.altKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); view.onKeyMove(task, event.key); }
        else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); view.onOpen(task); }
      }}
    >
      <span className="kb-row-main" role="cell">
        {view.canEdit && <span className="kb-row-grip" aria-hidden="true"><GripVertical size={14} /></span>}
        {view.canEdit ? (
          <span className="kb-row-status" data-no-drag>
            <Select variant="bare" chevron={false} showLead label={`Status von „${task.title}“`} value={task.status} onChange={(value) => view.onStatus(task, value as TaskStatus)}
              options={TASK_STATUSES.map((status) => ({ value: status, label: STATUS_NAMES[status], lead: <TaskGlyph status={status} /> }))} className="kb-status-select" />
          </span>
        ) : <span className="kb-row-status"><TaskGlyph status={task.status} /></span>}
        <span className="kb-num">#{task.number}</span>
        {project && <span className="kb-project-tag"><CompanyMark company={project.company} size="s" /><span>{project.name}</span></span>}
        <span className="kb-row-title">{task.title}</span>
        {task.visible && <span className="kb-vis is-customer" data-tip="Auch der Kunde sieht diese Aufgabe"><Eye size={11} strokeWidth={2.4} aria-hidden="true" />Kunde</span>}
      </span>
      <span className="kb-row-who" role="cell">{task.assigneeIds.length ? <AvatarStack ids={task.assigneeIds} people={view.people} /> : <span className="cell-none">–</span>}</span>
      <span className="kb-row-due" role="cell">{due ? <span className={`kb-due ${due.tone}`} data-tip={`Fällig ${due.long}`} data-tip-sub={due.hint}>{due.row}</span> : <span className="cell-none">–</span>}</span>
      <span className="kb-row-prio" role="cell">{task.priority !== "none" ? <><span className={`kb-prio-${task.priority}`}><PriorityIcon priority={task.priority} /></span>{PRIORITY_NAMES[task.priority]}</> : <span className="cell-none">–</span>}</span>
      <span className="kb-row-labels kb-lv-labels" role="cell">{task.labels.map((label) => <LabelPill key={label} label={label} />)}</span>
      <span className="kb-row-act kb-lv-act" role="cell">
        {task.checklist.total > 0 && <span className="kb-meta"><ListChecks size={13} aria-hidden="true" />{task.checklist.done}/{task.checklist.total}</span>}
        {task.files > 0 && <span className="kb-meta"><Paperclip size={13} aria-hidden="true" />{task.files}</span>}
        {task.comments > 0 && <span className="kb-meta"><MessageSquare size={13} aria-hidden="true" />{task.comments}</span>}
      </span>
    </div>
  );
}

export function TaskList(view: TaskViewProps) {
  return (
    <div className={`kb-lv${view.showProject ? " is-all" : ""}`} role="table" aria-label="Aufgaben nach Status">
      <div className="kb-lv-head" role="row">
        <span role="columnheader">Aufgabe</span><span role="columnheader">Zuständig</span><span role="columnheader">Fällig</span><span role="columnheader">Priorität</span>
        <span role="columnheader" className="kb-lv-labels">Labels</span><span role="columnheader" className="kb-lv-act">Aktivität</span>
      </div>
      {TASK_STATUSES.map((status) => {
        const cards = view.columns[status];
        const collapsed = view.collapsed[status];
        const { shown, hidden } = shownCards(status, cards, view.showOlderDone);
        const { items, gap } = withGap(status, shown, view.drag);
        return (
          <section key={status} className={`kb-lv-group${collapsed ? " is-collapsed" : ""}${view.drag?.over?.status === status ? " is-target" : ""}`} data-col={status} data-collapsed={collapsed ? "true" : undefined} role="rowgroup" aria-label={`${STATUS_NAMES[status]}, ${cards.length} Aufgaben`}>
            <div className="kb-lv-ghead">
              <button type="button" className="table-group-toggle" aria-expanded={!collapsed} onClick={() => view.onToggleCollapsed(status)}>
                <ChevronDown size={15} className="table-group-chevron" aria-hidden="true" /><span className="table-group-glyph"><TaskGlyph status={status} /></span>
                <span className="table-group-label">{STATUS_NAMES[status]}</span><span className="table-group-count numeric">{cards.length}</span>
              </button>
              {view.canEdit && <span className="table-group-actions"><button type="button" className="table-group-action" onClick={() => view.onCompose(status)} aria-label={`Aufgabe in ${STATUS_NAMES[status]} anlegen`} data-tip={`Neue Aufgabe in „${STATUS_NAMES[status]}“`}><Plus size={16} aria-hidden="true" /></button></span>}
            </div>
            <div className="kb-list kb-lv-rows" data-list={status} hidden={collapsed}>
              {items.map((item) => item.kind === "gap"
                ? <div key="gap" className="kb-placeholder is-row" />
                : <Row key={item.task.id} task={item.task} view={view} hidden={item.hidden} />)}
              {!cards.length && view.composer !== status && gap < 0 && <div className="kb-lv-empty">{STATUS_EMPTY[status]}</div>}
              {hidden > 0 && <button type="button" className="kb-older" onClick={view.onShowOlder}>{hidden} ältere anzeigen</button>}
            </div>
            {!collapsed && view.canEdit && (view.composer === status
              ? <div className="kb-lv-composer"><Composer status={status} onCreate={view.onCreate} onClose={() => view.onCompose(null)} /></div>
              : <button type="button" className="kb-lv-add" onClick={() => view.onCompose(status)}><Plus size={15} aria-hidden="true" />Aufgabe</button>)}
          </section>
        );
      })}
    </div>
  );
}

