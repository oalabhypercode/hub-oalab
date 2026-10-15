import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import blueprint from "@/config/demo-accounts.json";
import { isDemoLoginAllowed, validateLocalDemoAccounts, type DemoLoginOption } from "@/lib/demo-login-policy";

const options: DemoLoginOption[] = blueprint.accounts.map((account) => ({ ...account, id: account.workspace ?? "admin" }));

async function loadLocalDemoAccounts(headers: Pick<Headers, "get">) {
  if (!isDemoLoginAllowed(headers, process.env.NODE_ENV, process.env.ENABLE_DEMO_LOGIN)) return [];
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
    if (url.origin !== `https://${blueprint.projectRef}.supabase.co`) return [];
    // Read only at request time, on the server. Explicitly excluded from build tracing.
    const content = await readFile(join(process.cwd(), ".demo-accounts.local.json"), "utf8");
    return validateLocalDemoAccounts(JSON.parse(content.replace(/^\uFEFF/, "")), options, blueprint.projectRef);
  } catch {
    // Missing/invalid local credentials disable the feature; never log their contents.
    return [];
  }
}

export async function getDemoLoginOptions(headers: Pick<Headers, "get">): Promise<DemoLoginOption[]> {
  const accounts = await loadLocalDemoAccounts(headers);
  return accounts.length === options.length ? options : [];
}

export async function getDemoLoginCredentials(headers: Pick<Headers, "get">, id: string) {
  return (await loadLocalDemoAccounts(headers)).find((account) => account.id === id);
}
