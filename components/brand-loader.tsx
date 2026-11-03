import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/*
 * The oalab logo as loading animation, cut from the brand video with a real alpha channel (public/brand/oalab-loader*).
 * Styles in app/loader.css; app/motion.css shows the resting logo for "Bewegung reduzieren".
 */

/** A page or section that is still loading: the turning logo in the free space, after a short pause so quick loads don't flash. */
export function BrandLoader({ label = "Wird geladen", className }: { label?: string; className?: string }) {
  return <div role="status" aria-label={label} className={cn("brand-loader", className)}><span className="brand-loader-mark" aria-hidden="true" /></div>;
}

/** The small turning logo where a button or a line waits, as tall as the icon it stands in for; white on filled buttons. */
export function MiniLoader({ size = 18 }: { size?: number }) {
  return <span className="mini-loader" style={{ "--mini": `${size}px` } as CSSProperties} aria-hidden="true" />;
}
