import { scopeLabels } from "@/lib/hub-mcp/config";
import { pkceMatches, sameResource, tokenResponse } from "@/lib/hub-mcp/oauth";
import { connect, connectorReady, logEvent, rotate, takeCode } from "@/lib/hub-mcp/store";
import { publicOrigin } from "@/lib/hub-mcp/server";
import { jsonAnswer, notFound, oauthError, preflight, readForm } from "@/lib/hub-mcp/http";

// Step 3 of the sign-in: Claude exchanges the one-time code (with its PKCE verifier) for keys, and later its refresh
// key for new keys. Only checksums are stored; a refresh key that was already replaced ends the connection.

export async function POST(request: Request) {
  if (!connectorReady()) return notFound();
  const origin = publicOrigin(request);
  const form = await readForm(request);
  if (!form) return oauthError("invalid_request", "The request could not be read.");
  const grantType = form.get("grant_type");
  const clientId = form.get("client_id");

  if (grantType === "authorization_code") {
    const code = form.get("code");
    if (!code || !clientId) return oauthError("invalid_request", "code and client_id are required.");
    const grant = await takeCode(code);
    if (!grant || grant.clientId !== clientId) return oauthError("invalid_grant", "The code is invalid, used or expired.");
    const redirectUri = form.get("redirect_uri");
    if (redirectUri !== null && redirectUri !== grant.redirectUri) return oauthError("invalid_grant", "redirect_uri does not match.");
    if (!pkceMatches(form.get("code_verifier"), grant.codeChallenge)) return oauthError("invalid_grant", "PKCE verification failed.");
    const resource = form.get("resource");
    if (resource !== null && !sameResource(resource, origin)) return oauthError("invalid_target", "This server only issues keys for its MCP address.");
    const keys = await connect(grant);
    if (!keys) return oauthError("invalid_grant", "This login may not connect apps.");
    await logEvent(grant.userId, "claude.connected", `${grant.clientName} mit dem Hub verbunden (${grant.scopes.map((scope) => scopeLabels[scope].split(":")[0]).join(", ")})`);
    return jsonAnswer(tokenResponse(keys, grant.scopes));
  }

  if (grantType === "refresh_token") {
    const refreshToken = form.get("refresh_token");
    if (!refreshToken) return oauthError("invalid_request", "refresh_token is required.");
    const rotation = await rotate(refreshToken, clientId);
    if (!rotation.ok) {
      if (rotation.reused) await logEvent(rotation.reused.userId, "claude.disconnected", `${rotation.reused.clientName} getrennt: ein alter Schlüssel wurde noch einmal benutzt`);
      return oauthError("invalid_grant", "The refresh token is invalid or expired.");
    }
    return jsonAnswer(tokenResponse(rotation.keys, rotation.scopes));
  }

  return oauthError("unsupported_grant_type", "Only authorization_code and refresh_token are supported.");
}

export function OPTIONS() {
  return connectorReady() ? preflight() : notFound();
}
