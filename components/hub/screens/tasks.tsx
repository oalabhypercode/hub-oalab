"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, ChevronLeft, LayoutGrid, LayoutList, ListFilter, Lock, Plus, SquareKanban, Tag, Users } from "lucide-react";
import { confirmSessionHref } from "@/lib/auth-redirect";
import { categories } from "@/lib/categories";
import { hubHref } from "@/lib/hub-data";
import { archiveTask, createTask, moveTask, renumberColumn, updateTask } from "@/lib/hub-tasks/actions";
import { taskFixtures } from "@/lib/hub-tasks/fixtures";
import { useStoredValue } from "@/lib/use-stored-value";
import { activeFilterCount, byBoardOrder, matchesFilters, NO_FILTERS, orderBetween, progressOf, renumbered, STATUS_NAMES, TASK_STATUSES, type AssigneeFilter, type BoardFilters, type DueFilter } from "@/lib/hub-tasks/rules";
import type { BoardPerson, BoardProject, BoardTask, TaskBoardState, TaskPatch, TaskResult, TaskStatus } from "@/lib/hub-tasks/types";
import { HeaderActions } from "../app-shell";
import { SegmentedControl } from "../controls";
import { useInfo } from "../info-box";
import { LargeTitleHeader } from "../large-title-header";
import { Select } from "../select";
import { SheetActionMenu, SheetFooter, ToolbarMenu, SheetToolbar } from "../sheet";
import { FilterSelect } from "../table-tools";
import { useTaskDrag, type DragOver } from "./tasks-drag";
import { NewTaskPanel, TaskPanel } from "./tasks-panel";
import { CompanyMark } from "./tasks-parts";
import { TaskBoard, TaskList, type TaskViewProps } from "./tasks-views";

type View = "board" | "list";
type Toast = { text: string; undo?: () => void };
const ALL = "all";
const VIEW_KEY = "oalab-tasks-view";
const COLLAPSED_KEY = "oalab-tasks-collapsed";
const PROJECT_KEY = "oalab-tasks-project";
const POLL_MS = 30_000;
const noCollapsed: Record<TaskStatus, boolean> = { backlog: false, todo: false, progress: false, review: false, done: false };

/** A local change on top of the server's row; it applies while the server's version is not newer than `base`. */
type Override = { patch: Partial<BoardTask>; base: number };
const COUNTS: (keyof BoardTask)[] = ["comments", "checklist", "files"];
const withoutCounts = (task: BoardTask): Partial<BoardTask> => Object.fromEntries(Object.entries(task).filter(([key]) => !COUNTS.includes(key as keyof BoardTask)));

/**
 * „Aufgaben“ under Projekte (user 15.11.2026): one board per project in Studio's columns, as cards or as a list.
 * Cards move at once in the browser; the change is written with the admin's session and the version the card had.
 * If somebody was faster, the board reloads instead of overwriting. Every 30 seconds the page asks the server for news.
 */
export function TasksScreen({ board, preview, asOf }: { board: TaskBoardState | undefined; preview: boolean; asOf: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const source = useMemo(() => (preview ? taskFixtures(asOf) : board ?? { projects: [], tasks: [], people: [], viewerId: "", confirmed: false, error: "Die Aufgaben konnten gerade nicht geladen werden." }), [preview, asOf, board]);
  // Without a session confirmed by a code Studio refuses every change, so the board stays read-only and offers the code.
  const locked = !source.error && !source.confirmed;
  const canEdit = !source.error && source.confirmed;
  // The code page returns to this board, project and card (a full page load: it sits outside the hub).
  const query = searchParams.toString();
  const confirmHref = locked ? confirmSessionHref(`${hubHref(preview, "projects")}/tasks${query ? `?${query}` : ""}`) : null;

  // The board = the server's rows plus what happened here since: changes (until the server knows a newer version),
  // new cards (until the server lists them) and archived cards.
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [added, setAdded] = useState<BoardTask[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const inflight = useRef(0);
  const tasks = useMemo(() => {
    const known = new Set(source.tasks.map((task) => task.id));
    const apply = (task: BoardTask) => { const change = overrides[task.id]; return change && task.version <= change.base ? { ...task, ...change.patch } : task; };
    return [...source.tasks, ...added.filter((task) => !known.has(task.id))].filter((task) => !removed.includes(task.id)).map(apply);
  }, [source.tasks, overrides, added, removed]);
  const override = useCallback((id: string, patch: Partial<BoardTask>, base: number) => setOverrides((current) => ({ ...current, [id]: { patch: { ...(current[id]?.patch ?? {}), ...patch }, base: Math.max(base, current[id]?.base ?? 0) } })), []);
  const forget = useCallback((id: string) => setOverrides((current) => { const next = { ...current }; delete next[id]; return next; }), []);

  const people = useMemo(() => new Map<string, BoardPerson>(source.people.map((person) => [person.id, person])), [source.people]);
  const team = useMemo(() => source.people.filter((person) => person.kind === "team").sort((a, b) => a.name.localeCompare(b.name, "de")), [source.people]);
  const projects = useMemo(() => new Map<string, BoardProject>(source.projects.map((project) => [project.id, project])), [source.projects]);

  // Project from the address (shareable), else the last one in this browser, else the first running project.
  const [lastProject, setLastProject] = useStoredValue(PROJECT_KEY, "");
  const valid = (id: string | null) => Boolean(id) && (id === ALL || source.projects.some((project) => project.id === id));
  const fromUrl = searchParams.get("project");
  const projectId = valid(fromUrl) ? fromUrl! : valid(lastProject) ? lastProject : source.projects.find((project) => project.status !== "complete")?.id ?? source.projects[0]?.id ?? ALL;
  const [storedView, setStoredView] = useStoredValue(VIEW_KEY, "board");
  const view: View = storedView === "list" ? "list" : "board";
  const [storedCollapsed, setStoredCollapsed] = useStoredValue(COLLAPSED_KEY, "{}");
  const collapsed = useMemo<Record<TaskStatus, boolean>>(() => { try { return { ...noCollapsed, ...JSON.parse(storedCollapsed) }; } catch { return noCollapsed; } }, [storedCollapsed]);

  const [filters, setFilters] = useState<BoardFilters>(NO_FILTERS);
  const [composer, setComposer] = useState<TaskStatus | null>(null);
  const [showOlderDone, setShowOlderDone] = useState(false);
  const [flash, setFlash] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<Toast | null>(null);
  const [draft, setDraft] = useState<TaskStatus | null>(null);
  const [error, setError] = useState("");
  const toastTimer = useRef(0);
  const root = useRef<HTMLDivElement>(null);

  const openNumber = Number(searchParams.get("task"));
  const openTask = tasks.find((task) => task.number === openNumber) ?? null;
  const today = asOf;

  const setAddress = useCallback((changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) { if (value === null) next.delete(key); else next.set(key, value); }
    const query = next.toString();
    router.replace(`${hubHref(preview, "projects")}/tasks${query ? `?${query}` : ""}`, { scroll: false });
  }, [router, searchParams, preview]);

  const showToast = useCallback((text: string, undo?: () => void) => {
    window.clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = window.setTimeout(() => setToast(null), undo ? 6000 : 3200);
  }, []);
  const glow = useCallback((id: string, kind = "fx-flash") => {
    setFlash((current) => ({ ...current, [id]: kind }));
    window.setTimeout(() => setFlash((current) => { const next = { ...current }; delete next[id]; return next; }), 1200);
  }, []);

  // News from other people: every 30 seconds while the tab is visible and nobody drags.
  const dragging = useRef(false);
  useEffect(() => {
    if (preview) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible" && !dragging.current && !inflight.current) router.refresh(); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [preview, router]);

  /** Shows a change at once, writes it, then takes the server's row (new version) or rolls back. */
  const run = useCallback(async (taskId: string, change: Partial<BoardTask>, write: (task: BoardTask) => Promise<TaskResult<BoardTask>>) => {
    const before = tasks.find((task) => task.id === taskId);
    if (!before) return false;
    override(taskId, change, before.version);
    if (preview) return true;
    inflight.current += 1;
    const result = await write(before);
    inflight.current -= 1;
    if (result.ok) {
      override(taskId, withoutCounts(result.data), result.data.version);
      return true;
    }
    forget(taskId);
    setError(result.error);
    if (result.stale) router.refresh();
    return false;
  }, [tasks, preview, router, override, forget]);

  const inScope = useCallback((task: BoardTask) => projectId === ALL || task.projectId === projectId, [projectId]);
  const scoped = useMemo(() => tasks.filter(inScope), [tasks, inScope]);
  const context = useMemo(() => ({ viewerId: source.viewerId, today, people }), [source.viewerId, today, people]);
  const counts = useMemo(() => {
    const base = scoped.filter((task) => matchesFilters(task, { ...filters, mine: false }, context));
    return { all: base.length, mine: base.filter((task) => task.assigneeIds.includes(source.viewerId)).length };
  }, [scoped, filters, context, source.viewerId]);
  const columns = useMemo(() => {
    const shown = scoped.filter((task) => matchesFilters(task, filters, context));
    return Object.fromEntries(TASK_STATUSES.map((status) => [status, shown.filter((task) => task.status === status).sort(byBoardOrder)])) as Record<TaskStatus, BoardTask[]>;
  }, [scoped, filters, context]);

  /** Moves a card into `status` at `index` of the visible cards there (the dragged card itself left out). */
  const place = useCallback(async (task: BoardTask, status: TaskStatus, index: number) => {
    const others = columns[status].filter((card) => card.id !== task.id);
    // Dropped where it already stands: nothing to write.
    if (task.status === status && columns[status].findIndex((card) => card.id === task.id) === index) return;
    const before = index > 0 ? others[index - 1] : null;
    const after = index < others.length ? others[index] : null;
    let order = orderBetween(before?.order ?? null, after?.order ?? null);
    if (order === null) {
      // The gaps are used up: renumber the column first (rare), then take a fresh place.
      const sequence = columns[status].filter((card) => card.id !== task.id).map((card) => card.id);
      const numbers = renumbered(sequence);
      for (const card of columns[status]) if (numbers.has(card.id)) override(card.id, { order: numbers.get(card.id)! }, card.version);
      if (!preview) {
        const saved = await renumberColumn({ items: columns[status].filter((card) => numbers.has(card.id)).map((card) => ({ taskId: card.id, order: numbers.get(card.id)!, expectedVersion: card.version })) });
        if (saved.ok) for (const item of saved.data) override(item.taskId, { order: numbers.get(item.taskId)!, version: item.version }, item.version);
      }
      order = index + 0.5;
    }
    const from = task.status;
    const ok = await run(task.id, { status, order }, (current) => moveTask({ taskId: current.id, status, order: order!, expectedVersion: current.version }));
    if (!ok) return;
    glow(task.id);
    if (from !== status) {
      const undo = () => void run(task.id, { status: from, order: task.order }, (current) => moveTask({ taskId: current.id, status: from, order: task.order, expectedVersion: current.version }));
      showToast(`„${task.title.length > 36 ? `${task.title.slice(0, 35)}…` : task.title}“ → ${STATUS_NAMES[status]}`, undo);
    }
  }, [columns, run, glow, showToast, preview, override]);

  const onDrop = useCallback((id: string, over: DragOver) => {
    const task = tasks.find((card) => card.id === id);
    if (task) void place(task, over.status, over.index);
  }, [tasks, place]);
  const { drag, justDragged } = useTaskDrag({ root, enabled: canEdit, onDrop });
  useEffect(() => { dragging.current = Boolean(drag); }, [drag]);

  const keyMove = useCallback((task: BoardTask, key: string) => {
    const at = TASK_STATUSES.indexOf(task.status);
    if (key === "ArrowLeft" || key === "ArrowRight") {
      const status = TASK_STATUSES[at + (key === "ArrowLeft" ? -1 : 1)];
      if (status) void place(task, status, 0);
    } else {
      const list = columns[task.status];
      const index = list.indexOf(task);
      const target = index + (key === "ArrowUp" ? -1 : 1);
      if (index >= 0 && target >= 0 && target < list.length) void place(task, task.status, target);
    }
    window.setTimeout(() => root.current?.querySelector<HTMLElement>(`[data-card="${task.id}"]`)?.focus(), 60);
  }, [columns, place]);

  const create = useCallback(async (status: TaskStatus, title: string, patch: TaskPatch = {}, inProject?: string) => {
    const target = inProject ?? (projectId === ALL ? null : projectId);
    if (!target) return false;
    let created: BoardTask | null = null;
    if (preview) {
      const number = Math.max(0, ...tasks.map((task) => task.number)) + 1;
      const last = Math.max(0, ...tasks.filter((task) => task.projectId === target && task.status === status).map((task) => task.order));
      created = { id: `fixture-${number}`, number, projectId: target, title, status, priority: patch.priority ?? "none", dueOn: patch.dueOn ?? null, labels: patch.labels ?? [], assigneeIds: patch.assigneeIds ?? [], visible: patch.visible ?? false, order: last + 1, version: 1, createdBy: source.viewerId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), comments: 0, checklist: { done: 0, total: 0 }, files: 0 };
    } else {
      const result = await createTask({ projectId: target, title, status, patch });
      if (!result.ok) { setError(result.error); return false; }
      created = result.data;
    }
    setAdded((current) => [...current, created!]);
    glow(created.id, "fx-in");
    showToast(`#${created.number} in „${STATUS_NAMES[status]}“ angelegt.`);
    return true;
  }, [projectId, source.viewerId, preview, tasks, glow, showToast]);

  const patch = useCallback(async (task: BoardTask, change: TaskPatch) => {
    const local: Partial<BoardTask> = { ...change };
    return run(task.id, local, (current) => updateTask({ taskId: current.id, expectedVersion: current.version, patch: change }));
  }, [run]);

  const archive = useCallback(async (task: BoardTask) => {
    if (!preview) {
      const result = await archiveTask({ taskId: task.id, expectedVersion: task.version });
      if (!result.ok) { setError(result.error); if (result.stale) router.refresh(); return false; }
    }
    setRemoved((current) => [...current, task.id]);
    setAddress({ task: null });
    showToast(`#${task.number} archiviert. Im Studio bleibt sie erhalten.`);
    return true;
  }, [preview, router, setAddress, showToast]);

  const open = useCallback((task: BoardTask) => {
    if (justDragged()) return;
    setDraft(null);
    setAddress({ task: String(task.number) });
  }, [justDragged, setAddress]);
  const close = useCallback(() => {
    const id = openTask?.id;
    setDraft(null);
    setAddress({ task: null });
    if (id) window.setTimeout(() => root.current?.querySelector<HTMLElement>(`[data-card="${id}"]`)?.focus(), 60);
  }, [openTask, setAddress]);

  const newTask = useCallback((status: TaskStatus = "todo") => { setAddress({ task: null }); setDraft(status); }, [setAddress]);
  // N opens „Neue Aufgabe“ while nobody types.
  useEffect(() => {
    if (!canEdit) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.key.toLowerCase() !== "n") return;
      if ((event.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable='true'], dialog")) return;
      event.preventDefault();
      newTask();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEdit, newTask]);

  const chooseProject = (value: string) => { setLastProject(value); setComposer(null); setAddress({ project: value, task: null }); };
  const chooseView = (value: string) => { setStoredView(value === "list" ? "list" : "board"); setComposer(null); };
  const toggleCollapsed = (status: TaskStatus) => setStoredCollapsed(JSON.stringify({ ...collapsed, [status]: !collapsed[status] }));
  const copyLink = (task: BoardTask) => {
    const url = `${window.location.origin}${hubHref(preview, "projects")}/tasks?project=${task.projectId}&task=${task.number}`;
    void navigator.clipboard?.writeText(url).then(() => showToast(`Link zu #${task.number} kopiert.`), () => showToast("Der Link konnte nicht kopiert werden."));
  };

  const knownLabels = useMemo(() => [...new Set(tasks.flatMap((task) => task.labels))].sort((a, b) => a.localeCompare(b, "de")), [tasks]);
  const info = useInfo("Aufgaben-Board", {
    steps: [
      <><b>Ziehen</b> verschiebt Karten, am Handy erst kurz halten.</>,
      <><b>Dieselben Aufgaben</b> wie im Studio, Änderungen gelten dort auch.</>,
      <><b>Für Kunden</b> freigegebene stehen im Projektfenster.</>,
    ],
    ask: "Wie funktioniert das Aufgaben-Board?",
  });

  const project = projectId === ALL ? null : projects.get(projectId) ?? null;
  const projectTasks = scoped;
  const progress = progressOf(projectTasks);
  const assigned = [...new Set(projectTasks.flatMap((task) => task.assigneeIds))];
  const projectOptions = [
    { value: ALL, label: "Alle Projekte", lead: <span className="kb-mark is-m is-all"><LayoutGrid size={13} aria-hidden="true" /></span>, meta: `${tasks.filter((task) => task.status !== "done").length} offen` },
    ...source.projects.map((item) => ({ value: item.id, label: item.name, group: item.company || "Ohne Kunde", lead: <CompanyMark company={item.company} size="m" />, meta: item.status === "complete" ? "abgeschlossen" : `${tasks.filter((task) => task.projectId === item.id && task.status !== "done").length} offen` })),
  ];
  const assigneeOptions: { value: AssigneeFilter; label: string }[] = [{ value: "all", label: "Alle" }, { value: "me", label: "Mir zugewiesen" }, { value: "team", label: "Mit Zuständigen" }, { value: "none", label: "Niemand zugewiesen" }];
  const dueOptions: { value: DueFilter; label: string }[] = [{ value: "all", label: "Alle Termine" }, { value: "overdue", label: "Überfällig" }, { value: "week", label: "Diese Woche fällig" }, { value: "none", label: "Ohne Datum" }];
  const filterCount = activeFilterCount(filters);

  const viewProps: TaskViewProps = {
    columns, people, projects, showProject: projectId === ALL, today, openId: openTask?.id ?? null, flash, drag, collapsed, showOlderDone, composer, canEdit,
    onOpen: open,
    onToggleCollapsed: toggleCollapsed,
    onShowOlder: () => setShowOlderDone(true),
    // On „Alle Projekte“ a new card needs its project first: the window asks for it.
    onCompose: (status) => (status && projectId === ALL ? newTask(status) : setComposer(status)),
    onCreate: (status, title) => create(status, title),
    onKeyMove: keyMove,
    onStatus: (task, status) => void place(task, status, 0),
  };
  const runningProjects = source.projects.filter((item) => item.status !== "complete");

  return (
    <>
      <LargeTitleHeader
        title="Aufgaben"
        icon={<span className="title-icon"><SquareKanban size={24} color={categories.projects.fill} aria-hidden="true" /></span>}
        // Back to the same project in the panel of „Projekte“, which keeps its choice in ?project= as well.
        leading={<Link href={`${hubHref(preview, "projects")}${project ? `?project=${encodeURIComponent(project.id)}` : ""}`} className="on-bg-link"><ChevronLeft size={22} strokeWidth={2.5} aria-hidden="true" />Projekte</Link>}
        actions={<HeaderActions />}
      />
      {source.error && <p className="calendar-notice kb-error-note" role="alert">{source.error}</p>}
      {confirmHref && (
        <div className="calendar-notice kb-lock-note" role="status">
          <Lock size={18} aria-hidden="true" />
          <span className="kb-lock-text"><b>Nur lesen.</b> Zum Bearbeiten bestätigst du deine Anmeldung einmal mit einem Code aus der Mail.</span>
          <a className="sheet-action is-primary" href={confirmHref}>Mit Code bestätigen</a>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="sheet kb-sheet section-first" ref={root}>
        <div className="kb-project">
          <div className="kb-project-pick">
            {project ? <CompanyMark company={project.company} /> : <span className="kb-mark is-all" aria-hidden="true"><LayoutGrid size={18} /></span>}
            <span className="kb-project-text">
              <Select variant="bare" chevron label="Projekt" value={projectId} onChange={chooseProject} options={projectOptions} search className="kb-project-select" searchPlaceholder="Projekt oder Kunde" />
              <span className="kb-project-sub">{project ? `${project.company} · ${projectTasks.length} ${projectTasks.length === 1 ? "Aufgabe" : "Aufgaben"}` : `${source.projects.length} Projekte · ${projectTasks.length} Aufgaben`}</span>
            </span>
          </div>
          <div className="kb-project-stats">
            <div className="kb-stat">Fortschritt<strong><span className="kb-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></span>{progress} %</strong></div>
            {project?.dueOn && <div className="kb-stat">Ziel<strong>{new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(Date.parse(`${project.dueOn}T00:00:00Z`))}</strong></div>}
            {assigned.length > 0 && <div className="kb-stat">Zuständig<strong><span className="kb-stack">{assigned.slice(0, 6).map((id) => <span key={id} className="kb-av" data-tip={people.get(id)?.name}>{people.get(id)?.initials ?? "?"}</span>)}</span></strong></div>}
            {info.button}
          </div>
        </div>
        {info.box}
        <SheetToolbar query={filters.query} onQuery={(query) => setFilters((current) => ({ ...current, query }))} placeholder="Aufgaben durchsuchen" label="Aufgaben durchsuchen"
          trailing={<>
            <SegmentedControl label="Aufgaben eingrenzen" value={filters.mine ? "mine" : "all"} onChange={(value) => setFilters((current) => ({ ...current, mine: value === "mine" }))}
              options={[{ id: "all", label: "Alle", name: `Alle: ${counts.all}`, count: counts.all }, { id: "mine", label: "Meine", name: `Meine: ${counts.mine}`, count: counts.mine }]} />
            {!source.error && (
              // Read-only keeps the choice of view; only „Neue Aufgabe“ needs the code.
              <SheetActionMenu label="Aufgaben" actions={canEdit ? [{ icon: Plus, label: "Neue Aufgabe", hint: "Einzeln anlegen", shortcut: "N", onSelect: () => newTask() }] : []}
                choices={{ label: "Ansicht", value: view, onChange: chooseView, options: [{ id: "board", label: "Board", icon: SquareKanban }, { id: "list", label: "Liste", icon: LayoutList }] }} />
            )}
          </>}>
          <ToolbarMenu icon={ListFilter} label="Filter" badge={filterCount}>
            <FilterSelect icon={Users} name="Zuständig" value={filters.assignee} onChange={(value) => setFilters((current) => ({ ...current, assignee: value as AssigneeFilter }))} options={assigneeOptions} />
            <FilterSelect icon={Tag} name="Label" value={filters.label} onChange={(value) => setFilters((current) => ({ ...current, label: value }))} options={[{ value: "", label: "Alle Labels" }, ...knownLabels.map((label) => ({ value: label, label }))]} />
            <FilterSelect icon={CalendarClock} name="Fällig" value={filters.due} onChange={(value) => setFilters((current) => ({ ...current, due: value as DueFilter }))} options={dueOptions} />
            {filterCount > 0 && <button type="button" className="table-reset" onClick={() => setFilters((current) => ({ ...NO_FILTERS, query: current.query, mine: current.mine }))}>Filter zurücksetzen</button>}
          </ToolbarMenu>
        </SheetToolbar>
        {view === "board" && <MobileTabs columns={columns} />}
        <div className="kb-board-wrap">{view === "board" ? <TaskBoard {...viewProps} /> : <TaskList {...viewProps} />}</div>
        <SheetFooter hint={canEdit ? <span className="kb-foot-hint">{view === "board" ? "Karten mit Maus oder Finger ziehen · am Rechner auch Alt + Pfeiltasten" : "Zeilen ziehen oder den Status wählen · am Rechner auch Alt + Pfeiltasten"}</span> : undefined}>
          {projectTasks.length === 1 ? "1 Aufgabe" : `${projectTasks.length} Aufgaben`} · {projectTasks.filter((task) => task.status === "done").length} erledigt
        </SheetFooter>
      </div>

      {openTask && !draft && (
        <TaskPanel
          key={openTask.id}
          task={openTask}
          project={projects.get(openTask.projectId)}
          people={people}
          team={team}
          knownLabels={knownLabels}
          today={today}
          preview={preview}
          canEdit={canEdit}
          confirmHref={confirmHref}
          onClose={close}
          onPatch={(change) => patch(openTask, change)}
          onMove={(status) => void place(openTask, status, 0)}
          onArchive={() => archive(openTask)}
          onCopyLink={() => copyLink(openTask)}
          onCounts={(change) => override(openTask.id, change, openTask.version)}
        />
      )}
      {draft && source.projects.length > 0 && (
        <NewTaskPanel
          projects={runningProjects.length ? runningProjects : source.projects}
          initialProjectId={project?.id ?? null}
          team={team}
          people={people}
          knownLabels={knownLabels}
          initialStatus={draft}
          today={today}
          onClose={() => setDraft(null)}
          onCreate={async (projectChoice, status, title, change) => {
            const ok = await create(status, title, change, projectChoice);
            if (ok) setDraft(null);
            return ok;
          }}
        />
      )}
      {toast && (
        <div className="kb-toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button type="button" onClick={() => { const undo = toast.undo; setToast(null); undo?.(); }}>Rückgängig</button>}
        </div>
      )}
    </>
  );
}

/** Phones: the columns as tabs above the swipeable board. */
function MobileTabs({ columns }: { columns: Record<TaskStatus, BoardTask[]> }) {
  const jump = (index: number) => {
    const board = document.querySelector<HTMLElement>(".kb-board");
    const column = board?.querySelectorAll<HTMLElement>("[data-col]")[index];
    if (board && column) board.scrollTo({ left: column.offsetLeft - 12, behavior: "smooth" });
  };
  return (
    <div className="kb-tabs" role="group" aria-label="Spalte">
      {TASK_STATUSES.map((status, index) => <button key={status} type="button" className="kb-tab" onClick={() => jump(index)}>{STATUS_NAMES[status]}<span className="kb-col-count">{columns[status].length}</span></button>)}
    </div>
  );
}
