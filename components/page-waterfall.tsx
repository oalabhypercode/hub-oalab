"use client";

import { useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const WATERFALL = "waterfall-in";

/**
 * The waterfall fade-in (app/motion.css) is pure CSS and runs on the server HTML without JavaScript.
 * This only marks <html> as settled once a page's cascade has played, so elements that appear later on
 * the same page (favourites in edit mode, upload lists, error messages) show up without it.
 * Each navigation arms the cascade again for the next page.
 */
export function PageWaterfall() {
  const pathname = usePathname();
  const lastPathname = useRef<string | null>(null);

  useLayoutEffect(() => {
    const root = document.documentElement;
    // The first page keeps no attribute, so its auth intro can join the cascade (see app/motion.css).
    if (lastPathname.current !== null && lastPathname.current !== pathname) root.dataset.waterfall = "armed";
    lastPathname.current = pathname;

    // Settles when the last block has faded in, or on the first interaction if the cascade finished before
    // hydration. Never while the page is still showing its loading skeleton.
    const settle = (event: Event) => {
      if (root.dataset.waterfall === "settled" || (event instanceof AnimationEvent && event.animationName !== WATERFALL)) return;
      const cascading = document.getAnimations().some((animation) => animation instanceof CSSAnimation && animation.animationName === WATERFALL);
      if (!cascading && !document.querySelector(".hub-content > [role='status']")) root.dataset.waterfall = "settled";
    };
    const events = ["animationend", "pointerdown", "keydown"];
    for (const type of events) document.addEventListener(type, settle, true);
    return () => { for (const type of events) document.removeEventListener(type, settle, true); };
  }, [pathname]);

  return null;
}
