"use client";

import { useState } from "react";
import { BellRing, Check, ChevronDown, CloudUpload, Folder, History, Inbox, PenLine, Plus, Upload, WandSparkles, X } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { checkUpload, fileCategories, formatBytes, guessFileCategory, isFileCategory, MAX_FILE_BYTES, MAX_UPLOAD_BATCH, type FileCategory } from "@/lib/hub-files/catalog";
import { cleanName, dateFromFileName, isImageName, localDateTime, looksLikeCameraName, nameExtension, nameFiles, orderEntries, photoDate, type NamingEntry, type NamingPattern } from "@/lib/hub-files/naming";
import type { HubFileCustomer, HubFolder } from "@/lib/hub-files/types";
import { useInfo } from "../info-box";
import { Select } from "../select";
import { categoryOptions } from "../select-options";
import { finalName, NameInput, NamingBuilder, placeWords, rememberPattern, startPattern } from "./asset-naming";
import { AssetPanel } from "./asset-panel";
import { CustomerSign } from "./customer-sign";
import { CustomerPicker, FileIcon } from "./files-parts";
import { sendUpload, titleFromFileName } from "./files-upload";

/**
 * blocked: the file can never go up (empty, too big, a program); other errors can be tried again.
 * taken: when the photo was taken (photo data, else the name, else the file date), for dates and the order of numbers.
 */
type UploadItem = { key: string; file: File; title: string; category: FileCategory; status: "ready" | "working" | "done" | "error"; message: string; blocked: boolean; taken: string; image: boolean };
/** Where new files go: the customer and folder of the place the upload started from or the files were dropped on. */
export type UploadTarget = { customerId: string | null; folderId: string };
export type UploadQueue = ReturnType<typeof useUploadQueue>;
/** The name a file goes up with: its title and its download name. */
type UploadName = { title: string; fileName: string };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const isJpeg = (file: File) => file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name);

/** Files dragged in from the computer, not text or links dragged within the page. */
export const isFileDrag = (event: React.DragEvent) => Array.from(event.dataTransfer.types).includes("Files");

/**
 * The files of one upload and where they go. It lives in the Asset Management rather than in the panel, so files
 * dropped onto the list join an open upload and the folder they were dropped on becomes the target. „Namen nach
 * Muster“ (pattern and names typed by hand) lives here too, so it survives more files being dropped.
 */
export function useUploadQueue(customers: HubFileCustomer[], folders: HubFolder[]) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [customerIds, setCustomerIds] = useState<string[]>([]);
  const [folderId, setFolderId] = useState("");
  const [description, setDescription] = useState("");
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState("");
  const [namingOn, setNamingOn] = useState(false);
  const [pattern, setPattern] = useState<NamingPattern | null>(null);
  const [manual, setManual] = useState<Record<string, string>>({});
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
    const added = picked.map((file, index): UploadItem => {
      const check = checkUpload(file.name, file.size);
      const fromName = dateFromFileName(file.name);
      return {
        key: `${stamp}-${index}-${file.name}`, file, title: titleFromFileName(file.name), category: guessFileCategory(file.name, file.type),
        status: check.ok ? "ready" : "error", message: check.ok ? "" : check.error, blocked: !check.ok,
        taken: fromName ?? localDateTime(new Date(file.lastModified || stamp)), image: isImageName(file.name, file.type),
      };
    });
    const next = [...items.filter((item) => item.status !== "done"), ...added];
    setProblem(next.length > MAX_UPLOAD_BATCH ? `Höchstens ${MAX_UPLOAD_BATCH} Dateien auf einmal; die übrigen wurden nicht übernommen.` : "");
    setItems(next.slice(0, MAX_UPLOAD_BATCH));
    // JPEG photos say when they were taken; WhatsApp removes that, then the name or the file date stays.
    for (const item of added) {
      if (item.blocked || !isJpeg(item.file)) continue;
      item.file.slice(0, 256 * 1024).arrayBuffer().then((buffer) => {
        const taken = photoDate(new Uint8Array(buffer));
        if (taken) update(item.key, { taken });
      }).catch(() => { /* unreadable: the name or the file date stays */ });
    }
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
    setNamingOn(false);
    setManual({});
  }

  function summary(count: number) {
    const files = plural(count, "Datei", "Dateien");
    if (!customerIds.length) return `${files} hochgeladen. ${count === 1 ? "Sie liegt" : "Sie liegen"} in der Ablage.`;
    if (customerIds.length > 1) return `${files} hochgeladen und ${customerIds.length} Kunden zugeordnet.`;
    const company = customers.find((customer) => customer.id === customerIds[0])?.company ?? "dem Kunden";
    const folder = customerFolders.find((item) => item.id === targetFolder)?.name;
    return folder ? `${files} hochgeladen und bei ${company} in „${folder}“ abgelegt.` : `${files} hochgeladen und ${company} zugeordnet.`;
  }

  /**
   * One file after the other, each with its own one-time link and the name the panel shows for it. Gives the line for
   * the page and the new files once all of them are in.
   */
  async function upload(nameOf: (item: UploadItem) => UploadName): Promise<{ message: string; ids: string[] } | null> {
    if (!ready.length) { setProblem("Bitte zuerst Dateien auswählen."); return null; }
    setWorking(true);
    setProblem("");
    const ids: string[] = [];
    for (const item of ready) {
      const name = nameOf(item);
      try {
        update(item.key, { status: "working", message: "" });
        ids.push(await sendUpload(item.file, { title: name.title, fileName: name.fileName, category: item.category, description, customerIds, folderId: targetFolder || null }, (message) => update(item.key, { message })));
        // A file that is in keeps the name it went up with, even if the pattern changes for the rest.
        update(item.key, { status: "done", message: "Hochgeladen", title: name.title });
      } catch (failure) {
        update(item.key, { status: "error", message: failure instanceof Error ? failure.message : "Der Upload ist fehlgeschlagen." });
      }
    }
    setWorking(false);
    if (ids.length < ready.length) {
      setProblem(`${ids.length} von ${ready.length} Dateien hochgeladen. Die übrigen sind markiert.`);
      return null;
    }
    reset();
    return { message: summary(ids.length), ids };
  }

  return {
    items, ready, done, working, problem, customerIds, setCustomerIds, customerFolders, folderId: targetFolder, setFolderId, description, setDescription,
    add, start, reset, update, upload,
    remove: (key: string) => {
      setItems((list) => list.filter((item) => item.key !== key));
      setManual((now) => { const next = { ...now }; delete next[key]; return next; });
    },
    categoryForAll: (category: FileCategory) => setItems((list) => list.map((item) => item.status === "done" ? item : { ...item, category })),
    naming: { on: namingOn, pattern, manual },
    startNaming: () => { setPattern((now) => now ?? startPattern()); setNamingOn(true); },
    stopNaming: () => { setNamingOn(false); setManual({}); },
    setPattern: (next: NamingPattern) => setPattern(next),
    nameByHand: (key: string, value: string) => setManual((now) => ({ ...now, [key]: value })),
    nameByPattern: (key: string) => setManual((now) => { const next = { ...now }; delete next[key]; return next; }),
  };
}

/**
 * Upload, as a panel next to the files: for whom and into which folder (filled in from where it was opened), then the
 * files with a title and a category each. Photos with camera names get „Namen nach Muster“ on request (Lightroom-like,
 * user 13.11.2026). Customers see the files at once and get a notice.
 */
export function UploadPanel({ queue, customers, existing, onClose, onUploaded }: {
  queue: UploadQueue;
  customers: HubFileCustomer[];
  /** Names already used per place, so numbers continue and clashes show. */
  existing: ReadonlyMap<string, readonly string[]>;
  onClose: () => void;
  onUploaded: (message: string, ids: string[]) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [describing, setDescribing] = useState(Boolean(queue.description));
  const [dragging, setDragging] = useState(false);
  const { items, ready, working, naming } = queue;
  const chosen = queue.customerIds.flatMap((id) => customers.filter((customer) => customer.id === id));
  const one = chosen.length === 1 ? chosen[0] : null;
  const subtitle = working ? `${queue.done} von ${items.length} fertig` : ready.length ? `${plural(ready.length, "Datei", "Dateien")} bereit` : "Dateien wählen oder hierher ziehen";
  const info = useInfo("Hochladen", {
    steps: [
      <><b>Bis {MAX_UPLOAD_BATCH} Dateien,</b> je höchstens {formatBytes(MAX_FILE_BYTES)}.</>,
      <><b>Ohne Kunde</b> landet alles in der Ablage.</>,
      <><b>Zugeordnete Kunden</b> sehen es sofort, mit Meldung.</>,
    ],
    warn: "Programme und Skripte lädt der Hub nicht hoch.",
    ask: "Wie lade ich Dateien für einen Kunden hoch?",
  });

  // What the positions of a pattern show for each file: the one customer, the folder, the file's own category and day.
  const folderName = one ? queue.customerFolders.find((folder) => folder.id === queue.folderId)?.name ?? "" : "";
  const place = !queue.customerIds.length ? "inbox" : `${queue.customerIds[0]}:${(one && queue.folderId) || "none"}`;
  const entries: NamingEntry[] = items.filter((item) => !item.blocked && item.status !== "done").map((item, index) => ({
    key: item.key, fileName: item.file.name, image: item.image, taken: item.taken, customer: one?.company ?? "", customerNumber: one?.customerNumber ?? "",
    folder: folderName, category: fileCategories[item.category], place, index,
  }));
  const entryOf = new Map(entries.map((entry) => [entry.key, entry]));
  const result = naming.on && naming.pattern ? nameFiles(entries, naming.pattern, existing, new Set(Object.keys(naming.manual).filter((key) => entryOf.has(key)))) : null;
  const nameOf = (item: UploadItem) => {
    const entry = entryOf.get(item.key);
    return entry && naming.on ? finalName(entry, result, naming.manual, item.title) : null;
  };
  const renamed = naming.on ? entries.filter((entry) => finalName(entry, result, naming.manual, "").how !== "kept").length : 0;
  // With names after a pattern the list reads in the order of the numbers; files that are in or blocked come last.
  const rank = new Map((naming.on && naming.pattern ? orderEntries(entries, naming.pattern.order) : entries).map((entry, index) => [entry.key, index]));
  const listed = [...items].sort((a, b) => (rank.get(a.key) ?? items.length + items.indexOf(a)) - (rank.get(b.key) ?? items.length + items.indexOf(b)));
  const cryptic = items.filter((item) => item.image && !item.blocked && item.status !== "done" && looksLikeCameraName(item.file.name));

  async function submit() {
    const outcome = await queue.upload((item) => {
      const name = nameOf(item);
      const base = name && name.how !== "kept" ? cleanName(name.base) : "";
      return base ? { title: base, fileName: `${base}${nameExtension(item.file.name)}` } : { title: item.title, fileName: item.file.name };
    });
    if (!outcome) return;
    if (naming.on && naming.pattern) rememberPattern(naming.pattern);
    onUploaded(outcome.message, outcome.ids);
  }

  const footer = <>
    <button type="button" className="sheet-action" onClick={onClose} disabled={working}>Abbrechen</button>
    <button type="button" className="sheet-action is-primary" onClick={submit} disabled={working || !ready.length}>
      {working ? <MiniLoader size={16} /> : <Upload size={15} aria-hidden="true" />}{ready.length > 1 ? `${ready.length} Dateien hochladen` : "Hochladen"}
    </button>
  </>;

  return (
    <AssetPanel label="Hochladen" icon={<span className="am-tile"><Upload size={20} aria-hidden="true" /></span>} title="Hochladen" subtitle={subtitle} actions={info.button} onClose={onClose} closeDisabled={working} footer={footer}>
      {info.box}
      <div className="am-field">
        <span className="am-label">Für</span>
        <div className="am-chips">
          {chosen.map((customer) => (
            <span key={customer.id} className="am-chip">
              <CustomerSign customer={customer} logo={customer.logo} size="sm" />{customer.company}
              <button type="button" onClick={() => queue.setCustomerIds(queue.customerIds.filter((id) => id !== customer.id))} disabled={working} aria-label={`${customer.company} entfernen`} data-tip="Entfernen"><X size={14} aria-hidden="true" /></button>
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
            <Select variant="bare" label={`Ordner bei ${one.company}`} value={queue.folderId} onChange={queue.setFolderId} disabled={working}
              options={[{ value: "", label: "Ohne Ordner", lead: <Inbox size={15} aria-hidden="true" /> }, ...queue.customerFolders.map((folder) => ({ value: folder.id, label: folder.name, lead: <Folder size={15} aria-hidden="true" /> }))]} />
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

      {!naming.on && cryptic.length >= 2 && (
        <div className="rn-suggest">
          <WandSparkles size={18} aria-hidden="true" />
          <span><strong>{cryptic.length} Fotos mit Kamera-Namen</strong><small>z. B. {cryptic[0].file.name}</small></span>
          <button type="button" className="sheet-action" onClick={queue.startNaming} disabled={working}><PenLine size={15} aria-hidden="true" />Benennen</button>
        </div>
      )}

      {naming.on && naming.pattern && result && entries.length > 0 && (
        <NamingBuilder pattern={naming.pattern} onChange={queue.setPattern} result={result} entries={entries} where={placeWords(result.affected.length ? result.affected : entries)}
          customerNote={chosen.length > 1 ? "mehrere Kunden" : "kein Kunde gewählt"} onOff={queue.stopNaming} disabled={working} ask="Wie benenne ich Dateien beim Hochladen um?" />
      )}

      {items.length > 0 && (
        <div className="am-field">
          <span className="am-label">
            <span className="rn-label-left">Dateien
              {naming.on
                ? <small>{renamed} von {entries.length} neu benannt</small>
                : <button type="button" className="am-label-action" onClick={queue.startNaming} disabled={working}><PenLine size={13} aria-hidden="true" />Namen nach Muster</button>}
            </span>
            <span className="am-label-select">
              <Select variant="bare" label="Eine Kategorie für alle Dateien" placeholder="Kategorie für alle" value="" onChange={(value) => { if (isFileCategory(value)) queue.categoryForAll(value); }} disabled={working} options={categoryOptions()} />
              <ChevronDown size={13} aria-hidden="true" />
            </span>
          </span>
          <ul className="am-uploads" aria-label="Ausgewählte Dateien">
            {listed.map((item) => {
              const step = item.status === "working" ? item.message || "Wird vorbereitet …" : item.status === "ready" && working ? "Wartet …" : item.message;
              const locked = working || item.status === "done" || item.blocked;
              const name = item.status === "done" ? null : nameOf(item);
              const isNew = name !== null && name.how !== "kept";
              return (
                <li key={item.key} className={`am-upload is-${item.status}${isNew ? " is-renamed" : ""}`}>
                  <span className="am-file-icon"><FileIcon file={{ mimeType: item.file.type, fileName: item.file.name }} size={17} /></span>
                  <span className="am-upload-text">
                    {name ? (
                      <NameInput name={name} extension={nameExtension(item.file.name)} label={`${isNew ? "Neuer Name" : "Titel"} für ${item.file.name}`} keptText="behält Namen" keptTip={result?.mixed ? "Gilt nur für Bilder" : undefined} disabled={locked}
                        onChange={(value) => name.how === "kept" ? queue.update(item.key, { title: value }) : queue.nameByHand(item.key, value)} onReset={() => queue.nameByPattern(item.key)} />
                    ) : <input value={item.title} onChange={(event) => queue.update(item.key, { title: event.target.value })} maxLength={200} aria-label={`Titel für ${item.file.name}`} disabled={locked} />}
                    <span className="am-upload-meta">
                      {naming.on
                        ? <small className="rn-was" data-tip={isNew ? "Bisheriger Name" : item.file.name}>{isNew && <History size={12} aria-hidden="true" />}<span>{item.file.name} · {formatBytes(item.file.size)}</span></small>
                        : <small data-tip={item.file.name}>{item.file.name} · {formatBytes(item.file.size)}</small>}
                      <span className={`am-cat-select am-cat-${item.category}`}>
                        <i aria-hidden="true" />
                        <Select variant="bare" showLead={false} label={`Kategorie für ${item.file.name}`} value={item.category} onChange={(value) => { if (isFileCategory(value)) queue.update(item.key, { category: value }); }} disabled={locked} options={categoryOptions()} />
                        <ChevronDown size={13} aria-hidden="true" />
                      </span>
                    </span>
                    {step && (
                      <span className="am-upload-step">
                        <small className={item.status === "done" ? "is-done" : item.status === "error" ? "is-error" : undefined}>{step}</small>
                      </span>
                    )}
                  </span>
                  {item.status === "done" ? <span className="am-upload-state is-done" data-tip="Hochgeladen"><Check size={16} aria-hidden="true" /></span>
                    : item.status === "working" ? <span className="am-upload-state"><MiniLoader size={16} /></span>
                    : <button type="button" className="am-icon-btn" onClick={() => queue.remove(item.key)} disabled={working} aria-label={`${item.file.name} entfernen`} data-tip="Entfernen"><X size={15} aria-hidden="true" /></button>}
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
