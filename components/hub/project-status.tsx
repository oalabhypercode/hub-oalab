import type { Project } from "@/lib/hub-data";

export function ProjectStatus({ value }: { value: Project["status"] }) {
  return <span className={`project-status status-${value === "Dein Feedback" ? "feedback" : value === "Abgeschlossen" ? "done" : "active"}`}><i aria-hidden="true" />{value}</span>;
}
