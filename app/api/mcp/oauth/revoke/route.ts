import { connectorReady, logEvent, revoke } from "@/lib/hub-mcp/store";
import { jsonAnswer, notFound, oauthError, preflight, readForm } from "@/lib/hub-mcp/http";

// RFC 7009: Claude gives back one of its keys (e.g. when the connector is removed there); the connection ends. The
// answer is 200 for unknown keys as well, as the standard asks.

export async function POST(request: Request) {
  if (!connectorReady()) return notFound();
  const form = await readForm(request);
  const token = form?.get("token");
  if (!token) return oauthError("invalid_request", "token is required.");
  const ended = await revoke(token, form?.get("client_id") ?? null);
  if (ended) await logEvent(ended.user_id, "claude.disconnected", `${ended.client_name || "Claude"} hat die Verbindung selbst beendet`);
  return jsonAnswer({});
}

export function OPTIONS() {
  return connectorReady() ? preflight() : notFound();
}
