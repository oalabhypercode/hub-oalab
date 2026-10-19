import { Suspense } from "react";
import { notFound } from "next/navigation";
import { HubView } from "@/components/hub/hub-view";
import { HubContentLoading } from "@/components/hub/loading";
import { DEMO_AS_OF } from "@/lib/hub-data";
import { hubDetailParams, isHubDetail } from "@/lib/hub-routes";

export function generateStaticParams() { return hubDetailParams; }

async function PreviewDetail({ params }: { params: Promise<{ section: string; detail: string }> }) {
  const { section, detail } = await params;
  if (!isHubDetail(section, detail)) notFound();
  return <HubView section={section === "settings" ? "settings" : "overview"} detail={detail} preview userKey="preview" asOf={DEMO_AS_OF} />;
}

export default function Page(props: { params: Promise<{ section: string; detail: string }> }) {
  return <Suspense fallback={<HubContentLoading />}><PreviewDetail {...props} /></Suspense>;
}
