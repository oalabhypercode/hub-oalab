"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { CircleDot, Eye, Hand, Save, Sparkles, SquareKanban } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import type { Project, ProjectTask, StudioProjectStatus } from "@/lib/hub-data";
import { customerSees, isWaiting, statusOf, studioStatuses } from "@/lib/hub-projects/desk";
import { changesOf, draftOf, mergeDraft, readProjectDraft, sameDraft, type ProjectDraft, type ProjectFields, type ProjectPatch } from "@/lib/hub-projects/edit";
import { saveProjectDetails } from "@/lib/hub-projects/actions";
import { formatDeadline } from "@/lib/hub-data";
import { AssetPanel } from "./asset-panel";
import { DomainFields, FieldError, focusInvalid, MilestoneEditor, PanelError, ProjectFieldsSection, StatusPicks, VisibleRow, type DraftError } from "./projects-edit-parts";
import { StudioGlyph } from "./projects-parts";
import { PanelSection, SaveStatus, useDirtyReport } from "./users-panel";

const taskLabel: Record<ProjectTask["status"], string> = { backlog: "Backlog", todo: "Offen", progress: "In Arbeit", review: "In Prüfung", done: "Erledigt" };
const failed = "Das hat gerade nicht geklappt. Bitte versuche es erneut.";

/** The fields as Studio stores them, back in the panel's form („kunde.de“ now reads „https://kunde.de“). */
const asDraft = (fields: ProjectFields): ProjectDraft => ({
  name: fields.name,
  description: fields.description,
  startDate: fields.startDate ?? "",
  dueDate: fields.dueDate ?? "",
  liveUrl: fields.liveUrl ?? "",
  testUrl: fields.testUrl ?? "",
  milestones: fields.milestones.map((milestone, index) => ({ id: `s${index}`, ...milestone })),
});

/**
 * Everything about one project at the right edge, like the User Management's panel (Projekte V2 step 2): status and
 * visibility take effect at once, name, description, days, milestones and both domains wait for „Speichern“. The open
 * tasks lead to the project's board. The customers and the list stay usable next to it; Escape or the cross closes it,
 * and leaving with unsaved changes asks first (the page's `onDirty`).
 */
export function ProjectSidePanel({ project, asOf, busy, boardHref, onStatus, onVisible, onAsk, onClose, onSaved, onStale, onDirty }: {
  project: Project;
  asOf: string;
  /** A status or visibility change of this project is on its way. */
  busy: boolean;
  /** The project's board under Projekte › Aufgaben, where its tasks are moved, created and edited. */
  boardHref: string;
  onStatus: (status: StudioProjectStatus) => void;
  onVisible: (visible: boolean) => void;
  onAsk?: () => void;
  onClose: () => void;
  /** After „Speichern“: Studio's new version and what was saved, with the line for the page's notice. */
  onSaved: (saved: { version: number | null; patch: ProjectPatch }, message: string) => void;
  /** Studio holds a newer state: the page loads it, the panel keeps what is being typed. */
  onStale: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const status = statusOf(project);
  const waiting = isWaiting(project);
  // Without a Studio row the customer sees nothing of it yet, like Studio's default.
  const visible = project.studio?.visible === true;
  const stored = draftOf(project);
  const storedKey = JSON.stringify(stored);
  const [seen, setSeen] = useState(storedKey);
  const [base, setBase] = useState(stored);
  const [draft, setDraft] = useState(stored);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<DraftError | null>(null);
  const body = useRef<HTMLFormElement>(null);

  // Newer data from the server (after saving, or a change in Studio): untouched fields follow, typed ones stay.
  if (storedKey !== seen) {
    setSeen(storedKey);
    setDraft(mergeDraft(draft, base, stored));
    setBase(stored);
  }
  const dirty = !sameDraft(draft, base);
  useDirtyReport(dirty, onDirty);
  const disabled = saving;
  const tasks = project.tasks ?? [];
  const open = tasks.filter((task) => task.status !== "done");

  const change = (patch: Partial<ProjectDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setSaved(false);
    setError(null);
  };

  async function save() {
    const next = readProjectDraft(draft);
    if (!next.ok) {
      setError({ field: next.field, text: next.error });
      focusInvalid(body.current);
      return;
    }
    const before = readProjectDraft(base);
    const patch = before.ok ? changesOf(before.value, next.value) : next.value;
    if (!Object.keys(patch).length) { setDraft(base); return; }
    setSaving(true);
    setError(null);
    try {
      const result = await saveProjectDetails({ projectId: project.id, expectedVersion: project.studio?.version ?? null, patch });
      if (!result.ok) {
        setError({ field: null, text: result.error });
        if (result.stale) onStale();
        return;
      }
      const shown = asDraft(next.value);
      setBase(shown);
      setDraft(shown);
      setSaved(true);
      onSaved(result.data, `„${next.value.name}“ gespeichert.`);
    } catch {
      setError({ field: null, text: failed });
    } finally {
      setSaving(false);
    }
  }

  const footer = <>
    <SaveStatus state={dirty ? "dirty" : saved ? "saved" : "clean"} />
    {dirty && <button type="button" className="sheet-action is-quiet" onClick={() => { setDraft(base); setError(null); }} disabled={saving}>Verwerfen</button>}
    <button type="button" className="sheet-action is-primary" onClick={() => void save()} disabled={saving || busy || !dirty}>{saving ? <MiniLoader size={15} /> : <Save size={15} aria-hidden="true" />}Speichern</button>
  </>;

  return (
    <AssetPanel className="um-panel pj-panel" label={`Projekt ${project.name}`} title={project.name} onClose={onClose} footer={footer}
      icon={<span className={`pj-glyph is-lg tone-${studioStatuses[status].tone}`}><StudioGlyph status={status} size={18} /></span>}
      subtitle={`${project.company ?? "Ohne Kunde"} · ${studioStatuses[status].label}${visible ? "" : " · intern"}`}
      actions={onAsk && <button type="button" className="chat-icon-button is-muted" onClick={onAsk} aria-label="Assistent zu diesem Projekt fragen" data-tip="Assistent zu diesem Projekt fragen"><Sparkles size={18} aria-hidden="true" /></button>}>
      <form ref={body} className="um-form" noValidate onSubmit={(event) => { event.preventDefault(); if (dirty && !saving && !busy) void save(); }}>
        <PanelError error={error} />
        <PanelSection title="Status" meta="wirkt sofort, auch im Studio">
          <StatusPicks value={status} disabled={busy || saving} onPick={onStatus} />
          <p className="pj-pick-hint">{busy ? <MiniLoader size={14} /> : <Eye size={14} aria-hidden="true" />}<span>Der Kunde sieht: <b>{visible ? customerSees(status, waiting) : "nichts, das Projekt ist intern"}</b>{visible && waiting && status !== "complete" ? " (eine Aufgabe liegt bei ihm)" : ""}</span></p>
          <VisibleRow visible={visible} busy={busy} disabled={busy || saving} onChange={onVisible} />
        </PanelSection>
        <PanelSection title="Domains & Links" meta="ein Klick öffnet die Seite">
          <DomainFields draft={draft} stored={{ live: project.liveUrl, test: project.testUrl }} disabled={disabled} error={error} onChange={change} />
          <FieldError error={error} fields={["liveUrl", "testUrl"]} />
        </PanelSection>
        <ProjectFieldsSection draft={draft} meta={visible ? "Name und Beschreibung sieht der Kunde" : "sieht der Kunde, sobald du es freigibst"} disabled={disabled} error={error} onChange={change} />
        <PanelSection title="Meilensteine" meta={draft.milestones.length ? `${draft.milestones.length}` : undefined}>
          <MilestoneEditor rows={draft.milestones} asOf={asOf} disabled={disabled} error={error} onChange={(milestones) => change({ milestones })} />
          <FieldError error={error} fields={["milestones"]} />
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
      </form>
    </AssetPanel>
  );
}
