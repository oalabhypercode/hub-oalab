"use client";

import type { ProjectDesk } from "@/lib/hub-projects/desk";
import { HeaderActions } from "../app-shell";
import { LargeTitleHeader } from "../large-title-header";
import { useRefreshOnReturn } from "../use-refresh-on-return";
import { EmptyState, LoadNotice } from "./overview";
import { ProjectsPanel } from "./projects-panel";
import { ProjectTable } from "./projects-table";
import { CategoryTitle } from "./workspace";
import type { ScreenProps } from "./types";

export function ProjectsScreen(props: ScreenProps & { desk?: ProjectDesk }) {
  const { preview, populated, projects, admin, asOf, liveProjects, desk } = props;
  // Admins work customer by customer, like „Vertrag & Domain“: every customer on the left, the chosen one's projects,
  // domains and Service on the right. Customers (and the preview) keep their table.
  const panel = admin && !preview && !liveProjects?.error && desk && !desk.error ? desk : null;
  // Changes made elsewhere meanwhile (Studio, a colleague, Claude) show when the page is opened again.
  useRefreshOnReturn(!preview);
  return (
    <>
      <LargeTitleHeader title="Projekte" icon={<CategoryTitle category="projects" />} actions={<HeaderActions />} />
      {liveProjects?.error ? <LoadNotice text={liveProjects.error} />
        : admin && desk?.error ? <LoadNotice text={desk.error} />
        : panel ? <ProjectsPanel {...props} desk={panel} />
        : populated || projects.length ? (
          <div className="sheet section-first sheet-fill">
            <ProjectTable projects={projects} admin={admin} asOf={asOf} preview={preview} />
          </div>
        ) : <EmptyState section="projects" />}
    </>
  );
}
