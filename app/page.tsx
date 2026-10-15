import type { Metadata } from "next";
import { AuthFrame } from "@/components/auth-frame";
import LoginPage from "./auth/login/page";

export const metadata: Metadata = { title: { absolute: "Anmelden · oalab" } };

export default function Home(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <AuthFrame><LoginPage {...props} /></AuthFrame>;
}
