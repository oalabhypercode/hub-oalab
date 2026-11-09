import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = { title: "Anmelden" };

export default function Page() {
  return (
    <>
      {/* Fetched while the form is filled in: the small logo on the button and the greeting the hub opens with. */}
      <link rel="prefetch" href="/brand/oalab-loader-mini-white.webp" as="image" />
      <link rel="prefetch" href="/brand/oalab-greeting.webp" as="image" />
      <LoginForm />
    </>
  );
}
