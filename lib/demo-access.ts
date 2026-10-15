export const demoWorkspaceSlugs = ["nordlicht", "formfeld", "horizont"] as const;
export type DemoWorkspaceSlug = (typeof demoWorkspaceSlugs)[number];
export type DemoAccess =
  | { role: "oalab_admin"; workspace: null }
  | { role: "oalab_customer"; workspace: DemoWorkspaceSlug };

/** Call with verified app_metadata only. user_metadata is never an authority. */
export function parseDemoAccess(appMetadata: unknown): DemoAccess | null {
  if (!appMetadata || typeof appMetadata !== "object") return null;
  const metadata = appMetadata as Record<string, unknown>;
  if (metadata.demo_account !== true) return null;
  if (metadata.app_role === "oalab_admin" && metadata.demo_workspace === "all") {
    return { role: "oalab_admin", workspace: null };
  }
  if (metadata.app_role === "oalab_customer") {
    const workspace = demoWorkspaceSlugs.find((slug) => slug === metadata.demo_workspace);
    if (workspace) return { role: "oalab_customer", workspace };
  }
  return null;
}
