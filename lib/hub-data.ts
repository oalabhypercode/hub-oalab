import type { HubFileCustomer, HubFolder, HubStoredFile } from "./hub-files/types";
import type { ServicePackageId } from "./service-packages";

export const hubSections = ["projects", "files", "messages", "calendar", "settings", "insights", "discover"] as const;
export type HubSection = "overview" | (typeof hubSections)[number];

export const sectionLabels: Record<HubSection, string> = {
  overview: "Übersicht",
  projects: "Projekte",
  files: "Dateien",
  messages: "Nachrichten",
  calendar: "Kalender",
  settings: "Profil",
  insights: "Insights",
  discover: "Entdecken",
};

/** Fictional reference day of all fixtures; dates in the demo history are relative to it. */
export const DEMO_AS_OF = "2026-10-15";

/** `description` says what the milestone delivers; the projects table shows it for the current milestone. */
export type Milestone = { title: string; description: string; at: string; kind: "milestone" | "feedback" };

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
  /** Fictional fixture value; null for the OALAB admin, who represents no customer. */
  customerNumber: string | null;
  /** Active service packages (fictional fixtures); empty for the OALAB admin. */
  servicePackages: ServicePackageId[];
  role: "oalab_admin" | "oalab_customer";
  projects: Project[];
  files: HubStoredFile[];
};

/** Account shown in the explicitly labelled /preview routes (fictional). */
export const previewAccount = { name: "Jana Sommer", initials: "JS", company: "Nordlicht Studio", customerNumber: "KD-24017", servicePackages: ["website-extra"] as ServicePackageId[], email: "jana@example.com" };

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
      { title: "Kickoff", description: "Ziele, Zielgruppen und Zeitplan gemeinsam festgelegt.", at: "2026-06-03T10:00", kind: "milestone" },
      { title: "Zielbild & Briefing", description: "Inhalte, Funktionen und Tonalität der Website abgestimmt.", at: "2026-07-02T14:00", kind: "milestone" },
      { title: "Designsystem", description: "Farben, Typografie und Komponenten für alle Seiten definiert.", at: "2026-08-26T15:30", kind: "milestone" },
      { title: "Konzept & Struktur", description: "Seitenstruktur und Navigation stehen. Als Nächstes folgen die Seitenentwürfe.", at: "2026-10-13T11:30", kind: "milestone" },
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
      { title: "Kickoff", description: "Markenkern, Werte und Wettbewerb besprochen.", at: "2026-08-19T10:00", kind: "milestone" },
      { title: "Moodboard", description: "Bildwelt und Stilrichtung als Moodboard festgehalten.", at: "2026-09-10T16:00", kind: "milestone" },
      { title: "Erste Designrichtung", description: "Die erste Designrichtung ist fertig und wartet auf dein Feedback.", at: "2026-10-14T09:30", kind: "feedback" },
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
      { title: "Kickoff", description: "Kanäle, Zielgruppen und Tonalität für Social Media festgelegt.", at: "2026-05-06T09:30", kind: "milestone" },
      { title: "Content-Plan", description: "Redaktionsplan für die ersten drei Monate erstellt.", at: "2026-06-15T13:00", kind: "milestone" },
      { title: "Kampagnen-Assets", description: "Vorlagen, Bilder und Texte für den Start produziert.", at: "2026-08-20T11:00", kind: "milestone" },
      { title: "Launch", description: "Der Auftritt ist live. Das Projekt ist abgeschlossen.", at: "2026-10-09T10:00", kind: "milestone" },
    ],
  },
];

/** Byte sizes of the static example files in public/demo-files (generated by scripts/lib/sample-files.mjs). */
const sampleFileSizes: Record<string, { contract: number; logo: number }> = {
  nordlicht: { contract: 1097, logo: 611 },
  formfeld: { contract: 1091, logo: 610 },
  horizont: { contract: 1094, logo: 610 },
};

/** The fictional example files ("Servicevertrag", "Logo-Datei") of one demo customer, downloadable as static samples. */
export function sampleFileFixtures(slug: keyof typeof sampleFileSizes, company: string, customerNumber: string, servicePackage: string): HubStoredFile[] {
  const customers = [{ id: customerNumber, customerNumber, company }];
  return [
    {
      id: `${slug}-servicevertrag`, title: "Servicevertrag", fileName: `Servicevertrag ${company}.pdf`, category: "contract",
      description: `Fiktiver Beispielvertrag zum Servicepaket ${servicePackage}: Laufzeit, Leistungen und Konditionen.`,
      mimeType: "application/pdf", sizeBytes: sampleFileSizes[slug].contract, sha256: null, createdAt: "2026-10-01T10:00", customers,
      folderIds: { [customerNumber]: `${customerNumber}-vertraege` },
      sampleHref: `/demo-files/${slug}/servicevertrag.pdf`,
    },
    {
      id: `${slug}-logo`, title: "Logo-Datei", fileName: `Logo ${company}.svg`, category: "brand",
      description: "Fiktives Beispiel-Logo als Vektordatei (SVG) für Website, Social Media und Druck.",
      mimeType: "image/svg+xml", sizeBytes: sampleFileSizes[slug].logo, sha256: null, createdAt: "2026-10-14T09:30", customers, folderIds: {},
      sampleHref: `/demo-files/${slug}/logo.svg`,
    },
  ];
}

/** Example folders of the demo customers: "Verträge" holds the sample contract, "Briefings" is still empty. */
export function sampleFolders(customers: HubFileCustomer[]): HubFolder[] {
  return customers.flatMap((customer) => [
    { id: `${customer.id}-briefings`, customerId: customer.id, name: "Briefings" },
    { id: `${customer.id}-vertraege`, customerId: customer.id, name: "Verträge" },
  ]);
}

export const previewFiles: HubStoredFile[] = sampleFileFixtures("nordlicht", "Nordlicht Studio", "KD-24017", "Oalab-Website extra");

/** Steps for the customer; projectIndex points into the workspace's project list. */
export const demoNextSteps: NextStep[] = [
  { id: "feedback", title: "Designrichtung ansehen", category: "Brand Identity", date: "Bis 16. Oktober", dueOn: "2026-10-16", projectIndex: 1 },
  { id: "content", title: "Website-Inhalte abstimmen", category: "Website & Digital", date: "Bis 19. Oktober", dueOn: "2026-10-19", projectIndex: 0 },
];

/** The single example conversation shown on the messages page. */
export const demoConversation = { title: "Brand Identity", person: "Lena Schneider", initials: "LS", topic: "Neue Designrichtung", sentAt: "2026-10-14T09:40" };

/** The milestone a project stands at on `asOf`: the latest one reached, or the first one ahead if none is reached yet. */
export function currentMilestone(project: Project, asOf: string): Milestone | undefined {
  return project.milestones.filter((item) => item.at.slice(0, 10) <= asOf).at(-1) ?? project.milestones[0];
}

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
