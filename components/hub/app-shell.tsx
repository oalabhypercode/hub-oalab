"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUpRight, Bell, Check, FolderOpen, LayoutGrid, LogOut, MessageCircleQuestion, MessageSquare, Search } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { signOutAction } from "@/lib/hub-auth/actions";
import { categories } from "@/lib/categories";
import { adminSections, hubHref, metricHref, previewAccount, previewFiles, previewProjects, sectionLabel, sectionLabels, type HubDemoData, type HubSection, type Project } from "@/lib/hub-data";
import type { HubAccountData } from "@/lib/hub-users/types";
import { metricMeta, metricOrder } from "@/lib/hub-metrics";
import { AppearanceProvider } from "./appearance-provider";
import { AssistantPanel, type AssistantMode, type ChatTurn } from "./assistant-panel";
import { applyProposalStatus, chatKey, MODE_KEY, openProposalIds, parseChat, serializeChat } from "@/lib/hub-assistant/chat-storage";
import { proposalStatuses } from "@/lib/hub-assistant/actions";
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
import type { CustomerLogo } from "@/lib/hub-logos/rules";
import { LogoImage, logoTileStyle, useShownLogo } from "./logo-mark";

/** localStorage can throw (private mode, blocked site data); the hub then simply doesn't remember. */
function readStored<T>(read: () => T, fallback: T): T {
  try { return read(); } catch { return fallback; }
}

export function AppShell({ children, preview = false, pending = false, email = "", userId, demoData, publicDemo = false, hubAccount = null, pendingRegistrations = 0, liveProjects, inbox = null, unreadConversations, fileCount, accountLogo = null }: {
  children: React.ReactNode;
  /** The signed-in login; keys the chat stored in this browser. */
  userId?: string;
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
  /** Real logins: conversations with something new from oalab (Nachrichten); the examples count their own. */
  unreadConversations?: number;
  /** Real logins: the files they see (all for admins, assigned ones for customers); the examples count their own. */
  fileCount?: number;
  /** Real customer logins: their company's logo with a short-lived link. */
  accountLogo?: CustomerLogo | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [panel, setPanel] = useState<ShellPanel | null>(null);
  const [query, setQuery] = useState("");
  const [read, setRead] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  // The chat of a real login lives in this browser until "Neu starten" or signing out (lib/hub-assistant/chat-storage.ts).
  // The panel is closed on the first render, so reading the browser here never changes the server-rendered page.
  const chatStore = !preview && !publicDemo && userId ? chatKey(userId) : null;
  const [assistantTurns, setAssistantTurns] = useState<ChatTurn[]>(() => chatStore && typeof window !== "undefined" ? readStored(() => parseChat<ChatTurn>(localStorage.getItem(chatStore)), []) : []);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantMode, setAssistantMode] = useState<AssistantMode>(() => typeof window !== "undefined" && readStored(() => localStorage.getItem(MODE_KEY), null) === "dock" ? "dock" : "window");
  const [assistantProject, setAssistantProject] = useState<{ id: string; name: string } | null>(null);
  const segment = pathname.split("/")[2] as HubSection | "metrics" | undefined;
  const section: HubSection = segment && segment in sectionLabels ? segment as HubSection : "overview";
  // Real logins take their name, company and packages from the user management; demo logins keep the fixtures.
  const live = !preview && !demoData ? hubAccount : null;
  const liveCustomer = live?.customers[0] ?? null;
  const name = preview ? previewAccount.name : pending ? "" : demoData?.name || accountDisplayName(live, liveCustomer?.company, email);
  const projects = preview ? previewProjects : demoData?.projects || liveProjects || [];
  const files = preview ? previewFiles : demoData?.files || [];
  const hasDemo = preview || Boolean(demoData);
  // The first line of the account menu: real logins see their e-mail; demo accounts carry no banner, so the role and the
  // kind of demo stay visible there.
  const accountLabel = preview ? "Designvorschau" : demoData ? `${demoData.role === "oalab_admin" ? "oalab-Admin" : "Kunde"} · ${publicDemo ? "Öffentliche Demo" : "Demo"}` : email || "Angemeldet";
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = preview ? previewAccount.initials : (words.length > 1 ? words[0][0] + words[words.length - 1][0] : name.slice(0, 2)).toUpperCase();
  const account: HubAccount = {
    name,
    firstName: (preview ? previewAccount.name.split(" ")[0] : pending ? "" : demoData ? demoData.name.split(" ")[0] : live?.firstName.trim()) ?? "",
    company: preview ? previewAccount.company : demoData?.company ?? liveCustomer?.company ?? null,
    customerNumber: preview ? previewAccount.customerNumber : demoData?.customerNumber ?? liveCustomer?.customerNumber ?? null,
    servicePackages: preview ? previewAccount.servicePackages : demoData?.servicePackages ?? liveCustomer?.servicePackages ?? [],
    admin: demoData ? demoData.role === "oalab_admin" : live?.role === "oalab_admin",
    freelancer: !demoData && live?.role === "oalab_freelancer",
    customers: new Set(projects.map((project) => project.company).filter(Boolean)).size,
    person: live ? { phone: live.phone, position: live.position } : null,
    customerDetails: liveCustomer ? { street: liveCustomer.street, postalCode: liveCustomer.postalCode, city: liveCustomer.city, country: liveCustomer.country, website: liveCustomer.website, phone: liveCustomer.phone, contactEmail: liveCustomer.contactEmail } : null,
  };
  const counts = { projects: projects.length, files: hasDemo ? files.length : fileCount ?? 0, messages: unreadConversations ?? (hasDemo ? 1 : 0) };
  // Only a real customer login shows its company's logo; admins keep their initials.
  const logo = live && !account.admin ? accountLogo : null;

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

  // Restored proposals that still look open: the server knows whether they were decided elsewhere or ran out.
  const [restoredIds] = useState(() => openProposalIds(assistantTurns));
  useEffect(() => {
    if (!restoredIds.length || !account.admin) return;
    proposalStatuses({ ids: restoredIds })
      .then((result) => { if (result.ok) setAssistantTurns((current) => applyProposalStatus(current, result.data)); })
      .catch(() => { /* the cards stay as stored; saving still checks on the server */ });
  }, [restoredIds, account.admin]);

  useEffect(() => {
    if (!chatStore) return;
    try {
      const text = serializeChat(assistantTurns);
      if (text) localStorage.setItem(chatStore, text); else localStorage.removeItem(chatStore);
    } catch {
      // Storage blocked or full: the chat still works, it just isn't kept.
    }
  }, [chatStore, assistantTurns]);

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
      // Signing out ends the stored chat of this login.
      if (chatStore) readStored(() => localStorage.removeItem(chatStore), undefined);
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
  const signOutLabel = preview ? "Vorschau verlassen" : "Abmelden";
  const sectionResults = (Object.keys(sectionLabels) as HubSection[]).filter((key) => (manageUsers || !adminSections.includes(key)) && sectionLabel(key, account.admin || account.freelancer).toLowerCase().includes(term));
  const metricResults = hasDemo ? metricOrder.filter((id) => metricMeta[id].name.toLowerCase().includes(term)) : [];
  const projectResults = hasDemo || liveProjects ? projects.filter((project) => `${project.name} ${project.category} ${project.company || ""}`.toLowerCase().includes(term)) : [];
  const assistantDocked = assistantOpen && assistantMode === "dock";
  const shell: ShellContextValue = {
    preview, pending, initials, logo, account, manageUsers,
    openPanel: (next) => next === "help" ? setAssistantOpen(true) : setPanel(next),
    askAboutProject: (project) => { setAssistantProject(project); setAssistantOpen(true); },
    assistantDocked: assistantMode === "dock",
    unread: hasDemo ? !read : Boolean(inbox?.unread), signOut, signingOut, logoutError,
  };
  const changeAssistantMode = (mode: AssistantMode) => {
    setAssistantMode(mode);
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* the choice just isn't remembered */ }
  };

  return (
    <AppearanceProvider>
      <ShellContext.Provider value={shell}>
        <BackgroundLayer />
        <div className={`hub-app${assistantDocked ? " has-assistant-dock" : ""}`}>
          <a className="skip-link" href="#main-content">Zum Inhalt springen</a>
          <GlassSidebar onSearch={() => setPanel("search")} preview={preview} section={section} counts={counts} name={name} accountLabel={accountLabel} initials={initials} logo={logo} pendingRegistrations={pendingRegistrations} />
          <div className="hub-main">
            <div className="hub-topbar">
              {/* Below 1024 px the sidebar (and its logo) is hidden, so the brand sits in the top row. */}
              <Link href={hubHref(preview)} className="topbar-brand" aria-label="oalab Client Hub – Übersicht"><span className="brand-tile"><BrandLogo /></span><span className="topbar-brand-text" aria-hidden="true"><span className="topbar-brand-name">oalab</span><small>Client Hub</small></span></Link>
              {/* Below 1024 px bell, assistant and profile sit here, so the page title keeps the whole width. Tablets hide the
                  sidebar with its gear menu, so there signing out sits at the far right (wish of 5 November 2026). */}
              <div className="topbar-actions"><HeaderActions /><MobileAvatar href={hubHref(preview, "settings")} initials={initials} logo={logo} /><button type="button" className="glass glass-float glass-button topbar-signout" aria-label={signOutLabel} title={signOutLabel} onClick={signOut} disabled={signingOut}>{signingOut ? <MiniLoader size={18} /> : <LogOut size={20} strokeWidth={2} aria-hidden="true" />}</button></div>
              {preview && <div className="hub-notice glass"><span><i aria-hidden="true" /> Designvorschau <span className="hub-notice-detail">– alle Inhalte sind fiktive Beispieldaten.</span></span><Link href="/auth/login">Zur Anmeldung <ArrowUpRight size={14} aria-hidden="true" /></Link></div>}
              {/* Profil shows its own message; on other pages a failed sign-out from the top row says so here. */}
              {logoutError && section !== "settings" && <p role="alert" className="form-error topbar-signout-error">{logoutError}</p>}
            </div>
            <main className="hub-content" id="main-content">{children}</main>
          </div>
          <GlassTabBar preview={preview} section={section} badges={{ messages: counts.messages }} />
        </div>
        {panel === "search" && (
          <Modal title="Wonach suchst du?" onClose={closeSearch}>
            <label className="search-field"><Search size={18} aria-hidden="true" /><input autoFocus aria-label="Suchbegriff" placeholder="Seiten, Kennzahlen und Projekte" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <div className="search-results">
              {sectionResults.map((key) => <Link key={key} href={hubHref(preview, key)} onClick={closeSearch}><LayoutGrid size={18} aria-hidden="true" /><span>{sectionLabel(key, account.admin || account.freelancer)}</span><ArrowUpRight size={16} aria-hidden="true" /></Link>)}
              {metricResults.map((id) => <Link key={id} href={metricHref(preview, id)} onClick={closeSearch}><CategoryIcon category={metricMeta[id].category} size={18} /><span>{metricMeta[id].name}<small>Kennzahl</small></span><ArrowUpRight size={16} aria-hidden="true" /></Link>)}
              {projectResults.map((project) => <Link key={project.id} href={`${hubHref(preview, "projects")}?project=${project.id}`} onClick={closeSearch}><FolderOpen size={18} color={categories.projects.fill} aria-hidden="true" /><span>{project.category || project.name}<small>{project.company ? `${project.company} · ` : ""}{project.category ? project.name : "Projekt"}</small></span><ArrowUpRight size={16} aria-hidden="true" /></Link>)}
              {term && !sectionResults.length && !metricResults.length && !projectResults.length && <p className="t-subheadline t-secondary">Keine Treffer für „{query}“.</p>}
            </div>
          </Modal>
        )}
        {panel === "notifications" && (
          <Modal title="Benachrichtigungen" onClose={() => setPanel(null)}>
            {hasDemo ? <>
              <div className="notification-item"><span className="notification-symbol"><MessageSquare size={19} color={categories.messages.fill} aria-hidden="true" /></span><div><strong>Deine Meinung ist gefragt.</strong><p>Die erste Brand Direction ist bereit für dein Feedback.</p><span>Beispiel · 14. Oktober 2026</span><Link className="text-link" href={hubHref(preview, "messages")} onClick={() => setPanel(null)}>Nachricht ansehen <ArrowUpRight size={15} aria-hidden="true" /></Link></div></div>
              <button className="sheet-button" onClick={() => setRead(true)}><Check size={17} aria-hidden="true" />{read ? "Alle als gelesen markiert" : "Alle als gelesen markieren"}</button>
            </> : inbox ? <NotificationsPanel items={inbox.items} admin={account.admin} onClose={() => setPanel(null)} />
              : <div className="modal-empty"><Bell size={30} aria-hidden="true" /><h3>Du bist auf dem neuesten Stand.</h3><p>Neue Benachrichtigungen findest du künftig hier.</p></div>}
          </Modal>
        )}
        {assistantOpen && (
          <AssistantPanel turns={assistantTurns} setTurns={setAssistantTurns} admin={account.admin} available={!preview && !publicDemo}
            mode={assistantMode} onModeChange={changeAssistantMode}
            project={assistantProject} onClearProject={() => setAssistantProject(null)}
            onClose={() => setAssistantOpen(false)} />
        )}
      </ShellContext.Provider>
    </AppearanceProvider>
  );
}

/** Below 1024 px the profile sits top right: the company's logo for customers who have one, else the initials. */
function MobileAvatar({ href, initials, logo }: { href: string; initials: string; logo: CustomerLogo | null }) {
  const { shown, onError } = useShownLogo(logo);
  return shown
    ? <Link href={href} className="glass glass-float mobile-avatar has-logo" style={logoTileStyle(shown)} aria-label="Profil"><LogoImage logo={shown} onError={onError} /></Link>
    : <Link href={href} className="glass glass-float mobile-avatar" aria-label="Profil">{initials}</Link>;
}

/** Notification and help buttons for page headers. */
export function HeaderActions() {
  const { openPanel, unread } = useHubShell();
  return <>
    <GlassButton icon={Bell} label="Benachrichtigungen" badge={unread} onClick={() => openPanel("notifications")} />
    <GlassButton icon={MessageCircleQuestion} label="Assistent & Hilfe" onClick={() => openPanel("help")} />
  </>;
}
