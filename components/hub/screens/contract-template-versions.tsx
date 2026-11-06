"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Download, FileSignature, History, RotateCcw, Upload } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { createClient } from "@/lib/supabase/client";
import { HUB_FILES_BUCKET } from "@/lib/hub-files/catalog";
import {
  contractTemplateIds, contractTemplates, DOCX_MIME, knownPlaceholders, placeholderLabel, versionKindLabels,
  type ContractTemplateId, type TemplateCheck, type TemplateVersion,
} from "@/lib/contract-templates/catalog";
import {
  activateTemplateUpload, checkTemplateUpload, discardTemplateUpload, downloadContractTemplate, downloadTemplateVersion, listContractTemplates,
  prepareTemplateUpload, restoreTemplateVersion, type TemplateOverview,
} from "@/lib/contract-templates/actions";
import { useInfo } from "../info-box";
import { Modal } from "../modal";
import { formatStamp, saveDownload, useContractRunner } from "./contract-actions";

const Spinner = () => <MiniLoader size={16} />;
const isStandard = (version: TemplateVersion | undefined) => !version || version.kind === "standard";

/**
 * The overview's templates: each as a blank to print and fill in, as the Word file with its placeholders, with its
 * versions and a way to upload a new one.
 */
export function ContractTemplatesSection({ canManage }: { canManage: boolean }) {
  const [overview, setOverview] = useState<TemplateOverview[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reloads, setReloads] = useState(0);
  const [uploadFor, setUploadFor] = useState<ContractTemplateId | null>(null);
  const [historyFor, setHistoryFor] = useState<ContractTemplateId | null>(null);
  const [notice, setNotice] = useState("");
  const { busy, error, run } = useContractRunner();
  const info = useInfo("Vertragsvorlagen", {
    steps: [
      <><b>Blanko</b> zum Ausdrucken und Ausfüllen.</>,
      <><b>Neue Fassung</b> hochladen, der Hub prüft sie.</>,
      <><b>Ältere Fassungen</b> bleiben und lassen sich wieder nutzen.</>,
    ],
    ask: "Wie funktionieren die Vertragsvorlagen?",
  });

  useEffect(() => {
    if (!canManage) return;
    let active = true;
    listContractTemplates()
      .then((result) => { if (active) { if (result.ok) { setOverview(result.data); setLoadError(""); } else setLoadError(result.error); } })
      .catch(() => { if (active) setLoadError("Die Fassungen der Vorlagen konnten gerade nicht geladen werden."); });
    return () => { active = false; };
  }, [canManage, reloads]);

  const changed = (message: string) => {
    setNotice(message);
    setReloads((count) => count + 1);
  };
  const versionsOf = (id: ContractTemplateId) => overview?.find((item) => item.id === id)?.versions ?? [];
  const activeLine = (id: ContractTemplateId) => {
    if (!canManage) return "";
    if (!overview) return loadError || "Fassungen werden geladen …";
    const active = versionsOf(id)[0];
    return isStandard(active) ? "Aktiv: Standardfassung" : `Aktiv: Fassung vom ${formatStamp(active.createdAt)}`;
  };

  return (
    <section className="cdm-section" aria-labelledby="cdm-templates">
      <h3 id="cdm-templates"><FileSignature size={16} aria-hidden="true" />Vertragsvorlagen{info.button}</h3>
      {info.box}
      {notice && <p className="calendar-notice" role="status"><Check size={18} aria-hidden="true" />{notice}</p>}
      <ul className="cdm-rows contract-templates">
        {contractTemplateIds.map((id) => (
          <li key={id}>
            <span className="contract-template-name">
              <strong>{contractTemplates[id].name}</strong>
              <small>{contractTemplates[id].description}</small>
              {canManage && <small className="contract-template-active">{activeLine(id)}</small>}
            </span>
            <span className="contract-template-actions">
              <button type="button" className="sheet-action" disabled={!canManage || busy !== null} onClick={() => run(`${id}-blank`, () => downloadContractTemplate(id, "blank"), saveDownload)} title="Mit Linien zum Ausfüllen von Hand">
                {busy === `${id}-blank` ? <Spinner /> : <Download size={14} aria-hidden="true" />}Blanko
              </button>
              <button type="button" className="sheet-action" disabled={!canManage || busy !== null} onClick={() => run(`${id}-placeholders`, () => downloadContractTemplate(id, "placeholders"), saveDownload)} title="Die aktive Word-Vorlage mit Platzhaltern wie {{kunde_firma}}, zum Bearbeiten in Word">
                {busy === `${id}-placeholders` ? <Spinner /> : <Download size={14} aria-hidden="true" />}Vorlage
              </button>
              <button type="button" className="sheet-action" disabled={!canManage || busy !== null || !overview} onClick={() => { setNotice(""); setUploadFor(id); }}>
                <Upload size={14} aria-hidden="true" />Neue Fassung
              </button>
              <button type="button" className="sheet-action" disabled={!canManage || busy !== null || !overview} onClick={() => { setNotice(""); setHistoryFor(id); }} title="Alle Fassungen dieser Vorlage">
                <History size={14} aria-hidden="true" />Fassungen{versionsOf(id).length > 0 && <span className="contract-count">{versionsOf(id).length}</span>}
              </button>
            </span>
          </li>
        ))}
      </ul>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="cdm-empty">{canManage ? "Einen Vertrag für einen Kunden erstellst du bei ihm im Reiter „Vertrag“. Er nutzt immer die aktive Fassung." : "Vorlagen gibt es nur mit echtem Admin-Login."}</p>
      {uploadFor && <TemplateUploadDialog templateId={uploadFor} onClose={() => setUploadFor(null)} onActivated={changed} />}
      {historyFor && <TemplateVersionsDialog templateId={historyFor} versions={versionsOf(historyFor)} onClose={() => setHistoryFor(null)} onChanged={(message) => { setHistoryFor(null); changed(message); }} />}
    </section>
  );
}

/** What the check of an uploaded file found: ready, or what stands in the way. */
function TemplateCheckReport({ check }: { check: TemplateCheck }) {
  const list = (keys: readonly string[]) => keys.map((key) => `{{${key}}}`).join(", ");
  return (
    <div className={`contract-check ${check.ok ? "is-ok" : "is-bad"}`} role="status">
      <strong>{check.ok ? `Passt: ${check.keys.length} Platzhalter erkannt.` : "So kann die Fassung noch nicht aktiv werden:"}</strong>
      {!check.keys.length && <p>In der Datei steht kein einziger Platzhalter. Ist das die richtige Datei?</p>}
      {check.unknown.length > 0 && <p>Unbekannte Platzhalter: {list(check.unknown)}. Bitte die Schreibweise prüfen; alle bekannten stehen unten.</p>}
      {check.broken.length > 0 && <p>Unvollständige Platzhalter in: „{check.broken.join("“, „")}“.</p>}
      {check.missing.length > 0 && <p className="contract-check-warn">Nicht mehr im Text: {check.missing.map(placeholderLabel).join(", ")}. Der Generator fragt diese Felder weiter ab, sie stehen dann aber nicht im Vertrag.</p>}
    </div>
  );
}

/** Upload a new version: the file goes to a staging folder, the hub checks it, the admin takes it over. */
function TemplateUploadDialog({ templateId, onClose, onActivated }: { templateId: ContractTemplateId; onClose: () => void; onActivated: (message: string) => void }) {
  const template = contractTemplates[templateId];
  const [staged, setStaged] = useState<string | null>(null);
  const [check, setCheck] = useState<TemplateCheck | null>(null);
  const activated = useRef(false);
  const { busy, error, run } = useContractRunner();
  const info = useInfo("Prüfung vor dem Übernehmen", {
    steps: [
      <><b>Nur .docx</b> bis 10 MB, ohne Makros.</>,
      <><b>Unbekannte Platzhalter</b> blockieren das Übernehmen.</>,
      <><b>Aktiv</b> erst mit „Als aktive Fassung übernehmen“.</>,
    ],
    ask: "Was prüft der Hub bei einer neuen Fassung einer Vertragsvorlage?",
  });

  // An upload that was replaced by another one, or not taken over when the window closes, is dropped.
  useEffect(() => () => {
    if (staged && !activated.current) void discardTemplateUpload(staged);
  }, [staged]);

  function pick(file: File | undefined) {
    if (!file) return;
    setCheck(null);
    run("check", async () => {
      if (!/\.docx$/i.test(file.name)) return { ok: false as const, error: "Bitte die Vorlage als Word-Datei (.docx) hochladen." };
      const prepared = await prepareTemplateUpload(templateId, file.name, file.size);
      if (!prepared.ok) return prepared;
      const sent = await createClient().storage.from(HUB_FILES_BUCKET).uploadToSignedUrl(prepared.data.path, prepared.data.token, file, { contentType: DOCX_MIME });
      if (sent.error) return { ok: false as const, error: "Die Datei konnte nicht hochgeladen werden." };
      setStaged(prepared.data.path);
      return checkTemplateUpload(templateId, prepared.data.path);
    }, setCheck);
  }

  function activate() {
    if (!staged) return;
    run("activate", () => activateTemplateUpload(templateId, staged), () => {
      activated.current = true;
      onActivated(`Die neue Fassung von „${template.name}“ ist aktiv. Neue Verträge nutzen ab jetzt diesen Text.`);
      onClose();
    });
  }

  return (
    <Modal title={`Neue Fassung: ${template.name}`} onClose={onClose} className="users-modal contract-modal" actions={info.button}>
      <div className="cdm-dialog">
        {info.box}
        <ol className="contract-steps">
          <li>Im Überblick unter „Vorlage“ die aktive Word-Datei mit Platzhaltern herunterladen.</li>
          <li>In Word ändern. Platzhalter wie {"{{kunde_firma}}"} genau so stehen lassen oder aus der Liste unten neu einfügen.</li>
          <li>Hier hochladen. Der Hub prüft die Platzhalter, bevor die Fassung aktiv wird; ältere Fassungen bleiben erhalten.</li>
        </ol>
        <label className="upload-field">
          <span>Word-Datei (.docx)</span>
          <input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => pick(event.target.files?.[0])} disabled={busy !== null} />
        </label>
        {busy === "check" && <p className="field-hint contract-busy"><Spinner />Wird hochgeladen und geprüft …</p>}
        {check && <TemplateCheckReport check={check} />}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="button" className="sheet-button sheet-button-primary" disabled={!check?.ok || busy !== null} onClick={activate}>
          {busy === "activate" ? <Spinner /> : <Check size={18} aria-hidden="true" />}Als aktive Fassung übernehmen
        </button>
        <details className="contract-placeholders">
          <summary>Platzhalter dieser Vorlage</summary>
          <dl>
            {knownPlaceholders(template).map((key) => (
              <div key={key}><dt><code>{`{{${key}}}`}</code></dt><dd>{placeholderLabel(key)}</dd></div>
            ))}
          </dl>
        </details>
      </div>
    </Modal>
  );
}

/** Every version of a template, newest (active) first: download one, or use an older one or the standard again. */
function TemplateVersionsDialog({ templateId, versions, onClose, onChanged }: { templateId: ContractTemplateId; versions: TemplateVersion[]; onClose: () => void; onChanged: (message: string) => void }) {
  const template = contractTemplates[templateId];
  const { busy, error, run } = useContractRunner();
  const standardActive = isStandard(versions[0]);
  const info = useInfo("Fassungen", {
    steps: [
      <><b>Die oberste</b> ist aktiv; neue Verträge nutzen sie.</>,
      <><b>Wieder verwenden</b> legt eine Kopie oben drauf.</>,
      <><b>Nichts wird gelöscht,</b> erstellte Verträge bleiben gleich.</>,
    ],
    ask: "Wie funktionieren die Fassungen einer Vertragsvorlage?",
  });
  return (
    <Modal title={`Fassungen: ${template.name}`} onClose={onClose} className="users-modal contract-modal" actions={info.button}>
      <div className="cdm-dialog">
        {info.box}
        <p className="field-hint">Die oberste Fassung ist aktiv. Gelöscht wird nichts: „Wieder verwenden“ legt eine ältere Fassung als neue oben drauf.</p>
        <ul className="cdm-rows contract-versions">
          {!versions.length && (
            <li><span className="contract-template-name"><strong>Standardfassung</strong><small>Mit dem Hub ausgeliefert, noch keine eigene Fassung hochgeladen.</small></span><span className="chat-pill tone-ok">aktiv</span></li>
          )}
          {versions.map((version, index) => (
            <li key={version.name}>
              <span className="contract-template-name"><strong>{formatStamp(version.createdAt)}</strong><small>{versionKindLabels[version.kind]}</small></span>
              <span className="contract-template-actions">
                {index === 0 && <span className="chat-pill tone-ok">aktiv</span>}
                <button type="button" className="sheet-action" disabled={busy !== null} onClick={() => run(`get-${version.name}`, () => downloadTemplateVersion(templateId, version.name), saveDownload)}>
                  {busy === `get-${version.name}` ? <Spinner /> : <Download size={14} aria-hidden="true" />}Herunterladen
                </button>
                {index > 0 && (
                  <button type="button" className="sheet-action" disabled={busy !== null} onClick={() => run(`use-${version.name}`, () => restoreTemplateVersion(templateId, version.name), () => onChanged(`Die Fassung vom ${formatStamp(version.createdAt)} ist wieder aktiv.`))}>
                    {busy === `use-${version.name}` ? <Spinner /> : <RotateCcw size={14} aria-hidden="true" />}Wieder verwenden
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {error && <p className="form-error" role="alert">{error}</p>}
        {!standardActive && (
          <button type="button" className="sheet-button" disabled={busy !== null} onClick={() => run("standard", () => restoreTemplateVersion(templateId, "standard"), () => onChanged(`Für „${template.name}“ gilt wieder die Standardfassung.`))}>
            {busy === "standard" ? <Spinner /> : <RotateCcw size={18} aria-hidden="true" />}Standardfassung wieder verwenden
          </button>
        )}
      </div>
    </Modal>
  );
}
