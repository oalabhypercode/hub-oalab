import { Suspense } from "react";
import { AppShell } from "@/components/hub/app-shell";
import { HubGreeting } from "@/components/hub/hub-greeting";
import { HubLoading } from "@/components/hub/loading";
import { HubLoadBoundary } from "@/components/hub/load-error";
import { getWorkspaceIdentity } from "@/lib/hub-session";
import { countPendingRegistrations } from "@/lib/hub-users/server";
import { loadLiveProjects } from "@/lib/hub-projects/server";
import { loadInbox } from "@/lib/hub-notify/server";
import { countUnreadPrivateChats } from "@/lib/hub-private-chat/server";
import { countHubFiles } from "@/lib/hub-files/server";
import { loadAccountLogo } from "@/lib/hub-logos/server";

async function AuthenticatedWorkspace({ children }: { children: React.ReactNode }) {
  const identity = await getWorkspaceIdentity();
  // Admins see how many registrations wait; RLS lets only active admins count them.
  const [pendingRegistrations, liveProjects, inbox, unreadConversations, fileCount, accountLogo] = await Promise.all([
    identity.account?.role === "oalab_admin" ? countPendingRegistrations() : 0,
    // Shared with the page through the request cache; feeds the sidebar count and the search.
    loadLiveProjects(),
    // The bell.
    loadInbox(),
    // Unread private chats for the counts in the sidebar and the tab bar (customers: from oalab, admins: from customers);
    // shared with the Nachrichten page.
    countUnreadPrivateChats(),
    // The sidebar count of Asset Management / Dateien.
    countHubFiles(),
    // A customer login sees its company's logo instead of the initials; admins get null.
    loadAccountLogo(identity),
  ]);
  return <AppShell key={identity.userId} userId={identity.userId} email={identity.email} hubAccount={identity.account} pendingRegistrations={pendingRegistrations} liveProjects={liveProjects?.projects} inbox={inbox} unreadConversations={unreadConversations} fileCount={fileCount} accountLogo={accountLogo}>{children}</AppShell>;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  // The greeting after sign-in sits outside the load boundary, so it also gives way to a load error.
  return <><HubGreeting /><HubLoadBoundary><Suspense fallback={<HubLoading />}><AuthenticatedWorkspace>{children}</AuthenticatedWorkspace></Suspense></HubLoadBoundary></>;
}
