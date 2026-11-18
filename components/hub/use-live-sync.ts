"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** How often an open, visible tab asks whether something is new (stage 1 of „Echtzeit“, 18.11.2026). */
export const LIVE_POLL_MS = 15_000;
/** Coming back to the tab asks at once, but not more often than this. */
const RETURN_GAP_MS = 3_000;

/** Someone is typing in a field: the page waits until they leave it, so nothing typed is touched. */
function typing() {
  const active = document.activeElement as HTMLElement | null;
  return Boolean(active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)));
}

/**
 * Keeps an open tab up to date without reloading by hand: every 15 seconds while the tab is visible, and at once when
 * it comes back, it asks the server for the version of the bell (app/api/live). Is it another one than the page shows
 * (`version`, built from the page's own data with the same rule), the page reads itself anew (router.refresh): the
 * bell rings, counts and lists show the news. What is typed in windows stays; while someone types in a field, the
 * refresh waits for them to leave it. A version the page could not catch up with is not chased twice.
 */
export function useLiveSync(enabled: boolean, version: string) {
  const router = useRouter();
  const shown = useRef(version);
  useEffect(() => {
    shown.current = version;
  }, [version]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let asking = false;
    let lastAsk = 0;
    let waiting: string | null = null;
    let refreshedFor: string | null = null;

    const apply = () => {
      if (stopped || waiting === null || typing()) return;
      // Another tab or the page itself may already have caught up.
      if (waiting === shown.current || waiting === refreshedFor) { waiting = null; return; }
      refreshedFor = waiting;
      waiting = null;
      router.refresh();
    };
    const ask = async () => {
      if (stopped || asking || document.visibilityState !== "visible") return;
      asking = true;
      lastAsk = Date.now();
      try {
        const response = await fetch("/api/live", { cache: "no-store", headers: { accept: "application/json" } });
        // Signed out or waiting for the code: the proxy answers with a page, not with a version.
        if (!response.ok || !(response.headers.get("content-type") ?? "").includes("application/json")) return;
        const { version: current } = (await response.json()) as { version?: unknown };
        if (typeof current === "string" && current !== shown.current) waiting = current;
      } catch {
        // No connection: the next look tries again.
      } finally {
        asking = false;
      }
      apply();
    };
    const back = () => {
      if (document.visibilityState === "visible" && Date.now() - lastAsk >= RETURN_GAP_MS) void ask();
    };
    const timer = window.setInterval(() => (waiting !== null ? apply() : void ask()), LIVE_POLL_MS);
    // Leaving a field lets a waiting refresh through.
    const left = () => window.setTimeout(apply, 400);
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    document.addEventListener("focusout", left);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
      document.removeEventListener("focusout", left);
    };
  }, [enabled, router]);
}
