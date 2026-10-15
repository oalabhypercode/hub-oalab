import { headers } from "next/headers";
import { getDemoLoginOptions } from "@/lib/demo-login";
import { DemoAccountPicker } from "./demo-account-picker";

export async function DemoLoginPanel({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV !== "development" || process.env.ENABLE_DEMO_LOGIN === "false") return null;
  const accounts = await getDemoLoginOptions(await headers());
  if (!accounts.length) return null;
  const params = await searchParams;
  return <>{params.demo_error && <p className="form-error" role="alert">Die Demo-Anmeldung ist gerade nicht verfügbar. Bitte versuche es erneut oder nutze die reguläre Anmeldung.</p>}<DemoAccountPicker accounts={accounts} /></>;
}
