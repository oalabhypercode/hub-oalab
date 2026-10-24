import { LayoutGrid, MessageCircleMore, Sparkles, type LucideIcon } from "lucide-react";
import { categories, categoryOrder } from "@/lib/categories";
import type { HubSection } from "@/lib/hub-data";
import { SERVICE_PLATFORM_URL } from "@/lib/service-packages";

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
