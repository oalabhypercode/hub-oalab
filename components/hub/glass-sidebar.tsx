"use client";

import { Fragment, useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Building2, ChevronLeft, KeyRound, LogOut, NotebookPen, Palette, ScrollText, Search, Settings, SquareKanban, UserCog, UserRound } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { categories, categoriesFor, categoryLabel, projectsHref, type CategoryId } from "@/lib/categories";
import { appearanceHref, hubHref, sectionLabel, sectionLabels, type HubSection } from "@/lib/hub-data";
import { LEGAL_PATHS } from "@/lib/legal-links";
import { packageCatalog } from "@/lib/service-packages";
import type { CustomerLogo } from "@/lib/hub-logos/rules";
import { useAppearance } from "./appearance-provider";
import { GlassLayers } from "./glass";
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

/** What a plain count in the sidebar counts, for the hint of the collapsed sidebar („3 Projekte“). */
const countNouns: Partial<Record<CategoryId, string>> = { projects: "Projekte", files: "Dateien" };

/**
 * Hint and droplet of an entry (22.11.2026): collapsed to its symbols, the sidebar names each entry in a hint to the
 * right of it (only then: data-tip-compact waits for the hidden label), and the glass droplet glides to every entry
 * marked as a target.
 */
const navTip = (label: string, sub?: string) => ({
  "data-tip-compact": label,
  "data-tip-side": "right",
  "data-drop-target": "",
  ...(sub ? { "data-tip-sub": sub } : {}),
});

const dropTarget = (node: EventTarget | null) => (node instanceof Element ? node.closest<HTMLElement>("[data-drop-target]") : null);

/**
 * Floating glass sidebar from 1024 px; below that the tab bar takes over its entries. Since 22.11.2026 it collapses to
 * its symbols with the round handle on its edge or ⌘ . (Strg + .), remembered per device in the appearance store; a glass
 * droplet glides over the entry under the pointer (app/sidebar.css).
 */
export function GlassSidebar({ onSearch, preview, section, counts, name, accountLabel, initials, logo, pendingRegistrations }: SidebarProps) {
  const { signOut, signingOut, logoutError, account, manageUsers } = useHubShell();
  const { appearance, update } = useAppearance();
  const collapsed = appearance.sidebar === "collapsed";
  const activePackages = account.packages.map((id) => packageCatalog[id].short).join(" · ");
  // Under the name: the packages in short, for the oalab team its name.
  const meta = activePackages || (account.admin ? "oalab-Team" : account.freelancer ? "Freelancer" : "");
  const [menuOpen, setMenuOpen] = useState(false);
  // „Aufgaben“ (the task board) and „Kalender“ hang under Projekte; on them, Projekte shows as their parent. Freelancers
  // reach their board through Projekte as well (16.11.2026), and since 18.11.2026 their calendar hangs there too.
  const pathname = usePathname() ?? "";
  const onTasks = /\/projects\/tasks\/?$/.test(pathname);
  // „Notizen“ (22.11.2026) hangs under Projekte as well, for everybody.
  const onNotes = /\/projects\/notes\/?$/.test(pathname);
  const onCalendar = section === "calendar";
  const CalendarIcon = categories.calendar.icon;
  const corner = useRef<HTMLDivElement>(null);
  const gear = useRef<HTMLButtonElement>(null);
  const bar = useRef<HTMLElement>(null);
  const drop = useRef<{ target: HTMLElement | null; y: number }>({ target: null, y: 0 });
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

  // The droplet: one piece of glass that the pointer (or the keyboard focus) moves from entry to entry. Its place and
  // size go straight into CSS variables of the sidebar, so moving it renders nothing in React.
  const dropOff = useCallback(() => {
    if (bar.current) bar.current.dataset.drop = "off";
    drop.current.target = null;
  }, []);
  const dropTo = useCallback((target: HTMLElement, pointerX?: number) => {
    const sidebar = bar.current;
    if (!sidebar) return;
    const box = target.getBoundingClientRect();
    const frame = sidebar.getBoundingClientRect();
    const y = box.top - frame.top - sidebar.clientTop;
    if (drop.current.target !== target) {
      const style = sidebar.style;
      style.setProperty("--drop-x", `${box.left - frame.left - sidebar.clientLeft}px`);
      style.setProperty("--drop-y", `${y}px`);
      style.setProperty("--drop-w", `${box.width}px`);
      style.setProperty("--drop-h", `${box.height}px`);
      sidebar.dataset.drop = drop.current.target ? (y >= drop.current.y ? "down" : "up") : "in";
      sidebar.dataset.pulse = sidebar.dataset.pulse === "a" ? "b" : "a";
      drop.current = { target, y };
    }
    if (pointerX !== undefined && box.width) sidebar.style.setProperty("--drop-light", `${(((pointerX - box.left) / box.width) * 100).toFixed(1)}%`);
  }, []);
  const toggle = useCallback(() => {
    dropOff();
    setMenuOpen(false);
    update({ sidebar: collapsed ? "expanded" : "collapsed" });
  }, [collapsed, dropOff, update]);
  // ⌘ . (Strg + .) folds the sidebar in and out wherever the focus is; below 1024 px there is no sidebar to fold.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key !== ".") return;
      if (!window.matchMedia("(min-width: 1024px)").matches) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const item = (target: HubSection) => ({
    href: hubHref(preview, target),
    className: `sidebar-item${section === target ? " is-active" : ""}`,
    "aria-current": section === target ? ("page" as const) : undefined,
    ...navTip(sectionLabel(target, account.admin || account.freelancer)),
  });
  const toggleLabel = collapsed ? "Sidebar ausklappen" : "Sidebar einklappen";

  return (
    <aside
      id="hub-sidebar"
      ref={bar}
      className="glass glass-sidebar"
      aria-label="Hauptnavigation"
      data-drop="off"
      onPointerMove={(event) => {
        if (event.pointerType === "touch") return;
        const target = dropTarget(event.target);
        if (target) dropTo(target, event.clientX);
        else dropOff();
      }}
      onPointerLeave={dropOff}
      onFocus={(event) => {
        const target = dropTarget(event.target);
        if (target && event.target instanceof Element && event.target.matches(":focus-visible")) dropTo(target);
      }}
      onBlur={(event) => { if (!bar.current?.contains(event.relatedTarget as Node | null)) dropOff(); }}
    >
      <div className="sidebar-brand">
        <Link href={hubHref(preview)} className="sidebar-brand-link" aria-label="oalab Client Hub – Übersicht">
          <span className="brand-tile"><BrandLogo /></span>
          <span className="sidebar-brand-text"><strong>oalab</strong><span>Client Hub</span></span>
        </Link>
      </div>
      {/* The handle on the edge (wish of 22.11.2026): between the search and the entries, so the logo keeps its space. */}
      <button type="button" className="lg sidebar-toggle" onClick={toggle} aria-controls="hub-sidebar" aria-expanded={!collapsed} aria-label={toggleLabel} data-tip={toggleLabel} data-tip-kbd="⌘ ." data-tip-side="right" data-tip-always="">
        <GlassLayers />
        <ChevronLeft size={15} strokeWidth={2.4} aria-hidden="true" />
      </button>
      <button className="sidebar-search" onClick={onSearch} {...navTip("Suchen")} data-tip-kbd="⌘K"><Search size={16} aria-hidden="true" /><span data-tip-label="">Suchen</span><kbd>⌘K</kbd></button>
      <nav className="sidebar-nav" aria-label="Bereiche" onScroll={dropOff}>
        {mainNavigation.map(({ section: target, label, icon: Icon }) => (
          <Link key={target} {...item(target)}><Icon size={19} strokeWidth={2.2} className="sidebar-accent-icon" aria-hidden="true" /><span data-tip-label="">{label}</span></Link>
        ))}
        <span className="sidebar-caption">Bereiche</span>
        {/* All navigation icons share the accent colour; the category colours stay on the pages themselves. */}
        {categoriesFor(account.freelancer).filter((id) => id !== "calendar").map((id) => {
          const Icon = categories[id].icon;
          const props = item(categories[id].section);
          const parent = id === "projects" && (onTasks || onCalendar || onNotes);
          const href = id === "projects" ? projectsHref(props.href, account.freelancer) : props.href;
          const counted = id === "messages" ? (counts.messages ? `${counts.messages} ungelesen` : undefined) : counts[id] !== undefined && countNouns[id] ? `${counts[id]} ${countNouns[id]}` : undefined;
          const link = <Link key={id} {...props} href={href} className={parent ? "sidebar-item is-parent" : props.className} aria-current={parent ? undefined : props["aria-current"]} data-tip-sub={counted}><Icon size={19} strokeWidth={2.2} className="sidebar-accent-icon" aria-hidden="true" /><span data-tip-label="">{categoryLabel(id, account.admin || account.freelancer)}</span>{id === "messages" ? Boolean(counts.messages) && <span className="sidebar-count sidebar-count-alert" data-tip={`${counts.messages} ungelesen`}><span className="visually-hidden">Ungelesen: </span>{counts.messages}</span> : counts[id] !== undefined && <span className="sidebar-count">{counts[id]}</span>}</Link>;
          // Freelancers' „Kunden“ (18.11.2026) stands where everybody else has „Vertrag & Domain“: below the files.
          if (id === "files" && account.freelancer) {
            return (
              <Fragment key={id}>
                {link}
                <Link {...item("customers")}><Building2 size={19} strokeWidth={2.2} className="sidebar-accent-icon" aria-hidden="true" /><span data-tip-label="">{sectionLabels.customers}</span></Link>
              </Fragment>
            );
          }
          if (id !== "projects") return link;
          return (
            <Fragment key={id}>
              {link}
              {/* The design preview shows the board with examples, so its sidebar carries the entry as well. Sub-entries
                  stand a little to the right with a line to Projekte, also in the collapsed sidebar (22.11.2026). */}
              {(manageUsers || preview || account.freelancer) && (
                <Link href={`${hubHref(preview, "projects")}/tasks`} className={`sidebar-item sidebar-sub${onTasks ? " is-active" : ""}`} aria-current={onTasks ? "page" : undefined} {...navTip("Aufgaben", "Unter Projekte")}>
                  <span className="sidebar-line" aria-hidden="true" /><SquareKanban size={17} strokeWidth={2.2} className="sidebar-accent-icon" aria-hidden="true" /><span data-tip-label="">Aufgaben</span>
                </Link>
              )}
              <Link href={hubHref(preview, "calendar")} className={`sidebar-item sidebar-sub${onCalendar ? " is-active" : ""}`} aria-current={onCalendar ? "page" : undefined} {...navTip(categories.calendar.name, "Unter Projekte")}>
                <span className="sidebar-line" aria-hidden="true" /><CalendarIcon size={17} strokeWidth={2.2} className="sidebar-accent-icon" aria-hidden="true" /><span data-tip-label="">{categories.calendar.name}</span>
              </Link>
              <Link href={`${hubHref(preview, "projects")}/notes`} className={`sidebar-item sidebar-sub${onNotes ? " is-active" : ""}`} aria-current={onNotes ? "page" : undefined} {...navTip("Notizen", "Unter Projekte")}>
                <span className="sidebar-line" aria-hidden="true" /><NotebookPen size={17} strokeWidth={2.2} className="sidebar-accent-icon" aria-hidden="true" /><span data-tip-label="">Notizen</span>
              </Link>
            </Fragment>
          );
        })}
        {manageUsers && <>
          <span className="sidebar-caption">Verwaltung</span>
          <Link {...item("users")} data-tip-sub={pendingRegistrations > 0 ? `${pendingRegistrations} offene Registrierung${pendingRegistrations === 1 ? "" : "en"}` : undefined}>
            <UserCog size={19} strokeWidth={2.2} className="sidebar-accent-icon" aria-hidden="true" /><span data-tip-label="">{sectionLabels.users}</span>
            {pendingRegistrations > 0 && <span className="sidebar-count sidebar-count-alert" data-tip={`${pendingRegistrations} offene Registrierung${pendingRegistrations === 1 ? "" : "en"}`}><span className="visually-hidden">Offene Registrierungen: </span>{pendingRegistrations}</span>}
          </Link>
          <Link {...item("ai-log")}>
            <Bot size={19} strokeWidth={2.2} className="sidebar-accent-icon" aria-hidden="true" /><span data-tip-label="">{sectionLabels["ai-log"]}</span>
          </Link>
          <Link {...item("keychain")}>
            <KeyRound size={19} strokeWidth={2.2} className="sidebar-accent-icon" aria-hidden="true" /><span data-tip-label="">{sectionLabels.keychain}</span>
          </Link>
        </>}
        {/* Admins keep the patch notes with the administration; customers have no "Verwaltung", so theirs get a caption of their own. */}
        {!manageUsers && <span className="sidebar-caption">Neuigkeiten</span>}
        <Link {...item("patch-notes")}>
          <ScrollText size={19} strokeWidth={2.2} className="sidebar-accent-icon" aria-hidden="true" /><span data-tip-label="">{sectionLabels["patch-notes"]}</span>
        </Link>
      </nav>
      {/* Sign, name and below it a dot with the package; apart from them one gear with Profil, Darstellung and Abmelden.
          Collapsed, the sign alone opens that menu, beside the sidebar. */}
      <div className="sidebar-account" ref={corner}>
        <Link {...item("settings")} className={`sidebar-account-link${section === "settings" ? " is-active" : ""}`} data-tip-compact={name || "Profil"} data-tip-sub={meta || undefined}
          aria-haspopup={collapsed ? "menu" : undefined} aria-expanded={collapsed ? menuOpen : undefined}
          onClick={(event) => { if (!collapsed) return; event.preventDefault(); setMenuOpen((open) => !open); }}>
          <LogoMark logo={logo} initials={initials} className="avatar" />
          <span className="sidebar-account-text" data-tip-label="">
            {/* Blank while the loading shell waits for the login. */}
            <strong>{name || <span className="skeleton-bar sidebar-name-skeleton" aria-hidden="true" />}</strong>
            {meta && <span className="sidebar-account-meta" data-tip={activePackages ? `Pakete: ${account.packages.map((id) => packageCatalog[id].name).join(", ")}` : undefined}><i aria-hidden="true" /><span>{activePackages && <span className="visually-hidden">Pakete: </span>}{meta}</span></span>}
          </span>
        </Link>
        <button ref={gear} type="button" className="sidebar-account-gear" aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuId} aria-label={`Konto: Profil, Darstellung, ${preview ? "Vorschau verlassen" : "Abmelden"}, Impressum und Datenschutz`} data-tip="Konto" onClick={() => setMenuOpen((open) => !open)}>
          <GlassLayers />
          {signingOut ? <MiniLoader size={18} /> : <Settings size={18} strokeWidth={2.2} aria-hidden="true" />}
        </button>
        {menuOpen && (
          <div id={menuId} className="sidebar-account-menu" role="menu" aria-label="Konto">
            <div className="sidebar-account-who" aria-hidden="true"><strong>{name}</strong>{meta && <span>{meta}</span>}</div>
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
      {/* The glass droplet over the entry under the pointer (styles in app/sidebar.css). */}
      <span className="sidebar-drop" aria-hidden="true"><span className="sidebar-drop-body"><span className="lg-fx" /><span className="lg-shine" /><span className="lg-rim" /></span></span>
    </aside>
  );
}
