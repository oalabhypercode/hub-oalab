"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Download, Smartphone, X } from "lucide-react";
import { hintHidden, INSTALL_HINT_HIDDEN, INSTALL_HINT_KEY, installPlatform, type InstallPlatform } from "@/lib/web-app/rules";
import { useInfo } from "./info-box";
import { ListRow, ListRowContent } from "./list";

/**
 * The hub as an installable web app (plan of 16.11.2026, stage 1): the service worker of the installed app, the hint
 * „Hub als App nutzen“ on the overview and the row „Als App installieren“ in Profil. iPhone and iPad install through
 * Safari's share menu, which no page can open: the hint explains the three steps. Chrome on Android offers its own
 * install dialog, which „Installieren“ opens.
 */

/** Chrome's install offer: kept for „Installieren“, good for one use. */
type InstallOffer = Event & { prompt: () => Promise<void> };

// Shared by the hint, the profile row and the shell. Chrome makes its offer once per page load, often before the overview
// is drawn; the shell imports this module on every hub page, so it is caught in time.
let offer: InstallOffer | null = null;
let installed = false;
let hidden: boolean | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const noSubscription = () => () => {};

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // The hint offers it instead of Chrome's own bar.
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

function readHidden() {
  if (hidden === null) {
    try { hidden = hintHidden(localStorage.getItem(INSTALL_HINT_KEY)); } catch { hidden = false; }
  }
  return hidden;
}

/** On the server and before hydration nothing shows; the browser then decides. */
function useInstallState() {
  const platform = useSyncExternalStore(noSubscription, detectPlatform, () => null);
  const currentOffer = useSyncExternalStore(subscribe, () => offer, () => null);
  const justInstalled = useSyncExternalStore(subscribe, () => installed, () => false);
  const hintIsHidden = useSyncExternalStore(subscribe, readHidden, () => true);
  return { platform: justInstalled ? null : platform, canInstall: currentOffer !== null, hintIsHidden };
}

async function install() {
  const current = offer;
  if (!current) return;
  offer = null;
  changed();
  // Accepted: `appinstalled` follows. Declined: Chrome may offer again on a later visit, until then the steps show.
  await current.prompt().catch(() => {});
}

function hideHint() {
  hidden = true;
  try { localStorage.setItem(INSTALL_HINT_KEY, INSTALL_HINT_HIDDEN); } catch { /* hidden until the next visit */ }
  changed();
}

/** The card „Kurz erklärt“ with the steps of the device; `trigger` is the button that opens it. */
function useInstallGuide(platform: InstallPlatform, trigger: { className: string; content: React.ReactNode }) {
  const ios = platform === "ios";
  return useInfo("Als App installieren", {
    steps: [
      ios ? <><b>Teilen öffnen:</b> in Safari über „…“ oder das Teilen-Symbol.</> : <><b>Menü öffnen:</b> in Chrome oben rechts auf ⋮ tippen.</>,
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

/** „Hub als App nutzen“ on the overview: phones and tablets in the browser, until it is tapped away on this device. */
export function InstallHint() {
  const { platform, canInstall, hintIsHidden } = useInstallState();
  return platform && !hintIsHidden ? <InstallHintBar platform={platform} canInstall={canInstall} /> : null;
}

function InstallHintBar({ platform, canInstall }: { platform: InstallPlatform; canInstall: boolean }) {
  const guide = useInstallGuide(platform, { className: "install-hint-link", content: "So geht’s" });
  return (
    <div className="glass install-hint" role="note">
      <span className="install-hint-text"><Smartphone size={15} aria-hidden="true" /><span>Hub als App nutzen <span className="install-hint-detail">– mit Icon auf dem {homeScreen(platform)}</span></span></span>
      <span className="install-hint-actions">
        {canInstall ? <button type="button" className="install-hint-link" onClick={install}><Download size={14} aria-hidden="true" />Installieren</button> : guide.button}
        <button type="button" className="install-hint-close" aria-label="Hinweis ausblenden" data-tip="Ausblenden" onClick={hideHint}><X size={15} aria-hidden="true" /></button>
      </span>
      {guide.box}
    </div>
  );
}

/** Profil › Einstellungen: the way in after the hint was tapped away; gone in the installed app and on computers. */
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
