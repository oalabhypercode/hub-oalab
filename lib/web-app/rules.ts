import type { MetadataRoute } from "next";

/**
 * The hub as an installable web app (plan of 16.11.2026, stage 1). Self-contained (type imports only), so
 * `node --test` checks the rules directly; app/manifest.ts serves the manifest, components/hub/web-app.tsx reads the
 * browser.
 */

/** The hub's default background (Darstellung): start screen, status bar and theme colour of the installed app. */
export const WEB_APP_COLOR = "#3A0624";

/** The installed app: icon on the home screen, full screen, the overview as start. Served at /manifest.webmanifest. */
export function webAppManifest(): MetadataRoute.Manifest {
  const icon = (size: number, purpose: "any" | "maskable" = "any") => ({
    src: `/app-icons/icon-${purpose === "maskable" ? "maskable-" : ""}${size}.png`, sizes: `${size}x${size}`, type: "image/png", purpose,
  });
  const shortcut = (name: string, url: string) => ({ name, url, icons: [{ src: "/app-icons/icon-192.png", sizes: "192x192", type: "image/png" }] });
  return {
    id: "/dashboard",
    name: "oalab Client Hub",
    short_name: "oalab Hub",
    description: "Projekte, Dateien, Termine und Nachrichten mit oalab an einem Ort.",
    lang: "de",
    dir: "ltr",
    start_url: "/dashboard",
    // The whole hub, sign-in included, stays inside the app window.
    scope: "/",
    display: "standalone",
    // The hub's own background: no white flash while the app starts.
    background_color: WEB_APP_COLOR,
    theme_color: WEB_APP_COLOR,
    categories: ["business", "productivity"],
    icons: [icon(192), icon(512), icon(512, "maskable")],
    // Android: a long press on the icon jumps straight there.
    shortcuts: [shortcut("Nachrichten", "/dashboard/messages"), shortcut("Dateien", "/dashboard/files"), shortcut("Kalender", "/dashboard/projects/calendar")],
  };
}

export type InstallPlatform = "ios" | "android";

/**
 * Where „App installieren“ makes sense: iPhone and iPad (Teilen › „Zum Home-Bildschirm“) or Android, and only in the
 * browser, not in the installed app. Computers get none: their browsers show an install symbol of their own.
 */
export function installPlatform(device: { userAgent: string; maxTouchPoints: number; standalone: boolean }): InstallPlatform | null {
  if (device.standalone) return null;
  // iPadOS reports itself as a Mac; the touch screen gives it away.
  if (/iPhone|iPad|iPod/.test(device.userAgent) || (/Macintosh/.test(device.userAgent) && device.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(device.userAgent)) return "android";
  return null;
}
