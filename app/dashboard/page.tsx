import { Suspense } from "react";
import { HubView } from "@/components/hub/hub-view";
import { HubContentLoading } from "@/components/hub/loading";
import { getWorkspaceIdentity } from "@/lib/hub-session";
import { getDemoData } from "@/lib/demo-data";
import { loadFilesForIdentity } from "@/lib/hub-files/server";
import { DEMO_AS_OF } from "@/lib/hub-data";
import { todayIso } from "@/lib/hub-routes";

async function WorkspaceOverview() {
  const identity = await getWorkspaceIdentity();
  const demoData = identity.demoAccess ? getDemoData(identity.demoAccess, identity.name) : undefined;
  const filesState = await loadFilesForIdentity(identity);
  return <HubView demoData={demoData} publicDemo={identity.publicDemo} userKey={identity.userId} asOf={demoData ? DEMO_AS_OF : todayIso()} filesState={filesState} />;
}

export default function DashboardPage() {
  return <Suspense fallback={<HubContentLoading />}><WorkspaceOverview /></Suspense>;
}
