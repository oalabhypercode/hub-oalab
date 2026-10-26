// The session behind an access token that Supabase Auth just issued to this server, e.g. right after a sign-in. It
// never left the server, so it is read without verifying it again; tokens from cookies go through getClaims instead.
// Self-contained, so `node --test` can load it.

export type CodeSession = { userId: string; sessionId: string; email: string };

/** The token's claims, or null for anything that is not a readable JWT. */
export function tokenClaims(accessToken: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/** Login, Supabase session and e-mail address of the token. */
export function sessionOf(accessToken: string): CodeSession | null {
  const claims = tokenClaims(accessToken);
  return claims && typeof claims.sub === "string" && typeof claims.session_id === "string" && typeof claims.email === "string"
    ? { userId: claims.sub, sessionId: claims.session_id, email: claims.email }
    : null;
}
