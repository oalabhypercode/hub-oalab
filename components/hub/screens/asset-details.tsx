"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, Folder, Inbox, Link2, Loader2, UserPlus } from "lucide-react";
import { createDownloadUrls, setFileAssignments, type ActionResult } from "@/lib/hub-files/actions";
import { fileFormat, formatBytes, formatFileDateTime } from "@/lib/hub-files/catalog";
import type { HubFileCustomer, HubFolder, HubStoredFile } from "@/lib/hub-files/types";
import { saveCustomerLogo } from "@/lib/hub-logos/actions";
import { canBeLogo } from "@/lib/hub-logos/rules";
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
  /** An admin with real data: change the customers, make an image the logo. */
  canAssign: boolean;
  startAssigning: boolean;
  onMove: (customerId: string, folderId: string | null) => Promise<ActionResult<{ count: number }>>;
  onNotice: (message: string) => void;
};

/**
 * The details of one file, as a panel next to the list: a preview, download and link, who has the file and in which
 * of their folders (both changeable here), and the facts. A click on another file in the list shows that one.
 */
export function FilePanel({ onClose, ...props }: DetailProps & { onClose: () => void }) {
  const { file } = props;
  return (
    <AssetPanel label="Details" icon={<span className="am-file-icon is-lg"><FileIcon file={file} size={20} /></span>} title={file.title} subtitle={`${fileFormat(file.fileName)} · ${formatBytes(file.sizeBytes)}`} onClose={onClose}>
      {/* One file's state (editing, messages, preview) starts afresh with every file; the panel itself stays. */}
      <FileDetails key={`${file.id}-${props.startAssigning}`} {...props} />
    </AssetPanel>
  );
}

function FileDetails({ file, customers, folders, here, live, canAssign, startAssigning, onMove, onNotice }: DetailProps) {
  const [editing, setEditing] = useState(startAssigning && canAssign);
  const [selected, setSelected] = useState(file.customers.map((customer) => customer.id));
  const [busy, setBusy] = useState<"assign" | "move" | "logo" | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const signOf = (customer: HubFileCustomer) => customers.find((item) => item.id === customer.id) ?? customer;
  // An image of the customer whose files are open can become that customer's logo in one click.
  const logoFor = here && canAssign && canBeLogo(file) && file.customers.some((customer) => customer.id === here.id) ? here : null;

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
      {live && <button type="button" className="am-icon-btn" onClick={copyLink} aria-label="Link kopieren" title={copied ? "Link kopiert" : "Link für den Kunden kopieren"}>{copied ? <Check size={17} aria-hidden="true" /> : <Link2 size={17} aria-hidden="true" />}</button>}
    </div>
    {copied && <p className="am-help" role="status">Link kopiert. Wer ihn öffnet, sieht die Datei, wenn sein Login sie sehen darf.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}

    {logoFor && (
      <button type="button" className="am-use-logo" onClick={() => makeLogo(logoFor)} disabled={busy !== null}>
        <CustomerSign customer={logoFor} logo={logoFor.logo} size="sm" />
        <span><strong>Als Logo von {logoFor.company} verwenden</strong><small>Ersetzt {logoFor.logo ? "das bisherige Logo" : "die Anfangsbuchstaben"} in allen Listen</small></span>
        {busy === "logo" ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
      </button>
    )}

    <div className="am-field">
      <span className="am-label">Freigegeben für
        {canAssign && !editing && <button type="button" className="am-label-action" onClick={() => setEditing(true)} disabled={busy !== null}><UserPlus size={13} aria-hidden="true" />Zuordnung ändern</button>}
      </span>
      {editing ? (
        <div className="am-pick">
          <CustomerPicker customers={customers} selected={selected} onChange={setSelected} idPrefix={`am-assign-${file.id}`} />
          <p className="am-help">Neu zugeordnete Kunden sehen die Datei sofort und bekommen eine Meldung.</p>
          <div className="am-pick-actions">
            <button type="button" className="sheet-action" onClick={() => { setEditing(false); setSelected(file.customers.map((customer) => customer.id)); }} disabled={busy !== null}>Abbrechen</button>
            <button type="button" className="sheet-action is-primary" onClick={saveAssignment} disabled={busy !== null}>{busy === "assign" ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}Zuordnung speichern</button>
          </div>
        </div>
      ) : (
        <div className="am-share">
          {file.customers.length ? file.customers.map((customer) => {
            const sign = signOf(customer);
            const own = folders.filter((folder) => folder.customerId === customer.id);
            const folderId = file.folderIds[customer.id] ?? "";
            return (
              <div key={customer.id} className="am-share-row">
                <CustomerSign customer={sign} logo={sign.logo} />
                <span className="am-share-name"><strong>{customer.company}</strong><span>{customer.customerNumber}{customer.id === here?.id ? " · hier geöffnet" : ""}</span></span>
                {own.length ? (
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
