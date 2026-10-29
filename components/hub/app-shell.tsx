"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUpRight, Bell, Check, FolderOpen, LayoutGrid, MessageSquare, Search } from "lucide-react";
import { signOutAction } from "@/lib/hub-auth/actions";
import { categories } from "@/lib/categories";
import { adminSections, hubHref, metricHref, previewAccount, previewFiles, previewProjects, sectionLabel, sectionLabels, type HubDemoData, type HubSection, type Project } from "@/lib/hub-data";
import type { HubAccountData } from "@/lib/hub-users/types";
import { metricMeta, metricOrder } from "@/lib/hub-metrics";
import { AppearanceProvider } from "./appearance-provider";
import { AssistantPanel, type ChatTurn } from "./assistant-panel";
import { NotificationsPanel } from "./notifications-panel";
import type { InboxState } from "@/lib/hub-notify/server";
import { BackgroundLayer } from "./background-layer";
import { GlassSidebar } from "./glass-sidebar";
import { GlassTabBar } from "./glass-tab-bar";
import { CategoryIcon, GlassButton } from "./glass";
import { Modal } from "./modal";
import { BrandLogo } from "./wordmark";
import { ShellContext, useHubShell, type HubAccount, type ShellContextValue, type ShellPanel } from "./shell-context";
import { accountDisplayName } from "@/lib/hub-users/display-name";

export function AppShell({ children, preview = false, pending = false, email = "", demoData, publicDemo = false, hubAccount = null, pendingRegistrations = 0, liveProjects, inbox = null }: {
  children: React.ReactNode;
  preview?: boolean;
  /** Loading fallback while the login is checked: navigation and page title at once, the account still blank. */
  pending?: boolean;
  email?: string;
  demoData?: HubDemoData;
  publicDemo?: boolean;
  /** Real logins: profile and customer from the user management (demo logins keep their fixtures). */
  hubAccount?: HubAccountData | null;
  /** Admins: registrations waiting for approval, shown next to "User Management". */
  pendingRegistrations?: number;
  /** Real logins: their Studio projects, for the sidebar count and the search. */
  liveProjects?: Project[];
  /** Real logins: the notices behind the bell (null before the migration or for demo logins). */
  inbox?: InboxState | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [panel, setPanel] = useState<ShellPanel | null>(null);
  const [query, setQuery] = useState("");
  const [read, setRead] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [assistantTurns, setAssistantTurns] = useState<ChatTurn[]>([]);
  const segment = pathname.split("/")[2] as HubSection | "metrics" | undefined;
  const section: HubSection = segment && segment in sectionLabels ? segment as HubSection : "overview";
  // Real logins take their name, company and packages from the user management; demo logins keep the fixtures.
  const live = !preview && !demoData ? hubAccount : null;
  const liveCustomer = live?.customers[0] ?? null;
  const name = preview ? previewAccount.name : pending ? "" : demoData?.name || accountDisplayName(live, liveCustomer?.company, email);
  const projects = preview ? previewProjects : demoData?.projects || liveProjects || [];
  const files = preview ? previewFiles : demoData?.files || [];
  const hasDemo = preview || Boolean(demoData);
  // Demo accounts carry no banner; the role and the kind of demo stay visible in the logout tooltip.
  const accountLabel = preview ? "Designvorschau" : demoData ? `${demoData.role === "oalab_admin" ? "OALAB Admin" : "OALAB Customer"} · ${publicDemo ? "Öffentliche Demo" : "Demo"}` : "Angemeldet";
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = preview ? previewAccount.initials : (words.length > 1 ? words[0][0] + words[words.length - 1][0] : name.slice(0, 2)).toUpperCase();
  const account: HubAccount = {
    name,
    company: preview ? previewAccount.company : demoData?.company ?? liveCustomer?.company ?? null,
    customerNumber: preview ? previewAccount.customerNumber : demoData?.customerNumber ?? liveCustomer?.customerNumber ?? null,
    servicePackages: preview ? previewAccount.servicePackages : demoData?.servicePackages ?? liveCustomer?.servicePackages ?? [],
    admin: demoData ? demoData.role === "oalab_admin" : live?.role === "oalab_admin",
    customers: new Set(projects.map((project) => project.company).filter(Boolean)).size,
    person: live ? { phone: live.phone, position: live.position } : null,
    customerDetails: liveCustomer ? { street: liveCustomer.street, postalCode: liveCustomer.postalCode, city: liveCustomer.city, country: liveCustomer.country, website: liveCustomer.website, phone: liveCustomer.phone, contactEmail: liveCustomer.contactEmail } : null,
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
        // On the server: the shared session cookie is HTTP-only, and this signs out of Service OALab too.
        const result = await signOutAction();
        if (!result.ok) throw new Error(result.error);
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
  // The user management needs a real admin session; the preview and the public demo never show it.
  const manageUsers = account.admin && !preview && !publicDemo;
  const sectionResults = (Object.keys(sectionLabels) as HubSection[]).filter((key) => (manageUsers || !adminSections.includes(key)) && sectionLabel(key, account.admin).toLowerCase().includes(term));
  const metricResults = hasDemo ? metricOrder.filter((id) => metricMeta[id].name.toLowerCase().includes(term)) : [];
  const projectResults = hasDemo || liveProjects ? projects.filter((project) => `${project.name} ${project.category} ${project.company || ""}`.toLowerCase().includes(term)) : [];
  const shell: ShellContextValue = { preview, pending, initials, account, manageUsers, openPanel: setPanel, unread: hasDemo ? !read : Boolean(inbox?.unread), signOut, signingOut, logoutError };

  return (
    <AppearanceProvider>
      <ShellContext.Provider value={shell}>
        <BackgroundLayer />
        <div className="hub-app">
          <a className="skip-link" href="#main-content">Zum Inhalt springen</a>
          <GlassSidebar onSearch={() => setPanel("search")} preview={preview} section={section} counts={counts} name={name} accountLabel={accountLabel} initials={initials} pendingRegistrations={pendingRegistrations} />
          <div className="hub-main">
            <div className="hub-topbar">
              {/* Below 1024 px the sidebar (and its logo) is hidden, so the brand sits in the top row. */}
              <Link href={hubHref(preview)} className="topbar-brand" aria-label="oalab Client Hub – Übersicht"><span className="brand-tile"><BrandLogo /></span><span className="topbar-brand-name" aria-hidden="true">oalab</span></Link>
              {preview && <div className="hub-notice glass"><span><i aria-hidden="true" /> Designvorschau <span className="hub-notice-detail">– alle Inhalte sind fiktive Beispieldaten.</span></span><Link href="/auth/login">Zum Login <ArrowUpRight size={14} aria-hidden="true" /></Link></div>}
            </div>
            <main className="hub-content" id="main-content">{children}</main>
          </div>
          <GlassTabBar preview={preview} section={section} />
        </div>
        {panel === "search" && (
          <Modal title="Wonach suchst du?" onClose={closeSearch}>
            <label className="search-field"><Search size={18} aria-hidden="true" /><input autoFocus aria-label="Suchbegriff" placeholder="Seiten, Kennzahlen und Projekte" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <div className="search-results">
              {sectionResults.map((key) => <Link key={key} href={hubHref(preview, key)} onClick={closeSearch}><LayoutGrid size={18} aria-hidden="true" /><span>{sectionLabel(key, account.admin)}</span><ArrowUpRight size={16} aria-hidden="true" /></Link>)}
              {metricResults.map((id) => <Link key={id} href={metricHref(preview, id)} onClick={closeSearch}><CategoryIcon category={metricMeta[id].category} size={18} /><span>{metricMeta[id].name}<small>Kennzahl</small></span><ArrowUpRight size={16} aria-hidden="true" /></Link>)}
              {projectResults.map((project) => <Link key={project.id} href={`${hubHref(preview, "projects")}?project=${project.id}`} onClick={closeSearch}><FolderOpen size={18} color={categories.projects.fill} aria-hidden="true" /><span>{project.category || project.name}<small>{project.company ? `${project.company} · ` : ""}{project.category ? project.name : "Projekt"}</small></span><ArrowUpRight size={16} aria-hidden="true" /></Link>)}
              {term && !sectionResults.length && !metricResults.length && !projectResults.length && <p className="t-subheadline t-secondary">Keine Ergebnisse für „{query}“.</p>}
            </div>
          </Modal>
        )}
        {panel === "notifications" && (
          <Modal title="Benachrichtigungen" onClose={() => setPanel(null)}>
            {hasDemo ? <>
              <div className="notification-item"><span className="notification-symbol"><MessageSquare size={19} color={categories.messages.fill} aria-hidden="true" /></span><div><strong>Deine Meinung ist gefragt.</strong><p>Die erste Brand Direction ist bereit für dein Feedback.</p><span>Beispiel · 14. Oktober 2026</span><Link className="text-link" href={hubHref(preview, "messages")} onClick={() => setPanel(null)}>Nachricht ansehen <ArrowUpRight size={15} aria-hidden="true" /></Link></div></div>
              <button className="sheet-button" onClick={() => setRead(true)}><Check size={17} aria-hidden="true" />{read ? "Alle als gelesen markiert" : "Alle als gelesen markieren"}</button>
            </> : inbox ? <NotificationsPanel items={inbox.items} onClose={() => setPanel(null)} />
              : <div className="modal-empty"><Bell size={30} aria-hidden="true" /><h3>Du bist auf dem neuesten Stand.</h3><p>Neue Benachrichtigungen findest du künftig hier.</p></div>}
          </Modal>
        )}
        {panel === "help" && <AssistantPanel turns={assistantTurns} setTurns={setAssistantTurns} admin={account.admin} available={!preview && !publicDemo} onClose={() => setPanel(null)} />}
      </ShellContext.Provider>
    </AppearanceProvider>
  );
}

/** Notification and help buttons for page headers. */
export function HeaderActions() {
  const { openPanel, unread } = useHubShell();
  return <>
    <GlassButton icon={Bell} label="Benachrichtigungen" badge={unread} onClick={() => openPanel("notifications")} />
    <GlassButton icon={MessageSquare} label="Assistent & Hilfe" onClick={() => openPanel("help")} />
  </>;
}
