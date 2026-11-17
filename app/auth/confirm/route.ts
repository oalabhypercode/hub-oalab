import { createClient } from "@/lib/supabase/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { passwordLinkPage, safeAuthRedirect } from "@/lib/auth-redirect";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  // A password link only opens the page for the new password; „Passwort speichern“ redeems it there
  // (lib/hub-auth/actions.ts). Opening a link here used it up at once, also for mail scanners that check every link.
  const passwordPage = passwordLinkPage(type, token_hash);
  if (passwordPage) redirect(passwordPage);

  const next = safeAuthRedirect(searchParams.get("next") ?? "/dashboard");

  if (token_hash && type) {
    const supabase = await createClient();

    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });
    if (!error) {
      // redirect user to specified redirect URL or root of app
      redirect(next);
    } else {
      // redirect the user to an error page with some instructions
      redirect("/auth/error");
    }
  }

  // redirect the user to an error page with some instructions
  redirect("/auth/error");
}
