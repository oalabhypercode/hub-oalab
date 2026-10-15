import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";
import { DemoLoginPanel } from "@/components/demo-login-panel";

export const metadata: Metadata = { title: "Anmelden" };

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <LoginForm><Suspense fallback={null}><DemoLoginPanel searchParams={searchParams} /></Suspense></LoginForm>;
}
