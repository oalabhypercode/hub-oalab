import "server-only";
import blueprint from "@/config/demo-accounts.json";
import { previewProjects, type HubDemoData, type Project } from "./hub-data";
import type { DemoAccess } from "./demo-access";

const workspaceContent = {
  nordlicht: {
    company: "Nordlicht Studio",
    brand: "NORDLICHT",
    titles: ["Ein neuer digitaler Auftritt.", "Eine Marke. Ein Gefühl.", "Bereit für den ersten Eindruck."],
    progress: [68, 40, 100],
  },
  formfeld: {
    company: "Form & Feld",
    brand: "FORM & FELD",
    titles: ["Raum für eine neue Website.", "Identität mit Ecken und Kanten.", "Ein guter Start für Social."],
    progress: [32, 75, 100],
  },
  horizont: {
    company: "Studio Horizont",
    brand: "HORIZONT",
    titles: ["Neue Perspektiven. Digital.", "Ein klarer Blick nach vorn.", "Deine Geschichte wird sichtbar."],
    progress: [85, 55, 100],
  },
};

/** Select data on the server from verified access, never from a client selector. */
export function getDemoData(access: DemoAccess, displayName: string): HubDemoData {
  const workspaces = access.role === "oalab_admin"
    ? Object.entries(workspaceContent)
    : [[access.workspace, workspaceContent[access.workspace]] as const];

  const projects: Project[] = workspaces.flatMap(([slug, workspace]) => previewProjects.map((project, index) => ({
    ...project,
    id: `${slug}-${project.id}`,
    name: workspace.titles[index],
    description: `${workspace.company}: ${project.description.replaceAll("Nordlicht", workspace.company)}`,
    progress: workspace.progress[index],
    company: workspace.company,
    brand: workspace.brand,
  })));
  const files = workspaces.flatMap(([, workspace]) => [
    { name: `${workspace.company} – Brand Direction.pdf`, project: `${workspace.company} / Brand Identity`, type: "PDF", size: "4,2 MB", date: "14. Okt. 2026" },
    { name: `${workspace.company} – Projektbriefing.pdf`, project: `${workspace.company} / Website`, type: "PDF", size: "1,1 MB", date: "08. Okt. 2026" },
  ]);
  const account = blueprint.accounts.find((item) => item.role === access.role && item.workspace === access.workspace);
  return {
    name: displayName || account?.name || "Dein Testkonto",
    company: access.role === "oalab_admin" ? "OALAB Administration" : workspaceContent[access.workspace].company,
    role: access.role,
    projects,
    files,
  };
}
