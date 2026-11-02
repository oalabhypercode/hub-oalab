"use client";

import type { CustomerLogo } from "@/lib/hub-logos/rules";
import { LogoMark } from "../logo-mark";

/** A company's sign: its logo if one is set, else its initials on a rounded square in one of eight colours, the same for a customer everywhere. */
const signColors = ["bordeaux", "blue", "green", "orange", "violet", "teal", "rose", "slate"];
export const signColor = (id: string) => signColors[Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % signColors.length];
export const companyInitials = (company: string) => company.replace(/[^\p{L}\s&-]/gu, "").split(/[\s&-]+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "?";

export type SignSize = "xs" | "sm" | "md" | "lg" | "xl";

export function CustomerSign({ customer, logo, size }: { customer: { id: string; company: string }; logo?: CustomerLogo | null; size?: SignSize }) {
  return <LogoMark logo={logo} initials={companyInitials(customer.company)} className={`chat-avatar am-avatar is-${signColor(customer.id)}${size ? ` is-${size}` : ""}`} />;
}
