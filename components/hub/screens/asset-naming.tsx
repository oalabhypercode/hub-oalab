"use client";

import { useId, useMemo, useState } from "react";
import { Bookmark, Building2, Calendar, CalendarRange, Check, ChevronDown, Folder, GripVertical, Hash, History, Info, ListOrdered, PenLine, Plus, RotateCcw, Tag, TriangleAlert, Type, X, type LucideIcon } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import type { ActionResult, FileRename } from "@/lib/hub-files/actions";
import { fileCategories, fileDayKey } from "@/lib/hub-files/catalog";
import {
  builtInTemplateOf, builtInTemplates, cleanName, dateFromFileName, dateText, defaultPattern, formatNumber, isImageName, MAX_NAME, MAX_NAME_PARTS,
  MAX_PART_TEXT, nameBase, nameExtension, nameFiles, namePart, namePartGroups, namePartKinds, partValue, readPattern, samePattern, storePattern,
  type DateStyle, type NamePart, type NamePartKind, type NameSeparator, type NamingEntry, type NamingPattern, type NamingResult, type NumberDigits,
} from "@/lib/hub-files/naming";
import type { HubFileCustomer, HubFolder, HubStoredFile } from "@/lib/hub-files/types";
import { useInfo } from "../info-box";
import { Select, type SelectOption } from "../select";
import { AssetPanel } from "./asset-panel";
import { FileIcon } from "./files-parts";

/* ---------- What the browser remembers: the last pattern and own templates (no database, user 13.11.2026) ---------- */

const LAST_KEY = "oalab-hub-naming-last";
const TEMPLATES_KEY = "oalab-hub-naming-templates";
const MAX_TEMPLATES = 12;
type SavedTemplate = { label: string; pattern: NamingPattern };

function readStored(key: string): unknown {
  try { return JSON.parse(window.localStorage.getItem(key) ?? "null"); } catch { return null; }
}
function writeStored(key: string, value: unknown) {
  // Private windows or blocked site data: the hub simply does not remember.
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* nothing to keep */ }
}

/** The pattern used last in this browser, or the default (Kunde · Ordner · Nummer). */
export const startPattern = () => (typeof window === "undefined" ? null : readPattern(readStored(LAST_KEY))) ?? defaultPattern();
export const rememberPattern = (pattern: NamingPattern) => writeStored(LAST_KEY, storePattern(pattern));

function readTemplates(): SavedTemplate[] {
  if (typeof window === "undefined") return [];
  const raw = readStored(TEMPLATES_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const pattern = readPattern((item as { pattern?: unknown } | null)?.pattern);
    const label = cleanName((item as { label?: unknown } | null)?.label, 40);
    return pattern && label ? [{ label, pattern }] : [];
  }).slice(0, MAX_TEMPLATES);
}

/* ---------- Entries: what each file's positions can show ---------- */

/** Names already used per place (customer and folder, or the Ablage): titles and download names without extension. */
export function namesByPlace(files: HubStoredFile[], skip: ReadonlySet<string> = new Set()) {
  const places = new Map<string, string[]>();
  const add = (place: string, file: HubStoredFile) => {
    const list = places.get(place) ?? [];
    list.push(file.title.toLowerCase(), nameBase(file.fileName).toLowerCase());
    places.set(place, list);
  };
  for (const file of files) {
    if (skip.has(file.id)) continue;
    if (!file.customers.length) add("inbox", file);
    for (const customer of file.customers) add(`${customer.id}:${file.folderIds[customer.id] ?? "none"}`, file);
  }
  return places;
}

/** Existing files, seen at one customer (the open one) or at their first customer (Alle Dateien). */
export function storedEntries(files: HubStoredFile[], here: HubFileCustomer | null, folders: HubFolder[]): NamingEntry[] {
  return files.map((file, index) => {
    const customer = here ?? file.customers[0] ?? null;
    const folderId = customer ? file.folderIds[customer.id] : undefined;
    return {
      key: file.id,
      fileName: file.fileName,
      image: isImageName(file.fileName, file.mimeType),
      taken: dateFromFileName(file.fileName) ?? fileDayKey(file.createdAt),
      customer: customer?.company ?? "",
      customerNumber: customer?.customerNumber ?? "",
      folder: folderId ? folders.find((folder) => folder.id === folderId)?.name ?? "" : "",
      category: fileCategories[file.category],
      place: customer ? `${customer.id}:${folderId ?? "none"}` : "inbox",
      index,
    };
  });
}

/** Where the files land, for the hints: „Baustelle“, „Ohne Ordner“ or the Ablage. */
export function placeWords(entries: NamingEntry[]) {
  const places = Array.from(new Set(entries.map((entry) => entry.place)));
  if (places.length !== 1) return "den Ordnern";
  if (places[0] === "inbox") return "der Ablage";
  return entries[0].folder ? `„${entries[0].folder}“` : "„Ohne Ordner“";
}

/** One file's name: from the pattern, typed by hand, or unchanged (the pattern does not apply to it). */
export type FinalName = { base: string; how: "pattern" | "manual" | "kept" };
export function finalName(entry: NamingEntry, result: NamingResult | null, manual: Record<string, string>, kept: string): FinalName {
  if (manual[entry.key] !== undefined) return { base: manual[entry.key], how: "manual" };
  const named = result?.names.get(entry.key);
  return named ? { base: named.base, how: "pattern" } : { base: kept, how: "kept" };
}

/* ---------- The pattern ---------- */

const kindIcons: Record<NamePartKind, LucideIcon> = {
  text: Type, customer: Building2, customerNumber: Hash, folder: Folder, category: Tag, date: Calendar, year: CalendarRange, number: ListOrdered, original: History,
};
const separatorNames: Record<NameSeparator, string> = { "_": "Unterstrich", "-": "Bindestrich", " ": "Leerzeichen" };
const SAVE = "__save";

/**
 * „Namen“: the positions of the pattern (variant A „Positionen“, user 13.11.2026), one row each with its kind and value,
 * moved by dragging the number or with the arrow keys; options below, an example with the first file and hints.
 */
export function NamingBuilder({ pattern, onChange, result, entries, where, customerNote, onOff, disabled = false, ask }: {
  pattern: NamingPattern;
  onChange: (pattern: NamingPattern) => void;
  result: NamingResult;
  entries: NamingEntry[];
  /** Where the files land, for the hints („Baustelle“, der Ablage). */
  where: string;
  /** Why the customer position is empty: no customer or several. */
  customerNote: string;
  /** Upload: „Aus“ keeps the old names. */
  onOff?: () => void;
  disabled?: boolean;
  ask: string;
}) {
  const baseId = useId();
  const [saved, setSaved] = useState<SavedTemplate[]>(readTemplates);
  const [saving, setSaving] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; side: "before" | "after" } | null>(null);
  const info = useInfo("Namen nach Muster", {
    steps: [
      <><b>Positionen</b> wählen: Text, Kunde, Ordner, Datum, Nummer.</>,
      <><b>Beispiel</b> zeigt sofort, wie die Dateien heißen.</>,
      <><b>Eine Datei</b> anders? Ihren Namen unten ändern.</>,
    ],
    ask,
  });
  const parts = pattern.parts;
  const sample = result.affected[0] ?? entries[0];
  const pad = (value: number) => formatNumber(value, result.digits);
  const gripId = (id: string) => `${baseId}-grip-${id}`;

  const setParts = (next: NamePart[]) => onChange({ ...pattern, parts: next });
  const changePart = (id: string, change: Partial<NamePart>) => setParts(parts.map((part) => part.id === id ? { ...part, ...change } : part));
  function moveTo(id: string, target: string, side: "before" | "after") {
    if (id === target) return;
    const moving = parts.find((part) => part.id === id);
    if (!moving) return;
    const rest = parts.filter((part) => part.id !== id);
    const at = rest.findIndex((part) => part.id === target) + (side === "after" ? 1 : 0);
    setParts([...rest.slice(0, at), moving, ...rest.slice(at)]);
  }
  function moveBy(id: string, step: -1 | 1) {
    const at = parts.findIndex((part) => part.id === id);
    const to = at + step;
    if (at < 0 || to < 0 || to >= parts.length) return;
    const next = [...parts];
    [next[at], next[to]] = [next[to], next[at]];
    setParts(next);
    // The row moves in the page; the focus stays on its handle for the next step.
    requestAnimationFrame(() => document.getElementById(gripId(id))?.focus());
  }
  const changeKind = (id: string, kind: NamePartKind) => setParts(parts.map((part) => part.id === id ? { ...namePart(kind, { text: part.text, dateStyle: part.dateStyle, digits: part.digits }), id } : part));
  const addPart = () => setParts([...parts, namePart(parts.some((part) => part.kind === "text") ? "date" : "text")]);
  const addNumber = () => { if (!result.number) setParts([...parts.slice(0, MAX_NAME_PARTS - 1), namePart("number")]); };

  const builtIn = builtInTemplateOf(pattern);
  const own = saved.find((item) => samePattern(item.pattern, pattern));
  const templateOptions: SelectOption[] = [
    ...builtInTemplates.map((template) => ({ value: template.id, label: template.label, group: "Vorlagen" })),
    ...saved.map((item) => ({ value: `own:${item.label}`, label: item.label, group: "Eigene" })),
    { value: SAVE, label: "Aktuelles Muster speichern …", lead: <Bookmark size={15} aria-hidden="true" />, group: "Eigene" },
  ];
  function chooseTemplate(value: string) {
    if (value === SAVE) { setSaving(true); setTemplateName(""); return; }
    const mine = saved.find((item) => `own:${item.label}` === value);
    // A saved pattern comes back with fresh ids; a built-in one keeps the own text that was typed in.
    if (mine) { onChange(readPattern(storePattern(mine.pattern)) ?? pattern); return; }
    const template = builtInTemplates.find((item) => item.id === value);
    if (!template) return;
    onChange({ ...pattern, parts: template.kinds.map((kind) => {
      const before = parts.find((part) => part.kind === kind);
      return namePart(kind, before ? { text: before.text, dateStyle: before.dateStyle, digits: before.digits } : {});
    }) });
  }
  function saveTemplate() {
    const label = cleanName(templateName, 40);
    if (!label) return;
    const next = [{ label, pattern }, ...saved.filter((item) => item.label.toLowerCase() !== label.toLowerCase())].slice(0, MAX_TEMPLATES);
    writeStored(TEMPLATES_KEY, next.map((item) => ({ label: item.label, pattern: storePattern(item.pattern) })));
    setSaved(next);
    setSaving(false);
  }

  const typeOptions = (current: NamePart): SelectOption[] => namePartGroups.flatMap((group) => group.kinds.map((kind) => {
    const Icon = kindIcons[kind];
    // One number per name: a second one would only repeat it.
    const taken = kind === "number" && current.kind !== "number" && Boolean(result.number);
    return { value: kind, label: namePartKinds[kind].label, meta: taken ? "schon dabei" : namePartKinds[kind].hint, group: group.label, lead: <Icon size={15} aria-hidden="true" />, disabled: taken };
  }));

  const valueOf = (part: NamePart, index: number) => {
    if (part.kind === "text") {
      return <input className={`rn-input${cleanName(part.text) ? "" : " is-empty"}`} value={part.text} onChange={(event) => changePart(part.id, { text: event.target.value.slice(0, MAX_PART_TEXT) })}
        placeholder="Begriff, z. B. Baustelle" maxLength={MAX_PART_TEXT} aria-label={`Eigener Text für Position ${index + 1}`} disabled={disabled} />;
    }
    if (part.kind === "number") return <NumberStart part={part} start={result.start} digits={result.digits} disabled={disabled} onChange={(change) => changePart(part.id, change)} />;
    if (part.kind === "date") {
      const day = sample?.taken ?? "2026-11-02";
      return (
        <span className="am-control rn-mini">
          <Select variant="bare" label="Datumsformat" value={part.dateStyle} onChange={(value) => changePart(part.id, { dateStyle: value as DateStyle })} disabled={disabled}
            options={(["iso", "compact", "de"] as const).map((style) => ({ value: style, label: dateText(day, style) }))} />
          <ChevronDown size={14} aria-hidden="true" />
        </span>
      );
    }
    const value = sample ? partValue(part, sample, pattern) : "";
    if (!value && part.kind === "folder") return <span className="rn-fixed is-missing"><b>kein Ordner gewählt</b></span>;
    if (!value && (part.kind === "customer" || part.kind === "customerNumber")) return <span className="rn-fixed is-missing"><b>{customerNote}</b></span>;
    const perFile = part.kind === "category" || part.kind === "original" || part.kind === "year";
    return <span className="rn-fixed"><b>{value || "–"}</b>{perFile && <small>{part.kind === "year" ? "Aufnahmejahr" : "je Datei"}</small>}</span>;
  };

  const first = result.affected[0];
  const named = first ? result.names.get(first.key) : undefined;
  const what = result.affected.every((entry) => entry.image) ? (result.affected.length === 1 ? "1 Bild" : `${result.affected.length} Bilder`) : (result.affected.length === 1 ? "1 Datei" : `${result.affected.length} Dateien`);
  const range = result.number && result.affected.length > 1 ? ` · ${pad(result.start)} bis ${pad(result.start + result.affected.length - 1)}` : "";
  const orderWords = { taken: "Aufnahmezeit", name: "altem Namen", added: "Reihenfolge beim Hinzufügen" }[pattern.order];
  const missingWords: Partial<Record<NamePartKind, string>> = { customer: "„Kunde“", customerNumber: "„Kundennummer“", folder: "„Ordner“" };

  return (
    <div className="am-field rn-field">
      <span className="am-label">
        <span>Namen</span>
        <span className="rn-label-acts">
          <span className="am-label-select rn-template">
            <Select variant="bare" label="Vorlage" value={own ? `own:${own.label}` : builtIn?.id ?? ""} placeholder="Eigenes Muster" onChange={chooseTemplate} options={templateOptions} disabled={disabled} />
            <ChevronDown size={13} aria-hidden="true" />
          </span>
          {info.button}
          {onOff && <button type="button" className="rn-off" onClick={onOff} disabled={disabled} data-tip="Die Dateien behalten ihre Namen">Aus</button>}
        </span>
      </span>
      {info.box}
      <div className="rn-card">
        <ol className="rn-parts" aria-label="Positionen">
          {parts.map((part, index) => {
            const Icon = kindIcons[part.kind];
            return (
              <li key={part.id} className={`rn-part${dragging === part.id ? " is-dragging" : ""}${drop?.id === part.id && dragging !== part.id ? ` drop-${drop.side}` : ""}`}
                onDragOver={(event) => {
                  if (!dragging) return;
                  event.preventDefault();
                  const box = event.currentTarget.getBoundingClientRect();
                  const side = event.clientY < box.top + box.height / 2 ? "before" : "after";
                  setDrop((now) => now?.id === part.id && now.side === side ? now : { id: part.id, side });
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragging && drop) moveTo(dragging, drop.id, drop.side);
                  setDragging(null);
                  setDrop(null);
                }}>
                <span id={gripId(part.id)} className="rn-grip" role="button" tabIndex={disabled ? -1 : 0} draggable={!disabled} aria-label={`Position ${index + 1} verschieben (Pfeiltasten)`} data-tip="Ziehen oder mit den Pfeiltasten verschieben"
                  onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", part.kind); setDragging(part.id); }}
                  onDragEnd={() => { setDragging(null); setDrop(null); }}
                  onKeyDown={(event) => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); moveBy(part.id, event.key === "ArrowUp" ? -1 : 1); } }}>
                  <b>{index + 1}</b><GripVertical size={15} aria-hidden="true" />
                </span>
                <span className="am-control rn-type">
                  <Icon size={15} aria-hidden="true" />
                  <Select variant="bare" label={`Position ${index + 1}`} value={part.kind} onChange={(value) => changeKind(part.id, value as NamePartKind)} options={typeOptions(part)} disabled={disabled} />
                  <ChevronDown size={14} aria-hidden="true" />
                </span>
                <span className="rn-value">{valueOf(part, index)}</span>
                <button type="button" className="am-icon-btn" onClick={() => setParts(parts.filter((item) => item.id !== part.id))} disabled={disabled || parts.length < 2} aria-label={`Position ${index + 1} entfernen`} data-tip="Entfernen"><X size={15} aria-hidden="true" /></button>
              </li>
            );
          })}
        </ol>
        <div className="rn-add-row">
          {parts.length < MAX_NAME_PARTS
            ? <button type="button" className="am-link" onClick={addPart} disabled={disabled}><Plus size={15} aria-hidden="true" />Position hinzufügen</button>
            : <small>Höchstens {MAX_NAME_PARTS} Positionen</small>}
        </div>
        {saving && (
          <div className="rn-add-row rn-save">
            <input className="rn-input" value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Name der Vorlage, z. B. Baustellenfotos" maxLength={40} aria-label="Name der Vorlage" autoFocus
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); saveTemplate(); } if (event.key === "Escape") { event.stopPropagation(); setSaving(false); } }} />
            <button type="button" className="sheet-action is-primary" onClick={saveTemplate} disabled={!cleanName(templateName, 40)}><Check size={15} aria-hidden="true" />Speichern</button>
            <button type="button" className="am-icon-btn" onClick={() => setSaving(false)} aria-label="Nicht speichern" data-tip="Abbrechen"><X size={15} aria-hidden="true" /></button>
          </div>
        )}
        <div className="rn-opts">
          <span className="rn-opt">Trenner
            <span className="rn-seg" role="radiogroup" aria-label="Trennzeichen">
              {(["_", "-", " "] as const).map((separator) => (
                <button key={separator} type="button" role="radio" aria-checked={pattern.separator === separator} aria-label={separatorNames[separator]} data-tip={separatorNames[separator]}
                  onClick={() => onChange({ ...pattern, separator })} disabled={disabled}>{`a${separator}b`}</button>
              ))}
            </span>
          </span>
          {result.number && (
            <span className="rn-opt">Reihenfolge
              <span className="am-label-select">
                <Select variant="bare" label="Reihenfolge der Nummern" value={pattern.order} onChange={(value) => onChange({ ...pattern, order: value as NamingPattern["order"] })} disabled={disabled}
                  options={[{ value: "taken", label: "Aufnahmezeit", meta: "älteste zuerst" }, { value: "name", label: "Alter Name", meta: "A–Z" }, { value: "added", label: "Wie hinzugefügt" }]} />
                <ChevronDown size={13} aria-hidden="true" />
              </span>
            </span>
          )}
          <label className="rn-check" data-tip="Kleinbuchstaben, ä → ae, keine Leer- und Sonderzeichen">
            <input type="checkbox" checked={pattern.webSafe} onChange={(event) => onChange({ ...pattern, webSafe: event.target.checked })} disabled={disabled} />Web-tauglich <small>für Websites</small>
          </label>
          {result.mixed && (
            <span className="rn-opt">Gilt für
              <span className="am-label-select">
                <Select variant="bare" label="Umbenennen gilt für" value={pattern.imagesOnly ? "images" : "all"} onChange={(value) => onChange({ ...pattern, imagesOnly: value === "images" })} disabled={disabled}
                  options={[{ value: "images", label: `Nur Bilder (${result.images})` }, { value: "all", label: `Alle ${entries.length} Dateien` }]} />
                <ChevronDown size={13} aria-hidden="true" />
              </span>
            </span>
          )}
        </div>
        <div className="rn-example" aria-live="polite">
          <span>Beispiel</span>
          {first && named ? <code>{named.base}<i>{nameExtension(first.fileName)}</i></code> : <code><i>Keine Datei für dieses Muster</i></code>}
          {first && <><span /><small className="am-help">{what}{range}{result.number ? ` · nach ${orderWords}` : ""}</small></>}
        </div>
      </div>
      <div className="rn-hints">
        {result.number && result.number.start === null && result.suggested > 1 && (
          <p className="am-note is-muted"><Info size={16} aria-hidden="true" /><span>In {where} gibt es dieses Muster schon bis {pad(result.suggested - 1)}. Die Nummer zählt ab {pad(result.suggested)} weiter.</span></p>
        )}
        {result.clashes > 0 && (
          <p className="am-note is-todo"><TriangleAlert size={16} aria-hidden="true" /><span>{result.clashes === 1 ? "Einen dieser Namen" : `${result.clashes} dieser Namen`} gibt es in {where} schon.{" "}
            {result.number
              ? result.number.start !== null && <button type="button" onClick={() => changePart(result.number!.id, { start: null })}>Ab {pad(result.suggested)} weiterzählen</button>
              : <button type="button" onClick={addNumber}>Nummer anhängen</button>}
          </span></p>
        )}
        {result.duplicates > 0 && (
          <p className="am-note is-todo"><TriangleAlert size={16} aria-hidden="true" /><span>Ohne Nummer hießen mehrere Dateien gleich. Der Hub hängt {result.separator}2, {result.separator}3 … an. <button type="button" onClick={addNumber}>Nummer hinzufügen</button></span></p>
        )}
        {result.missing.map((kind) => (
          <p key={kind} className="am-note is-todo"><TriangleAlert size={16} aria-hidden="true" /><span>{kind === "folder" ? "Kein Ordner gewählt" : customerNote.replace(/^./, (char) => char.toUpperCase())}: Die Position {missingWords[kind]} fällt weg.</span></p>
        ))}
        {result.emptyText && <p className="am-help">Eigener Text ist noch leer und fällt weg, bis du etwas einträgst.</p>}
      </div>
    </div>
  );
}

/** First number and digits: empty means „count on in the folder“, the digits default to as many as needed (at least 01). */
function NumberStart({ part, start, digits, disabled, onChange }: { part: NamePart; start: number; digits: number; disabled: boolean; onChange: (change: Partial<NamePart>) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? formatNumber(start, digits);
  return (
    <>
      <span className="rn-num-label">ab</span>
      <input className="rn-input rn-num" value={shown} inputMode="numeric" maxLength={5} aria-label="Erste Nummer" data-tip={part.start === null ? "Automatisch: zählt im Ordner weiter" : "Von Hand gesetzt, leer lassen für automatisch"} disabled={disabled}
        onFocus={() => setDraft(shown)} onBlur={() => setDraft(null)}
        onChange={(event) => {
          const typed = event.target.value.replace(/\D/g, "").slice(0, 5);
          setDraft(typed);
          onChange({ start: typed ? Number(typed) : null });
        }} />
      <span className="am-control rn-mini">
        <Select variant="bare" label="Stellen der Nummer" value={part.digits} onChange={(value) => onChange({ digits: value as NumberDigits })} disabled={disabled}
          options={[{ value: "auto", label: "Auto", meta: "so viele wie nötig, mind. 01" }, { value: "1", label: "1", meta: "1, 2, 3" }, { value: "2", label: "01", meta: "01, 02, 03" }, { value: "3", label: "001", meta: "001, 002" }, { value: "4", label: "0001", meta: "0001, 0002" }]} />
        <ChevronDown size={14} aria-hidden="true" />
      </span>
    </>
  );
}

/** A file's new name in the lists of the panels: the name to edit, its extension, and how it came about. */
export function NameInput({ name, extension, label, keptText, keptTip, disabled = false, onChange, onReset }: {
  name: FinalName;
  extension: string;
  label: string;
  keptText: string;
  keptTip?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onReset: () => void;
}) {
  const renamed = name.how !== "kept";
  return (
    <span className="rn-name">
      <input value={name.base} size={Math.max(4, name.base.length)} maxLength={MAX_NAME} onChange={(event) => onChange(event.target.value)} aria-label={label} disabled={disabled} />
      {renamed && extension && <span className="rn-ext">{extension}</span>}
      {name.how === "manual" && <span className="rn-tag">eigener Name<button type="button" onClick={onReset} disabled={disabled} aria-label="Wieder nach Muster benennen" data-tip="Wieder nach Muster"><RotateCcw size={11} aria-hidden="true" /></button></span>}
      {name.how === "kept" && <span className="rn-tag is-keep" data-tip={keptTip}>{keptText}</span>}
    </span>
  );
}

/**
 * „Umbenennen“ for files already in the hub: the same pattern, then every selected file old → new. Only title and
 * download name change; the stored file stays where it is, and customers get no notice.
 */
export function RenamePanel({ files, entries, existing, onClose, onRename, onDone }: {
  files: HubStoredFile[];
  entries: NamingEntry[];
  existing: ReadonlyMap<string, readonly string[]>;
  onClose: () => void;
  onRename: (changes: FileRename[]) => Promise<ActionResult<{ count: number }>>;
  onDone: (message: string, ids: string[]) => void;
}) {
  const [pattern, setPattern] = useState(startPattern);
  const [manual, setManual] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const byId = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);
  const own = new Set(Object.keys(manual).filter((key) => byId.has(key)));
  const result = nameFiles(entries, pattern, existing, own);
  const names = entries.map((entry) => ({ entry, file: byId.get(entry.key)!, name: finalName(entry, result, manual, byId.get(entry.key)?.title ?? "") })).filter((item) => item.file);
  const changes: FileRename[] = names.flatMap(({ file, name }) => {
    const base = cleanName(name.base);
    if (name.how === "kept" || !base) return [];
    const fileName = `${base}${nameExtension(file.fileName)}`;
    return base === file.title && fileName === file.fileName ? [] : [{ id: file.id, title: base, fileName }];
  });
  const emptyName = names.some(({ name }) => name.how === "manual" && !cleanName(name.base));
  const places = Array.from(new Set(entries.map((entry) => entry.place === "inbox" ? "Ablage" : entry.folder || "Ohne Ordner")));
  const ordered = [...names].sort((a, b) => (result.names.get(a.entry.key)?.position ?? 1e6) - (result.names.get(b.entry.key)?.position ?? 1e6) || a.entry.index - b.entry.index);

  async function apply() {
    if (!changes.length || emptyName) return;
    setBusy(true);
    setProblem("");
    const done = await onRename(changes);
    setBusy(false);
    if (!done.ok) { setProblem(done.error); return; }
    rememberPattern(pattern);
    const single = changes.length === 1 ? byId.get(changes[0].id) : undefined;
    onDone(single ? `„${single.title}“ heißt jetzt „${changes[0].title}“.` : `${done.data.count} Dateien umbenannt.`, changes.map((change) => change.id));
  }

  const footer = <>
    <button type="button" className="sheet-action" onClick={onClose} disabled={busy}>Abbrechen</button>
    <button type="button" className="sheet-action is-primary" onClick={apply} disabled={busy || !changes.length || emptyName}>
      {busy ? <MiniLoader size={16} /> : <Check size={15} aria-hidden="true" />}{changes.length > 1 ? `${changes.length} Dateien umbenennen` : "Umbenennen"}
    </button>
  </>;

  return (
    <AssetPanel label="Umbenennen" icon={<span className="am-tile"><PenLine size={20} aria-hidden="true" /></span>} title="Umbenennen"
      subtitle={`${files.length === 1 ? "1 Datei" : `${files.length} Dateien`} · ${places.join(", ")}`} onClose={onClose} closeDisabled={busy} footer={footer}>
      <NamingBuilder pattern={pattern} onChange={setPattern} result={result} entries={entries} where={placeWords(result.affected.length ? result.affected : entries)}
        customerNote="kein Kunde" disabled={busy} ask="Wie benenne ich mehrere Dateien auf einmal um?" />
      <div className="am-field">
        <span className="am-label"><span className="rn-label-left">Vorher → nachher<small>{changes.length} von {files.length} ändern sich</small></span></span>
        <ul className="am-uploads rn-list" aria-label="Neue Namen">
          {ordered.map(({ entry, file, name }) => (
            <li key={file.id} className={`am-upload is-ready${name.how === "kept" ? "" : " is-renamed"}`}>
              <span className="am-file-icon"><FileIcon file={file} size={17} /></span>
              <span className="am-upload-text">
                <NameInput name={name} extension={nameExtension(file.fileName)} label={`Neuer Name für ${file.fileName}`} keptText="bleibt" keptTip="Gilt nur für Bilder" disabled={busy}
                  onChange={(value) => setManual((now) => ({ ...now, [entry.key]: value }))}
                  onReset={() => setManual((now) => { const next = { ...now }; delete next[entry.key]; return next; })} />
                <span className="am-upload-meta"><small className="rn-was" data-tip="Bisheriger Name"><History size={12} aria-hidden="true" /><span>{file.fileName}</span></small></span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="am-note is-muted"><Info size={16} aria-hidden="true" /><span>Nur Titel und Download-Name ändern sich, die Datei selbst nicht. Kunden bekommen keine Meldung.</span></p>
      {emptyName && <p className="form-error" role="alert">Bitte jeder Datei einen Namen geben.</p>}
      {problem && <p className="form-error" role="alert">{problem}</p>}
    </AssetPanel>
  );
}
