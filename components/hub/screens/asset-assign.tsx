"use client";

import { useEffect, useRef, useState } from "react";
import { BellRing, Check, ChevronDown, Folder, FolderInput, Inbox, UserPlus, Users, X } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import type { ActionResult } from "@/lib/hub-files/actions";
import { assignLabel, assignMessage, assignSubtitle, type AssignMode, type AssignSource } from "@/lib/hub-files/assign";
import { fileFormat, formatBytes } from "@/lib/hub-files/catalog";
import type { HubFileCustomer, HubFolder, HubStoredFile } from "@/lib/hub-files/types";
import { useInfo } from "../info-box";
import { Select } from "../select";
import { customerOption } from "../select-options";
import { AssetPanel } from "./asset-panel";
import { FileIcon } from "./files-parts";
import type { AssignInput } from "./files-store";

/** What the panel was opened with: the files, the customer if it is known already, and where the files come from. */
export type AssignRequest = { ids: string[]; target: string | null; source: AssignSource };

/**
 * „Zuordnen“ as a panel next to the files (user 19.11.2026): several files to one customer and into one of its folders.
 * It opens from the selection bar, from a file in the Ablage, and when files are dragged onto a customer in the list
 * (then the customer is set and Enter confirms). Coming from another customer, the files move unless
 * „Auch behalten“ is chosen. The customer sees them at once and gets one notice for all of them.
 */
export function AssignPanel({ request, files, customers, folders, onAssign, onClose, onDone }: {
  request: AssignRequest;
  /** The files of the request that still exist. */
  files: HubStoredFile[];
  /** Customers and freelancers the files can go to. */
  customers: HubFileCustomer[];
  folders: HubFolder[];
  onAssign: (input: AssignInput) => Promise<ActionResult<{ added: number; moved: number }>>;
  onClose: () => void;
  onDone: (message: string, ids: string[], customerId: string) => void;
}) {
  const { source } = request;
  const [target, setTarget] = useState(request.target ?? "");
  const [folderId, setFolderId] = useState("");
  const [mode, setMode] = useState<AssignMode>("move");
  const [left, setLeft] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirm = useRef<HTMLButtonElement>(null);
  const shown = files.filter((file) => !left.includes(file.id));
  const customer = customers.find((item) => item.id === target) ?? null;
  const own = customer ? folders.filter((folder) => folder.customerId === customer.id) : [];
  const fresh = customer ? shown.filter((file) => !file.customers.some((item) => item.id === customer.id)).length : 0;
  const choices = customers.filter((item) => source.kind !== "customer" || item.id !== source.id);
  const info = useInfo("Zuordnen", {
    steps: [
      <><b>Ziehen:</b> angehakte Dateien links auf einen Kunden.</>,
      <><b>Von einem Kunden:</b> verschieben oder dort auch behalten.</>,
      <><b>Der Kunde</b> sieht sie sofort, mit einer Meldung für alle.</>,
    ],
    ask: "Wie ordne ich mehrere Dateien einem Kunden zu?",
  });

  // With the customer known, the panel waits on its main button, so Enter confirms. The panel itself took the focus
  // first (AssetPanel), which runs before this effect.
  useEffect(() => { if (request.target) confirm.current?.focus({ preventScroll: true }); }, [request.target]);

  async function submit() {
    if (!customer || !shown.length) return;
    setBusy(true);
    setError("");
    const ids = shown.map((file) => file.id);
    const from = source.kind === "customer" ? source.id : null;
    const result = await onAssign({ fileIds: ids, customerId: customer.id, folderId: folderId || null, from, move: from !== null && mode === "move" });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    const folder = own.find((item) => item.id === folderId)?.name ?? null;
    onDone(assignMessage({ count: ids.length, added: result.data.added, company: customer.company, folder, source, mode }), ids, customer.id);
  }

  const footer = <>
    <button type="button" className="sheet-action" onClick={onClose} disabled={busy}>Abbrechen</button>
    <button ref={confirm} type="button" className="sheet-action is-primary" onClick={submit} disabled={busy || !customer || !shown.length}>
      {busy ? <MiniLoader size={16} /> : <Check size={15} aria-hidden="true" />}{assignLabel(shown.length, source, mode)}
    </button>
  </>;

  return (
    <AssetPanel label="Zuordnen" icon={<span className="am-tile"><UserPlus size={20} aria-hidden="true" /></span>} title="Zuordnen" subtitle={assignSubtitle(shown.length, source)} actions={info.button} onClose={onClose} closeDisabled={busy} footer={footer}>
      {info.box}
      <div className="am-field">
        <span className="am-label">An</span>
        <span className="am-control am-assign-to">
          <Users size={16} aria-hidden="true" />
          <Select variant="bare" showLead label="An welchen Kunden?" placeholder="Kunde wählen" value={target} disabled={busy}
            onChange={(value) => { setTarget(value); setFolderId(""); }}
            options={choices.map((item) => customerOption(item, item.kind === "freelancer" ? "Freelancer" : "Kunden"))} />
          <ChevronDown size={16} aria-hidden="true" />
        </span>
      </div>

      {customer && (
        <div className="am-field">
          <span className="am-label">Ordner bei {customer.company}</span>
          <span className="am-control">
            <Folder size={16} aria-hidden="true" />
            <Select variant="bare" label={`Ordner bei ${customer.company}`} value={folderId} onChange={setFolderId} disabled={busy}
              options={[{ value: "", label: shown.length > fresh ? "Ohne Ordner (vorhandene bleiben, wo sie sind)" : "Ohne Ordner", lead: <Inbox size={15} aria-hidden="true" /> }, ...own.map((folder) => ({ value: folder.id, label: folder.name, lead: <Folder size={15} aria-hidden="true" /> }))]} />
            <ChevronDown size={16} aria-hidden="true" />
          </span>
        </div>
      )}

      {source.kind === "customer" && (
        <div className="am-field">
          <span className="am-label">Bei {source.company}</span>
          <div className="segmented-control am-assign-mode" role="group" aria-label={`Was bei ${source.company} passiert`}>
            <button type="button" className="segment" aria-pressed={mode === "move"} onClick={() => setMode("move")} disabled={busy}><FolderInput size={14} aria-hidden="true" />Verschieben</button>
            <button type="button" className="segment" aria-pressed={mode === "keep"} onClick={() => setMode("keep")} disabled={busy}><Users size={14} aria-hidden="true" />Auch behalten</button>
          </div>
          <p className="am-help">{mode === "move" ? `${source.company} sieht die Dateien danach nicht mehr. „Sichtbar für“ zieht mit um.` : "Beide Kunden sehen die Dateien."}</p>
        </div>
      )}
      {source.kind === "all" && <p className="am-help">Die Dateien bleiben auch bei ihren bisherigen Kunden.</p>}

      <div className="am-field">
        <span className="am-label">Dateien</span>
        <ul className="am-uploads" aria-label="Diese Dateien">
          {shown.map((file) => (
            <li key={file.id} className="am-upload is-ready">
              <span className="am-file-icon"><FileIcon file={file} size={17} /></span>
              <span className="am-upload-text">
                <strong className="am-assign-title">{file.title}</strong>
                <span className="am-upload-meta"><small>{fileFormat(file.fileName)} · {formatBytes(file.sizeBytes)}{customer && file.customers.some((item) => item.id === customer.id) && <> · <b className="am-assign-there">liegt schon dort</b></>}</small></span>
              </span>
              {shown.length > 1
                ? <button type="button" className="am-icon-btn" onClick={() => setLeft((now) => [...now, file.id])} disabled={busy} aria-label={`${file.title} herausnehmen`} data-tip="Herausnehmen"><X size={15} aria-hidden="true" /></button>
                : <span />}
            </li>
          ))}
        </ul>
      </div>

      {customer && fresh > 0 && <p className="am-note"><BellRing size={16} aria-hidden="true" /><span>{customer.company} sieht {fresh === 1 ? "die Datei" : "die Dateien"} sofort{customer.kind === "freelancer" ? " unter „Meine Dateien“" : ""} und bekommt eine Meldung{fresh > 1 ? " für alle" : ""}.</span></p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </AssetPanel>
  );
}
