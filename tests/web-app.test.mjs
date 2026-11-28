import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { installPlatform, WEB_APP_COLOR, webAppManifest } from "../lib/web-app/rules.ts";

// The hub as an installable web app (plan of 16.11.2026, stage 1): manifest, icons, safe areas, offline page and the
// button „App installieren“ left of the bell. Push follows in stage 2.

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const png = async (path) => {
  const bytes = await readFile(new URL(`../public${path}`, import.meta.url));
  assert.equal(bytes.subarray(1, 4).toString(), "PNG", path);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] };
};

test("the manifest makes the hub installable, with the overview as start", async () => {
  const manifest = webAppManifest();
  assert.equal(manifest.short_name, "oalab Hub", "the name under the icon");
  assert.equal(manifest.name, "oalab Client Hub");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/dashboard");
  assert.equal(manifest.scope, "/", "sign-in stays inside the app window");
  assert.equal(manifest.lang, "de");
  assert.equal(manifest.background_color, WEB_APP_COLOR);
  assert.equal(manifest.theme_color, WEB_APP_COLOR);
  const purposes = manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose}`);
  assert.deepEqual(purposes, ["192x192 any", "512x512 any", "512x512 maskable"], "Chrome needs 192 and 512, Android a maskable one");
  for (const icon of manifest.icons) {
    const file = await png(icon.src);
    assert.equal(`${file.width}x${file.height}`, icon.sizes, icon.src);
  }
  for (const shortcut of manifest.shortcuts) assert.match(shortcut.url, /^\/dashboard\/(messages|files|projects\/calendar)$/);
  assert.match(await source("app/manifest.ts"), /return webAppManifest\(\);/);
});

test("the iPhone gets an icon edge to edge and the app's name and status bar", async () => {
  const apple = await png("/app-icons/apple-touch-icon.png");
  assert.deepEqual([apple.width, apple.height, apple.colorType], [180, 180, 2], "no transparency: the iPhone would fill it black");
  const layout = await source("app/layout.tsx");
  assert.match(layout, /apple: "\/app-icons\/apple-touch-icon\.png"/);
  assert.match(layout, /appleWebApp: \{ capable: true, title: "oalab Hub", statusBarStyle: "black-translucent" \}/);
  assert.match(layout, /export const viewport: Viewport = \{[^}]*viewportFit: "cover",[^}]*themeColor: WEB_APP_COLOR,/);
  assert.match(layout, /import "\.\/web-app\.css";/);
  const css = await source("app/web-app.css");
  assert.match(css, /\.hub-main \{ padding-top: calc\(20px \+ env\(safe-area-inset-top\)\); \}/, "the top row stays clear of the status bar");
  assert.match(css, /@media \(max-width: 767px\) \{\s*\.hub-main \{ padding-top: calc\(16px \+ env\(safe-area-inset-top\)\);/);
  assert.match(css, /\.auth-page \{ padding-top: calc\(20px \+ env\(safe-area-inset-top\)\);/, "sign-in too");
  assert.match(css, /body::before \{[^}]*height: env\(safe-area-inset-top\);/, "a strip keeps the clock readable over full-screen panels");
});

test("manifest, service worker and offline page pass without a session", async () => {
  const proxy = await source("proxy.ts");
  const literal = proxy.match(/^\s*"(\/\(\(\?![^"]+)",\r?$/m)[1];
  const matcher = new RegExp(`^${JSON.parse(`"${literal}"`)}$`);
  for (const path of ["/manifest.webmanifest", "/sw.js", "/offline.html", "/app-icons/icon-192.png", "/app-icons/apple-touch-icon.png"]) {
    assert.ok(!matcher.test(path), `${path} skips the session check`);
  }
  for (const path of ["/dashboard", "/dashboard/settings", "/auth/login", "/sw.jsx", "/dashboard/sw.js", "/api/calendar/x"]) {
    assert.ok(matcher.test(path), `${path} still goes through the session check`);
  }
  assert.match(await source("next.config.ts"), /source: "\/sw\.js", headers: \[\{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" \}\]/);
});

test("the service worker keeps only the offline page and leaves sign-in, APIs and Claude alone", async () => {
  const handlers = {};
  const stored = new Map([["/offline.html", "offline page"], ["/app-icons/icon-192.png", "kept logo"]]);
  let online = true;
  let precached = [];
  const self = {
    addEventListener: (type, handler) => { handlers[type] = handler; },
    location: { origin: "https://hub.example" },
    registration: { navigationPreload: { enable: async () => {} } },
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
  };
  vm.runInNewContext(await source("public/sw.js"), {
    self, URL,
    caches: { open: async () => ({ addAll: async (list) => { precached = list; } }), match: async (key) => stored.get(key), keys: async () => [], delete: async () => true },
    fetch: async () => { if (online) return "from the network"; throw new TypeError("Failed to fetch"); },
    Response: { error: () => "network error" },
  });
  let installing;
  handlers.install({ waitUntil: (promise) => { installing = promise; } });
  await installing;
  // The list comes from the worker's own realm: copied, so only its contents are compared.
  assert.deepEqual([...precached], ["/offline.html", "/app-icons/icon-192.png"], "nothing else is stored");

  const visit = (path, init = {}) => {
    let answer = null;
    handlers.fetch({
      request: { method: init.method ?? "GET", mode: init.mode ?? "navigate", url: `${init.origin ?? "https://hub.example"}${path}` },
      preloadResponse: Promise.resolve(undefined),
      respondWith: (value) => { answer = value; },
    });
    return answer;
  };
  assert.equal(await visit("/dashboard/files"), "from the network", "online, every page comes from the network");
  online = false;
  assert.equal(await visit("/dashboard/files"), "offline page", "offline, a page visit gets the offline page");
  assert.equal(await visit("/app-icons/icon-192.png", { mode: "no-cors" }), "kept logo", "the offline page shows its logo");
  for (const path of ["/api/calendar/abc", "/api/mcp", "/.well-known/oauth-authorization-server", "/auth/login", "/auth", "/dashboard/settings/claude", "/dashboard/settings/claude/approve"]) {
    assert.equal(visit(path), null, `${path} always goes to the network`);
  }
  assert.equal(visit("/dashboard", { method: "POST" }), null, "only page visits");
  assert.equal(visit("/_next/static/chunk.js", { mode: "no-cors" }), null, "scripts, data and Server Actions are not touched");
  assert.equal(visit("/dashboard", { origin: "https://service.example" }), null, "other sites are not touched");
  assert.equal(await visit("/dashboard/settings"), "offline page", "the profile itself is an ordinary page");

  const page = await source("public/offline.html");
  assert.match(page, /<html lang="de"/);
  assert.match(page, /Gerade bist du offline\./);
  assert.match(page, /addEventListener\("online"/, "it opens the page again once the network is back");
  assert.match(page, /fetch\("\/manifest\.webmanifest", \{ cache: "no-store" \}\)/, "and asks the hub itself, the browser's online flag can be wrong");
  assert.doesNotMatch(page, /(?:src|href)="https?:|@import|url\(\s*["']?https?:/, "it needs nothing from the network");
  assert.match(page, /<img src="\/app-icons\/icon-192\.png"/, "only the logo the worker keeps");
});

test("„App installieren“ sits left of the bell on phones and tablets in the browser", async () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
  const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
  const android = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
  const windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
  assert.equal(installPlatform({ userAgent: iphone, maxTouchPoints: 5, standalone: false }), "ios");
  assert.equal(installPlatform({ userAgent: ipad, maxTouchPoints: 5, standalone: false }), "ios", "iPadOS calls itself a Mac");
  assert.equal(installPlatform({ userAgent: ipad, maxTouchPoints: 0, standalone: false }), null, "a real Mac gets no hint");
  assert.equal(installPlatform({ userAgent: android, maxTouchPoints: 5, standalone: false }), "android");
  assert.equal(installPlatform({ userAgent: windows, maxTouchPoints: 0, standalone: false }), null);
  assert.equal(installPlatform({ userAgent: iphone, maxTouchPoints: 5, standalone: true }), null, "not in the installed app");

  const component = await source("components/hub/web-app.tsx");
  assert.match(component, /if \(process\.env\.NODE_ENV !== "production" \|\| !\("serviceWorker" in navigator\)\) return;/, "only the built hub registers the worker");
  assert.match(component, /register\("\/sw\.js", \{ scope: "\/", updateViaCache: "none" \}\)/);
  assert.match(component, /event\.preventDefault\(\);\s*offer = event as InstallOffer;/, "Chrome's offer waits for the button");
  assert.match(component, /canInstall \? <GlassButton icon=\{Download\} label="App installieren" onClick=\{install\} \/> : <InstallGuideButton platform=\{platform\} \/>/, "Android opens its dialog, else the steps");
  assert.match(component, /useInstallGuide\(platform, \{ className: "glass glass-float glass-button", label: "App installieren", content: <Download /, "the same round button as the bell");
  assert.doesNotMatch(component, /localStorage/, "nothing is stored on the device for it");
  // Wish of 16.11.2026: in the row of bell, assistant and profile, left of the bell, instead of a bar on the overview.
  const shell = await source("components/hub/app-shell.tsx");
  assert.match(shell, /return <>\s*\{\/\*[^*]*\*\/\}\s*<InstallButton \/>\s*<GlassButton icon=\{Bell\}/, "left of the bell");
  assert.match(shell, /<WebAppSetup \/>/);
  assert.doesNotMatch(await source("components/hub/screens/overview.tsx"), /Install/, "the overview keeps no bar");
  assert.doesNotMatch(await source("app/web-app.css"), /install-hint/);
  assert.match(await source("components/hub/screens/workspace.tsx"), /title="Darstellung"[^\n]*\/>\s*\{\/\*[^*]*\*\/\}\s*<InstallRow \/>/, "in Profil under Darstellung");
});
