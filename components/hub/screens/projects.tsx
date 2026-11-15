"use client";

import { HeaderActions } from "../app-shell";
import { LargeTitleHeader } from "../large-title-header";
import { EmptyState, LoadNotice } from "./overview";
import { ProjectsPanel } from "./projects-panel";
import { ProjectTable } from "./projects-table";
import { CategoryTitle } from "./workspace";
import type { ScreenProps } from "./types";

export function ProjectsScreen(props: ScreenProps) {
  const { preview, populated, projects, admin, asOf, liveProjects } = props;
  // Admins work customer by customer, like „Vertrag & Domain“: customers on the left, the chosen one's projects right.
  const panel = admin && !preview && !liveProjects?.error && projects.length > 0;
  return (
    <>
      <LargeTitleHeader title="Projekte" icon={<CategoryTitle category="projects" />} actions={<HeaderActions />} />
      {liveProjects?.error ? <LoadNotice text={liveProjects.error} />
        : panel ? <ProjectsPanel {...props} customers={liveProjects?.customers ?? []} />
        : populated || projects.length ? (
          <div className="sheet section-first sheet-fill">
            <ProjectTable projects={projects} admin={admin} asOf={asOf} preview={preview} />
          </div>
        ) : <EmptyState section="projects" />}
    </>
  );
}
