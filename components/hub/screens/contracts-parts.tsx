"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, FileText, Pencil, Save, Trash2 } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { hubHref } from "@/lib/hub-data";
import { fileCategories } from "@/lib/hub-files/catalog";
import type { HubStoredFile } from "@/lib/hub-files/types";
import { packageCatalog, packageGroups, type CustomerPackage, type PackageGroup } from "@/lib/service-packages";
import { centsToInput, formatCents, formatDay, MAX_NOTE, MAX_TITLE, timelineKindIds, timelineKinds, type TimelineKind } from "@/lib/hub-contracts/rules";
import { deleteTimelineEntry, saveCustomerPackages, saveTimelineEntry, setTimelineVisible, type ActionResult } from "@/lib/hub-contracts/actions";
import type { ContractCustomer, TimelineEntry } from "@/lib/hub-contracts/types";
import { Switch } from "../controls";
import { useInfo } from "../info-box";
import { Modal } from "../modal";

const Spinner = () => <MiniLoader size={16} />;

/** Runs one server action at a time and keeps its error for the form. */
export function useContractAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function run<T>(key: string, action: () => Promise<ActionResult<T>>, onDone: (data: T) => void) {
    setBusy(key);
    setError("");
    try {
      const result = await action();
      if (result.ok) onDone(result.data);
      else setError(result.error);
    } catch {
      setError("Das hat gerade nicht geklappt. Bitte versuche es erneut.");
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, run };
}

/** „seit 01.03.2026 · gekündigt zum 30.11.2026“ */
export function packageDates(item: CustomerPackage) {
  return [item.since ? `seit ${formatDay(item.since)}` : "", item.until ? `gekündigt zum ${formatDay(item.until)}` : ""].filter(Boolean).join(" · ");
}

/** „Domain & Mail · Service Max“, empty without packages. */
export const packagesLine = (packages: readonly CustomerPackage[]) => packages.flatMap((item) => item.packageId ? [packageCatalog[item.packageId].short] : []).join(" · ");

export function KindPill({ kind }: { kind: TimelineKind }) {
  return <span className={`chat-pill tone-${timelineKinds[kind].tone}`}>{timelineKinds[kind].label}</span>;
}

/** Contracts and invoices first, then the newest. */
function filesOf(files: readonly HubStoredFile[], customerId: string) {
  const rank = (file: HubStoredFile) => file.category === "invoice" ? 0 : file.category === "contract" ? 1 : 2;
  return files.filter((file) => file.customers.some((customer) => customer.id === customerId)).sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt));
}

const fileHref = (preview: boolean, fileId: string) => `${hubHref(preview, "files")}?file=${encodeURIComponent(fileId)}`;

/**
 * Both package groups of a customer: no package or one of the group, with „seit“ and „gekündigt zum“. Saving writes
 * only what changed; the database adds the change to the timeline.
 */
export function PackagesForm({ customer, canManage, onSaved }: { customer: ContractCustomer; canManage: boolean; onSaved: (message: string) => void }) {
  const [draft, setDraft] = useState<CustomerPackage[]>(customer.packages);
  const { busy, error, run } = useContractAction();
  const formId = useId();
  const info = useInfo("Pakete", {
    steps: [
      <><b>Ein Paket je Gruppe:</b> Domain und Service.</>,
      <><b>Speichern</b> schreibt es in den Verlauf, erst intern.</>,
      <><b>„Gekündigt zum“</b> setzen: steht dann unter „Demnächst“.</>,
    ],
    warn: "Noch nicht mit der Serviceplattform verbunden.",
    ask: "Wie funktionieren die Pakete unter Vertrag & Domain?",
  });
  const changed = JSON.stringify(draft) !== JSON.stringify(customer.packages);
  const set = (group: PackageGroup, patch: Partial<CustomerPackage>) => setDraft((items) => items.map((item) => {
    if (item.group !== group) return item;
    const next = { ...item, ...patch };
    return next.packageId ? next : { ...next, since: null, until: null };
  }));
  return (
    <form className="cdm-packages" onSubmit={(event) => {
      event.preventDefault();
      run("save", () => saveCustomerPackages({ customerId: customer.id, packages: draft }), (data) => onSaved(data.changed ? "Pakete gespeichert. Der Verlauf hat die Änderung eingetragen." : "Es gab nichts zu ändern."));
    }}>
      <div className="cdm-groups">
        {draft.map((item) => (
          <fieldset key={item.group} className="cdm-group" disabled={!canManage || busy !== null}>
            <legend>{packageGroups[item.group].name}</legend>
            <label className="cdm-option">
              <input type="radio" name={`${formId}-${item.group}`} checked={item.packageId === null} onChange={() => set(item.group, { packageId: null })} />
              <span><strong>Kein Paket</strong><small>In dieser Gruppe hat der Kunde nichts gebucht.</small></span>
            </label>
            {packageGroups[item.group].packages.map((id) => (
              <label key={id} className="cdm-option">
                <input type="radio" name={`${formId}-${item.group}`} checked={item.packageId === id} onChange={() => set(item.group, { packageId: id })} />
                <span><strong>{packageCatalog[id].name}</strong><small>{packageCatalog[id].description}</small></span>
              </label>
            ))}
            {item.packageId && (
              <div className="cdm-dates">
                <label className="upload-field"><span>Seit</span><input type="date" value={item.since ?? ""} max={item.until ?? undefined} onChange={(event) => set(item.group, { since: event.target.value || null })} /></label>
                <label className="upload-field"><span>Gekündigt zum</span><input type="date" value={item.until ?? ""} min={item.since ?? undefined} onChange={(event) => set(item.group, { until: event.target.value || null })} /></label>
              </div>
            )}
          </fieldset>
        ))}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {canManage && info.box}
      {canManage && (
        <div className="cdm-form-foot">
          <p className="field-hint">Jede Änderung trägt sich selbst in den Verlauf ein, zunächst nur für das oalab-Team sichtbar.</p>
          {info.button}
          <button type="submit" className="sheet-action is-primary" disabled={!changed || busy !== null}>{busy ? <Spinner /> : <Save size={15} aria-hidden="true" />}Pakete speichern</button>
        </div>
      )}
    </form>
  );
}

/** The customer's contracts and invoices from the asset management, linked rather than stored twice. */
export function ContractFiles({ files, customerId, preview, empty }: { files: readonly HubStoredFile[]; customerId: string; preview: boolean; empty: string }) {
  const own = filesOf(files, customerId).filter((file) => file.category === "contract" || file.category === "invoice");
  if (!own.length) return <p className="cdm-empty">{empty}</p>;
  return (
    <ul className="cdm-files">
      {own.map((file) => (
        <li key={file.id}>
          <FileText size={16} aria-hidden="true" />
          <Link href={fileHref(preview, file.id)}>{file.title}</Link>
          <small>{fileCategories[file.category]} · {formatDay(file.createdAt.slice(0, 10))}</small>
        </li>
      ))}
    </ul>
  );
}

/**
 * The timeline, newest first. Admins see the internal note and who entered it, release or hide each entry for the
 * customer and edit it; customers see what was released to them.
 */
export function TimelineList({ entries, files, preview, admin, canManage, companyOf, onOpenCustomer, onEdit, onNotice, empty }: {
  entries: readonly TimelineEntry[];
  files: readonly HubStoredFile[];
  preview: boolean;
  admin: boolean;
  canManage: boolean;
  /** The overview names the customer of each entry. */
  companyOf?: (customerId: string) => string;
  onOpenCustomer?: (customerId: string) => void;
  onEdit?: (entry: TimelineEntry) => void;
  onNotice?: (message: string) => void;
  empty: string;
}) {
  const { busy, error, run } = useContractAction();
  if (!entries.length) return <p className="cdm-empty">{empty}</p>;
  return (
    <>
      {error && <p className="form-error" role="alert">{error}</p>}
      <ol className="cdm-entries">
        {entries.map((entry) => {
          const file = entry.fileId ? files.find((item) => item.id === entry.fileId) : undefined;
          const company = companyOf?.(entry.customerId);
          return (
            <li key={entry.id} className="cdm-entry">
              <time className="cdm-entry-day numeric" dateTime={entry.occurredOn}>{formatDay(entry.occurredOn)}</time>
              <div className="cdm-entry-main">
                <div className="cdm-entry-top">
                  <KindPill kind={entry.kind} />
                  <strong>{entry.title}</strong>
                  {entry.amountCents !== null && <span className="cdm-amount numeric">{formatCents(entry.amountCents)}</span>}
                </div>
                {(company || file) && (
                  <div className="cdm-entry-meta">
                    {company && (onOpenCustomer ? <button type="button" className="cdm-link" onClick={() => onOpenCustomer(entry.customerId)}>{company}</button> : <span>{company}</span>)}
                    {file && <Link href={fileHref(preview, file.id)}><FileText size={13} aria-hidden="true" />{file.title}</Link>}
                  </div>
                )}
                {admin && entry.note && <p className="cdm-note">{entry.note}</p>}
                {admin && entry.authorName && <small className="cdm-entry-by">{entry.source === "package" ? "Automatisch beim Speichern der Pakete" : "Eingetragen"} von {entry.authorName}</small>}
              </div>
              {admin && (
                <div className="cdm-entry-acts">
                  <button
                    type="button"
                    className={`cdm-visibility${entry.customerVisible ? " is-on" : ""}`}
                    aria-pressed={entry.customerVisible}
                    disabled={!canManage || busy !== null}
                    title={entry.customerVisible ? "Der Kunde sieht diesen Eintrag. Klicken, um ihn nur intern zu zeigen." : "Nur das oalab-Team sieht diesen Eintrag. Klicken, um ihn für den Kunden freizugeben."}
                    onClick={() => run(entry.id, () => setTimelineVisible({ id: entry.id, visible: !entry.customerVisible }), (data) => onNotice?.(data.visible ? "Der Kunde sieht den Eintrag jetzt." : "Der Eintrag ist jetzt nur intern."))}
                  >
                    {busy === entry.id ? <Spinner /> : entry.customerVisible ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
                    <span>{entry.customerVisible ? "Kunde sieht das" : "Nur intern"}</span>
                  </button>
                  {canManage && onEdit && <button type="button" className="row-action" onClick={() => onEdit(entry)} aria-label={`${entry.title} bearbeiten`} title="Bearbeiten"><Pencil size={16} aria-hidden="true" /></button>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}

const titleHints: Record<TimelineKind, string> = {
  invoice_paid: "Rechnung Oktober bezahlt",
  invoice_sent: "Rechnung Oktober gestellt",
  package: "Paket verlängert",
  domain: "Domain umgezogen",
  mail: "Postfach info@ eingerichtet",
  other: "Gespräch zur Vertragsverlängerung",
};

/** Enters a timeline entry or edits one: day, kind, title, amount, a file of the customer, internal note, release. */
export function TimelineDialog({ customer, entry, files, today, onClose, onSaved }: {
  customer: ContractCustomer;
  entry?: TimelineEntry;
  files: readonly HubStoredFile[];
  today: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [draft, setDraft] = useState({
    occurredOn: entry?.occurredOn ?? today,
    kind: entry?.kind ?? ("invoice_paid" as TimelineKind),
    title: entry?.title ?? "",
    amount: centsToInput(entry?.amountCents ?? null),
    fileId: entry?.fileId ?? "",
    note: entry?.note ?? "",
    customerVisible: entry?.customerVisible ?? false,
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { busy, error, run } = useContractAction();
  const switchId = useId();
  const info = useInfo("Verlauf", {
    steps: [
      <><b>Neue Einträge</b> sind erst intern.</>,
      <><b>Freigeben</b> mit dem Schalter oder „Nur intern“ in der Liste.</>,
      <><b>Die Notiz</b> sieht der Kunde nie.</>,
    ],
    ask: "Wie funktioniert der Verlauf eines Kunden?",
  });
  const set = (key: "occurredOn" | "kind" | "title" | "amount" | "fileId" | "note") => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setDraft({ ...draft, [key]: event.target.value });
  const own = filesOf(files, customer.id);
  const disabled = busy !== null;
  return (
    <Modal title={entry ? "Zeitpunkt bearbeiten" : "Zeitpunkt eintragen"} onClose={onClose} className="users-modal" actions={info.button}>
      {info.box}
      <form className="cdm-dialog" onSubmit={(event) => {
        event.preventDefault();
        run("save", () => saveTimelineEntry({ ...draft, id: entry?.id, customerId: customer.id }), () => { onSaved(entry ? "Zeitpunkt gespeichert." : "Zeitpunkt eingetragen."); onClose(); });
      }}>
        <p className="field-hint">{customer.company} · {customer.customerNumber}</p>
        <div className="upload-fields">
          <label className="upload-field"><span>Datum</span><input type="date" required value={draft.occurredOn} onChange={set("occurredOn")} disabled={disabled} /></label>
          <label className="upload-field"><span>Art</span><select value={draft.kind} onChange={set("kind")} disabled={disabled}>{timelineKindIds.map((id) => <option key={id} value={id}>{timelineKinds[id].label}</option>)}</select></label>
          <label className="upload-field upload-field-wide"><span>Titel</span><input value={draft.title} onChange={set("title")} maxLength={MAX_TITLE} required placeholder={titleHints[draft.kind]} disabled={disabled} /></label>
          <label className="upload-field"><span>Betrag (optional)</span><input value={draft.amount} onChange={set("amount")} inputMode="decimal" placeholder="89,00" disabled={disabled} /></label>
          <label className="upload-field"><span>Datei (optional)</span>
            <select value={draft.fileId} onChange={set("fileId")} disabled={disabled}>
              <option value="">Keine Datei</option>
              {own.map((file) => <option key={file.id} value={file.id}>{fileCategories[file.category]}: {file.title}</option>)}
            </select>
          </label>
          <label className="upload-field upload-field-wide"><span>Notiz (nur für das oalab-Team)</span><textarea value={draft.note} onChange={set("note")} maxLength={MAX_NOTE} rows={3} disabled={disabled} /></label>
        </div>
        <div className="cdm-switch-row">
          <Switch id={switchId} checked={draft.customerVisible} onChange={(value) => setDraft({ ...draft, customerVisible: value })} label="Kunde sieht diesen Eintrag" />
          <label htmlFor={switchId}>Kunde sieht diesen Eintrag</label>
        </div>
        <p className="field-hint">{draft.customerVisible ? "Der Kunde sieht Datum, Art, Titel, Betrag und die Datei unter Vertrag & Domain, nie die Notiz." : "Nur das oalab-Team sieht diesen Eintrag."}</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="sheet-button sheet-button-primary" disabled={disabled}>{busy === "save" ? <Spinner /> : <Save size={18} aria-hidden="true" />}{entry ? "Änderungen speichern" : "Eintragen"}</button>
        {entry && (confirmDelete
          ? <button type="button" className="sheet-button sheet-button-danger" disabled={disabled} onClick={() => run("delete", () => deleteTimelineEntry({ id: entry.id }), () => { onSaved("Zeitpunkt gelöscht."); onClose(); })}>{busy === "delete" ? <Spinner /> : <Trash2 size={18} aria-hidden="true" />}Wirklich löschen</button>
          : <button type="button" className="sheet-button" disabled={disabled} onClick={() => setConfirmDelete(true)}><Trash2 size={18} aria-hidden="true" />Löschen</button>)}
      </form>
    </Modal>
  );
}
