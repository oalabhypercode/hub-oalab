"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { BrandLoader } from "@/components/brand-loader";
import { categories, categoryLabel, categoryOrder } from "@/lib/categories";
import { sectionLabels, type HubSection } from "@/lib/hub-data";
import { formatFullDate } from "@/lib/hub-metrics";
import { todayIso } from "@/lib/hub-routes";
import { AppShell, HeaderActions } from "./app-shell";
import { TitleIcon } from "./glass";
import { LargeTitleHeader } from "./large-title-header";
import { sectionIcons } from "./navigation";
import { CategoryTitle } from "./screens/workspace";
import { useHubShell } from "./shell-context";

const noSubscription = () => () => {};

/** Today's line above the overview title; blank in the prerendered shell, which may not read the clock. */
function useDateLine() {
  return useSyncExternalStore(noSubscription, () => formatFullDate(todayIso()), () => "");
}

/** The section a hub address shows; detail pages (metrics, appearance) bring their own header. */
function useLoadingSection(): HubSection | null {
  const [, segment = "overview", detail] = usePathname().split("/").filter(Boolean);
  return detail === undefined && segment in sectionLabels ? segment as HubSection : null;
}

/** The same large title the page renders once its data is there, so it stands still when the content arrives. */
function SectionTitle({ section }: { section: HubSection }) {
  const { account, pending } = useHubShell();
  const date = useDateLine();
  const category = categoryOrder.find((id) => categories[id].section === section);
  // Before the login is known, a name that differs for admins stays blank instead of switching later.
  const title = !category ? sectionLabels[section]
    : pending && categoryLabel(category, true) !== categoryLabel(category, false) ? " "
    : categoryLabel(category, account.admin);
  const plainIcon = sectionIcons[section];
  const icon = category ? <CategoryTitle category={category} /> : plainIcon ? <TitleIcon icon={plainIcon} /> : undefined;
  const dated = section === "overview" || section === "insights";
  return <LargeTitleHeader title={title} icon={icon} date={dated ? date || " " : undefined} actions={<HeaderActions />} />;
}

/** Page-level fallback inside the shell: the page's title at once, the turning logo for what is still loading. */
export function HubContentLoading() {
  const section = useLoadingSection();
  return (
    <>
      {section && <SectionTitle section={section} />}
      <BrandLoader label="Dein Workspace wird geladen" className={section ? "section-first" : undefined} />
    </>
  );
}

/** Layout-level fallback while the login is checked: the real shell with navigation and page title, only the account blank. */
export function HubLoading() {
  return <AppShell pending><HubContentLoading /></AppShell>;
}
