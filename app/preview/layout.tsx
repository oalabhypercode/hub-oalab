import type { Metadata } from "next";
import { HubShell } from "@/components/hub/hub-shell";

export const metadata: Metadata = { title: "Designvorschau", robots: { index: false, follow: false } };

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return <HubShell preview>{children}</HubShell>;
}
