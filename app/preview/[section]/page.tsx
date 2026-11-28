import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { HubView } from "@/components/hub/hub-view";
import { HubContentLoading } from "@/components/hub/loading";
import { DEMO_AS_OF, hubHref, hubSections } from "@/lib/hub-data";
import { parseHubSection } from "@/lib/hub-routes";

export function generateStaticParams() { return hubSections.map((section) => ({ section })); }

async function PreviewSection({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const validSection = parseHubSection(section);
  if (!validSection) notFound();
  // The calendar hangs under Projekte (/preview/projects/calendar).
  if (validSection === "calendar") redirect(hubHref(true, "calendar"));
  return <HubView section={validSection} preview userKey="preview" asOf={DEMO_AS_OF} />;
}

export default function Page(props: { params: Promise<{ section: string }> }) {
  return <Suspense fallback={<HubContentLoading />}><PreviewSection {...props} /></Suspense>;
}
