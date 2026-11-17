/**
 * Claude-Connector (MCP) of the hub: addresses, lifetimes and what a connection may do. Admins connect Claude
 * (claude.ai) to the hub; Claude then reads, and writes where allowed, through hub.oalab.de/api/mcp with the rights of
 * the admin who allowed it.
 * The sign-in for it is the hub's own (OAuth 2.1 with PKCE, the client described by its Client ID Metadata Document);
 * Service OALab's sign-in server stays untouched. Self-contained (no imports): proxy, routes and tests share it.
 */

/** The switch: only `HUB_MCP_ENABLED=1` opens the connector; without it every address of it answers 404. */
export function mcpEnabled(env: Record<string, string | undefined> = process.env) {
  return /^(1|true|on|yes)$/i.test(env.HUB_MCP_ENABLED?.trim() ?? "");
}

export const MCP_PATH = "/api/mcp";
export const OAUTH_AUTHORIZE_PATH = "/api/mcp/oauth/authorize";
export const OAUTH_TOKEN_PATH = "/api/mcp/oauth/token";
export const OAUTH_REVOKE_PATH = "/api/mcp/oauth/revoke";
/** Where the admin allows or refuses the connection: under /dashboard, so the sign-in brings them back here. */
export const CONSENT_PATH = "/dashboard/settings/claude";
export const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";
export const AUTHORIZATION_SERVER_PATH = "/.well-known/oauth-authorization-server";

/**
 * Addresses Claude's servers call without a hub session (they bring their own key, or none yet); the proxy leaves
 * them alone, and each answers for itself. The consent page is not one of them: it needs the admin's session.
 */
export function isConnectorPath(pathname: string) {
  return pathname === MCP_PATH || pathname.startsWith(`${MCP_PATH}/`)
    || pathname === PROTECTED_RESOURCE_PATH || pathname.startsWith(`${PROTECTED_RESOURCE_PATH}/`)
    || pathname === AUTHORIZATION_SERVER_PATH;
}

/** The access key lives an hour; the refresh key 30 days and changes with every refresh. */
export const ACCESS_TOKEN_SECONDS = 60 * 60;
export const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;
/** The one-time code between „Erlauben“ and Claude's exchange. */
export const CODE_SECONDS = 5 * 60;
/** How long the consent page waits for the admin. */
export const REQUEST_SECONDS = 15 * 60;
/** Two refreshes racing with the same key: the second one fails without ending the connection. */
export const ROTATION_GRACE_SECONDS = 30;

export type HubScope = "hub:read" | "hub:write";
export const scopeLabels: Record<HubScope, string> = {
  "hub:read": "Lesen: Kunden, Projekte, Aufgaben und Termine",
  "hub:write": "Schreiben: Termine, Aufgaben und neue Projekte anlegen und ändern",
};
/**
 * What the hub offers (step 3: writing too). Claude asks for every offered right, the consent page shows them, and a
 * connection made before keeps only reading until it is connected anew.
 */
export const OFFERED_SCOPES: readonly HubScope[] = ["hub:read", "hub:write"];

/**
 * Who may connect: Claude's apps, recognised by the address of their Client ID Metadata Document, and only with
 * Claude's own return address. Anything else is refused before the admin sees a question.
 */
export const CLIENT_HOSTS = ["claude.ai", "claude.com"] as const;
export const CLIENT_REDIRECTS = ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"] as const;

export const SERVER_NAME = "oalab-hub";
export const SERVER_TITLE = "oalab Client Hub";
export const SERVER_VERSION = "1.0.0";
