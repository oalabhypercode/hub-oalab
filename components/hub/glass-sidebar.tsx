"use client";

import Link from "next/link";
import { Loader2, LogOut, Search, Settings } from "lucide-react";
import { categories, categoryOrder, type CategoryId } from "@/lib/categories";
import { hubHref, type HubSection } from "@/lib/hub-data";
import { servicePackages } from "@/lib/service-packages";
import { useHubShell } from "./shell-context";
import { CategoryIcon } from "./glass";
import { mainNavigation } from "./navigation";
import { BrandLogo } from "./wordmark";

type SidebarProps = {
  onSearch: () => void;
  preview: boolean;
  section: HubSection;
  /** Categories without a count (the calendar) show none. */
  counts: Partial<Record<CategoryId, number>>;
  name: string;
  accountLabel: string;
  initials: string;
};

/** Floating glass sidebar from 1024 px; below that the tab bar takes over its entries. */
export function GlassSidebar({ onSearch, preview, section, counts, name, accountLabel, initials }: SidebarProps) {
  const { signOut, signingOut, logoutError, account } = useHubShell();
  const activePackages = account.servicePackages.map((id) => servicePackages[id].name).join(", ");
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
          <Link key={id} {...item(categories[id].section)}><CategoryIcon category={id} size={19} /><span>{categories[id].name}</span>{counts[id] !== undefined && <span className="sidebar-count">{counts[id]}</span>}</Link>
        ))}
      </nav>
      <div className={`sidebar-profile${activePackages ? " has-package" : ""}`}>
        <Link {...item("settings")} className={`sidebar-profile-link${section === "settings" ? " is-active" : ""}`}>
          <span className="avatar" aria-hidden="true">{initials}</span>
          <span className="sidebar-profile-text">
            <strong>{name}</strong>
            {activePackages && <span className="sidebar-package" title={`Aktives Servicepaket: ${activePackages}`}><span className="visually-hidden">Aktives Servicepaket: </span>{activePackages}</span>}
          </span>
        </Link>
        {/* Standalone icon buttons on the name line; the package line runs underneath them. */}
        <div className="sidebar-profile-actions">
          <Link href={hubHref(preview, "settings")} className="sidebar-icon-button sidebar-settings-button" aria-label="Profil & Darstellung" title="Profil & Darstellung"><Settings size={18} strokeWidth={2.2} aria-hidden="true" /></Link>
          <button className="sidebar-icon-button" aria-label={preview ? "Vorschau verlassen" : "Abmelden"} title={preview ? "Zum Login" : `Abmelden (${accountLabel})`} onClick={signOut} disabled={signingOut}>{signingOut ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <LogOut size={18} aria-hidden="true" />}</button>
        </div>
      </div>
      {logoutError && <p role="alert" className="form-error">{logoutError}</p>}
    </aside>
  );
}
