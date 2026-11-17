import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { verifyHubAdmin, verifyHubFreelancer } from "@/lib/hub-users/server";
import { readArchive } from "@/lib/hub-archive/server";
import { initialsOf, loginName, NO_COUNTS, TASK_COLUMNS, toBoardTask, type StudioTaskRow, type TaskCounts } from "./rules";
import type { BoardFreelancer, BoardPerson, BoardProject, BoardTask, TaskBoardState } from "./types";

// The board reads like the projects page for admins: after the same admin check (hub role, second factor,
// is_hub_admin()) with the server key, every project that is not archived and its open (not archived) tasks. Writes go
// through the actions with the admin's own session, so Studio's RLS and triggers decide (lib/hub-tasks/actions.ts).
// Studio's RLS needs a session confirmed with a code (aal2); a login whose second factor is off reads the board but
// edits only after „Mit Code bestätigen“ (seen live 16.11.2026: the task window failed instead).
//
// Freelancers (step 3, 16.11.2026) read with their *own* session: the database lists the projects an admin put them on
// and in them every task except „Nur Team“ and the archive (migration 202611160001_studio_freelancers). Only the names
// of exactly these projects, their customers and the people on them come with the server key.

/** Studio's team roles: only they and the project's freelancers may be assignees (Studio's trigger checks the same). */
export const TEAM_ROLES = ["oalab_operator", "oalab_release_manager", "oalab_admin"];

type Viewer = TaskBoardState["viewer"];
const failed = (error: string, viewer: Viewer = "admin"): TaskBoardState => ({ viewer, projects: [], tasks: [], people: [], freelancers: [], viewerId: "", confirmed: false, error });

/** Whether this session confirmed a code (aal2): the actions write only then (lib/hub-tasks/actions.ts). */
async function sessionConfirmed() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.aal === "aal2";
}
const LOAD_ERROR = "Die Aufgaben konnten gerade nicht geladen werden. Bitte versuche es erneut.";

type Db = NonNullable<ReturnType<typeof createAdminClient>>;
type ProjectRow = { id: string; organization_id: string; display_name: string; status: string };
type DetailsRow = { project_id: string; status: string; start_date: string | null; due_date: string | null };
type LinkRow = { project_id: string; freelancer_id: string };
const empty = { data: [], error: null };

/** At most this many logins per board get their name from the login itself (a few team accounts, not every customer). */
const LOGIN_NAMES = 40;

/**
 * Names for user ids: the hub's profiles first, then the login itself, where Studio keeps the name of team accounts
 * created there (seen live 16.11.2026: three of them stood as „Teammitglied“ under „Beteiligte“). A login without a
 * name shows its e-mail address to the oalab team, as in Studio; for freelancers it stays "Teammitglied", their
 * freelancer or "Unbekannt".
 */
async function peopleFor(db: Db, ids: string[], team: Set<string>, freelancerOf: ReadonlyMap<string, BoardFreelancer>, viewer: Viewer): Promise<BoardPerson[]> {
  if (!ids.length) return [];
  const { data } = await db.from("hub_profiles").select("user_id, first_name, last_name").in("user_id", ids).returns<{ user_id: string; first_name: string | null; last_name: string | null }[]>();
  const names = new Map((data ?? []).map((row) => [row.user_id, `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim()]));
  const unnamed = ids.filter((id) => !names.get(id)).slice(0, LOGIN_NAMES);
  const fromLogins = await Promise.all(unnamed.map(async (id) => {
    const found = await db.auth.admin.getUserById(id).catch(() => null);
    return [id, loginName(found?.data?.user, viewer === "admin")] as const;
  }));
  for (const [id, name] of fromLogins) if (name) names.set(id, name);
  return ids.map((id) => {
    const freelancer = team.has(id) ? undefined : freelancerOf.get(id);
    const name = names.get(id) || (team.has(id) ? "Teammitglied" : freelancer?.name ?? "Unbekannt");
    return { id, name, initials: initialsOf(name), kind: team.has(id) ? "team" : freelancer ? "freelancer" : "other", ...(freelancer ? { company: freelancer.name } : {}) };
  });
}

/**
 * Freelancer entries who look after a customer of these organisations, with their logins. `only` keeps just these
 * entries (a freelancer's board: those on its projects); the organisations named are always among `organizationIds`.
 * Null when a read failed.
 */
async function loadFreelancers(db: Db, organizationIds: string[], only?: readonly string[]): Promise<BoardFreelancer[] | null> {
  if (!organizationIds.length || (only && !only.length)) return [];
  const customers = await db.from("hub_customers").select("id, organization_id").in("organization_id", organizationIds).eq("kind", "customer").returns<{ id: string; organization_id: string }[]>();
  if (customers.error) return null;
  const organizationOf = new Map((customers.data ?? []).map((row) => [row.id, row.organization_id]));
  if (!organizationOf.size) return [];
  const links = await db.from("hub_freelancer_customers").select("freelancer_id, customer_id").in("customer_id", [...organizationOf.keys()]).returns<{ freelancer_id: string; customer_id: string }[]>();
  if (links.error) return null;
  const serves = new Map<string, Set<string>>();
  for (const link of links.data ?? []) {
    if (only && !only.includes(link.freelancer_id)) continue;
    const organization = organizationOf.get(link.customer_id);
    if (!organization) continue;
    serves.set(link.freelancer_id, (serves.get(link.freelancer_id) ?? new Set()).add(organization));
  }
  const ids = [...serves.keys()];
  if (!ids.length) return [];
  const [entries, members, archive] = await Promise.all([
    db.from("hub_customers").select("id, company, customer_number").in("id", ids).eq("kind", "freelancer").returns<{ id: string; company: string; customer_number: string }[]>(),
    db.from("hub_customer_members").select("customer_id, user_id").in("customer_id", ids).returns<{ customer_id: string; user_id: string }[]>(),
    readArchive(db),
  ]);
  if (entries.error || members.error) return null;
  // An archived freelancer no longer works on anything.
  return (entries.data ?? [])
    .filter((entry) => !archive.customerIds.has(entry.id))
    .map((entry) => ({
      id: entry.id,
      name: entry.company,
      number: entry.customer_number,
      loginIds: (members.data ?? []).filter((member) => member.customer_id === entry.id).map((member) => member.user_id),
      organizationIds: [...(serves.get(entry.id) ?? [])],
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
}

/** Active members of the oalab team (Studio's team roles in an active oalab organisation). Null when a read failed. */
async function loadTeam(db: Db): Promise<Set<string> | null> {
  const staffOrganizations = await db.from("organizations").select("id").eq("kind", "oalab").eq("status", "active").returns<{ id: string }[]>();
  if (staffOrganizations.error) return null;
  const staffIds = (staffOrganizations.data ?? []).map((row) => row.id);
  if (!staffIds.length) return new Set();
  const staff = await db.from("memberships").select("user_id").in("organization_id", staffIds).eq("status", "active").in("role", TEAM_ROLES).returns<{ user_id: string }[]>();
  return staff.error ? null : new Set((staff.data ?? []).map((row) => row.user_id));
}

/** Comments, checklist and images per card. */
function countsOf(comments: { task_id: string }[], subtasks: { task_id: string; done: boolean }[], files: { task_id: string }[]) {
  const counts = new Map<string, TaskCounts>();
  const countFor = (id: string) => {
    const known = counts.get(id);
    if (known) return known;
    const fresh = { ...NO_COUNTS };
    counts.set(id, fresh);
    return fresh;
  };
  for (const row of comments) countFor(row.task_id).comments += 1;
  for (const row of subtasks) { const count = countFor(row.task_id); count.total += 1; if (row.done) count.done += 1; }
  for (const row of files) countFor(row.task_id).files += 1;
  return counts;
}

/** The board's projects, sorted by customer and name, with dates and status from Studio and their freelancers. */
function boardProjectsOf(rows: ProjectRow[], details: DetailsRow[], organizations: { id: string; name: string }[], links: LinkRow[]): BoardProject[] {
  const names = new Map(organizations.map((row) => [row.id, row.name]));
  const detailsById = new Map(details.map((row) => [row.project_id, row]));
  return rows
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
        freelancerIds: [...new Set(links.filter((link) => link.project_id === row.id).map((link) => link.freelancer_id))],
      };
    })
    .sort((a, b) => a.company.localeCompare(b.company, "de") || a.name.localeCompare(b.name, "de"));
}

/** Everybody the board names: the team, the freelancers' logins, and whoever created or holds a card. */
async function boardPeople(db: Db, viewerId: string, team: Set<string>, freelancers: BoardFreelancer[], tasks: BoardTask[], viewer: Viewer) {
  const freelancerOf = new Map(freelancers.flatMap((freelancer) => freelancer.loginIds.map((login) => [login, freelancer] as const)));
  const mentioned = new Set<string>([viewerId, ...team, ...freelancerOf.keys()]);
  for (const task of tasks) { mentioned.add(task.createdBy); task.assigneeIds.forEach((id) => mentioned.add(id)); }
  return peopleFor(db, [...mentioned], team, freelancerOf, viewer);
}

/**
 * Who may hold a task of this project, with names as the admins' board shows them: the active oalab team and the
 * logins of the freelancers on the project (Studio's trigger accepts exactly these). For the Claude connector, which
 * assigns by id. Null when the project is gone, belongs to an archived customer (lib/hub-archive) or a read failed.
 */
export async function loadAssignees(db: Db, projectId: string): Promise<BoardPerson[] | null> {
  const [project, archive] = await Promise.all([
    db.from("customer_projects").select("organization_id").eq("id", projectId).neq("status", "archived").maybeSingle<{ organization_id: string }>(),
    readArchive(db),
  ]);
  if (project.error || !project.data || archive.organizationIds.has(project.data.organization_id)) return null;
  const [team, links, freelancers] = await Promise.all([
    loadTeam(db),
    db.from("studio_project_freelancers").select("freelancer_id").eq("project_id", projectId).returns<{ freelancer_id: string }[]>(),
    loadFreelancers(db, [project.data.organization_id]),
  ]);
  if (!team || links.error || !freelancers) return null;
  const onProject = new Set((links.data ?? []).map((row) => row.freelancer_id));
  const freelancerOf = new Map(freelancers.filter((freelancer) => onProject.has(freelancer.id)).flatMap((freelancer) => freelancer.loginIds.map((login) => [login, freelancer] as const)));
  return peopleFor(db, [...new Set([...team, ...freelancerOf.keys()])], team, freelancerOf, "admin");
}

/** The oalab team's board: every running project of every customer that is not archived (lib/hub-archive). */
async function adminBoard(viewerId: string, db: Db): Promise<TaskBoardState> {
  const [projects, archive] = await Promise.all([
    db.from("customer_projects").select("id, organization_id, display_name, status").neq("status", "archived").returns<ProjectRow[]>(),
    readArchive(db),
  ]);
  if (projects.error) return failed(LOAD_ERROR);
  const rows = (projects.data ?? []).filter((row) => !archive.organizationIds.has(row.organization_id));
  const projectIds = rows.map((row) => row.id);
  const organizationIds = [...new Set(rows.map((row) => row.organization_id))];

  const [details, tasks, organizations, comments, subtasks, files, links, team, freelancers] = await Promise.all([
    projectIds.length ? db.from("studio_project_details").select("project_id, status, start_date, due_date").in("project_id", projectIds).returns<DetailsRow[]>() : empty,
    projectIds.length ? db.from("studio_tasks").select(TASK_COLUMNS).in("project_id", projectIds).eq("archived", false).returns<StudioTaskRow[]>() : empty,
    organizationIds.length ? db.from("organizations").select("id, name").in("id", organizationIds).returns<{ id: string; name: string }[]>() : empty,
    organizationIds.length ? db.from("studio_comments").select("task_id").in("organization_id", organizationIds).returns<{ task_id: string }[]>() : empty,
    organizationIds.length ? db.from("studio_subtasks").select("task_id, done").in("organization_id", organizationIds).returns<{ task_id: string; done: boolean }[]>() : empty,
    projectIds.length ? db.from("studio_files").select("task_id").in("project_id", projectIds).eq("state", "ready").not("task_id", "is", null).returns<{ task_id: string }[]>() : empty,
    projectIds.length ? db.from("studio_project_freelancers").select("project_id, freelancer_id").in("project_id", projectIds).returns<LinkRow[]>() : empty,
    loadTeam(db),
    // „Beteiligte“: who looks after the customer of a project, and so may work on it.
    loadFreelancers(db, organizationIds),
  ]);
  const error = details.error ?? tasks.error ?? organizations.error ?? comments.error ?? subtasks.error ?? files.error ?? links.error;
  if (error || !team || !freelancers) return failed(LOAD_ERROR);

  const counts = countsOf(comments.data ?? [], subtasks.data ?? [], files.data ?? []);
  const boardTasks = (tasks.data ?? []).map((row) => toBoardTask(row, counts.get(row.id)));
  const [people, confirmed] = await Promise.all([boardPeople(db, viewerId, team, freelancers, boardTasks, "admin"), sessionConfirmed()]);
  return {
    viewer: "admin",
    projects: boardProjectsOf(rows, details.data ?? [], organizations.data ?? [], links.data ?? []),
    tasks: boardTasks,
    people,
    freelancers,
    viewerId,
    confirmed,
    error: null,
  };
}

/**
 * A freelancer's board: the projects the database lists for their own session (an admin put them on it, the customer
 * is theirs, the project runs) and in them what the database shows them, read with that session.
 */
async function freelancerBoard(viewerId: string, session: SupabaseClient, db: Db): Promise<TaskBoardState> {
  const own = await session.from("studio_project_freelancers").select("project_id").returns<{ project_id: string }[]>();
  if (own.error) return failed(LOAD_ERROR, "freelancer");
  const ownIds = [...new Set((own.data ?? []).map((row) => row.project_id))];
  const none: TaskBoardState = { viewer: "freelancer", projects: [], tasks: [], people: [], freelancers: [], viewerId, confirmed: true, error: null };
  if (!ownIds.length) return none;

  // Names of exactly these projects; archived ones, and those of archived customers, are closed for freelancers as in
  // the database's rules (migration 202611170001 in service-oalab).
  const [projects, archive] = await Promise.all([
    db.from("customer_projects").select("id, organization_id, display_name, status").in("id", ownIds).neq("status", "archived").returns<ProjectRow[]>(),
    readArchive(db),
  ]);
  if (projects.error) return failed(LOAD_ERROR, "freelancer");
  const rows = (projects.data ?? []).filter((row) => !archive.organizationIds.has(row.organization_id));
  if (!rows.length) return none;
  const projectIds = rows.map((row) => row.id);
  const organizationIds = [...new Set(rows.map((row) => row.organization_id))];

  const [details, tasks, organizations, comments, subtasks, files, links, team] = await Promise.all([
    db.from("studio_project_details").select("project_id, status, start_date, due_date").in("project_id", projectIds).returns<DetailsRow[]>(),
    // Cards, checklists, comments and images with the freelancer's session: no „Nur Team“, nothing archived (RLS).
    session.from("studio_tasks").select(TASK_COLUMNS).in("project_id", projectIds).eq("archived", false).returns<StudioTaskRow[]>(),
    db.from("organizations").select("id, name").in("id", organizationIds).returns<{ id: string; name: string }[]>(),
    session.from("studio_comments").select("task_id").in("organization_id", organizationIds).returns<{ task_id: string }[]>(),
    session.from("studio_subtasks").select("task_id, done").in("organization_id", organizationIds).returns<{ task_id: string; done: boolean }[]>(),
    session.from("studio_files").select("task_id").in("project_id", projectIds).eq("state", "ready").not("task_id", "is", null).returns<{ task_id: string }[]>(),
    // Who else works on these projects (for „Sichtbar für“ and as assignees); the session itself lists only its own rows.
    db.from("studio_project_freelancers").select("project_id, freelancer_id").in("project_id", projectIds).returns<LinkRow[]>(),
    loadTeam(db),
  ]);
  const error = details.error ?? tasks.error ?? organizations.error ?? comments.error ?? subtasks.error ?? files.error ?? links.error;
  if (error || !team) return failed(LOAD_ERROR, "freelancer");
  const freelancers = await loadFreelancers(db, organizationIds, [...new Set((links.data ?? []).map((link) => link.freelancer_id))]);
  if (!freelancers) return failed(LOAD_ERROR, "freelancer");

  const counts = countsOf(comments.data ?? [], subtasks.data ?? [], files.data ?? []);
  const boardTasks = (tasks.data ?? []).map((row) => toBoardTask(row, counts.get(row.id)));
  return {
    viewer: "freelancer",
    projects: boardProjectsOf(rows, details.data ?? [], organizations.data ?? [], links.data ?? []),
    tasks: boardTasks,
    people: await boardPeople(db, viewerId, team, freelancers, boardTasks, "freelancer"),
    freelancers,
    viewerId,
    // verifyHubFreelancer lets only sessions with a confirmed code through.
    confirmed: true,
    error: null,
  };
}

/** The board for the signed-in admin or freelancer, once per request. */
export const loadTaskBoard = cache(async (): Promise<TaskBoardState> => {
  const admin = await verifyHubAdmin();
  const freelancer = admin ? null : await verifyHubFreelancer();
  if (!admin && !freelancer) return failed("Das Aufgaben-Board ist für das oalab-Team und eingetragene Freelancer, jeweils mit bestätigter Anmeldung.");
  const db = createAdminClient();
  if (!db) return failed("Aufgaben sind noch nicht eingerichtet: Es fehlt der Server-Schlüssel.");
  return admin ? adminBoard(admin.userId, db) : freelancerBoard(freelancer!.userId, freelancer!.supabase as unknown as SupabaseClient, db);
});
