type HeaderReader = Pick<Headers, "get">;

export type DemoLoginOption = {
  id: string;
  email: string;
  name: string;
  role: string;
  workspace: string | null;
  company: string;
};
export type LocalDemoAccount = DemoLoginOption & { password: string; userId: string };

function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  try {
    const url = new URL(`http://${host}`);
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.host === host.toLowerCase();
  } catch {
    return false;
  }
}

/** No environment flag can enable this shortcut in a production build. */
export function isDemoLoginAllowed(headers: HeaderReader, environment: string | undefined, enabled: string | undefined): boolean {
  if (environment !== "development" || enabled === "false") return false;
  if (!isLoopbackHost(headers.get("host"))) return false;
  const forwarded = headers.get("x-forwarded-host");
  return !forwarded || isLoopbackHost(forwarded);
}

export function isSameOriginDemoPost(request: Request): boolean {
  if (request.method !== "POST") return false;
  const host = request.headers.get("host");
  if (!isLoopbackHost(host)) return false;
  // Next may normalize request.url to localhost even when the browser uses 127.0.0.1.
  const target = new URL(request.url);
  target.host = host!;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return origin === target.origin && (!fetchSite || fetchSite === "same-origin");
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Accept only the four provisioned accounts from the configured project. */
export function validateLocalDemoAccounts(value: unknown, expected: DemoLoginOption[], projectRef: string): LocalDemoAccount[] {
  if (!record(value) || value.projectRef !== projectRef || !Array.isArray(value.accounts) || value.accounts.length !== expected.length) return [];
  const localAccounts = value.accounts;
  const result: LocalDemoAccount[] = [];
  for (const account of expected) {
    const matches = localAccounts.filter((item) => record(item) && item.email === account.email);
    const local = matches[0];
    if (matches.length !== 1 || !record(local) || typeof local.password !== "string" || local.password.length < 16 ||
      typeof local.userId !== "string" || !local.userId || local.role !== account.role || local.workspace !== account.workspace) return [];
    result.push({ ...account, password: local.password, userId: local.userId });
  }
  return result;
}
