"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Check, FileSpreadsheet, RotateCcw, Upload } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { importCustomers, type CustomerImportResult } from "@/lib/hub-users/actions";
import { normalizeCompany, readCustomer, serviceCustomerRefusal } from "@/lib/hub-users/rules";
import type { ManagedCustomer } from "@/lib/hub-users/types";
import {
  decodeImportFile, dropInvalidValues, effectiveStatus, fieldLabels, guessMapping, IMPORT_BATCH, importFields, isPreselected, isSelectable, mappingProblem,
  MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, parseCsv, planImport, readRows, type ColumnMapping, type ImportDraft, type ImportField, type PlannedRow,
} from "@/lib/hub-customer-import/rules";
import { useInfo } from "../info-box";
import { Modal } from "../modal";

type Loaded = { name: string; table: string[][] };
type Show = "all" | "chosen" | "hints";
type Progress = { done: number; total: number; results: CustomerImportResult[]; error: string };

/** The hub's own check of a draft, as „Kunde anlegen“ runs it: the form's rules and Service's number format. */
function checkDraft(draft: ImportDraft) {
  const result = readCustomer(draft);
  return result.ok ? serviceCustomerRefusal(result.value) : result.error;
}

/**
 * The preview of a file with these columns. Numbers for rows without one come from a small seeded generator, so
 * changing a column does not hand out new numbers each time.
 */
function planFor(table: string[][], mapping: ColumnMapping, existing: ManagedCustomer[], seed: number) {
  if (mappingProblem(mapping)) return [];
  let state = seed;
  const random = () => { state = (state * 16807) % 2147483647; return (state - 1) / 2147483646; };
  const rows = readRows(table, mapping, normalizeCompany).map((row) => dropInvalidValues(row, checkDraft));
  return planImport(rows, existing, normalizeCompany, random);
}

const statusText = (row: PlannedRow) => {
  if (row.status === "error") return row.problem ?? "Fehler";
  if (row.status === "skip") return `Übersprungen: ${row.skip}`;
  if (row.status === "same") return "Schon aktuell";
  if (row.status === "update") return row.fills.length ? `Ergänzen: ${row.fills.map((field) => fieldLabels[field]).join(", ")}` : "Nur neue Kundennummer";
  return "Neu anlegen";
};

/**
 * „Kunden importieren“: the contact export of the accounting (Sevdesk) as CSV, its columns, a preview of every row
 * and then the import in batches. Nothing is written before „… übernehmen“; every customer goes the way of
 * „Kunde anlegen“, matches only get their empty fields filled.
 */
export function CustomerImportDialog({ customers, onClose, onNotice }: { customers: ManagedCustomer[]; onClose: () => void; onNotice: (message: string) => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [show, setShow] = useState<Show>("all");
  const [fileError, setFileError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const info = useInfo("Import aus Sevdesk", {
    steps: [
      <><b>Kontakte als CSV</b> aus Sevdesk exportieren und hier wählen.</>,
      <><b>Vorschau prüfen:</b> erst „übernehmen“ speichert etwas.</>,
      <><b>Bestehende Kunden</b> bekommen nur leere Felder ergänzt.</>,
    ],
    ask: "Wie übernehme ich Kunden aus Sevdesk?",
  });

  const existing = useMemo(() => customers.filter((customer) => customer.kind === "customer"), [customers]);
  const [seed, setSeed] = useState(1);
  const plan = useMemo(() => (loaded && mapping ? planFor(loaded.table, mapping, existing, seed) : []), [loaded, mapping, existing, seed]);

  const running = progress !== null && progress.done < progress.total && !progress.error;
  const finished = progress !== null && !running;
  const selected = plan.filter((row) => chosen.has(row.line) && isSelectable(row));
  const counts = {
    new: plan.filter((row) => row.status === "new").length,
    update: plan.filter((row) => row.status === "update").length,
    same: plan.filter((row) => row.status === "same").length,
    skip: plan.filter((row) => row.status === "skip").length,
    error: plan.filter((row) => row.status === "error").length,
  };
  const shown = plan.filter((row) => show === "all" || (show === "chosen" ? chosen.has(row.line) : row.status === "skip" || row.status === "error" || row.notes.length > 0));

  async function read(file: File | undefined) {
    setFileError("");
    if (!file) return;
    if (/\.(xlsx?|numbers|ods)$/i.test(file.name)) { setFileError("Das ist eine Tabelle, keine CSV-Datei. Exportiere die Kontakte in Sevdesk bitte als CSV."); return; }
    if (file.size > MAX_IMPORT_BYTES) { setFileError(`Die Datei ist größer als ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`); return; }
    const table = parseCsv(decodeImportFile(new Uint8Array(await file.arrayBuffer())));
    if (table.length < 2) { setFileError("In der Datei stehen keine Zeilen unter der Kopfzeile."); return; }
    const guessed = guessMapping(table[0]);
    const nextSeed = 1 + Math.floor(Math.random() * 2147483645);
    setSeed(nextSeed);
    setLoaded({ name: file.name, table });
    setMapping(guessed);
    setChosen(new Set(planFor(table, guessed, existing, nextSeed).filter(isPreselected).map((row) => row.line)));
    setShow("all");
  }

  /** Another column for a field; the ticks follow the new reading (new and update rows ticked, the rest not). */
  function remap(field: ImportField, column: number | null) {
    if (!mapping || !loaded) return;
    const next = { ...mapping, [field]: column };
    setMapping(next);
    setChosen(new Set(planFor(loaded.table, next, existing, seed).filter(isPreselected).map((row) => row.line)));
  }

  function toggle(line: number) {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(line)) next.delete(line); else next.add(line);
      return next;
    });
  }

  async function run() {
    const queue = selected.filter((row) => effectiveStatus(row) !== "same");
    if (!queue.length) return;
    let state: Progress = { done: 0, total: queue.length, results: [], error: "" };
    setProgress(state);
    for (let start = 0; start < queue.length; start += IMPORT_BATCH) {
      const batch = queue.slice(start, start + IMPORT_BATCH).map((row) => ({
        line: row.line,
        customerId: row.customerId,
        renumber: row.renumber,
        customer: { ...row.draft, customerNumber: row.customerId && !row.renumber ? row.existingNumber ?? row.draft.customerNumber : row.draft.customerNumber },
      }));
      try {
        const result = await importCustomers({ rows: batch });
        if (!result.ok) { state = { ...state, error: result.error }; setProgress(state); return; }
        state = { ...state, done: state.done + batch.length, results: [...state.results, ...result.data] };
        setProgress(state);
      } catch {
        state = { ...state, error: "Die Verbindung ist abgebrochen. Was bis hierhin übernommen ist, bleibt; lade die Datei erneut, dann erkennt der Hub diese Kunden." };
        setProgress(state);
        return;
      }
    }
  }

  function close() {
    if (running) return;
    if (progress) {
      const created = progress.results.filter((result) => result.outcome === "created").length;
      const updated = progress.results.filter((result) => result.outcome === "updated").length;
      if (created || updated) onNotice(`Import: ${created === 1 ? "1 Kunde" : `${created} Kunden`} angelegt, ${updated} ergänzt.`);
    }
    onClose();
  }

  const headers = loaded?.table[0] ?? [];
  const problem = mapping ? mappingProblem(mapping) : null;
  const found = mapping ? importFields.filter((field) => mapping[field.id] !== null).length : 0;
  const toImport = selected.filter((row) => effectiveStatus(row) !== "same").length;

  return (
    <Modal title="Kunden importieren" onClose={close} className="users-modal import-modal" actions={info.button}>
      {info.box}

      {finished && progress ? (
        <ImportResult progress={progress} onDone={close} />
      ) : !loaded ? (
        <>
          <p className="field-hint">Exportiere in Sevdesk deine Kontakte als CSV-Datei und wähle sie hier aus. Der Hub zeigt dir zuerst eine Vorschau; gespeichert wird erst, wenn du sie bestätigst.</p>
          <label className={`am-zone import-zone${dragging ? " is-dragging" : ""}`}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); void read(event.dataTransfer.files[0]); }}>
            <Upload size={26} aria-hidden="true" />
            <span><strong>CSV-Datei hierher ziehen</strong><small>oder auswählen · bis {MAX_IMPORT_BYTES / 1024 / 1024} MB und {MAX_IMPORT_ROWS} Zeilen</small></span>
            <input type="file" accept=".csv,text/csv" className="visually-hidden" onChange={(event) => { void read(event.target.files?.[0]); event.target.value = ""; }} />
          </label>
          {fileError && <p className="form-error" role="alert">{fileError}</p>}
        </>
      ) : (
        <div className="import-preview">
          <div className="import-file">
            <FileSpreadsheet size={18} aria-hidden="true" />
            <span><strong>{loaded.name}</strong><small>{loaded.table.length - 1} Zeilen · {found} von {importFields.length} Spalten erkannt</small></span>
            <button type="button" className="sheet-action" onClick={() => { setLoaded(null); setMapping(null); setProgress(null); }} disabled={running}><RotateCcw size={15} aria-hidden="true" />Andere Datei</button>
          </div>

          <details className="import-columns" open={Boolean(problem)}>
            <summary>Spalten zuordnen</summary>
            <div className="import-column-grid">
              {importFields.map((field) => (
                <label key={field.id} className="upload-field">
                  <span>{field.label}</span>
                  <select value={mapping?.[field.id] ?? ""} onChange={(event) => remap(field.id, event.target.value === "" ? null : Number(event.target.value))} disabled={running}>
                    <option value="">– nicht übernehmen –</option>
                    {headers.map((header, column) => <option key={column} value={column}>{header || `Spalte ${column + 1}`}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <p className="field-hint">USt-ID, Steuernummer, Bankdaten und Notizen übernimmt der Hub bewusst nicht. Ansprechpartner einer Firma werden kein eigener Kunde; ihre Angaben füllen nur Lücken der Firma.</p>
          </details>

          {problem ? <p className="form-error" role="alert">{problem}</p> : (
            <>
              <div className="import-summary" role="status">
                <span className="import-count is-new">{counts.new} neu</span>
                <span className="import-count is-update">{counts.update} ergänzen</span>
                {counts.same > 0 && <span className="import-count">{counts.same} schon aktuell</span>}
                {counts.skip > 0 && <span className="import-count is-skip">{counts.skip} übersprungen</span>}
                {counts.error > 0 && <span className="import-count is-error">{counts.error} mit Fehler</span>}
                <label className="import-show">
                  <span className="visually-hidden">Zeilen zeigen</span>
                  <select value={show} onChange={(event) => setShow(event.target.value as Show)}>
                    <option value="all">Alle Zeilen</option>
                    <option value="chosen">Nur angehakte</option>
                    <option value="hints">Nur mit Hinweis</option>
                  </select>
                </label>
              </div>

              <div className="import-table-wrap">
                <table className="data-table import-table">
                  <caption className="visually-hidden">Vorschau des Imports: Zeile, Unternehmen, Kundennummer, Ort und was passiert</caption>
                  <thead>
                    <tr>
                      <th scope="col"><span className="visually-hidden">Übernehmen</span></th>
                      <th scope="col">Zeile</th>
                      <th scope="col">Unternehmen</th>
                      <th scope="col">Kunden-Nr.</th>
                      <th scope="col">Ort</th>
                      <th scope="col">Was passiert</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((row) => (
                      <tr key={row.line} className={`data-row${chosen.has(row.line) && isSelectable(row) ? "" : " is-muted"}`}>
                        <td className="cell-check">
                          <input type="checkbox" checked={chosen.has(row.line) && isSelectable(row)} disabled={!isSelectable(row) || running} onChange={() => toggle(row.line)} aria-label={`${row.draft.company || `Zeile ${row.line}`} übernehmen`} />
                        </td>
                        <td className="numeric import-line"><span className="visually-hidden">Zeile </span>{row.line}</td>
                        <td className="import-company">
                          <strong>{row.draft.company || "–"}</strong>
                          {row.existingCompany && <small>im Hub: {row.existingCompany}</small>}
                          {row.notes.length > 0 && <small className="import-note">{row.notes.join(" · ")}</small>}
                        </td>
                        <td className="numeric import-number">
                          {row.customerId && row.renumber ? <>{row.existingNumber}<ArrowRight size={12} aria-label="wird zu" />{row.draft.customerNumber}</> : row.customerId ? row.existingNumber : row.draft.customerNumber || "–"}
                        </td>
                        <td className="import-city">{[row.draft.postalCode, row.draft.city].filter(Boolean).join(" ") || "–"}</td>
                        <td className="import-what"><span className={`import-status is-${row.status}`}>{statusText(row)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!shown.length && <p className="field-hint import-empty">Keine Zeile für diese Auswahl.</p>}
              </div>

              <p className="field-hint">Neue Kunden entstehen in Hub und Serviceplattform, ohne Login, ohne Mail und ohne Paket. Danach lassen sie sich bearbeiten, aber nicht löschen; probiere es beim ersten Mal mit ein, zwei Zeilen.</p>
              {progress?.error && <p className="form-error" role="alert">{progress.error}</p>}
              <button type="button" className="sheet-button sheet-button-primary" disabled={!toImport || running} onClick={() => { void run(); }}>
                {running ? <><MiniLoader size={18} />Übernehme {progress?.done ?? 0} von {progress?.total ?? toImport} …</> : <><Check size={18} aria-hidden="true" />{toImport === 1 ? "1 Kunden übernehmen" : `${toImport} Kunden übernehmen`}</>}
              </button>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function ImportResult({ progress, onDone }: { progress: Progress; onDone: () => void }) {
  const count = (outcome: CustomerImportResult["outcome"]) => progress.results.filter((result) => result.outcome === outcome).length;
  const failed = progress.results.filter((result) => result.outcome === "failed");
  return (
    <div className="import-preview">
      <p className="dialog-success" role="status"><Check size={20} aria-hidden="true" />{count("created") === 1 ? "1 Kunde" : `${count("created")} Kunden`} angelegt, {count("updated")} ergänzt{count("unchanged") ? `, ${count("unchanged")} waren schon aktuell` : ""}.</p>
      {progress.error && <p className="form-error" role="alert">{progress.error}</p>}
      {failed.length > 0 && (
        <div className="field-warning" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <span><strong>{failed.length === 1 ? "1 Zeile" : `${failed.length} Zeilen`} nicht übernommen</strong>
            <ul className="import-failures">{failed.map((result) => <li key={result.line}>Zeile {result.line}{result.company ? ` · ${result.company}` : ""}: {result.error}</li>)}</ul>
          </span>
        </div>
      )}
      <p className="field-hint">Pakete und Logins legst du für die neuen Kunden wie gewohnt an: Pakete unter Vertrag & Domain, Logins mit „Konto anlegen“.</p>
      <button type="button" className="sheet-button sheet-button-primary" onClick={onDone}><Check size={18} aria-hidden="true" />Fertig</button>
    </div>
  );
}
