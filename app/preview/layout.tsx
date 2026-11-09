import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/hub/app-shell";

export const metadata: Metadata = { title: "Designvorschau", robots: { index: false, follow: false } };

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  // Since 9.11.2026 the example pages exist only on a local dev server; live they are a plain 404.
  if (process.env.NODE_ENV !== "development") notFound();
  return <AppShell preview>{children}</AppShell>;
}
