"use client";

import { useState } from "react";
import { BellRing, Check, ChevronDown, CloudUpload, Folder, Inbox, Plus, Upload, X } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { checkUpload, fileCategories, fileCategoryIds, formatBytes, guessFileCategory, isFileCategory, MAX_FILE_BYTES, MAX_UPLOAD_BATCH, type FileCategory } from "@/lib/hub-files/catalog";
import type { HubFileCustomer, HubFolder } from "@/lib/hub-files/types";
import { AssetPanel } from "./asset-panel";
import { CustomerSign } from "./customer-sign";
import { CustomerPicker, FileIcon } from "./files-parts";
import { sendUpload, titleFromFileName } from "./files-upload";

/** blocked: the file can never go up (empty, too big, a program); other errors can be tried again. */
type UploadItem = { key: string; file: File; title: string; category: FileCategory; status: "ready" | "working" | "done" | "error"; message: string; blocked: boolean };
/** Where new files go: the customer and folder of the place the upload started from or the files were dropped on. */
export type UploadTarget = { customerId: string | null; folderId: string };
export type UploadQueue = ReturnType<typeof useUploadQueue>;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Files dragged in from the computer, not text or links dragged within the page. */
export const isFileDrag = (event: React.DragEvent) => Array.from(event.dataTransfer.types).includes("Files");

/**
 * The files of one upload and where they go. It lives in the Asset Management rather than in the panel, so files
 * dropped onto the list join an open upload and the folder they were dropped on becomes the target.
 */
export function useUploadQueue(customers: HubFileCustomer[], folders: HubFolder[]) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [customerIds, setCustomerIds] = useState<string[]>([]);
  const [folderId, setFolderId] = useState("");
  const [description, setDescription] = useState("");
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState("");
  // A folder belongs to one customer, so it only applies when the files go to exactly one customer.
  const customerFolders = customerIds.length === 1 ? folders.filter((folder) => folder.customerId === customerIds[0]) : [];
  const targetFolder = customerFolders.some((folder) => folder.id === folderId) ? folderId : "";
  const ready = items.filter((item) => !item.blocked && (item.status === "ready" || item.status === "error"));
  const done = items.filter((item) => item.status === "done").length;

  const update = (key: string, change: Partial<UploadItem>) => setItems((list) => list.map((item) => item.key === key ? { ...item, ...change } : item));

  function add(list: FileList | File[]) {
    const picked = Array.from(list);
    if (!picked.length) return;
    const stamp = Date.now();
    const next = [...items.filter((item) => item.status !== "done"), ...picked.map((file, index): UploadItem => {
      const check = checkUpload(file.name, file.size);
      return { key: `${stamp}-${index}-${file.name}`, file, title: titleFromFileName(file.name), category: guessFileCategory(file.name, file.type), status: check.ok ? "ready" : "error", message: check.ok ? "" : check.error, blocked: !check.ok };
    })];
    setProblem(next.length > MAX_UPLOAD_BATCH ? `Höchstens ${MAX_UPLOAD_BATCH} Dateien auf einmal; die übrigen wurden nicht übernommen.` : "");
    setItems(next.slice(0, MAX_UPLOAD_BATCH));
  }

  /** Opens or re-aims the upload: a new place replaces customers and folder, the files picked so far stay. */
  function start(target: UploadTarget, files?: File[]) {
    if (working) return;
    setCustomerIds(target.customerId ? [target.customerId] : []);
    setFolderId(target.folderId);
    if (files?.length) add(files); else setProblem("");
  }

  function reset() {
    setItems([]);
    setDescription("");
    setProblem("");
  }

  function summary(count: number) {
    const files = plural(count, "Datei", "Dateien");
    if (!customerIds.length) return `${files} hochgeladen. ${count === 1 ? "Sie liegt" : "Sie liegen"} in der Ablage.`;
    if (customerIds.length > 1) return `${files} hochgeladen und ${customerIds.length} Kunden zugeordnet.`;
    const company = customers.find((customer) => customer.id === customerIds[0])?.company ?? "dem Kunden";
    const folder = customerFolders.find((item) => item.id === targetFolder)?.name;
    return folder ? `${files} hochgeladen und bei ${company} in „${folder}“ abgelegt.` : `${files} hochgeladen und ${company} zugeordnet.`;
  }

  /** One file after the other, each with its own one-time link. Gives the line for the page once all of them are in. */
  async function upload(): Promise<string | null> {
    if (!ready.length) { setProblem("Bitte zuerst Dateien auswählen."); return null; }
    setWorking(true);
    setProblem("");
    let succeeded = 0;
    for (const item of ready) {
      try {
        update(item.key, { status: "working", message: "" });
        await sendUpload(item.file, { title: item.title, category: item.category, description, customerIds, folderId: targetFolder || null }, (message) => update(item.key, { message }));
        update(item.key, { status: "done", message: "Hochgeladen" });
        succeeded++;
      } catch (failure) {
        update(item.key, { status: "error", message: failure instanceof Error ? failure.message : "Der Upload ist fehlgeschlagen." });
      }
    }
    setWorking(false);
    if (succeeded < ready.length) {
      setProblem(`${succeeded} von ${ready.length} Dateien hochgeladen. Die übrigen sind markiert.`);
      return null;
    }
    reset();
    return summary(succeeded);
  }

  return {
    items, ready, done, working, problem, customerIds, setCustomerIds, customerFolders, folderId: targetFolder, setFolderId, description, setDescription,
    add, start, reset, update, upload,
    remove: (key: string) => setItems((list) => list.filter((item) => item.key !== key)),
    categoryForAll: (category: FileCategory) => setItems((list) => list.map((item) => item.status === "done" ? item : { ...item, category })),
  };
}

/**
 * Upload, as a panel next to the files: for whom and into which folder (filled in from where it was opened), then the
 * files with a title and a category each. Customers see the files at once and get a notice.
 */
export function UploadPanel({ queue, customers, onClose, onUploaded }: { queue: UploadQueue; customers: HubFileCustomer[]; onClose: () => void; onUploaded: (message: string) => void }) {
  const [picking, setPicking] = useState(false);
  const [describing, setDescribing] = useState(Boolean(queue.description));
  const [dragging, setDragging] = useState(false);
  const { items, ready, working } = queue;
  const chosen = queue.customerIds.flatMap((id) => customers.filter((customer) => customer.id === id));
  const one = chosen.length === 1 ? chosen[0] : null;
  const subtitle = working ? `${queue.done} von ${items.length} fertig` : ready.length ? `${plural(ready.length, "Datei", "Dateien")} bereit` : "Dateien wählen oder hierher ziehen";

  async function submit() {
    const message = await queue.upload();
    if (message) onUploaded(message);
  }

  const footer = <>
    <button type="button" className="sheet-action" onClick={onClose} disabled={working}>Abbrechen</button>
    <button type="button" className="sheet-action is-primary" onClick={submit} disabled={working || !ready.length}>
      {working ? <MiniLoader size={16} /> : <Upload size={15} aria-hidden="true" />}{ready.length > 1 ? `${ready.length} Dateien hochladen` : "Hochladen"}
    </button>
  </>;

  return (
    <AssetPanel label="Hochladen" icon={<span className="am-tile"><Upload size={20} aria-hidden="true" /></span>} title="Hochladen" subtitle={subtitle} onClose={onClose} closeDisabled={working} footer={footer}>
      <div className="am-field">
        <span className="am-label">Für</span>
        <div className="am-chips">
          {chosen.map((customer) => (
            <span key={customer.id} className="am-chip">
              <CustomerSign customer={customer} logo={customer.logo} size="sm" />{customer.company}
              <button type="button" onClick={() => queue.setCustomerIds(queue.customerIds.filter((id) => id !== customer.id))} disabled={working} aria-label={`${customer.company} entfernen`} title="Entfernen"><X size={14} aria-hidden="true" /></button>
            </span>
          ))}
          <button type="button" className="am-chip-add" onClick={() => setPicking((open) => !open)} aria-expanded={picking} disabled={working}><Plus size={14} aria-hidden="true" />{chosen.length ? "Weitere Kunden" : "Kunden wählen"}</button>
        </div>
        {picking && (
          <div className="am-pick">
            <CustomerPicker customers={customers} selected={queue.customerIds} onChange={queue.setCustomerIds} idPrefix="am-upload-customer" emptyHint="Ohne Kunden landen die Dateien in der Ablage" />
            <div className="am-pick-actions"><button type="button" className="sheet-action" onClick={() => setPicking(false)}><Check size={15} aria-hidden="true" />Fertig</button></div>
          </div>
        )}
      </div>

      {one ? (
        <div className="am-field">
          <span className="am-label">Ordner bei {one.company}</span>
          <span className="am-control">
            <Folder size={16} aria-hidden="true" />
            <select value={queue.folderId} onChange={(event) => queue.setFolderId(event.target.value)} disabled={working} aria-label={`Ordner bei ${one.company}`}>
              <option value="">Ohne Ordner</option>
              {queue.customerFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </span>
        </div>
      ) : chosen.length > 1 ? (
        <p className="am-help">Bei mehreren Kunden landen die Dateien bei allen in „Ohne Ordner“.</p>
      ) : (
        <p className="am-note is-todo"><Inbox size={16} aria-hidden="true" /><span>Ohne Kunden landen die Dateien in der Ablage. Dort lassen sie sich später zuordnen.</span></p>
      )}

      <label className={`am-zone${dragging ? " is-dragging" : ""}`}
        onDragOver={(event) => { if (!isFileDrag(event)) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = working ? "none" : "copy"; setDragging(!working); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { if (!isFileDrag(event)) return; event.preventDefault(); event.stopPropagation(); setDragging(false); if (!working) queue.add(event.dataTransfer.files); }}>
        <CloudUpload size={26} aria-hidden="true" />
        <span><strong>{items.length ? "Weitere Dateien hierher ziehen" : "Dateien hierher ziehen"}</strong><small>oder auswählen · bis {MAX_UPLOAD_BATCH} Dateien, je bis {formatBytes(MAX_FILE_BYTES)}, keine Programme</small></span>
        <input type="file" multiple className="visually-hidden" disabled={working} onChange={(event) => { if (event.target.files) queue.add(event.target.files); event.target.value = ""; }} />
      </label>

      {items.length > 0 && (
        <div className="am-field">
          <span className="am-label">Dateien
            <span className="am-label-select">
              <select value="" onChange={(event) => { if (isFileCategory(event.target.value)) queue.categoryForAll(event.target.value); }} disabled={working} aria-label="Eine Kategorie für alle Dateien">
                <option value="">Kategorie für alle</option>
                {fileCategoryIds.map((id) => <option key={id} value={id}>{fileCategories[id]}</option>)}
              </select>
              <ChevronDown size={13} aria-hidden="true" />
            </span>
          </span>
          <ul className="am-uploads" aria-label="Ausgewählte Dateien">
            {items.map((item) => {
              const step = item.status === "working" ? item.message || "Wird vorbereitet …" : item.status === "ready" && working ? "Wartet …" : item.message;
              const locked = working || item.status === "done" || item.blocked;
              return (
                <li key={item.key} className={`am-upload is-${item.status}`}>
                  <span className="am-file-icon"><FileIcon file={{ mimeType: item.file.type, fileName: item.file.name }} size={17} /></span>
                  <span className="am-upload-text">
                    <input value={item.title} onChange={(event) => queue.update(item.key, { title: event.target.value })} maxLength={200} aria-label={`Titel für ${item.file.name}`} disabled={locked} />
                    <span className="am-upload-meta">
                      <small title={item.file.name}>{item.file.name} · {formatBytes(item.file.size)}</small>
                      <span className={`am-cat-select am-cat-${item.category}`}>
                        <i aria-hidden="true" />
                        <select value={item.category} onChange={(event) => { if (isFileCategory(event.target.value)) queue.update(item.key, { category: event.target.value }); }} disabled={locked} aria-label={`Kategorie für ${item.file.name}`}>
                          {fileCategoryIds.map((id) => <option key={id} value={id}>{fileCategories[id]}</option>)}
                        </select>
                        <ChevronDown size={13} aria-hidden="true" />
                      </span>
                    </span>
                    {step && (
                      <span className="am-upload-step">
                        <small className={item.status === "done" ? "is-done" : item.status === "error" ? "is-error" : undefined}>{step}</small>
                      </span>
                    )}
                  </span>
                  {item.status === "done" ? <span className="am-upload-state is-done" title="Hochgeladen"><Check size={16} aria-hidden="true" /></span>
                    : item.status === "working" ? <span className="am-upload-state"><MiniLoader size={16} /></span>
                    : <button type="button" className="am-icon-btn" onClick={() => queue.remove(item.key)} disabled={working} aria-label={`${item.file.name} entfernen`} title="Entfernen"><X size={15} aria-hidden="true" /></button>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {describing ? (
        <label className="am-field">
          <span className="am-label">Beschreibung für alle Dateien</span>
          <textarea className="am-textarea" value={queue.description} onChange={(event) => queue.setDescription(event.target.value)} maxLength={2000} rows={3} placeholder="Was steckt in den Dateien, wofür sind sie gedacht?" disabled={working} />
        </label>
      ) : <button type="button" className="am-link" onClick={() => setDescribing(true)} disabled={working}><Plus size={15} aria-hidden="true" />Beschreibung hinzufügen</button>}

      {chosen.length > 0 && <p className="am-note"><BellRing size={16} aria-hidden="true" /><span>{one ? `${one.company} sieht die Dateien sofort und bekommt eine Meldung.` : `Die ${chosen.length} Kunden sehen die Dateien sofort und bekommen eine Meldung.`}</span></p>}
      {queue.problem && <p className="form-error" role="alert">{queue.problem}</p>}
    </AssetPanel>
  );
}
