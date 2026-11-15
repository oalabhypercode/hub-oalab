"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpDown, Building2, Layers, ListFilter, Rows3 } from "lucide-react";
import { categories } from "@/lib/categories";
import { currentMilestone, deadlineHint, formatDeadline, hubHref, type Project } from "@/lib/hub-data";
import { matchesSearch, sortRows, type SortState, type SortValue } from "@/lib/table-tools";
import { SegmentedControl } from "../controls";
import { MiniProgress } from "../list";
import { MenuChoices, SheetEmpty, SheetFooter, SheetToolbar, StatusGlyph, TableGroup, ToolbarMenu, useCollapsedGroups, type GlyphKind } from "../sheet";
import { alphabetical, FilterSelect, SortControl, SortHeader, type SortOption } from "../table-tools";

const filters = ["Alle Projekte", "Aktiv", "Abgeschlossen"] as const;
const ALL = "all";

type ProjectSortKey = "deadline" | "start" | "title" | "area" | "status" | "progress" | "customer";
const projectSorts: Record<ProjectSortKey, SortOption<ProjectSortKey>> = {
  deadline: { id: "deadline", label: "Nächster Termin", dirLabels: { asc: "früheste zuerst", desc: "späteste zuerst" } },
  start: { id: "start", label: "Startzeitpunkt", dirLabels: { asc: "früheste zuerst", desc: "späteste zuerst" } },
  title: { id: "title", label: "Titel", dirLabels: alphabetical },
  area: { id: "area", label: "Bereich", dirLabels: alphabetical },
  status: { id: "status", label: "Status" },
  progress: { id: "progress", label: "Fortschritt", firstDir: "desc", dirLabels: { asc: "niedrigster zuerst", desc: "höchster zuerst" } },
  customer: { id: "customer", label: "Kunde", dirLabels: alphabetical },
};
// "Dein Feedback" first: that is where the customer has to act.
const statusRank: Record<Project["status"], number> = { "Dein Feedback": 0, "In Umsetzung": 1, Abgeschlossen: 2 };
const projectSortValue: Record<ProjectSortKey, (project: Project) => SortValue> = {
  // Projects without a date sort after every dated one.
  deadline: (project) => project.dueOn ?? "9999-12-31",
  start: (project) => project.startedOn ?? "9999-12-31",
  title: (project) => project.name,
  area: (project) => project.category,
  status: (project) => statusRank[project.status],
  progress: (project) => project.progress,
  customer: (project) => project.company ?? "",
};

const projectGroups: Project["status"][] = ["Dein Feedback", "In Umsetzung", "Abgeschlossen"];
export const projectGlyph: Record<Project["status"], GlyphKind> = { "Dein Feedback": "feedback", "In Umsetzung": "progress", Abgeschlossen: "done" };
type ProjectGrouping = "status" | "none";

/**
 * Every project in one table with search, filters, sorting and groups. Customers see it as their page; admins as the
 * „Überblick“ of the project panel, where a row opens the project in the panel (`onOpen`) instead of a dialog.
 */
export function ProjectTable({ projects, admin, asOf, preview, onOpen, scrollClass = "sheet-scroll" }: {
  projects: Project[];
  admin: boolean;
  asOf: string;
  preview: boolean;
  onOpen?: (project: Project) => void;
  scrollClass?: string;
}) {
  const [filter, setFilter] = useState<(typeof filters)[number]>("Alle Projekte");
  const [companyFilter, setCompanyFilter] = useState(ALL);
  const [areaFilter, setAreaFilter] = useState(ALL);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState<ProjectSortKey>>({ key: "deadline", dir: "asc" });
  const [grouping, setGrouping] = useState<ProjectGrouping>("status");
  const groups = useCollapsedGroups();
  const matches = (item: (typeof filters)[number], status: string) => item === "Alle Projekte" || (item === "Aktiv" ? status !== "Abgeschlossen" : status === "Abgeschlossen");
  const areas = Array.from(new Set(projects.flatMap((project) => project.category ? [project.category] : []))).sort();
  // Studio projects have no area, so the column and its filter only appear for the fixtures.
  const showArea = areas.length > 0;
  const companies = Array.from(new Set(projects.flatMap((project) => project.company ? [project.company] : []))).sort();
  // Search, area and customer narrow the list; the status filter counts within that result.
  const found = projects.filter((project) => {
    const milestone = currentMilestone(project, asOf);
    return (areaFilter === ALL || project.category === areaFilter) && (companyFilter === ALL || project.company === companyFilter)
      && matchesSearch(query, [project.category, project.name, admin ? project.company : null, milestone?.title, milestone?.description, project.status, formatDeadline(project.startedOn), formatDeadline(project.dueOn), project.liveUrl, project.testUrl]);
  });
  // Completed projects stay at the end whatever the sort, so running and completed work stay apart.
  const shown = sortRows(found.filter((project) => matches(filter, project.status)), projectSortValue[sort.key], sort.dir, {
    group: (project) => Number(project.status === "Abgeschlossen"),
    tieBreak: (project) => project.name,
  });
  const sortOptions = Object.values(projectSorts).filter((option) => (admin || option.id !== "customer") && (showArea || option.id !== "area"));
  const menuFilters = [areaFilter !== ALL, companyFilter !== ALL].filter(Boolean).length;
  const narrowed = query.trim() !== "" || filter !== "Alle Projekte" || menuFilters > 0;
  const reset = () => { setQuery(""); setAreaFilter(ALL); setCompanyFilter(ALL); setFilter("Alle Projekte"); };
  const columns = 6 + (admin ? 1 : 0) + (showArea ? 1 : 0);

  const row = (project: Project) => {
    const milestone = currentMilestone(project, asOf);
    const done = project.status === "Abgeschlossen";
    const hint = deadlineHint(project.dueOn, done, asOf);
    const href = `${hubHref(preview, "projects")}?project=${project.id}`;
    return (
      <tr key={project.id} className={`project-row${done ? " is-done" : ""}`}>
        {admin && <td className="cell-customer">{project.company ?? "–"}</td>}
        <td className="cell-project">
          <span className="cell-title"><StatusGlyph kind={projectGlyph[project.status]} />
            <Link href={href} className="project-card" onClick={onOpen ? (event) => {
              // A plain click opens the project in the panel; a middle click or ⌘-click still opens a new tab.
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              onOpen(project);
            } : undefined}>{project.name}</Link>
          </span>
        </td>
        {showArea && <td className="cell-area col-area">{project.category}</td>}
        {/* One fact per cell: the milestone's title; its description is in the project dialog and in the tooltip. */}
        <td className="cell-milestone" data-tip={milestone?.description || undefined}>{milestone ? milestone.title : <span className="cell-none">Noch kein Meilenstein</span>}</td>
        <td className="cell-status col-status">{project.status}</td>
        <td className="cell-start col-start"><span className="cell-start-label">Start </span><span className="numeric">{formatDeadline(project.startedOn)}</span></td>
        <td className="cell-deadline">
          {project.dueOn ? (
            <Link className="deadline-link" href={`${hubHref(preview, "calendar")}?day=${project.dueOn}`} title="Im Kalender anzeigen" aria-label={`Nächster Termin ${formatDeadline(project.dueOn)} im Kalender anzeigen`}>
              <span className="numeric">{formatDeadline(project.dueOn)}</span>
            </Link>
          ) : <span className="numeric cell-none">–</span>}
          {!done && <small className={hint.endsWith("überfällig") ? "is-overdue" : undefined}>{hint}</small>}
        </td>
        <td className="cell-progress">
          <span className="progress-line"><MiniProgress value={project.progress} color={categories.projects.fill} /><span className="list-percent numeric">{project.progress} %</span></span>
        </td>
      </tr>
    );
  };

  return (
    <>
      <SheetToolbar query={query} onQuery={setQuery} placeholder="Projekte durchsuchen" label="Projekte durchsuchen"
        trailing={<SegmentedControl label="Projekte filtern" value={filter} onChange={setFilter} options={filters.map((item) => {
          const count = found.filter((project) => matches(item, project.status)).length;
          return { id: item, label: item === "Alle Projekte" ? "Alle" : item, count, name: `${item}: ${count}` };
        })} />}>
        {(showArea || admin) && (
          <ToolbarMenu icon={ListFilter} label="Filter" badge={menuFilters}>
            {showArea && <FilterSelect icon={Layers} name="Nach Bereich filtern" value={areaFilter} onChange={setAreaFilter} options={[{ value: ALL, label: "Alle Bereiche" }, ...areas.map((area) => ({ value: area, label: area }))]} />}
            {admin && <FilterSelect icon={Building2} name="Kunden filtern" value={companyFilter} onChange={setCompanyFilter} options={[{ value: ALL, label: "Alle Kunden" }, ...companies.map((company) => ({ value: company, label: company }))]} />}
          </ToolbarMenu>
        )}
        <ToolbarMenu icon={ArrowUpDown} label="Sortierung" value={projectSorts[sort.key].label}><SortControl options={sortOptions} sort={sort} onChange={setSort} /></ToolbarMenu>
        <ToolbarMenu icon={Rows3} label="Gruppe" value={grouping === "status" ? "Status" : "Keine"}>
          <MenuChoices label="Gruppieren nach" value={grouping} onChange={setGrouping} options={[{ id: "status", label: "Status" }, { id: "none", label: "Keine Gruppen" }]} />
        </ToolbarMenu>
      </SheetToolbar>
      {shown.length ? (
        <div className={scrollClass}>
          <table className="project-table">
            <caption className="visually-hidden">{admin ? "Projekte mit Kunde, " : "Projekte mit "}{showArea ? "Bereich, " : ""}aktuellem Meilenstein, Status, Startzeitpunkt, nächstem Termin und Fortschritt</caption>
            <thead>
              <tr>
                {/* Admins see every customer's projects, so the customer leads the row. */}
                {admin && <SortHeader option={projectSorts.customer} sort={sort} onChange={setSort} />}
                <SortHeader option={projectSorts.title} label="Projekt" sort={sort} onChange={setSort} />
                {showArea && <SortHeader option={projectSorts.area} className="col-area" sort={sort} onChange={setSort} />}
                <th scope="col" className="col-milestone">Meilenstein</th>
                <SortHeader option={projectSorts.status} className="col-status" sort={sort} onChange={setSort} />
                <SortHeader option={projectSorts.start} label="Start" className="col-start" sort={sort} onChange={setSort} />
                <SortHeader option={projectSorts.deadline} sort={sort} onChange={setSort} />
                <SortHeader option={projectSorts.progress} className="col-progress" sort={sort} onChange={setSort} />
              </tr>
            </thead>
            {grouping === "status" ? projectGroups.map((status) => {
              const rows = shown.filter((project) => project.status === status);
              return rows.length ? (
                <TableGroup key={status} colSpan={columns} label={status} count={rows.length} glyph={<StatusGlyph kind={projectGlyph[status]} />} collapsed={groups.isCollapsed(status)} onToggle={() => groups.toggle(status)}>
                  {rows.map(row)}
                </TableGroup>
              ) : null;
            }) : <tbody>{shown.map(row)}</tbody>}
          </table>
        </div>
      ) : <SheetEmpty text={query.trim() ? `Keine Projekte zu „${query.trim()}“.` : "Keine Projekte für diesen Filter."} onReset={narrowed ? reset : undefined} />}
      <SheetFooter hint="Ein Klick auf eine Zeile öffnet das Projekt">{shown.length === 1 ? "1 Projekt" : `${shown.length} Projekte`}</SheetFooter>
    </>
  );
}
