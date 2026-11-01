import { CalendarDays, FolderOpen, Files, MessageSquare, type LucideIcon } from "lucide-react";
import { adminSectionLabels, type HubSection } from "./hub-data";

export type CategoryId = "projects" | "files" | "messages" | "calendar";

export type Category = {
  id: CategoryId;
  name: string;
  /** Section that acts as the category page. */
  section: Extract<HubSection, CategoryId>;
  icon: LucideIcon;
  /** Icons, bars and filled shapes. */
  fill: string;
  /** Coloured text on glass, a token from glass.css: dark enough for 4.5:1 on 70 % glass, light in the dark theme. */
  text: string;
};

/** One colour per category, reused for icons, card titles and charts. */
export const categories: Record<CategoryId, Category> = {
  projects: { id: "projects", name: "Projekte", section: "projects", icon: FolderOpen, fill: "#FF9500", text: "var(--cat-projects-text)" },
  files: { id: "files", name: "Dateien", section: "files", icon: Files, fill: "#5856D6", text: "var(--cat-files-text)" },
  messages: { id: "messages", name: "Nachrichten", section: "messages", icon: MessageSquare, fill: "#007AFF", text: "var(--cat-messages-text)" },
  calendar: { id: "calendar", name: "Kalender", section: "calendar", icon: CalendarDays, fill: "#FF3B30", text: "var(--cat-calendar-text)" },
};

export const categoryOrder: CategoryId[] = ["projects", "files", "messages", "calendar"];

/** The category's name as this person sees it: admins call the files their "Asset Management". */
export const categoryLabel = (id: CategoryId, admin: boolean) => (admin && adminSectionLabels[categories[id].section]) || categories[id].name;
