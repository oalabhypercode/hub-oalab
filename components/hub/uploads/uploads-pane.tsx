"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, CircleCheck, Clock, CloudUpload, Download, Eye, Folder, FolderInput, HardDrive, Hourglass, Inbox, Lock, Pencil, Tag, Trash2, Users } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { fileCategories, fileCategoryIds, formatBytes, guessFileCategory, isFileCategory } from "@/lib/hub-files/catalog";
import type { FileAudience, HubFileCustomer, HubFolder } from "@/lib/hub-files/types";
import { removeUpload, saveUploadLimits, takeUpload, uploadFileUrl } from "@/lib/hub-uploads/actions";
import { expiryOf, limitLabel, spaceMeter, UPLOAD_KEEP_DAYS, UPLOAD_LIMIT_CHOICES } from "@/lib/hub-uploads/rules";
import type { HubUpload, HubUploadsState } from "@/lib/hub-uploads/types";
import { useInfo } from "../info-box";
import { Select } from "../select";
import { categoryDot } from "../select-options";
import { SheetEmpty, SheetFooter, SheetToolbar } from "../sheet";
import { audienceLabels } from "../screens/asset-freelancers";
import { AssetPanel } from "../screens/asset-panel";
import { CustomerSign } from "../screens/customer-sign";
import { PanelSection } from "../screens/users-panel";
import { UploadIcon, uploadedWhen } from "./upload-parts";

/*
 * The admins' side of the customers' upload area (Asset Management › Upload-Bereich, preview „Version 3“ approved
 * 27.11.2026): what customers uploaded, grouped by customer, the customer whose file runs out first on top. „Übernehmen“
 * files an upload with the customer for good; „Speicher“ sets the default and each customer's own limit. On phones
 * the rows are short and a tap opens the actions as a sheet from below; deleting stays in the row.
 */

const phoneQuery = "(max-width: 767px)";
const subscribePhone = (listener: () => void) => { const list = window.matchMedia(phoneQuery); list.addEventListener("change", listener); return () => list.removeEventListener("change", listener); };
const usePhone = () => useSyncExternalStore(subscribePhone, () => window.matchMedia(phoneQuery).matches, () => false);
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const soonest = (upload: HubUpload) => upload.expiresAt ?? Number.MAX_SAFE_INTEGER;

/** The list entry's second line: „3 Dateien warten · 4,6 GB“. */
export function uploadsSummary(list: HubUpload[]) {
  const waiting = list.filter((upload) => upload.status === "waiting");
  return waiting.length ? `${plural(waiting.length, "Datei wartet", "Dateien warten")} · ${formatBytes(waiting.reduce((sum, upload) => sum + upload.sizeBytes, 0))}` : "Nichts wartet auf Übernahme";
}

/** The list entry's pill: how many wait, red once one runs out today. */
export function uploadsPill(list: HubUpload[]) {
  const now = Date.now();
  const waiting = list.filter((upload) => upload.status === "waiting");
  if (!waiting.length) return <span className="am-count">0</span>;
  const today = waiting.filter((upload) => upload.expiresAt && expiryOf(upload.expiresAt, now, "admin").days === 0).length;
  return <span className={`chat-pill ${today ? "tone-bad" : "tone-todo"}`} data-tip={plural(waiting.length, "Datei wartet", "Dateien warten")} data-tip-sub={today ? `${today} ${today === 1 ? "läuft" : "laufen"} heute ab` : undefined}>{waiting.length}</span>;
}

type PanelState = { kind: "take"; id: string } | { kind: "limits" } | { kind: "actions"; id: string } | null;

export function UploadsPane({ uploads, customers, folders, onBack, onNotice }: { uploads: HubUploadsState; customers: HubFileCustomer[]; folders: HubFolder[]; onBack: () => void; onNotice: (message: string) => void }) {
  const router = useRouter();
  const phone = usePhone();
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<PanelState>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [now] = useState(() => Date.now());
  const info = useInfo("Upload-Bereich der Kunden", {
    steps: [
      <><b>Kunden laden</b> hier Dateien bis 5 GB für dich hoch.</>,
      <><b>Übernehmen</b> legt sie dauerhaft beim Kunden ab.</>,
      <><b>Nach 7 Tagen</b> löscht der Hub, was keiner übernimmt.</>,
    ],
    ask: "Wie arbeite ich mit dem Upload-Bereich der Kunden?",
  });

  const byId = new Map(customers.map((customer) => [customer.id, customer]));
  const defaultLimit = uploads.settings?.defaultLimit ?? UPLOAD_LIMIT_CHOICES[2];
  const limitOf = (customerId: string) => uploads.limits[customerId] ?? defaultLimit;
  const usedBy = (customerId: string) => uploads.uploads.filter((upload) => upload.customerId === customerId).reduce((sum, upload) => sum + upload.sizeBytes, 0);
  const term = query.trim().toLowerCase();
  const shown = uploads.uploads.filter((upload) => !term || `${upload.fileName} ${byId.get(upload.customerId)?.company ?? ""} ${byId.get(upload.customerId)?.customerNumber ?? ""} ${upload.uploader}`.toLowerCase().includes(term));
  const groups = [...new Set(shown.map((upload) => upload.customerId))]
    .map((customerId) => ({ customerId, customer: byId.get(customerId) ?? null, items: shown.filter((upload) => upload.customerId === customerId).sort((a, b) => soonest(a) - soonest(b)) }))
    .sort((a, b) => soonest(a.items[0]) - soonest(b.items[0]));
  const total = uploads.uploads.reduce((sum, upload) => sum + upload.sizeBytes, 0);
  const customerCount = new Set(uploads.uploads.map((upload) => upload.customerId)).size;
  const open = panel && panel.kind !== "limits" ? uploads.uploads.find((upload) => upload.id === panel.id) ?? null : null;

  async function remove(upload: HubUpload) {
    setBusy(upload.id);
    setError("");
    const result = await removeUpload(upload.id);
    setBusy(null);
    setConfirming(null);
    if (!result.ok) { setError(result.error); return; }
    if (open?.id === upload.id) setPanel(null);
    onNotice(`„${upload.fileName}“ gelöscht.`);
    router.refresh();
  }
  async function fetchFile(upload: HubUpload, mode: "view" | "download") {
    setError("");
    const result = await uploadFileUrl(upload.id, mode);
    if (!result.ok) { setError(result.error); return; }
    if (mode === "view") window.open(result.data.url, "_blank", "noopener,noreferrer");
    else window.location.assign(result.data.url);
  }

  const row = (upload: HubUpload) => {
    const expiry = upload.expiresAt ? expiryOf(upload.expiresAt, now, "admin") : null;
    const waiting = upload.status === "waiting";
    const asking = confirming === upload.id;
    const veil = expiry && expiry.days === 0 ? " veil-none" : expiry && expiry.days <= 2 ? " veil-open" : "";
    const opened = open?.id === upload.id;
    return (
      <li key={upload.id} className={`up-row is-admin${veil ? ` has-veil${veil}` : ""}${opened ? " is-open" : ""}`}>
        <UploadIcon fileName={upload.fileName} mimeType={upload.mimeType} />
        <button type="button" className="up-main up-open" disabled={!waiting} onClick={() => setPanel(phone ? { kind: "actions", id: upload.id } : { kind: "take", id: upload.id })}
          aria-label={waiting ? `${upload.fileName}: ${phone ? "Aktionen" : "übernehmen"}` : `${upload.fileName} lädt noch hoch`}>
          <strong>{upload.fileName}</strong>
          <span>{[formatBytes(upload.sizeBytes), uploadedWhen(upload.createdAt, now), upload.uploader].filter(Boolean).join(" · ")}</span>
        </button>
        <span className="up-size numeric">{formatBytes(upload.sizeBytes)}</span>
        {expiry
          ? <span className={`chat-pill has-icon tone-${expiry.tone} up-expiry`}><Hourglass aria-hidden="true" /><span className="up-expiry-long">{expiry.text}</span><span className="up-expiry-short">{expiry.short}</span></span>
          : <span className="chat-pill has-icon tone-info up-expiry"><CloudUpload aria-hidden="true" /><span className="up-expiry-long">lädt hoch</span><span className="up-expiry-short">lädt</span></span>}
        <span className="up-acts">
          {waiting && <button type="button" className="sheet-action up-take" onClick={() => setPanel({ kind: "take", id: upload.id })} data-tip="Übernehmen" data-tip-sub="Dauerhaft zu den Dateien des Kunden"><FolderInput aria-hidden="true" /><span className="up-act-text">Übernehmen</span></button>}
          {waiting && <button type="button" className="am-icon-btn is-accent up-download" onClick={() => fetchFile(upload, "download")} aria-label={`${upload.fileName} herunterladen`} data-tip="Herunterladen"><Download size={15} aria-hidden="true" /></button>}
          {asking
            ? <button type="button" className="sheet-action is-danger" onClick={() => remove(upload)} disabled={busy !== null}>{busy === upload.id ? <MiniLoader size={14} /> : <Trash2 aria-hidden="true" />}Löschen</button>
            : <button type="button" className="am-icon-btn up-delete" onClick={() => setConfirming(upload.id)} aria-label={`${upload.fileName} löschen`} data-tip="Löschen" data-tip-sub="Auch beim Kunden weg"><Trash2 size={15} aria-hidden="true" /></button>}
        </span>
      </li>
    );
  };

  return (
    <section className={`am-pane up-pane${panel ? " has-panel" : ""}`} aria-label="Upload-Bereich">
      <header className="am-pane-head">
        <button type="button" className="chat-back" onClick={onBack} aria-label="Zurück zu den Kunden"><ChevronLeft size={24} aria-hidden="true" /></button>
        <span className="am-tile is-upload is-lg"><CloudUpload size={22} aria-hidden="true" /></span>
        <div className="am-pane-title">
          <strong>Upload-Bereich</strong>
          <span>{uploads.uploads.length ? `${plural(uploads.uploads.length, "Datei", "Dateien")} von ${plural(customerCount, "Kunde", "Kunden")} · ${formatBytes(total)}. Ohne Übernahme löscht der Hub sie nach ${UPLOAD_KEEP_DAYS} Tagen.` : `Was Kunden hochladen, wartet hier bis zu ${UPLOAD_KEEP_DAYS} Tage auf dich.`}</span>
        </div>
        <div className="am-pane-actions">
          {info.button}
          <button type="button" className="sheet-action" aria-pressed={panel?.kind === "limits"} onClick={() => setPanel(panel?.kind === "limits" ? null : { kind: "limits" })} data-tip-compact="Speicher"><HardDrive size={15} aria-hidden="true" /><span className="am-btn-text" data-tip-label>Speicher</span></button>
        </div>
      </header>
      {info.box}
      <SheetToolbar query={query} onQuery={setQuery} placeholder="Datei oder Kunde suchen" label="Upload-Bereich durchsuchen" trailing={<span className="up-admin-sub"><Clock size={14} aria-hidden="true" />Sortiert nach Ablauf</span>} />
      {(error || uploads.error) && <p className="form-error up-error" role="alert">{error || uploads.error}</p>}
      <div className="am-scroll up-scroll">
        {groups.length ? groups.map(({ customerId, customer, items }) => {
          const used = usedBy(customerId);
          const limit = limitOf(customerId);
          const meter = spaceMeter(used, limit);
          return (
            <div key={customerId} className="up-group">
              <div className="up-group-head">
                {customer ? <CustomerSign customer={customer} logo={customer.logo} size="md" /> : <span className="am-tile is-md"><Users size={16} aria-hidden="true" /></span>}
                <span className="up-group-name">{customer?.company ?? "Unbekannter Kunde"}</span>
                <span className="up-group-count">{plural(items.length, "Datei", "Dateien")}</span>
                <span className="up-group-usage">
                  <span className={`up-mini${meter.tone ? ` is-${meter.tone}` : ""}`} aria-hidden="true"><span style={{ width: `${Math.max(meter.percent, used ? 2 : 0)}%` }} /></span>
                  {formatBytes(used)} von {limitLabel(limit)}
                  <button type="button" className="up-group-edit" onClick={() => setPanel({ kind: "limits" })} aria-label={`Speicher von ${customer?.company ?? "diesem Kunden"} ändern`} data-tip="Speicher ändern"><Pencil aria-hidden="true" /></button>
                </span>
              </div>
              <ul className="up-list" role="list">{items.map(row)}</ul>
            </div>
          );
        }) : <SheetEmpty text={term ? `Nichts passt zu „${query.trim()}“.` : "Gerade wartet nichts. Was Kunden hochladen, erscheint hier, und du bekommst eine Meldung."} onReset={term ? () => setQuery("") : undefined} />}
      </div>
      <SheetFooter hint="Übernommene Dateien bleiben dauerhaft beim Kunden">{plural(uploads.uploads.length, "Datei", "Dateien")}{uploads.uploads.length ? ` · ${formatBytes(total)}` : ""}</SheetFooter>

      {panel?.kind === "take" && open && (
        <TakePanel key={open.id} upload={open} customer={byId.get(open.customerId) ?? null} folders={folders.filter((folder) => folder.customerId === open.customerId)} now={now} onClose={() => setPanel(null)}
          onDone={(message) => { setPanel(null); onNotice(message); router.refresh(); }} />
      )}
      {panel?.kind === "actions" && open && <>
        <button type="button" className="cal-scrim" aria-label="Schließen" tabIndex={-1} onClick={() => setPanel(null)} />
        <AssetPanel className="um-panel cal-bsheet up-actions" label={open.fileName} onClose={() => setPanel(null)} icon={<UploadIcon fileName={open.fileName} mimeType={open.mimeType} />}
          title={open.fileName} subtitle={`${formatBytes(open.sizeBytes)} · ${byId.get(open.customerId)?.company ?? ""}`}>
          <ul className="up-facts" role="list">
            <li><Clock aria-hidden="true" /><span>{uploadedWhen(open.createdAt, now)}{open.uploader ? ` · von ${open.uploader}` : ""}</span></li>
            {open.expiresAt && <li className={`is-${expiryOf(open.expiresAt, now, "admin").tone}`}><Hourglass aria-hidden="true" /><span>{expiryOf(open.expiresAt, now, "admin").days === 0 ? "Wird heute gelöscht, wenn du sie nicht übernimmst." : `Wird gelöscht, wenn du sie nicht übernimmst: ${expiryOf(open.expiresAt, now, "admin").text}.`}</span></li>}
          </ul>
          <div className="up-sheet-actions" role="group" aria-label="Was möchtest du damit tun?">
            <button type="button" className="up-action is-primary" onClick={() => setPanel({ kind: "take", id: open.id })}><FolderInput aria-hidden="true" /><span><b>Übernehmen</b><small>Dauerhaft zu den Dateien von {byId.get(open.customerId)?.company ?? "dem Kunden"}</small></span></button>
            <button type="button" className="up-action" onClick={() => fetchFile(open, "view")}><Eye aria-hidden="true" /><span><b>Ansehen</b><small>Im Browser öffnen, ohne herunterzuladen</small></span></button>
            <button type="button" className="up-action" onClick={() => fetchFile(open, "download")}><Download aria-hidden="true" /><span><b>Herunterladen</b><small>{formatBytes(open.sizeBytes)} auf dieses Gerät</small></span></button>
          </div>
        </AssetPanel>
      </>}
      {panel?.kind === "limits" && (
        <LimitsPanel uploads={uploads} customers={customers} now={now} onClose={() => setPanel(null)} onDone={(message) => { setPanel(null); onNotice(message); router.refresh(); }} />
      )}
    </section>
  );
}

/* ---------- „Übernehmen“: file an upload with the customer for good ---------- */

const restricted = ["contract", "offer", "invoice"];

function TakePanel({ upload, customer, folders, now, onClose, onDone }: { upload: HubUpload; customer: HubFileCustomer | null; folders: HubFolder[]; now: number; onClose: () => void; onDone: (message: string) => void }) {
  const dot = upload.fileName.lastIndexOf(".");
  const [title, setTitle] = useState((dot > 0 ? upload.fileName.slice(0, dot) : upload.fileName).slice(0, 200));
  const guessed = guessFileCategory(upload.fileName, upload.mimeType);
  const [category, setCategory] = useState<string>(isFileCategory(guessed) ? guessed : "other");
  const [audience, setAudience] = useState<FileAudience>(restricted.includes(category) ? "customer" : "both");
  const [folderId, setFolderId] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const folderName = folders.find((folder) => folder.id === folderId)?.name ?? "Ohne Ordner";
  const company = customer?.company ?? "dem Kunden";

  async function take() {
    setBusy(true);
    setError("");
    const result = await takeUpload({ id: upload.id, title, category, description, audience, folderId: folderId || null });
    setBusy(false);
    if (result.ok) onDone(`„${title.trim()}“ liegt jetzt bei ${company} unter Dateien › ${folderName}.`); else setError(result.error);
  }

  return (
    <AssetPanel className="um-panel up-take-panel" label="Übernehmen" onClose={onClose} icon={<span className="cal-panel-glyph tone-ok"><FolderInput size={19} aria-hidden="true" /></span>}
      title="Übernehmen" subtitle={`${upload.fileName} · ${formatBytes(upload.sizeBytes)}`}
      footer={<>
        <button type="button" className="sheet-action" onClick={onClose} disabled={busy}>Abbrechen</button>
        <span className="pj-spacer" />
        <button type="button" className="sheet-action is-primary" onClick={take} disabled={busy || !title.trim()}>{busy ? <MiniLoader size={15} /> : <FolderInput size={15} aria-hidden="true" />}Übernehmen</button>
      </>}>
      <div className="up-file-card"><UploadIcon fileName={upload.fileName} mimeType={upload.mimeType} /><span className="up-main"><strong>{upload.fileName}</strong><span>Hochgeladen {uploadedWhen(upload.createdAt, now)}{upload.uploader ? ` von ${upload.uploader}` : ""}</span></span></div>
      <PanelSection title="Kunde" meta="hat hochgeladen">
        <div className="up-static">{customer ? <CustomerSign customer={customer} logo={customer.logo} size="xs" /> : <Users size={15} aria-hidden="true" />}{company}{customer && <small>{customer.customerNumber}</small>}</div>
      </PanelSection>
      <PanelSection title="Ablegen als">
        <div className="um-grid">
          <label className="um-field is-wide"><span className="am-label">Titel</span><input className="am-input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} disabled={busy} /></label>
          <div className="um-field"><span className="am-label">Ordner</span>
            <span className="um-pick"><span className="up-mark"><Folder size={15} aria-hidden="true" /></span><Select variant="bare" showLead={false} label="Ordner" value={folderId} onChange={setFolderId} disabled={busy}
              options={[{ value: "", label: "Ohne Ordner", lead: <Inbox size={15} aria-hidden="true" /> }, ...folders.map((folder) => ({ value: folder.id, label: folder.name, lead: <Folder size={15} aria-hidden="true" /> }))]} /><ChevronDown size={16} aria-hidden="true" /></span>
          </div>
          <div className="um-field"><span className="am-label">Kategorie</span>
            <span className="um-pick"><span className="up-mark"><Tag size={15} aria-hidden="true" /></span><Select variant="bare" showLead={false} label="Kategorie" value={category} disabled={busy}
              onChange={(next) => { setCategory(next); if (restricted.includes(next)) setAudience("customer"); }}
              options={fileCategoryIds.map((id) => ({ value: id, label: fileCategories[id], lead: categoryDot(id) }))} /><ChevronDown size={16} aria-hidden="true" /></span>
          </div>
          <div className="um-field is-wide"><span className="am-label">Sichtbar für</span>
            <span className="um-pick"><span className="up-mark"><Eye size={15} aria-hidden="true" /></span><Select variant="bare" showLead={false} label="Sichtbar für" value={audience} onChange={(next) => setAudience(next as FileAudience)} disabled={busy}
              options={(["both", "customer", "freelancer"] as FileAudience[]).map((id) => ({ value: id, label: audienceLabels[id] }))} /><ChevronDown size={16} aria-hidden="true" /></span>
          </div>
          <label className="um-field is-wide"><span className="am-label">Beschreibung</span><textarea className="am-textarea" rows={2} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} placeholder="Wofür die Datei ist" disabled={busy} /></label>
        </div>
      </PanelSection>
      <p className="cal-panel-note"><CircleCheck size={15} aria-hidden="true" /><span><b>Danach dauerhaft:</b> Die Datei liegt bei {company} unter Dateien › {folderName}, läuft nicht mehr ab und zählt nicht mehr zum Upload-Speicher. {company} bekommt eine Meldung.</span></p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </AssetPanel>
  );
}

/* ---------- „Speicher“: the default and each customer's own limit ---------- */

function LimitsPanel({ uploads, customers, now, onClose, onDone }: { uploads: HubUploadsState; customers: HubFileCustomer[]; now: number; onClose: () => void; onDone: (message: string) => void }) {
  const [defaultLimit, setDefaultLimit] = useState(uploads.settings?.defaultLimit ?? UPLOAD_LIMIT_CHOICES[2]);
  const [limits, setLimits] = useState<Record<string, number | null>>(uploads.limits);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const usedBy = (customerId: string) => uploads.uploads.filter((upload) => upload.customerId === customerId).reduce((sum, upload) => sum + upload.sizeBytes, 0);
  const list = customers.filter((customer) => customer.kind !== "freelancer" && customer.kind !== "team")
    .sort((a, b) => Number(usedBy(b.id) > 0) - Number(usedBy(a.id) > 0) || a.company.localeCompare(b.company, "de"));
  const withUploads = list.filter((customer) => usedBy(customer.id) > 0).length;
  const today = uploads.uploads.filter((upload) => upload.expiresAt && expiryOf(upload.expiresAt, now, "admin").days === 0).length;
  const choices = UPLOAD_LIMIT_CHOICES.map((value) => ({ value: String(value), label: limitLabel(value) }));

  async function save() {
    setBusy(true);
    setError("");
    const changed = Object.fromEntries(list.filter((customer) => (limits[customer.id] ?? null) !== (uploads.limits[customer.id] ?? null)).map((customer) => [customer.id, limits[customer.id] ?? null]));
    const result = await saveUploadLimits({ defaultLimit, limits: changed });
    setBusy(false);
    if (result.ok) onDone("Speicher für Uploads gespeichert."); else setError(result.error);
  }

  return (
    <AssetPanel className="um-panel up-limits-panel" label="Speicher für Uploads" onClose={onClose} icon={<span className="cal-panel-glyph tone-info"><HardDrive size={19} aria-hidden="true" /></span>}
      title="Speicher für Uploads" subtitle="Gilt für den Upload-Bereich der Kunden"
      footer={<>
        <button type="button" className="sheet-action" onClick={onClose} disabled={busy}>Abbrechen</button>
        <span className="pj-spacer" />
        <button type="button" className="sheet-action is-primary" onClick={save} disabled={busy}>{busy ? <MiniLoader size={15} /> : <CircleCheck size={15} aria-hidden="true" />}Speichern</button>
      </>}>
      <div className="up-sum">
        <div><b>{formatBytes(uploads.uploads.reduce((sum, upload) => sum + upload.sizeBytes, 0))}</b><span>belegt, {plural(uploads.uploads.length, "Datei", "Dateien")}</span></div>
        <div><b>{today}</b><span>{today === 1 ? "läuft heute ab" : "laufen heute ab"}</span></div>
        <div><b>{uploads.settings ? limitLabel(uploads.settings.totalLimit) : "–"}</b><span>für alle Kunden zusammen</span></div>
      </div>
      <PanelSection title="Standard je Kunde">
        <span className="um-pick"><span className="up-mark"><HardDrive size={15} aria-hidden="true" /></span><Select variant="bare" showLead={false} label="Standard je Kunde" value={String(defaultLimit)} onChange={(next) => setDefaultLimit(Number(next))} disabled={busy} options={choices} /><ChevronDown size={16} aria-hidden="true" /></span>
        <small className="pj-form-hint up-hint">Gilt für jeden Kunden ohne eigenen Wert. Es zählt nur, was noch auf Übernahme wartet.</small>
      </PanelSection>
      <PanelSection title="Aufbewahrung">
        <div className="up-static"><Lock size={15} aria-hidden="true" />{UPLOAD_KEEP_DAYS} Tage<small>fest</small></div>
        <small className="pj-form-hint up-hint">Danach löscht der Hub, was nicht übernommen ist. Kunden sehen die Restzeit an jeder Datei.</small>
      </PanelSection>
      <PanelSection title="Je Kunde" meta={`${withUploads} von ${list.length} mit Uploads`}>
        <ul className="up-limits" role="list">
          {list.map((customer) => {
            const used = usedBy(customer.id);
            const own = limits[customer.id] ?? null;
            const meter = spaceMeter(used, own ?? defaultLimit);
            return (
              <li key={customer.id} className="up-limit">
                <CustomerSign customer={customer} logo={customer.logo} size="md" />
                <span className="up-limit-main"><strong>{customer.company}</strong><span><span className={`up-mini${meter.tone ? ` is-${meter.tone}` : ""}`} aria-hidden="true"><span style={{ width: `${Math.max(meter.percent, used ? 2 : 0)}%` }} /></span>{used ? `${formatBytes(used)} belegt` : "nichts hochgeladen"}</span></span>
                <span className="um-pick"><span className="up-mark"><HardDrive size={15} aria-hidden="true" /></span><Select variant="bare" showLead={false} label={`Speicher von ${customer.company}`} value={own === null ? "" : String(own)} disabled={busy}
                  onChange={(next) => setLimits((current) => ({ ...current, [customer.id]: next ? Number(next) : null }))}
                  options={[{ value: "", label: `Standard (${limitLabel(defaultLimit)})` }, ...choices]} /><ChevronDown size={16} aria-hidden="true" /></span>
              </li>
            );
          })}
        </ul>
      </PanelSection>
      {error && <p className="form-error" role="alert">{error}</p>}
    </AssetPanel>
  );
}
