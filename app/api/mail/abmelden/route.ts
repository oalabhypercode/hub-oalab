import { NextResponse, type NextRequest } from "next/server";
import { OPT_OUT_PATHS } from "@/lib/hub-mail/opt-out";
import { setInfoMails } from "@/lib/hub-mail/opt-out-server";
import { siteOrigin } from "@/lib/site-origin";

// One-click unsubscribe (RFC 8058): Gmail, Outlook and Apple Mail post `List-Unsubscribe=One-Click` here when someone
// taps their own „Abbestellen“ next to the sender (List-Unsubscribe header of every info mail, lib/hub-mail/smtp.ts).
// Without a session: the signed link stands for one login (lib/hub-mail/opt-out.ts).

const plain = (text: string, status: number) => new NextResponse(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function POST(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const saved = await setInfoMails(query.get("u"), query.get("sig"), false);
  return saved ? plain("Abgemeldet: Du bekommst keine Infomails mehr.", 200) : plain("Dieser Link ist ungültig.", 400);
}

/** Opened in a browser instead: the page, which asks before it changes anything. */
export function GET(request: NextRequest) {
  const origin = siteOrigin(request.headers) ?? "https://hub.oalab.de";
  return NextResponse.redirect(new URL(`${OPT_OUT_PATHS.page}${request.nextUrl.search}`, origin), 303);
}
