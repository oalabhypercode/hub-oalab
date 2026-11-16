"use client";

import { useState } from "react";
import { ArrowUpDown, ArrowUpRight, Hand, Rows3 } from "lucide-react";
import type { CustomerLogo } from "@/lib/hub-logos/rules";
import type { Project, StudioProjectStatus } from "@/lib/hub-data";
import { isRunning, isWaiting, nextMilestone, statusOf, studioGroupOrder, studioStatuses } from "@/lib/hub-projects/desk";
import { matchesSearch, sortRows, type SortState, type SortValue } from "@/lib/table-tools";
import { SegmentedControl } from "../controls";
import { MenuChoices, SheetEmpty, SheetFooter, SheetToolbar, TableGroup, ToolbarMenu, useCollapsedGroups } from "../sheet";
import { alphabetical, SortControl, SortHeader, type SortOption } from "../table-tools";
import { CustomerSign } from "./customer-sign";
import { DueCell, LinkButtons, ProgressCell, rowMarks, StatusPick, StudioGlyph, VeilKey } from "./projects-parts";

type Show = "all" | "running" | "hold" | "done";
type SortKey = "due" | "customer" | "name" | "progress";
type Grouping = "status" | "customer" | "none";

const sorts: Record<SortKey, SortOption<SortKey>> = {
  due: { id: "due", label: "Zieltermin", dirLabels: { asc: "früheste zuerst", desc: "späteste zuerst" } },
  customer: { id: "customer", label: "Kunde", dirLabels: alphabetical },
  name: { id: "name", label: "Projekt", dirLabels: alphabetical },
  progress: { id: "progress", label: "Fortschritt", firstDir: "desc", dirLabels: { asc: "niedrigster zuerst", desc: "höchster zuerst" } },
};
const sortValue: Record<SortKey, (project: Project) => SortValue> = {
  // Projects without a target day sort after every dated one.
  due: (project) => project.dueOn ?? "9999-12-31",
  customer: (project) => project.company ?? "",
  name: (project) => project.name,
  progress: (project) => project.progressBasis === "none" ? -1 : project.progress,
};
const shows: { id: Show; label: string; test: (status: StudioProjectStatus) => boolean }[] = [
  { id: "all", label: "Alle", test: () => true },
  { id: "running", label: "Laufend", test: isRunning },
  { id: "hold", label: "Pausiert", test: (status) => status === "hold" },
  { id: "done", label: "Fertig", test: (status) => status === "complete" },
];
const groupings: { id: Grouping; label: string; short: string }[] = [
  { id: "status", label: "Status", short: "Status" },
  { id: "customer", label: "Kunde", short: "Kunde" },
  { id: "none", label: "Keine Gruppen", short: "Keine" },
];

/**
 * „Alle Projekte“ of the admins' project page: every project of every customer, with the customer leading, the status
 * to change right in the row and its colour over the row. A click on the customer opens the customer, a click on the
 * project its panel. Customers keep their own table (ProjectTable).
 */
export function ProjectsOverview({ projects, keyOf, logos, asOf, current, busy, locked, onOpen, onCustomer, onStatus }: {
  projects: Project[];
  /** The customer entry a project belongs to in the list on the left. */
  keyOf: (project: Project) => string;
  logos: Map<string, CustomerLogo>;
  asOf: string;
  current: string | null;
  busy: string | null;
  /** The session has not confirmed a code: the status only shows. */
  locked: boolean;
  onOpen: (project: Project) => void;
  onCustomer: (key: string) => void;
  onStatus: (project: Project, status: StudioProjectStatus) => void;
}) {
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "due", dir: "asc" });
  const [grouping, setGrouping] = useState<Grouping>("status");
  const groups = useCollapsedGroups();

  const found = projects.filter((project) => matchesSearch(query, [project.name, project.company, studioStatuses[statusOf(project)].label, nextMilestone(project, asOf)?.title, project.liveUrl, project.testUrl]));
  const test = shows.find((item) => item.id === show)!.test;
  // Finished projects stay at the end whatever the sort, so running and finished work stay apart.
  const shown = sortRows(found.filter((project) => test(statusOf(project))), sortValue[sort.key], sort.dir, {
    group: (project) => Number(statusOf(project) === "complete"),
    tieBreak: (project) => project.name,
  });
  const byCustomer = grouping === "customer";
  const columns = byCustomer ? 7 : 8;
  const narrowed = query.trim() !== "" || show !== "all";

  const row = (project: Project) => {
    const status = statusOf(project);
    const milestone = nextMilestone(project, asOf);
    const key = keyOf(project);
    const open = (event: React.MouseEvent) => {
      // A plain click opens the panel; a middle click or ⌘-click still opens the address in a new tab.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      onOpen(project);
    };
    return (
      <tr key={project.id} className={`project-row${status === "complete" ? " is-done" : ""}${rowMarks(project, current === project.id)}`}>
        {!byCustomer && (
          <td className="cell-customer">
            <button type="button" className="pj-customer-link" onClick={() => onCustomer(key)} data-tip={`${project.company ?? "Kunde"} öffnen`}>
              <CustomerSign customer={{ id: key, company: project.company ?? "?" }} logo={logos.get(key) ?? null} size="xs" /><span>{project.company ?? "Ohne Kunde"}</span>
            </button>
          </td>
        )}
        <td className="cell-project">
          <span className="cell-title"><StudioGlyph status={status} />
            <a className="project-card" href={`?project=${project.id}`} onClick={open}>{project.name}</a>
            {isWaiting(project) && isRunning(status) && <span className="pj-turn" data-tip="Kunde am Zug" data-tip-sub="Eine Aufgabe liegt beim Kunden"><Hand size={15} aria-hidden="true" /></span>}
          </span>
        </td>
        <td className="pj-cell-status"><StatusPick project={project} busy={busy === project.id} locked={locked} onChange={(next) => onStatus(project, next)} /></td>
        <td className="cell-milestone pj-col-ms" data-tip={milestone?.description || undefined}>{milestone ? milestone.title : <span className="cell-none">–</span>}</td>
        <td className="pj-cell-due pj-col-due"><DueCell project={project} asOf={asOf} /></td>
        <td className="pj-col-progress"><ProgressCell project={project} /></td>
        <td className="pj-col-links pj-cell-links"><LinkButtons project={project} /></td>
      </tr>
    );
  };

  const body = grouping === "status"
    ? studioGroupOrder.map((status) => {
      const rows = shown.filter((project) => statusOf(project) === status);
      return rows.length ? (
        <TableGroup key={status} colSpan={columns} label={studioStatuses[status].label} count={rows.length} glyph={<StudioGlyph status={status} />} collapsed={groups.isCollapsed(status)} onToggle={() => groups.toggle(status)}>
          {rows.map(row)}
        </TableGroup>
      ) : null;
    })
    : byCustomer
      ? [...new Set(shown.map(keyOf))].map((key) => ({ key, rows: shown.filter((project) => keyOf(project) === key) }))
        .sort((a, b) => (a.rows[0].company ?? "").localeCompare(b.rows[0].company ?? "", "de"))
        .map(({ key, rows }) => (
          <TableGroup key={key} colSpan={columns} label={rows[0].company ?? "Ohne Kunde"} count={rows.length} glyph={<CustomerSign customer={{ id: key, company: rows[0].company ?? "?" }} logo={logos.get(key) ?? null} size="xs" />}
            collapsed={groups.isCollapsed(`customer-${key}`)} onToggle={() => groups.toggle(`customer-${key}`)}
            actions={<button type="button" className="table-group-action" onClick={() => onCustomer(key)} data-tip={`${rows[0].company ?? "Kunde"} öffnen`} aria-label={`${rows[0].company ?? "Kunde"} öffnen`}><ArrowUpRight size={15} aria-hidden="true" /></button>}>
            {rows.map(row)}
          </TableGroup>
        ))
      : <tbody>{shown.map(row)}</tbody>;

  return (
    <>
      <SheetToolbar query={query} onQuery={setQuery} placeholder="Suchen …" label="Projekte nach Projekt, Kunde, Status oder Domain durchsuchen"
        trailing={<SegmentedControl label="Projekte filtern" value={show} onChange={setShow} options={shows.map((item) => {
          const count = found.filter((project) => item.test(statusOf(project))).length;
          return { id: item.id, label: item.label, count, name: `${item.label}: ${count}` };
        })} />}>
        <ToolbarMenu icon={ArrowUpDown} label="Sortierung" value={sorts[sort.key].label}><SortControl options={Object.values(sorts).filter((option) => !byCustomer || option.id !== "customer")} sort={sort} onChange={setSort} /></ToolbarMenu>
        <ToolbarMenu icon={Rows3} label="Gruppe" value={groupings.find((item) => item.id === grouping)!.short}>
          <MenuChoices label="Gruppieren nach" value={grouping} onChange={setGrouping} options={groupings.map((item) => ({ id: item.id, label: item.label }))} />
        </ToolbarMenu>
      </SheetToolbar>
      {shown.length ? (
        <div className="am-scroll pj-ov">
          <table className="project-table">
            <caption className="visually-hidden">Alle Projekte mit Kunde, Status, nächstem Meilenstein, Zieltermin, Fortschritt und Domains</caption>
            <thead>
              <tr>
                {!byCustomer && <SortHeader option={sorts.customer} sort={sort} onChange={setSort} />}
                <SortHeader option={sorts.name} sort={sort} onChange={setSort} />
                <th scope="col">Status</th>
                <th scope="col" className="pj-col-ms">Meilenstein</th>
                <SortHeader option={sorts.due} className="pj-col-due" sort={sort} onChange={setSort} />
                <SortHeader option={sorts.progress} className="pj-col-progress" sort={sort} onChange={setSort} />
                <th scope="col" className="pj-col-links">Domains</th>
              </tr>
            </thead>
            {body}
          </table>
        </div>
      ) : <SheetEmpty text={query.trim() ? `Keine Projekte zu „${query.trim()}“.` : "Keine Projekte für diesen Filter."} onReset={narrowed ? () => { setQuery(""); setShow("all"); } : undefined} />}
      <SheetFooter hint={<VeilKey projects={shown} fallback="Ein Klick auf den Kunden öffnet ihn, auf das Projekt alle Angaben" />}>{shown.length === 1 ? "1 Projekt" : `${shown.length} Projekte`}</SheetFooter>
    </>
  );
}
