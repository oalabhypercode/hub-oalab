"use client";

import { FlaskConical, Globe } from "lucide-react";
import { categories } from "@/lib/categories";
import { deadlineHint, formatDeadline, type Project, type StudioProjectStatus } from "@/lib/hub-data";
import { customerSees, isWaiting, statusOf, studioStatusOrder, studioStatuses, veilCounts, veilOf } from "@/lib/hub-projects/desk";
import { shortUrl } from "@/lib/hub-projects/map";
import { MiniProgress } from "../list";
import { Select } from "../select";

/** Studio's five statuses as small signs, in the manner of the hub's StatusGlyph; the colour comes from the tone. */
export function StudioGlyph({ status, size = 14 }: { status: StudioProjectStatus; size?: number }) {
  return (
    <svg className={`status-glyph tone-${studioStatuses[status].tone}`} viewBox="0 0 14 14" width={size} height={size} aria-hidden="true">
      {status === "planning" && <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 1.9" />}
      {status === "active" && <><circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M7 3.4a3.6 3.6 0 0 1 0 7.2z" fill="currentColor" /></>}
      {status === "risk" && <><circle cx="7" cy="7" r="6.3" fill="currentColor" /><path d="M7 3.9v3.7" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" /><circle cx="7" cy="10.1" r="0.95" fill="#ffffff" /></>}
      {status === "hold" && <><circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M5.7 5.1v3.8M8.3 5.1v3.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></>}
      {status === "complete" && <><circle cx="7" cy="7" r="6.3" fill="currentColor" /><path d="m4.5 7.2 1.7 1.7 3.3-3.5" fill="none" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></>}
    </svg>
  );
}

/** The row classes of a project: its status veil and the open mark (the panel shows it). */
export function rowMarks(project: Project, current: boolean) {
  const veil = veilOf(statusOf(project));
  return `${veil ? ` has-veil veil-${veil}` : ""}${current ? " is-current" : ""}`;
}

/**
 * The status as a small, calm choice field: the row carries the colour, the field only the sign. It opens the hub's
 * own list with Studio's five statuses; picking one saves it right away. A click in it never opens the row.
 */
export function StatusPick({ project, busy, onChange }: { project: Project; busy: boolean; onChange: (status: StudioProjectStatus) => void }) {
  const status = statusOf(project);
  const waiting = isWaiting(project);
  return (
    <span className="pj-status-wrap" data-tip={busy ? "Wird gespeichert …" : "Status ändern"} data-tip-sub={`Kunde sieht: ${customerSees(status, waiting)}`}
      onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <Select
        variant="bare"
        chevron
        showLead
        className={`pj-status tone-${studioStatuses[status].tone}${busy ? " is-busy" : ""}`}
        label={`Status von ${project.name}`}
        value={status}
        disabled={busy}
        onChange={(next) => { if (next !== status) onChange(next as StudioProjectStatus); }}
        options={studioStatusOrder.map((item) => ({ value: item, label: studioStatuses[item].label, lead: <StudioGlyph status={item} />, meta: `Kunde: ${customerSees(item, waiting)}` }))}
      />
    </span>
  );
}

/** Live and test domain of a project right in its row: one click opens them, an empty one stays a faint sign. */
export function LinkButtons({ project }: { project: Pick<Project, "liveUrl" | "testUrl"> }) {
  const stop = (event: React.MouseEvent) => event.stopPropagation();
  return (
    <>
      {project.liveUrl
        ? <a className="pj-link-btn is-live" href={project.liveUrl} target="_blank" rel="noopener noreferrer" onClick={stop} aria-label={`Live-Domain ${shortUrl(project.liveUrl)} öffnen (neuer Tab)`} data-tip="Live-Domain öffnen" data-tip-sub={shortUrl(project.liveUrl)}><Globe size={16} aria-hidden="true" /></a>
        : <span className="pj-link-btn is-empty" data-tip="Keine Live-Domain"><Globe size={16} aria-hidden="true" /></span>}
      {project.testUrl
        ? <a className="pj-link-btn is-test" href={project.testUrl} target="_blank" rel="noopener noreferrer" onClick={stop} aria-label={`Testdomain ${shortUrl(project.testUrl)} öffnen (neuer Tab)`} data-tip="Testdomain öffnen" data-tip-sub={shortUrl(project.testUrl)}><FlaskConical size={16} aria-hidden="true" /></a>
        : <span className="pj-link-btn is-empty" data-tip="Keine Testdomain"><FlaskConical size={16} aria-hidden="true" /></span>}
    </>
  );
}

/** The target day with how much time is left; finished projects only show the day. */
export function DueCell({ project, asOf }: { project: Project; asOf: string }) {
  if (!project.dueOn) return <><span className="numeric pj-none">–</span><small>ohne Zieltermin</small></>;
  const done = statusOf(project) === "complete";
  const hint = deadlineHint(project.dueOn, done, asOf);
  return <><span className="numeric">{formatDeadline(project.dueOn)}</span>{!done && <small className={hint.endsWith("überfällig") ? "is-overdue" : undefined}>{hint}</small>}</>;
}

/** Progress as Studio counts it; without tasks or requests there is nothing to count yet. */
export function ProgressCell({ project }: { project: Project }) {
  if (project.progressBasis === "none") return <span className="pj-none" data-tip="Noch keine Aufgaben oder Anfragen">–</span>;
  const basis = project.progressBasis === "tasks"
    ? `${(project.tasks ?? []).filter((task) => task.status === "done").length} von ${project.tasks?.length ?? 0} Aufgaben erledigt`
    : `${project.requests?.done ?? 0} von ${(project.requests?.done ?? 0) + (project.requests?.open ?? 0)} Anfragen erledigt`;
  return <span className="progress-line" data-tip={basis}><MiniProgress value={project.progress} color={categories.projects.fill} /><span className="list-percent numeric">{project.progress} %</span></span>;
}

/** What the coloured rows mean and how many there are of each, like „ohne Zugang“ in the User Management. */
export function VeilKey({ projects, fallback }: { projects: readonly Project[]; fallback: string }) {
  const keys = veilCounts(projects.map(statusOf));
  if (!keys.length) return <>{fallback}</>;
  return (
    <span className="veil-keys">
      {keys.map((key) => <span key={key.status} className="veil-key"><span className={`veil-dot ${key.dot}`} aria-hidden="true" />{key.count} {key.label}</span>)}
    </span>
  );
}
