import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "../utils";
import { getPublicDemoIdentity } from "@/lib/public-demo-session";
import { PUBLIC_DEMO_COOKIE } from "@/lib/public-demo-policy";
import { authCookieOptions, LEGACY_AUTH_COOKIE, requestHost } from "./cookies";
import { SECOND_FACTOR_PAGE, secondFactorPageRedirect, secondFactorRedirect, serviceOrigin, signedInRedirect } from "../auth-redirect";
import { hasConfirmedApp, secondFactorMethod, secondFactorPending } from "../hub-auth/second-factor";

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isPreview = pathname === "/preview" || pathname.startsWith("/preview/");
  // The WhatsApp webhook is called by Meta without a session; it checks Meta's signature itself.
  const isPublic = pathname === "/" || pathname === "/auth" || pathname.startsWith("/auth/") || isPreview || pathname === "/api/whatsapp";
  let supabaseResponse = NextResponse.next({ request });

  // The preview is an isolated, public UI with fictional fixtures only.
  if (isPreview) return supabaseResponse;

  // Public demo cookies grant access to fixture pages only, never Supabase data APIs.
  if ((pathname === "/dashboard" || pathname.startsWith("/dashboard/")) && getPublicDemoIdentity(request.cookies.get(PUBLIC_DEMO_COOKIE)?.value, request.headers)) return supabaseResponse;

  function withSessionCookies(response: NextResponse) {
    supabaseResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
    return response;
  }

  function loginRedirect() {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    url.search = "";
    if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
      url.searchParams.set("next", pathname + request.nextUrl.search);
    }
    return withSessionCookies(NextResponse.redirect(url));
  }

  // Missing configuration must never expose the authenticated workspace.
  if (!hasEnvVars) return isPublic ? supabaseResponse : loginRedirect();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: authCookieOptions(requestHost(request.headers)),
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
        },
      },
    },
  );

  // Keep the claims check immediately after client creation for session refresh.
  const { data, error } = await supabase.auth.getClaims();
  const claims = !error && data?.claims ? data.claims : null;
  const signedIn = claims !== null;
  const next = request.nextUrl.searchParams.get("next");
  // The cookie's copy of the factors, no network call: an aal1 session whose next level is aal2 has a confirmed app.
  const hasApp = claims !== null && claims.aal !== "aal2" && (await supabase.auth.mfa.getAuthenticatorAssuranceLevel()).data?.nextLevel === "aal2";
  // A login with a second factor first confirms its code; the pages themselves check it again (lib/hub-session.ts).
  const codePending = secondFactorPending(claims, hasApp);

  /**
   * The code page asks Supabase Auth itself whether the login has a second factor: the token's and the cookie's copies
   * may be up to an hour old. A session whose copies still say yes after the choice went off is renewed, or every page
   * would lead back.
   */
  const codePageState = async () => {
    if (!claims) return { signedIn: false, confirmed: false, wanted: false };
    if (claims.aal === "aal2") return { signedIn: true, confirmed: true, wanted: true };
    const { data: fresh } = await supabase.auth.getUser();
    const wanted = secondFactorMethod(fresh.user?.app_metadata, hasConfirmedApp(fresh.user?.factors)) !== null;
    if (!wanted && codePending) await supabase.auth.refreshSession();
    return { signedIn: true, confirmed: false, wanted };
  };

  // One login for Hub and Service: whoever arrives signed in (e.g. via „Zum Hub“) skips the login form.
  const landing = pathname === SECOND_FACTOR_PAGE ? secondFactorPageRedirect(await codePageState(), next, serviceOrigin())
    : codePending ? secondFactorRedirect(pathname, request.nextUrl.search, next, isPublic)
    : signedIn ? signedInRedirect(pathname, next) : null;
  const response = landing
    ? withSessionCookies(NextResponse.redirect(new URL(landing, request.url)))
    : !isPublic && !signedIn ? loginRedirect() : supabaseResponse;
  // Session cookies of the former Hub-only Supabase project: removed, never read.
  for (const cookie of request.cookies.getAll()) {
    if (LEGACY_AUTH_COOKIE.test(cookie.name)) response.cookies.set(cookie.name, "", { path: "/", maxAge: 0 });
  }
  return response;
}
