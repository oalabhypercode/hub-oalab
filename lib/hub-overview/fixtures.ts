import { addDays } from "@/lib/hub-calendar/rules";
import type { Project, ProjectTask } from "@/lib/hub-data";
import { previewInsights } from "@/lib/hub-insights/fixtures";
import { weekStartOf } from "@/lib/hub-insights/rules";
import type { BoardProject, BoardTask } from "@/lib/hub-tasks/types";
import type { OverviewWidgetsData } from "./types";

// Fictional content for the design preview (/preview, local only) and for checks with fixtures; never real data.

/** The widgets' data in the preview: the Insights fixtures, this week from the preview's day on. */
export function previewWidgets(asOf: string, admin: boolean): OverviewWidgetsData {
  const { today, now, appointments, appointmentsError, quota } = previewInsights(asOf, admin);
  return { today, now, weekStart: weekStartOf(asOf), appointments, appointmentsError, quota };
}

/**
 * The preview's projects carry no tasks; for the widgets they get a fictional board: open and finished tasks, some
 * with dates in the next two weeks and one overdue, all released to the customer.
 */
export function withPreviewTasks(projects: readonly Project[], asOf: string): Project[] {
  const plan: [ProjectTask["status"], number | null][] = [["done", null], ["done", null], ["done", -3], ["review", 1], ["progress", 2], ["progress", null], ["todo", 4], ["todo", 9], ["backlog", null], ["todo", -1], ["done", null], ["progress", 6]];
  return projects.map((project, index) => index > 1 || project.tasks ? project : {
    ...project,
    tasks: plan.filter((_, i) => i % 2 === index).map(([status, days], i): ProjectTask => ({
      id: `${project.id}-preview-${i}`, number: 100 + index * 20 + i, title: `Beispielaufgabe ${i + 1}`, status,
      dueOn: days === null ? null : addDays(asOf, days), customer: i === 1, visible: true,
    })),
  });
}

/**
 * A freelancer's board in the preview (local checks only; /preview is the customer's view): the fictional tasks of the
 * first projects as board tasks, every second one assigned to the viewer.
 */
export function previewBoard(projects: readonly Project[], asOf: string, viewerId: string): { projects: BoardProject[]; tasks: BoardTask[]; viewerId: string; error: null } {
  const withTasks = withPreviewTasks(projects, asOf).filter((project) => project.tasks?.length);
  const at = new Date(`${asOf}T08:00:00Z`).toISOString();
  return {
    viewerId,
    error: null,
    projects: withTasks.map((project) => ({ id: project.id, name: project.name, organizationId: "", company: project.company ?? "Nordlicht Studio", startedOn: project.startedOn, dueOn: project.dueOn, status: "active", freelancerIds: [viewerId] })),
    tasks: withTasks.flatMap((project) => (project.tasks ?? []).map((task, index): BoardTask => ({
      id: task.id, number: task.number, projectId: project.id, title: task.title, status: task.status, priority: "medium", dueOn: task.dueOn, labels: [],
      assigneeIds: index % 2 === 0 ? [viewerId] : [], visible: task.visible, teamOnly: false, order: index, version: 1, createdBy: viewerId, createdAt: at, updatedAt: at,
      comments: 0, checklist: { done: 0, total: 0 }, files: 0,
    }))),
  };
}
