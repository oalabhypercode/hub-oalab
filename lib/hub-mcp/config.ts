/**
 * Claude-Connector (MCP) of the hub: addresses, lifetimes and what a connection may do. Admins connect Claude
 * (claude.ai) to the hub; Claude then reads, and writes where allowed, through hub.oalab.de/api/mcp with the rights of
 * the admin who allowed it. Since 19.11.2026 freelancers may too, once an admin switched it on for their login in the
 * user management: then Claude works with the freelancer's own rights (the database's rules), never with the admin's.
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
  "hub:read": "Lesen: Kunden mit Kontaktdaten, Projekte, Aufgaben, Termine, Verfügbarkeit, Notizen, Dateien, Vertrag & Domain, Gespräche, Protokolle und Insights (nie Passwörter)",
  "hub:write": "Schreiben: Termine, Verfügbarkeit, Aufgaben, Checklisten, Projekte, Beteiligte und Notizen anlegen und ändern, Notizen freigeben und in den Papierkorb legen",
};
/**
 * What the hub offers (step 3: writing too). Claude asks for every offered right, the consent page shows them, and a
 * connection made before keeps only reading until it is connected anew.
 */
export const OFFERED_SCOPES: readonly HubScope[] = ["hub:read", "hub:write"];

/** Who a connection works for: the login that allowed it, with the rights that login has in the hub. */
export type ConnectorRole = "admin" | "freelancer";

/**
 * The rights a freelancer's connection gets at most, whatever Claude asks for: reading their own projects, tasks and
 * requests (stage 1, 19.11.2026) and writing tasks and requests as the board and the calendar let them (stage 2).
 */
export const FREELANCER_SCOPES: readonly HubScope[] = ["hub:read", "hub:write"];
export const freelancerScopeLabels: Record<HubScope, string> = {
  "hub:read": "Lesen: deine Projekte und Aufgaben, freie Zeiten von oalab, deine Terminanfragen und die für dich freigegebenen Notizen",
  "hub:write": "Schreiben: Aufgaben anlegen, ändern, verschieben und kommentieren, Checklisten abhaken, Termine bei oalab anfragen, eigene Notizseiten schreiben",
};

/** The rights a login of this role gets from a request: never more than its role allows, reading always. */
export function scopesFor(role: ConnectorRole, requested: readonly HubScope[]): HubScope[] {
  if (role === "admin") return [...requested];
  const allowed = requested.filter((scope) => FREELANCER_SCOPES.includes(scope));
  return allowed.includes("hub:read") ? allowed : ["hub:read", ...allowed];
}

/**
 * A freelancer's connection ends 30 days after „Erlauben“, however often Claude uses it; then the freelancer connects
 * anew and confirms the code again. An admin's lasts as long as Claude uses it at least every 30 days.
 */
export const FREELANCER_CONNECTION_DAYS = 30;

/**
 * The admins' switch „Claude“ at a freelancer login (user management), kept in the login's app_metadata like its
 * second factor: true allows the connection, anything else refuses it.
 */
export const CLAUDE_SWITCH = "claude_connector";

/**
 * Who may connect: Claude's apps, recognised by the address of their Client ID Metadata Document, and only with
 * Claude's own return address. Anything else is refused before the admin sees a question.
 */
export const CLIENT_HOSTS = ["claude.ai", "claude.com"] as const;
export const CLIENT_REDIRECTS = ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"] as const;

export const SERVER_NAME = "oalab-hub";
export const SERVER_TITLE = "oalab Client Hub";
export const SERVER_VERSION = "1.0.0";
