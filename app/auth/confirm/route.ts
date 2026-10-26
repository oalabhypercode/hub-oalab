import { createClient } from "@/lib/supabase/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { safeAuthRedirect } from "@/lib/auth-redirect";
import { confirmRecoveryByMail } from "@/lib/hub-auth/recovery";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeAuthRedirect(searchParams.get("next") ?? (type === "recovery" ? "/auth/update-password" : "/dashboard"));

  if (token_hash && type) {
    const supabase = await createClient();

    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });
    if (!error) {
      // A password link counts as the e-mail code of logins that use it (lib/hub-auth/recovery.ts).
      if (type === "recovery" && await confirmRecoveryByMail(data.user, data.session)) await supabase.auth.refreshSession();
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
