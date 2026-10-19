import { LayoutGrid, Sparkles, type LucideIcon } from "lucide-react";
import { categories, categoryOrder } from "@/lib/categories";
import type { HubSection } from "@/lib/hub-data";

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
