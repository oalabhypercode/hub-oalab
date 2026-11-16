import { Suspense } from "react";
import { notFound } from "next/navigation";
import { HubView } from "@/components/hub/hub-view";
import { HubContentLoading } from "@/components/hub/loading";
import { detailSection, hubDetailParams, isHubDetail, todayIso } from "@/lib/hub-routes";
import { getWorkspaceIdentity } from "@/lib/hub-session";
import { loadHubFiles } from "@/lib/hub-files/server";
import { loadLiveProjects } from "@/lib/hub-projects/server";
import { loadTaskBoard } from "@/lib/hub-tasks/server";

export function generateStaticParams() { return hubDetailParams; }

async function WorkspaceDetail({ params }: { params: Promise<{ section: string; detail: string }> }) {
  const { section, detail } = await params;
  if (!isHubDetail(section, detail)) notFound();
  const identity = await getWorkspaceIdentity();
  const tasks = section === "projects" && detail === "tasks";
  // The task board is the oalab team's for now; freelancers follow in their own step, customers keep the project window.
  if (tasks && identity.account?.role !== "oalab_admin") notFound();
  const [filesState, liveProjects, taskBoard] = await Promise.all([loadHubFiles(), loadLiveProjects(), tasks ? loadTaskBoard() : undefined]);
  return <HubView section={detailSection(section)} detail={detail} email={identity.email} role={identity.account?.role ?? null} userKey={identity.userId} asOf={todayIso()} filesState={filesState} liveProjects={liveProjects} taskBoard={taskBoard} />;
}

export default function Page(props: { params: Promise<{ section: string; detail: string }> }) {
  return <Suspense fallback={<HubContentLoading />}><WorkspaceDetail {...props} /></Suspense>;
}
