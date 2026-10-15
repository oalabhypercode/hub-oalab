"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Bell, Check, CircleHelp, Command, Files, FolderOpen, LayoutGrid, Loader2, LogOut, Menu, MessageSquare, Search, Settings2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { hubHref, previewProjects, sectionLabels, type HubSection, type HubDemoData } from "@/lib/hub-data";
import { Modal } from "./modal";
import { Wordmark } from "./wordmark";

const navigation = [
  { section: "overview", icon: LayoutGrid },
  { section: "projects", icon: FolderOpen },
  { section: "files", icon: Files },
  { section: "messages", icon: MessageSquare },
] as const;

export function HubShell({ children, preview = false, email = "", demoData }: { children: React.ReactNode; preview?: boolean; email?: string; demoData?: HubDemoData }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<"search" | "notifications" | "help" | null>(null);
  const [query, setQuery] = useState("");
  const [read, setRead] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const active = pathname.split("/")[2] as HubSection | undefined;
  const section = active && active in sectionLabels ? active : "overview";
  const name = preview ? "Jana Sommer" : demoData?.name || email.split("@")[0] || "Dein Konto";
  const availableProjects = preview ? previewProjects : demoData?.projects || [];
  const hasDemo = preview || Boolean(demoData);
  const accountLabel = preview ? "Designvorschau" : demoData ? (demoData.role === "oalab_admin" ? "OALAB Admin · Demo" : "OALAB Customer · Demo") : "Angemeldet";
  const initials = preview ? "JS" : name.slice(0, 2).toUpperCase();

  useEffect(() => {
    if (!menuOpen) return;
    const trigger = menuTrigger.current;
    sidebar.current?.querySelector<HTMLElement>("a, button")?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [menuOpen]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPanel((value) => value === "search" ? null : "search");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  async function signOut() {
    if (preview) { router.push("/auth/login"); return; }
    setSigningOut(true);
    setLogoutError("");
    try {
      const { error } = await createClient().auth.signOut();
      if (error) throw error;
      // Cross the auth boundary with a fresh document, not preserved Activity state.
      window.location.replace("/auth/login");
    } catch {
      setLogoutError("Abmelden nicht möglich. Bitte versuche es erneut.");
      setSigningOut(false);
    }
  }

  return (
    <div className="hub-app">
      <a className="skip-link" href="#main-content">Zum Inhalt springen</a>
      {menuOpen && <button className="sidebar-backdrop" onClick={() => setMenuOpen(false)} aria-label="Navigation schließen" />}
      <aside ref={sidebar} className={`hub-sidebar${menuOpen ? " is-open" : ""}`} aria-label="Hauptnavigation">
        <div className="sidebar-brand"><Wordmark href={hubHref(preview)} /><button className="icon-button mobile-close" onClick={() => setMenuOpen(false)} aria-label="Navigation schließen"><X size={21} /></button></div>
        <div className="sidebar-workspace"><span className="workspace-icon">{preview ? "n" : demoData ? demoData.company.charAt(0).toLowerCase() : "w"}<span>↗</span></span><div><strong>{preview ? "Nordlicht Studio" : demoData?.company || "Dein Workspace"}</strong><span>Client Hub</span></div><span className="workspace-status" title={accountLabel} /></div>
        <span className="nav-caption">WORKSPACE</span>
        <nav className="primary-nav">
          {navigation.map(({ section: item, icon: Icon }, index) => (
            <Link key={item} href={hubHref(preview, item)} onClick={() => setMenuOpen(false)} className={`nav-item${section === item ? " active" : ""}`} aria-current={section === item ? "page" : undefined}>
              <Icon size={18} strokeWidth={1.65} /><span>{sectionLabels[item]}</span><span className="nav-index">0{index + 1}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-secondary"><Link href={hubHref(preview, "settings")} className={`nav-item${section === "settings" ? " active" : ""}`} aria-current={section === "settings" ? "page" : undefined} onClick={() => setMenuOpen(false)}><Settings2 size={18} strokeWidth={1.65} /><span>Einstellungen</span></Link><button className="nav-item" onClick={() => { setPanel("help"); setMenuOpen(false); }}><CircleHelp size={18} strokeWidth={1.65} /><span>Hilfe & Kontakt</span><ArrowUpRight size={15} /></button></div>
        <div className="sidebar-bottom"><div className="support-note"><span className="tiny-label">GEMEINSAM WEITER.</span><p>Eine Frage?<br />Wir sind für dich da.</p><button onClick={() => setPanel("help")} className="text-action">Lass uns sprechen <ArrowUpRight size={17} /></button><span className="support-spark" aria-hidden="true">✳</span></div><div className="sidebar-user"><span className="avatar">{initials}</span><div><strong>{name}</strong><span>{accountLabel}</span></div><button className="icon-button" aria-label={preview ? "Vorschau verlassen" : "Abmelden"} title={preview ? "Zum Login" : "Abmelden"} onClick={signOut} disabled={signingOut}>{signingOut ? <Loader2 size={17} className="spin" /> : <LogOut size={17} />}</button></div>{logoutError && <p role="alert" className="form-error">{logoutError}</p>}</div>
      </aside>
      <div className="hub-main-wrap" inert={menuOpen ? true : undefined}>
        <header className="hub-topbar">
          <div className="topbar-left">
            <button ref={menuTrigger} className="icon-button mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Navigation öffnen" aria-expanded={menuOpen}><Menu size={22} /></button>
            <span className="breadcrumb-root">Workspace</span><span className="breadcrumb-slash">/</span><span>{sectionLabels[section]}</span>
          </div>
          <div className="topbar-actions">
            <button className="search-trigger" onClick={() => setPanel("search")} aria-label="Workspace durchsuchen"><Search size={17} /><span>Suchen</span><kbd><Command size={10} /> K</kbd></button>
            <span className="topbar-divider" />
            <button className="icon-button notification-trigger" aria-label="Benachrichtigungen" onClick={() => setPanel("notifications")}><Bell size={19} strokeWidth={1.6} />{hasDemo && !read && <i />}</button>
            <Link className="topbar-avatar avatar" href={hubHref(preview, "settings")} aria-label="Dein Konto">{initials}</Link>
          </div>
        </header>
        {preview && <div className="preview-notice"><span><i /> Designvorschau <span className="preview-notice-detail">— alle Inhalte sind fiktive Beispieldaten.</span></span><Link href="/auth/login">Zum Login <ArrowUpRight size={13} /></Link></div>}
        {demoData && <div className="preview-notice"><span><i /> {accountLabel}<span className="preview-notice-detail"> — gepflegte fiktive Inhalte für Frontend-Tests.</span></span><span>Echter Login</span></div>}
        <main className="hub-content" id="main-content">{children}</main>
        <footer className="hub-footer"><span>Ein guter Ort für gute Zusammenarbeit.</span><span>oalab Client Hub <span className="footer-dot">●</span> {preview ? "Designvorschau" : demoData ? "Test-Workspace" : "Dein Workspace"}</span></footer>
      </div>
      {panel === "search" && <Modal title="Wonach suchst du?" onClose={() => setPanel(null)}><div className="search-field"><Search size={20} /><input autoFocus aria-label="Suchbegriff" placeholder="Seiten und Projekte durchsuchen …" value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="search-results">{(Object.keys(sectionLabels) as HubSection[]).filter((key) => sectionLabels[key].toLowerCase().includes(query.toLowerCase())).map((key) => <Link key={key} href={hubHref(preview, key)} onClick={() => { setPanel(null); setQuery(""); }}><LayoutGrid size={17} /><span>{sectionLabels[key]}</span><ArrowUpRight size={17} /></Link>)}{hasDemo && availableProjects.filter((project) => `${project.name} ${project.category}`.toLowerCase().includes(query.toLowerCase())).map((project) => <Link key={project.id} href={`${hubHref(preview, "projects")}?project=${project.id}`} onClick={() => { setPanel(null); setQuery(""); }}><FolderOpen size={17} /><span>{project.category}<small>{project.name}</small></span><ArrowUpRight size={17} /></Link>)}{query && !(Object.values(sectionLabels).some((label) => label.toLowerCase().includes(query.toLowerCase())) || (hasDemo && availableProjects.some((project) => `${project.name} ${project.category}`.toLowerCase().includes(query.toLowerCase())))) && <p className="muted">Keine Ergebnisse für „{query}“.</p>}</div></Modal>}
      {panel === "notifications" && <Modal title="Benachrichtigungen" onClose={() => setPanel(null)}>{hasDemo ? <><div className="notification-item"><span className="notification-symbol"><MessageSquare size={19} /></span><div><strong>Deine Meinung ist gefragt.</strong><p>Die erste Brand Direction ist bereit für dein Feedback.</p><span>Beispiel · 14. Oktober 2026</span><Link className="text-action" href={hubHref(preview, "messages")} onClick={() => setPanel(null)}>Nachricht ansehen <ArrowUpRight size={15} /></Link></div></div><button className="button-secondary full-width" onClick={() => setRead(true)}><Check size={16} />{read ? "Alle als gelesen markiert" : "Alle als gelesen markieren"}</button></> : <div className="modal-empty"><Bell size={30} /><h3>Du bist auf dem neuesten Stand.</h3><p>Neue Benachrichtigungen findest du künftig hier.</p></div>}</Modal>}
      {panel === "help" && <Modal title="Gemeinsam kommen wir weiter." onClose={() => setPanel(null)}><p className="modal-description">Fragen zu deinem Projekt, einer Datei oder dem nächsten Schritt? Dein OALAB-Projektteam ist deine erste Anlaufstelle.</p><div className="help-note"><ArrowDownLeft size={22} /><p>{preview ? "Diese Vorschau zeigt das neue Design. Persönliche Ansprechpartner und Kontaktmöglichkeiten ergänzen wir, sobald dein Workspace eingerichtet ist." : "Deine persönlichen Ansprechpartner werden hier angezeigt, sobald dein Workspace mit einem Projekt verbunden ist."}</p></div><button className="button-primary full-width" onClick={() => setPanel(null)}>Alles klar <Check size={16} /></button></Modal>}
    </div>
  );
}
