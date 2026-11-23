import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { audienceOf, PRIORITY_NAMES, STATUS_NAMES, TASK_COLUMNS, toBoardTask, type StudioTaskRow } from "@/lib/hub-tasks/rules";
import { loadFreelancerBoardAs } from "@/lib/hub-tasks/server";
import type { TaskContext } from "@/lib/hub-tasks/write";
import { readTaskDetailAs, saveSubtaskAs } from "@/lib/hub-tasks/write";
import { freelancerLinks } from "./freelancer-tools";
import type { ToolResult } from "./protocol";
import { readTaskRef, type ChecklistChange } from "./write-input";

// One card of the task board for the connector, admins and freelancers alike: get_task reads everything its window shows
// (lib/hub-tasks/write.ts readTaskDetailAs) with `read`, which is the server key for admins after their checks and the
// freelancer's own claims for freelancers, so „Nur Team“ cards stay invisible to them. Names come with the server key,
// as the board's own names do. update_checklist ticks, renames and adds points through the window's own code
// (saveSubtaskAs) with the version each point has now, once more on a newer point; removing a point stays in the hub.

type Db = NonNullable<ReturnType<typeof createAdminClient>>;
type Json = Record<string, unknown>;

const json = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const refuse = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });
export const NO_TASK = "Diese Aufgabe gibt es in dem Projekt nicht, oder sie ist nicht sichtbar. Nimm task_number aus get_project oder list_tasks.";

const AUDIENCE_WORDS = { team: "Nur Team", shared: "+ Freelancer", customer: "+ Kunde" } as const;
const MAX_COMMENTS = 40;
const MAX_HISTORY = 12;

/** A card by project and number, as `read` sees it; null when it is not there, archived or not visible. */
export async function cardOf(read: SupabaseClient, projectId: string, number: number) {
  const { data } = await read.from("studio_tasks").select(`${TASK_COLUMNS}, archived`).eq("project_id", projectId).eq("task_number", number)
    .maybeSingle<StudioTaskRow & { archived: boolean }>();
  return data && !data.archived ? data : null;
}

async function namesOf(db: Db, ids: (string | null | undefined)[]) {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!wanted.length) return new Map<string, string>();
  const { data } = await db.from("hub_profiles").select("user_id, first_name, last_name").in("user_id", wanted).returns<{ user_id: string; first_name: string | null; last_name: string | null }[]>();
  return new Map((data ?? []).map((row) => [row.user_id, `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "Teammitglied"]));
}

const sizeOf = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * get_task: the card with everything its window shows. `project` is the project as the caller may see it (checked
 * before: archived ones and those of archived customers never get here); `link` opens the card in the hub.
 */
export async function taskAnswer(input: { read: SupabaseClient; db: Db; project: { id: string; name: string }; number: number; link: string; projectLink: string }): Promise<ToolResult> {
  const row = await cardOf(input.read, input.project.id, input.number);
  if (!row) return refuse(NO_TASK);
  const detail = await readTaskDetailAs(input.read, row.id);
  if (!detail.ok) return refuse(detail.error);
  const task = toBoardTask(row);
  const { subtasks, comments, files, events } = detail.data;
  const names = await namesOf(input.db, [...task.assigneeIds, task.createdBy, ...comments.map((item) => item.authorId), ...events.map((item) => item.actorId)]);
  const nameOf = (id: string | null | undefined) => (id ? names.get(id) ?? "Teammitglied" : "Studio");
  const shownComments = comments.slice(-MAX_COMMENTS);
  return json({
    project: { project_id: input.project.id, name: input.project.name, link: input.projectLink },
    task_number: task.number,
    title: task.title,
    status: STATUS_NAMES[task.status],
    priority: PRIORITY_NAMES[task.priority],
    due_on: task.dueOn,
    labels: task.labels,
    assignees: task.assigneeIds.map((id) => ({ user_id: id, name: nameOf(id) })),
    visibility: AUDIENCE_WORDS[audienceOf(task)],
    description: detail.data.description || null,
    checklist: subtasks.map((point) => ({ point_id: point.id, title: point.title, done: point.done })),
    checklist_done: `${subtasks.filter((point) => point.done).length}/${subtasks.length}`,
    comments: shownComments.map((item) => ({ author: nameOf(item.authorId), at: item.createdAt, text: item.body })),
    ...(comments.length > shownComments.length ? { older_comments: comments.length - shownComments.length } : {}),
    files: files.map((file) => ({ name: file.name, size: sizeOf(file.size), type: file.mimeType, added_by: nameOf(file.createdBy), at: file.createdAt })),
    created: { by: nameOf(task.createdBy), at: task.createdAt },
    history: events.slice(-MAX_HISTORY).map((item) => ({ what: item.kind === "task.insert" ? "angelegt" : "geändert", by: nameOf(item.actorId), at: item.createdAt })),
    link: input.link,
  });
}

/**
 * get_task for a freelancer: only a card of the projects their own board lists (lib/hub-tasks/server.ts
 * loadFreelancerBoardAs), read with their claims, so „Nur Team“ cards are not there.
 */
export async function freelancerTask(userId: string, client: SupabaseClient, args: Json, origin: string): Promise<ToolResult> {
  const ref = readTaskRef(args);
  if (!ref.ok) return refuse(ref.error);
  const [board, db] = [await loadFreelancerBoardAs(userId, client), createAdminClient()];
  if (board.error || !db) return refuse(board.error ?? "Der Hub kann gerade nicht lesen. Bitte versuche es gleich noch einmal.");
  const project = board.projects.find((item) => item.id.toLowerCase() === ref.value.projectId.toLowerCase());
  if (!project) return refuse("Dieses Projekt gehört nicht zu deinen Projekten, oder es gibt es nicht mehr. Nimm die ID aus search oder get_project.");
  const links = freelancerLinks(origin);
  return taskAnswer({ read: client, db, project: { id: project.id, name: project.name }, number: ref.value.number, link: links.task(project.id, ref.value.number), projectLink: links.project(project.id) });
}

/**
 * update_checklist on a card the caller may change (checked before): each named point with the version it has now (a
 * point changed meanwhile is read again once), then the new points at the end. Returns the checklist as it is after.
 */
export async function changeChecklist(ctx: TaskContext, taskId: string, change: ChecklistChange): Promise<{ ok: true; points: { point_id: string; title: string; done: boolean }[]; changed: number; added: number; failed: string[] } | { ok: false; error: string }> {
  const current = async () => {
    const { data, error } = await ctx.read.from("studio_subtasks").select("id, title, done, version, board_order").eq("task_id", taskId).order("board_order")
      .returns<{ id: string; title: string; done: boolean; version: number; board_order: number }[]>();
    return error ? null : data ?? [];
  };
  const before = await current();
  if (!before) return { ok: false, error: "Die Checkliste konnte gerade nicht gelesen werden. Bitte versuche es erneut." };
  const byId = new Map(before.map((point) => [point.id.toLowerCase(), point]));
  const unknown = change.points.filter((point) => !byId.has(point.id.toLowerCase()));
  if (unknown.length) return { ok: false, error: `Diese Punkte gibt es auf der Karte nicht: ${unknown.map((point) => point.id).join(", ")}. Nimm point_id aus get_task.` };

  const failed: string[] = [];
  let changed = 0;
  for (const point of change.points) {
    const stored = byId.get(point.id.toLowerCase())!;
    const save = (version: number) => saveSubtaskAs(ctx, { taskId, subtaskId: stored.id, ...(point.title !== undefined ? { title: point.title } : {}), ...(point.done !== undefined ? { done: point.done } : {}), expectedVersion: version });
    let result = await save(Number(stored.version));
    if (!result.ok && result.stale) {
      const fresh = (await current())?.find((item) => item.id === stored.id);
      if (fresh) result = await save(Number(fresh.version));
    }
    if (result.ok) changed++;
    else failed.push(`„${stored.title}“: ${result.error}`);
  }
  let added = 0;
  for (const title of change.add) {
    const result = await saveSubtaskAs(ctx, { taskId, title });
    if (result.ok) added++;
    else failed.push(`neu „${title}“: ${result.error}`);
  }
  const after = (await current()) ?? before;
  return { ok: true, points: after.map((point) => ({ point_id: point.id, title: point.title, done: point.done })), changed, added, failed };
}

/** What the window says after the checklist changed, in one line. */
export function checklistText(title: string, result: { points: { done: boolean }[]; changed: number; added: number; failed: string[] }) {
  const done = result.points.filter((point) => point.done).length;
  const parts = [
    result.changed ? `${result.changed === 1 ? "ein Punkt" : `${result.changed} Punkte`} geändert` : "",
    result.added ? `${result.added === 1 ? "ein Punkt" : `${result.added} Punkte`} neu` : "",
  ].filter(Boolean);
  return `Checkliste von „${title}“: ${parts.join(", ") || "nichts geändert"}; ${done} von ${result.points.length} erledigt.${result.failed.length ? ` Nicht gespeichert: ${result.failed.join("; ")}` : ""}`;
}
