export const hubSections = ["projects", "files", "messages", "settings", "insights", "discover"] as const;
export type HubSection = "overview" | (typeof hubSections)[number];

export const sectionLabels: Record<HubSection, string> = {
  overview: "Übersicht",
  projects: "Projekte",
  files: "Dateien",
  messages: "Nachrichten",
  settings: "Profil",
  insights: "Insights",
  discover: "Entdecken",
};

/** Fictional reference day of all fixtures; dates in the demo history are relative to it. */
export const DEMO_AS_OF = "2026-10-15";

export type Milestone = { title: string; at: string; kind: "milestone" | "feedback" };

export type HubFile = { name: string; project: string; type: string; size: string; date: string; sharedAt: string };

export type NextStep = { id: string; title: string; category: string; date: string; dueOn: string; projectIndex: number };

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
  /** ISO dates of the fictional project history. */
  startedOn: string;
  dueOn: string;
  milestones: Milestone[];
};

export type HubDemoData = {
  name: string;
  company: string;
  role: "oalab_admin" | "oalab_customer";
  projects: Project[];
  files: HubFile[];
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
    startedOn: "2026-06-01",
    dueOn: "2026-10-30",
    milestones: [
      { title: "Kickoff", at: "2026-06-03T10:00", kind: "milestone" },
      { title: "Zielbild & Briefing", at: "2026-07-02T14:00", kind: "milestone" },
      { title: "Designsystem", at: "2026-08-26T15:30", kind: "milestone" },
      { title: "Konzept & Struktur", at: "2026-10-13T11:30", kind: "milestone" },
    ],
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
    startedOn: "2026-08-17",
    dueOn: "2026-10-23",
    milestones: [
      { title: "Kickoff", at: "2026-08-19T10:00", kind: "milestone" },
      { title: "Moodboard", at: "2026-09-10T16:00", kind: "milestone" },
      { title: "Erste Designrichtung", at: "2026-10-14T09:30", kind: "feedback" },
    ],
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
    startedOn: "2026-05-04",
    dueOn: "2026-10-09",
    milestones: [
      { title: "Kickoff", at: "2026-05-06T09:30", kind: "milestone" },
      { title: "Content-Plan", at: "2026-06-15T13:00", kind: "milestone" },
      { title: "Kampagnen-Assets", at: "2026-08-20T11:00", kind: "milestone" },
      { title: "Launch", at: "2026-10-09T10:00", kind: "milestone" },
    ],
  },
];

export const previewFiles: HubFile[] = [
  { name: "Brand Direction – V01.pdf", project: "Brand Identity", type: "PDF", size: "4,2 MB", date: "14. Okt. 2026", sharedAt: "2026-10-14T09:30" },
  { name: "Website – Startseite.fig", project: "Website & Digital", type: "FIG", size: "12,8 MB", date: "13. Okt. 2026", sharedAt: "2026-10-13T16:10" },
  { name: "Projektbriefing.pdf", project: "Website & Digital", type: "PDF", size: "1,1 MB", date: "08. Okt. 2026", sharedAt: "2026-10-08T11:00" },
];

/** Steps for the customer; projectIndex points into the workspace's project list. */
export const demoNextSteps: NextStep[] = [
  { id: "feedback", title: "Designrichtung ansehen", category: "Brand Identity", date: "Bis 16. Oktober", dueOn: "2026-10-16", projectIndex: 1 },
  { id: "content", title: "Website-Inhalte abstimmen", category: "Website & Digital", date: "Bis 19. Oktober", dueOn: "2026-10-19", projectIndex: 0 },
];

/** The single example conversation shown on the messages page. */
export const demoConversation = { title: "Brand Identity", person: "Lena Schneider", initials: "LS", topic: "Neue Designrichtung", sentAt: "2026-10-14T09:40" };

export function hubHref(preview: boolean, section: HubSection = "overview") {
  const base = preview ? "/preview" : "/dashboard";
  return section === "overview" ? base : `${base}/${section}`;
}

export function metricHref(preview: boolean, metric: string) {
  return `${hubHref(preview)}/metrics/${metric}`;
}

export function appearanceHref(preview: boolean) {
  return `${hubHref(preview, "settings")}/appearance`;
}
