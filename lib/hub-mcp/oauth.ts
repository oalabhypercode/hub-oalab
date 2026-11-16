/**
 * The OAuth rules of the Claude connector, without database or network: keys and their checksums, PKCE, the
 * checks of an authorization request and of Claude's Client ID Metadata Document, granted scopes and the two
 * metadata documents Claude reads first. The routes and lib/hub-mcp/store.ts build on it; tests check it directly.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  ACCESS_TOKEN_SECONDS, CLIENT_HOSTS, CLIENT_REDIRECTS, MCP_PATH, OAUTH_AUTHORIZE_PATH, OAUTH_REVOKE_PATH,
  OAUTH_TOKEN_PATH, OFFERED_SCOPES, PROTECTED_RESOURCE_PATH, SERVER_TITLE, type HubScope,
} from "./config";

/** A fresh key or code: 32 random bytes, base64url (43 characters). */
export const newSecret = () => randomBytes(32).toString("base64url");
/** What the database keeps of a key: its SHA-256 as hex. */
export const secretHash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/** PKCE S256: base64url(SHA-256(verifier)). */
export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier, "ascii").digest("base64url");

export function pkceMatches(verifier: unknown, challenge: string) {
  if (typeof verifier !== "string" || !VERIFIER.test(verifier) || !CHALLENGE.test(challenge)) return false;
  const expected = Buffer.from(challenge);
  const actual = Buffer.from(pkceChallenge(verifier));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** The MCP address Claude was given, without a trailing slash: the resource every key is for. */
export const mcpResource = (origin: string) => `${origin}${MCP_PATH}`;

export function sameResource(value: unknown, origin: string) {
  if (typeof value !== "string") return false;
  return value.replace(/\/+$/, "") === mcpResource(origin);
}

/**
 * A client ID is the https address of its metadata document on one of Claude's hosts: no credentials, port,
 * fragment or bare host. Anything else is no client of ours.
 */
export function readClientId(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return null;
  if (!(CLIENT_HOSTS as readonly string[]).includes(url.hostname)) return null;
  if (url.pathname === "/" || url.href !== value) return null;
  return value;
}

export type ClientDocument = { name: string; redirectUris: string[] };

const clean = (value: string, max: number) => value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Checks the fetched metadata document: it names itself with exactly this client ID, lists its return addresses and
 * signs in without a secret (Claude is a public client with PKCE). The name is shown on the consent page.
 */
export function checkClientDocument(document: unknown, clientId: string): { ok: true; value: ClientDocument } | { ok: false; error: string } {
  if (!document || typeof document !== "object" || Array.isArray(document)) return { ok: false, error: "Die Beschreibung der App ist kein JSON-Objekt." };
  const doc = document as Record<string, unknown>;
  if (doc.client_id !== clientId) return { ok: false, error: "Die Beschreibung der App gehört zu einer anderen Adresse." };
  const uris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.filter((uri): uri is string => typeof uri === "string") : [];
  if (!uris.length) return { ok: false, error: "Die App nennt keine Rücksprungadresse." };
  const method = doc.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") return { ok: false, error: "Die App will sich mit einem Geheimnis anmelden; das ist hier nicht vorgesehen." };
  const name = typeof doc.client_name === "string" ? clean(doc.client_name, 80) : "";
  return { ok: true, value: { name: name || "Claude", redirectUris: uris } };
}

/** The return address: the requested one (or the only one) if the document lists it and it is Claude's own. */
export function pickRedirect(requested: unknown, document: ClientDocument): string | null {
  const allowed = document.redirectUris.filter((uri) => (CLIENT_REDIRECTS as readonly string[]).includes(uri));
  if (typeof requested === "string" && requested) return allowed.includes(requested) ? requested : null;
  return allowed.length === 1 ? allowed[0] : null;
}

/**
 * The rights a connection gets: reading always, writing only if Claude asks for it and the hub offers it.
 * `offline_access` and unknown scopes are ignored (refresh keys come anyway).
 */
export function grantScopes(requested: unknown, offered: readonly HubScope[] = OFFERED_SCOPES): HubScope[] {
  const asked = typeof requested === "string" ? requested.split(/\s+/).filter(Boolean) : [];
  return offered.filter((scope) => scope === "hub:read" || asked.includes(scope));
}

export const hasScope = (scopes: readonly string[], scope: HubScope) => scopes.includes(scope);

/** The fields of an authorization request, read once; the route decides what each failure means. */
export function readAuthorizeParams(params: Pick<URLSearchParams, "get">) {
  const value = (name: string) => {
    const raw = params.get(name);
    return raw === null ? null : raw.slice(0, 2000);
  };
  return {
    responseType: value("response_type"),
    clientId: value("client_id"),
    redirectUri: value("redirect_uri"),
    state: value("state"),
    codeChallenge: value("code_challenge"),
    codeChallengeMethod: value("code_challenge_method"),
    scope: value("scope"),
    resource: value("resource"),
  };
}

export type AuthorizeParams = ReturnType<typeof readAuthorizeParams>;

/**
 * What remains wrong with a request whose client and return address are already known good: the error code and
 * text that go back to Claude, or null when the admin may be asked.
 */
export function authorizeProblem(params: AuthorizeParams, origin: string): { error: string; description: string } | null {
  if (params.responseType !== "code") return { error: "unsupported_response_type", description: "Only response_type=code is supported." };
  if (!params.codeChallenge || !CHALLENGE.test(params.codeChallenge)) return { error: "invalid_request", description: "A PKCE code_challenge (S256) is required." };
  if (params.codeChallengeMethod !== "S256") return { error: "invalid_request", description: "Only code_challenge_method=S256 is supported." };
  if (params.resource !== null && !sameResource(params.resource, origin)) return { error: "invalid_target", description: "This server only issues keys for its MCP address." };
  if (params.state !== null && params.state.length > 1000) return { error: "invalid_request", description: "The state is too long." };
  return null;
}

/** The return address with its parameters, e.g. `code` and `state`, or `error` and `state`. */
export function withParams(uri: string, params: Record<string, string | null | undefined>) {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined) url.searchParams.set(key, value);
  return url.toString();
}

/** RFC 9728: the protected resource (the MCP address) and who issues keys for it (the hub itself). */
export function protectedResourceMetadata(origin: string, scopes: readonly HubScope[] = OFFERED_SCOPES) {
  return {
    resource: mcpResource(origin),
    authorization_servers: [origin],
    scopes_supported: [...scopes],
    bearer_methods_supported: ["header"],
    resource_name: SERVER_TITLE,
  };
}

/** RFC 8414: the hub's sign-in for Claude. Public clients with PKCE, recognised by their metadata document. */
export function authorizationServerMetadata(origin: string, scopes: readonly HubScope[] = OFFERED_SCOPES) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${OAUTH_AUTHORIZE_PATH}`,
    token_endpoint: `${origin}${OAUTH_TOKEN_PATH}`,
    revocation_endpoint: `${origin}${OAUTH_REVOKE_PATH}`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...scopes],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

/** The 401 that sends Claude to the metadata, as RFC 9728 and the MCP authorization spec ask. */
export function bearerChallenge(origin: string, error?: "invalid_token" | "insufficient_scope", scope?: string) {
  const parts = [`Bearer realm="${SERVER_TITLE}"`, `resource_metadata="${origin}${PROTECTED_RESOURCE_PATH}${MCP_PATH}"`];
  if (error) parts.push(`error="${error}"`);
  if (scope) parts.push(`scope="${scope}"`);
  return parts.join(", ");
}

/** The token response of RFC 6749 with the granted rights. */
export function tokenResponse(keys: { access: string; refresh: string }, scopes: readonly string[]) {
  return { access_token: keys.access, token_type: "Bearer", expires_in: ACCESS_TOKEN_SECONDS, refresh_token: keys.refresh, scope: scopes.join(" ") };
}
