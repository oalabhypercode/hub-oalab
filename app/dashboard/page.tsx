import { Suspense } from "react";
import { HubView } from "@/components/hub/hub-view";
import { HubLoading } from "@/components/hub/loading";
import { getWorkspaceIdentity } from "@/lib/hub-session";
import { getDemoData } from "@/lib/demo-data";

async function WorkspaceOverview() {
  const identity = await getWorkspaceIdentity();
  const demoData = identity.demoAccess ? getDemoData(identity.demoAccess, identity.name) : undefined;
  return <HubView demoData={demoData} publicDemo={identity.publicDemo} />;
}

export default function DashboardPage() {
  return <Suspense fallback={<HubLoading />}><WorkspaceOverview /></Suspense>;
}
