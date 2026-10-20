import "server-only";
import blueprint from "@/config/demo-accounts.json";
import { previewProjects, sampleFileFixtures, type HubDemoData, type Project } from "./hub-data";
import type { DemoAccess } from "./demo-access";
import { servicePackages, type ServicePackageId } from "./service-packages";

const workspaceContent: Record<"nordlicht" | "formfeld" | "horizont", { company: string; customerNumber: string; servicePackages: ServicePackageId[]; brand: string; titles: string[]; progress: number[] }> = {
  nordlicht: {
    company: "Nordlicht Studio",
    customerNumber: "KD-24017",
    servicePackages: ["website-extra"],
    brand: "NORDLICHT",
    titles: ["Ein neuer digitaler Auftritt.", "Eine Marke. Ein Gefühl.", "Bereit für den ersten Eindruck."],
    progress: [68, 40, 100],
  },
  formfeld: {
    company: "Form & Feld",
    customerNumber: "KD-24023",
    servicePackages: ["website-lite"],
    brand: "FORM & FELD",
    titles: ["Raum für eine neue Website.", "Identität mit Ecken und Kanten.", "Ein guter Start für Social."],
    progress: [32, 75, 100],
  },
  horizont: {
    company: "Studio Horizont",
    customerNumber: "KD-24031",
    servicePackages: ["website-max"],
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
  const files = workspaces.flatMap(([slug, workspace]) => sampleFileFixtures(slug, workspace.company, workspace.customerNumber, servicePackages[workspace.servicePackages[0]].name));
  const account = blueprint.accounts.find((item) => item.role === access.role && item.workspace === access.workspace);
  return {
    name: displayName || account?.name || "Dein Testkonto",
    company: access.role === "oalab_admin" ? "OALAB Administration" : workspaceContent[access.workspace].company,
    customerNumber: access.role === "oalab_admin" ? null : workspaceContent[access.workspace].customerNumber,
    servicePackages: access.role === "oalab_admin" ? [] : workspaceContent[access.workspace].servicePackages,
    role: access.role,
    projects,
    files,
  };
}
