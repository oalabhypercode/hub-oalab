import { createHmac, timingSafeEqual } from "node:crypto";

export const publicDemoAccountIds = ["admin", "nordlicht", "formfeld", "horizont"] as const;
export type PublicDemoAccountId = (typeof publicDemoAccountIds)[number];
export const PUBLIC_DEMO_COOKIE = "__Host-oalab-demo";
export const PUBLIC_DEMO_MAX_AGE = 12 * 60 * 60;
export type PublicDemoSettings = { enabled?: string; origin?: string; secret?: string };

export function configuredPublicDemoOrigin(settings: PublicDemoSettings): string | null {
  if (settings.enabled !== "true" || !settings.secret || settings.secret.length < 32 || !settings.origin) return null;
  try {
    const url = new URL(settings.origin);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.hostname.includes("*") || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return null;
    return url.origin;
  } catch { return null; }
}

export function isPublicDemoHost(headers: Pick<Headers, "get">, settings: PublicDemoSettings): boolean {
  const origin = configuredPublicDemoOrigin(settings);
  if (!origin) return false;
  const host = new URL(origin).host;
  const forwarded = headers.get("x-forwarded-host");
  return headers.get("host")?.toLowerCase() === host && (!forwarded || forwarded.toLowerCase() === host);
}

export function isPublicDemoPost(request: Request, settings: PublicDemoSettings): boolean {
  const site = request.headers.get("sec-fetch-site");
  return request.method === "POST" && isPublicDemoHost(request.headers, settings) && request.headers.get("origin") === configuredPublicDemoOrigin(settings) && (!site || site === "same-origin");
}

export function createPublicDemoToken(id: PublicDemoAccountId, secret: string, now = Date.now()): string {
  if (!publicDemoAccountIds.includes(id) || secret.length < 32) throw new Error("Invalid demo configuration");
  const iat = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, id, iat, exp: iat + PUBLIC_DEMO_MAX_AGE })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function parsePublicDemoToken(token: string | undefined, secret: string, now = Date.now()): PublicDemoAccountId | null {
  if (!token || token.length > 512 || secret.length < 32) return null;
  try {
    const [payload, signature, extra] = token.split(".");
    if (extra !== undefined || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return null;
    const expected = createHmac("sha256", secret).update(payload).digest();
    const supplied = Buffer.from(signature, "base64url");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const time = Math.floor(now / 1000);
    if (value.v !== 1 || !publicDemoAccountIds.includes(value.id) || !Number.isInteger(value.iat) || !Number.isInteger(value.exp) || value.iat > time + 30 || value.exp <= time || value.exp - value.iat !== PUBLIC_DEMO_MAX_AGE) return null;
    return value.id;
  } catch { return null; }
}
