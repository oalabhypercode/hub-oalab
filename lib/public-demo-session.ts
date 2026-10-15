import "server-only";
import blueprint from "@/config/demo-accounts.json";
import { parseDemoAccess } from "@/lib/demo-access";
import { configuredPublicDemoOrigin, isPublicDemoHost, parsePublicDemoToken, type PublicDemoSettings } from "@/lib/public-demo-policy";

export function publicDemoSettings(): PublicDemoSettings {
  return { enabled: process.env.ENABLE_PUBLIC_DEMO_LOGIN, origin: process.env.PUBLIC_DEMO_ORIGIN, secret: process.env.OALAB_DEMO_SESSION_SECRET };
}

export function publicDemoConfigured(): boolean {
  return configuredPublicDemoOrigin(publicDemoSettings()) !== null;
}

export function publicDemoOptions() {
  return blueprint.accounts.map((account) => ({ ...account, id: account.workspace ?? "admin" }));
}

/** Fixture identity only: this is NOT a Supabase JWT or authority for real data. */
export function getPublicDemoIdentity(token: string | undefined, headers: Pick<Headers, "get">) {
  const settings = publicDemoSettings();
  if (!isPublicDemoHost(headers, settings)) return null;
  const id = parsePublicDemoToken(token, settings.secret!);
  if (!id) return null;
  const account = publicDemoOptions().find((item) => item.id === id);
  if (!account) return null;
  const demoAccess = parseDemoAccess({ demo_account: true, app_role: account.role, demo_workspace: account.workspace ?? "all" });
  if (!demoAccess) return null;
  return { userId: `public-demo:${id}`, email: account.email, name: account.name, demoAccess, publicDemo: true as const };
}
