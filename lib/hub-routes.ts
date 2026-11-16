import { hubSections, type HubSection } from "./hub-data";
import { metricOrder } from "./hub-metrics";

/** Second-level hub routes: metric detail pages, the appearance settings, and the task board and calendar under Projekte. */
export const hubDetailParams = [
  ...metricOrder.map((detail) => ({ section: "metrics", detail })),
  { section: "settings", detail: "appearance" },
  { section: "projects", detail: "tasks" },
  { section: "projects", detail: "calendar" },
];

/**
 * The section a detail page belongs to, for the navigation and the page itself. The calendar under Projekte stays its
 * own section ("calendar"): the tab bar and the sidebar mark it, and the page shows the calendar.
 */
export function detailSection(section: string, detail?: string): HubSection {
  if (section === "projects" && detail === "calendar") return "calendar";
  return section === "settings" ? "settings" : section === "projects" ? "projects" : "overview";
}

/** The section of a hub address (/dashboard/…, /preview/…), for the shell's navigation. */
export function pathSection(pathname: string): HubSection {
  const [, , segment, detail] = pathname.split("/");
  if (segment === "projects" && detail === "calendar") return "calendar";
  return parseHubSection(segment ?? "") ?? "overview";
}

export function parseHubSection(section: string): HubSection | undefined {
  return hubSections.find((item) => item === section);
}

export function isHubDetail(section: string, detail: string) {
  return hubDetailParams.some((item) => item.section === section && item.detail === detail);
}

/** Today's date in the hub's time zone, for workspaces without fixture data. */
export function todayIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
}
