"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Check, FileText, Sparkles } from "lucide-react";
import { categories } from "@/lib/categories";
import { hubHref, previewFiles, previewProjects, type HubDemoData, type HubFile, type HubSection, type Project } from "@/lib/hub-data";
import { buildHubModel, isMetricId } from "@/lib/hub-metrics";
import { useFavorites } from "@/lib/use-favorites";
import { Modal } from "./modal";
import { ProjectStatus } from "./project-status";
import { AppearanceScreen } from "./screens/appearance";
import { MetricDetailScreen } from "./screens/metric-detail";
import { InsightsScreen, OverviewScreen } from "./screens/overview";
import { DiscoverScreen, FilesScreen, MessagesScreen, ProfileScreen, ProjectsScreen } from "./screens/workspace";
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
};

export function HubView({ section = "overview", detail, preview = false, email = "", demoData, publicDemo = false, userKey, asOf }: HubViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [file, setFile] = useState<HubFile | null>(null);
  const projects = useMemo(() => preview ? previewProjects : demoData?.projects || [], [preview, demoData]);
  const files = useMemo(() => preview ? previewFiles : demoData?.files || [], [preview, demoData]);
  const populated = preview || Boolean(demoData);
  const admin = demoData?.role === "oalab_admin";
  const favorites = useFavorites(userKey);
  const model = useMemo(() => buildHubModel({ preview, asOf, projects, files, populated, admin, completedSteps }), [preview, asOf, projects, files, populated, admin, completedSteps]);
  const selectedProject = projects.find((project) => project.id === searchParams.get("project"));

  const screen: ScreenProps = {
    model, preview, populated, projects, files, favorites, admin,
    firstName: demoData?.name.split(" ")[0] || (preview ? "Jana" : ""),
    company: demoData?.company,
    toggleStep: (id) => setCompletedSteps((value) => value.includes(id) ? value.filter((item) => item !== id) : [...value, id]),
    openFile: setFile,
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
        : <ProfileScreen {...screen} email={email} publicDemo={publicDemo} />}
      {selectedProject && <ProjectModal project={selectedProject} preview={preview} onClose={() => router.replace(hubHref(preview, "projects"), { scroll: false })} />}
      {file && (
        <Modal title="Dateiinformationen" onClose={() => setFile(null)}>
          <div className="modal-file-icon" style={{ color: categories.files.fill }}><FileText size={34} strokeWidth={1.8} aria-hidden="true" /></div>
          <h3 className="project-modal-title">{file.name}</h3>
          <dl className="file-details"><div><dt>Projekt</dt><dd>{file.project}</dd></div><div><dt>Dateigröße</dt><dd>{file.size}</dd></div><div><dt>Geändert</dt><dd>{file.date}</dd></div></dl>
          <p className="help-note">Beispieldatei für Frontend-Tests. Echte Uploads, Vorschauen und Downloads werden mit der Dateianbindung ergänzt.</p>
          <button className="sheet-button sheet-button-primary" onClick={() => setFile(null)}>Verstanden <Check size={17} aria-hidden="true" /></button>
        </Modal>
      )}
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
