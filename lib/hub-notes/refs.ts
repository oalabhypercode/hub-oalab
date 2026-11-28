import "server-only";
import { loadLiveProjects } from "@/lib/hub-projects/server";
import { HUB_FILES_BUCKET } from "@/lib/hub-files/catalog";
import { isStoredNoteImage, isUuid } from "./rules";
import type { NotesContext } from "./server";
import type { NoteAppointmentView, NoteDoc, NoteNode, NoteRefs, NoteTaskView } from "./types";

// A note keeps only the ids of tasks, projects and files (plan, „Wichtigste Regel“). When a page opens, the server reads
// them in one go with the rights of the person who looks: Studio's rules decide for the team and freelancers, the
// released tasks of their projects for customers. What they may not see comes back as null, without its title.

type TaskRow = {
  id: string;
  task_number: number;
  project_id: string;
  title: string;
  status: string;
  due_date: string | null;
  labels: string[] | null;
  assignee_user_ids: string[] | null;
  client_visible: boolean;
  team_only: boolean;
  version: number;
};
const TASK_FIELDS = "id, task_number, project_id, title, status, due_date, labels, assignee_user_ids, client_visible, team_only, version";
const STATUSES = new Set(["backlog", "todo", "progress", "review", "done"]);
const isCustomerLabel = (label: string) => label.trim().toLowerCase() === "kunde";
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "·";

/** The pictures of a page that the hub signs: only those stored at the page's own customer, never another's. */
export function ownImages(paths: readonly string[], customerId: string | null | undefined): string[] {
  if (!customerId) return [];
  const own = `notes/${customerId.toLowerCase()}/`;
  return paths.filter((path) => path.startsWith(own) && isStoredNoteImage(path));
}

/** The ids a document refers to, by kind. */
export function refsIn(doc: NoteDoc) {
  const tasks = new Set<string>();
  const projects = new Set<string>();
  const lists = new Set<string>();
  const images = new Set<string>();
  const appointments = new Set<string>();
  const walk = (node: NoteNode) => {
    const attrs = node.attrs ?? {};
    if ((node.type === "noteTaskItem" || node.type === "noteTaskMention") && isUuid(attrs.refId)) tasks.add(String(attrs.refId));
    if (node.type === "noteProject" && isUuid(attrs.refId)) projects.add(String(attrs.refId));
    if (node.type === "noteTaskList" && isUuid(attrs.refId)) lists.add(String(attrs.refId));
    if ((node.type === "noteLinkCard" || node.type === "noteImage") && typeof attrs.image === "string" && attrs.image.startsWith("notes/")) images.add(attrs.image);
    if (node.type === "noteAppointment" && isUuid(attrs.refId)) appointments.add(String(attrs.refId));
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return { tasks: [...tasks], projects: [...projects], lists: [...lists], images: [...images], appointments: [...appointments] };
}

function toTask(row: TaskRow, projectName: string, names: Map<string, string>, forCustomer: boolean): NoteTaskView {
  const status = STATUSES.has(row.status) ? row.status as NoteTaskView["status"] : "todo";
  return {
    id: row.id,
    number: Number(row.task_number),
    title: row.title,
    status,
    dueOn: row.due_date,
    projectId: row.project_id,
    projectName,
    assignees: forCustomer ? [] : (row.assignee_user_ids ?? []).map((id) => ({ id, name: names.get(id) ?? "Teammitglied", initials: initialsOf(names.get(id) ?? "T") })),
    customerTurn: row.client_visible && status !== "done" && (row.labels ?? []).some(isCustomerLabel),
    audience: forCustomer ? null : row.team_only ? "team" : row.client_visible ? "customer" : "shared",
    version: forCustomer ? null : Number(row.version),
  };
}

/**
 * Everything a page refers to, as the viewer may see it. Missing tables or reads leave the references unresolved.
 * Pictures (link previews and pictures in the text) are signed only from the notes of the page's own customer,
 * whatever path a document names.
 */
export async function resolveRefs(ctx: NotesContext, doc: NoteDoc, customerId?: string): Promise<NoteRefs> {
  const found = refsIn(doc);
  const wanted = { ...found, images: ownImages(found.images, customerId) };
  const refs: NoteRefs = { tasks: {}, projects: {}, projectTasks: {}, images: {}, appointments: {} };
  const projectIds = [...new Set([...wanted.projects, ...wanted.lists])];
  if (!wanted.tasks.length && !projectIds.length && !wanted.images.length && !wanted.appointments.length) return refs;

  // Appointments with the person's own session: admins every one, customers their own; freelancers see none of a
  // customer's (the calendar's rules), so for them the block says „Termin (nicht sichtbar)“.
  if (wanted.appointments.length) {
    for (const id of wanted.appointments) refs.appointments[id] = null;
    const { data } = await ctx.session.from("hub_appointments").select("id, title, starts_at, ends_at, status, teams_url, customer_id").in("id", wanted.appointments)
      .returns<{ id: string; title: string; starts_at: string; ends_at: string; status: string; teams_url: string | null; customer_id: string | null }[]>();
    for (const row of data ?? []) refs.appointments[row.id] = appointmentView(row);
  }

  if (wanted.images.length && ctx.db) {
    const signed = await ctx.db.storage.from(HUB_FILES_BUCKET).createSignedUrls(wanted.images, 60 * 60);
    for (const item of signed.data ?? []) if (item.path && item.signedUrl) refs.images[item.path] = item.signedUrl;
  }

  if (ctx.viewer === "customer") {
    // Customers: their projects with the tasks oalab released to them (the project window's data).
    const live = await loadLiveProjects();
    const tasks = new Map(live.projects.flatMap((project) => (project.tasks ?? []).map((task) => [task.id, { task, project }] as const)));
    for (const id of wanted.tasks) {
      const found = tasks.get(id);
      refs.tasks[id] = found ? {
        id, number: found.task.number, title: found.task.title, status: found.task.status, dueOn: found.task.dueOn, projectId: found.project.id, projectName: found.project.name,
        assignees: [], customerTurn: found.task.customer && found.task.status !== "done", audience: null, version: null,
      } : null;
    }
    for (const id of projectIds) {
      const project = live.projects.find((item) => item.id === id);
      refs.projects[id] = project ? { id, name: project.name, status: project.status, progress: project.progress, dueOn: project.dueOn } : null;
      refs.projectTasks[id] = project ? (project.tasks ?? []).map((task) => ({
        id: task.id, number: task.number, title: task.title, status: task.status, dueOn: task.dueOn, projectId: project.id, projectName: project.name,
        assignees: [], customerTurn: task.customer && task.status !== "done", audience: null, version: null,
      })) : null;
    }
    return refs;
  }

  const db = ctx.db;
  if (!db) return refs;
  // The team reads every running project with the server key; a freelancer only what their own session lists.
  const read = ctx.viewer === "admin" ? db : ctx.session;
  const allowedProjects = ctx.viewer === "admin" ? null : new Set(((await ctx.session.from("studio_project_freelancers").select("project_id").returns<{ project_id: string }[]>()).data ?? []).map((row) => row.project_id));
  const [taskRows, listRows] = await Promise.all([
    wanted.tasks.length ? read.from("studio_tasks").select(TASK_FIELDS).in("id", wanted.tasks).eq("archived", false).returns<TaskRow[]>() : { data: [] as TaskRow[], error: null },
    projectIds.length ? read.from("studio_tasks").select(TASK_FIELDS).in("project_id", projectIds).eq("archived", false).order("board_order").limit(600).returns<TaskRow[]>() : { data: [] as TaskRow[], error: null },
  ]);
  const visibleTasks = (taskRows.data ?? []).filter((row) => !allowedProjects || allowedProjects.has(row.project_id));
  const listTasks = (listRows.data ?? []).filter((row) => !allowedProjects || allowedProjects.has(row.project_id));
  const allProjectIds = [...new Set([...projectIds, ...visibleTasks.map((row) => row.project_id), ...listTasks.map((row) => row.project_id)])]
    .filter((id) => !allowedProjects || allowedProjects.has(id));
  const [projectRows, detailRows, people] = await Promise.all([
    allProjectIds.length ? db.from("customer_projects").select("id, display_name, status").in("id", allProjectIds).neq("status", "archived").returns<{ id: string; display_name: string; status: string }[]>() : { data: [], error: null },
    allProjectIds.length ? db.from("studio_project_details").select("project_id, status, due_date").in("project_id", allProjectIds).returns<{ project_id: string; status: string; due_date: string | null }[]>() : { data: [], error: null },
    (async () => {
      const ids = [...new Set([...visibleTasks, ...listTasks].flatMap((row) => row.assignee_user_ids ?? []))];
      if (!ids.length) return new Map<string, string>();
      const { data } = await db.from("hub_profiles").select("user_id, first_name, last_name").in("user_id", ids).returns<{ user_id: string; first_name: string | null; last_name: string | null }[]>();
      return new Map((data ?? []).map((row) => [row.user_id, `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "Teammitglied"]));
    })(),
  ]);
  const projectName = new Map((projectRows.data ?? []).map((row) => [row.id, row.display_name]));
  const details = new Map((detailRows.data ?? []).map((row) => [row.project_id, row]));
  for (const id of wanted.tasks) {
    const row = visibleTasks.find((item) => item.id === id);
    refs.tasks[id] = row && projectName.has(row.project_id) ? toTask(row, projectName.get(row.project_id)!, people, false) : null;
  }
  const statusLabel: Record<string, string> = { planning: "In Planung", active: "In Umsetzung", risk: "Gefährdet", hold: "Pausiert", complete: "Abgeschlossen" };
  for (const id of projectIds) {
    if (!projectName.has(id)) { refs.projects[id] = null; refs.projectTasks[id] = null; continue; }
    const tasks = listTasks.filter((row) => row.project_id === id);
    const total = tasks.length;
    const done = tasks.filter((row) => row.status === "done").length;
    const detail = details.get(id);
    refs.projects[id] = { id, name: projectName.get(id)!, status: statusLabel[detail?.status ?? "active"] ?? "In Umsetzung", progress: total ? Math.round((done / total) * 100) : 0, dueOn: detail?.due_date ?? null };
    refs.projectTasks[id] = tasks.map((row) => toTask(row, projectName.get(id)!, people, false));
  }
  return refs;
}

const APPOINTMENT_STATUSES = new Set(["requested", "confirmed", "declined", "cancelled"]);

/** An appointment row as a note shows it; the Teams link only while it is confirmed. */
export function appointmentView(row: { id: string; title: string; starts_at: string; ends_at: string; status: string; teams_url: string | null; customer_id: string | null }): NoteAppointmentView {
  const status = (APPOINTMENT_STATUSES.has(row.status) ? row.status : "requested") as NoteAppointmentView["status"];
  return { id: row.id, title: row.title, start: row.starts_at, end: row.ends_at, status, teamsUrl: status === "confirmed" ? row.teams_url : null, customerId: row.customer_id };
}
