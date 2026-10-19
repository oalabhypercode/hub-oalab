"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUpRight, Bell, Check, FolderOpen, LayoutGrid, MessageSquare, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { categories } from "@/lib/categories";
import { hubHref, metricHref, previewAccount, previewFiles, previewProjects, sectionLabels, type HubDemoData, type HubSection } from "@/lib/hub-data";
import { metricMeta, metricOrder } from "@/lib/hub-metrics";
import { AppearanceProvider } from "./appearance-provider";
import { BackgroundLayer } from "./background-layer";
import { GlassSidebar } from "./glass-sidebar";
import { GlassTabBar } from "./glass-tab-bar";
import { CategoryIcon, GlassButton } from "./glass";
import { Modal } from "./modal";
import { BrandLogo } from "./wordmark";
import { ShellContext, useHubShell, type HubAccount, type ShellContextValue, type ShellPanel } from "./shell-context";

export function AppShell({ children, preview = false, email = "", demoData, publicDemo = false }: { children: React.ReactNode; preview?: boolean; email?: string; demoData?: HubDemoData; publicDemo?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [panel, setPanel] = useState<ShellPanel | null>(null);
  const [query, setQuery] = useState("");
  const [read, setRead] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const segment = pathname.split("/")[2] as HubSection | "metrics" | undefined;
  const section: HubSection = segment && segment in sectionLabels ? segment as HubSection : "overview";
  const name = preview ? previewAccount.name : demoData?.name || email.split("@")[0] || "Dein Konto";
  const projects = preview ? previewProjects : demoData?.projects || [];
  const files = preview ? previewFiles : demoData?.files || [];
  const hasDemo = preview || Boolean(demoData);
  const accountLabel = preview ? "Designvorschau" : demoData ? (demoData.role === "oalab_admin" ? "OALAB Admin · Demo" : "OALAB Customer · Demo") : "Angemeldet";
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = preview ? previewAccount.initials : (words.length > 1 ? words[0][0] + words[words.length - 1][0] : name.slice(0, 2)).toUpperCase();
  const account: HubAccount = {
    name,
    company: preview ? previewAccount.company : demoData?.company ?? null,
    customerNumber: preview ? previewAccount.customerNumber : demoData?.customerNumber ?? null,
    servicePackages: preview ? previewAccount.servicePackages : demoData?.servicePackages ?? [],
    admin: demoData?.role === "oalab_admin",
    customers: new Set(projects.map((project) => project.company).filter(Boolean)).size,
  };
  const counts = { projects: projects.length, files: files.length, messages: hasDemo ? 1 : 0 };

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
      if (publicDemo) {
        const response = await fetch("/auth/demo/logout", { method: "POST" });
        if (!response.ok) throw new Error("Demo logout failed");
      } else {
        const { error } = await createClient().auth.signOut();
        if (error) throw error;
      }
      // Cross the auth boundary with a fresh document, not preserved Activity state.
      window.location.replace("/auth/login");
    } catch {
      setLogoutError("Abmelden nicht möglich. Bitte versuche es erneut.");
      setSigningOut(false);
    }
  }

  const term = query.trim().toLowerCase();
  const closeSearch = () => { setPanel(null); setQuery(""); };
  const sectionResults = (Object.keys(sectionLabels) as HubSection[]).filter((key) => sectionLabels[key].toLowerCase().includes(term));
  const metricResults = hasDemo ? metricOrder.filter((id) => metricMeta[id].name.toLowerCase().includes(term)) : [];
  const projectResults = hasDemo ? projects.filter((project) => `${project.name} ${project.category} ${project.company || ""}`.toLowerCase().includes(term)) : [];
  const shell: ShellContextValue = { preview, initials, account, openPanel: setPanel, unread: hasDemo && !read, signOut, signingOut, logoutError };

  return (
    <AppearanceProvider>
      <ShellContext.Provider value={shell}>
        <BackgroundLayer />
        <div className="hub-app">
          <a className="skip-link" href="#main-content">Zum Inhalt springen</a>
          <GlassSidebar onSearch={() => setPanel("search")} preview={preview} section={section} counts={counts} name={name} accountLabel={accountLabel} initials={initials} />
          <div className="hub-main">
            <div className="hub-topbar">
              {/* Below 1024 px the sidebar (and its logo) is hidden, so the brand sits in the top row. */}
              <Link href={hubHref(preview)} className="topbar-brand" aria-label="oalab Client Hub – Übersicht"><span className="brand-tile"><BrandLogo /></span><span className="topbar-brand-name" aria-hidden="true">oalab</span></Link>
              {preview && <div className="hub-notice glass"><span><i aria-hidden="true" /> Designvorschau <span className="hub-notice-detail">– alle Inhalte sind fiktive Beispieldaten.</span></span><Link href="/auth/login">Zum Login <ArrowUpRight size={14} aria-hidden="true" /></Link></div>}
              {demoData && <div className="hub-notice glass"><span><i aria-hidden="true" /> {accountLabel}<span className="hub-notice-detail"> – gepflegte fiktive Inhalte für Frontend-Tests.</span></span><span>{publicDemo ? "Öffentliche Demo" : "Echter Login"}</span></div>}
            </div>
            <main className="hub-content" id="main-content">{children}</main>
          </div>
          <GlassTabBar preview={preview} section={section} />
        </div>
        {panel === "search" && (
          <Modal title="Wonach suchst du?" onClose={closeSearch}>
            <label className="search-field"><Search size={18} aria-hidden="true" /><input autoFocus aria-label="Suchbegriff" placeholder="Seiten, Kennzahlen und Projekte" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <div className="search-results">
              {sectionResults.map((key) => <Link key={key} href={hubHref(preview, key)} onClick={closeSearch}><LayoutGrid size={18} aria-hidden="true" /><span>{sectionLabels[key]}</span><ArrowUpRight size={16} aria-hidden="true" /></Link>)}
              {metricResults.map((id) => <Link key={id} href={metricHref(preview, id)} onClick={closeSearch}><CategoryIcon category={metricMeta[id].category} size={18} /><span>{metricMeta[id].name}<small>Kennzahl</small></span><ArrowUpRight size={16} aria-hidden="true" /></Link>)}
              {projectResults.map((project) => <Link key={project.id} href={`${hubHref(preview, "projects")}?project=${project.id}`} onClick={closeSearch}><FolderOpen size={18} color={categories.projects.fill} aria-hidden="true" /><span>{project.category}<small>{project.company ? `${project.company} · ` : ""}{project.name}</small></span><ArrowUpRight size={16} aria-hidden="true" /></Link>)}
              {term && !sectionResults.length && !metricResults.length && !projectResults.length && <p className="t-subheadline t-secondary">Keine Ergebnisse für „{query}“.</p>}
            </div>
          </Modal>
        )}
        {panel === "notifications" && (
          <Modal title="Benachrichtigungen" onClose={() => setPanel(null)}>
            {hasDemo ? <>
              <div className="notification-item"><span className="notification-symbol"><MessageSquare size={19} color={categories.messages.fill} aria-hidden="true" /></span><div><strong>Deine Meinung ist gefragt.</strong><p>Die erste Brand Direction ist bereit für dein Feedback.</p><span>Beispiel · 14. Oktober 2026</span><Link className="text-link" href={hubHref(preview, "messages")} onClick={() => setPanel(null)}>Nachricht ansehen <ArrowUpRight size={15} aria-hidden="true" /></Link></div></div>
              <button className="sheet-button" onClick={() => setRead(true)}><Check size={17} aria-hidden="true" />{read ? "Alle als gelesen markiert" : "Alle als gelesen markieren"}</button>
            </> : <div className="modal-empty"><Bell size={30} aria-hidden="true" /><h3>Du bist auf dem neuesten Stand.</h3><p>Neue Benachrichtigungen findest du künftig hier.</p></div>}
          </Modal>
        )}
        {panel === "help" && (
          <Modal title="Gemeinsam kommen wir weiter." onClose={() => setPanel(null)}>
            <p className="modal-description">Fragen zu deinem Projekt, einer Datei oder dem nächsten Schritt? Dein OALAB-Projektteam ist deine erste Anlaufstelle.</p>
            <p className="help-note">{preview ? "Diese Vorschau zeigt das neue Design. Persönliche Ansprechpartner und Kontaktmöglichkeiten ergänzen wir, sobald dein Workspace eingerichtet ist." : "Deine persönlichen Ansprechpartner werden hier angezeigt, sobald dein Workspace mit einem Projekt verbunden ist."}</p>
            <button className="sheet-button sheet-button-primary" onClick={() => setPanel(null)}>Alles klar <Check size={17} aria-hidden="true" /></button>
          </Modal>
        )}
      </ShellContext.Provider>
    </AppearanceProvider>
  );
}

/** Notification and help buttons for page headers. */
export function HeaderActions() {
  const { openPanel, unread } = useHubShell();
  return <>
    <GlassButton icon={Bell} label="Benachrichtigungen" badge={unread} onClick={() => openPanel("notifications")} />
    <GlassButton icon={MessageSquare} label="Hilfe & Kontakt" onClick={() => openPanel("help")} />
  </>;
}
