import "server-only";
import { lookup } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { checkPreviewUrl, isPrivateAddress, readPreview } from "./link-guard";

// The hub's server fetches a pasted address once (plan 6.3): only http and https on ports 80 and 443, never internal or
// private addresses – checked when the connection is made, so neither a redirect nor a DNS answer that changes in
// between reaches the inside. At most 1 MB in 5 seconds, without cookies or any data of the person. The preview image
// is stored downsized in the hub's own storage (lib/hub-notes/write.ts), so browsers never load from foreign servers.

const MAX_PAGE = 1024 * 1024;
const MAX_IMAGE = 3 * 1024 * 1024;
const TIMEOUT = 5000;
const REDIRECTS = 3;

/** Resolves like the system does, but refuses every private or internal address it gets. */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 4);
    const list = Array.isArray(addresses) ? addresses : [{ address: String(addresses), family: 4 }];
    const bad = list.find((entry) => isPrivateAddress(entry.address));
    if (bad || !list.length) return callback(Object.assign(new Error("PRIVATE_ADDRESS"), { code: "EPRIVATE" }), "", 4);
    if ((options as { all?: boolean }).all) return (callback as unknown as (error: null, addresses: typeof list) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

type Fetched = { status: number; type: string; body: Buffer; url: URL; truncated: boolean };
type Answer = { status: number; location: string | null; type: string; body: Buffer; truncated: boolean };

function getOnce(url: URL, limit: number, accept: string): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    // A hard limit for the whole answer, not only for silence: a server that drips its bytes is cut off too. The
    // timer starts right after the request below; these two only run later, from its events.
    const finish = (answer: Answer) => { clearTimeout(deadline); resolve(answer); };
    const fail = (error: unknown) => { clearTimeout(deadline); reject(error); };
    const req = send(url, {
      method: "GET",
      lookup: guardedLookup,
      timeout: TIMEOUT,
      headers: { "user-agent": "Mozilla/5.0 (compatible; oalab-hub-linkpreview/1.0)", accept, "accept-language": "de,en;q=0.8" },
    }, (res: IncomingMessage) => {
      const status = res.statusCode ?? 0;
      const location = typeof res.headers.location === "string" ? res.headers.location : null;
      const type = String(res.headers["content-type"] ?? "").toLowerCase();
      if (status >= 300 && status < 400) { res.resume(); finish({ status, location, type, body: Buffer.alloc(0), truncated: false }); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) { req.destroy(); finish({ status, location: null, type, body: Buffer.concat(chunks), truncated: true }); return; }
        chunks.push(chunk);
      });
      res.on("end", () => finish({ status, location: null, type, body: Buffer.concat(chunks), truncated: false }));
      res.on("error", fail);
    });
    const deadline = setTimeout(() => req.destroy(new Error("TIMEOUT")), TIMEOUT);
    req.on("timeout", () => req.destroy(new Error("TIMEOUT")));
    req.on("error", fail);
    req.end();
  });
}

/** GET with every redirect checked like the first address; null when it may not or could not be loaded. */
export async function guardedGet(address: string, limit: number, accept: string): Promise<Fetched | null> {
  let checked = checkPreviewUrl(address);
  const started = Date.now();
  for (let hop = 0; hop <= REDIRECTS && checked.ok; hop++) {
    if (Date.now() - started > TIMEOUT * 2) return null;
    const result = await getOnce(checked.url, limit, accept).catch(() => null);
    if (!result) return null;
    if (result.status >= 300 && result.status < 400 && result.location) {
      let next: string;
      try { next = new URL(result.location, checked.url).toString(); } catch { return null; }
      checked = checkPreviewUrl(next);
      continue;
    }
    return { status: result.status, type: result.type, body: result.body, url: checked.url, truncated: result.truncated };
  }
  return null;
}

export type FetchedPreview = { href: string; title: string; description: string; site: string; image: Buffer | null };

/** The preview of a page, with its image bytes when there is one; an error in words when the address may not be loaded. */
export async function fetchLinkPreview(address: string): Promise<{ ok: true; data: FetchedPreview } | { ok: false; error: string }> {
  const checked = checkPreviewUrl(address);
  if (!checked.ok) return checked;
  const page = await guardedGet(checked.url.toString(), MAX_PAGE, "text/html,application/xhtml+xml");
  if (!page || page.status >= 400) return { ok: false, error: "Die Seite ließ sich nicht laden. Der Link bleibt als Link im Text." };
  const html = /html|xml/.test(page.type) ? page.body.toString("utf8") : "";
  const found = readPreview(html, page.url);
  let image: Buffer | null = null;
  if (found.image) {
    const picture = await guardedGet(found.image, MAX_IMAGE, "image/*");
    // A picture over the limit is left out rather than cut: half an image is no preview.
    if (picture && picture.status < 400 && !picture.truncated && picture.type.startsWith("image/") && !picture.type.includes("svg")) image = picture.body;
  }
  return { ok: true, data: { href: checked.url.toString(), title: found.title, description: found.description, site: found.site, image } };
}
