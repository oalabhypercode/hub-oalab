import { Suspense } from "react";
import { notFound } from "next/navigation";
import { HubView } from "@/components/hub/hub-view";
import { HubContentLoading } from "@/components/hub/loading";
import { adminSections, hubSections } from "@/lib/hub-data";
import { parseHubSection, todayIso } from "@/lib/hub-routes";
import { getWorkspaceIdentity } from "@/lib/hub-session";
import { loadHubFiles } from "@/lib/hub-files/server";
import { loadHubCalendar } from "@/lib/hub-calendar/server";
import { loadUserManagement } from "@/lib/hub-users/server";
import { loadLiveProjects } from "@/lib/hub-projects/server";
import { loadAssistantLog } from "@/lib/hub-assistant/log";
import { loadConversationsForIdentity } from "@/lib/hub-conversations/server";
import { loadPrivateChatPage } from "@/lib/hub-private-chat/server";
import { loadContractsForIdentity } from "@/lib/hub-contracts/server";
import { loadKeychain } from "@/lib/hub-keychain/server";

export function generateStaticParams() { return hubSections.map((section) => ({ section })); }

async function WorkspaceSection({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const validSection = parseHubSection(section);
  if (!validSection) notFound();
  const identity = await getWorkspaceIdentity();
  // Admin-only sections need an admin session; everyone else gets a plain 404.
  if (adminSections.includes(validSection) && identity.account?.role !== "oalab_admin") notFound();
  // „Vertrag & Domain“ is for admins and customers; freelancers have no entry and get a plain 404 as well.
  if (validSection === "contracts" && identity.account?.role === "oalab_freelancer") notFound();
  const [filesState, calendarState, userManagement, liveProjects, assistantLog, conversations, privateChats, contracts, keychain] = await Promise.all([
    loadHubFiles(),
    validSection === "calendar" ? loadHubCalendar(todayIso()) : undefined,
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
  ]);
  return <HubView section={validSection} email={identity.email} role={identity.account?.role ?? null} userKey={identity.userId} asOf={todayIso()} filesState={filesState} calendarState={calendarState} userManagement={userManagement} liveProjects={liveProjects} assistantLog={assistantLog} conversations={conversations} privateChats={privateChats} contracts={contracts} keychain={keychain} />;
}

export default function Page(props: { params: Promise<{ section: string }> }) {
  return <Suspense fallback={<HubContentLoading />}><WorkspaceSection {...props} /></Suspense>;
}
