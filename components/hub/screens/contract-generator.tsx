"use client";

import { useEffect, useId, useState } from "react";
import { Download, FilePlus2, FileSignature, FolderInput } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { createClient } from "@/lib/supabase/client";
import { checkUpload, HUB_FILES_BUCKET } from "@/lib/hub-files/catalog";
import { prepareUpload } from "@/lib/hub-files/actions";
import { OPERATOR } from "@/lib/legal-details";
import {
  computedValues, contractFields, contractGroupLabels, contractTemplateIds, contractTemplates, contractValues, DOCX_MIME, formatMoney, initialInput,
  parseMoney, parsePercent, suggestedTemplate, type ContractCustomerData, type ContractFieldGroup, type ContractTemplateId,
} from "@/lib/contract-templates/catalog";
import { createContractDocument, downloadContractTemplate, fileContract, loadContractCustomer, type ContractActionResult, type ContractDownload } from "@/lib/contract-templates/actions";
import type { ContractCustomer } from "@/lib/hub-contracts/types";
import { Switch } from "../controls";
import { Modal } from "../modal";

const operator = { street: OPERATOR.street, city: OPERATOR.city, partners: OPERATOR.partners };
const groupOrder: ContractFieldGroup[] = ["customer", "terms", "provider", "signature"];
const Spinner = () => <MiniLoader size={16} />;

/** Hands a generated file to the browser's download. */
function saveDownload({ fileName, base64 }: ContractDownload) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: DOCX_MIME }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function sha256Hex(file: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Runs one action at a time and keeps its message. */
function useRunner() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function run<T>(key: string, action: () => Promise<ContractActionResult<T>>, onDone: (data: T) => void, onFields?: (errors: Record<string, string>) => void) {
    setBusy(key);
    setError("");
    try {
      const result = await action();
      if (result.ok) onDone(result.data);
      else {
        setError(result.error);
        if (result.fieldErrors) onFields?.(result.fieldErrors);
      }
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : "Das hat gerade nicht geklappt. Bitte versuche es erneut.");
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, setError, run };
}

/** „Jahrespreis 324,00 € netto (12 × 30,00 € = 360,00 € abzüglich 10 % = 36,00 €)“ and the minute steps, as the contract will say. */
function termsSummary(input: Record<string, string>) {
  const cents = parseMoney(input.preis_monat ?? "");
  const percent = parsePercent(input.rabatt_prozent ?? "");
  const minutes = /^\d{1,4}$/.test((input.minuten_monat ?? "").trim()) ? Number(input.minuten_monat) : null;
  const computed = computedValues(cents, minutes && minutes > 0 ? minutes : null, percent);
  const parts: string[] = [];
  if (cents !== null && percent !== null) parts.push(`Jahrespreis ${computed.preis_jahr} € netto (12 × ${formatMoney(cents)} € = ${computed.preis_jahr_regulaer} € abzüglich ${input.rabatt_prozent.trim()} % = ${computed.rabatt_betrag} €)`);
  if (minutes && input.preis_zusatzblock !== undefined) parts.push(`bis ${minutes} Minuten inklusive, bis ${computed.minuten_stufe_1} ein Zusatzblock, bis ${computed.minuten_stufe_2} zwei`);
  return parts.join(" · ");
}

/**
 * „Vertrag erstellen“ for one customer: choose the template, check the prefilled fields, then download the Word file or
 * file the contract at the customer (the generated Word file or a finished PDF).
 */
export function ContractGenerator({ customer, canManage, today, onClose, onFiled }: {
  customer: ContractCustomer;
  canManage: boolean;
  today: string;
  onClose: () => void;
  onFiled: (message: string) => void;
}) {
  const [templateId, setTemplateId] = useState<ContractTemplateId>(() => suggestedTemplate(customer.packages.map((item) => item.packageId)));
  const [master, setMaster] = useState<ContractCustomerData | null>(null);
  const [loadError, setLoadError] = useState("");
  /** What the admin typed; everything else follows the customer master and the template's starting values. */
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [source, setSource] = useState<"generated" | "upload">("generated");
  const [upload, setUpload] = useState<File | null>(null);
  const [notify, setNotify] = useState(true);
  const { busy, error, setError, run } = useRunner();
  const formId = useId();
  const template = contractTemplates[templateId];
  const suggested = suggestedTemplate(customer.packages.map((item) => item.packageId));

  // The customer master (address, website) comes from the server; without a real admin login there is none.
  useEffect(() => {
    if (!canManage) return;
    let active = true;
    loadContractCustomer(customer.id)
      .then((result) => { if (active) { if (result.ok) setMaster(result.data); else setLoadError(result.error); } })
      .catch(() => { if (active) setLoadError("Die Kundendaten konnten nicht geladen werden."); });
    return () => { active = false; };
  }, [canManage, customer.id]);

  const start = initialInput(template, master ?? { company: customer.company, street: "", postalCode: "", city: "", website: "" }, today, operator);
  const input = Object.fromEntries(template.fields.map((key) => [key, edits[key] ?? start[key] ?? ""]));
  const set = (key: string) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setEdits((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };
  const masterNote = !canManage ? "Ohne echten Admin-Login sind die Kundendaten hier nicht geladen." : loadError;
  const missingMaster = master && (!master.street || !master.postalCode || !master.city || (template.fields.includes("kunde_domain") && !master.website));
  const summary = termsSummary(input);
  const disabled = !canManage || busy !== null;

  /** The same check the server makes, before the round trip: marks every field that is missing or unreadable. */
  function checked() {
    const result = contractValues(template, input, operator);
    setFieldErrors(result.ok ? {} : result.errors);
    if (!result.ok) setError("Bitte die markierten Felder prüfen.");
    return result.ok;
  }

  function download(event: React.FormEvent) {
    event.preventDefault();
    if (!checked()) return;
    run("download", () => createContractDocument(templateId, input), saveDownload, setFieldErrors);
  }

  function file() {
    const done = (data: { title: string }) => {
      onFiled(`„${data.title}“ liegt jetzt bei ${customer.company} im Ordner „Verträge“.${notify ? " Der Kunde wird benachrichtigt." : ""}`);
      onClose();
    };
    if (source === "generated") {
      if (!checked()) return;
      run("file", () => fileContract({ customerId: customer.id, templateId, notify, source: "generated", input }), done, setFieldErrors);
      return;
    }
    run("file", async (): Promise<ContractActionResult<{ fileId: string; title: string }>> => {
      if (!upload) return { ok: false, error: "Bitte zuerst die fertige Datei wählen." };
      const check = checkUpload(upload.name, upload.size);
      if (!check.ok) return check;
      const sha256 = await sha256Hex(upload);
      const prepared = await prepareUpload(upload.name, upload.size);
      if (!prepared.ok) return prepared;
      const sent = await createClient().storage.from(HUB_FILES_BUCKET).uploadToSignedUrl(prepared.data.path, prepared.data.token, upload, { contentType: upload.type || "application/octet-stream" });
      if (sent.error) return { ok: false, error: "Die Datei konnte nicht hochgeladen werden." };
      return fileContract({ customerId: customer.id, templateId, notify, source: "upload", path: prepared.data.path, fileName: upload.name, mimeType: upload.type, sha256 });
    }, done);
  }

  return (
    <Modal title="Vertrag erstellen" onClose={onClose} className="users-modal contract-modal">
      <form className="cdm-dialog contract-form" onSubmit={download} noValidate>
        <p className="field-hint">{customer.company} · {customer.customerNumber}</p>

        <fieldset className="cdm-group" disabled={busy !== null}>
          <legend>Vorlage</legend>
          {contractTemplateIds.map((id) => (
            <label key={id} className="cdm-option">
              <input type="radio" name={`${formId}-template`} checked={templateId === id} onChange={() => setTemplateId(id)} />
              <span>
                <strong>{contractTemplates[id].name}{id === suggested && <span className="chat-pill tone-info contract-pill">passt zu den Paketen</span>}</strong>
                <small>{contractTemplates[id].description}</small>
              </span>
            </label>
          ))}
        </fieldset>

        {groupOrder.map((group) => {
          const keys = template.fields.filter((key) => contractFields[key].group === group);
          if (!keys.length) return null;
          return (
            <fieldset key={group} className="contract-fields" disabled={busy !== null}>
              <legend>{contractGroupLabels[group]}</legend>
              {group === "customer" && <p className="field-hint">{missingMaster ? "Im Kundenstamm fehlen Angaben. Trag sie hier für diesen Vertrag ein und dauerhaft im User Management." : masterNote || "Aus dem Kundenstamm. Änderungen hier gelten nur für diesen Vertrag."}</p>}
              <div className="upload-fields">
                {keys.map((key) => {
                  const field = contractFields[key];
                  const errorId = `${formId}-${key}-error`;
                  const wide = field.kind === "text" && (key === "kunde_firma" || key === "dienstleister_name" || key === "hoster");
                  return (
                    <label key={key} className={`upload-field${wide ? " upload-field-wide" : ""}`}>
                      <span>{field.label}{field.required ? "" : " (optional)"}</span>
                      <input
                        type={field.kind === "date" ? "date" : "text"}
                        inputMode={field.kind === "money" || field.kind === "percent" ? "decimal" : field.kind === "minutes" ? "numeric" : undefined}
                        value={input[key] ?? ""}
                        onChange={set(key)}
                        list={field.options === "partners" ? `${formId}-partners` : undefined}
                        aria-invalid={fieldErrors[key] ? true : undefined}
                        aria-describedby={fieldErrors[key] ? errorId : undefined}
                        maxLength={200}
                      />
                      {fieldErrors[key] ? <small id={errorId} className="contract-field-error">{fieldErrors[key]}</small> : field.hint && <small className="field-hint">{field.hint}</small>}
                    </label>
                  );
                })}
              </div>
              {group === "terms" && summary && <p className="field-hint contract-summary">{summary}</p>}
              {group === "signature" && <p className="field-hint">Leere Felder werden im Vertrag zu Linien zum Ausfüllen von Hand.</p>}
            </fieldset>
          );
        })}
        <datalist id={`${formId}-partners`}>{OPERATOR.partners.map((name) => <option key={name} value={name} />)}</datalist>

        {error && <p className="form-error" role="alert">{error}</p>}
        {!canManage && <p className="field-hint">Erstellen und Ablegen gehen nur mit echtem Admin-Login.</p>}
        <button type="submit" className="sheet-button sheet-button-primary" disabled={disabled}>{busy === "download" ? <Spinner /> : <Download size={18} aria-hidden="true" />}Word-Datei herunterladen</button>

        <fieldset className="cdm-group contract-file-box" disabled={disabled}>
          <legend>Beim Kunden ablegen</legend>
          <label className="cdm-option">
            <input type="radio" name={`${formId}-source`} checked={source === "generated"} onChange={() => setSource("generated")} />
            <span><strong>Diesen Vertrag als Word-Datei</strong><small>So, wie er oben ausgefüllt ist.</small></span>
          </label>
          <label className="cdm-option">
            <input type="radio" name={`${formId}-source`} checked={source === "upload"} onChange={() => setSource("upload")} />
            <span><strong>Fertige Datei hochladen</strong><small>Die PDF aus Word oder die unterschriebene Fassung.</small></span>
          </label>
          {source === "upload" && (
            <label className="upload-field contract-upload">
              <span>PDF oder Word-Datei</span>
              <input type="file" accept=".pdf,.docx,application/pdf" onChange={(event) => setUpload(event.target.files?.[0] ?? null)} />
            </label>
          )}
          <div className="cdm-switch-row">
            <Switch id={`${formId}-notify`} checked={notify} onChange={setNotify} label="Kunden benachrichtigen" />
            <label htmlFor={`${formId}-notify`}>Kunden benachrichtigen</label>
          </div>
          <p className="field-hint">Der Vertrag landet im Asset Management im Ordner „Verträge“ des Kunden, Kategorie Vertrag. Der Kunde sieht ihn unter Dateien und unter Vertrag & Domain, seine Freelancer nicht.</p>
          <button type="button" className="sheet-button" onClick={file} disabled={disabled || (source === "upload" && !upload)}>{busy === "file" ? <Spinner /> : <FolderInput size={18} aria-hidden="true" />}Beim Kunden ablegen</button>
        </fieldset>
      </form>
    </Modal>
  );
}

/** The button in the customer's tab „Vertrag“. */
export function ContractGeneratorButton({ onOpen }: { onOpen: () => void }) {
  return <button type="button" className="sheet-action is-primary" onClick={onOpen}><FilePlus2 size={15} aria-hidden="true" />Vertrag erstellen</button>;
}

/** The overview's list of templates: each as a blank to print and fill in, or as the Word file with its placeholders. */
export function ContractTemplatesSection({ canManage }: { canManage: boolean }) {
  const { busy, error, run } = useRunner();
  return (
    <section className="cdm-section" aria-labelledby="cdm-templates">
      <h3 id="cdm-templates"><FileSignature size={16} aria-hidden="true" />Vertragsvorlagen</h3>
      <ul className="cdm-rows contract-templates">
        {contractTemplateIds.map((id) => (
          <li key={id}>
            <span className="contract-template-name"><strong>{contractTemplates[id].name}</strong><small>{contractTemplates[id].description}</small></span>
            <span className="contract-template-actions">
              <button type="button" className="sheet-action" disabled={!canManage || busy !== null} onClick={() => run(`${id}-blank`, () => downloadContractTemplate(id, "blank"), saveDownload)} title="Mit Linien zum Ausfüllen von Hand">
                {busy === `${id}-blank` ? <Spinner /> : <Download size={14} aria-hidden="true" />}Blanko
              </button>
              <button type="button" className="sheet-action" disabled={!canManage || busy !== null} onClick={() => run(`${id}-placeholders`, () => downloadContractTemplate(id, "placeholders"), saveDownload)} title="Die Word-Vorlage mit Platzhaltern wie {{kunde_firma}}">
                {busy === `${id}-placeholders` ? <Spinner /> : <Download size={14} aria-hidden="true" />}Vorlage
              </button>
            </span>
          </li>
        ))}
      </ul>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="cdm-empty">{canManage ? "Einen Vertrag für einen Kunden erstellst du bei ihm im Reiter „Vertrag“." : "Herunterladen geht nur mit echtem Admin-Login."}</p>
    </section>
  );
}
