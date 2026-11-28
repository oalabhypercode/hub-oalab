import { metadataPreflight, protectedResource } from "@/lib/hub-mcp/metadata";

// RFC 9728 for the Claude connector: which address is protected and who issues its keys (lib/hub-mcp/oauth.ts).
export const GET = protectedResource;
export const OPTIONS = metadataPreflight;
