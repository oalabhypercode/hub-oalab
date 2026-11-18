import { Suspense } from "react";
import { HubView } from "@/components/hub/hub-view";
import { HubContentLoading } from "@/components/hub/loading";
import { getWorkspaceIdentity } from "@/lib/hub-session";
import { loadHubFiles } from "@/lib/hub-files/server";
import { loadLiveProjects } from "@/lib/hub-projects/server";
import { loadOverviewFacts, loadOverviewWidgets } from "@/lib/hub-overview/server";
import { loadTaskBoard } from "@/lib/hub-tasks/server";
import { todayIso } from "@/lib/hub-routes";

async function WorkspaceOverview() {
  const identity = await getWorkspaceIdentity();
  // The admins' welcome card counts customers and Service packages; the widgets need this week's appointments and the
  // quota (18.11.2026); freelancers' widgets read their board. The notices come with the shell.
  const role = identity.account?.role ?? null;
  const [filesState, liveProjects, overviewFacts, overviewWidgets, taskBoard] = await Promise.all([loadHubFiles(), loadLiveProjects(), loadOverviewFacts(role), loadOverviewWidgets(role), role === "oalab_freelancer" ? loadTaskBoard() : undefined]);
  return <HubView role={role} userKey={identity.userId} asOf={todayIso()} filesState={filesState} liveProjects={liveProjects} overviewFacts={overviewFacts} overviewWidgets={overviewWidgets} taskBoard={taskBoard} />;
}

export default function DashboardPage() {
  return <Suspense fallback={<HubContentLoading />}><WorkspaceOverview /></Suspense>;
}
