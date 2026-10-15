import { Suspense } from "react";
import { notFound } from "next/navigation";
import { HubView } from "@/components/hub/hub-view";
import { HubLoading } from "@/components/hub/loading";
import { hubSections } from "@/lib/hub-data";
import { getWorkspaceIdentity } from "@/lib/hub-session";
import { getDemoData } from "@/lib/demo-data";

export function generateStaticParams() { return hubSections.map((section) => ({ section })); }

async function WorkspaceSection({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const validSection = hubSections.find((item) => item === section);
  if (!validSection) notFound();
  const identity = await getWorkspaceIdentity();
  const demoData = identity.demoAccess ? getDemoData(identity.demoAccess, identity.name) : undefined;
  return <HubView section={validSection} email={identity.email} demoData={demoData} />;
}

export default function Page(props: { params: Promise<{ section: string }> }) {
  return <Suspense fallback={<HubLoading />}><WorkspaceSection {...props} /></Suspense>;
}
