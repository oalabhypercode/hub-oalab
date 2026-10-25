"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { UserCog } from "lucide-react";
import { categories, categoryLabel, categoryOrder } from "@/lib/categories";
import { sectionLabels, type HubSection } from "@/lib/hub-data";
import { formatFullDate } from "@/lib/hub-metrics";
import { todayIso } from "@/lib/hub-routes";
import { AppShell, HeaderActions } from "./app-shell";
import { SkeletonCards } from "./glass";
import { LargeTitleHeader } from "./large-title-header";
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
  const icon = section === "users" ? <span className="title-icon"><UserCog size={24} color="var(--accent-text)" aria-hidden="true" /></span>
    : category ? <CategoryTitle category={category} /> : undefined;
  const dated = section === "overview" || section === "insights";
  return <LargeTitleHeader title={title} icon={icon} date={dated ? date || " " : undefined} actions={section === "discover" ? undefined : <HeaderActions />} />;
}

/** Page-level fallback inside the shell: the page's title at once, skeleton glass cards for what is still loading. */
export function HubContentLoading() {
  const section = useLoadingSection();
  return (
    <>
      {section && <SectionTitle section={section} />}
      <div role="status" aria-label="Dein Workspace wird geladen" className={section ? "section-first" : undefined}>
        {!section && <div className="skeleton-title" aria-hidden="true"><span className="skeleton-bar" /><span className="skeleton-bar" /></div>}
        <SkeletonCards count={4} />
      </div>
    </>
  );
}

/** Layout-level fallback while the login is checked: the real shell with navigation and page title, only the account blank. */
export function HubLoading() {
  return <AppShell pending><HubContentLoading /></AppShell>;
}
