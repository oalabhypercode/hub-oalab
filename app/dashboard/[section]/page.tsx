import { Suspense } from "react";
import { notFound } from "next/navigation";
import { HubView } from "@/components/hub/hub-view";
import { HubContentLoading } from "@/components/hub/loading";
import { adminSections, DEMO_AS_OF, hubSections } from "@/lib/hub-data";
import { parseHubSection, todayIso } from "@/lib/hub-routes";
import { getWorkspaceIdentity } from "@/lib/hub-session";
import { getDemoData } from "@/lib/demo-data";
import { loadFilesForIdentity } from "@/lib/hub-files/server";
import { loadCalendarForIdentity } from "@/lib/hub-calendar/server";
import { loadUserManagement } from "@/lib/hub-users/server";

export function generateStaticParams() { return hubSections.map((section) => ({ section })); }

async function WorkspaceSection({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const validSection = parseHubSection(section);
  if (!validSection) notFound();
  const identity = await getWorkspaceIdentity();
  // Admin-only sections need a real admin session; everyone else gets a plain 404.
  if (adminSections.includes(validSection) && (identity.publicDemo || identity.account?.role !== "oalab_admin")) notFound();
  const demoData = identity.demoAccess ? getDemoData(identity.demoAccess, identity.name) : undefined;
  const [filesState, calendarState, userManagement] = await Promise.all([
    loadFilesForIdentity(identity),
    // Real appointments always run on today's date, also for the demo logins with fixture projects.
    validSection === "calendar" ? loadCalendarForIdentity(identity, todayIso()) : undefined,
    validSection === "users" ? loadUserManagement() : undefined,
  ]);
  return <HubView section={validSection} email={identity.email} demoData={demoData} publicDemo={identity.publicDemo} role={identity.account?.role ?? null} userKey={identity.userId} asOf={demoData ? DEMO_AS_OF : todayIso()} filesState={filesState} calendarState={calendarState} userManagement={userManagement} />;
}

export default function Page(props: { params: Promise<{ section: string }> }) {
  return <Suspense fallback={<HubContentLoading />}><WorkspaceSection {...props} /></Suspense>;
}
