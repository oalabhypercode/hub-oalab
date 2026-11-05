import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { AuthForm } from "@/components/auth-form";
import { MiniLoader } from "@/components/brand-loader";
import { codeClock, maskEmail } from "@/lib/hub-auth/mail-code";
import { codeMethod, hasConfirmedApp, isFreelancerLogin, secondFactorMethod } from "@/lib/hub-auth/second-factor";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Sicherheitscode" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Reached with a password-only session of a login with a second factor, or from Service OALab for its team pages
// (lib/supabase/proxy.ts). Asks for the code of the login's method: the app's, or the e-mail's, saying whether one
// for this session is already on its way and from which mail (its time, 5.11.2026).
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
    ? await db.from("oalab_mail_codes").select("created_at, expires_at").eq("session_id", sessionId).gt("expires_at", new Date().toISOString()).lt("attempts", 5).maybeSingle<{ created_at: string; expires_at: string }>()
    : null;
  const times = open?.data ? { sentAt: codeClock(open.data.created_at), until: codeClock(open.data.expires_at) } : null;
  return <AuthForm mode="mfa" secondFactor={{ method, email: maskEmail(user?.email ?? ""), codeSent: method === "totp" || Boolean(open?.data), times, hubOnly: isFreelancerLogin(user?.app_metadata) }} />;
}

export default function Page({ searchParams }: PageProps) {
  return <Suspense fallback={<div className="auth-form auth-form-loading" role="status" aria-label="Wird geladen"><MiniLoader size={24} /></div>}><CodeStep searchParams={searchParams} /></Suspense>;
}
