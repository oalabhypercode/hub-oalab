"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Plus, Search, type LucideIcon } from "lucide-react";

/**
 * The hub's tables in the Studio look: one calm sheet with a toolbar on top, hairlines between the rows and groups as
 * headings. The glass stays outside (background, sidebar, cards); the sheet itself is opaque so the table reads clearly.
 */

/** Toolbar of a sheet: search first, then menus (filter, sorting, grouping), then whatever sits on the right. */
export function SheetToolbar({ query, onQuery, placeholder, label, leading, children, trailing, compact = false }: {
  query: string;
  onQuery: (value: string) => void;
  placeholder: string;
  label: string;
  leading?: React.ReactNode;
  children?: React.ReactNode;
  trailing?: React.ReactNode;
  /** A full toolbar: the menus show only their names, the search field is narrower. */
  compact?: boolean;
}) {
  return (
    <div className={`sheet-toolbar${compact ? " is-compact" : ""}`}>
      {leading}
      <label className="sheet-search"><Search size={15} aria-hidden="true" /><input type="search" value={query} onChange={(event) => onQuery(event.target.value)} placeholder={placeholder} aria-label={label} /></label>
      {children}
      <span className="sheet-spacer" />
      {trailing}
    </div>
  );
}

/** A toolbar button that opens a small panel (filters, sorting, grouping). Closes on a click outside and on Escape. */
export function ToolbarMenu({ icon: Icon, label, value, badge = 0, align = "start", children }: {
  icon: LucideIcon;
  label: string;
  /** The current choice, shown after the label ("Sortierung: Nächster Termin"). */
  value?: string;
  /** Number of active filters. */
  badge?: number;
  align?: "start" | "end";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const name = `${label}${value ? `: ${value}` : ""}${badge ? ` (${badge} aktiv)` : ""}`;
  return (
    <div className="sheet-menu" ref={ref}>
      <button type="button" className="sheet-menu-button" aria-expanded={open} aria-controls={panelId} aria-label={name} title={name} onClick={() => setOpen((current) => !current)}>
        <Icon size={15} aria-hidden="true" />
        <span className="sheet-menu-label">{label}</span>{value && <span className="sheet-menu-value">: <b>{value}</b></span>}
        {badge > 0 && <span className="sheet-menu-badge numeric" aria-hidden="true">{badge}</span>}
      </button>
      <div id={panelId} className={`sheet-pop${align === "end" ? " is-end" : ""}`} role="group" aria-label={label} hidden={!open}>{children}</div>
    </div>
  );
}

/** One choice out of a few, inside a toolbar menu ("Gruppe: Status / Keine"). */
export function MenuChoices<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div className="sheet-choices" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button key={option.id} type="button" role="radio" aria-checked={value === option.id} className="sheet-choice" onClick={() => onChange(option.id)}>{option.label}</button>
      ))}
    </div>
  );
}

/**
 * A group of rows with its heading: chevron to fold it, symbol, name and count, optional actions on the right.
 * Each table lines the heading up with its rows in glass.css (symbol over symbol, name over title).
 */
export function TableGroup({ colSpan, label, count, glyph, collapsed, onToggle, actions, empty, children }: {
  colSpan: number;
  label: string;
  count: number;
  glyph?: React.ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  actions?: React.ReactNode;
  /** Shown instead of rows when the group is empty (an empty folder). */
  empty?: string;
  children?: React.ReactNode;
}) {
  return (
    <tbody className="table-group-body">
      <tr className="table-group">
        <th colSpan={colSpan} scope="rowgroup">
          <span className="table-group-in">
            <button type="button" className="table-group-toggle" aria-expanded={!collapsed} onClick={onToggle}>
              <ChevronDown size={14} className="table-group-chevron" aria-hidden="true" />
              {glyph && <span className="table-group-glyph">{glyph}</span>}
              <span className="table-group-label">{label}</span>
              <span className="table-group-count numeric">{count}</span>
            </button>
            {actions && <span className="table-group-actions">{actions}</span>}
          </span>
        </th>
      </tr>
      {!collapsed && (count === 0 && empty ? <tr className="table-empty-row"><td colSpan={colSpan}>{empty}</td></tr> : children)}
    </tbody>
  );
}

/** Folded groups of one table, remembered while the page is open. */
export function useCollapsedGroups() {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  return {
    isCollapsed: (key: string) => collapsed.has(key),
    toggle: (key: string) => setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    }),
  };
}

/** A last row that adds something ("Neuer Ordner"), like "Neue Aufgabe" in OALab Studio. */
export function TableAddRow({ colSpan, label, onClick }: { colSpan: number; label: string; onClick: () => void }) {
  return (
    <tbody>
      <tr className="table-add-row"><td colSpan={colSpan}><button type="button" className="table-add" onClick={onClick}><Plus size={15} aria-hidden="true" />{label}</button></td></tr>
    </tbody>
  );
}

export type GlyphKind = "feedback" | "progress" | "done" | "pending" | "invited" | "active" | "disabled" | "rejected";

/** Small status symbols in the Studio manner: they lead a row or a group, the colour comes from the tones. */
export function StatusGlyph({ kind }: { kind: GlyphKind }) {
  const tone = kind === "feedback" || kind === "pending" ? "todo" : kind === "progress" || kind === "active" ? "ok" : kind === "invited" ? "info" : kind === "disabled" ? "bad" : "off";
  return (
    <svg className={`status-glyph tone-${tone}`} viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
      {(kind === "feedback" || kind === "pending") && <><circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.5" /><circle cx="7" cy="7" r="2.3" fill="currentColor" /></>}
      {kind === "progress" && <><circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M7 3.4a3.6 3.6 0 0 1 0 7.2z" fill="currentColor" /></>}
      {(kind === "done" || kind === "active" || kind === "rejected") && <><circle cx="7" cy="7" r="6.3" fill="currentColor" /><path d={kind === "rejected" ? "m4.9 4.9 4.2 4.2M9.1 4.9 4.9 9.1" : "m4.5 7.2 1.7 1.7 3.3-3.5"} fill="none" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></>}
      {kind === "invited" && <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 1.9" />}
      {kind === "disabled" && <><circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M3.1 10.9 10.9 3.1" stroke="currentColor" strokeWidth="1.5" /></>}
    </svg>
  );
}

/** Line under a sheet: counts on the left, a hint on the right. */
export function SheetFooter({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return <div className="sheet-footer"><span>{children}</span>{hint && <span>{hint}</span>}</div>;
}

/** No rows for the current search or filters, inside the sheet, with the way back. */
export function SheetEmpty({ text, onReset }: { text: string; onReset?: () => void }) {
  return (
    <div className="sheet-empty">
      <p>{text}</p>
      {onReset && <button type="button" className="table-reset" onClick={onReset}>Suche und Filter zurücksetzen</button>}
    </div>
  );
}
