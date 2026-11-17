import { connection } from "next/server";
import { connectorReady, authenticate } from "@/lib/hub-mcp/store";
import { bearerChallenge } from "@/lib/hub-mcp/oauth";
import { acceptedVersionHeader, answerMessage, parseFailure } from "@/lib/hub-mcp/protocol";
import { listTools, SERVER_INSTRUCTIONS } from "@/lib/hub-mcp/tools";
import { bearerToken, callHubTool, publicOrigin } from "@/lib/hub-mcp/server";
import { CORS_HEADERS, jsonAnswer, notFound, NO_STORE, preflight } from "@/lib/hub-mcp/http";

// The Claude connector (MCP, Streamable HTTP without sessions): one JSON-RPC message per POST, the answer as JSON.
// Every message needs a valid key of an active admin's connection; without one the 401 points Claude to the
// sign-in (lib/hub-mcp/oauth.ts). Claude reads, and writes where the admin allowed it (lib/hub-mcp/writes.ts).

const MAX_BODY = 1024 * 1024;

export async function POST(request: Request) {
  if (!connectorReady()) return notFound();
  const origin = publicOrigin(request);
  const token = bearerToken(request);
  const connection = token ? await authenticate(token) : null;
  if (!connection) {
    return jsonAnswer({ error: token ? "invalid_token" : "unauthorized", error_description: "Sign in through the hub first." }, 401, {
      "WWW-Authenticate": bearerChallenge(origin, token ? "invalid_token" : undefined),
    });
  }
  if (!acceptedVersionHeader(request.headers.get("mcp-protocol-version"))) {
    return jsonAnswer({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Unsupported MCP-Protocol-Version." } }, 400);
  }
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY) return jsonAnswer({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Message too large." } }, 413);

  let message: unknown;
  try {
    message = JSON.parse(await request.text());
  } catch {
    const failed = parseFailure();
    return jsonAnswer(failed.body, failed.status);
  }
  const answer = await answerMessage(message, {
    tools: listTools(connection.scopes),
    instructions: SERVER_INSTRUCTIONS,
    callTool: (name, args) => callHubTool(connection, name, args, origin),
  });
  if (answer.status === 202) return new Response(null, { status: 202, headers: { ...CORS_HEADERS, ...NO_STORE } });
  return jsonAnswer(answer.body, answer.status);
}

/** No stream from the server to Claude (no notifications): GET and DELETE are not offered. */
async function notOffered() {
  // Answered per request, never prerendered: the switch may change without a new build.
  await connection();
  if (!connectorReady()) return notFound();
  return new Response(null, { status: 405, headers: { ...CORS_HEADERS, ...NO_STORE, Allow: "POST, OPTIONS" } });
}

export const GET = notOffered;
export const DELETE = notOffered;

export function OPTIONS() {
  return connectorReady() ? preflight() : notFound();
}
