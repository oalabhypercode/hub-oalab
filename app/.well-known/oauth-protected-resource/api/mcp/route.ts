import { metadataPreflight, protectedResource } from "@/lib/hub-mcp/metadata";

// RFC 9728 with the path of the MCP address: Claude asks here first, then without the path.
export const GET = protectedResource;
export const OPTIONS = metadataPreflight;
