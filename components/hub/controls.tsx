"use client";

import { useRef } from "react";
import { Search } from "lucide-react";
import type { BackgroundPreset } from "@/lib/appearance";

/** Capsule segmented control; arrow keys move the selection. */
export function SegmentedControl<T extends string>({ options, value, onChange, label }: { options: { id: T; label: string; name: string }[]; value: T; onChange: (value: T) => void; label: string }) {
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
    <div className="segmented-control" role="group" aria-label={label}>
      {options.map((option, index) => (
        <button
          key={option.id}
          ref={(element) => { refs.current[index] = element; }}
          type="button"
          className="segment"
          aria-pressed={value === option.id}
          aria-label={option.name}
          tabIndex={value === option.id ? 0 : -1}
          onClick={() => onChange(option.id)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >{option.label}</button>
      ))}
    </div>
  );
}

/** iOS-style switch (51 × 31). */
export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (value: boolean) => void; label: string; id?: string }) {
  return <button id={id} type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)}><span className="switch-knob" /></button>;
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
export function BackgroundSwatch({ preset, selected, onSelect, customColor }: { preset: BackgroundPreset; selected: boolean; onSelect: () => void; customColor?: string }) {
  const base = preset.id === "custom" && customColor ? customColor : preset.base;
  return (
    <button type="button" className="background-swatch" aria-pressed={selected} onClick={onSelect}>
      <span className="background-swatch-preview" aria-hidden="true" style={{ background: `radial-gradient(circle at 25% 25%, ${preset.orbs[0]} 0%, transparent 60%), radial-gradient(circle at 80% 70%, ${preset.orbs[1]} 0%, transparent 62%), ${base}` }} />
      <span className="background-swatch-name">{preset.name}</span>
    </button>
  );
}
