import { Suspense } from "react";
import { HubView } from "@/components/hub/hub-view";
import { HubContentLoading } from "@/components/hub/loading";
import { getWorkspaceIdentity } from "@/lib/hub-session";
import { loadHubFiles } from "@/lib/hub-files/server";
import { loadLiveProjects } from "@/lib/hub-projects/server";
import { todayIso } from "@/lib/hub-routes";

async function WorkspaceOverview() {
  const identity = await getWorkspaceIdentity();
  const [filesState, liveProjects] = await Promise.all([loadHubFiles(), loadLiveProjects()]);
  return <HubView role={identity.account?.role ?? null} userKey={identity.userId} asOf={todayIso()} filesState={filesState} liveProjects={liveProjects} />;
}

export default function DashboardPage() {
  return <Suspense fallback={<HubContentLoading />}><WorkspaceOverview /></Suspense>;
}
