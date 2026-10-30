"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Sparkles } from "lucide-react";
import { categories } from "@/lib/categories";
import { formatDeadline, hubHref, previewAccount, previewFiles, previewProjects, sampleFolders, type HubDemoData, type HubSection, type Project, type ProjectTask } from "@/lib/hub-data";
import type { HubFilesState } from "@/lib/hub-files/types";
import { calendarFixtures } from "@/lib/hub-calendar/fixtures";
import type { HubCalendarState } from "@/lib/hub-calendar/types";
import { buildHubModel, isMetricId } from "@/lib/hub-metrics";
import { useFavorites } from "@/lib/use-favorites";
import { Modal } from "./modal";
import { useHubShell } from "./shell-context";
import { ProjectStatus } from "./project-status";
import { AppearanceScreen } from "./screens/appearance";
import { CalendarScreen } from "./screens/calendar";
import { MetricDetailScreen } from "./screens/metric-detail";
import { InsightsScreen, OverviewScreen } from "./screens/overview";
import { FilesScreen } from "./screens/files";
import { DiscoverScreen, MessagesScreen, ProfileScreen, ProjectsScreen } from "./screens/workspace";
import { UserManagementScreen } from "./screens/users";
import { PatchNotesScreen } from "./screens/patch-notes";
import { AssistantLogScreen } from "./screens/assistant-log";
import type { AssistantLogState } from "@/lib/hub-assistant/log";
import type { ScreenProps } from "./screens/types";
import type { HubRole } from "@/lib/hub-users/rules";
import type { UserManagementState } from "@/lib/hub-users/types";
import type { LiveProjectsState } from "@/lib/hub-projects/map";

type HubViewProps = {
  section?: HubSection;
  detail?: string;
  preview?: boolean;
  email?: string;
  demoData?: HubDemoData;
  publicDemo?: boolean;
  userKey: string;
  asOf: string;
  /** Real files from Supabase for signed-in users; absent for the preview and public demo identities. */
  filesState?: HubFilesState;
  /** Real calendar from Supabase on the calendar page; absent for the preview and public demo identities. */
  calendarState?: HubCalendarState;
  /** Role of a real login from the user management; demo logins take theirs from the demo data. */
  role?: HubRole | null;
  /** Logins and customers on the admin's user management page. */
  userManagement?: UserManagementState;
  /** Studio projects of a real login; absent for the preview, the public demo and the demo logins. */
  liveProjects?: LiveProjectsState;
  /** The assistant's proposals on the admin's "KI-Protokoll" page. */
  assistantLog?: AssistantLogState;
};

export function HubView({ section = "overview", detail, preview = false, email = "", demoData, publicDemo = false, userKey, asOf, filesState, calendarState, role = null, userManagement, liveProjects, assistantLog }: HubViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const projects = useMemo(() => preview ? previewProjects : demoData?.projects || liveProjects?.projects || [], [preview, demoData, liveProjects]);
  const fixtureFiles = useMemo(() => preview ? previewFiles : demoData?.files || [], [preview, demoData]);
  const populated = preview || Boolean(demoData);
  const admin = demoData ? demoData.role === "oalab_admin" : role === "oalab_admin";
  const liveFiles = filesState?.source === "supabase" && !filesState.error;
  const files = liveFiles ? filesState.files : fixtureFiles;
  const fileState: HubFilesState = useMemo(() => {
    if (filesState) return filesState;
    const customers = Array.from(new Map(fixtureFiles.flatMap((file) => file.customers).map((customer) => [customer.id, customer])).values());
    return { source: "fixtures", files: fixtureFiles, customers, folders: sampleFolders(customers), canManage: false };
  }, [filesState, fixtureFiles]);
  const calendar = useMemo(() => calendarState ?? calendarFixtures({ admin, customerNumber: preview ? previewAccount.customerNumber : demoData?.customerNumber ?? null }), [calendarState, admin, preview, demoData]);
  const favorites = useFavorites(userKey);
  const model = useMemo(() => buildHubModel({ preview, asOf, projects, files, populated, admin, completedSteps }), [preview, asOf, projects, files, populated, admin, completedSteps]);
  const selectedProject = projects.find((project) => project.id === searchParams.get("project"));

  const screen: ScreenProps = {
    model, preview, populated, asOf, projects, files, fileState, calendar, favorites, admin,
    liveProjects: !preview && !demoData ? liveProjects ?? null : null,
    firstName: demoData?.name.split(" ")[0] || (preview ? "Jana" : ""),
    company: demoData?.company,
    toggleStep: (id) => setCompletedSteps((value) => value.includes(id) ? value.filter((item) => item !== id) : [...value, id]),
  };

  return (
    <>
      {detail === "appearance" ? <AppearanceScreen preview={preview} />
        : detail && isMetricId(detail) ? <MetricDetailScreen {...screen} metricId={detail} />
        : section === "overview" ? <OverviewScreen {...screen} />
        : section === "insights" ? <InsightsScreen {...screen} />
        : section === "discover" ? <DiscoverScreen {...screen} />
        : section === "projects" ? <ProjectsScreen {...screen} />
        : section === "files" ? <FilesScreen {...screen} />
        : section === "messages" ? <MessagesScreen {...screen} />
        : section === "calendar" ? <CalendarScreen {...screen} />
        : section === "users" && userManagement ? <UserManagementScreen state={userManagement} />
        : section === "ai-log" && assistantLog ? <AssistantLogScreen state={assistantLog} />
        : section === "patch-notes" ? <PatchNotesScreen />
        : <ProfileScreen {...screen} email={email} publicDemo={publicDemo} />}
      {selectedProject && <ProjectModal project={selectedProject} preview={preview} admin={admin} onClose={() => router.replace(hubHref(preview, "projects"), { scroll: false })} />}
    </>
  );
}

const taskStatusLabels: Record<ProjectTask["status"], string> = { backlog: "Backlog", todo: "Offen", progress: "In Arbeit", review: "In Prüfung", done: "Erledigt" };

function ProjectModal({ project, preview, admin, onClose }: { project: Project; preview: boolean; admin: boolean; onClose: () => void }) {
  // Studio projects carry their tasks; the fixtures stay example projects with the example conversation.
  const tasks = project.tasks;
  const { manageUsers, askAboutProject, assistantDocked } = useHubShell();
  return (
    <Modal title={project.category || project.company || "Projekt"} onClose={onClose}>
      <div className="project-modal-status"><ProjectStatus value={project.status} /><span>Ziel: {project.date}</span></div>
      <h3 className="project-modal-title">{project.name}</h3>
      {project.description && <p className="modal-description">{project.description}</p>}
      <div className="project-modal-progress"><span>Projektfortschritt</span><strong className="numeric">{project.progress} %</strong></div>
      <div className="progress-bar" aria-hidden="true" style={{ background: `color-mix(in srgb, ${categories.projects.fill} 25%, transparent)` }}><span style={{ width: `${project.progress}%`, background: categories.projects.fill }} /></div>
      {tasks ? (
        tasks.length ? (
          <ul className="project-tasks" aria-label="Aufgaben">
            {tasks.map((task) => (
              <li key={task.id} className={task.status === "done" ? "is-done" : undefined}>
                <span className="project-task-title">{task.title}</span>
                <span className="project-task-meta">
                  {[taskStatusLabels[task.status], task.customer ? "Kunde" : "OALAB", task.dueOn ? `bis ${formatDeadline(task.dueOn)}` : "", admin && !task.visible ? "intern" : ""].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="modal-description t-secondary">Noch keine Aufgaben{admin ? "" : ", die für dich freigegeben sind"}.</p>
      ) : null}
      {/* The assistant keeps this project as its reference, so "dieses Projekt" works. As a window it opens on top of
          this dialog; docked it sits next to the page, and this dialog closes, because a dialog would block the sidebar. */}
      {tasks && manageUsers && (
        <button type="button" className="sheet-button project-ask" onClick={() => { askAboutProject({ id: project.id, name: project.category || project.name }); if (assistantDocked) onClose(); }}><Sparkles size={17} aria-hidden="true" /> Assistent zu diesem Projekt fragen</button>
      )}
      {!tasks && <>
        <p className="demo-detail-note"><Sparkles size={15} aria-hidden="true" /> Beispielprojekt · Die vollständige Projektverwaltung folgt im nächsten Schritt.</p>
        <Link className="sheet-button sheet-button-primary" href={hubHref(preview, "messages")}>Zum Gespräch <ArrowRight size={17} aria-hidden="true" /></Link>
      </>}
    </Modal>
  );
}
