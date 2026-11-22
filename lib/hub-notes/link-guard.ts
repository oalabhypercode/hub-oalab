/**
 * The rules of the link preview (plan 6.3), self-contained so tests check them directly: which addresses the hub's
 * server may fetch at all (http and https on ports 80 and 443, never internal or private networks) and what it reads
 * from a page (title, description, site name and preview image from the <head>).
 */

/** A dotted IPv4 address as four numbers, or null. */
function ipv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return numbers.every((value) => value >= 0 && value <= 255) ? numbers : null;
}

/** True for addresses the hub must never connect to: loopback, private, link-local, carrier NAT, multicast, reserved. */
export function isPrivateAddress(address: string): boolean {
  const raw = address.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = ipv4(raw);
  if (v4) {
    const [a, b] = v4;
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0)
      || (a === 198 && (b === 18 || b === 19));
  }
  if (!raw.includes(":")) return true;
  // IPv4 inside IPv6 (::ffff:10.0.0.1 or ::ffff:a00:1) counts as that IPv4 address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(raw);
  if (mapped) return isPrivateAddress(mapped[1]);
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(raw);
  if (hexMapped) {
    const high = parseInt(hexMapped[1], 16);
    const low = parseInt(hexMapped[2], 16);
    return isPrivateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  // Unspecified, loopback and the old IPv4-compatible form (::a.b.c.d).
  if (raw.startsWith("::")) return true;
  const [firstGroup = "", secondGroup = ""] = raw.split(":");
  const first = parseInt(firstGroup || "0", 16);
  const second = parseInt(secondGroup || "0", 16);
  if (!Number.isFinite(first)) return true;
  // Only global unicast (2000::/3) is public; everything else (unique local, link-local, multicast, NAT64) stays out,
  // and so do the documentation range and the tunnels that carry an IPv4 address inside (6to4, Teredo).
  if (first < 0x2000 || first > 0x3fff) return true;
  return first === 0x2002 || (first === 0x2001 && (second === 0 || second === 0x0db8));
}

/** The address as the fetch may use it, or why not: only http(s), only ports 80 and 443, no user names, no IP tricks. */
export function checkPreviewUrl(value: unknown): { ok: true; url: URL } | { ok: false; error: string } {
  if (typeof value !== "string" || value.length > 2048) return { ok: false, error: "Diese Adresse ist ungültig." };
  let url: URL;
  try { url = new URL(value.trim()); } catch { return { ok: false, error: "Diese Adresse ist ungültig." }; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "Vorschau gibt es nur für Webseiten (https)." };
  if (url.username || url.password) return { ok: false, error: "Adressen mit Zugangsdaten lädt der Hub nicht." };
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (port !== 443 && port !== 80) return { ok: false, error: "Der Hub lädt nur Seiten auf den üblichen Ports." };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return { ok: false, error: "Interne Adressen lädt der Hub nicht." };
  if ((ipv4(host) || host.includes(":")) && isPrivateAddress(host)) return { ok: false, error: "Interne Adressen lädt der Hub nicht." };
  // Numbers without dots (http://2130706433) or with fewer parts are IP addresses in disguise.
  if (/^[0-9.]+$/.test(host) && !ipv4(host)) return { ok: false, error: "Diese Adresse ist ungültig." };
  if (/^0x/i.test(host)) return { ok: false, error: "Diese Adresse ist ungültig." };
  return { ok: true, url };
}

const decodeEntities = (text: string) => text
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
  .replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const tidy = (text: string, max: number) => decodeEntities(text).replace(/\s+/g, " ").trim().slice(0, max);

/** Title, description, site name and image of a page, from its <head> (Open Graph first, then the plain tags). */
export function readPreview(html: string, base: URL): { title: string; description: string; site: string; image: string | null } {
  const head = html.slice(0, 400_000);
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((match) => match[0]);
  const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)?.slice(2).find((part) => part !== undefined) ?? "";
  const meta = (...keys: string[]) => {
    for (const key of keys) {
      const tag = metas.find((item) => [attr(item, "property"), attr(item, "name")].some((value) => value.toLowerCase() === key));
      if (tag) { const content = attr(tag, "content"); if (content) return content; }
    }
    return "";
  };
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? "";
  const imageRaw = meta("og:image:secure_url", "og:image", "twitter:image");
  let image: string | null = null;
  if (imageRaw) {
    try {
      const resolved = new URL(decodeEntities(imageRaw), base);
      if (resolved.protocol === "https:" || resolved.protocol === "http:") image = resolved.toString();
    } catch { image = null; }
  }
  return {
    title: tidy(meta("og:title", "twitter:title") || titleTag, 300) || base.hostname.replace(/^www\./, ""),
    description: tidy(meta("og:description", "description", "twitter:description"), 600),
    site: tidy(meta("og:site_name"), 120) || base.hostname.replace(/^www\./, ""),
    image,
  };
}
