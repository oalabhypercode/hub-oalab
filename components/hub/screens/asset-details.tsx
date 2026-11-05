"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Ellipsis, Eye, Folder, Inbox, Link2, Pencil, Trash2, UserPlus } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { createDownloadUrls, setFileAssignments, updateFileDetails, type ActionResult } from "@/lib/hub-files/actions";
import { fileCategories, fileCategoryIds, fileFormat, formatBytes, formatFileDateTime, isFileCategory, type FileCategory } from "@/lib/hub-files/catalog";
import { fileAudiences, isFileAudience, type FileAudience, type HubFileCustomer, type HubFolder, type HubStoredFile } from "@/lib/hub-files/types";
import { audienceLabels } from "./asset-freelancers";
import { saveCustomerLogo } from "@/lib/hub-logos/actions";
import { canBeLogo } from "@/lib/hub-logos/rules";
import { useInfo } from "../info-box";
import { AssetPanel } from "./asset-panel";
import { CustomerSign } from "./customer-sign";
import { DownloadButton } from "./files-dialogs";
import { CategoryPill, CustomerPicker, FileIcon } from "./files-parts";

// Images up to this size show themselves in the details; bigger ones keep their symbol.
const PREVIEW_MAX_BYTES = 8 * 1024 * 1024;
const previewFormats = ["PNG", "JPG", "JPEG", "GIF", "WEBP", "AVIF", "SVG"];
const previewable = (file: HubStoredFile) => file.mimeType.startsWith("image/") && previewFormats.includes(fileFormat(file.fileName)) && file.sizeBytes <= PREVIEW_MAX_BYTES;

type DetailProps = {
  file: HubStoredFile;
  /** The customers list, which carries the logos. */
  customers: HubFileCustomer[];
  folders: HubFolder[];
  /** The customer whose files are open, if any: "hier geöffnet", and the one an image can become the logo of. */
  here: HubFileCustomer | null;
  /** Real files: the preview, the link and the logo go through the server. */
  live: boolean;
  /** An admin with real data: edit, delete, change the customers, make an image the logo. */
  canAssign: boolean;
  /** Whether the viewer files the file into a folder at this customer: admins everywhere, freelancers only at home. */
  canFile: (customerId: string) => boolean;
  /** A freelancer's view: only the customers they see, with "Nur für dich" at working files. */
  freelancerView?: boolean;
  /** Admins with freelancers in the database: who sees the file at a customer that has freelancers. */
  onAudience?: (customerId: string, audience: FileAudience) => Promise<ActionResult<null>>;
  startAssigning: boolean;
  onMove: (customerId: string, folderId: string | null) => Promise<ActionResult<{ count: number }>>;
  /** Asks to delete this file; the Asset Management confirms it first. */
  onDelete: () => void;
  onNotice: (message: string) => void;
};

/**
 * The details of one file, as a panel next to the list: a preview, download and link, who has the file and in which
 * of their folders (both changeable here), and the facts. A click on another file in the list shows that one.
 * Admins edit title, category and description with the pencil and delete the file under "…".
 */
export function FilePanel({ onClose, ...props }: DetailProps & { onClose: () => void }) {
  const { file } = props;
  // Editing belongs to one file: a click on another file leaves it.
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = props.canAssign && editingId === file.id;
  const pencil = props.canAssign && (
    <button type="button" className="chat-icon-button is-muted" onClick={() => setEditingId(editing ? null : file.id)} aria-pressed={editing} aria-label="Bearbeiten" title="Titel, Kategorie und Beschreibung bearbeiten"><Pencil size={18} aria-hidden="true" /></button>
  );
  return (
    <AssetPanel label="Details" icon={<span className="am-file-icon is-lg"><FileIcon file={file} size={20} /></span>} title={file.title} subtitle={`${fileFormat(file.fileName)} · ${formatBytes(file.sizeBytes)}`} actions={pencil} onClose={onClose}>
      {/* One file's state (messages, preview) starts afresh with every file; the panel itself stays. */}
      <FileDetails key={`${file.id}-${props.startAssigning}`} {...props} editingDetails={editing} onEditDetails={(on) => setEditingId(on ? file.id : null)} />
    </AssetPanel>
  );
}

function FileDetails({ file, customers, folders, here, live, canAssign, canFile, freelancerView = false, onAudience, startAssigning, onMove, onDelete, onNotice, editingDetails, onEditDetails }: DetailProps & { editingDetails: boolean; onEditDetails: (on: boolean) => void }) {
  const [editing, setEditing] = useState(startAssigning && canAssign);
  const [selected, setSelected] = useState(file.customers.map((customer) => customer.id));
  const [busy, setBusy] = useState<"assign" | "move" | "logo" | "audience" | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const signOf = (customer: HubFileCustomer) => customers.find((item) => item.id === customer.id) ?? customer;
  // An image of the customer whose files are open can become that customer's logo in one click.
  const logoFor = here && canAssign && canBeLogo(file) && file.customers.some((customer) => customer.id === here.id) ? here : null;
  const shareInfo = useInfo("Freigabe, Ordner und Sichtbarkeit", (
    <ul>
      <li>Hier stehen alle Kunden, die die Datei sehen. „Zuordnung ändern“ fügt Kunden hinzu oder nimmt die Datei bei einem Kunden weg; neu zugeordnete Kunden bekommen eine Meldung.</li>
      <li>Den Ordner wählst du je Kunde. Der Kunde sieht dieselben Ordner und kann die Datei auch selbst einsortieren.</li>
      <li>„Sichtbar für“ steht nur bei Kunden, die ein Freelancer betreut: Kunde und Freelancer, nur der Kunde oder nur der Freelancer. Verträge, Angebote und Rechnungen stehen von selbst auf „Nur Kunde“. Wer die Datei dadurch neu sieht, bekommt eine Meldung.</li>
      <li>Das Ketten-Symbol kopiert den Link zur Datei. Er öffnet sie nur für Logins, die sie sehen dürfen.</li>
      <li>„…“ › „Datei löschen“ entfernt die Datei bei allen Kunden. Soll sie nur bei einem verschwinden, nimm „Zuordnung ändern“.</li>
    </ul>
  ));

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function saveAssignment() {
    setBusy("assign");
    setError("");
    const result = await setFileAssignments(file.id, selected);
    setBusy(null);
    if (!result.ok) { setError(result.error); return; }
    setEditing(false);
    onNotice(result.data.count ? `Zuordnung von „${file.title}“ gespeichert.` : `„${file.title}“ liegt jetzt in der Ablage.`);
  }

  async function move(customer: HubFileCustomer, folderId: string) {
    setBusy("move");
    setError("");
    const result = await onMove(customer.id, folderId || null);
    setBusy(null);
    if (!result.ok) { setError(result.error); return; }
    onNotice(`„${file.title}“ liegt bei ${customer.company} jetzt in „${folders.find((folder) => folder.id === folderId)?.name ?? "Ohne Ordner"}“.`);
  }

  async function changeAudience(customer: HubFileCustomer, value: string) {
    if (!onAudience || !isFileAudience(value)) return;
    setBusy("audience");
    setError("");
    const result = await onAudience(customer.id, value);
    setBusy(null);
    if (!result.ok) setError(result.error);
  }

  async function makeLogo(customer: HubFileCustomer) {
    setBusy("logo");
    setError("");
    const result = await saveCustomerLogo({ customerId: customer.id, source: { kind: "file", fileId: file.id }, background: customer.logo?.background ?? "light", color: customer.logo?.color ?? null });
    setBusy(null);
    if (!result.ok) { setError(result.error); return; }
    onNotice(`Logo von ${customer.company} gespeichert. Den Hintergrund änderst du über das Zeichen oben.`);
  }

  async function copyLink() {
    setError("");
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/dashboard/files?file=${encodeURIComponent(file.id)}`);
      setCopied(true);
    } catch {
      setError("Der Link ließ sich nicht kopieren.");
    }
  }

  return <>
    <FilePreview file={file} live={live} />
    <div className="am-panel-actions">
      <DownloadButton file={file} onError={setError} label className="sheet-action is-primary" />
      {live && <button type="button" className="am-icon-btn" onClick={copyLink} aria-label="Link kopieren" title={copied ? "Link kopiert" : freelancerView ? "Link kopieren" : "Link für den Kunden kopieren"}>{copied ? <Check size={17} aria-hidden="true" /> : <Link2 size={17} aria-hidden="true" />}</button>}
      {canAssign && <MoreMenu onDelete={onDelete} disabled={busy !== null} />}
    </div>
    {copied && <p className="am-help" role="status">Link kopiert. Wer ihn öffnet, sieht die Datei, wenn sein Login sie sehen darf.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {editingDetails && <FileEditForm file={file} onClose={() => onEditDetails(false)} onNotice={onNotice} />}

    {logoFor && (
      <button type="button" className="am-use-logo" onClick={() => makeLogo(logoFor)} disabled={busy !== null}>
        <CustomerSign customer={logoFor} logo={logoFor.logo} size="sm" />
        <span><strong>Als Logo von {logoFor.company} verwenden</strong><small>Ersetzt {logoFor.logo ? "das bisherige Logo" : "die Anfangsbuchstaben"} in allen Listen</small></span>
        {busy === "logo" ? <MiniLoader size={16} /> : <ChevronRight size={16} aria-hidden="true" />}
      </button>
    )}

    <div className="am-field">
      <span className="am-label">{freelancerView ? "Liegt bei" : "Freigegeben für"}
        {canAssign && shareInfo.button}
        {canAssign && !editing && <button type="button" className="am-label-action" onClick={() => setEditing(true)} disabled={busy !== null}><UserPlus size={13} aria-hidden="true" />Zuordnung ändern</button>}
      </span>
      {canAssign && shareInfo.box}
      {editing ? (
        <div className="am-pick">
          <CustomerPicker customers={customers} selected={selected} onChange={setSelected} idPrefix={`am-assign-${file.id}`} />
          <p className="am-help">Neu zugeordnete Kunden sehen die Datei sofort und bekommen eine Meldung.</p>
          <div className="am-pick-actions">
            <button type="button" className="sheet-action" onClick={() => { setEditing(false); setSelected(file.customers.map((customer) => customer.id)); }} disabled={busy !== null}>Abbrechen</button>
            <button type="button" className="sheet-action is-primary" onClick={saveAssignment} disabled={busy !== null}>{busy === "assign" ? <MiniLoader size={16} /> : <Check size={15} aria-hidden="true" />}Zuordnung speichern</button>
          </div>
        </div>
      ) : (
        <div className="am-share">
          {file.customers.length ? file.customers.map((customer) => {
            const sign = signOf(customer);
            const own = folders.filter((folder) => folder.customerId === customer.id);
            const folderId = file.folderIds[customer.id] ?? "";
            const audience = file.audiences?.[customer.id] ?? "both";
            // "Sichtbar für" matters only at customers that freelancers look after.
            const served = Boolean(onAudience && sign.kind !== "freelancer" && sign.freelancerIds?.length);
            const folderName = own.find((folder) => folder.id === folderId)?.name ?? "Ohne Ordner";
            return (
              <div key={customer.id} className="am-share-row">
                <CustomerSign customer={sign} logo={sign.logo} />
                <span className="am-share-name">
                  <strong>{customer.company}</strong>
                  <span>{customer.customerNumber}{customer.id === here?.id ? " · hier geöffnet" : ""}{freelancerView && audience === "freelancer" ? " · nur für dich" : ""}</span>
                  {served && (
                    <span className="am-mini am-audience">
                      <Eye size={14} aria-hidden="true" />
                      <select value={audience} onChange={(event) => changeAudience(customer, event.target.value)} disabled={busy !== null} aria-label={`Bei ${customer.company} sichtbar für`}>
                        {fileAudiences.map((value) => <option key={value} value={value}>{audienceLabels[value]}</option>)}
                      </select>
                      <ChevronDown size={14} aria-hidden="true" />
                    </span>
                  )}
                </span>
                {!canFile(customer.id) ? <span className="am-mini is-static" title={`Ordner bei ${customer.company}`}><Folder size={14} aria-hidden="true" />{folderName}</span>
                : own.length ? (
                  <span className="am-mini">
                    <Folder size={14} aria-hidden="true" />
                    <select value={folderId} onChange={(event) => move(customer, event.target.value)} disabled={busy !== null} aria-label={`Ordner bei ${customer.company}`}>
                      <option value="">Ohne Ordner</option>
                      {own.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                    </select>
                    <ChevronDown size={14} aria-hidden="true" />
                  </span>
                ) : <span className="am-mini is-static" title="Dieser Kunde hat noch keine Ordner"><Folder size={14} aria-hidden="true" />Ohne Ordner</span>}
              </div>
            );
          }) : (
            <div className="am-share-row">
              <span className="am-tile is-inbox"><Inbox size={18} aria-hidden="true" /></span>
              <span className="am-share-name"><strong>Ablage</strong><span>Noch kein Kunde sieht die Datei</span></span>
            </div>
          )}
        </div>
      )}
    </div>

    <dl className="am-dl">
      <dt>Kategorie</dt><dd><CategoryPill category={file.category} /></dd>
      <dt>Beschreibung</dt><dd>{file.description || "Keine Beschreibung."}</dd>
      <dt>Bereitgestellt</dt><dd>{formatFileDateTime(file.createdAt)}</dd>
      <dt>Originaldatei</dt><dd>{file.fileName}</dd>
      <dt>Format</dt><dd>{fileFormat(file.fileName)} ({file.mimeType})</dd>
      <dt>Größe</dt><dd>{formatBytes(file.sizeBytes)} ({new Intl.NumberFormat("de-DE").format(file.sizeBytes)} Bytes)</dd>
      {file.sha256 && <><dt>Prüfsumme</dt><dd className="am-hash">SHA-256 · {file.sha256}</dd></>}
    </dl>
    {file.sha256 && <p className="am-help">Der Download liefert genau diese Fassung; die Prüfsumme wurde beim Hochladen berechnet.</p>}
    {file.sampleHref && <p className="am-help">Fiktive Beispieldatei für die Demo.</p>}
  </>;
}

/** Title, category and description of one file. Customers get no notice for this. */
function FileEditForm({ file, onClose, onNotice }: { file: HubStoredFile; onClose: () => void; onNotice: (message: string) => void }) {
  const [title, setTitle] = useState(file.title);
  const [category, setCategory] = useState<FileCategory>(file.category);
  const [description, setDescription] = useState(file.description);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const unchanged = title.trim() === file.title && category === file.category && description.trim() === file.description;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const result = await updateFileDetails(file.id, { title, category, description });
    setSaving(false);
    if (!result.ok) { setError(result.error); return; }
    onClose();
    onNotice(`„${result.data.title}“ gespeichert.`);
  }

  return (
    <form className="am-edit" onSubmit={save}>
      <label className="am-field"><span className="am-label">Titel</span><input className="am-input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required autoFocus disabled={saving} /></label>
      <div className="am-field">
        <span className="am-label">Kategorie</span>
        <span className={`am-control am-cat-${category}`}>
          <i aria-hidden="true" />
          <select value={category} onChange={(event) => { if (isFileCategory(event.target.value)) setCategory(event.target.value); }} disabled={saving} aria-label="Kategorie">
            {fileCategoryIds.map((id) => <option key={id} value={id}>{fileCategories[id]}</option>)}
          </select>
          <ChevronDown size={16} aria-hidden="true" />
        </span>
      </div>
      <label className="am-field"><span className="am-label">Beschreibung</span><textarea className="am-textarea" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={3} placeholder="Was steckt in der Datei, wofür ist sie gedacht?" disabled={saving} /></label>
      <p className="am-help">Kunden bekommen für diese Änderung keine Meldung.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="am-pick-actions">
        <button type="button" className="sheet-action" onClick={onClose} disabled={saving}>Abbrechen</button>
        <button type="submit" className="sheet-action is-primary" disabled={saving || !title.trim() || unchanged}>{saving ? <MiniLoader size={16} /> : <Check size={15} aria-hidden="true" />}Speichern</button>
      </div>
    </form>
  );
}

/** "…" beside the download: what changes the file itself; for now deleting it, later a new version. */
function MoreMenu({ onDelete, disabled }: { onDelete: () => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const close = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div className="am-more" ref={box} onKeyDown={(event) => {
      if (event.key !== "Escape" || !open) return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }}>
      <button ref={trigger} type="button" className="am-icon-btn" onClick={() => setOpen((now) => !now)} disabled={disabled} aria-haspopup="menu" aria-expanded={open} aria-label="Mehr" title="Mehr"><Ellipsis size={17} aria-hidden="true" /></button>
      {open && (
        <div className="am-more-menu" role="menu">
          <button ref={first} type="button" role="menuitem" className="is-danger" onClick={() => { setOpen(false); onDelete(); }}><Trash2 size={15} aria-hidden="true" />Datei löschen</button>
        </div>
      )}
    </div>
  );
}

/** Images show themselves through a 60-second link, every other file its symbol and format. */
function FilePreview({ file, live }: { file: HubStoredFile; live: boolean }) {
  const image = previewable(file);
  const [url, setUrl] = useState<string | null>(image && file.sampleHref ? file.sampleHref : null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!image || !live || file.sampleHref) return;
    let active = true;
    createDownloadUrls([file.id])
      .then((result) => { if (active && result.ok) setUrl(result.data[0]?.url ?? null); })
      .catch(() => { /* the symbol stays */ });
    return () => { active = false; };
  }, [file.id, file.sampleHref, image, live]);

  const shown = url !== null && !failed;
  return (
    <div className={`am-preview${shown ? " is-image" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a 60-second preview link, nothing to optimise */}
      {shown ? <img src={url} alt="" onError={() => setFailed(true)} /> : <span className="am-preview-doc"><FileIcon file={file} size={44} color="currentColor" /><b>{fileFormat(file.fileName)}</b></span>}
    </div>
  );
}
