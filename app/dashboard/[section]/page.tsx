import { Suspense } from "react";
import { notFound } from "next/navigation";
import { HubView } from "@/components/hub/hub-view";
import { HubContentLoading } from "@/components/hub/loading";
import { DEMO_AS_OF, hubSections } from "@/lib/hub-data";
import { parseHubSection, todayIso } from "@/lib/hub-routes";
import { getWorkspaceIdentity } from "@/lib/hub-session";
import { getDemoData } from "@/lib/demo-data";

export function generateStaticParams() { return hubSections.map((section) => ({ section })); }

async function WorkspaceSection({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const validSection = parseHubSection(section);
  if (!validSection) notFound();
  const identity = await getWorkspaceIdentity();
  const demoData = identity.demoAccess ? getDemoData(identity.demoAccess, identity.name) : undefined;
  return <HubView section={validSection} email={identity.email} demoData={demoData} publicDemo={identity.publicDemo} userKey={identity.userId} asOf={demoData ? DEMO_AS_OF : todayIso()} />;
}

export default function Page(props: { params: Promise<{ section: string }> }) {
  return <Suspense fallback={<HubContentLoading />}><WorkspaceSection {...props} /></Suspense>;
}
