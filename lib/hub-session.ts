import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { hasEnvVars } from "@/lib/utils";
import { parseDemoAccess } from "@/lib/demo-access";
import { getPublicDemoIdentity } from "@/lib/public-demo-session";
import { PUBLIC_DEMO_COOKIE } from "@/lib/public-demo-policy";
import { getHubAccount } from "@/lib/hub-users/server";
import { secondFactorMissing } from "@/lib/hub-auth/second-factor";

// Request-scoped memoization; identity is never cached across users.
export const getWorkspaceIdentity = cache(async () => {
  // Auth SDK expiry checks must run for a real request, not during prerendering.
  await connection();
  const demoIdentity = getPublicDemoIdentity((await cookies()).get(PUBLIC_DEMO_COOKIE)?.value, await headers());
  if (demoIdentity) return { ...demoIdentity, account: null };
  if (!hasEnvVars) redirect("/auth/login");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) redirect("/auth/login");
  // Only logins with an active profile enter the hub; waiting, rejected and deactivated ones see why on
  // /auth/pending. "unknown" means the user management migration is not applied yet. A login with an
  // e-mail code enters only after confirming it (the proxy normally sends it there before).
  const [account, codeMissing] = await Promise.all([getHubAccount(), secondFactorMissing(supabase, data.claims.aal)]);
  if (codeMissing) redirect("/auth/mfa");
  if (!account || (account.status !== "active" && account.status !== "unknown")) redirect("/auth/pending");
  const metadata = data.claims.user_metadata as Record<string, unknown> | undefined;
  const profileName = `${account.firstName} ${account.lastName}`.trim();
  return {
    userId: data.claims.sub,
    email: typeof data.claims.email === "string" ? data.claims.email : "",
    name: profileName || (typeof metadata?.full_name === "string" ? metadata.full_name : ""),
    demoAccess: parseDemoAccess(data.claims.app_metadata),
    publicDemo: false as const,
    account,
  };
});
