import { Bot, Ellipsis, LayoutGrid, MessageCircleMore, ScrollText, Sparkles, UserCog, UserRound, type LucideIcon } from "lucide-react";
import { categories } from "@/lib/categories";
import type { HubSection } from "@/lib/hub-data";
import { SERVICE_PLATFORM_URL } from "@/lib/service-packages";

/** The symbol in the title of every page without a category colour; the same symbols as in the sidebar. */
export const sectionIcons: Partial<Record<HubSection, LucideIcon>> = {
  overview: LayoutGrid,
  insights: Sparkles,
  discover: Ellipsis,
  settings: UserRound,
  users: UserCog,
  "ai-log": Bot,
  "patch-notes": ScrollText,
};

export type NavigationItem = { section: HubSection; label: string; icon: LucideIcon };

export const mainNavigation: NavigationItem[] = [
  { section: "overview", label: "Übersicht", icon: LayoutGrid },
  { section: "insights", label: "Insights", icon: Sparkles },
];

/**
 * The tab bar below 1024 px: the four daily destinations and "Mehr" for everything else (Insights, Chat,
 * Nachrichten, Profil, Patch Notes, Verwaltung), like OALab Studio.
 */
export const tabNavigation: NavigationItem[] = [
  mainNavigation[0],
  ...(["projects", "files", "calendar"] as const).map((id) => ({ section: categories[id].section, label: categories[id].name, icon: categories[id].icon })),
  { section: "discover", label: "Mehr", icon: Ellipsis },
];

/** The chat lives on the service platform; the sidebar and "Mehr" open it in a new tab next to the hub. */
export const chatNavigation = { href: SERVICE_PLATFORM_URL, label: "Chat", icon: MessageCircleMore };

export const newTabLinkProps = { target: "_blank", rel: "noopener noreferrer" } as const;
