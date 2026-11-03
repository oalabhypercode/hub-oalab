"use client";

import { useEffect } from "react";
import { clearGreeting } from "@/lib/greeting";

/** The greeting stays at least this long from its first paint: the logo has turned into place and the name was read. */
const MIN_SHOWN = 2000;
/** Fade from the greeting to the workspace (app/loader.css). */
const FADE = 420;

/**
 * The greeting after sign-in, over the hub while it loads. Hidden unless the pre-paint script (lib/greeting.ts) found the
 * login page's note; then it gives way once the page content (or its load error) is there, and the workspace fades in
 * with its waterfall, which waits behind the greeting (app/motion.css).
 */
export function HubGreeting() {
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.greeting !== "on") return;
    const shownAt = Number(root.dataset.greetingAt) || 0;
    let leave = 0;
    let clear = 0;
    const ready = () => Boolean(document.querySelector(".load-error") || (document.querySelector(".hub-content") && !document.querySelector(".hub-content > [role='status']")));
    const check = () => {
      if (leave || !ready()) return;
      observer.disconnect();
      leave = window.setTimeout(() => {
        if (root.dataset.greeting !== "on") return;
        root.dataset.greeting = "leaving";
        clear = window.setTimeout(() => clearGreeting(root), FADE);
      }, Math.max(0, shownAt + MIN_SHOWN - performance.now()));
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    check();
    return () => { observer.disconnect(); window.clearTimeout(leave); window.clearTimeout(clear); };
  }, []);

  return (
    <div className="hub-greeting" role="status">
      <span className="hub-greeting-mark" aria-hidden="true" />
      <p className="hub-greeting-text"><span className="hub-greeting-hello">Willkommen zurück</span><span className="hub-greeting-name" /></p>
    </div>
  );
}
