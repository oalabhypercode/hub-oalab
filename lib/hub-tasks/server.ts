import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { initialsOf, NO_COUNTS, toBoardTask, type StudioTaskRow, type TaskCounts } from "./rules";
import type { BoardPerson, BoardProject, TaskBoardState } from "./types";

// The board reads like the projects page for admins: after the same admin check (hub role, second factor,
// is_hub_admin()) with the server key, every project that is not archived and its open (not archived) tasks. Writes go
// through the actions with the admin's own session, so Studio's RLS and triggers decide (lib/hub-tasks/actions.ts).
// Studio's RLS needs a session confirmed with a code (aal2); a login whose second factor is off reads the board but
// edits only after „Mit Code bestätigen“ (seen live 16.11.2026: the task window failed instead).

/** Studio's team roles: only they may be assignees (Studio's trigger checks the same). */
export const TEAM_ROLES = ["oalab_operator", "oalab_release_manager", "oalab_admin"];

const TASK_COLUMNS = "id, task_number, project_id, title, status, priority, due_date, labels, assignee_user_ids, client_visible, board_order, version, created_by, created_at, updated_at";
const failed = (error: string): TaskBoardState => ({ projects: [], tasks: [], people: [], viewerId: "", confirmed: false, error });

/** Whether this session confirmed a code (aal2): the actions write only then (lib/hub-tasks/actions.ts). */
async function sessionConfirmed() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.aal === "aal2";
}
const LOAD_ERROR = "Die Aufgaben konnten gerade nicht geladen werden. Bitte versuche es erneut.";

type ProjectRow = { id: string; organization_id: string; display_name: string; status: string };
type DetailsRow = { project_id: string; status: string; start_date: string | null; due_date: string | null };

/** Names for user ids: the hub's profiles first; whoever has none is "Teammitglied" or "Unbekannt". */
async function peopleFor(db: NonNullable<ReturnType<typeof createAdminClient>>, ids: string[], team: Set<string>): Promise<BoardPerson[]> {
  if (!ids.length) return [];
  const { data } = await db.from("hub_profiles").select("user_id, first_name, last_name").in("user_id", ids).returns<{ user_id: string; first_name: string | null; last_name: string | null }[]>();
  const names = new Map((data ?? []).map((row) => [row.user_id, `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim()]));
  return ids.map((id) => {
    const name = names.get(id) || (team.has(id) ? "Teammitglied" : "Unbekannt");
    return { id, name, initials: initialsOf(name), kind: team.has(id) ? "team" : "other" };
  });
}

/** The board for the signed-in admin, once per request. */
export const loadTaskBoard = cache(async (): Promise<TaskBoardState> => {
  const admin = await verifyHubAdmin();
  if (!admin) return failed("Das Aufgaben-Board ist für das oalab-Team mit bestätigtem zweiten Faktor.");
  const db = createAdminClient();
  if (!db) return failed("Aufgaben sind noch nicht eingerichtet: Es fehlt der Server-Schlüssel.");

  const projects = await db.from("customer_projects").select("id, organization_id, display_name, status").neq("status", "archived").returns<ProjectRow[]>();
  if (projects.error) return failed(LOAD_ERROR);
  const rows = projects.data ?? [];
  const projectIds = rows.map((row) => row.id);
  const organizationIds = [...new Set(rows.map((row) => row.organization_id))];

  const staffOrganizations = await db.from("organizations").select("id").eq("kind", "oalab").eq("status", "active").returns<{ id: string }[]>();
  if (staffOrganizations.error) return failed(LOAD_ERROR);
  const staffIds = (staffOrganizations.data ?? []).map((row) => row.id);

  const empty = { data: [], error: null };
  const [details, tasks, organizations, comments, subtasks, files, staff] = await Promise.all([
    projectIds.length ? db.from("studio_project_details").select("project_id, status, start_date, due_date").in("project_id", projectIds).returns<DetailsRow[]>() : empty,
    projectIds.length ? db.from("studio_tasks").select(TASK_COLUMNS).in("project_id", projectIds).eq("archived", false).returns<StudioTaskRow[]>() : empty,
    organizationIds.length ? db.from("organizations").select("id, name").in("id", organizationIds).returns<{ id: string; name: string }[]>() : empty,
    organizationIds.length ? db.from("studio_comments").select("task_id").in("organization_id", organizationIds).returns<{ task_id: string }[]>() : empty,
    organizationIds.length ? db.from("studio_subtasks").select("task_id, done").in("organization_id", organizationIds).returns<{ task_id: string; done: boolean }[]>() : empty,
    projectIds.length ? db.from("studio_files").select("task_id").in("project_id", projectIds).eq("state", "ready").not("task_id", "is", null).returns<{ task_id: string }[]>() : empty,
    staffIds.length ? db.from("memberships").select("user_id").in("organization_id", staffIds).eq("status", "active").in("role", TEAM_ROLES).returns<{ user_id: string }[]>() : empty,
  ]);
  const error = details.error ?? tasks.error ?? organizations.error ?? comments.error ?? subtasks.error ?? files.error ?? staff.error;
  if (error) return failed(LOAD_ERROR);

  const counts = new Map<string, TaskCounts>();
  const countFor = (id: string) => {
    const known = counts.get(id);
    if (known) return known;
    const fresh = { ...NO_COUNTS };
    counts.set(id, fresh);
    return fresh;
  };
  for (const row of comments.data ?? []) countFor(row.task_id).comments += 1;
  for (const row of subtasks.data ?? []) { const count = countFor(row.task_id); count.total += 1; if (row.done) count.done += 1; }
  for (const row of files.data ?? []) countFor(row.task_id).files += 1;

  const names = new Map((organizations.data ?? []).map((row) => [row.id, row.name]));
  const detailsById = new Map((details.data ?? []).map((row) => [row.project_id, row]));
  const boardProjects: BoardProject[] = rows
    .map((row) => {
      const detail = detailsById.get(row.id);
      return {
        id: row.id,
        name: row.display_name,
        organizationId: row.organization_id,
        company: names.get(row.organization_id) ?? "",
        startedOn: detail?.start_date ?? null,
        dueOn: detail?.due_date ?? null,
        status: detail?.status ?? (row.status === "paused" ? "hold" : "active"),
      };
    })
    .sort((a, b) => a.company.localeCompare(b.company, "de") || a.name.localeCompare(b.name, "de"));
  const boardTasks = (tasks.data ?? []).map((row) => toBoardTask(row, counts.get(row.id)));

  const team = new Set((staff.data ?? []).map((row) => row.user_id));
  const mentioned = new Set<string>([admin.userId, ...team]);
  for (const task of boardTasks) { mentioned.add(task.createdBy); task.assigneeIds.forEach((id) => mentioned.add(id)); }
  const [people, confirmed] = await Promise.all([peopleFor(db, [...mentioned], team), sessionConfirmed()]);

  return { projects: boardProjects, tasks: boardTasks, people, viewerId: admin.userId, confirmed, error: null };
});
