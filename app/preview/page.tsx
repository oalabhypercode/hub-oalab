import { Suspense } from "react";
import { HubView } from "@/components/hub/hub-view";
import { HubContentLoading } from "@/components/hub/loading";
import { DEMO_AS_OF } from "@/lib/hub-data";

export default function PreviewPage() {
  return <Suspense fallback={<HubContentLoading />}><HubView preview userKey="preview" asOf={DEMO_AS_OF} /></Suspense>;
}
