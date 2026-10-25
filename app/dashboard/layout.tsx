import { Suspense } from "react";
import { AppShell } from "@/components/hub/app-shell";
import { HubLoading } from "@/components/hub/loading";
import { HubLoadBoundary } from "@/components/hub/load-error";
import { getWorkspaceIdentity } from "@/lib/hub-session";
import { getDemoData } from "@/lib/demo-data";
import { countPendingRegistrations } from "@/lib/hub-users/server";

async function AuthenticatedWorkspace({ children }: { children: React.ReactNode }) {
  const identity = await getWorkspaceIdentity();
  const demoData = identity.demoAccess ? getDemoData(identity.demoAccess, identity.name) : undefined;
  // Real admins see how many registrations wait; RLS lets only active admins count them.
  const pendingRegistrations = !identity.publicDemo && identity.account?.role === "oalab_admin" ? await countPendingRegistrations() : 0;
  return <AppShell key={identity.userId} email={identity.email} demoData={demoData} publicDemo={identity.publicDemo} hubAccount={identity.account} pendingRegistrations={pendingRegistrations}>{children}</AppShell>;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <HubLoadBoundary><Suspense fallback={<HubLoading />}><AuthenticatedWorkspace>{children}</AuthenticatedWorkspace></Suspense></HubLoadBoundary>;
}
