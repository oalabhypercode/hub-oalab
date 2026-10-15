import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasEnvVars } from "@/lib/utils";
import { parseDemoAccess } from "@/lib/demo-access";

// Request-scoped memoization; identity is never cached across users.
export const getWorkspaceIdentity = cache(async () => {
  // Auth SDK expiry checks must run for a real request, not during prerendering.
  await connection();
  if (!hasEnvVars) redirect("/auth/login");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) redirect("/auth/login");
  const metadata = data.claims.user_metadata as Record<string, unknown> | undefined;
  return {
    userId: data.claims.sub,
    email: typeof data.claims.email === "string" ? data.claims.email : "",
    name: typeof metadata?.full_name === "string" ? metadata.full_name : "",
    demoAccess: parseDemoAccess(data.claims.app_metadata),
  };
});
