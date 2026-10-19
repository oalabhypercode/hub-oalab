"use client";

import Link from "next/link";
import { Loader2, LogOut, Search } from "lucide-react";
import { categories, categoryOrder } from "@/lib/categories";
import { hubHref, type HubSection } from "@/lib/hub-data";
import { useHubShell } from "./shell-context";
import { CategoryIcon, Chevron } from "./glass";
import { mainNavigation } from "./navigation";
import { BrandLogo } from "./wordmark";

type SidebarProps = {
  onSearch: () => void;
  preview: boolean;
  section: HubSection;
  counts: Record<"projects" | "files" | "messages", number>;
  name: string;
  company: string;
  accountLabel: string;
  initials: string;
};

/** Floating glass sidebar from 1024 px; below that the tab bar takes over its entries. */
export function GlassSidebar({ onSearch, preview, section, counts, name, company, accountLabel, initials }: SidebarProps) {
  const { signOut, signingOut, logoutError } = useHubShell();
  const item = (target: HubSection) => ({
    href: hubHref(preview, target),
    className: `sidebar-item${section === target ? " is-active" : ""}`,
    "aria-current": section === target ? ("page" as const) : undefined,
  });

  return (
    <aside className="glass glass-sidebar" aria-label="Hauptnavigation">
      <div className="sidebar-brand">
        <Link href={hubHref(preview)} className="sidebar-brand-link" aria-label="oalab Client Hub – Übersicht">
          <span className="brand-tile"><BrandLogo /></span>
          <span><strong>Client Hub</strong><span>oalab</span></span>
        </Link>
      </div>
      <button className="sidebar-search" onClick={onSearch}><Search size={16} aria-hidden="true" /><span>Suchen</span><kbd>⌘K</kbd></button>
      <nav className="sidebar-nav" aria-label="Bereiche">
        {mainNavigation.map(({ section: target, label, icon: Icon }) => (
          <Link key={target} {...item(target)}><Icon size={19} strokeWidth={2.2} className="sidebar-accent-icon" aria-hidden="true" /><span>{label}</span></Link>
        ))}
        <span className="sidebar-caption">Kategorien</span>
        {categoryOrder.map((id) => (
          <Link key={id} {...item(categories[id].section)}><CategoryIcon category={id} size={19} /><span>{categories[id].name}</span><span className="sidebar-count">{counts[id]}</span></Link>
        ))}
      </nav>
      <div className="sidebar-profile">
        <Link {...item("settings")} className={`sidebar-profile-link${section === "settings" ? " is-active" : ""}`}>
          <span className="avatar" aria-hidden="true">{initials}</span>
          <span className="sidebar-profile-text"><strong>{name}</strong><span>Profil & Darstellung · {company}</span></span>
          <Chevron size={16} />
        </Link>
        <button className="sidebar-logout" aria-label={preview ? "Vorschau verlassen" : "Abmelden"} title={preview ? "Zum Login" : `Abmelden (${accountLabel})`} onClick={signOut} disabled={signingOut}>{signingOut ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <LogOut size={18} aria-hidden="true" />}</button>
      </div>
      {logoutError && <p role="alert" className="form-error">{logoutError}</p>}
    </aside>
  );
}
