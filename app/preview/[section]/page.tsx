import { Suspense } from "react";
import { notFound } from "next/navigation";
import { HubView } from "@/components/hub/hub-view";
import { HubLoading } from "@/components/hub/loading";
import { hubSections } from "@/lib/hub-data";

export function generateStaticParams() { return hubSections.map((section) => ({ section })); }

async function PreviewSection({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const validSection = hubSections.find((item) => item === section);
  if (!validSection) notFound();
  return <HubView section={validSection} preview />;
}

export default function Page(props: { params: Promise<{ section: string }> }) {
  return <Suspense fallback={<HubLoading />}><PreviewSection {...props} /></Suspense>;
}
