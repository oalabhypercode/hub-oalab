import { Suspense } from "react";
import { HubView } from "@/components/hub/hub-view";
import { HubContentLoading } from "@/components/hub/loading";
import { getWorkspaceIdentity } from "@/lib/hub-session";
import { loadHubFiles } from "@/lib/hub-files/server";
import { loadLiveProjects } from "@/lib/hub-projects/server";
import { loadOverviewFacts } from "@/lib/hub-overview/server";
import { todayIso } from "@/lib/hub-routes";

async function WorkspaceOverview() {
  const identity = await getWorkspaceIdentity();
  // The admins' welcome card counts customers and Service packages (18.11.2026); the notices come with the shell.
  const [filesState, liveProjects, overviewFacts] = await Promise.all([loadHubFiles(), loadLiveProjects(), loadOverviewFacts(identity.account?.role ?? null)]);
  return <HubView role={identity.account?.role ?? null} userKey={identity.userId} asOf={todayIso()} filesState={filesState} liveProjects={liveProjects} overviewFacts={overviewFacts} />;
}

export default function DashboardPage() {
  return <Suspense fallback={<HubContentLoading />}><WorkspaceOverview /></Suspense>;
}
