// The own platform (`OALAB_PLATFORM=own`, Aufgabe 4, 08.11.2026): the Hub runs on OALab's server next to Service
// OALab, on the same PostgreSQL, login and file store. The call sites keep talking supabase-js; lib/platform/* answers
// underneath: data through an internal PostgREST, login through the Better Auth tables both apps share, files through
// Garage with the storage catalog under the person's role. Self-contained, so `node --test` can load it.

export type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export function usesOwnPlatform(env: RuntimeEnvironment = process.env) {
  return env.OALAB_PLATFORM?.trim() === "own";
}

/** Better Auth's session cookie as Service OALab names it (`cookiePrefix: "oalab"`); `__Secure-` on HTTPS. */
export const SESSION_COOKIE = "oalab.session_token";
export function sessionCookieName(secure: boolean) {
  return secure ? `__Secure-${SESSION_COOKIE}` : SESSION_COOKIE;
}

/** Service OALab's session lifetime and renewal age (apps/web/server/auth/better-auth.ts). */
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_UPDATE_SECONDS = 24 * 60 * 60;
/** One-time links (`generateLink`): a password reset lives a day, so a forwarded or old mail soon stops working. */
export const LINK_HOURS = 24;
/**
 * The first link of a login that never signed in (the activation, also an invitation sent in bulk) lives a week: people
 * open an invitation days later. Once someone has signed in, every further link is a reset again.
 */
export const ACTIVATION_LINK_HOURS = 7 * 24;
export function linkHours(kind: "signup" | "recovery" | "magiclink", signedInBefore: boolean) {
  return kind === "recovery" && !signedInBefore ? ACTIVATION_LINK_HOURS : LINK_HOURS;
}
/** Lifetime of the tokens PostgREST sees. Minted per request, so short is free. */
export const REST_TOKEN_SECONDS = 5 * 60;

/** The internal PostgREST origin, e.g. `http://postgrest-<uuid>:3000`. */
export function restOrigin(env: RuntimeEnvironment = process.env) {
  const value = env.OALAB_REST_URL?.trim();
  if (!value) throw new Error("OALAB_PLATFORM=own requires OALAB_REST_URL.");
  const url = new URL(value);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.pathname !== "/") throw new Error("OALAB_REST_URL must be an origin.");
  return url.origin;
}

export function restJwtSecret(env: RuntimeEnvironment = process.env) {
  const value = env.OALAB_REST_JWT_SECRET?.trim();
  if (!value || value.length < 32) throw new Error("OALAB_PLATFORM=own requires OALAB_REST_JWT_SECRET (32+ characters).");
  return value;
}

export function betterAuthSecret(env: RuntimeEnvironment = process.env) {
  const value = env.BETTER_AUTH_SECRET?.trim();
  if (!value || value.length < 32) throw new Error("OALAB_PLATFORM=own requires BETTER_AUTH_SECRET (32+ characters).");
  return value;
}

/** supabase-js appends `/rest/v1` to every data request; PostgREST serves the same API at its root. */
export function restRequestUrl(input: string, origin: string) {
  const url = new URL(input);
  if (url.origin !== origin) throw new Error("Data requests go to the internal PostgREST only.");
  if (url.pathname.startsWith("/rest/v1/")) url.pathname = url.pathname.slice("/rest/v1".length);
  else if (url.pathname === "/rest/v1") url.pathname = "/";
  return url.toString();
}

/** Supabase merges metadata updates key by key; `null` removes a key. */
export function mergeMetadata(current: unknown, update: unknown): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(isRecord(current) ? current : {}) };
  for (const [key, value] of Object.entries(isRecord(update) ? update : {})) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Supabase's `ban_duration`: `none` lifts a ban, otherwise a Go duration such as `876000h` or `24h30m`. Returns the end
 * of the ban, null for none, undefined for anything unreadable.
 */
export function banUntil(duration: string, now = Date.now()): Date | null | undefined {
  const value = duration.trim();
  if (value === "none") return null;
  const units: Record<string, number> = { ns: 1e-6, us: 1e-3, "µs": 1e-3, ms: 1, s: 1_000, m: 60_000, h: 3_600_000 };
  const parts = [...value.matchAll(/(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/gu)];
  if (!parts.length || parts.map((part) => part[0]).join("") !== value) return undefined;
  const ms = parts.reduce((sum, part) => sum + Number(part[1]) * units[part[2]], 0);
  return Number.isFinite(ms) && ms > 0 ? new Date(now + ms) : undefined;
}
