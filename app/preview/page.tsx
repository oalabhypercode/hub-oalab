import { Suspense } from "react";
import { HubView } from "@/components/hub/hub-view";
import { HubLoading } from "@/components/hub/loading";

export default function PreviewPage() {
  return <Suspense fallback={<HubLoading />}><HubView preview /></Suspense>;
}
