"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Download, Smartphone } from "lucide-react";
import { installPlatform, type InstallPlatform } from "@/lib/web-app/rules";
import { GlassButton } from "./glass";
import { useInfo } from "./info-box";
import { ListRow, ListRowContent } from "./list";

/**
 * The hub as an installable web app (plan of 16.11.2026, stage 1): the service worker of the installed app, the button
 * „App installieren“ left of the bell and the row „Als App installieren“ in Profil. iPhone and iPad install through
 * the browser's share menu, which no page can open: the button explains the three steps. Chrome on Android offers its
 * own install dialog, which the button opens.
 */

/** Chrome's install offer: kept for the button, good for one use. */
type InstallOffer = Event & { prompt: () => Promise<void> };

// Shared by the button, the profile row and the shell. Chrome makes its offer once per page load, often before the
// header is drawn; the shell imports this module on every hub page, so it is caught in time.
let offer: InstallOffer | null = null;
let installed = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const noSubscription = () => () => {};

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // The button offers it instead of Chrome's own bar.
    event.preventDefault();
    offer = event as InstallOffer;
    changed();
  });
  window.addEventListener("appinstalled", () => { offer = null; installed = true; changed(); });
}

function detectPlatform() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return installPlatform({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints, standalone });
}

/** On the server and before hydration nothing shows; the browser then decides. */
function useInstallState() {
  const platform = useSyncExternalStore(noSubscription, detectPlatform, () => null);
  const currentOffer = useSyncExternalStore(subscribe, () => offer, () => null);
  const justInstalled = useSyncExternalStore(subscribe, () => installed, () => false);
  return { platform: justInstalled ? null : platform, canInstall: currentOffer !== null };
}

async function install() {
  const current = offer;
  if (!current) return;
  offer = null;
  changed();
  // Accepted: `appinstalled` follows. Declined: Chrome may offer again on a later visit, until then the steps show.
  await current.prompt().catch(() => {});
}

/** The card „Kurz erklärt“ with the steps of the device; `trigger` is the button that opens it. */
function useInstallGuide(platform: InstallPlatform, trigger: { className: string; content: React.ReactNode; label?: string }) {
  const ios = platform === "ios";
  return useInfo("Als App installieren", {
    steps: [
      ios ? <><b>Teilen öffnen:</b> Teilen-Symbol tippen, in Safari unter „…“.</> : <><b>Menü öffnen:</b> in Chrome oben rechts auf ⋮ tippen.</>,
      ios ? <><b>„Zum Home-Bildschirm“</b> wählen, eventuell weiter unten.</> : <><b>„App installieren“</b> oder „Zum Startbildschirm“ wählen.</>,
      ios ? <><b>„Als Web-App öffnen“</b> anlassen und „Hinzufügen“ tippen.</> : <><b>Bestätigen,</b> schon liegt das Icon auf dem Startbildschirm.</>,
    ],
    warn: ios ? "Falls nötig, in der App einmal anmelden." : undefined,
    ask: "Wie installiere ich den Hub als App auf meinem Handy?",
  }, trigger);
}

const homeScreen = (platform: InstallPlatform) => platform === "ios" ? "Home-Bildschirm" : "Startbildschirm";

/** In the shell of every hub page: registers the service worker of the installed app, only in the built hub. */
export function WebAppSetup() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => { /* the hub works without it */ });
  }, []);
  return null;
}

/**
 * „App installieren“ left of the bell (HeaderActions, wish of 16.11.2026): phones and tablets in the browser, for every
 * role; gone in the installed app and on computers. Android with Chrome's offer opens its dialog, else the steps.
 */
export function InstallButton() {
  const { platform, canInstall } = useInstallState();
  if (!platform) return null;
  return canInstall ? <GlassButton icon={Download} label="App installieren" onClick={install} /> : <InstallGuideButton platform={platform} />;
}

function InstallGuideButton({ platform }: { platform: InstallPlatform }) {
  const guide = useInstallGuide(platform, { className: "glass glass-float glass-button", label: "App installieren", content: <Download size={20} strokeWidth={2} aria-hidden="true" /> });
  return <>{guide.button}{guide.box}</>;
}

/** Profil › Einstellungen: the same way in, with words; gone in the installed app and on computers. */
export function InstallRow() {
  const { platform, canInstall } = useInstallState();
  if (!platform) return null;
  const row = { icon: <Smartphone size={24} color="var(--system-gray)" aria-hidden="true" />, title: "Als App installieren", subtitle: `Icon auf dem ${homeScreen(platform)}, ohne Browserleiste` };
  return canInstall ? <ListRow compact onClick={install} {...row} /> : <InstallGuideRow platform={platform} row={row} />;
}

function InstallGuideRow({ platform, row }: { platform: InstallPlatform; row: React.ComponentProps<typeof ListRowContent> }) {
  const guide = useInstallGuide(platform, { className: "list-row list-row-compact has-icon", content: <ListRowContent {...row} /> });
  return <li className="list-item is-compact has-icon">{guide.button}{guide.box}</li>;
}
