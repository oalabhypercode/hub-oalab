"use client";

import { useRef } from "react";
import { Search, TriangleAlert } from "lucide-react";
import type { BackgroundPreset, ColorScheme, ListView, PageWidth } from "@/lib/appearance";

/**
 * Capsule segmented control; arrow keys move the selection. An optional count sits in its own badge next to the label,
 * an optional alert (what is missing) as a warning sign after it, read out with the name.
 */
export function SegmentedControl<T extends string>({ options, value, onChange, label }: { options: { id: T; label: string; name: string; count?: number; alert?: string | null }[]; value: T; onChange: (value: T) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!offset) return;
    event.preventDefault();
    const next = (index + offset + options.length) % options.length;
    onChange(options[next].id);
    refs.current[next]?.focus();
  }
  return (
    <div className={`segmented-control${options.some((option) => option.count !== undefined) ? " has-counts" : ""}`} role="group" aria-label={label}>
      {options.map((option, index) => (
        <button
          key={option.id}
          ref={(element) => { refs.current[index] = element; }}
          type="button"
          className="segment"
          aria-pressed={value === option.id}
          aria-label={option.alert ? `${option.name}, ${option.alert}` : option.name}
          data-tip={option.alert || undefined}
          tabIndex={value === option.id ? 0 : -1}
          onClick={() => onChange(option.id)}
          onKeyDown={(event) => onKeyDown(event, index)}
        ><span className="segment-label">{option.label}</span>{option.count !== undefined && <span className="segment-count numeric" aria-hidden="true">{option.count}</span>}{option.alert && <TriangleAlert size={14} className="segment-alert" aria-hidden="true" />}</button>
      ))}
    </div>
  );
}

/** iOS-style switch (51 × 31); `size="sm"` is the calmer 34 × 20 one for table rows (18.11.2026). */
export function Switch({ checked, onChange, label, id, disabled = false, size }: { checked: boolean; onChange: (value: boolean) => void; label: string; id?: string; disabled?: boolean; size?: "sm" }) {
  return <button id={id} type="button" role="switch" aria-checked={checked} aria-label={label} className={size === "sm" ? "switch is-sm" : "switch"} disabled={disabled} onClick={() => onChange(!checked)}><span className="switch-knob" /></button>;
}

export function Slider({ label, value, min, max, step, onChange, format, id }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void; format: (value: number) => string; id: string }) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider-row">
      <div className="slider-label"><label htmlFor={id}>{label}</label><output htmlFor={id} className="numeric">{format(value)}</output></div>
      <input id={id} className="slider" type="range" min={min} max={max} step={step} value={value} aria-valuetext={format(value)} onChange={(event) => onChange(Number(event.target.value))} style={{ "--slider-fill": `${fill}%` } as React.CSSProperties} />
    </div>
  );
}

/** Search field; `glass` for use directly on the background. */
export function SearchField({ value, onChange, placeholder, label, glass = false }: { value: string; onChange: (value: string) => void; placeholder: string; label: string; glass?: boolean }) {
  return (
    <label className={`search-input${glass ? " glass glass-float" : ""}`}>
      <Search size={17} aria-hidden="true" />
      <input type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={label} />
    </label>
  );
}

/** Background preset tile: mini preview with base colour and two colour areas. */
/** Erscheinungsbild: a small picture of the hub in light, dark, or both for "Automatisch". */
/** A small picture of a list: one quiet line per entry, or a table with columns. */
export function ListViewSwatch({ view, label, selected, onSelect }: { view: ListView; label: string; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className="background-swatch" aria-pressed={selected} onClick={onSelect}>
      <span className={`background-swatch-preview list-preview list-preview-${view}`} aria-hidden="true"><i /><i /><i /><i /></span>
      <span className="background-swatch-name">{label}</span>
    </button>
  );
}

/** Profil › Darstellung › Breite: a small window with the sidebar and the page, narrow or edge to edge. */
export function WidthSwatch({ width, label, selected, onSelect }: { width: PageWidth; label: string; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className="background-swatch" aria-pressed={selected} onClick={onSelect}>
      <span className={`background-swatch-preview width-preview width-preview-${width}`} aria-hidden="true"><i /><b /></span>
      <span className="background-swatch-name">{label}</span>
    </button>
  );
}

export function SchemeSwatch({ scheme, label, selected, onSelect }: { scheme: ColorScheme; label: string; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className="background-swatch" aria-pressed={selected} onClick={onSelect}>
      <span className={`background-swatch-preview scheme-preview scheme-${scheme}`} aria-hidden="true" />
      <span className="background-swatch-name">{label}</span>
    </button>
  );
}

export function BackgroundSwatch({ preset, selected, onSelect, customColor }: { preset: BackgroundPreset; selected: boolean; onSelect: () => void; customColor?: string }) {
  const base = preset.id === "custom" && customColor ? customColor : preset.base;
  return (
    <button type="button" className="background-swatch" aria-pressed={selected} onClick={onSelect}>
      <span className="background-swatch-preview" aria-hidden="true" style={{ background: `radial-gradient(circle at 25% 25%, ${preset.orbs[0]} 0%, transparent 60%), radial-gradient(circle at 80% 70%, ${preset.orbs[1]} 0%, transparent 62%), ${base}` }} />
      <span className="background-swatch-name">{preset.name}</span>
    </button>
  );
}
