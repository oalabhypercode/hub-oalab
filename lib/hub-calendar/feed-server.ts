import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { connectorClaims } from "@/lib/platform/auth";
import { createOwnClaimsClient } from "@/lib/platform/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { readArchive } from "@/lib/hub-archive/server";
import { noArchive } from "@/lib/hub-archive/rules";
import { loadLiveProjectsAs } from "@/lib/hub-projects/server";
import {
  FEED_LIMIT, feedCalendar, feedEvents, feedWindow,
  type FeedAppointment, type FeedGoal, type FeedOptions, type FeedRole, type FeedTask,
} from "./feed";

// One fetch of a calendar subscription reads with the rights of the person it belongs to: a client carrying their own
// claims (lib/platform/auth.ts connectorClaims, as for the Claude connector), never with a session and never with the
// server key for the appointments. Row Level Security therefore decides exactly as in the hub: admins every appointment,
// customers and freelancers those of the entries their login belongs to. Projects and tasks come as the hub assembles
// them (lib/hub-projects/server.ts): the person's rules pick the released ones, the server key adds their names; the
// admins' due tasks are read like their task board, with the server key after the admin check of the fetch.

type AppointmentRow = {
  id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  status: string;
  teams_url: string | null;
  updated_at: string;
  customer_id: string | null;
  customer: { company: string } | null;
};
type TaskRow = { id: string; task_number: number; project_id: string; title: string; status: string; due_date: string | null; assignee_user_ids: string[] | null };

const APPOINTMENTS = "id, title, description, starts_at, ends_at, status, teams_url, updated_at, customer_id, customer:hub_customers(company)";

/** The feed's text for one fetch, or null when it cannot be read right now (the route answers 503 then). */
export async function loadFeedBody(input: { userId: string; role: FeedRole; options: FeedOptions; origin: string; now: number }): Promise<string | null> {
  const claims = await connectorClaims(input.userId).catch(() => null);
  if (!claims) return null;
  const viewer = createOwnClaimsClient(claims) as unknown as SupabaseClient;
  const admin = input.role === "admin";
  const window = feedWindow(input.now);
  const from = new Date(window.from).toISOString();
  const to = new Date(window.to).toISOString();
  const statuses = input.options.requests ? ["confirmed", "requested"] : ["confirmed"];

  // Customers and freelancers: only the appointments of the entries their login belongs to, as in the hub's calendar.
  let entries: string[] | null = null;
  if (!admin) {
    const members = await viewer.from("hub_customer_members").select("customer_id").eq("user_id", input.userId).returns<{ customer_id: string }[]>();
    if (members.error) return null;
    entries = (members.data ?? []).map((row) => row.customer_id);
  }
  const db = admin || input.options.goals || input.options.tasks ? createAdminClient() : null;
  const wantsProjects = input.role !== "freelancer" && (input.options.goals || input.options.tasks);
  const [appointments, archive, projects] = await Promise.all([
    entries && !entries.length
      ? Promise.resolve({ data: [] as AppointmentRow[], error: null })
      : (() => {
        const query = viewer.from("hub_appointments").select(APPOINTMENTS).in("status", statuses).lt("starts_at", to).gt("ends_at", from);
        return (entries ? query.in("customer_id", entries) : query).order("starts_at").limit(FEED_LIMIT).returns<AppointmentRow[]>();
      })(),
    // Archived customers stay out of the admins' feed as out of their calendar.
    admin && db ? readArchive(db) : noArchive,
    wantsProjects ? loadLiveProjectsAs(viewer, admin) : null,
  ]);
  if (appointments.error || projects?.error) return null;

  const list: FeedAppointment[] = (appointments.data ?? [])
    .filter((row) => !row.customer_id || !archive.customerIds.has(row.customer_id))
    .map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description ?? "",
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      status: row.status,
      teamsUrl: row.teams_url,
      updatedAt: row.updated_at,
      company: admin ? row.customer?.company ?? null : null,
    }));

  const shown = projects?.projects ?? [];
  const goals: FeedGoal[] = shown.flatMap((project) => project.dueOn
    ? [{ projectId: project.id, name: project.name, company: project.company ?? "", day: project.dueOn, done: project.status === "Abgeschlossen" }]
    : []);

  let tasks: FeedTask[] = [];
  if (input.options.tasks && input.role === "customer") {
    tasks = shown.flatMap((project) => (project.tasks ?? []).flatMap((task): FeedTask[] => task.dueOn ? [{
      id: task.id, number: task.number, title: task.title, day: task.dueOn, projectName: project.name, company: project.company ?? "",
      done: task.status === "done", customerTurn: task.customer, visible: task.visible, assigneeIds: [],
    }] : []));
  } else if (input.options.tasks && admin && db && shown.length) {
    // Like the admins' task board: every open task with a due date in the projects they see, with its assignees.
    const projectOf = new Map(shown.map((project) => [project.id, project]));
    const fromDay = from.slice(0, 10);
    const toDay = to.slice(0, 10);
    const rows = await db.from("studio_tasks").select("id, task_number, project_id, title, status, due_date, assignee_user_ids")
      .in("project_id", [...projectOf.keys()]).eq("archived", false).neq("status", "done").gte("due_date", fromDay).lte("due_date", toDay)
      .limit(FEED_LIMIT).returns<TaskRow[]>();
    if (rows.error) return null;
    tasks = (rows.data ?? []).flatMap((row): FeedTask[] => {
      const project = projectOf.get(row.project_id);
      return project && row.due_date ? [{
        id: row.id, number: Number(row.task_number), title: row.title, day: row.due_date, projectName: project.name, company: project.company ?? "",
        done: row.status === "done", customerTurn: false, visible: false, assigneeIds: row.assignee_user_ids ?? [],
      }] : [];
    });
  }

  return feedCalendar(feedEvents({ role: input.role, options: input.options, origin: input.origin, now: input.now, viewerId: input.userId, appointments: list, goals, tasks }));
}
