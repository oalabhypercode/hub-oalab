"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, ChevronDown, ChevronRight, Ellipsis, Eye, Folder, Inbox, Link2, Pencil, Trash2, UserPlus } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { setFileAssignments, updateFileDetails, type ActionResult } from "@/lib/hub-files/actions";
import { fileFormat, formatBytes, formatFileDateTime, isFileCategory, type FileCategory } from "@/lib/hub-files/catalog";
import { mayBeClear, parseImageSize, previewKind, previewRatio, previewUrl } from "@/lib/hub-files/preview";
import { fileAudiences, isFileAudience, type FileAudience, type HubFileCustomer, type HubFolder, type HubStoredFile } from "@/lib/hub-files/types";
import { audienceLabels } from "./asset-freelancers";
import { fileAudienceOfTeamSight, TEAM_SIGHT_LABELS, TEAM_SIGHTS, teamSightOfFile } from "@/lib/hub-team/rules";
import { saveCustomerLogo } from "@/lib/hub-logos/actions";
import { detectLogoGround } from "@/lib/hub-logos/ground";
import { canBeLogo, type LogoBackground } from "@/lib/hub-logos/rules";
import { useInfo } from "../info-box";
import { Select } from "../select";
import { categoryOptions } from "../select-options";
import { AssetPanel } from "./asset-panel";
import { CustomerSign } from "./customer-sign";
import { DownloadButton } from "./files-dialogs";
import { CategoryPill, CustomerPicker, FileIcon } from "./files-parts";

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
    <button type="button" className="chat-icon-button is-muted" onClick={() => setEditingId(editing ? null : file.id)} aria-pressed={editing} aria-label="Bearbeiten" data-tip="Titel, Kategorie und Beschreibung bearbeiten"><Pencil size={18} aria-hidden="true" /></button>
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
  // The original's width and height, as the preview reports them.
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const signOf = (customer: HubFileCustomer) => customers.find((item) => item.id === customer.id) ?? customer;
  // An image of the customer whose files are open can become that customer's logo in one click.
  const logoFor = here && canAssign && canBeLogo(file) && file.customers.some((customer) => customer.id === here.id) ? here : null;
  const shareInfo = useInfo("Freigabe und Sichtbarkeit", {
    steps: [
      <><b>Zuordnung ändern:</b> Kunden dazunehmen oder entfernen.</>,
      <><b>Den Ordner</b> wählst du je Kunde.</>,
      <><b>Sichtbar für</b> gilt bei Kunden mit Freelancer und bei oalab.</>,
    ],
    ask: "Wie funktionieren Freigabe, Ordner und „Sichtbar für“ einer Datei?",
  });

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
    <FilePreview file={file} live={live} onSize={setImageSize} />
    <div className="am-panel-actions">
      <DownloadButton file={file} onError={setError} label className="sheet-action is-primary" />
      {live && <button type="button" className="am-icon-btn" onClick={copyLink} aria-label="Link kopieren" data-tip={copied ? "Link kopiert" : freelancerView ? "Link kopieren" : "Link für den Kunden kopieren"}>{copied ? <Check size={17} aria-hidden="true" /> : <Link2 size={17} aria-hidden="true" />}</button>}
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
            // "Sichtbar für" matters only at customers that freelancers look after, and at oalab („Nur Team“ or „Team und
            // Freelancer“, stage 2 of „oalab als Unternehmen“).
            const team = sign.kind === "team";
            const served = Boolean(onAudience && sign.kind !== "freelancer" && (team || sign.freelancerIds?.length));
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
                      <Select variant="bare" label={`Bei ${customer.company} sichtbar für`} value={team ? fileAudienceOfTeamSight(teamSightOfFile(audience)) : audience} onChange={(value) => changeAudience(customer, value)} disabled={busy !== null}
                        options={team ? TEAM_SIGHTS.map((sight) => ({ value: fileAudienceOfTeamSight(sight), label: TEAM_SIGHT_LABELS[sight] })) : fileAudiences.map((value) => ({ value, label: audienceLabels[value] }))} />
                      <ChevronDown size={14} aria-hidden="true" />
                    </span>
                  )}
                </span>
                {!canFile(customer.id) ? <span className="am-mini is-static" data-tip={`Ordner bei ${customer.company}`}><Folder size={14} aria-hidden="true" />{folderName}</span>
                : own.length ? (
                  <span className="am-mini">
                    <Folder size={14} aria-hidden="true" />
                    <Select variant="bare" label={`Ordner bei ${customer.company}`} value={folderId} onChange={(value) => move(customer, value)} disabled={busy !== null}
                      options={[{ value: "", label: "Ohne Ordner", lead: <Inbox size={15} aria-hidden="true" /> }, ...own.map((folder) => ({ value: folder.id, label: folder.name, lead: <Folder size={15} aria-hidden="true" /> }))]} />
                    <ChevronDown size={14} aria-hidden="true" />
                  </span>
                ) : <span className="am-mini is-static" data-tip="Dieser Kunde hat noch keine Ordner"><Folder size={14} aria-hidden="true" />Ohne Ordner</span>}
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
      {imageSize && <><dt>Abmessungen</dt><dd>{new Intl.NumberFormat("de-DE").format(imageSize.width)} × {new Intl.NumberFormat("de-DE").format(imageSize.height)} px</dd></>}
      <dt>Größe</dt><dd>{formatBytes(file.sizeBytes)} ({new Intl.NumberFormat("de-DE").format(file.sizeBytes)} Bytes)</dd>
      {file.sha256 && <><dt>Prüfsumme</dt><dd className="am-hash">SHA-256 · {file.sha256}</dd></>}
    </dl>
    {file.sha256 && <p className="am-help">Der Download liefert genau diese Fassung; die Prüfsumme wurde beim Hochladen berechnet.</p>}
    {file.sampleHref && <p className="am-help">Fiktive Beispieldatei für die Vorschau.</p>}
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
          <Select variant="bare" showLead={false} label="Kategorie" value={category} onChange={(value) => { if (isFileCategory(value)) setCategory(value); }} disabled={saving} options={categoryOptions()} />
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
      <button ref={trigger} type="button" className="am-icon-btn" onClick={() => setOpen((now) => !now)} disabled={disabled} aria-haspopup="menu" aria-expanded={open} aria-label="Mehr" data-tip="Mehr"><Ellipsis size={17} aria-hidden="true" /></button>
      {open && (
        <div className="am-more-menu" role="menu">
          <button ref={first} type="button" role="menuitem" className="is-danger" onClick={() => { setOpen(false); onDelete(); }}><Trash2 size={15} aria-hidden="true" />Datei löschen</button>
        </div>
      )}
    </div>
  );
}

/**
 * Every image shows itself (user 23.11.2026): a preview the server makes (lib/hub-files/preview.ts), whatever the
 * image's size and whatever type the browser reported at the upload, in the image's own shape. See-through formats
 * stand on a chequered ground, a light logo on a dark one, in both themes. While it loads the box shimmers; an iPhone
 * photo (HEIC) or an image the server cannot read says why there is none. Every other file shows its symbol.
 */
function FilePreview({ file, live, onSize }: { file: HubStoredFile; live: boolean; onSize: (size: { width: number; height: number } | null) => void }) {
  const kind = previewKind(file.fileName, file.mimeType);
  const source = kind !== "image" ? null : file.sampleHref ?? (live ? previewUrl(file, "l") : null);
  const clear = mayBeClear(file.fileName);
  const [shown, setShown] = useState<{ src: string; ratio: number } | null>(null);
  const [ground, setGround] = useState<LogoBackground | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!source) return;
    let active = true;
    let objectUrl = "";
    let retryTimer = 0;
    const show = (src: string, width: number, height: number) => {
      if (!active) return;
      setShown({ src, ratio: previewRatio(width, height) });
      if (clear) detectLogoGround(src).then((value) => { if (active) setGround(value); });
    };
    if (file.sampleHref) {
      // The preview's example files are small and lie next to the page.
      const image = new Image();
      image.onload = () => show(source, image.naturalWidth, image.naturalHeight);
      image.onerror = () => { if (active) setFailed(true); };
      image.src = source;
    } else {
      // A server busy with many previews at once answers 503; the panel asks once more a moment later.
      const load = (attempt: number) => fetch(attempt ? `${source}&retry=1` : source)
        .then(async (response) => {
          if (response.status === 503 && attempt === 0) { retryTimer = window.setTimeout(() => { if (active) load(1); }, 2000); return; }
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const size = parseImageSize(response.headers.get("x-image-size"));
          objectUrl = URL.createObjectURL(await response.blob());
          if (active) onSize(size);
          show(objectUrl, size?.width ?? 4, size?.height ?? 3);
        })
        .catch(() => { if (active) setFailed(true); });
      load(0);
    }
    return () => {
      active = false;
      window.clearTimeout(retryTimer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source, clear, file.sampleHref, onSize]);

  if (source && !failed) {
    const groundClass = clear ? (ground === "dark" ? " is-dark" : " is-clear") : " is-photo";
    return (
      <div className={`am-preview is-image${groundClass}${shown ? "" : " is-loading"}`} aria-busy={shown ? undefined : true}>
        <div className="am-preview-frame" style={{ "--ar": (shown?.ratio ?? 4 / 3).toFixed(3) } as CSSProperties}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a preview the hub made itself, nothing to optimise */}
          {shown && <img src={shown.src} alt={`Vorschau von ${file.title}`} />}
        </div>
      </div>
    );
  }
  const note = kind === "heic" ? "iPhone-Fotos im HEIC-Format kann der Browser nicht zeigen. Herunterladen öffnet das Original."
    : kind === "image" && failed ? "Für dieses Bild gibt es gerade keine Vorschau. Herunterladen öffnet das Original." : "";
  return (
    <div className="am-preview">
      <span className="am-preview-doc"><FileIcon file={file} size={44} color="currentColor" /><b>{fileFormat(file.fileName)}</b>{note && <small>{note}</small>}</span>
    </div>
  );
}
