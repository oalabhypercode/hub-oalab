"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Download, File, FileArchive, FileImage, FileText, Inbox, Loader2, Search, Upload, Users } from "lucide-react";
import { categories } from "@/lib/categories";
import { createClient } from "@/lib/supabase/client";
import { checkUpload, fileCategories, fileCategoryIds, fileFormat, formatBytes, formatFileDate, formatFileDateTime, HUB_FILES_BUCKET, MAX_FILE_BYTES, type FileCategory } from "@/lib/hub-files/catalog";
import { createDownloadUrl, finalizeUpload, prepareUpload, setFileAssignments } from "@/lib/hub-files/actions";
import type { HubFileCustomer, HubStoredFile } from "@/lib/hub-files/types";
import { CategoryMetrics, CategoryTitle } from "./workspace";
import { HeaderActions } from "../app-shell";
import { GlassCard, SectionHeader } from "../glass";
import { LargeTitleHeader } from "../large-title-header";
import { Modal } from "../modal";
import { EmptyState } from "./overview";
import type { ScreenProps } from "./types";

const ALL = "all";
const UNASSIGNED = "unassigned";

function FileIcon({ file, size = 22 }: { file: Pick<HubStoredFile, "mimeType" | "fileName">; size?: number }) {
  const format = fileFormat(file.fileName);
  const Icon = file.mimeType.startsWith("image/") ? FileImage : ["ZIP", "RAR", "7Z"].includes(format) ? FileArchive : ["PDF", "DOC", "DOCX", "TXT", "XLSX", "PPTX"].includes(format) ? FileText : File;
  return <Icon size={size} color={categories.files.fill} strokeWidth={1.9} aria-hidden="true" />;
}

/** Fixture samples are plain links; real files get a 60-second signed URL from the server first. */
function DownloadButton({ file, onError, label = false }: { file: HubStoredFile; onError: (message: string) => void; label?: boolean }) {
  const [busy, setBusy] = useState(false);
  const content = <>{busy ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <Download size={18} aria-hidden="true" />}{label && <span>Herunterladen</span>}</>;
  const className = label ? "sheet-button sheet-button-primary" : "file-download";
  if (file.sampleHref) {
    return <a className={className} href={file.sampleHref} download={file.fileName} aria-label={label ? undefined : `${file.title} herunterladen`} title={label ? undefined : "Herunterladen"}>{content}</a>;
  }
  async function download() {
    setBusy(true);
    const result = await createDownloadUrl(file.id);
    setBusy(false);
    if (result.ok) window.location.assign(result.data.url);
    else onError(result.error);
  }
  return <button type="button" className={className} onClick={download} disabled={busy} aria-label={label ? undefined : `${file.title} herunterladen`} title={label ? undefined : "Herunterladen"}>{content}</button>;
}

function CategoryPill({ category }: { category: FileCategory }) {
  return <span className={`file-category file-category-${category}`}>{fileCategories[category]}</span>;
}

/** Checkbox list of customers, searchable by customer number or company. */
function CustomerPicker({ customers, selected, onChange, idPrefix }: { customers: HubFileCustomer[]; selected: string[]; onChange: (ids: string[]) => void; idPrefix: string }) {
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const shown = customers.filter((customer) => `${customer.customerNumber} ${customer.company}`.toLowerCase().includes(term));
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  return (
    <fieldset className="customer-picker">
      <legend>Kunden zuordnen <span>{selected.length ? `${selected.length} ausgewählt` : "Ohne Zuordnung landet die Datei in der Ablage"}</span></legend>
      {customers.length > 6 && <label className="search-input customer-picker-search"><Search size={16} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kundennummer oder Firma" aria-label="Kunden durchsuchen" /></label>}
      <ul>
        {shown.map((customer) => (
          <li key={customer.id}>
            <label htmlFor={`${idPrefix}-${customer.id}`}>
              <input id={`${idPrefix}-${customer.id}`} type="checkbox" checked={selected.includes(customer.id)} onChange={() => toggle(customer.id)} />
              <span className="customer-number numeric">{customer.customerNumber}</span>
              <span className="customer-company">{customer.company}</span>
            </label>
          </li>
        ))}
        {!shown.length && <li className="customer-picker-empty">{customers.length ? `Kein Kunde passt zu „${query}“.` : "Es sind noch keine Kunden angelegt."}</li>}
      </ul>
    </fieldset>
  );
}

const titleFromFileName = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();

async function sha256Hex(file: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Admin: upload one file with metadata straight to Supabase Storage and assign it to customers. */
function FileUploadCard({ customers }: { customers: HubFileCustomer[] }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<FileCategory>("other");
  const [description, setDescription] = useState("");
  const [customerIds, setCustomerIds] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  function choose(next: File | null) {
    setStatus("idle");
    setMessage("");
    if (!next) return;
    const check = checkUpload(next.name, next.size);
    if (!check.ok) { setStatus("error"); setMessage(check.error); return; }
    setFile(next);
    if (!title.trim()) setTitle(titleFromFileName(next.name));
  }

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file) { setStatus("error"); setMessage("Bitte zuerst eine Datei auswählen."); return; }
    if (!title.trim()) { setStatus("error"); setMessage("Bitte einen Titel angeben."); return; }
    setStatus("working");
    try {
      setMessage("Prüfsumme wird berechnet …");
      const sha256 = await sha256Hex(file);
      setMessage("Upload wird vorbereitet …");
      const prepared = await prepareUpload(file.name, file.size);
      if (!prepared.ok) throw new Error(prepared.error);
      setMessage("Datei wird hochgeladen …");
      const uploaded = await createClient().storage.from(HUB_FILES_BUCKET).uploadToSignedUrl(prepared.data.path, prepared.data.token, file, { contentType: file.type || "application/octet-stream" });
      if (uploaded.error) throw new Error("Die Datei konnte nicht hochgeladen werden.");
      setMessage("Angaben werden gespeichert …");
      const saved = await finalizeUpload({ path: prepared.data.path, fileName: file.name, title, category, description, mimeType: file.type, sha256, customerIds });
      if (!saved.ok) throw new Error(saved.error);
      const assigned = customers.filter((customer) => customerIds.includes(customer.id)).map((customer) => customer.customerNumber);
      setStatus("done");
      setMessage(`„${title.trim()}“ wurde hochgeladen${assigned.length ? ` und ${assigned.join(", ")} zugeordnet` : " und liegt in der Ablage"}.`);
      setFile(null); setTitle(""); setDescription(""); setCustomerIds([]); setCategory("other");
      if (input.current) input.current.value = "";
    } catch (failure) {
      setStatus("error");
      setMessage(failure instanceof Error ? failure.message : "Der Upload ist fehlgeschlagen.");
    }
  }

  const working = status === "working";
  return (
    <GlassCard as="section" className="upload-card" aria-labelledby="upload-title">
      <h2 className="t-headline upload-title" id="upload-title"><Upload size={18} color="var(--accent-text)" aria-hidden="true" />Datei hochladen</h2>
      <form onSubmit={upload} className="upload-form">
        <label
          className={`upload-drop${dragging ? " is-dragging" : ""}${file ? " has-file" : ""}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files[0] ?? null); }}
        >
          <input ref={input} type="file" className="visually-hidden" onChange={(event) => choose(event.target.files?.[0] ?? null)} disabled={working} />
          {file
            ? <><FileIcon file={{ mimeType: file.type, fileName: file.name }} size={26} /><span><strong>{file.name}</strong><small>{fileFormat(file.name)} · {formatBytes(file.size)} · andere Datei wählen</small></span></>
            : <><Upload size={26} color="var(--accent-text)" aria-hidden="true" /><span><strong>Datei auswählen oder hierher ziehen</strong><small>Bis {formatBytes(MAX_FILE_BYTES)} · keine ausführbaren Dateien</small></span></>}
        </label>
        <div className="upload-fields">
          <label className="upload-field"><span>Titel</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="z. B. Servicevertrag" disabled={working} required /></label>
          <label className="upload-field"><span>Kategorie</span>
            <select value={category} onChange={(event) => setCategory(event.target.value as FileCategory)} disabled={working}>
              {fileCategoryIds.map((id) => <option key={id} value={id}>{fileCategories[id]}</option>)}
            </select>
          </label>
          <label className="upload-field upload-field-wide"><span>Beschreibung</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={3} placeholder="Was steckt in der Datei, wofür ist sie gedacht?" disabled={working} /></label>
        </div>
        <CustomerPicker customers={customers} selected={customerIds} onChange={setCustomerIds} idPrefix="upload-customer" />
        <div className="upload-actions">
          <button type="submit" className="sheet-button sheet-button-primary upload-submit" disabled={working || !file}>{working ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <Upload size={18} aria-hidden="true" />}Hochladen</button>
          <p className={`upload-status upload-status-${status}`} role="status">{status === "done" && <Check size={16} aria-hidden="true" />}{message}</p>
        </div>
      </form>
    </GlassCard>
  );
}

/** All details of a file; admins can change the customer assignment here. */
function FileDetailDialog({ file, customers, canManage, onClose }: { file: HubStoredFile; customers: HubFileCustomer[]; canManage: boolean; onClose: () => void }) {
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(file.customers.map((customer) => customer.id));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const result = await setFileAssignments(file.id, selected);
    setSaving(false);
    if (result.ok) { setEditing(false); setError(""); } else setError(result.error);
  }

  return (
    <Modal title={file.title} onClose={onClose}>
      <div className="file-detail-head"><span className="modal-file-icon"><FileIcon file={file} size={30} /></span><span><strong>{file.fileName}</strong><small>{fileFormat(file.fileName)} · {formatBytes(file.sizeBytes)}</small></span></div>
      <dl className="file-details">
        <div><dt>Kategorie</dt><dd><CategoryPill category={file.category} /></dd></div>
        <div className="file-details-block"><dt>Beschreibung</dt><dd>{file.description || "Keine Beschreibung hinterlegt."}</dd></div>
        <div><dt>Originaldatei</dt><dd>{file.fileName}</dd></div>
        <div><dt>Format</dt><dd>{fileFormat(file.fileName)} ({file.mimeType})</dd></div>
        <div><dt>Größe</dt><dd>{formatBytes(file.sizeBytes)} ({new Intl.NumberFormat("de-DE").format(file.sizeBytes)} Bytes)</dd></div>
        <div><dt>Bereitgestellt</dt><dd>{formatFileDateTime(file.createdAt)}</dd></div>
        <div><dt>{file.customers.length > 1 ? "Kunden" : "Kunde"}</dt><dd>{file.customers.length ? file.customers.map((customer) => `${customer.customerNumber} · ${customer.company}`).join(", ") : "Ablage (keinem Kunden zugeordnet)"}</dd></div>
        {file.sha256 && <div className="file-details-block"><dt>Prüfsumme (SHA-256)</dt><dd className="file-checksum">{file.sha256}</dd></div>}
      </dl>
      {file.sha256 && <p className="t-footnote t-secondary file-detail-note">Der Download liefert genau diese Fassung. Die Prüfsumme wurde beim Upload berechnet.</p>}
      {file.sampleHref && <p className="t-footnote t-secondary file-detail-note">Fiktive Beispieldatei für die Demo.</p>}
      {canManage && editing && (
        <div className="file-assign">
          <CustomerPicker customers={customers} selected={selected} onChange={setSelected} idPrefix={`assign-${file.id}`} />
          <div className="file-assign-actions">
            <button type="button" className="sheet-button" onClick={() => { setEditing(false); setSelected(file.customers.map((customer) => customer.id)); }} disabled={saving}>Abbrechen</button>
            <button type="button" className="sheet-button sheet-button-primary" onClick={save} disabled={saving}>{saving ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}Zuordnung speichern</button>
          </div>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="file-detail-actions">
        {canManage && !editing && <button type="button" className="sheet-button" onClick={() => setEditing(true)}><Users size={18} aria-hidden="true" />Zuordnung ändern</button>}
        <DownloadButton file={file} onError={setError} label />
      </div>
    </Modal>
  );
}

export function FilesScreen({ model, populated, fileState }: ScreenProps) {
  const { files, customers, canManage, source } = fileState;
  const [category, setCategory] = useState<string>(ALL);
  const [customer, setCustomer] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const showCustomers = canManage || customers.length > 1;
  const term = query.trim().toLowerCase();
  const shown = useMemo(() => files.filter((file) =>
    (category === ALL || file.category === category)
    && (customer === ALL || (customer === UNASSIGNED ? !file.customers.length : file.customers.some((item) => item.id === customer)))
    && (!term || `${file.title} ${file.fileName} ${file.description}`.toLowerCase().includes(term)),
  ), [files, category, customer, term]);
  const openFile = files.find((file) => file.id === openId);
  const usedCategories = fileCategoryIds.filter((id) => files.some((file) => file.category === id));

  if (source === "fixtures" && !populated) {
    return <><LargeTitleHeader title="Dateien" icon={<CategoryTitle category="files" />} actions={<HeaderActions />} /><EmptyState section="files" /></>;
  }

  return (
    <>
      <LargeTitleHeader title="Dateien" icon={<CategoryTitle category="files" />} actions={<HeaderActions />} />
      {files.length > 0 && <CategoryMetrics model={model} category="files" />}
      {fileState.error && <GlassCard className="section-first"><p className="t-headline">Dateien nicht verfügbar</p><p className="t-subheadline t-secondary">{fileState.error}</p></GlassCard>}

      {canManage && source === "supabase" && !fileState.error && <><SectionHeader title="Hochladen" /><FileUploadCard customers={customers} /></>}
      {source === "fixtures" && customers.length > 1 && <GlassCard className="section-first file-demo-note"><Inbox size={18} color="var(--accent-text)" aria-hidden="true" /><p className="t-subheadline">Hochladen und Zuordnen ist nur mit echtem Admin-Login möglich. Die Tabelle zeigt fiktive Beispieldateien.</p></GlassCard>}

      {!fileState.error && <>
        <SectionHeader title={canManage ? "Alle Dateien" : "Deine Dateien"} />
        <div className="list-toolbar file-toolbar">
          <label className="search-input glass glass-float"><Search size={16} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Titel, Dateiname oder Beschreibung" aria-label="Dateien durchsuchen" /></label>
          <label className="glass customer-filter"><span>Kategorie</span><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Nach Kategorie filtern"><option value={ALL}>Alle</option>{usedCategories.map((id) => <option key={id} value={id}>{fileCategories[id]}</option>)}</select></label>
          {showCustomers && <label className="glass customer-filter"><span>Kunde</span><select value={customer} onChange={(event) => setCustomer(event.target.value)} aria-label="Nach Kunde filtern"><option value={ALL}>Alle</option>{customers.map((item) => <option key={item.id} value={item.id}>{item.customerNumber} · {item.company}</option>)}{canManage && <option value={UNASSIGNED}>Ablage (ohne Zuordnung)</option>}</select></label>}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {shown.length ? (
          <div className="glass file-table-card">
            <table className="file-table">
              <caption className="visually-hidden">{canManage ? "Alle Dateien mit Kategorie, Format, Datum und Kunden" : "Deine Dateien mit Kategorie, Format und Datum"}</caption>
              <thead>
                <tr>
                  <th scope="col">Datei</th>
                  <th scope="col">Kategorie</th>
                  <th scope="col" className="col-description">Beschreibung</th>
                  <th scope="col">Format</th>
                  <th scope="col">Bereitgestellt</th>
                  {showCustomers && <th scope="col">Kunden</th>}
                  <th scope="col"><span className="visually-hidden">Download</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((file) => (
                  <tr key={file.id} className="file-row">
                    <td className="cell-file">
                      <FileIcon file={file} />
                      <button type="button" className="file-open" onClick={() => setOpenId(file.id)}><strong>{file.title}</strong><small>{file.fileName}</small></button>
                    </td>
                    <td className="cell-category"><CategoryPill category={file.category} /></td>
                    <td className="cell-description col-description"><span>{file.description || "–"}</span></td>
                    <td className="cell-format"><strong>{fileFormat(file.fileName)}</strong><small>{formatBytes(file.sizeBytes)}</small></td>
                    <td className="cell-date">{formatFileDate(file.createdAt)}</td>
                    {showCustomers && <td className="cell-customers">{file.customers.length ? file.customers.map((item) => <span key={item.id} className="customer-chip numeric" title={item.company}>{item.customerNumber}</span>) : <span className="customer-chip customer-chip-empty">Ablage</span>}</td>}
                    <td className="cell-action"><DownloadButton file={file} onError={setError} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <GlassCard><p className="t-subheadline t-secondary">{files.length ? "Keine Dateien für diese Auswahl." : canManage ? "Noch keine Dateien hochgeladen." : "Für dich sind noch keine Dateien freigegeben."}</p></GlassCard>
        )}
      </>}

      {openFile && <FileDetailDialog key={openFile.id} file={openFile} customers={customers} canManage={canManage && source === "supabase"} onClose={() => setOpenId(null)} />}
    </>
  );
}
