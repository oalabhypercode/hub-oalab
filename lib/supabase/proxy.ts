import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "../utils";
import { getPublicDemoIdentity } from "@/lib/public-demo-session";
import { PUBLIC_DEMO_COOKIE } from "@/lib/public-demo-policy";

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

  function loginRedirect() {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    url.search = "";
    if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
      url.searchParams.set("next", pathname + request.nextUrl.search);
    }
    const response = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
    return response;
  }

  // Missing configuration must never expose the authenticated workspace.
  if (!hasEnvVars) return isPublic ? supabaseResponse : loginRedirect();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
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
  if (!isPublic && (error || !data?.claims)) return loginRedirect();
  return supabaseResponse;
}
