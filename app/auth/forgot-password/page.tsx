import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/forgot-password-form";

export const metadata: Metadata = { title: "Passwort zurücksetzen" };

export default function Page() { return <ForgotPasswordForm />; }
