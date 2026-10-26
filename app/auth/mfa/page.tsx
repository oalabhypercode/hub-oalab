import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { AuthForm } from "@/components/auth-form";
import { maskEmail } from "@/lib/hub-auth/mail-code";
import { codeMethod, hasConfirmedApp, secondFactorMethod } from "@/lib/hub-auth/second-factor";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Sicherheitscode" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Reached with a password-only session of a login with a second factor, or from Service OALab for its team pages
// (lib/supabase/proxy.ts). Asks for the code of the login's method: the app's, or the e-mail's, saying whether one
// for this session is already on its way.
async function CodeStep({ searchParams }: PageProps) {
  await connection();
  const raw = (await searchParams).next;
  const next = Array.isArray(raw) ? raw[0] : raw;
  const supabase = await createClient();
  const [{ data: claimData }, { data: userData }] = await Promise.all([supabase.auth.getClaims(), supabase.auth.getUser()]);
  const claims = claimData?.claims;
  const user = userData.user;
  const hasApp = hasConfirmedApp(user?.factors);
  const method = codeMethod(secondFactorMethod(user?.app_metadata, hasApp), hasApp, next);
  const sessionId = typeof claims?.session_id === "string" ? claims.session_id : null;
  const db = method === "email" ? createAdminClient() : null;
  const open = db && sessionId
    ? await db.from("oalab_mail_codes").select("session_id").eq("session_id", sessionId).gt("expires_at", new Date().toISOString()).lt("attempts", 5).maybeSingle()
    : null;
  return <AuthForm mode="mfa" secondFactor={{ method, email: maskEmail(user?.email ?? ""), codeSent: method === "totp" || Boolean(open?.data) }} />;
}

export default function Page({ searchParams }: PageProps) {
  return <Suspense fallback={<div className="auth-form" aria-busy="true" />}><CodeStep searchParams={searchParams} /></Suspense>;
}
