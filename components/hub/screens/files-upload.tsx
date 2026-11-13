"use client";

import { useRef, useState } from "react";
import { Check, CircleAlert, Folder, Inbox, Upload, X } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { createClient } from "@/lib/supabase/client";
import { checkUpload, fileFormat, formatBytes, HUB_FILES_BUCKET, MAX_FILE_BYTES, MAX_UPLOAD_BATCH, type FileCategory } from "@/lib/hub-files/catalog";
import { finalizeUpload, prepareUpload } from "@/lib/hub-files/actions";
import type { HubFileCustomer, HubFolder } from "@/lib/hub-files/types";
import { GlassCard } from "../glass";
import { Select } from "../select";
import { categoryOptions } from "../select-options";
import { CustomerPicker, FileIcon } from "./files-parts";

type UploadItem = { key: string; file: File; title: string; status: "ready" | "working" | "done" | "error"; message: string };

export const titleFromFileName = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();

async function sha256Hex(file: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** fileName: the download name when the file gets a new one („Namen nach Muster“); otherwise its own name. */
export type UploadMeta = { title: string; fileName?: string; category: FileCategory; description: string; customerIds: string[]; folderId: string | null };

/**
 * One file: checksum, then straight to storage through a one-time link, then the record with customers and folder.
 * The stored copy keeps the original name in its path; the record carries the name people see and download.
 */
export async function sendUpload(file: File, meta: UploadMeta, onStep: (message: string) => void) {
  const check = checkUpload(file.name, file.size);
  if (!check.ok) throw new Error(check.error);
  if (!meta.title.trim()) throw new Error("Bitte einen Titel angeben.");
  onStep("Prüfsumme …");
  const sha256 = await sha256Hex(file);
  onStep("Wird hochgeladen …");
  const prepared = await prepareUpload(file.name, file.size);
  if (!prepared.ok) throw new Error(prepared.error);
  const uploaded = await createClient().storage.from(HUB_FILES_BUCKET).uploadToSignedUrl(prepared.data.path, prepared.data.token, file, { contentType: file.type || "application/octet-stream" });
  if (uploaded.error) throw new Error("Die Datei konnte nicht hochgeladen werden.");
  onStep("Wird gespeichert …");
  const saved = await finalizeUpload({ path: prepared.data.path, fileName: meta.fileName ?? file.name, title: meta.title, category: meta.category, description: meta.description, mimeType: file.type, sha256, customerIds: meta.customerIds, folderId: meta.folderId });
  if (!saved.ok) throw new Error(saved.error);
  return saved.data.id;
}

/**
 * Admin: upload several files at once straight to Supabase Storage, with shared metadata, customers and folder.
 * The Asset Management uploads through its own panel (asset-upload.tsx) with the same sendUpload.
 */
export function FileUploadCard({ customers, folders, initialCustomerIds = [], initialFolderId = "", framed = true }: { customers: HubFileCustomer[]; folders: HubFolder[]; initialCustomerIds?: string[]; initialFolderId?: string; framed?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [category, setCategory] = useState<FileCategory>("other");
  const [description, setDescription] = useState("");
  const [customerIds, setCustomerIds] = useState<string[]>(initialCustomerIds);
  const [folderId, setFolderId] = useState(initialFolderId);
  const [dragging, setDragging] = useState(false);
  const [working, setWorking] = useState(false);
  const [summary, setSummary] = useState<{ tone: "done" | "error" | "idle"; text: string }>({ tone: "idle", text: "" });
  // A folder belongs to one customer, so it can only be chosen when the files go to exactly one customer.
  const customerFolders = customerIds.length === 1 ? folders.filter((folder) => folder.customerId === customerIds[0]) : [];
  const targetFolder = customerFolders.some((folder) => folder.id === folderId) ? folderId : "";
  const ready = items.filter((item) => item.status === "ready" || item.status === "error");

  const update = (key: string, change: Partial<UploadItem>) => setItems((list) => list.map((item) => item.key === key ? { ...item, ...change } : item));

  function choose(list: FileList | null) {
    if (!list?.length) return;
    setSummary({ tone: "idle", text: "" });
    const added = Array.from(list).map((file, index): UploadItem => {
      const check = checkUpload(file.name, file.size);
      return { key: `${Date.now()}-${index}-${file.name}`, file, title: titleFromFileName(file.name), status: check.ok ? "ready" : "error", message: check.ok ? "" : check.error };
    });
    setItems((current) => {
      const next = [...current.filter((item) => item.status !== "done"), ...added];
      if (next.length > MAX_UPLOAD_BATCH) setSummary({ tone: "error", text: `Höchstens ${MAX_UPLOAD_BATCH} Dateien auf einmal; die übrigen wurden nicht übernommen.` });
      return next.slice(0, MAX_UPLOAD_BATCH);
    });
    if (input.current) input.current.value = "";
  }

  async function uploadOne(item: UploadItem) {
    update(item.key, { status: "working" });
    await sendUpload(item.file, { title: item.title, category, description, customerIds, folderId: targetFolder || null }, (message) => update(item.key, { message }));
  }

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!ready.length) { setSummary({ tone: "error", text: "Bitte zuerst Dateien auswählen." }); return; }
    setWorking(true);
    setSummary({ tone: "idle", text: "" });
    let succeeded = 0;
    // One after the other: each file gets its own signed upload URL and progress.
    for (const item of ready) {
      try {
        await uploadOne(item);
        update(item.key, { status: "done", message: "Hochgeladen" });
        succeeded++;
      } catch (failure) {
        update(item.key, { status: "error", message: failure instanceof Error ? failure.message : "Der Upload ist fehlgeschlagen." });
      }
    }
    setWorking(false);
    const who = customerIds.length === 1 ? "dem Kunden" : `${customerIds.length} Kunden`;
    const folderName = customerFolders.find((folder) => folder.id === targetFolder)?.name;
    const target = !customerIds.length ? " und liegen in der Ablage" : folderName ? `, ${who} zugeordnet und in „${folderName}“ abgelegt` : ` und ${who} zugeordnet`;
    if (succeeded === ready.length) {
      setSummary({ tone: "done", text: `${succeeded === 1 ? "1 Datei" : `${succeeded} Dateien`} hochgeladen${target}.` });
      setItems((list) => list.filter((item) => item.status !== "done"));
      setDescription("");
    } else {
      setSummary({ tone: "error", text: `${succeeded} von ${ready.length} Dateien hochgeladen. Die übrigen sind unten markiert.` });
    }
  }

  const form = (
    <form onSubmit={upload} className="upload-form">
      <label
        className={`upload-drop${dragging ? " is-dragging" : ""}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files); }}
      >
        <input ref={input} type="file" multiple className="visually-hidden" onChange={(event) => choose(event.target.files)} disabled={working} />
        <Upload size={26} color="var(--accent-text)" aria-hidden="true" />
        <span><strong>Dateien auswählen oder hierher ziehen</strong><small>Bis zu {MAX_UPLOAD_BATCH} Dateien auf einmal · je bis {formatBytes(MAX_FILE_BYTES)} · keine ausführbaren Dateien</small></span>
      </label>

      {items.length > 0 && (
        <ul className="upload-list" aria-label="Ausgewählte Dateien">
          {items.map((item) => (
            <li key={item.key} className={`upload-item upload-item-${item.status}`}>
              <FileIcon file={{ mimeType: item.file.type, fileName: item.file.name }} />
              <div className="upload-item-text">
                <input value={item.title} onChange={(event) => update(item.key, { title: event.target.value })} maxLength={200} aria-label={`Titel für ${item.file.name}`} disabled={working || item.status === "done"} />
                <small>{item.file.name} · {fileFormat(item.file.name)} · {formatBytes(item.file.size)}{item.message ? ` · ${item.message}` : ""}</small>
              </div>
              <span className="upload-item-state" aria-hidden="true">
                {item.status === "working" ? <MiniLoader size={18} /> : item.status === "done" ? <Check size={18} /> : item.status === "error" ? <CircleAlert size={18} /> : null}
              </span>
              {!working && item.status !== "done" && <button type="button" className="upload-item-remove" onClick={() => setItems((list) => list.filter((entry) => entry.key !== item.key))} aria-label={`${item.file.name} entfernen`}><X size={16} aria-hidden="true" /></button>}
            </li>
          ))}
        </ul>
      )}

      <div className="upload-fields">
        <label className="upload-field"><span>Kategorie (für alle)</span>
          <Select label="Kategorie" value={category} onChange={(value) => setCategory(value as FileCategory)} disabled={working} options={categoryOptions()} />
        </label>
        <label className="upload-field"><span>Ordner</span>
          <Select label="Ordner" value={targetFolder} onChange={setFolderId} disabled={working || customerIds.length !== 1}
            options={[{ value: "", label: customerIds.length === 1 ? "Ohne Ordner" : "Erst genau einen Kunden wählen", lead: <Inbox size={15} aria-hidden="true" /> }, ...customerFolders.map((folder) => ({ value: folder.id, label: folder.name, lead: <Folder size={15} aria-hidden="true" /> }))]} />
        </label>
        <label className="upload-field upload-field-wide"><span>Beschreibung (für alle, optional)</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={2} placeholder="Was steckt in den Dateien, wofür sind sie gedacht?" disabled={working} /></label>
      </div>
      <CustomerPicker customers={customers} selected={customerIds} onChange={setCustomerIds} idPrefix="upload-customer" emptyHint="Ohne Zuordnung landen die Dateien in der Ablage" />
      <div className="upload-actions">
        <button type="submit" className="sheet-button sheet-button-primary upload-submit" disabled={working || !ready.length}>{working ? <MiniLoader size={18} /> : <Upload size={18} aria-hidden="true" />}{ready.length > 1 ? `${ready.length} Dateien hochladen` : "Hochladen"}</button>
        <p className={`upload-status upload-status-${summary.tone}`} role="status">{summary.tone === "done" && <Check size={16} aria-hidden="true" />}{summary.text}</p>
      </div>
    </form>
  );
  if (!framed) return form;
  return (
    <GlassCard as="section" className="upload-card" aria-labelledby="upload-title">
      <h2 className="t-headline upload-title" id="upload-title"><Upload size={18} color="var(--accent-text)" aria-hidden="true" />Dateien hochladen</h2>
      {form}
    </GlassCard>
  );
}
