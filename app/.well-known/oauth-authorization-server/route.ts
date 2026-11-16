import { authorizationServer, metadataPreflight } from "@/lib/hub-mcp/metadata";

// RFC 8414 for the Claude connector: the hub's own sign-in for Claude (lib/hub-mcp/oauth.ts).
export const GET = authorizationServer;
export const OPTIONS = metadataPreflight;
