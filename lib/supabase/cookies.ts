import type { CookieOptionsWithName } from "@supabase/ssr";

/**
 * One login for Hub OALab and Service OALab: both apps write the Supabase session into this cookie with the same
 * name and options. Service OALab uses the identical values (`service-oalab/apps/web/lib/supabase/config.ts`);
 * change both together. Self-contained, so the server, the proxy and `node --test` share it.
 */
export const AUTH_COOKIE_NAME = "sb-oalab-auth-token";
const SHARED_COOKIE_DOMAIN = "oalab.de";

/** The cookies of the former Hub-only project (`sb-<project>-auth-token`, chunks, PKCE verifier). The proxy removes them. */
export const LEGACY_AUTH_COOKIE = /^sb-[a-z0-9]{20}-auth-token(?:\.\d+|-code-verifier)?$/;

/**
 * HTTP-only, so browser code never sees a token. On oalab.de and its subdomains the cookie carries `Domain=oalab.de`
 * and so reaches hub.oalab.de and service.oalab.de alike; previews, the Coolify test address and localhost keep
 * host-bound cookies. Only local development runs without `Secure`.
 */
export function authCookieOptions(host: string | null | undefined, env: Record<string, string | undefined> = process.env): CookieOptionsWithName {
  const domain = sharedCookieDomain(host, env);
  return {
    ...(domain ? { domain } : {}),
    httpOnly: true,
    name: AUTH_COOKIE_NAME,
    path: "/",
    sameSite: "lax",
    secure: env.NODE_ENV !== "development",
  };
}

/** `oalab.de` for hosts under it, else none. `OALAB_AUTH_COOKIE_DOMAIN` sets another domain for local tests or `off`. */
export function sharedCookieDomain(host: string | null | undefined, env: Record<string, string | undefined> = process.env) {
  const configured = env.OALAB_AUTH_COOKIE_DOMAIN?.trim().toLowerCase();
  if (configured === "off") return undefined;
  const domain = configured || SHARED_COOKIE_DOMAIN;
  const hostname = host?.split(",")[0]?.trim().toLowerCase().replace(/:\d+$/, "");
  if (!hostname) return undefined;
  return hostname === domain || hostname.endsWith(`.${domain}`) ? domain : undefined;
}

/** The host a request was sent to, as the platform in front of the app reports it. */
export function requestHost(list: Pick<Headers, "get">) {
  return list.get("x-forwarded-host") ?? list.get("host");
}
