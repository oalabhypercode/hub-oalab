"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, FolderPlus } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import type { StudioProjectStatus } from "@/lib/hub-data";
import { customerSees, studioStatuses } from "@/lib/hub-projects/desk";
import { blankDraft, readProjectDraft, sameDraft, type ProjectDraft } from "@/lib/hub-projects/edit";
import { createProject } from "@/lib/hub-projects/actions";
import { useInfo } from "../info-box";
import { AssetPanel } from "./asset-panel";
import { DomainFields, FieldError, focusInvalid, MilestoneEditor, PanelError, ProjectFieldsSection, StatusPicks, VisibleRow, type DraftError } from "./projects-edit-parts";
import { StudioGlyph } from "./projects-parts";
import { PanelSection, useDirtyReport } from "./users-panel";

/**
 * „Neues Projekt“ for one customer (Projekte V2 step 2, user 15.11.2026), in the same panel as a project: name first,
 * then status and visibility, both domains and the milestones. Like in Studio it starts today, in planning and
 * internal; „Projekt anlegen“ creates it on the customer's service platform organization, so Studio, the service
 * platform and the hub know it at once, and opens it.
 */
export function NewProjectPanel({ customer, asOf, onClose, onCreated, onDirty }: {
  customer: { id: string; company: string; customerNumber: string };
  asOf: string;
  onClose: () => void;
  onCreated: (project: { id: string; name: string }) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<ProjectDraft>(() => blankDraft(asOf));
  const [status, setStatus] = useState<StudioProjectStatus>("planning");
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<DraftError | null>(null);
  const body = useRef<HTMLFormElement>(null);
  const info = useInfo("Neues Projekt", {
    steps: [
      <><b>Es entsteht im Studio</b> und gilt auch auf der Serviceplattform.</>,
      <><b>Erst intern:</b> Der Kunde sieht es nach deiner Freigabe.</>,
      <><b>Alles Weitere</b> änderst du danach in der Leiste.</>,
    ],
    ask: "Was passiert beim Anlegen eines Projekts?",
  });
  const dirty = !sameDraft(draft, blankDraft(asOf)) || status !== "planning" || visible;
  useDirtyReport(dirty, onDirty);
  // The name comes first. The panel takes the focus when it opens; this runs right after it, as its parent.
  useEffect(() => { body.current?.querySelector<HTMLInputElement>("input[name='name']")?.focus({ preventScroll: true }); }, []);

  const change = (patch: Partial<ProjectDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
  };

  async function create() {
    const read = readProjectDraft(draft);
    if (!read.ok) {
      setError({ field: read.field, text: read.error });
      focusInvalid(body.current);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await createProject({ customerId: customer.id, status, visible, draft });
      if (!result.ok) { setError({ field: null, text: result.error }); return; }
      onCreated(result.data);
    } catch {
      setError({ field: null, text: "Das hat gerade nicht geklappt. Bitte versuche es erneut." });
    } finally {
      setSaving(false);
    }
  }

  const footer = <>
    <span className="um-foot-state">{saving ? "Wird angelegt …" : visible ? "Der Kunde sieht es gleich nach dem Anlegen." : "Erst intern; freigeben kannst du es jederzeit."}</span>
    <button type="button" className="sheet-action is-quiet" onClick={onClose} disabled={saving}>Abbrechen</button>
    <button type="button" className="sheet-action is-primary" onClick={() => void create()} disabled={saving}>{saving ? <MiniLoader size={15} /> : <FolderPlus size={15} aria-hidden="true" />}Projekt anlegen</button>
  </>;

  return (
    <AssetPanel className="um-panel pj-panel" label={`Neues Projekt für ${customer.company}`} title={draft.name.trim() || "Neues Projekt"} onClose={onClose} closeDisabled={saving} footer={footer} actions={info.button}
      icon={<span className={`pj-glyph is-lg tone-${studioStatuses[status].tone}`}><StudioGlyph status={status} size={18} /></span>}
      subtitle={`${customer.company} · ${customer.customerNumber}`}>
      <form ref={body} className="um-form" noValidate onSubmit={(event) => { event.preventDefault(); if (!saving) void create(); }}>
        {info.box}
        <PanelError error={error} />
        <ProjectFieldsSection draft={draft} meta={visible ? "Name und Beschreibung sieht der Kunde" : "sieht der Kunde, sobald du es freigibst"} disabled={saving} error={error} onChange={change} />
        <PanelSection title="Status" meta="wie im Studio, später jederzeit änderbar">
          <StatusPicks value={status} disabled={saving} onPick={(next) => { setStatus(next); setError(null); }} />
          <p className="pj-pick-hint"><Eye size={14} aria-hidden="true" /><span>Der Kunde sieht: <b>{visible ? customerSees(status, false) : "nichts, das Projekt ist intern"}</b></span></p>
          <VisibleRow visible={visible} busy={false} disabled={saving} onChange={(next) => { setVisible(next); setError(null); }} />
        </PanelSection>
        <PanelSection title="Domains & Links" meta="geht auch später">
          <DomainFields draft={draft} disabled={saving} error={error} onChange={change} />
          <FieldError error={error} fields={["liveUrl", "testUrl"]} />
        </PanelSection>
        <PanelSection title="Meilensteine" meta={draft.milestones.length ? `${draft.milestones.length}` : "geht auch später"}>
          <MilestoneEditor rows={draft.milestones} asOf={asOf} disabled={saving} error={error} onChange={(milestones) => change({ milestones })} />
          <FieldError error={error} fields={["milestones"]} />
        </PanelSection>
      </form>
    </AssetPanel>
  );
}
