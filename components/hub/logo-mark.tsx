"use client";

import { useState, type CSSProperties } from "react";
import { DEFAULT_BRAND_COLOR, type CustomerLogo } from "@/lib/hub-logos/rules";

const tileColors = { light: "#ffffff", dark: "#1e191c" } as const;

/** The tile behind a logo: white, near-black or the brand colour, so that a white logo on a transparent ground stays visible. */
export const logoTileStyle = (logo: CustomerLogo) => ({ "--logo-bg": logo.background === "brand" ? logo.color ?? DEFAULT_BRAND_COLOR : tileColors[logo.background] }) as CSSProperties;

/** A logo until its image fails to load (a link that ran out, say); after that the initials come back. */
export function useShownLogo(logo: CustomerLogo | null | undefined) {
  const [failed, setFailed] = useState<string | null>(null);
  return { shown: logo && failed !== logo.url ? logo : null, onError: () => { if (logo) setFailed(logo.url); } };
}

export function LogoImage({ logo, onError }: { logo: CustomerLogo; onError: () => void }) {
  // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link from Supabase, nothing to optimise
  return <img src={logo.url} alt="" draggable={false} onError={onError} />;
}

/** A company's letters: the first letters of its first two words, "?" without any. */
export const companyInitials = (company: string) => company.replace(/[^\p{L}\s&-]/gu, "").split(/[\s&-]+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "?";

/**
 * A customer's logo on the same rounded square as the letters; without a logo the initials stay. As a plate (`plate`)
 * the height stays and the width follows the logo, so a wordmark stays readable (`.is-plate`, app/welcome-host.css).
 */
export function LogoMark({ logo, initials, className, plate = false }: { logo?: CustomerLogo | null; initials: string; className: string; plate?: boolean }) {
  const { shown, onError } = useShownLogo(logo);
  if (!shown) return <span className={className} aria-hidden="true">{initials}</span>;
  return <span className={`${className} has-logo${plate ? " is-plate" : ""}`} style={logoTileStyle(shown)} aria-hidden="true"><LogoImage logo={shown} onError={onError} /></span>;
}
