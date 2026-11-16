"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { siteOrigin } from "@/lib/site-origin";
import { verifyHubAdmin } from "@/lib/hub-users/server";
import { mcpResource, withParams } from "./oauth";
import { connectorReady, disconnect, issueCode, listConnections, logEvent, takePendingRequest, type ConnectionView } from "./store";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const expired = { ok: false as const, error: "Diese Anfrage ist abgelaufen oder schon beantwortet. Starte die Verbindung in Claude neu." };
const switchedOff = { ok: false as const, error: "Der Claude-Connector ist gerade ausgeschaltet." };
const origin = async () => siteOrigin(await headers()) ?? "https://hub.oalab.de";

/**
 * The admin's answer on the consent page. „Erlauben“ needs an active admin whose session confirmed its code (aal2);
 * it creates the one-time code Claude exchanges for its keys. „Ablehnen“ tells Claude no. Either way the request is
 * used up, and the page sends the browser back to Claude's own return address.
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
  const admin = await verifyHubAdmin();
  if (!admin) return { ok: false, error: "Claude lässt sich nur mit einem Admin-Login verbinden." };
  try {
    const pending = await takePendingRequest(String(request));
    if (!pending) return expired;
    const code = await issueCode({ ...pending, userId: admin.userId });
    return { ok: true, data: { url: withParams(pending.redirectUri, { code, state: pending.state, iss: issuer }) } };
  } catch {
    return { ok: false, error: "Das hat gerade nicht geklappt. Bitte versuche es erneut." };
  }
}

export type ClaudeConnections = { enabled: boolean; address: string; connections: ConnectionView[] };

const missingTable = (error: unknown) => (error as { code?: string } | null)?.code === "42P01";

/** The card „Verbundene Apps“: the address for Claude and the admin's own connections. */
export async function loadClaudeConnections(): Promise<Result<ClaudeConnections>> {
  const admin = await verifyHubAdmin();
  if (!admin) return { ok: false, error: "Verbundene Apps gibt es nur für Admins." };
  const address = mcpResource(await origin());
  if (!connectorReady()) return { ok: true, data: { enabled: false, address, connections: [] } };
  try {
    return { ok: true, data: { enabled: true, address, connections: await listConnections(admin.userId) } };
  } catch (error) {
    return { ok: false, error: missingTable(error) ? "Für die Verbindungen fehlt noch die Erweiterung der Datenbank." : "Die Verbindungen konnten gerade nicht geladen werden." };
  }
}

/** „Trennen“: the connection ends at once; Claude has to be connected anew to read again. */
export async function disconnectClaude(connectionId: string): Promise<Result<null>> {
  const admin = await verifyHubAdmin();
  if (!admin) return { ok: false, error: "Verbundene Apps gibt es nur für Admins." };
  try {
    const name = await disconnect(admin.userId, String(connectionId));
    if (!name) return { ok: false, error: "Diese Verbindung gibt es nicht mehr." };
    await logEvent(admin.userId, "claude.disconnected", `${name} im Hub getrennt`);
    return { ok: true, data: null };
  } catch {
    return { ok: false, error: "Das hat gerade nicht geklappt. Bitte versuche es erneut." };
  }
}
