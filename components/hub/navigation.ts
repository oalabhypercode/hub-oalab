import { Bot, LayoutGrid, MessageCircleMore, ScrollText, Search, Sparkles, UserCog, UserRound, type LucideIcon } from "lucide-react";
import { categories, categoryOrder } from "@/lib/categories";
import type { HubSection } from "@/lib/hub-data";
import { SERVICE_PLATFORM_URL } from "@/lib/service-packages";

/** The symbol in the title of every page without a category colour; the same symbols as in the sidebar. */
export const sectionIcons: Partial<Record<HubSection, LucideIcon>> = {
  overview: LayoutGrid,
  insights: Sparkles,
  discover: Search,
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

/** Every destination of the sidebar; the tab bar shows the same entries below 1024 px. */
export const hubNavigation: NavigationItem[] = [
  ...mainNavigation,
  ...categoryOrder.map((id) => ({ section: categories[id].section, label: categories[id].name, icon: categories[id].icon })),
];

/** The chat lives on the service platform; sidebar and tab bar open it in a new tab next to the hub. */
export const chatNavigation = { href: SERVICE_PLATFORM_URL, label: "Chat", icon: MessageCircleMore };

export const newTabLinkProps = { target: "_blank", rel: "noopener noreferrer" } as const;
