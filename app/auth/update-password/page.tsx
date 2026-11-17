import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { MiniLoader } from "@/components/brand-loader";
import { LinkExpired } from "@/components/link-expired";
import { UpdatePasswordForm } from "@/components/update-password-form";
import { readLinkToken } from "@/lib/auth-redirect";
import { passwordLinkState } from "@/lib/hub-auth/recovery";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Neues Passwort" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// From a password link (app/auth/confirm) with its token, which stays unused until „Passwort speichern“: opening the
// page uses nothing up, so mail scanners and a closed tab leave the link intact. Without a token the signed-in login
// sets its password, e.g. after the code page of a login with an app. Either way the page names the login's address,
// so password managers save the new password under it.
async function NewPassword({ searchParams }: PageProps) {
  await connection();
  const token = readLinkToken((await searchParams).token_hash);
  if (!token) {
    const { data } = await (await createClient()).auth.getClaims();
    const email = data?.claims?.email;
    return <UpdatePasswordForm account={typeof email === "string" && email ? email : undefined} />;
  }
  const link = await passwordLinkState(token);
  if (!link.usable) return <LinkExpired />;
  return <UpdatePasswordForm linkToken={token} account={link.email ?? undefined} />;
}

export default function Page({ searchParams }: PageProps) {
  return <Suspense fallback={<div className="auth-form auth-form-loading" role="status" aria-label="Wird geladen"><MiniLoader size={24} /></div>}><NewPassword searchParams={searchParams} /></Suspense>;
}
