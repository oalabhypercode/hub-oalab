import "server-only";
import { connection } from "next/server";
import { authorizationServerMetadata, protectedResourceMetadata } from "./oauth";
import { connectorReady } from "./store";
import { publicOrigin } from "./server";
import { jsonAnswer, notFound, preflight } from "./http";

// The two documents Claude reads before it signs in (app/.well-known/…/route.ts). Answered per request, never
// prerendered: the switch and the address may change without a new build.

export async function protectedResource(request: Request) {
  await connection();
  if (!connectorReady()) return notFound();
  return jsonAnswer(protectedResourceMetadata(publicOrigin(request)));
}

export async function authorizationServer(request: Request) {
  await connection();
  if (!connectorReady()) return notFound();
  return jsonAnswer(authorizationServerMetadata(publicOrigin(request)));
}

export async function metadataPreflight() {
  return connectorReady() ? preflight() : notFound();
}
