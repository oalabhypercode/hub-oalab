import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceIdentity } from "@/lib/hub-session";
import { confirmSessionHref } from "@/lib/auth-redirect";
import { CONSENT_PATH, FREELANCER_CONNECTION_DAYS, freelancerScopeLabels, scopeLabels, scopesFor, type ConnectorRole } from "./config";
import { connectorReady, connectorRoleOf, readPendingRequest } from "./store";

/**
 * What the consent page shows: the switch is off, the request is gone, the login may not connect Claude (customers),
 * a freelancer whose login no admin switched on for Claude, the session still has to confirm its code (aal2, as for
 * the hub's other writes), or the question itself with the rights this login's role gets. Signing in comes first: the
 * proxy sends a visitor without session to the login and back here.
 */
export type ConsentState =
  | { kind: "off" }
  | { kind: "expired" }
  | { kind: "not-admin"; request: string }
  | { kind: "not-allowed"; request: string }
  | { kind: "confirm" | "ready"; request: string; role: ConnectorRole; clientName: string; email: string; scopes: string[]; writes: boolean; days: number | null; confirmHref: string };

export async function loadConsent(request: string): Promise<ConsentState> {
  if (!connectorReady()) return { kind: "off" };
  const identity = await getWorkspaceIdentity();
  const pending = await readPendingRequest(request).catch(() => null);
  if (!pending) return { kind: "expired" };
  const role = identity.account?.role === "oalab_admin" ? "admin" : identity.account?.role === "oalab_freelancer" ? await connectorRoleOf(identity.userId).catch(() => null) : null;
  if (role === "off") return { kind: "not-allowed", request };
  if (role !== "admin" && role !== "freelancer") return { kind: "not-admin", request };
  const scopes = scopesFor(role, pending.scopes);
  const labels = role === "admin" ? scopeLabels : freelancerScopeLabels;
  const { data } = await (await createClient()).auth.getClaims();
  return {
    kind: data?.claims?.aal === "aal2" ? "ready" : "confirm",
    request,
    role,
    clientName: pending.clientName,
    email: identity.email,
    scopes: scopes.map((scope) => labels[scope]),
    writes: scopes.includes("hub:write"),
    days: role === "freelancer" ? FREELANCER_CONNECTION_DAYS : null,
    confirmHref: confirmSessionHref(`${CONSENT_PATH}?request=${request}`),
  };
}
