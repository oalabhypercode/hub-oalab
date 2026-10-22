"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { nextSort, type SortDir, type SortState } from "@/lib/table-tools";

/** One way to sort a table; `firstDir` is the direction a first click starts with (dates and sizes: newest/largest first). */
export type SortOption<K extends string> = { id: K; label: string; firstDir?: SortDir; dirLabels?: Record<SortDir, string> };

export const alphabetical: Record<SortDir, string> = { asc: "A–Z", desc: "Z–A" };
const plainDirections: Record<SortDir, string> = { asc: "aufsteigend", desc: "absteigend" };

/** Filter capsule with a native select, so keyboard, screen readers and phones get their usual picker. */
export function FilterSelect({ label, name, value, onChange, options }: { label: string; name: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="glass customer-filter">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={name}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

/** "Sortieren" in the toolbar: what to sort by and the direction. Phones have no column headers, so this is their only way. */
export function SortControl<K extends string>({ options, sort, onChange }: { options: SortOption<K>[]; sort: SortState<K>; onChange: (sort: SortState<K>) => void }) {
  const current = options.find((option) => option.id === sort.key);
  const direction = (current?.dirLabels ?? plainDirections)[sort.dir];
  return (
    <div className="glass customer-filter sort-control">
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
