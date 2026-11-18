import { formatDeadline, hubHref, type Project } from "@/lib/hub-data";
import { dayOf, formatDayShort, timeOf } from "@/lib/hub-calendar/rules";
import { adminTodos, serviceRows, todoId, type AdminTodo } from "@/lib/hub-insights/rules";
import type { OverviewWidgetsData } from "@/lib/hub-overview/types";
import { quotaMonth } from "@/lib/hub-service-quota/rules";
import type { CenterItem } from "./notification-center";

const projectName = (project: Project) => project.category || project.name;

/**
 * What waits for admins as lines among the notifications (design „V5“, 18.11.2026): waiting registrations, open
 * appointment requests, overdue tasks, full quotas, projects at risk or waiting for the customer. They are derived each
 * time the page loads, so they have no row in the bell: read and hidden ones are kept in this browser (notification
 * centre). The time column says what they are about („offen“, „überfällig“, …) instead of a time.
 */
export function adminNotices({ data, projects, registrations, preview }: { data: OverviewWidgetsData; projects: Project[]; registrations: number; preview: boolean }): CenterItem[] {
  const rows = serviceRows(data.quota.rows, new Map(Object.entries(data.quota.names)));
  const month = data.quota.window ? quotaMonth(data.quota.window).month : "";
  const projectsHref = hubHref(preview, "projects");
  // One second apart from the page's time on, so they keep their order (most pressing first) above the bell's notices.
  const line = (todo: AdminTodo, index: number, kind: string, label: string, title: string, body: string, href: string): CenterItem => ({ id: todoId(todo.key), kind, title, body, href, createdAt: new Date(data.now - index * 1000).toISOString(), read: false, label });
  return adminTodos({ registrations, appointments: data.appointments, projects, rows, today: data.today, now: data.now }).map((todo, index) => {
    switch (todo.kind) {
      case "registrations":
        return line(todo, index, "todo.registrations", "offen", todo.count === 1 ? "Neue Registrierung" : `${todo.count} neue Registrierungen`, "Wartet auf deine Freigabe im User Management.", hubHref(preview, "users"));
      case "request": {
        const day = dayOf(todo.appointment.start);
        return line(todo, index, "todo.request", "angefragt", `Terminanfrage: ${todo.appointment.title}`, `${todo.appointment.customer?.company ?? "Ein Kunde"} möchte ${formatDayShort(day)} um ${timeOf(todo.appointment.start)} Uhr. Bestätigen oder ablehnen im Kalender.`, `${hubHref(preview, "calendar")}?day=${day}`);
      }
      case "overdue": {
        const { task, project } = todo.first;
        const where = [project.company, projectName(project)].filter(Boolean).join(" · ");
        return line(todo, index, "todo.overdue", "überfällig", todo.count === 1 ? `Überfällig: #${task.number} ${task.title}` : `${todo.count} Aufgaben überfällig`,
          todo.count === 1 ? `${where}${task.dueOn ? ` · fällig seit ${formatDeadline(task.dueOn)}` : ""}` : `Am längsten: #${task.number} ${task.title} (${where})`, `${projectsHref}/tasks?project=${project.id}`);
      }
      case "quota":
        return line(todo, index, "todo.quota", "voll", `Kontingent aufgebraucht: ${todo.row.company}`, `${todo.row.packageId === "service-max" ? "Service Max" : "Service Lite"}: ${todo.row.used} von ${todo.row.limit} Anfragen${month ? ` im ${month}` : ""} genutzt.`, hubHref(preview, "contracts"));
      case "risk":
        return line(todo, index, "todo.risk", "gefährdet", `Gefährdet: ${projectName(todo.project)}`, [todo.project.company, todo.project.dueOn ? `Ziel ${formatDeadline(todo.project.dueOn)}` : ""].filter(Boolean).join(" · ") || "Studio führt das Projekt als gefährdet.", `${projectsHref}?project=${todo.project.id}`);
      case "waiting":
        return line(todo, index, "todo.waiting", "wartet", `Wartet auf Kunden: ${projectName(todo.project)}`, [todo.project.company, todo.waiting ? `${todo.waiting} ${todo.waiting === 1 ? "Aufgabe liegt" : "Aufgaben liegen"} beim Kunden` : "Feedback des Kunden steht aus"].filter(Boolean).join(" · "), `${projectsHref}?project=${todo.project.id}`);
    }
  });
}
