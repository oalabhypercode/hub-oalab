import { NextResponse, type NextRequest } from "next/server";
import { getDemoLoginCredentials } from "@/lib/demo-login";
import { isDemoLoginAllowed, isSameOriginDemoPost } from "@/lib/demo-login-policy";
import { parseDemoAccess } from "@/lib/demo-access";
import { createClient } from "@/lib/supabase/server";
import { publicDemoOptions, publicDemoSettings } from "@/lib/public-demo-session";
import { configuredPublicDemoOrigin, createPublicDemoToken, isPublicDemoHost, isPublicDemoPost, PUBLIC_DEMO_COOKIE, PUBLIC_DEMO_MAX_AGE, type PublicDemoAccountId } from "@/lib/public-demo-policy";

const privateHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

export async function POST(request: NextRequest) {
  const publicSettings = publicDemoSettings();
  if (isPublicDemoHost(request.headers, publicSettings)) {
    if (!isPublicDemoPost(request, publicSettings)) return new NextResponse(null, { status: 403, headers: privateHeaders });
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/x-www-form-urlencoded") return new NextResponse(null, { status: 415, headers: privateHeaders });
    try {
      const form = await request.formData();
      const id = form.get("account");
      const account = publicDemoOptions().find((item) => item.id === id);
      if (!account || form.getAll("account").length !== 1) return new NextResponse(null, { status: 400, headers: privateHeaders });
      const response = NextResponse.redirect(new URL("/dashboard", configuredPublicDemoOrigin(publicSettings)!), { status: 303, headers: privateHeaders });
      response.cookies.set(PUBLIC_DEMO_COOKIE, createPublicDemoToken(account.id as PublicDemoAccountId, publicSettings.secret!), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: PUBLIC_DEMO_MAX_AGE });
      return response;
    } catch { return new NextResponse(null, { status: 400, headers: privateHeaders }); }
  }
  if (!isDemoLoginAllowed(request.headers, process.env.NODE_ENV, process.env.ENABLE_DEMO_LOGIN)) {
    return new NextResponse(null, { status: 404, headers: privateHeaders });
  }
  if (!isSameOriginDemoPost(request)) return new NextResponse(null, { status: 403, headers: privateHeaders });
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) {
    return new NextResponse(null, { status: 415, headers: privateHeaders });
  }

  const origin = request.headers.get("origin")!;
  const failure = () => NextResponse.redirect(new URL("/auth/login?demo_error=unavailable", origin), { status: 303, headers: privateHeaders });
  try {
    const form = await request.formData();
    const id = form.get("account");
    if (typeof id !== "string" || form.getAll("account").length !== 1) return new NextResponse(null, { status: 400, headers: privateHeaders });
    const account = await getDemoLoginCredentials(request.headers, id);
    if (!account) return failure();

    const supabase = await createClient();
    // Only the selected account's existing password is used. No admin key or bypass.
    const { data, error } = await supabase.auth.signInWithPassword({ email: account.email, password: account.password });
    if (error || !data.user) return failure();
    // Auth's HTTPS response is authoritative; display/user_metadata never grants access.
    const access = parseDemoAccess(data.user.app_metadata);
    if (data.user.id !== account.userId || data.user.email !== account.email || access?.role !== account.role || access.workspace !== account.workspace) {
      await supabase.auth.signOut({ scope: "local" });
      return failure();
    }
  } catch {
    return failure();
  }
  // Native form navigation discards the previous account's client router state.
  return NextResponse.redirect(new URL("/dashboard", origin), { status: 303, headers: privateHeaders });
}
