import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceIdentity } from "@/lib/hub-session";
import { confirmSessionHref } from "@/lib/auth-redirect";
import { CONSENT_PATH, scopeLabels } from "./config";
import { connectorReady, readPendingRequest } from "./store";

/**
 * What the consent page shows: the switch is off, the request is gone, the login is no admin, the session still has to
 * confirm its code (aal2, as for the hub's other admin writes), or the question itself. Signing in comes first: the
 * proxy sends a visitor without session to the login and back here.
 */
export type ConsentState =
  | { kind: "off" }
  | { kind: "expired" }
  | { kind: "not-admin"; request: string }
  | { kind: "confirm" | "ready"; request: string; clientName: string; email: string; scopes: string[]; confirmHref: string };

export async function loadConsent(request: string): Promise<ConsentState> {
  if (!connectorReady()) return { kind: "off" };
  const identity = await getWorkspaceIdentity();
  const pending = await readPendingRequest(request).catch(() => null);
  if (!pending) return { kind: "expired" };
  if (identity.account?.role !== "oalab_admin") return { kind: "not-admin", request };
  const { data } = await (await createClient()).auth.getClaims();
  return {
    kind: data?.claims?.aal === "aal2" ? "ready" : "confirm",
    request,
    clientName: pending.clientName,
    email: identity.email,
    scopes: pending.scopes.map((scope) => scopeLabels[scope]),
    confirmHref: confirmSessionHref(`${CONSENT_PATH}?request=${request}`),
  };
}
