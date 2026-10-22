"use client";

import { useId, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { nextSort, type SortDir, type SortState } from "@/lib/table-tools";

/** One way to sort a table; `firstDir` is the direction a first click starts with (dates and sizes: newest/largest first). */
export type SortOption<K extends string> = { id: K; label: string; firstDir?: SortDir; dirLabels?: Record<SortDir, string> };

export const alphabetical: Record<SortDir, string> = { asc: "A–Z", desc: "Z–A" };
const plainDirections: Record<SortDir, string> = { asc: "aufsteigend", desc: "absteigend" };

/**
 * Table search: at first only the search field; "Erweiterte Suche" folds the filters and sorting (children) out below it.
 * The badge counts active filters, so they stay visible while the panel is closed.
 */
export function TableSearch({ value, onChange, placeholder, label, activeFilters, children }: { value: string; onChange: (value: string) => void; placeholder: string; label: string; activeFilters: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const toggleLabel = `Erweiterte Suche${activeFilters ? ` (${activeFilters} Filter aktiv)` : ""}`;
  return (
    <div className="table-toolbar">
      <div className="search-input glass glass-float table-search">
        <Search size={17} aria-hidden="true" />
        <input type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={label} />
        <button type="button" className="table-search-toggle" aria-expanded={open} aria-controls={panelId} aria-label={toggleLabel} title={toggleLabel} onClick={() => setOpen((current) => !current)}>
          <SlidersHorizontal size={16} aria-hidden="true" />
          <span className="table-search-toggle-text">Erweiterte Suche</span>
          {activeFilters > 0 && <span className="table-search-badge numeric" aria-hidden="true">{activeFilters}</span>}
          <ChevronDown size={15} className="table-search-chevron" aria-hidden="true" />
        </button>
      </div>
      <div id={panelId} className="glass table-search-panel" hidden={!open}>{children}</div>
    </div>
  );
}

/** Filter capsule with a native select, so keyboard, screen readers and phones get their usual picker. */
export function FilterSelect({ label, name, value, onChange, options }: { label: string; name: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="customer-filter">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={name}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

/** "Sortieren" in the extended search: what to sort by and the direction. Phones have no column headers, so this is their only way. */
export function SortControl<K extends string>({ options, sort, onChange }: { options: SortOption<K>[]; sort: SortState<K>; onChange: (sort: SortState<K>) => void }) {
  const current = options.find((option) => option.id === sort.key);
  const direction = (current?.dirLabels ?? plainDirections)[sort.dir];
  return (
    <div className="customer-filter sort-control">
      <label>
        <span>Sortieren</span>
        <select value={sort.key} aria-label="Sortieren nach" onChange={(event) => {
          const option = options.find((item) => item.id === event.target.value);
          if (option) onChange({ key: option.id, dir: option.firstDir ?? "asc" });
        }}>
          {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
      <button type="button" className="sort-direction" onClick={() => onChange({ key: sort.key, dir: sort.dir === "asc" ? "desc" : "asc" })} aria-label={`Reihenfolge ${direction}, umkehren`} title={`${direction} · umkehren`}>
        {sort.dir === "asc" ? <ArrowUp size={16} aria-hidden="true" /> : <ArrowDown size={16} aria-hidden="true" />}
      </button>
    </div>
  );
}

/** Sortable column header: a click sorts by this column, a second click flips the direction. */
export function SortHeader<K extends string>({ option, label = option.label, sort, onChange, className }: { option: SortOption<K>; label?: string; sort: SortState<K>; onChange: (sort: SortState<K>) => void; className?: string }) {
  const active = sort.key === option.id;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" className={className} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
      <button type="button" className={`sort-header${active ? " is-active" : ""}`} onClick={() => onChange(nextSort(sort, option.id, option.firstDir))} title={`Nach ${option.label} sortieren`}>
        {label}<Icon size={13} aria-hidden="true" />
      </button>
    </th>
  );
}
