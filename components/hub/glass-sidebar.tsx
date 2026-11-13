"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Bot, KeyRound, LogOut, Palette, ScrollText, Search, Settings, UserCog, UserRound } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { categories, categoriesFor, categoryLabel, type CategoryId } from "@/lib/categories";
import { appearanceHref, hubHref, sectionLabels, type HubSection } from "@/lib/hub-data";
import { LEGAL_PATHS } from "@/lib/legal-links";
import { packageCatalog } from "@/lib/service-packages";
import type { CustomerLogo } from "@/lib/hub-logos/rules";
import { LogoMark } from "./logo-mark";
import { useHubShell } from "./shell-context";
import { mainNavigation } from "./navigation";
import { BrandLogo } from "./wordmark";

type SidebarProps = {
  onSearch: () => void;
  preview: boolean;
  section: HubSection;
  /** Categories without a count (the calendar) show none; Nachrichten counts only unread conversations. */
  counts: Partial<Record<CategoryId, number>>;
  name: string;
  /** The first line of the account menu: the login's e-mail, or that this is the preview. */
  accountLabel: string;
  initials: string;
  /** Customer logins: their company's logo instead of the initials. */
  logo: CustomerLogo | null;
  /** Admins: registrations waiting for approval. */
  pendingRegistrations: number;
};

/** Floating glass sidebar from 1024 px; below that the tab bar takes over its entries. */
export function GlassSidebar({ onSearch, preview, section, counts, name, accountLabel, initials, logo, pendingRegistrations }: SidebarProps) {
  const { signOut, signingOut, logoutError, account, manageUsers } = useHubShell();
  const activePackages = account.packages.map((id) => packageCatalog[id].short).join(" · ");
  // Under the name: the packages in short, for the oalab team its name.
  const meta = activePackages || (account.admin ? "oalab-Team" : account.freelancer ? "Freelancer" : "");
  const [menuOpen, setMenuOpen] = useState(false);
  const corner = useRef<HTMLDivElement>(null);
  const gear = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!menuOpen) return;
    corner.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointer = (event: PointerEvent) => { if (!corner.current?.contains(event.target as Node)) setMenuOpen(false); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMenuOpen(false); gear.current?.focus(); return; }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = Array.from(corner.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
      const index = items.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [menuOpen]);
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
          <span><strong>oalab</strong><span>Client Hub</span></span>
        </Link>
      </div>
      <button className="sidebar-search" onClick={onSearch}><Search size={16} aria-hidden="true" /><span>Suchen</span><kbd>⌘K</kbd></button>
      <nav className="sidebar-nav" aria-label="Bereiche">
        {mainNavigation.map(({ section: target, label, icon: Icon }) => (
          <Link key={target} {...item(target)}><Icon size={19} strokeWidth={2.2} className="sidebar-accent-icon" aria-hidden="true" /><span>{label}</span></Link>
        ))}
        <span className="sidebar-caption">Bereiche</span>
        {/* All navigation icons share the accent colour; the category colours stay on the pages themselves. */}
        {categoriesFor(account.freelancer).map((id) => {
          const Icon = categories[id].icon;
          return <Link key={id} {...item(categories[id].section)}><Icon size={19} strokeWidth={2.2} className="sidebar-accent-icon" aria-hidden="true" /><span>{categoryLabel(id, account.admin || account.freelancer)}</span>{id === "messages" ? Boolean(counts.messages) && <span className="sidebar-count sidebar-count-alert" data-tip={`${counts.messages} ungelesen`}><span className="visually-hidden">Ungelesen: </span>{counts.messages}</span> : counts[id] !== undefined && <span className="sidebar-count">{counts[id]}</span>}</Link>;
        })}
        {manageUsers && <>
          <span className="sidebar-caption">Verwaltung</span>
          <Link {...item("users")}>
            <UserCog size={19} strokeWidth={2.2} className="sidebar-accent-icon" aria-hidden="true" /><span>{sectionLabels.users}</span>
            {pendingRegistrations > 0 && <span className="sidebar-count sidebar-count-alert" data-tip={`${pendingRegistrations} offene Registrierung${pendingRegistrations === 1 ? "" : "en"}`}><span className="visually-hidden">Offene Registrierungen: </span>{pendingRegistrations}</span>}
          </Link>
          <Link {...item("ai-log")}>
            <Bot size={19} strokeWidth={2.2} className="sidebar-accent-icon" aria-hidden="true" /><span>{sectionLabels["ai-log"]}</span>
          </Link>
          <Link {...item("keychain")}>
            <KeyRound size={19} strokeWidth={2.2} className="sidebar-accent-icon" aria-hidden="true" /><span>{sectionLabels.keychain}</span>
          </Link>
        </>}
        {/* Admins keep the patch notes with the administration; customers have no "Verwaltung", so theirs get a caption of their own. */}
        {!manageUsers && <span className="sidebar-caption">Neuigkeiten</span>}
        <Link {...item("patch-notes")}>
          <ScrollText size={19} strokeWidth={2.2} className="sidebar-accent-icon" aria-hidden="true" /><span>{sectionLabels["patch-notes"]}</span>
        </Link>
      </nav>
      {/* Sign, name and below it a dot with the package; apart from them one gear with Profil, Darstellung and Abmelden. */}
      <div className="sidebar-account" ref={corner}>
        <Link {...item("settings")} className={`sidebar-account-link${section === "settings" ? " is-active" : ""}`}>
          <LogoMark logo={logo} initials={initials} className="avatar" />
          <span className="sidebar-account-text">
            {/* Blank while the loading shell waits for the login. */}
            <strong>{name || <span className="skeleton-bar sidebar-name-skeleton" aria-hidden="true" />}</strong>
            {meta && <span className="sidebar-account-meta" data-tip={activePackages ? `Pakete: ${account.packages.map((id) => packageCatalog[id].name).join(", ")}` : undefined}><i aria-hidden="true" /><span>{activePackages && <span className="visually-hidden">Pakete: </span>}{meta}</span></span>}
          </span>
        </Link>
        <button ref={gear} type="button" className="sidebar-account-gear" aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuId} aria-label={`Konto: Profil, Darstellung, ${preview ? "Vorschau verlassen" : "Abmelden"}, Impressum und Datenschutz`} data-tip="Konto" onClick={() => setMenuOpen((open) => !open)}>
          {signingOut ? <MiniLoader size={18} /> : <Settings size={18} strokeWidth={2.2} aria-hidden="true" />}
        </button>
        {menuOpen && (
          <div id={menuId} className="sidebar-account-menu" role="menu" aria-label="Konto">
            <small>{accountLabel}</small>
            <Link role="menuitem" href={hubHref(preview, "settings")} onClick={() => setMenuOpen(false)}><UserRound size={18} aria-hidden="true" />Profil</Link>
            <Link role="menuitem" href={appearanceHref(preview)} onClick={() => setMenuOpen(false)}><Palette size={18} aria-hidden="true" />Darstellung</Link>
            <hr />
            <button type="button" role="menuitem" className="is-danger" onClick={() => { setMenuOpen(false); signOut(); }} disabled={signingOut}><LogOut size={18} aria-hidden="true" />{preview ? "Vorschau verlassen" : "Abmelden"}</button>
            {/* Imprint and privacy policy two clicks from every hub page (§ 5 DDG, Art. 13 DSGVO). */}
            <div className="sidebar-account-legal">
              <Link role="menuitem" href={LEGAL_PATHS.imprint} onClick={() => setMenuOpen(false)}>Impressum</Link>
              <span aria-hidden="true">·</span>
              <Link role="menuitem" href={LEGAL_PATHS.privacy} onClick={() => setMenuOpen(false)}>Datenschutz</Link>
            </div>
          </div>
        )}
      </div>
      {logoutError && <p role="alert" className="form-error">{logoutError}</p>}
    </aside>
  );
}
