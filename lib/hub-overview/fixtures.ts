import { addDays } from "@/lib/hub-calendar/rules";
import type { Project, ProjectTask } from "@/lib/hub-data";
import { previewInsights } from "@/lib/hub-insights/fixtures";
import { weekStartOf } from "@/lib/hub-insights/rules";
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
