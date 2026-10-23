import "server-only";

/**
 * The hub's public address for links in mails and activation links: NEXT_PUBLIC_SITE_URL when set (recommended
 * in production), otherwise the host of the current request. Null when neither looks like a host.
 */
export function siteOrigin(list: Pick<Headers, "get">) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (configured && /^https?:\/\/[^/\s]+$/i.test(configured)) return configured;
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "";
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return null;
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
  const proto = list.get("x-forwarded-proto") === "http" || local ? "http" : "https";
  return `${proto}://${host}`;
}
