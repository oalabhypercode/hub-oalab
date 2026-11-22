"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, Globe, Sparkles } from "lucide-react";
import { categories } from "@/lib/categories";
import { formatDeadline, hubHref, previewAccount, previewFiles, previewProjects, sampleFolders, type HubSection, type Project, type ProjectTask } from "@/lib/hub-data";
import type { HubFilesState } from "@/lib/hub-files/types";
import { calendarFixtures } from "@/lib/hub-calendar/fixtures";
import type { HubCalendarState } from "@/lib/hub-calendar/types";
import { buildHubModel, isMetricId } from "@/lib/hub-metrics";
import { useFavorites } from "@/lib/use-favorites";
import { Modal } from "./modal";
import { quickLinks, type QuickLink } from "./project-links";
import { useHubShell } from "./shell-context";
import { ProjectStatus } from "./project-status";
import { AppearanceScreen } from "./screens/appearance";
import { CalendarScreen } from "./screens/calendar";
import { MetricDetailScreen } from "./screens/metric-detail";
import { OverviewScreen } from "./screens/overview";
import { InsightsScreen } from "./screens/insights";
import type { InsightsData } from "@/lib/hub-insights/types";
import type { OverviewFacts, OverviewWidgetsData } from "@/lib/hub-overview/types";
import { FilesScreen } from "./screens/files";
import { DiscoverScreen, ProfileScreen } from "./screens/workspace";
import { ProjectsScreen } from "./screens/projects";
import { ConversationsScreen } from "./screens/conversations";
import { UserManagementScreen } from "./screens/users";
import { PatchNotesScreen } from "./screens/patch-notes";
import { AssistantLogScreen } from "./screens/assistant-log";
import { ContractsScreen } from "./screens/contracts";
import { KeychainScreen } from "./screens/keychain";
import { TasksScreen } from "./screens/tasks";
import { NotesScreen } from "./screens/notes";
import { ProjectNotes } from "./screens/notes-links";
import type { NotesArea } from "@/lib/hub-notes/types";
import type { KeychainState } from "@/lib/hub-keychain/types";
import type { ProjectDesk } from "@/lib/hub-projects/desk";
import type { TaskBoardState } from "@/lib/hub-tasks/types";
import type { ContractsState } from "@/lib/hub-contracts/types";
import type { FreelancerCustomersState } from "@/lib/hub-freelancer-customers/types";
import { FreelancerCustomersScreen } from "./screens/freelancer-customers";
import { contractFixtures } from "@/lib/hub-contracts/fixtures";
import { quotaFixtures } from "@/lib/hub-service-quota/fixtures";
import type { AssistantLogState } from "@/lib/hub-assistant/log";
import type { ScreenProps } from "./screens/types";
import type { HubRole } from "@/lib/hub-users/rules";
import type { UserManagementState } from "@/lib/hub-users/types";
import { projectSites, restatesSite, shortUrl, type LiveProjectsState, type ProjectSite } from "@/lib/hub-projects/map";
import type { ConversationsState } from "@/lib/hub-conversations/types";
import type { PrivateChatState } from "@/lib/hub-private-chat/types";

type HubViewProps = {
  section?: HubSection;
  detail?: string;
  preview?: boolean;
  email?: string;
  userKey: string;
  asOf: string;
  /** Real files for signed-in users; absent for the preview. */
  filesState?: HubFilesState;
  /** Real calendar on the calendar page (under Projekte); absent for the preview. */
  calendarState?: HubCalendarState;
  /** Role of the login from the user management. */
  role?: HubRole | null;
  /** Logins and customers on the admin's user management page. */
  userManagement?: UserManagementState;
  /** Studio projects of a login; absent for the preview. */
  liveProjects?: LiveProjectsState;
  /** The assistant's proposals on the admin's "KI-Protokoll" page. */
  assistantLog?: AssistantLogState;
  /** The service platform's conversations for a real admin on the Nachrichten page; examples otherwise. */
  conversations?: ConversationsState;
  /** The private chats of a real login on the Nachrichten page; examples otherwise. */
  privateChats?: PrivateChatState;
  /** Packages and timeline on the page „Vertrag & Domain“ for real logins; examples otherwise. */
  contracts?: ContractsState;
  /** The admins' Schlüsselbund (accesses, categories, where the lock stands); only on its own page. */
  keychain?: KeychainState;
  /** Projekte for a real admin: every customer with domains, packages, quota and open requests; only on its own page. */
  projectDesk?: ProjectDesk;
  /** The task board under Projekte („Aufgaben“); the preview shows examples. */
  taskBoard?: TaskBoardState;
  /** The freelancers' „Kunden“: each customer with what oalab released; the preview shows examples. */
  freelancerCustomers?: FreelancerCustomersState;
  /** Insights for real logins: appointments and the Service quota; the preview shows examples. */
  insights?: InsightsData;
  /** Real admins on the Übersicht: the facts of their welcome card (null when they could not be read). */
  overviewFacts?: OverviewFacts | null;
  /** Real admins and customers on the Übersicht: this week's appointments and the quota for the widgets. */
  overviewWidgets?: OverviewWidgetsData | null;
  /** Notizen under Projekte for real logins; the preview shows examples. */
  notes?: NotesArea;
};

export function HubView({ section = "overview", detail, preview = false, email = "", userKey, asOf, filesState, calendarState, role = null, userManagement, liveProjects, assistantLog, conversations, privateChats, contracts, keychain, projectDesk, taskBoard, freelancerCustomers, insights, overviewFacts, overviewWidgets, notes }: HubViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const projects = useMemo(() => preview ? previewProjects : liveProjects?.projects || [], [preview, liveProjects]);
  const fixtureFiles = useMemo(() => preview ? previewFiles : [], [preview]);
  // Only the preview is filled with examples.
  const populated = preview;
  const admin = role === "oalab_admin";
  const freelancer = !preview && role === "oalab_freelancer";
  const liveFiles = filesState?.source === "supabase" && !filesState.error;
  const files = liveFiles ? filesState.files : fixtureFiles;
  const fileState: HubFilesState = useMemo(() => {
    if (filesState) return filesState;
    const customers = Array.from(new Map(fixtureFiles.flatMap((file) => file.customers).map((customer) => [customer.id, customer])).values());
    return { source: "fixtures", files: fixtureFiles, customers, folders: sampleFolders(customers), canManage: false };
  }, [filesState, fixtureFiles]);
  const calendar = useMemo(() => calendarState ?? calendarFixtures({ admin, customerNumber: preview ? previewAccount.customerNumber : null }), [calendarState, admin, preview]);
  const favorites = useFavorites(userKey);
  // Without real data (the preview) the examples: every example customer for admins, the own one for customers. The
  // example contracts of the asset management link up with them, the example quota with their Service packages.
  const contractState = useMemo((): ContractsState => {
    if (contracts) return contracts;
    const examples = contractFixtures({
      admin,
      customerNumber: preview ? previewAccount.customerNumber : null,
      contractFiles: Object.fromEntries(fileState.files.filter((file) => file.category === "contract").flatMap((file) => file.customers.map((customer) => [customer.id, file.id]))),
    });
    return { ...examples, serviceQuota: quotaFixtures({ admin, customerIds: examples.customers.map((customer) => customer.id) }) };
  }, [contracts, admin, preview, fileState.files]);
  const model = useMemo(() => buildHubModel({ preview, asOf, projects, files, populated, admin, completedSteps }), [preview, asOf, projects, files, populated, admin, completedSteps]);
  // The task board uses ?project= to pick its board, so the project window stays closed there (and on the notes).
  const selectedProject = detail === "tasks" || detail === "notes" ? undefined : projects.find((project) => project.id === searchParams.get("project"));
  // Admins open a project on „Projekte“ in the page's own panel; the window stays for customers and every other page.
  // On „Projekte“ the admins' page opens a project in its own panel; without that page (no verified admin) the window stays.
  const panelShowsProject = admin && !preview && section === "projects" && !detail && Boolean(projectDesk && !projectDesk.error);

  const screen: ScreenProps = {
    model, preview, populated, asOf, projects, files, fileState, calendar, favorites, admin, freelancer,
    liveProjects: !preview ? liveProjects ?? null : null,
    firstName: preview ? "Jana" : "",
    toggleStep: (id) => setCompletedSteps((value) => value.includes(id) ? value.filter((item) => item !== id) : [...value, id]),
  };

  return (
    <>
      {detail === "appearance" ? <AppearanceScreen preview={preview} admin={admin} />
        : detail === "tasks" ? <TasksScreen board={taskBoard} preview={preview} asOf={asOf} />
        : detail === "notes" ? <NotesScreen area={notes} preview={preview} />
        : detail && isMetricId(detail) ? <MetricDetailScreen {...screen} metricId={detail} />
        : section === "overview" ? <OverviewScreen {...screen} userKey={userKey} facts={preview ? undefined : overviewFacts} widgets={preview ? undefined : overviewWidgets} board={preview ? undefined : taskBoard} />
        : section === "insights" ? <InsightsScreen {...screen} insights={preview ? undefined : insights} board={preview ? undefined : taskBoard} cards={preview ? undefined : freelancerCustomers} />
        : section === "discover" ? <DiscoverScreen {...screen} />
        : section === "projects" ? <ProjectsScreen {...screen} desk={preview ? undefined : projectDesk} />
        : section === "files" ? <FilesScreen {...screen} />
        : section === "contracts" ? <ContractsScreen {...screen} state={contractState} />
        : section === "customers" ? <FreelancerCustomersScreen {...screen} state={freelancerCustomers} board={taskBoard} />
        : section === "messages" ? <ConversationsScreen {...screen} conversations={populated ? undefined : conversations} privateChats={populated ? undefined : privateChats} />
        : section === "calendar" ? <CalendarScreen {...screen} taskBoard={taskBoard} />
        : section === "users" && userManagement ? <UserManagementScreen state={userManagement} />
        : section === "ai-log" && assistantLog ? <AssistantLogScreen state={assistantLog} />
        : section === "keychain" && keychain ? <KeychainScreen state={keychain} />
        : section === "patch-notes" ? <PatchNotesScreen />
        : <ProfileScreen {...screen} email={email} />}
      {selectedProject && !panelShowsProject && <ProjectModal project={selectedProject} preview={preview} admin={admin} onClose={() => router.replace(hubHref(preview, "projects"), { scroll: false })} />}
    </>
  );
}

const taskStatusLabels: Record<ProjectTask["status"], string> = { backlog: "Backlog", todo: "Offen", progress: "In Arbeit", review: "In Prüfung", done: "Erledigt" };

function ProjectQuickLinks({ links }: { links: QuickLink[] }) {
  const nav = useRef<HTMLElement>(null);
  // Digits open the shortcuts while focus is in this dialog (not in a window on top) and nobody types.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || !/^[1-9]$/.test(event.key)) return;
      const dialog = nav.current?.closest("dialog");
      const focused = document.activeElement;
      if (!dialog || !focused || !dialog.contains(focused) || focused.closest("input, textarea, select, [contenteditable='true']")) return;
      const link = nav.current?.querySelector<HTMLElement>(`[data-quick="${event.key}"]`);
      if (!link) return;
      event.preventDefault();
      link.click();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return (
    <nav ref={nav} className="project-quick" aria-label="Schnellzugriff">
      {links.map((link, index) => {
        const inner = <>{link.icon}<span className="project-quick-label">{link.label}</span>{index < 9 && <kbd aria-hidden="true">{index + 1}</kbd>}</>;
        const props = { className: `project-quick-link${link.external ? " is-site" : ""}`, "data-quick": index + 1, "data-tip": link.tip, style: { "--i": index } as React.CSSProperties, "aria-keyshortcuts": index < 9 ? String(index + 1) : undefined };
        return link.external
          ? <a key={link.id} {...props} href={link.href} target="_blank" rel="noopener noreferrer">{inner}</a>
          : <Link key={link.id} {...props} href={link.href}>{inner}</Link>;
      })}
    </nav>
  );
}

/** Live and test address of the project, each a line that opens the site in a new tab; the website comes first. */
function ProjectSites({ sites }: { sites: ProjectSite[] }) {
  if (!sites.length) return null;
  return (
    <ul className="project-sites" aria-label="Website">
      {sites.map((site, index) => (
        <li key={site.key} style={{ "--i": index } as React.CSSProperties}>
          <a className={`project-site is-${site.key}`} href={site.url} target="_blank" rel="noopener noreferrer" data-tip={site.url} aria-label={`${site.label}: ${shortUrl(site.url)} öffnen (neuer Tab)`}>
            <span className="project-site-icon"><Globe size={18} aria-hidden="true" /></span>
            <span className="project-site-text"><strong>{shortUrl(site.url)}</strong><small><i aria-hidden="true" />{site.label} · {site.sub}</small></span>
            <ArrowUpRight className="project-site-go" size={18} aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  );
}

function ProjectModal({ project, preview, admin, onClose }: { project: Project; preview: boolean; admin: boolean; onClose: () => void }) {
  // Studio projects carry their tasks; the fixtures stay example projects with the example conversation.
  const tasks = project.tasks;
  const { manageUsers, askAboutProject, assistantDocked } = useHubShell();
  const links = quickLinks(project, preview, admin);
  const sites = projectSites(project);
  const description = restatesSite(project.description, sites.map((site) => site.url)) ? "" : project.description;
  return (
    <Modal title={project.category || project.company || "Projekt"} onClose={onClose}>
      <div className="project-modal-status"><ProjectStatus value={project.status} /><span>Ziel: {project.date}</span></div>
      <h3 className="project-modal-title">{project.name}</h3>
      {description && <p className="modal-description">{description}</p>}
      <ProjectSites sites={sites} />
      <div className="project-modal-progress"><span>Projektfortschritt</span><strong className="numeric">{project.progress} %</strong></div>
      <div className="progress-bar" aria-hidden="true" style={{ background: `color-mix(in srgb, ${categories.projects.fill} 25%, transparent)` }}><span style={{ width: `${project.progress}%`, background: categories.projects.fill }} /></div>
      <ProjectQuickLinks links={links} />
      {tasks ? (
        tasks.length ? (
          <ul className="project-tasks" aria-label="Aufgaben">
            {tasks.map((task) => (
              <li key={task.id} className={task.status === "done" ? "is-done" : undefined}>
                <span className="project-task-title">{task.title}</span>
                <span className="project-task-meta">
                  {[taskStatusLabels[task.status], task.customer ? "Kunde" : "oalab", task.dueOn ? `bis ${formatDeadline(task.dueOn)}` : "", admin && !task.visible ? "intern" : ""].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="modal-description t-secondary project-tasks-empty">Noch keine Aufgaben{admin ? "" : ", die für dich freigegeben sind"}.</p>
      ) : null}
      {/* The assistant keeps this project as its reference, so "dieses Projekt" works. As a window it opens on top of
          this dialog; docked it sits next to the page, and this dialog closes, because a dialog would block the sidebar. */}
      {tasks && <ProjectNotes projectId={project.id} customerId={project.customerId} preview={preview} canCreate={admin} />}
      {tasks && manageUsers && (
        <button type="button" className="sheet-button project-ask" onClick={() => { askAboutProject({ id: project.id, name: project.category || project.name }); if (assistantDocked) onClose(); }}><Sparkles size={17} aria-hidden="true" /> Assistent zu diesem Projekt fragen</button>
      )}
      {!tasks && <p className="demo-detail-note"><Sparkles size={15} aria-hidden="true" /> Beispielprojekt · Die vollständige Projektverwaltung folgt im nächsten Schritt.</p>}
    </Modal>
  );
}
