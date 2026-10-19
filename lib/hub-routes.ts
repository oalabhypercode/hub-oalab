import { hubSections, type HubSection } from "./hub-data";
import { metricOrder } from "./hub-metrics";

/** Second-level hub routes: metric detail pages and the appearance settings. */
export const hubDetailParams = [
  ...metricOrder.map((detail) => ({ section: "metrics", detail })),
  { section: "settings", detail: "appearance" },
];

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
