import type { Metadata } from "next";
import { AppShell } from "@/components/hub/app-shell";

export const metadata: Metadata = { title: "Designvorschau", robots: { index: false, follow: false } };

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return <AppShell preview>{children}</AppShell>;
}
