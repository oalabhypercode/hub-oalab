import { headers } from "next/headers";
import { getDemoLoginOptions } from "@/lib/demo-login";
import { DemoAccountPicker } from "./demo-account-picker";
import { publicDemoConfigured, publicDemoOptions, publicDemoSettings } from "@/lib/public-demo-session";
import { isPublicDemoHost } from "@/lib/public-demo-policy";

export async function DemoLoginPanel({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV !== "development" && !publicDemoConfigured()) return null;
  const requestHeaders = await headers();
  const publicDemo = isPublicDemoHost(requestHeaders, publicDemoSettings());
  const accounts = publicDemo ? publicDemoOptions() : await getDemoLoginOptions(requestHeaders);
  if (!accounts.length) return null;
  const params = await searchParams;
  return <>{params.demo_error && <p className="form-error" role="alert">Die Demo-Anmeldung ist gerade nicht verfügbar. Bitte versuche es erneut oder nutze die reguläre Anmeldung.</p>}<DemoAccountPicker accounts={accounts} publicDemo={publicDemo} /></>;
}
