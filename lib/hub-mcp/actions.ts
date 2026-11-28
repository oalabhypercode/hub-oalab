"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { siteOrigin } from "@/lib/site-origin";
import { verifyHubAdmin, verifyHubFreelancer } from "@/lib/hub-users/server";
import { FREELANCER_CONNECTION_DAYS, scopesFor, type ConnectorRole } from "./config";
import { mcpResource, withParams } from "./oauth";
import { connectorReady, connectorRoleOf, disconnect, issueCode, listConnections, logEvent, takePendingRequest, type ConnectionView } from "./store";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const expired = { ok: false as const, error: "Diese Anfrage ist abgelaufen oder schon beantwortet. Starte die Verbindung in Claude neu." };
const switchedOff = { ok: false as const, error: "Der Claude-Connector ist gerade ausgeschaltet." };
const origin = async () => siteOrigin(await headers()) ?? "https://hub.oalab.de";

/**
 * Who may connect Claude right now: an active admin, or an active freelancer whose login an admin switched on for
 * Claude in the user management (read fresh from the login). Null for everyone else.
 */
async function connectingLogin(): Promise<{ userId: string; role: ConnectorRole } | null> {
  const admin = await verifyHubAdmin();
  if (admin) return { userId: admin.userId, role: "admin" };
  const freelancer = await verifyHubFreelancer();
  if (!freelancer) return null;
  return (await connectorRoleOf(freelancer.userId).catch(() => null)) === "freelancer" ? { userId: freelancer.userId, role: "freelancer" } : null;
}

/**
 * The answer on the consent page. „Erlauben“ needs a session that confirmed its code (aal2) and an active admin, or an
 * active freelancer an admin switched on for Claude; it creates the one-time code Claude exchanges for its keys, with
 * the rights that login's role gets (a freelancer never more than FREELANCER_SCOPES). „Ablehnen“ tells Claude no.
 * Either way the request is used up, and the page sends the browser back to Claude's own return address.
 */
export async function answerClaude(request: string, allow: boolean): Promise<Result<{ url: string }>> {
  if (!connectorReady()) return switchedOff;
  const issuer = await origin();
  if (!allow) {
    const pending = await takePendingRequest(String(request)).catch(() => null);
    if (!pending) return expired;
    return { ok: true, data: { url: withParams(pending.redirectUri, { error: "access_denied", error_description: "The connection was refused in the hub.", state: pending.state, iss: issuer }) } };
  }
  const { data } = await (await createClient()).auth.getClaims();
  if (data?.claims?.aal !== "aal2") return { ok: false, error: "Bitte bestätige dich zuerst mit dem Code aus deiner E-Mail." };
  const login = await connectingLogin();
  if (!login) return { ok: false, error: "Claude lässt sich mit diesem Zugang nicht verbinden. Freelancer schaltet das oalab-Team dafür frei." };
  try {
    const pending = await takePendingRequest(String(request));
    if (!pending) return expired;
    const code = await issueCode({ ...pending, scopes: scopesFor(login.role, pending.scopes), userId: login.userId });
    return { ok: true, data: { url: withParams(pending.redirectUri, { code, state: pending.state, iss: issuer }) } };
  } catch {
    return { ok: false, error: "Das hat gerade nicht geklappt. Bitte versuche es erneut." };
  }
}

/**
 * The card „Verbundene Apps“: whether this login may connect Claude (`allowed`; a freelancer only once an admin
 * switched it on), the address for Claude and the login's own connections.
 */
export type ClaudeConnections = { enabled: boolean; allowed: boolean; role: ConnectorRole; days: number | null; address: string; connections: ConnectionView[] };

const missingTable = (error: unknown) => (error as { code?: string } | null)?.code === "42P01";

export async function loadClaudeConnections(): Promise<Result<ClaudeConnections>> {
  const admin = await verifyHubAdmin();
  const freelancer = admin ? null : await verifyHubFreelancer();
  if (!admin && !freelancer) return { ok: false, error: "Verbundene Apps gibt es nur für Admins und freigeschaltete Freelancer." };
  const role: ConnectorRole = admin ? "admin" : "freelancer";
  const userId = (admin ?? freelancer)!.userId;
  const address = mcpResource(await origin());
  const days = role === "freelancer" ? FREELANCER_CONNECTION_DAYS : null;
  if (!connectorReady()) return { ok: true, data: { enabled: false, allowed: role === "admin", role, days, address, connections: [] } };
  try {
    const allowed = role === "admin" || (await connectorRoleOf(userId)) === "freelancer";
    return { ok: true, data: { enabled: true, allowed, role, days, address, connections: allowed ? await listConnections(userId) : [] } };
  } catch (error) {
    return { ok: false, error: missingTable(error) ? "Für die Verbindungen fehlt noch die Erweiterung der Datenbank." : "Die Verbindungen konnten gerade nicht geladen werden." };
  }
}

/** „Trennen“ on the own card: the connection ends at once; Claude has to be connected anew to read again. */
export async function disconnectClaude(connectionId: string): Promise<Result<null>> {
  const admin = await verifyHubAdmin();
  const login = admin ?? await verifyHubFreelancer();
  if (!login) return { ok: false, error: "Verbundene Apps gibt es nur für Admins und freigeschaltete Freelancer." };
  try {
    const name = await disconnect(login.userId, String(connectionId));
    if (!name) return { ok: false, error: "Diese Verbindung gibt es nicht mehr." };
    await logEvent(login.userId, "claude.disconnected", `${name} im Hub getrennt`);
    return { ok: true, data: null };
  } catch {
    return { ok: false, error: "Das hat gerade nicht geklappt. Bitte versuche es erneut." };
  }
}
