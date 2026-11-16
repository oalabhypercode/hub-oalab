// oalab Client Hub: service worker of the installed web app (plan of 16.11.2026, stage 1).
//
// It keeps exactly one thing: the offline page with its logo. Every page comes from the network as before; only when
// the network fails does a page visit get the offline page. No data, pages or files are stored. These addresses are
// never touched and always go to the network: /api/* (calendar links, webhooks), /.well-known/*, /auth/* (sign-in)
// and /dashboard/settings/claude (approval of the Claude connector).
// Registered by components/hub/web-app.tsx; proxy.ts lets it through without a session, next.config.ts forbids caches.

const CACHE = "oalab-offline-v1";
const OFFLINE_PAGE = "/offline.html";
const OFFLINE_LOGO = "/app-icons/icon-192.png";
const NETWORK_ONLY = ["/api", "/.well-known", "/auth", "/dashboard/settings/claude"];

/** True for an address this worker leaves alone: the path itself or anything below it. */
function networkOnly(pathname) {
  return NETWORK_ONLY.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([OFFLINE_PAGE, OFFLINE_LOGO])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    // The page request starts while the worker wakes up, so pages open as fast as without it.
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || networkOnly(url.pathname)) return;
  if (url.pathname === OFFLINE_LOGO) {
    // From the network as always; the kept copy only when there is none.
    event.respondWith(fetch(request).catch(async () => (await caches.match(OFFLINE_LOGO)) || Response.error()));
    return;
  }
  if (request.mode !== "navigate") return;
  event.respondWith((async () => {
    try {
      const preloaded = await event.preloadResponse;
      return preloaded || await fetch(request);
    } catch {
      return (await caches.match(OFFLINE_PAGE)) || Response.error();
    }
  })());
});
