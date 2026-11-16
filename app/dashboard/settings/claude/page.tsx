import { Suspense } from "react";
import { HubContentLoading } from "@/components/hub/loading";
import { ClaudeConsent } from "@/components/hub/claude-consent";
import { loadConsent } from "@/lib/hub-mcp/consent";

// Consent page of the Claude connector: the sign-in for Claude (app/api/mcp/oauth/authorize) sends the admin here.
// Under /dashboard, so a visitor without session signs in first and comes back with the request (proxy `next`).

async function Consent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { request } = await searchParams;
  return <ClaudeConsent state={await loadConsent(typeof request === "string" ? request : "")} />;
}

export default function Page(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Suspense fallback={<HubContentLoading />}><Consent {...props} /></Suspense>;
}
