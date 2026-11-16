/**
 * The MCP side of the connector without HTTP: one JSON-RPC message in, its answer out (Streamable HTTP, stateless,
 * answers as plain JSON). Lifecycle (initialize, ping), tools/list and tools/call; anything else is "method not
 * found". Tests check it directly; app/api/mcp/route.ts adds the key check and the transport.
 */
import { SERVER_NAME, SERVER_TITLE, SERVER_VERSION } from "./config";

/** Newest first. A client asking for another version gets the newest; it decides whether it can go on. */
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;

export function negotiateVersion(requested: unknown) {
  return typeof requested === "string" && (PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : PROTOCOL_VERSIONS[0];
}

/** The MCP-Protocol-Version header after initialize: absent means 2025-03-26; an unknown one gets 400 (spec). */
export function acceptedVersionHeader(value: string | null) {
  return value === null || (PROTOCOL_VERSIONS as readonly string[]).includes(value);
}

export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { title: string; readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
};
export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

export type RpcContext = {
  tools: ToolDefinition[];
  /** Runs a listed tool; null when no tool has this name. */
  callTool: (name: string, args: Record<string, unknown>) => Promise<ToolResult | null>;
  instructions: string;
};

type RpcId = string | number;
export type RpcAnswer = { status: 200 | 400; body: Record<string, unknown> } | { status: 202; body: null };

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

const failure = (id: RpcId | null, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
const success = (id: RpcId, result: unknown) => ({ jsonrpc: "2.0", id, result });
const isId = (value: unknown): value is RpcId => typeof value === "string" || (typeof value === "number" && Number.isInteger(value));

/** A body that is no JSON at all. */
export const parseFailure = (): RpcAnswer => ({ status: 400, body: failure(null, PARSE_ERROR, "Parse error") });

export async function answerMessage(message: unknown, context: RpcContext): Promise<RpcAnswer> {
  if (Array.isArray(message)) return { status: 400, body: failure(null, INVALID_REQUEST, "Batches are not supported.") };
  if (!message || typeof message !== "object") return { status: 400, body: failure(null, INVALID_REQUEST, "Invalid request.") };
  const rpc = message as Record<string, unknown>;
  if (rpc.jsonrpc !== "2.0") return { status: 400, body: failure(null, INVALID_REQUEST, "Invalid request.") };
  // Notifications (no id) and answers to requests of ours (no method) are taken without a reply.
  if (typeof rpc.method !== "string" || !("id" in rpc)) return { status: 202, body: null };
  if (!isId(rpc.id)) return { status: 400, body: failure(null, INVALID_REQUEST, "Requests need a string or integer id.") };
  const id = rpc.id;
  const params = rpc.params && typeof rpc.params === "object" && !Array.isArray(rpc.params) ? rpc.params as Record<string, unknown> : {};

  switch (rpc.method) {
    case "initialize":
      return {
        status: 200,
        body: success(id, {
          protocolVersion: negotiateVersion(params.protocolVersion),
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, title: SERVER_TITLE, version: SERVER_VERSION },
          instructions: context.instructions,
        }),
      };
    case "ping":
      return { status: 200, body: success(id, {}) };
    case "tools/list":
      return { status: 200, body: success(id, { tools: context.tools }) };
    case "tools/call": {
      const name = params.name;
      if (typeof name !== "string" || !name) return { status: 200, body: failure(id, INVALID_PARAMS, "Missing tool name.") };
      const args = params.arguments ?? {};
      if (typeof args !== "object" || Array.isArray(args)) return { status: 200, body: failure(id, INVALID_PARAMS, "Tool arguments must be an object.") };
      try {
        const result = await context.callTool(name, args as Record<string, unknown>);
        return { status: 200, body: result ? success(id, result) : failure(id, INVALID_PARAMS, `Unknown tool: ${name.slice(0, 64)}`) };
      } catch {
        return { status: 200, body: failure(id, INTERNAL_ERROR, "The tool failed. Please try again.") };
      }
    }
    default:
      return { status: 200, body: failure(id, METHOD_NOT_FOUND, `Method not found: ${rpc.method.slice(0, 64)}`) };
  }
}
