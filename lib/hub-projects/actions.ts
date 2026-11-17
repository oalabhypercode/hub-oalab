"use server";

import type { StudioProjectStatus } from "@/lib/hub-data";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { isUuid } from "@/lib/hub-domains/rules";
import { isStudioStatus, studioStatuses } from "./desk";
import { changedWords, readProjectPatch, readProjectUrl, type PatchKey, type ProjectPatch } from "./edit";
import { createProjectAs, failed, studioError, type ProjectTeam } from "./write";

// The admins' project page (Projekte V2) writes here. Every action is a public POST endpoint, so each checks again
// who calls. Studio's part of a project (status, description, days, milestones, visibility) is written with the
// admin's *own* session: Studio's RLS lets only team members with a confirmed second factor change it, and its
// triggers check the row, raise the version and log the change under the admin's name, as if it was made in Studio.
// The project row itself (customer_projects: name, test and live address, migration 202610190001 in service-oalab)
// grants browsers nothing, so it is written with the service role once the caller has passed the same checks.
// „Neues Projekt“ runs through lib/hub-projects/write.ts, which the Claude connector uses as well.

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; stale?: true };

const denied = "Dafür brauchst du einen aktiven Admin-Zugang mit bestätigtem zweitem Faktor.";
// An admin whose second factor is off signs in with the password alone (aal1); the page offers the code (16.11.2026).
const needsCode = "Bitte bestätige deine Anmeldung zuerst einmal mit einem Code aus der Mail („Mit Code bestätigen“ oben auf der Seite). Nichts wurde gespeichert.";
const gone = { ok: false as const, error: "Dieses Projekt gibt es nicht mehr." };

type Team = ProjectTeam;

/**
 * An active admin (hub role, is_hub_admin()) whose own session confirmed a code (aal2), as Studio's RLS demands for
 * every change; otherwise why not, in words: an admin without the code is sent to „Mit Code bestätigen“.
 */
async function teamActor(): Promise<Team | { refused: string }> {
  const admin = await verifyHubAdmin();
  const db = admin ? createAdminClient() : null;
  if (!admin || !db) return { refused: denied };
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (claims?.claims?.aal !== "aal2") return { refused: needsCode };
  return { userId: admin.userId, supabase, db };
}

/** The version the page showed: null while Studio has no details row yet, undefined for anything else. */
const versionOf = (value: unknown) => value === null ? null
  : typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value
  : undefined;

async function customerOf(db: Team["db"], organizationId: string) {
  const { data } = await db.from("hub_customers").select("id").eq("organization_id", organizationId).maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

/**
 * Saves both addresses of a project from the list; an empty field clears its address. Like every change on the page it
 * needs a session confirmed with a code, so the page is read-only in one piece until then.
 */
export async function saveProjectUrls(input: { projectId?: unknown; liveUrl?: unknown; testUrl?: unknown }): Promise<ActionResult<{ liveUrl: string | null; testUrl: string | null }>> {
  const ctx = await teamActor();
  if ("refused" in ctx) return { ok: false, error: ctx.refused };
  const { db } = ctx;
  if (!isUuid(input?.projectId)) return gone;
  const live = readProjectUrl(input.liveUrl);
  if (!live.ok) return { ok: false, error: `Live-Adresse: ${live.error}` };
  const preview = readProjectUrl(input.testUrl);
  if (!preview.ok) return { ok: false, error: `Test-Adresse: ${preview.error}` };

  const write = await db.from("customer_projects").update({ live_url: live.value, test_url: preview.value })
    .eq("id", input.projectId).neq("status", "archived").select("organization_id, display_name").maybeSingle<{ organization_id: string; display_name: string }>();
  if (write.error) return { ok: false, error: write.error.code === "23514" ? "Bitte nur Adressen mit https:// eintragen." : failed.error };
  if (!write.data) return gone;

  await db.from("hub_admin_events").insert({ actor_id: ctx.userId, action: "project.urls_saved", summary: `Adressen von „${write.data.display_name}“ gespeichert`.slice(0, 300), target_customer_id: await customerOf(db, write.data.organization_id) });
  refreshWorkspace();
  return { ok: true, data: { liveUrl: live.value, testUrl: preview.value } };
}

const staleStatus = { ok: false as const, stale: true as const, error: "Der Status wurde inzwischen im Studio geändert. Nichts wurde überschrieben; die Seite zeigt jetzt den neuesten Stand." };

/**
 * Sets a project's Studio status from the admins' project page (Projekte V2, user 15.11.2026), with the admin's own
 * session. The version the page showed (null while Studio has no details row yet) keeps a change made in Studio
 * meanwhile from being lost.
 */
export async function setProjectStatus(input: { projectId?: unknown; status?: unknown; expectedVersion?: unknown }): Promise<ActionResult<{ status: StudioProjectStatus; version: number }>> {
  const ctx = await teamActor();
  if ("refused" in ctx) return { ok: false, error: ctx.refused };
  if (!isUuid(input?.projectId)) return gone;
  if (!isStudioStatus(input.status)) return { ok: false, error: "Diesen Status gibt es nicht." };
  const expected = versionOf(input.expectedVersion);
  if (expected === undefined) return staleStatus;
  const { projectId, status } = input as { projectId: string; status: StudioProjectStatus };

  const project = await ctx.db.from("customer_projects").select("organization_id, display_name").eq("id", projectId).neq("status", "archived")
    .maybeSingle<{ organization_id: string; display_name: string }>();
  if (project.error) return failed;
  if (!project.data) return gone;

  const write = expected === null
    // Studio has no details row yet: create it, as Studio does on a project's first change.
    ? await ctx.supabase.from("studio_project_details").insert({ project_id: projectId, organization_id: project.data.organization_id, created_by: ctx.userId, status }).select("version")
    : await ctx.supabase.from("studio_project_details").update({ status }).eq("project_id", projectId).eq("version", expected).select("version");
  if (write.error) return write.error.code === "23505" ? staleStatus : { ok: false, error: studioError(write.error) };
  const version = Number((write.data as { version: number }[] | null)?.[0]?.version);
  if (!write.data?.length || !Number.isSafeInteger(version)) return staleStatus;

  await ctx.db.from("hub_admin_events").insert({ actor_id: ctx.userId, action: "project.status_set", summary: `Status von „${project.data.display_name}“: ${studioStatuses[status].label}`.slice(0, 300), target_customer_id: await customerOf(ctx.db, project.data.organization_id) });
  refreshWorkspace();
  return { ok: true, data: { status, version } };
}

const staleDetails = { ok: false as const, stale: true as const, error: "Inzwischen hat jemand das Projekt im Studio geändert. Nichts wurde überschrieben; die Seite zeigt jetzt den neuesten Stand, deine Eingaben stehen noch da. Prüfe sie und speichere noch einmal." };

/** Studio's columns of a change; the name and both addresses live on the project row itself. */
function detailColumns(patch: ProjectPatch) {
  return {
    ...("description" in patch ? { description: patch.description } : {}),
    ...("startDate" in patch ? { start_date: patch.startDate } : {}),
    ...("dueDate" in patch ? { due_date: patch.dueDate } : {}),
    ...("milestones" in patch ? { milestones: patch.milestones } : {}),
    ...("clientVisible" in patch ? { client_visible: patch.clientVisible } : {}),
  };
}
function rowColumns(patch: ProjectPatch) {
  return {
    ...("name" in patch ? { display_name: patch.name } : {}),
    ...("liveUrl" in patch ? { live_url: patch.liveUrl } : {}),
    ...("testUrl" in patch ? { test_url: patch.testUrl } : {}),
  };
}

/**
 * Saves what an admin changed in a project's panel (Projekte V2 step 2, user 16.11.2026): name, description, start,
 * target day, milestones, test and live domain, and whether the customer sees the project. Studio's part goes first
 * and only while its version is still the one the page showed; the name and the addresses follow on the project row.
 * The result carries the new version, so the next change of the same panel needs no reload.
 */
export async function saveProjectDetails(input: { projectId?: unknown; expectedVersion?: unknown; patch?: unknown }): Promise<ActionResult<{ version: number | null; patch: ProjectPatch }>> {
  const ctx = await teamActor();
  if ("refused" in ctx) return { ok: false, error: ctx.refused };
  if (!isUuid(input?.projectId)) return gone;
  const read = readProjectPatch(input.patch);
  if (!read.ok) return { ok: false, error: read.error };
  const patch = read.value;
  const expected = versionOf(input.expectedVersion);
  if (expected === undefined) return staleDetails;
  const projectId = input.projectId as string;

  const project = await ctx.db.from("customer_projects").select("organization_id, display_name").eq("id", projectId).neq("status", "archived")
    .maybeSingle<{ organization_id: string; display_name: string }>();
  if (project.error) return failed;
  if (!project.data) return gone;

  const studio = detailColumns(patch);
  let version = expected;
  if (Object.keys(studio).length) {
    // Only one of the two days changes: its order is checked against the other one Studio holds.
    if (("startDate" in patch) !== ("dueDate" in patch)) {
      const current = await ctx.supabase.from("studio_project_details").select("start_date, due_date").eq("project_id", projectId).maybeSingle<{ start_date: string | null; due_date: string | null }>();
      const start = "startDate" in patch ? patch.startDate : current.data?.start_date ?? null;
      const due = "dueDate" in patch ? patch.dueDate : current.data?.due_date ?? null;
      if (start && due && start > due) return { ok: false, error: "Der Zieltermin liegt vor dem Start." };
    }
    const write = expected === null
      // Studio has no details row yet: create it, as Studio does on a project's first change.
      ? await ctx.supabase.from("studio_project_details").insert({ project_id: projectId, organization_id: project.data.organization_id, created_by: ctx.userId, ...studio }).select("version")
      : await ctx.supabase.from("studio_project_details").update(studio).eq("project_id", projectId).eq("version", expected).select("version");
    if (write.error) return write.error.code === "23505" ? staleDetails : { ok: false, error: studioError(write.error) };
    const saved = Number((write.data as { version: number }[] | null)?.[0]?.version);
    if (!write.data?.length || !Number.isSafeInteger(saved)) return staleDetails;
    version = saved;
  }

  const own = rowColumns(patch);
  if (Object.keys(own).length) {
    const write = await ctx.db.from("customer_projects").update(own).eq("id", projectId).neq("status", "archived").select("id").maybeSingle<{ id: string }>();
    if (write.error || !write.data) {
      const what = changedWords(Object.keys(patch).filter((key) => key === "name" || key === "liveUrl" || key === "testUrl") as PatchKey[]);
      const error = write.error?.code === "23514" ? "Bitte nur Adressen mit https:// eintragen." : failed.error;
      // Studio's part may already be saved; the page reloads, so the next save carries the new version.
      return Object.keys(studio).length ? { ok: false, stale: true, error: `${what} konnte nicht gespeichert werden, der Rest schon. ${error}` } : { ok: false, error: write.data === null && !write.error ? gone.error : error };
    }
  }

  const name = patch.name ?? project.data.display_name;
  await ctx.db.from("hub_admin_events").insert({ actor_id: ctx.userId, action: "project.saved", summary: `„${name}“ geändert: ${changedWords(Object.keys(patch) as PatchKey[])}`.slice(0, 300), target_customer_id: await customerOf(ctx.db, project.data.organization_id) });
  refreshWorkspace();
  return { ok: true, data: { version, patch } };
}

/**
 * „Neues Projekt“ for a hub customer on the project page (Projekte V2 step 2), the way Studio creates one
 * (lib/hub-projects/write.ts): a project row on the customer's service platform organization and its Studio details.
 */
export async function createProject(input: { customerId?: unknown; status?: unknown; visible?: unknown; draft?: unknown }): Promise<ActionResult<{ id: string; name: string }>> {
  const ctx = await teamActor();
  if ("refused" in ctx) return { ok: false, error: ctx.refused };
  const result = await createProjectAs(ctx, input);
  if (!result.ok) return result;
  refreshWorkspace();
  return { ok: true, data: { id: result.data.id, name: result.data.name } };
}
