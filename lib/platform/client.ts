import "server-only";
import { createServerClient, type CookieMethodsServer, type CookieOptionsWithName } from "@supabase/ssr";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { restOrigin, restRequestUrl, usesOwnPlatform } from "./config";
import { OwnSessionAuth, ownAdminAuth, restToken, type CookieAdapter, type RequestMeta } from "./auth";
import { ownStorage } from "./storage";

// One supabase-js client for both platforms. On Supabase nothing changes; on the own platform `from`/`rpc` go to the
// internal PostgREST with a token minted per request, `auth` and `storage` are lib/platform's.

type ServerOptions = { cookies: CookieMethodsServer; cookieOptions?: CookieOptionsWithName };

/** PostgREST behind supabase-js: `/rest/v1` is dropped, every request carries `token()`. */
function restClient(token: () => Promise<string>) {
  const origin = restOrigin();
  return createSupabaseClient(origin, "own-platform", {
    accessToken: token,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        if (input instanceof Request) return fetch(new Request(restRequestUrl(input.url, origin), input), init);
        return fetch(restRequestUrl(input.toString(), origin), init);
      },
    },
  });
}

function assemble(data: SupabaseClient, auth: unknown, storage: unknown) {
  return {
    from: data.from.bind(data),
    rpc: data.rpc.bind(data),
    schema: data.schema.bind(data),
    auth,
    storage,
  } as unknown as SupabaseClient;
}

/** The cookie-bound client of a request: the signed-in person's claims, or `anon`. */
export function createOwnServerClient(options: ServerOptions, meta: RequestMeta = {}) {
  const cookies: CookieAdapter = {
    getAll: async () => ((await options.cookies.getAll?.()) ?? []).map((cookie) => ({ name: cookie.name, value: cookie.value })),
    setAll: options.cookies.setAll
      ? (list) => options.cookies.setAll!(list.map((cookie) => ({ name: cookie.name, value: cookie.value, options: cookie.options })), {})
      : undefined,
  };
  const auth = new OwnSessionAuth(cookies, { domain: options.cookieOptions?.domain, secure: options.cookieOptions?.secure !== false }, meta);
  const claims = () => auth.currentClaims().catch(() => null);
  const data = restClient(async () => restToken(await claims()));
  const storage = ownStorage(async () => {
    const current = await claims();
    return current ? { role: "authenticated", claims: current } : { role: "anon", claims: null };
  });
  return assemble(data, auth, storage);
}

/** The service-role client (the secret key's counterpart): bypasses RLS, manages logins. */
export function createOwnAdminClient() {
  const data = restClient(async () => restToken(null, "service_role"));
  const storage = ownStorage(async () => ({ role: "service_role", claims: null }));
  return assemble(data, ownAdminAuth, storage);
}

/** `createServerClient` of @supabase/ssr, or its own-platform counterpart with the same options. */
export function createPlatformServerClient(url: string | undefined, key: string | undefined, options: ServerOptions, meta: RequestMeta = {}) {
  const supabase = () => createServerClient(url!, key!, options);
  if (usesOwnPlatform()) return createOwnServerClient(options, meta) as unknown as ReturnType<typeof supabase>;
  return supabase();
}

/** Client address and browser as Better Auth records them for a session. */
export function requestMeta(list: Pick<Headers, "get">): RequestMeta {
  const forwarded = list.get("x-forwarded-for")?.split(",")[0]?.trim();
  return { ip: list.get("cf-connecting-ip") ?? forwarded ?? null, userAgent: list.get("user-agent") };
}
