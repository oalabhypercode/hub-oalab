import { FolderOpen, Files, MessageSquare, type LucideIcon } from "lucide-react";
import type { HubSection } from "./hub-data";

export type CategoryId = "projects" | "files" | "messages";

export type Category = {
  id: CategoryId;
  name: string;
  /** Section that acts as the category page. */
  section: Extract<HubSection, CategoryId>;
  icon: LucideIcon;
  /** Icons, bars and filled shapes. */
  fill: string;
  /** Coloured text on glass; darkened so it keeps 4.5:1 on 70 % glass over any background. */
  text: string;
};

/** One colour per category, reused for icons, card titles and charts. */
export const categories: Record<CategoryId, Category> = {
  projects: { id: "projects", name: "Projekte", section: "projects", icon: FolderOpen, fill: "#FF9500", text: "#7F2100" },
  files: { id: "files", name: "Dateien", section: "files", icon: Files, fill: "#5856D6", text: "#3533A1" },
  messages: { id: "messages", name: "Nachrichten", section: "messages", icon: MessageSquare, fill: "#007AFF", text: "#004285" },
};

export const categoryOrder: CategoryId[] = ["projects", "files", "messages"];
