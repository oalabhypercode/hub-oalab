import "server-only";

// Shared answers of the connector's addresses. Claude's servers call them without cookies; browsers (an MCP test tool)
// may call them from another site, which is harmless here: every answer depends on a key in the header, never on a
// session. Nothing of it is cached on the way.

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
};

export const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

export function jsonAnswer(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...CORS_HEADERS, ...NO_STORE, ...headers } });
}

/** With the switch off the connector does not exist: a plain 404, like any unknown address. */
export const notFound = () => new Response("Not found", { status: 404, headers: NO_STORE });

export const preflight = () => new Response(null, { status: 204, headers: { ...CORS_HEADERS, "Access-Control-Max-Age": "86400" } });

/** OAuth errors of the token and revocation endpoints (RFC 6749, 5.2). */
export const oauthError = (error: string, description: string, status = 400) => jsonAnswer({ error, error_description: description }, status);

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** A short page in the browser when a connection cannot even reach the question (wrong app, wrong address). */
export function messagePage(status: number, message: string) {
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Claude verbinden · oalab</title><meta name="robots" content="noindex"></head><body style="font-family: system-ui, sans-serif; max-width: 34rem; margin: 15vh auto; padding: 0 1.25rem; line-height: 1.5; color: #1d1d1f; background: #f5f5f7"><h1 style="font-size: 1.4rem">Claude verbinden</h1><p>${escape(message)}</p><p style="color: #6e6e73">Du kannst dieses Fenster schließen und es in Claude erneut versuchen.</p></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE } });
}

/** Form fields of a token or revocation request: form-encoded as the standard asks, JSON accepted as well. */
export async function readForm(request: Request): Promise<URLSearchParams | null> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 16 * 1024) return null;
  const body = await request.text().catch(() => null);
  if (body === null || body.length > 16 * 1024) return null;
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      return new URLSearchParams(Object.entries(parsed).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])));
    } catch {
      return null;
    }
  }
  return new URLSearchParams(body);
}
