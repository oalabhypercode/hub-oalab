import { NextResponse, type NextRequest } from "next/server";
import { publicDemoSettings } from "@/lib/public-demo-session";
import { isPublicDemoPost, PUBLIC_DEMO_COOKIE } from "@/lib/public-demo-policy";

export async function POST(request: NextRequest) {
  if (!isPublicDemoPost(request, publicDemoSettings())) return new NextResponse(null, { status: 403 });
  const response = new NextResponse(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  response.cookies.set(PUBLIC_DEMO_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
