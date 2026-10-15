export const hubSections = ["projects", "files", "messages", "settings"] as const;
export type HubSection = "overview" | (typeof hubSections)[number];

export const sectionLabels: Record<HubSection, string> = {
  overview: "Übersicht",
  projects: "Projekte",
  files: "Dateien",
  messages: "Nachrichten",
  settings: "Einstellungen",
};

export type Project = {
  id: string;
  name: string;
  category: string;
  description: string;
  status: "In Umsetzung" | "Dein Feedback" | "Abgeschlossen";
  progress: number;
  date: string;
  artwork: "orange" | "sage" | "lilac";
  brand?: string;
  company?: string;
};

export type HubDemoData = {
  name: string;
  company: string;
  role: "oalab_admin" | "oalab_customer";
  projects: Project[];
  files: { name: string; project: string; type: string; size: string; date: string }[];
};

// Fictional content is used exclusively by the explicitly labelled /preview routes.
export const previewProjects: Project[] = [
  {
    id: "website-relaunch",
    name: "Ein neuer digitaler Auftritt.",
    category: "Website & Digital",
    description: "Eine Website, die zeigt, was Nordlicht ausmacht. Klar, eigenständig und mit Raum für neue Ideen.",
    status: "In Umsetzung",
    progress: 68,
    date: "30. Oktober 2026",
    artwork: "orange",
  },
  {
    id: "brand-identity",
    name: "Eine Marke. Ein Gefühl.",
    category: "Brand Identity",
    description: "Das visuelle Fundament für Nordlicht. Die erste Designrichtung wartet auf deine Gedanken.",
    status: "Dein Feedback",
    progress: 40,
    date: "23. Oktober 2026",
    artwork: "sage",
  },
  {
    id: "social-launch",
    name: "Bereit für den ersten Eindruck.",
    category: "Social & Content",
    description: "Ein abgestimmter Auftritt für die Kanäle, auf denen deine Marke zu Hause ist.",
    status: "Abgeschlossen",
    progress: 100,
    date: "09. Oktober 2026",
    artwork: "lilac",
  },
];

export const previewFiles = [
  { name: "Brand Direction – V01.pdf", project: "Brand Identity", type: "PDF", size: "4,2 MB", date: "14. Okt. 2026" },
  { name: "Website – Startseite.fig", project: "Website & Digital", type: "FIG", size: "12,8 MB", date: "13. Okt. 2026" },
  { name: "Projektbriefing.pdf", project: "Website & Digital", type: "PDF", size: "1,1 MB", date: "08. Okt. 2026" },
];

export function hubHref(preview: boolean, section: HubSection = "overview") {
  const base = preview ? "/preview" : "/dashboard";
  return section === "overview" ? base : `${base}/${section}`;
}
