"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Sparkles } from "lucide-react";
import { categories } from "@/lib/categories";
import { hubHref, previewAccount, previewFiles, previewProjects, type HubDemoData, type HubSection, type Project } from "@/lib/hub-data";
import type { HubFilesState } from "@/lib/hub-files/types";
import { calendarFixtures } from "@/lib/hub-calendar/fixtures";
import type { HubCalendarState } from "@/lib/hub-calendar/types";
import { buildHubModel, isMetricId } from "@/lib/hub-metrics";
import { useFavorites } from "@/lib/use-favorites";
import { Modal } from "./modal";
import { ProjectStatus } from "./project-status";
import { AppearanceScreen } from "./screens/appearance";
import { CalendarScreen } from "./screens/calendar";
import { MetricDetailScreen } from "./screens/metric-detail";
import { InsightsScreen, OverviewScreen } from "./screens/overview";
import { FilesScreen } from "./screens/files";
import { DiscoverScreen, MessagesScreen, ProfileScreen, ProjectsScreen } from "./screens/workspace";
import type { ScreenProps } from "./screens/types";

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
};

export function HubView({ section = "overview", detail, preview = false, email = "", demoData, publicDemo = false, userKey, asOf, filesState, calendarState }: HubViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const projects = useMemo(() => preview ? previewProjects : demoData?.projects || [], [preview, demoData]);
  const fixtureFiles = useMemo(() => preview ? previewFiles : demoData?.files || [], [preview, demoData]);
  const populated = preview || Boolean(demoData);
  const admin = demoData?.role === "oalab_admin";
  const liveFiles = filesState?.source === "supabase" && !filesState.error;
  const files = liveFiles ? filesState.files : fixtureFiles;
  const fileState: HubFilesState = useMemo(() => filesState ?? {
    source: "fixtures",
    files: fixtureFiles,
    customers: Array.from(new Map(fixtureFiles.flatMap((file) => file.customers).map((customer) => [customer.id, customer])).values()),
    canManage: false,
  }, [filesState, fixtureFiles]);
  const calendar = useMemo(() => calendarState ?? calendarFixtures({ admin, customerNumber: preview ? previewAccount.customerNumber : demoData?.customerNumber ?? null }), [calendarState, admin, preview, demoData]);
  const favorites = useFavorites(userKey);
  const model = useMemo(() => buildHubModel({ preview, asOf, projects, files, populated, admin, completedSteps }), [preview, asOf, projects, files, populated, admin, completedSteps]);
  const selectedProject = projects.find((project) => project.id === searchParams.get("project"));

  const screen: ScreenProps = {
    model, preview, populated, projects, files, fileState, calendar, favorites, admin,
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
        : <ProfileScreen {...screen} email={email} publicDemo={publicDemo} />}
      {selectedProject && <ProjectModal project={selectedProject} preview={preview} onClose={() => router.replace(hubHref(preview, "projects"), { scroll: false })} />}
    </>
  );
}

function ProjectModal({ project, preview, onClose }: { project: Project; preview: boolean; onClose: () => void }) {
  return (
    <Modal title={project.category} onClose={onClose}>
      <div className="project-modal-status"><ProjectStatus value={project.status} /><span>Ziel: {project.date}</span></div>
      <h3 className="project-modal-title">{project.name}</h3>
      <p className="modal-description">{project.description}</p>
      <div className="project-modal-progress"><span>Projektfortschritt</span><strong className="numeric">{project.progress} %</strong></div>
      <div className="progress-bar" aria-hidden="true" style={{ background: `color-mix(in srgb, ${categories.projects.fill} 25%, transparent)` }}><span style={{ width: `${project.progress}%`, background: categories.projects.fill }} /></div>
      <p className="demo-detail-note"><Sparkles size={15} aria-hidden="true" /> Beispielprojekt · Die vollständige Projektverwaltung folgt im nächsten Schritt.</p>
      <Link className="sheet-button sheet-button-primary" href={hubHref(preview, "messages")}>Zum Gespräch <ArrowRight size={17} aria-hidden="true" /></Link>
    </Modal>
  );
}
