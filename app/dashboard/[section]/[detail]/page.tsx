import { Suspense } from "react";
import { notFound } from "next/navigation";
import { HubView } from "@/components/hub/hub-view";
import { HubContentLoading } from "@/components/hub/loading";
import { hubDetailParams, isHubDetail, todayIso } from "@/lib/hub-routes";
import { getWorkspaceIdentity } from "@/lib/hub-session";
import { loadHubFiles } from "@/lib/hub-files/server";
import { loadLiveProjects } from "@/lib/hub-projects/server";

export function generateStaticParams() { return hubDetailParams; }

async function WorkspaceDetail({ params }: { params: Promise<{ section: string; detail: string }> }) {
  const { section, detail } = await params;
  if (!isHubDetail(section, detail)) notFound();
  const identity = await getWorkspaceIdentity();
  const [filesState, liveProjects] = await Promise.all([loadHubFiles(), loadLiveProjects()]);
  return <HubView section={section === "settings" ? "settings" : "overview"} detail={detail} email={identity.email} role={identity.account?.role ?? null} userKey={identity.userId} asOf={todayIso()} filesState={filesState} liveProjects={liveProjects} />;
}

export default function Page(props: { params: Promise<{ section: string; detail: string }> }) {
  return <Suspense fallback={<HubContentLoading />}><WorkspaceDetail {...props} /></Suspense>;
}
