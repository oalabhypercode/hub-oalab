"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Away at least this long (another tab, another app) before coming back reloads the page's data. */
const AWAY_MS = 3_000;
/** And not more often than this. */
const QUIET_MS = 10_000;

/**
 * Back on the page after a while away: it reads the newest state from the server (router.refresh), so a change made
 * meanwhile somewhere else, by a colleague, in Studio or by Claude, shows without reloading by hand. Coming back means
 * the tab becomes visible again or the window gets the focus back (Claude's app next to the browser). The page keeps
 * what is typed in its windows: only the data underneath is fresh. The task board polls on its own.
 */
export function useRefreshOnReturn(enabled: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    let awaySince = 0;
    let lastRefresh = Date.now();
    const away = () => {
      if (!awaySince) awaySince = Date.now();
    };
    const back = () => {
      if (document.visibilityState !== "visible" || !awaySince) return;
      const now = Date.now();
      const longEnough = now - awaySince >= AWAY_MS;
      awaySince = 0;
      if (!longEnough || now - lastRefresh < QUIET_MS) return;
      lastRefresh = now;
      router.refresh();
    };
    const onVisibility = () => (document.visibilityState === "hidden" ? away() : back());
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", away);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", away);
      window.removeEventListener("focus", back);
    };
  }, [enabled, router]);
}
