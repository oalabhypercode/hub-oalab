import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Sicherheitscode" };

// Reached only with a password-only session of a login that has an authenticator app (lib/supabase/proxy.ts).
export default function Page() { return <AuthForm mode="mfa" />; }
