import type { Metadata } from "next";
import { SignUpForm } from "@/components/sign-up-form";

export const metadata: Metadata = { title: "Konto erstellen" };

export default function Page() { return <SignUpForm />; }
