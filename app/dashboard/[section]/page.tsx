import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { HubView } from "@/components/hub/hub-view";
import { HubContentLoading } from "@/components/hub/loading";
import { adminSections, hubHref, hubSections } from "@/lib/hub-data";
import { parseHubSection, todayIso } from "@/lib/hub-routes";
import { getWorkspaceIdentity } from "@/lib/hub-session";
import { loadHubFiles } from "@/lib/hub-files/server";
import { loadUserManagement } from "@/lib/hub-users/server";
import { loadLiveProjects, loadProjectDesk } from "@/lib/hub-projects/server";
import { loadAssistantLog } from "@/lib/hub-assistant/log";
import { loadConversationsForIdentity } from "@/lib/hub-conversations/server";
import { loadPrivateChatPage } from "@/lib/hub-private-chat/server";
import { loadContractsForIdentity } from "@/lib/hub-contracts/server";
import { loadKeychain } from "@/lib/hub-keychain/server";
import { loadFreelancerCustomers } from "@/lib/hub-freelancer-customers/server";
import { loadTaskBoard } from "@/lib/hub-tasks/server";

export function generateStaticParams() { return hubSections.map((section) => ({ section })); }

async function WorkspaceSection({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const validSection = parseHubSection(section);
  if (!validSection) notFound();
  // The calendar hangs under Projekte now; the proxy forwards the old address with its query, this is the fallback.
  if (validSection === "calendar") redirect(hubHref(false, "calendar"));
  const identity = await getWorkspaceIdentity();
  // Admin-only sections need an admin session; everyone else gets a plain 404.
  if (adminSections.includes(validSection) && identity.account?.role !== "oalab_admin") notFound();
  // „Vertrag & Domain“ is for admins and customers; freelancers have no entry and get a plain 404 as well.
  if (validSection === "contracts" && identity.account?.role === "oalab_freelancer") notFound();
  // „Kunden“ is the freelancers' (18.11.2026): what oalab released of each customer they look after. Admins find the
  // same customers with every detail under „Vertrag & Domain“; customers get a plain 404.
  if (validSection === "customers" && identity.account?.role === "oalab_admin") redirect(hubHref(false, "contracts"));
  if (validSection === "customers" && identity.account?.role !== "oalab_freelancer") notFound();
  // Freelancers have no projects page: „Projekte“ is the task board of the projects they work on (16.11.2026).
  if (validSection === "projects" && identity.account?.role === "oalab_freelancer") redirect(`${hubHref(false, "projects")}/tasks`);
  const [filesState, userManagement, liveProjects, assistantLog, conversations, privateChats, contracts, keychain, projectDesk, freelancerCustomers, taskBoard] = await Promise.all([
    loadHubFiles(),
    validSection === "users" ? loadUserManagement() : undefined,
    loadLiveProjects(),
    validSection === "ai-log" ? loadAssistantLog() : undefined,
    // The service platform's conversations only for admins, in the tab "Service".
    validSection === "messages" ? loadConversationsForIdentity(identity) : undefined,
    // The private chats; shared with the layout's unread count through the request cache.
    validSection === "messages" ? loadPrivateChatPage() : undefined,
    // Packages and timeline: everything for admins, their own for customers.
    validSection === "contracts" ? loadContractsForIdentity(identity) : undefined,
    // The Schlüsselbund: accesses and categories for admins, of passwords only whether one exists.
    validSection === "keychain" ? loadKeychain() : undefined,
    // Projekte for admins: every customer with domains, packages, quota and open requests (undefined for everyone else).
    validSection === "projects" ? loadProjectDesk() : undefined,
    // „Kunden“ for freelancers: each customer with what oalab released, and the board for their projects there.
    validSection === "customers" ? loadFreelancerCustomers() : undefined,
    validSection === "customers" ? loadTaskBoard() : undefined,
  ]);
  return <HubView section={validSection} email={identity.email} role={identity.account?.role ?? null} userKey={identity.userId} asOf={todayIso()} filesState={filesState} userManagement={userManagement} liveProjects={liveProjects} assistantLog={assistantLog} conversations={conversations} privateChats={privateChats} contracts={contracts} keychain={keychain} projectDesk={projectDesk} freelancerCustomers={freelancerCustomers} taskBoard={taskBoard} />;
}

export default function Page(props: { params: Promise<{ section: string }> }) {
  return <Suspense fallback={<HubContentLoading />}><WorkspaceSection {...props} /></Suspense>;
}
