import { createHmac } from "node:crypto";

// Tokens for the internal PostgREST (HS256). They never leave the server: minted per request from the verified
// session, so `request.jwt.claims` carries the same `sub`, `role`, `aal` and metadata as Supabase's did and every RLS
// policy decides as before. Self-contained, so `node --test` can load it.

export function signJwt(payload: Record<string, unknown>, secret: string) {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${part({ alg: "HS256", typ: "JWT" })}.${part(payload)}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
