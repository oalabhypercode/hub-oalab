import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { AuthForm } from "@/components/auth-form";
import { maskEmail } from "@/lib/hub-auth/mail-code";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Sicherheitscode" };

// Reached with a password-only session of a login with the e-mail code, or from Service OALab for its team pages
// (lib/supabase/proxy.ts). Says whether a code for this session is on its way; the form sends and checks codes.
async function CodeStep() {
  await connection();
  const { data } = await (await createClient()).auth.getClaims();
  const claims = data?.claims;
  const sessionId = typeof claims?.session_id === "string" ? claims.session_id : null;
  const db = createAdminClient();
  const open = db && sessionId
    ? await db.from("oalab_mail_codes").select("session_id").eq("session_id", sessionId).gt("expires_at", new Date().toISOString()).lt("attempts", 5).maybeSingle()
    : null;
  return <AuthForm mode="mfa" secondFactor={{ email: maskEmail(typeof claims?.email === "string" ? claims.email : ""), codeSent: Boolean(open?.data) }} />;
}

export default function Page() {
  return <Suspense fallback={<div className="auth-form" aria-busy="true" />}><CodeStep /></Suspense>;
}
