import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";
import { DemoLoginPanel } from "@/components/demo-login-panel";

export const metadata: Metadata = { title: "Anmelden" };

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <>
      {/* Fetched while the form is filled in: the small logo on the button and the greeting the hub opens with. */}
      <link rel="prefetch" href="/brand/oalab-loader-mini-white.webp" as="image" />
      <link rel="prefetch" href="/brand/oalab-greeting.webp" as="image" />
      <LoginForm><Suspense fallback={null}><DemoLoginPanel searchParams={searchParams} /></Suspense></LoginForm>
    </>
  );
}
