import { Suspense } from "react";
import { HubShell } from "@/components/hub/hub-shell";
import { HubLoading } from "@/components/hub/loading";
import { getWorkspaceIdentity } from "@/lib/hub-session";
import { getDemoData } from "@/lib/demo-data";

async function AuthenticatedWorkspace({ children }: { children: React.ReactNode }) {
  const identity = await getWorkspaceIdentity();
  const demoData = identity.demoAccess ? getDemoData(identity.demoAccess, identity.name) : undefined;
  return <HubShell key={identity.userId} email={identity.email} demoData={demoData} publicDemo={identity.publicDemo}>{children}</HubShell>;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<HubLoading />}><AuthenticatedWorkspace>{children}</AuthenticatedWorkspace></Suspense>;
}
