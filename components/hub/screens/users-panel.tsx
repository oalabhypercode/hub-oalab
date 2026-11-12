"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronUp, Copy, Lock, Plus, X, type LucideIcon } from "lucide-react";
import { formatFileDateTime } from "@/lib/hub-files/catalog";
import type { ManagedCustomer, ManagedEvent } from "@/lib/hub-users/types";
import { LogoMark, companyInitials } from "../logo-mark";
import { CustomerPicker } from "./files-parts";

/*
 * Building blocks of the User Management's panel (components/hub/screens/users-dialogs.tsx): the same opaque sheet,
 * hairlines and compact controls as its tables, instead of the glass windows of before (decision of 9.11.2026).
 */

/** A titled block of the panel, set off from the next by a hairline; ⓘ, a short note or an action sit in its heading. */
export function PanelSection({ title, info, meta, action, children }: { title: React.ReactNode; info?: React.ReactNode; meta?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="um-sec">
      <div className="um-sec-head"><h3>{title}</h3>{info}{meta && <span className="um-sec-meta">{meta}</span>}{action}</div>
      {children}
    </section>
  );
}

/** Two columns of fields; `wide` fields take the whole row. On phones it is one column. */
export function FieldGrid({ address = false, children }: { address?: boolean; children: React.ReactNode }) {
  return <div className={`um-grid${address ? " is-address" : ""}`}>{children}</div>;
}

export function Field({ label, note, wide = false, children }: { label: string; note?: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`um-field${wide ? " is-wide" : ""}`}><span className="am-label">{label}{note && <small>{note}</small>}</span>{children}</label>;
}

/** A value that is shown but not changed here, such as the e-mail address a login signs in with. */
export function ReadonlyField({ label, note, value, copyLabel }: { label: string; note?: string; value: string; copyLabel: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); } catch { /* clipboard blocked: the value stays readable */ }
  }
  return (
    <div className="um-field is-wide">
      <span className="am-label">{label}{note && <small>{note}</small>}</span>
      <span className="um-readonly"><Lock size={14} aria-hidden="true" /><span data-tip={value}>{value}</span>
        <button type="button" onClick={copy} aria-label={copyLabel} data-tip={copied ? "Kopiert" : "Kopieren"}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}</button>
      </span>
    </div>
  );
}

/** One of a few choices in the sheet's segmented look: the role of a login, the tabs of the panel. */
export function Segmented<T extends string>({ label, value, options, onChange, disabled = false }: {
  label: string; value: T; options: { id: T; label: React.ReactNode; icon?: LucideIcon }[]; onChange: (value: T) => void; disabled?: boolean;
}) {
  return (
    <div className="um-seg" role="group" aria-label={label}>
      {options.map(({ id, label: text, icon: Icon }) => (
        <button key={id} type="button" aria-pressed={value === id} disabled={disabled} onClick={() => onChange(id)}>{Icon && <Icon size={15} aria-hidden="true" />}{text}</button>
      ))}
    </div>
  );
}

/** The panel's tabs, between its head and its body. */
export function PanelTabs<T extends string>(props: { value: T; options: { id: T; label: React.ReactNode }[]; onChange: (value: T) => void }) {
  return <div className="um-tabs"><Segmented label="Bereiche" {...props} /></div>;
}

export function RowList({ children }: { children: React.ReactNode }) {
  return <div className="um-list">{children}</div>;
}

export const RowIcon = ({ icon: Icon }: { icon: LucideIcon }) => <span className="um-item-icon"><Icon size={16} aria-hidden="true" /></span>;

/** One row of a list: a symbol, title and line, its buttons on the right and, when open, more below (a link, a question). */
export function Row({ lead, title, text, danger = false, children, below }: { lead: React.ReactNode; title: React.ReactNode; text?: React.ReactNode; danger?: boolean; children?: React.ReactNode; below?: React.ReactNode }) {
  return (
    <div className={`um-item${danger ? " is-danger" : ""}`}>
      <div className="um-item-main">
        {lead}
        <span className="um-item-text"><strong>{title}</strong>{text && <small>{text}</small>}</span>
        {children && <span className="um-item-acts">{children}</span>}
      </div>
      {below && <div className="um-item-below">{below}</div>}
    </div>
  );
}

/** Who changed what and which mails went out, newest first. */
export function HistoryList({ events }: { events: ManagedEvent[] }) {
  if (!events.length) return <p className="am-help">Noch keine Einträge.</p>;
  return (
    <ol className="um-history">
      {events.slice(0, 40).map((event) => <li key={event.id}><i aria-hidden="true" /><div><strong>{event.summary || event.action}</strong><small>{formatFileDateTime(event.at)} · {event.actorName}</small></div></li>)}
    </ol>
  );
}

/** Up and down through the rows of the table, without closing the panel. */
export function EntryNav({ onPrev, onNext }: { onPrev?: () => void; onNext?: () => void }) {
  return (
    <span className="um-nav">
      <button type="button" className="am-icon-btn" onClick={onPrev} disabled={!onPrev} aria-label="Vorheriger Eintrag" data-tip="Vorheriger Eintrag"><ChevronUp size={18} aria-hidden="true" /></button>
      <button type="button" className="am-icon-btn" onClick={onNext} disabled={!onNext} aria-label="Nächster Eintrag" data-tip="Nächster Eintrag"><ChevronDown size={18} aria-hidden="true" /></button>
    </span>
  );
}

export type SaveState = "clean" | "dirty" | "saved";

/** The footer's left side: whether something waits to be saved. Its buttons follow. */
export function SaveStatus({ state }: { state: SaveState }) {
  return <span className={`um-foot-state is-${state}`}>{state === "dirty" ? "Ungespeicherte Änderungen" : state === "saved" ? "Gespeichert" : "Keine Änderungen"}</span>;
}

/** Tells the User Management whether the panel holds unsaved changes, so switching rows can ask first. */
export function useDirtyReport(dirty: boolean, onDirty?: (dirty: boolean) => void) {
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
}

/** The chosen entries as chips; "+" opens the tick list to add more (the freelancers of a customer and the other way round). */
export function EntryChips({ legend, entries, selected, onChange, addLabel, emptyText, idPrefix, disabled = false }: {
  legend: string; entries: ManagedCustomer[]; selected: string[]; onChange: (ids: string[]) => void; addLabel: string; emptyText: string; idPrefix: string; disabled?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const chosen = selected.flatMap((id) => entries.filter((entry) => entry.id === id));
  return (
    <div className="um-chips">
      <div className="am-chips">
        {chosen.map((entry) => (
          <span key={entry.id} className="am-chip">
            <LogoMark logo={entry.logo} initials={companyInitials(entry.company)} className="company-mark" />{entry.company}<span className="numeric um-chip-number">{entry.customerNumber}</span>
            <button type="button" onClick={() => onChange(selected.filter((id) => id !== entry.id))} disabled={disabled} aria-label={`${entry.company} entfernen`} data-tip="Entfernen"><X size={14} aria-hidden="true" /></button>
          </span>
        ))}
        {!chosen.length && <span className="um-chips-empty">{emptyText}</span>}
        <button type="button" className="am-chip-add" onClick={() => setPicking((open) => !open)} aria-expanded={picking} disabled={disabled || !entries.length}><Plus size={14} aria-hidden="true" />{addLabel}</button>
      </div>
      {picking && (
        <div className="am-pick">
          <CustomerPicker customers={entries.map(({ id, customerNumber, company }) => ({ id, customerNumber, company }))} selected={selected} onChange={onChange} idPrefix={idPrefix} legend={legend} emptyHint={emptyText} />
          <div className="am-pick-actions"><button type="button" className="sheet-action" onClick={() => setPicking(false)}><Check size={15} aria-hidden="true" />Fertig</button></div>
        </div>
      )}
    </div>
  );
}
