import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { countRequests, toHubProject, toProjectTask, type LiveProjectsState, type StudioDetailsRow, type StudioProjectRow, type StudioTaskRow } from "./map";

// Real projects come from OALab Studio in the shared database. Service grants browsers no direct read of projects,
// organizations or requests, so the hub decides *which* projects a viewer sees first and reads their names afterwards:
// - admins pass the same check as the user management (hub role, second factor, is_hub_admin()) and see every project;
// - customers read Studio details and tasks with their own session, where Studio's RLS only returns what is released
//   to their company; names and request counts are then read for exactly those projects.

const DETAILS = "project_id, description, status, start_date, due_date, milestones";
const TASKS = "id, task_number, project_id, title, status, due_date, labels, client_visible";
const unavailable = (error: string): LiveProjectsState => ({ projects: [], error });

async function assemble(viewer: SupabaseClient, db: SupabaseClient, admin: boolean): Promise<LiveProjectsState> {
  // Which projects: everything that is not archived for admins, the released ones for customers.
  const visible = admin
    ? await db.from("customer_projects").select("id").neq("status", "archived").returns<{ id: string }[]>()
    : await viewer.from("studio_project_details").select("project_id").returns<{ project_id: string }[]>();
  if (visible.error) return unavailable("Die Projekte konnten gerade nicht geladen werden. Bitte versuche es erneut.");
  const ids = (visible.data ?? []).map((row) => "id" in row ? row.id : row.project_id);
  if (!ids.length) return { projects: [], error: null };

  // Customers read details and tasks with their own session, so Studio's RLS keeps internal tasks away from them.
  const reader = admin ? db : viewer;
  const [projects, details, tasks, requests] = await Promise.all([
    db.from("customer_projects").select("id, organization_id, display_name, status").in("id", ids).neq("status", "archived").returns<StudioProjectRow[]>(),
    reader.from("studio_project_details").select(DETAILS).in("project_id", ids).returns<StudioDetailsRow[]>(),
    reader.from("studio_tasks").select(TASKS).in("project_id", ids).eq("archived", false).returns<StudioTaskRow[]>(),
    db.from("service_requests").select("project_id, state").in("project_id", ids).is("trashed_at", null).returns<{ project_id: string; state: string }[]>(),
  ]);
  const error = projects.error ?? details.error ?? tasks.error ?? requests.error;
  if (error) return unavailable("Die Projekte konnten gerade nicht geladen werden. Bitte versuche es erneut.");

  const organizationIds = [...new Set((projects.data ?? []).map((row) => row.organization_id))];
  const organizations = organizationIds.length
    ? await db.from("organizations").select("id, name").in("id", organizationIds).returns<{ id: string; name: string }[]>()
    : { data: [], error: null };
  if (organizations.error) return unavailable("Die Projekte konnten gerade nicht geladen werden. Bitte versuche es erneut.");

  const names = new Map((organizations.data ?? []).map((row) => [row.id, row.name]));
  const detailsById = new Map((details.data ?? []).map((row) => [row.project_id, row]));
  return {
    error: null,
    projects: (projects.data ?? [])
      .map((project) => toHubProject({
        project,
        details: detailsById.get(project.id) ?? null,
        tasks: (tasks.data ?? []).filter((task) => task.project_id === project.id).map(toProjectTask),
        requests: countRequests((requests.data ?? []).filter((request) => request.project_id === project.id)),
        company: names.get(project.organization_id),
      }))
      .sort((a, b) => (a.company ?? "").localeCompare(b.company ?? "", "de") || a.name.localeCompare(b.name, "de")),
  };
}

/** Studio projects of the signed-in login, once per request (layout and page share it). */
export const loadLiveProjects = cache(async (): Promise<LiveProjectsState> => {
  const db = createAdminClient();
  if (!db) return unavailable("Projekte sind noch nicht eingerichtet: Es fehlt der Server-Schlüssel (SUPABASE_SECRET_KEY).");
  const admin = Boolean(await verifyHubAdmin());
  return assemble(await createClient(), db, admin);
});

/** Real projects for a signed-in login; the preview, the public demo and the demo logins keep their fixtures. */
export async function loadProjectsForIdentity(identity: { publicDemo: boolean; demoAccess: unknown }) {
  return identity.publicDemo || identity.demoAccess ? undefined : loadLiveProjects();
}
