"use client";

import { useEffect } from "react";

/**
 * Liquid glass of the hub, once per page: the SVG filter that bends what lies under the glass's edge (Chrome and Edge;
 * Safari and Firefox show the same glass without it) and the light that follows the pointer over round glass buttons.
 */
export function LiquidGlassLayer() {
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch" || !(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLElement>(".lg, .sidebar-account-gear");
      if (!button) return;
      const rect = button.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      button.style.setProperty("--lg-x", `${(((event.clientX - rect.left) / rect.width) * 100).toFixed(1)}%`);
      button.style.setProperty("--lg-y", `${(((event.clientY - rect.top) / rect.height) * 100).toFixed(1)}%`);
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => document.removeEventListener("pointermove", onMove);
  }, []);
  return (
    <svg className="lg-defs" aria-hidden="true" focusable="false">
      <filter id="lg-warp" x="0%" y="0%" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.022 0.03" numOctaves={2} seed={4} result="noise" />
        <feGaussianBlur in="noise" stdDeviation={1.4} result="soft" />
        <feDisplacementMap in="SourceGraphic" in2="soft" scale={10} xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}
