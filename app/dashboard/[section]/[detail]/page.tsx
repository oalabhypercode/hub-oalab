import { Suspense } from "react";
import { notFound } from "next/navigation";
import { HubView } from "@/components/hub/hub-view";
import { HubContentLoading } from "@/components/hub/loading";
import { DEMO_AS_OF } from "@/lib/hub-data";
import { hubDetailParams, isHubDetail, todayIso } from "@/lib/hub-routes";
import { getWorkspaceIdentity } from "@/lib/hub-session";
import { getDemoData } from "@/lib/demo-data";
import { loadFilesForIdentity } from "@/lib/hub-files/server";

export function generateStaticParams() { return hubDetailParams; }

async function WorkspaceDetail({ params }: { params: Promise<{ section: string; detail: string }> }) {
  const { section, detail } = await params;
  if (!isHubDetail(section, detail)) notFound();
  const identity = await getWorkspaceIdentity();
  const demoData = identity.demoAccess ? getDemoData(identity.demoAccess, identity.name) : undefined;
  const filesState = await loadFilesForIdentity(identity);
  return <HubView section={section === "settings" ? "settings" : "overview"} detail={detail} email={identity.email} demoData={demoData} publicDemo={identity.publicDemo} role={identity.account?.role ?? null} userKey={identity.userId} asOf={demoData ? DEMO_AS_OF : todayIso()} filesState={filesState} />;
}

export default function Page(props: { params: Promise<{ section: string; detail: string }> }) {
  return <Suspense fallback={<HubContentLoading />}><WorkspaceDetail {...props} /></Suspense>;
}
