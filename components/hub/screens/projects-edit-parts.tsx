"use client";

import { useEffect, useRef, useState } from "react";
import { CircleCheck, ExternalLink, FlaskConical, Globe, Milestone, Plus, Target, X } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import type { StudioProjectStatus } from "@/lib/hub-data";
import { studioStatusOrder, studioStatuses } from "@/lib/hub-projects/desk";
import { MAX_DESCRIPTION, MAX_MILESTONES, MAX_NAME, type MilestoneDraft, type ProjectDraft } from "@/lib/hub-projects/edit";
import { shortUrl } from "@/lib/hub-projects/map";
import { Switch } from "../controls";
import { CopyButton } from "./contracts-domains";
import { StudioGlyph } from "./projects-parts";
import { PanelSection } from "./users-panel";

// The fields of a project's panel and of „Neues Projekt“ (Projekte V2 step 2): status, visibility, name, description,
// days, milestones and both domains, laid out like the User Management's panels.

/** The field a check found wrong, so it wears the error frame and gets the focus; null for an answer of the server. */
export type DraftError = { field: keyof ProjectDraft | null; text: string };

/** The error under the fields it is about, in their section. */
export function FieldError({ error, fields }: { error: DraftError | null; fields: (keyof ProjectDraft)[] }) {
  return error?.field && fields.includes(error.field) ? <p className="form-error" role="alert">{error.text}</p> : null;
}

/** An answer of the server (no field to point at) at the top of the panel, scrolled into view. */
export function PanelError({ error }: { error: DraftError | null }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const text = error && !error.field ? error.text : "";
  useEffect(() => { if (text) ref.current?.scrollIntoView({ block: "nearest" }); }, [text]);
  return text ? <p ref={ref} className="form-error pj-panel-error" role="alert">{text}</p> : null;
}

/** The five statuses as buttons: in a project a click saves at once, in „Neues Projekt“ it only chooses. */
export function StatusPicks({ value, disabled, onPick }: { value: StudioProjectStatus; disabled: boolean; onPick: (status: StudioProjectStatus) => void }) {
  return (
    <div className="pj-status-pick" role="group" aria-label="Status">
      {studioStatusOrder.map((item) => (
        <button key={item} type="button" aria-pressed={value === item} className={`pj-pick tone-${studioStatuses[item].tone}`} onClick={() => { if (item !== value) onPick(item); }} disabled={disabled}>
          <StudioGlyph status={item} size={16} /><span>{studioStatuses[item].label}</span>
        </button>
      ))}
    </div>
  );
}

/** Whether the customer sees the project under „Projekte“; until then only the oalab team does. */
export function VisibleRow({ visible, busy, disabled, onChange }: { visible: boolean; busy: boolean; disabled: boolean; onChange: (visible: boolean) => void }) {
  return (
    <div className="pj-switch-row">
      <span className="pj-switch-text">
        <strong>Für den Kunden sichtbar</strong>
        <small>{visible ? "Steht unter Projekte im Kundenkonto." : "Bleibt intern, bis du es freigibst."}</small>
      </span>
      {busy ? <span className="pj-switch-busy"><MiniLoader size={18} /></span> : <Switch checked={visible} onChange={onChange} label="Für den Kunden sichtbar" disabled={disabled} />}
    </div>
  );
}

/** Name, description, start and target day. */
export function ProjectFieldsSection({ draft, meta, disabled, error, onChange }: {
  draft: ProjectDraft;
  meta: string;
  disabled: boolean;
  error: DraftError | null;
  onChange: (patch: Partial<ProjectDraft>) => void;
}) {
  const invalid = (field: keyof ProjectDraft) => error?.field === field || undefined;
  return (
    <PanelSection title="Projekt" meta={meta}>
      <div className="um-grid">
        <label className="um-field is-wide">
          <span className="am-label">Name</span>
          <input className="am-input" name="name" value={draft.name} onChange={(event) => onChange({ name: event.target.value })} placeholder="z. B. Website-Relaunch" maxLength={MAX_NAME}
            autoComplete="off" disabled={disabled} aria-invalid={invalid("name")} />
        </label>
        <label className="um-field is-wide">
          <span className="am-label">Beschreibung</span>
          <textarea className="am-textarea pj-desc" name="description" rows={3} value={draft.description} onChange={(event) => onChange({ description: event.target.value })}
            placeholder="Worum geht es in dem Projekt?" maxLength={MAX_DESCRIPTION} disabled={disabled} aria-invalid={invalid("description")} />
        </label>
        <label className="um-field">
          <span className="am-label">Start</span>
          <input className="am-input" type="date" name="startDate" value={draft.startDate} max={draft.dueDate || undefined} onChange={(event) => onChange({ startDate: event.target.value })}
            disabled={disabled} aria-invalid={invalid("startDate")} />
        </label>
        <label className="um-field">
          <span className="am-label">Zieltermin</span>
          <input className="am-input" type="date" name="dueDate" value={draft.dueDate} min={draft.startDate || undefined} onChange={(event) => onChange({ dueDate: event.target.value })}
            disabled={disabled} aria-invalid={invalid("dueDate")} />
        </label>
      </div>
      <FieldError error={error} fields={["name", "description", "startDate", "dueDate"]} />
    </PanelSection>
  );
}

/** One address field with its hint; once stored, it opens and copies in one click. */
export function UrlField({ kind, value, stored, disabled, invalid, onChange }: { kind: "live" | "test"; value: string; stored?: string | null; disabled: boolean; invalid: boolean; onChange: (value: string) => void }) {
  const Icon = kind === "live" ? Globe : FlaskConical;
  const label = kind === "live" ? "Live-Domain" : "Testdomain";
  return (
    <div className="um-field is-wide">
      <span className="am-label">{label}</span>
      <label className={`pj-url is-${kind}`}>
        <Icon size={16} aria-hidden="true" />
        <input name={kind === "live" ? "liveUrl" : "testUrl"} value={value} onChange={(event) => onChange(event.target.value)} placeholder={kind === "live" ? "kunde.de" : "test.kunde.de"} aria-label={label}
          inputMode="url" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={2048} disabled={disabled} aria-invalid={invalid || undefined} />
        {stored && value.trim() === stored && <>
          <a className="row-action" href={stored} target="_blank" rel="noopener noreferrer" aria-label={`${label} ${shortUrl(stored)} öffnen (neuer Tab)`} data-tip="Öffnen" data-tip-sub="neuer Tab"><ExternalLink size={15} aria-hidden="true" /></a>
          <CopyButton value={stored} label={label} />
        </>}
      </label>
      <small className="pj-form-hint">{kind === "live" ? "Die echte Website; dieselbe Adresse wie „Live schalten“ auf der Serviceplattform." : "Hier landen Service-Änderungen zuerst, bevor der Kunde sie freigibt."}</small>
    </div>
  );
}

/** Both domains of a project. */
export function DomainFields({ draft, stored, disabled, error, onChange }: { draft: ProjectDraft; stored?: { live?: string; test?: string }; disabled: boolean; error: DraftError | null; onChange: (patch: Partial<ProjectDraft>) => void }) {
  return (
    <div className="pj-fields">
      <UrlField kind="live" value={draft.liveUrl} stored={stored?.live} disabled={disabled} invalid={error?.field === "liveUrl"} onChange={(liveUrl) => onChange({ liveUrl })} />
      <UrlField kind="test" value={draft.testUrl} stored={stored?.test} disabled={disabled} invalid={error?.field === "testUrl"} onChange={(testUrl) => onChange({ testUrl })} />
    </div>
  );
}

let fresh = 0;

/**
 * The milestones as rows of day and name; reached ones are ticked, the next one is marked. A new row starts at the
 * end; the order by day comes with saving, so a row does not jump away while its day is typed.
 */
export function MilestoneEditor({ rows, asOf, disabled, error, onChange }: { rows: MilestoneDraft[]; asOf: string; disabled: boolean; error: DraftError | null; onChange: (rows: MilestoneDraft[]) => void }) {
  const [focus, setFocus] = useState<string | null>(null);
  const next = [...rows].filter((row) => row.date && row.date >= asOf).sort((a, b) => a.date.localeCompare(b.date))[0]?.id ?? null;
  const update = (id: string, patch: Partial<MilestoneDraft>) => onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const add = () => {
    fresh += 1;
    const id = `new-${fresh}`;
    setFocus(id);
    onChange([...rows, { id, name: "", date: "" }]);
  };
  const flagged = error?.field === "milestones";
  return (
    <div className="pj-ms-edit">
      {rows.map((row) => {
        const past = Boolean(row.date) && row.date < asOf;
        const Mark = past ? CircleCheck : row.id === next ? Target : Milestone;
        const open = Boolean(row.name.trim()) !== Boolean(row.date);
        return (
          <div key={row.id} className={`pj-ms-row${past ? " is-past" : ""}${row.id === next ? " is-next" : ""}`}>
            <span className="pj-ms-mark" data-tip={past ? "Erreicht" : row.id === next ? "Nächster Meilenstein" : undefined}><Mark size={16} aria-hidden="true" /></span>
            <input className="am-input" type="date" value={row.date} onChange={(event) => update(row.id, { date: event.target.value })} aria-label="Datum des Meilensteins"
              disabled={disabled} aria-invalid={(flagged && open && !row.date) || undefined} autoFocus={row.id === focus} />
            <input className="am-input" value={row.name} onChange={(event) => update(row.id, { name: event.target.value })} placeholder="z. B. Designentwurf" aria-label="Meilenstein" maxLength={MAX_NAME}
              autoComplete="off" disabled={disabled} aria-invalid={(flagged && open && !row.name.trim()) || undefined} />
            <button type="button" className="row-action" onClick={() => onChange(rows.filter((item) => item.id !== row.id))} aria-label={`Meilenstein ${row.name.trim() || "ohne Namen"} entfernen`} data-tip="Entfernen" disabled={disabled}><X size={16} aria-hidden="true" /></button>
          </div>
        );
      })}
      {!rows.length && <p className="pj-empty">Noch keine Meilensteine.</p>}
      {rows.length < MAX_MILESTONES && <button type="button" className="pj-add-line" onClick={add} disabled={disabled}><Plus size={15} aria-hidden="true" />Meilenstein hinzufügen</button>}
    </div>
  );
}

/** Puts the focus on the field a check found wrong (it carries aria-invalid once React has drawn the error). */
export function focusInvalid(root: HTMLElement | null) {
  window.setTimeout(() => root?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus(), 0);
}
