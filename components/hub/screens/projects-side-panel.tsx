"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleCheck, CircleDot, ExternalLink, Eye, EyeOff, FlaskConical, Globe, Hand, Milestone, Save, Sparkles, SquareKanban, Target } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { formatDeadline, type Project, type ProjectTask, type StudioProjectStatus } from "@/lib/hub-data";
import { customerSees, isWaiting, nextMilestone, statusOf, studioStatusOrder, studioStatuses } from "@/lib/hub-projects/desk";
import { shortUrl } from "@/lib/hub-projects/map";
import { saveProjectUrls } from "@/lib/hub-projects/actions";
import { CopyButton } from "./contracts-domains";
import { useContractAction } from "./contracts-parts";
import { AssetPanel } from "./asset-panel";
import { StudioGlyph } from "./projects-parts";
import { PanelSection } from "./users-panel";

const taskLabel: Record<ProjectTask["status"], string> = { backlog: "Backlog", todo: "Offen", progress: "In Arbeit", review: "In Prüfung", done: "Erledigt" };

/**
 * Everything about one project at the right edge, like the User Management's panel: the status to set with one click,
 * its live and test domain, what Studio holds about it (description, dates, milestones) and its open tasks with the way
 * to its task board. The customers and the list stay usable next to it; Escape or the cross closes it.
 */
export function ProjectSidePanel({ project, asOf, busy, boardHref, onStatus, onAsk, onClose, onSaved }: {
  project: Project;
  asOf: string;
  busy: boolean;
  /** The project's board under Projekte › Aufgaben, where its tasks are moved, created and edited. */
  boardHref: string;
  onStatus: (status: StudioProjectStatus) => void;
  onAsk?: () => void;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const status = statusOf(project);
  const waiting = isWaiting(project);
  const [draft, setDraft] = useState({ live: project.liveUrl ?? "", test: project.testUrl ?? "" });
  const { busy: saving, error, run } = useContractAction();
  const dirty = draft.live.trim() !== (project.liveUrl ?? "") || draft.test.trim() !== (project.testUrl ?? "");
  const tasks = project.tasks ?? [];
  const open = tasks.filter((task) => task.status !== "done");
  const next = nextMilestone(project, asOf);
  const disabled = saving !== null;

  const save = () => run("save", () => saveProjectUrls({ projectId: project.id, liveUrl: draft.live, testUrl: draft.test }), (saved) => {
    setDraft({ live: saved.liveUrl ?? "", test: saved.testUrl ?? "" });
    onSaved(`Domains von „${project.name}“ gespeichert.`);
  });
  const footer = dirty ? (
    <>
      <span className="um-foot-state is-dirty">Nicht gespeichert</span>
      <button type="button" className="sheet-action is-quiet" onClick={() => setDraft({ live: project.liveUrl ?? "", test: project.testUrl ?? "" })} disabled={disabled}>Verwerfen</button>
      <button type="button" className="sheet-action is-primary" onClick={save} disabled={disabled}>{saving ? <MiniLoader size={15} /> : <Save size={15} aria-hidden="true" />}Speichern</button>
    </>
  ) : undefined;

  const urlField = (kind: "live" | "test") => {
    const value = draft[kind];
    const stored = kind === "live" ? project.liveUrl : project.testUrl;
    const Icon = kind === "live" ? Globe : FlaskConical;
    const label = kind === "live" ? "Live-Domain" : "Testdomain";
    return (
      <div className="um-field is-wide">
        <span className="am-label">{label}</span>
        <label className={`pj-url is-${kind}`}>
          <Icon size={16} aria-hidden="true" />
          <input value={value} onChange={(event) => setDraft({ ...draft, [kind]: event.target.value })} placeholder={kind === "live" ? "kunde.de" : "test.kunde.de"} aria-label={label}
            inputMode="url" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={2048} disabled={disabled} />
          {stored && value.trim() === stored && <>
            <a className="row-action" href={stored} target="_blank" rel="noopener noreferrer" aria-label={`${label} ${shortUrl(stored)} öffnen (neuer Tab)`} data-tip="Öffnen" data-tip-sub="neuer Tab"><ExternalLink size={15} aria-hidden="true" /></a>
            <CopyButton value={stored} label={label} />
          </>}
        </label>
        <small className="pj-form-hint">{kind === "live" ? "Die echte Website; dieselbe Adresse wie „Live schalten“ auf der Serviceplattform." : "Hier landen Service-Änderungen zuerst, bevor der Kunde sie freigibt."}</small>
      </div>
    );
  };

  return (
    <AssetPanel className="um-panel pj-panel" label={`Projekt ${project.name}`} title={project.name} onClose={onClose} footer={footer}
      icon={<span className={`pj-glyph is-lg tone-${studioStatuses[status].tone}`}><StudioGlyph status={status} size={18} /></span>}
      subtitle={`${project.company ?? "Ohne Kunde"} · ${studioStatuses[status].label}`}
      actions={onAsk && <button type="button" className="chat-icon-button is-muted" onClick={onAsk} aria-label="Assistent zu diesem Projekt fragen" data-tip="Assistent zu diesem Projekt fragen"><Sparkles size={18} aria-hidden="true" /></button>}>
      <PanelSection title="Status" meta="wirkt sofort, auch im Studio">
        <div className="pj-status-pick" role="group" aria-label="Status">
          {studioStatusOrder.map((item) => (
            <button key={item} type="button" aria-pressed={status === item} className={`pj-pick tone-${studioStatuses[item].tone}`} onClick={() => { if (item !== status) onStatus(item); }} disabled={busy}>
              <StudioGlyph status={item} size={16} /><span>{studioStatuses[item].label}</span>
            </button>
          ))}
        </div>
        <p className="pj-pick-hint">{busy ? <MiniLoader size={14} /> : <Eye size={14} aria-hidden="true" />}<span>Der Kunde sieht: <b>{customerSees(status, waiting)}</b>{waiting && status !== "complete" ? " (eine Aufgabe liegt bei ihm)" : ""}</span></p>
        {project.studio?.visible === false && <p className="pj-pick-hint"><EyeOff size={14} aria-hidden="true" /><span>Der Kunde sieht dieses Projekt noch nicht; freigegeben wird es im Studio.</span></p>}
      </PanelSection>
      <PanelSection title="Domains & Links" meta="ein Klick öffnet die Seite">
        <div className="pj-fields">{urlField("live")}{urlField("test")}</div>
        {error && <p className="form-error" role="alert">{error}</p>}
      </PanelSection>
      <PanelSection title="Projekt" meta="pflegt das Team im Studio">
        <dl className="pj-facts">
          <div><dt>Beschreibung</dt><dd>{project.description || <span className="pj-none">Keine Beschreibung</span>}</dd></div>
          <div><dt>Start</dt><dd className="numeric">{formatDeadline(project.startedOn)}</dd></div>
          <div><dt>Ziel</dt><dd className="numeric">{formatDeadline(project.dueOn)}</dd></div>
        </dl>
      </PanelSection>
      <PanelSection title="Meilensteine" meta={project.milestones.length ? `${project.milestones.length}` : undefined}>
        {project.milestones.length ? (
          <ul className="pj-ms-list">
            {project.milestones.map((milestone, index) => {
              const past = milestone.at.slice(0, 10) < asOf;
              const isNext = next === milestone;
              const Mark = past ? CircleCheck : isNext ? Target : Milestone;
              return (
                <li key={`${milestone.at}-${index}`} className={`${past ? "is-past" : ""}${isNext ? " is-next" : ""}`}>
                  <span className="pj-ms-mark"><Mark size={16} aria-hidden="true" /></span><span>{milestone.title}</span><time className="numeric" dateTime={milestone.at}>{formatDeadline(milestone.at.slice(0, 10))}</time>
                </li>
              );
            })}
          </ul>
        ) : <p className="pj-empty">Noch keine Meilensteine im Studio.</p>}
      </PanelSection>
      <PanelSection title="Aufgaben" meta={tasks.length ? `${tasks.length - open.length} von ${tasks.length} erledigt` : undefined}
        action={<Link className="am-label-action" href={boardHref} data-tip="Aufgaben-Board dieses Projekts"><SquareKanban size={13} aria-hidden="true" />Zum Board</Link>}>
        {open.length ? (
          <ul className="pj-tasks">
            {open.map((task) => (
              <li key={task.id}>
                <span className="pj-task-mark">{task.customer ? <Hand size={15} aria-hidden="true" /> : <CircleDot size={15} aria-hidden="true" />}</span>
                <span>{task.title}</span>
                <small>{[`#${task.number}`, task.customer ? "Kunde" : "oalab", taskLabel[task.status], task.dueOn ? `bis ${formatDeadline(task.dueOn)}` : "", task.visible ? "" : "intern"].filter(Boolean).join(" · ")}</small>
              </li>
            ))}
          </ul>
        ) : <p className="pj-empty">{tasks.length ? "Alle Aufgaben erledigt." : "Noch keine Aufgaben. Im Board legst du welche an."}</p>}
      </PanelSection>
    </AssetPanel>
  );
}
