import type { Metadata } from "next";
import { AuthFrame } from "@/components/auth-frame";
import LoginPage from "./auth/login/page";

export const metadata: Metadata = { title: { absolute: "Anmelden · oalab" } };

export default function Home() {
  return <AuthFrame><LoginPage /></AuthFrame>;
}
