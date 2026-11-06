"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarClock, Eye, EyeOff, FileText, Globe, History, LifeBuoy, Mail, Package, Paperclip, Pencil, Plus, Receipt, Save, Trash2, type LucideIcon } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { hubHref } from "@/lib/hub-data";
import { fileCategories } from "@/lib/hub-files/catalog";
import type { HubStoredFile } from "@/lib/hub-files/types";
import { packageCatalog, packageGroups, type CustomerPackage, type PackageGroup, type PackageId } from "@/lib/service-packages";
import { centsToInput, formatCents, formatDay, MAX_NOTE, MAX_TITLE, timelineKindIds, timelineKinds, type TimelineKind } from "@/lib/hub-contracts/rules";
import { deleteTimelineEntry, saveCustomerPackages, saveTimelineEntry, setTimelineVisible, type ActionResult } from "@/lib/hub-contracts/actions";
import type { ContractCustomer, TimelineEntry } from "@/lib/hub-contracts/types";
import { Switch } from "../controls";
import { useInfo } from "../info-box";
import { Modal } from "../modal";
import { SheetFooter, TableGroup, useCollapsedGroups } from "../sheet";
import { DownloadButton } from "./files-dialogs";
import { CategoryDot } from "./files-parts";

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

/** „Domain & Mail · Service Max“, empty without packages. */
export const packagesLine = (packages: readonly CustomerPackage[]) => packages.flatMap((item) => item.packageId ? [packageCatalog[item.packageId].short] : []).join(" · ");

/** Search in the admin tabs: no term, or one of the values contains it. */
export const tableHit = (term: string, ...values: (string | null | undefined)[]) => !term || values.some((value) => value?.toLocaleLowerCase("de").includes(term));

/** Columns of the admin tables: Eintrag, Art, Datum, Aktion. */
export const ADMIN_COLUMNS = 4;

/** Contracts and invoices first, then the newest. */
function filesOf(files: readonly HubStoredFile[], customerId: string) {
  const rank = (file: HubStoredFile) => file.category === "invoice" ? 0 : file.category === "contract" ? 1 : 2;
  return files.filter((file) => file.customers.some((customer) => customer.id === customerId)).sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt));
}

const fileHref = (preview: boolean, fileId: string) => `${hubHref(preview, "files")}?file=${encodeURIComponent(fileId)}`;
/** „Domain“, „Domain & Mail“, „Lite“, „Max“: the choices of a package row. */
const pickLabel = (id: PackageId | null) => id ? packageCatalog[id].short.replace(/^Service /, "") : "Kein";
const packageName = (id: PackageId | null) => id ? packageCatalog[id].short : "Kein Paket";

/**
 * The tab „Vertrag“ of one customer: both package groups as rows, each with its choice, „seit“ and, once cancelled,
 * „bis“; a bar above the table saves or discards what changed (the database adds it to the timeline). Below, the
 * customer's contracts and invoices from the asset management, linked rather than stored twice.
 */
export function ContractTab({ customer, files, preview, canManage, query, onSaved, onError }: {
  customer: ContractCustomer;
  files: readonly HubStoredFile[];
  preview: boolean;
  canManage: boolean;
  query: string;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState<CustomerPackage[]>(customer.packages);
  const [endOpen, setEndOpen] = useState<Partial<Record<PackageGroup, boolean>>>({});
  const { busy, error, run } = useContractAction();
  const groups = useCollapsedGroups();
  const info = useInfo("Pakete", {
    steps: [
      <><b>Ein Paket je Gruppe:</b> Domain und Service.</>,
      <><b>Speichern</b> schreibt es in den Verlauf, erst intern.</>,
      <><b>Kündigung eintragen:</b> steht dann unter „Demnächst“.</>,
    ],
    warn: "Noch nicht mit der Serviceplattform verbunden.",
    ask: "Wie funktionieren die Pakete unter Vertrag & Domain?",
  });
  const term = query.trim().toLocaleLowerCase("de");
  const saved = (group: PackageGroup) => customer.packages.find((item) => item.group === group);
  const differs = (item: CustomerPackage) => JSON.stringify(item) !== JSON.stringify(saved(item.group));
  const changes = draft.filter(differs).map((item) => {
    const before = saved(item.group);
    return before?.packageId !== item.packageId
      ? `${packageGroups[item.group].name}: ${packageName(before?.packageId ?? null)} → ${packageName(item.packageId)}`
      : `${packageGroups[item.group].name}: neue Daten`;
  });
  const set = (group: PackageGroup, patch: Partial<CustomerPackage>) => setDraft((items) => items.map((item) => {
    if (item.group !== group) return item;
    const next = { ...item, ...patch };
    return next.packageId ? next : { ...next, since: null, until: null };
  }));
  const save = () => run("save", () => saveCustomerPackages({ customerId: customer.id, packages: draft }), (data) => onSaved(data.changed ? "Pakete gespeichert. Der Verlauf hat die Änderung eingetragen." : "Es gab nichts zu ändern."));
  const rows = draft.filter((item) => tableHit(term, packageGroups[item.group].name, item.packageId ? packageCatalog[item.packageId].name : "Kein Paket"));
  const documents = filesOf(files, customer.id).filter((file) => (file.category === "contract" || file.category === "invoice") && tableHit(term, file.title, file.fileName));
  const locked = !canManage || busy !== null;

  return (
    <>
      {canManage && changes.length > 0 && (
        <div className="sheet-selection cdm-savebar" role="region" aria-label="Ungespeicherte Änderung">
          <strong>{changes.join(" · ")}</strong>
          <span className="sheet-spacer" />
          <button type="button" className="sheet-action" onClick={() => { setDraft(customer.packages); setEndOpen({}); }} disabled={busy !== null}>Verwerfen</button>
          <button type="button" className="sheet-action is-primary" onClick={save} disabled={busy !== null}>{busy ? <Spinner /> : <Save size={15} aria-hidden="true" />}Speichern</button>
        </div>
      )}
      {error && <p className="form-error cdm-tab-error" role="alert">{error}</p>}
      <div className="am-scroll">
        <table className="file-table cdm-table cdm-admin-table">
          <caption className="visually-hidden">Pakete, Verträge und Rechnungen von {customer.company}</caption>
          <TableGroup colSpan={ADMIN_COLUMNS} label="Pakete" count={rows.length} glyph={<Package size={16} aria-hidden="true" />} collapsed={groups.isCollapsed("packages")} onToggle={() => groups.toggle("packages")} actions={info.button}>
            {rows.map((item) => {
              const name = packageGroups[item.group].name;
              return (
                <tr key={item.group} className={`file-row cdm-package-row${differs(item) ? " is-changed" : ""}`}>
                  <td className="cell-file">
                    <span className="am-file">
                      <span className={`am-file-icon cdm-file-icon is-${item.group}`}>{item.group === "domain" ? <Globe size={16} aria-hidden="true" /> : <LifeBuoy size={16} aria-hidden="true" />}</span>
                      <span className="am-file-text"><strong>{name}</strong><small>{item.packageId ? packageCatalog[item.packageId].description : "Kein Paket gebucht"}</small></span>
                    </span>
                  </td>
                  <td className="cell-category">
                    <span className="cdm-picker" role="radiogroup" aria-label={`${name}-Paket`}>
                      {[null, ...packageGroups[item.group].packages].map((id) => (
                        <button key={id ?? "none"} type="button" role="radio" className="cdm-pick" aria-checked={item.packageId === id} disabled={locked} onClick={() => set(item.group, { packageId: id })} title={id ? packageCatalog[id].name : "Kein Paket"}>{pickLabel(id)}</button>
                      ))}
                    </span>
                  </td>
                  <td className="cell-date">
                    {item.packageId && <label className="cdm-date-in"><span>seit</span><input type="date" value={item.since ?? ""} max={item.until ?? undefined} disabled={locked} onChange={(event) => set(item.group, { since: event.target.value || null })} aria-label={`${name} seit`} /></label>}
                  </td>
                  <td className="cell-action">
                    {item.packageId && (item.until || endOpen[item.group]
                      ? <label className="cdm-date-in"><span>bis</span><input type="date" value={item.until ?? ""} min={item.since ?? undefined} disabled={locked} onChange={(event) => set(item.group, { until: event.target.value || null })} aria-label={`${name} gekündigt zum`} /></label>
                      : canManage && <button type="button" className="cdm-quiet" onClick={() => setEndOpen({ ...endOpen, [item.group]: true })} title="Kündigung eintragen"><Plus size={14} aria-hidden="true" /><span>Kündigung</span></button>)}
                  </td>
                </tr>
              );
            })}
          </TableGroup>
          <TableGroup
            colSpan={ADMIN_COLUMNS}
            label="Verträge und Rechnungen"
            count={documents.length}
            glyph={<FileText size={16} aria-hidden="true" />}
            collapsed={groups.isCollapsed("documents")}
            onToggle={() => groups.toggle("documents")}
            actions={<Link className="table-group-action" href={hubHref(preview, "files")} title="Im Asset Management öffnen" aria-label="Im Asset Management öffnen"><ArrowUpRight size={15} aria-hidden="true" /></Link>}
            empty="Im Asset Management liegen bei diesem Kunden noch keine Verträge oder Rechnungen."
          >
            {documents.map((file) => (
              <tr key={file.id} className="file-row">
                <td className="cell-file"><Link className="am-file" href={fileHref(preview, file.id)}><span className="am-file-icon cdm-file-icon"><FileText size={16} aria-hidden="true" /></span><span className="am-file-text"><strong>{file.title}</strong><small>{file.fileName}</small></span></Link></td>
                <td className="cell-category"><CategoryDot category={file.category} /></td>
                <td className="cell-date numeric">{formatDay(file.createdAt.slice(0, 10))}</td>
                <td className="cell-action"><DownloadButton file={file} onError={onError} compact /></td>
              </tr>
            ))}
          </TableGroup>
        </table>
        {info.box}
      </div>
      <SheetFooter hint="Änderungen tragen sich selbst in den Verlauf ein, erst intern">
        {customer.packages.map((item) => item.packageId ? `${packageCatalog[item.packageId].short}${item.since ? ` seit ${formatDay(item.since)}` : ""}` : `kein ${packageGroups[item.group].name}-Paket`).join(" · ")}
      </SheetFooter>
    </>
  );
}

const timelineIcons: Record<TimelineKind, LucideIcon> = { invoice_paid: Receipt, invoice_sent: Receipt, package: Package, domain: Globe, mail: Mail, other: CalendarClock };
const monthName = (month: string) => new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));

/**
 * The tab „Verlauf“ of one customer, newest first and grouped by month. Each row says whether the customer sees it;
 * a click on „Intern“ or „Kunde“ switches that. The note and who entered it stay with the team.
 */
export function TimelineTab({ customer, entries, files, preview, canManage, query, onEdit, onNotice }: {
  customer: ContractCustomer;
  entries: readonly TimelineEntry[];
  files: readonly HubStoredFile[];
  preview: boolean;
  canManage: boolean;
  query: string;
  onEdit: (entry: TimelineEntry) => void;
  onNotice: (message: string) => void;
}) {
  const { busy, error, run } = useContractAction();
  const groups = useCollapsedGroups();
  const info = useInfo("Freigabe im Verlauf", {
    steps: [
      <><b>Neue Einträge</b> sind erst intern.</>,
      <><b>„Intern“ antippen:</b> der Kunde sieht den Eintrag.</>,
      <><b>Die Notiz</b> sieht der Kunde nie.</>,
    ],
    ask: "Wie gebe ich einen Eintrag im Verlauf für den Kunden frei?",
  });
  const term = query.trim().toLocaleLowerCase("de");
  const fileOf = (entry: TimelineEntry) => entry.fileId ? files.find((item) => item.id === entry.fileId) : undefined;
  const shown = entries.filter((entry) => tableHit(term, entry.title, entry.note, timelineKinds[entry.kind].label, fileOf(entry)?.title));
  const months = [...new Set(shown.map((entry) => entry.occurredOn.slice(0, 7)))];
  const released = entries.filter((entry) => entry.customerVisible).length;

  return (
    <>
      {error && <p className="form-error cdm-tab-error" role="alert">{error}</p>}
      <div className="am-scroll">
        <table className="file-table cdm-table cdm-admin-table">
          <caption className="visually-hidden">Verlauf von {customer.company}</caption>
          {!months.length && (
            <TableGroup colSpan={ADMIN_COLUMNS} label="Verlauf" count={0} glyph={<History size={16} aria-hidden="true" />} collapsed={false} onToggle={() => undefined} actions={info.button} empty={term ? `Kein Eintrag passt zu „${query.trim()}“.` : "Noch keine Zeitpunkte. Trag zum Beispiel ein, wann eine Rechnung gestellt oder bezahlt wurde."} />
          )}
          {months.map((month, index) => {
            const rows = shown.filter((entry) => entry.occurredOn.startsWith(month));
            return (
              <TableGroup key={month} colSpan={ADMIN_COLUMNS} label={monthName(month)} count={rows.length} glyph={<CalendarClock size={16} aria-hidden="true" />} collapsed={groups.isCollapsed(month)} onToggle={() => groups.toggle(month)} actions={index === 0 ? info.button : undefined}>
                {rows.map((entry) => {
                  const file = fileOf(entry);
                  const Icon = timelineIcons[entry.kind];
                  const by = entry.authorName ? `${entry.source === "package" ? "Automatisch beim Speichern der Pakete" : "Eingetragen"} von ${entry.authorName}` : undefined;
                  return (
                    <tr key={entry.id} className="file-row">
                      <td className="cell-file">
                        <span className="am-file" title={by}>
                          <span className="am-file-icon cdm-file-icon"><Icon size={16} aria-hidden="true" /></span>
                          <span className="am-file-text"><strong>{entry.title}</strong><small>{[entry.amountCents !== null ? formatCents(entry.amountCents) : "", entry.note ?? ""].filter(Boolean).join(" · ") || by}</small></span>
                        </span>
                      </td>
                      <td className="cell-category"><span className={`file-dot cdm-dot-${timelineKinds[entry.kind].tone}`}><i aria-hidden="true" />{timelineKinds[entry.kind].label}</span></td>
                      <td className="cell-date numeric">{formatDay(entry.occurredOn)}</td>
                      <td className="cell-action">
                        <button
                          type="button"
                          className={`cdm-release${entry.customerVisible ? " is-on" : ""}`}
                          aria-pressed={entry.customerVisible}
                          disabled={!canManage || busy !== null}
                          title={entry.customerVisible ? "Der Kunde sieht diesen Eintrag. Klicken, um ihn nur intern zu zeigen." : "Nur das oalab-Team sieht diesen Eintrag. Klicken, um ihn für den Kunden freizugeben."}
                          onClick={() => run(entry.id, () => setTimelineVisible({ id: entry.id, visible: !entry.customerVisible }), (data) => onNotice(data.visible ? "Der Kunde sieht den Eintrag jetzt." : "Der Eintrag ist jetzt nur intern."))}
                        >
                          {busy === entry.id ? <Spinner /> : entry.customerVisible ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
                          <span>{entry.customerVisible ? "Kunde" : "Intern"}</span>
                        </button>
                        {file && <Link className="am-icon-btn" href={fileHref(preview, file.id)} aria-label={`Datei ${file.title} öffnen`} title={file.title}><Paperclip size={16} aria-hidden="true" /></Link>}
                        {canManage && <button type="button" className="am-icon-btn" onClick={() => onEdit(entry)} aria-label={`${entry.title} bearbeiten`} title="Bearbeiten"><Pencil size={16} aria-hidden="true" /></button>}
                      </td>
                    </tr>
                  );
                })}
              </TableGroup>
            );
          })}
        </table>
        {info.box}
      </div>
      <SheetFooter hint="Neue Einträge sind erst intern">
        {entries.length === 1 ? "1 Eintrag" : `${entries.length} Einträge`} · {released} für den Kunden sichtbar
      </SheetFooter>
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
      <><b>Freigeben</b> mit dem Schalter oder „Intern“ in der Liste.</>,
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
