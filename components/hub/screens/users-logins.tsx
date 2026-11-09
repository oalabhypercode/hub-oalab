"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, FileSpreadsheet, MailX, Send, Upload, UserPlus } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { createCustomerLogins, sendInvitations, type InvitationResult, type LoginCreationResult } from "@/lib/hub-users/actions";
import { cleanEmail, normalizeCompany, readPerson } from "@/lib/hub-users/rules";
import type { ManagedCustomer, ManagedUser } from "@/lib/hub-users/types";
import { formatFileDate, formatFileDateTime } from "@/lib/hub-files/catalog";
import { decodeImportFile, guessMapping, MAX_IMPORT_BYTES, parseCsv, readContacts, type ImportContact } from "@/lib/hub-customer-import/rules";
import { checkLogins, INVITE_BATCH, isFirstInvitation, isInvitable, LOGIN_BATCH, loginDrafts, type LoginCustomer } from "@/lib/hub-invitations/rules";
import { ACTIVATION_LINK_HOURS } from "@/lib/platform/config";
import { useInfo } from "../info-box";
import { Modal } from "../modal";

type Progress<T> = { done: number; total: number; results: T[]; error: string };
type Edit = { firstName?: string; lastName?: string; email?: string };

/** The hub's own rules for a login's address and names, as „Zugang anlegen“ checks them. */
const loginChecks = {
  email: (email: string) => (cleanEmail(email).ok ? null : "invalid"),
  person: (firstName: string, lastName: string) => {
    const person = readPerson({ firstName, lastName, phone: "", position: "" });
    return person.ok ? null : person.error;
  },
};

/** Runs batches one after the other and keeps the progress; a broken connection stops with what is done. */
async function inBatches<T, R>(items: T[], size: number, send: (batch: T[]) => Promise<{ ok: true; data: R[] } | { ok: false; error: string }>, onProgress: (progress: Progress<R>) => void) {
  let progress: Progress<R> = { done: 0, total: items.length, results: [], error: "" };
  onProgress(progress);
  for (let start = 0; start < items.length; start += size) {
    const batch = items.slice(start, start + size);
    try {
      const result = await send(batch);
      if (!result.ok) { onProgress({ ...progress, error: result.error }); return; }
      progress = { ...progress, done: progress.done + batch.length, results: [...progress.results, ...result.data] };
      onProgress(progress);
    } catch {
      onProgress({ ...progress, error: "Die Verbindung ist abgebrochen. Was bis hierhin erledigt ist, bleibt; öffne das Fenster erneut für den Rest." });
      return;
    }
  }
}

/**
 * „Zugänge anlegen“: one login with the role Kunde for every customer that has none yet. Names and addresses come from
 * the contact person in the accounting's export (if loaded) or the customer's contact address and can be changed in the
 * row. No mail goes out here; the invitations follow with „Einladungen senden“ under „Zugänge“.
 */
export function CustomerLoginsDialog({ customers, users, onClose, onNotice }: { customers: ManagedCustomer[]; users: ManagedUser[]; onClose: () => void; onNotice: (message: string) => void }) {
  const [contacts, setContacts] = useState<{ name: string; count: number; find: (customer: LoginCustomer) => ImportContact | null } | null>(null);
  const [fileError, setFileError] = useState("");
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<Progress<LoginCreationResult> | null>(null);
  const info = useInfo("Zugänge anlegen", {
    steps: [
      <><b>Ein Zugang je Kunde</b> ohne Zugang, mit der Rolle Kunde.</>,
      <><b>Namen und Adresse</b> aus der Sevdesk-Datei oder von Hand.</>,
      <><b>Noch keine Mail:</b> die Einladung folgt unter „Zugänge“.</>,
    ],
    ask: "Wie lege ich Zugänge für viele Kunden an?",
  });

  const taken = useMemo(() => new Set(users.map((user) => user.email.trim().toLowerCase())), [users]);
  const base = useMemo(() => loginDrafts(customers, contacts?.find), [customers, contacts]);
  const rows = checkLogins(base.map((draft) => ({ ...draft, ...edits[draft.customerId] })), taken, loginChecks);
  const included = rows.filter((row) => !row.problem && !skipped.has(row.customerId));
  const running = progress !== null && progress.done < progress.total && !progress.error;
  const finished = progress !== null && !running;

  async function readFile(file: File | undefined) {
    setFileError("");
    if (!file) return;
    if (!/\.csv$/i.test(file.name) || file.size > MAX_IMPORT_BYTES) { setFileError("Bitte die CSV-Datei aus Sevdesk wählen (bis 5 MB)."); return; }
    const table = parseCsv(decodeImportFile(new Uint8Array(await file.arrayBuffer())));
    const mapping = guessMapping(table[0] ?? []);
    if (mapping.firstName === null && mapping.lastName === null) { setFileError("In der Datei fehlen die Spalten Vorname und Nachname."); return; }
    const found = readContacts(table, mapping, normalizeCompany);
    setContacts({ name: file.name, count: found.count, find: (customer) => found.byNumber.get(customer.customerNumber) ?? found.byCompany.get(normalizeCompany(customer.company)) ?? null });
  }

  const edit = (customerId: string, field: keyof Edit) => (event: React.ChangeEvent<HTMLInputElement>) => setEdits((current) => ({ ...current, [customerId]: { ...current[customerId], [field]: event.target.value } }));
  const toggle = (customerId: string) => setSkipped((current) => {
    const next = new Set(current);
    if (next.has(customerId)) next.delete(customerId); else next.add(customerId);
    return next;
  });

  function run() {
    const queue = included.map(({ customerId, firstName, lastName, email }) => ({ customerId, firstName: firstName.trim(), lastName: lastName.trim(), email }));
    void inBatches(queue, LOGIN_BATCH, (batch) => createCustomerLogins({ rows: batch }), setProgress);
  }

  function close() {
    if (running) return;
    const created = progress?.results.filter((result) => result.outcome === "created").length ?? 0;
    if (created) onNotice(`${created === 1 ? "1 Zugang" : `${created} Zugänge`} angelegt. Die Einladungen schickst du unter „Zugänge“ mit „Einladungen senden“.`);
    onClose();
  }

  const companyOf = (customerId: string) => rows.find((row) => row.customerId === customerId)?.company ?? customers.find((customer) => customer.id === customerId)?.company ?? "";

  return (
    <Modal title="Zugänge anlegen" onClose={close} className="users-modal import-modal" actions={info.button}>
      {info.box}
      {finished && progress ? (
        <div className="import-preview">
          <p className="dialog-success" role="status"><Check size={20} aria-hidden="true" />{progress.results.filter((result) => result.outcome === "created").length} Zugänge angelegt. Noch ist keine Mail raus.</p>
          {progress.error && <p className="form-error" role="alert">{progress.error}</p>}
          <Failures items={progress.results.filter((result) => result.outcome === "failed").map((result) => ({ key: result.customerId, label: companyOf(result.customerId), error: result.error ?? "" }))} />
          <p className="field-hint">Die Einladungen mit dem Aktivierungslink schickst du unter „Zugänge“ mit „Einladungen senden“. Bis dahin stehen die neuen Zugänge dort auf „Aktivierung offen“.</p>
          <button type="button" className="sheet-button sheet-button-primary" onClick={close}><Check size={18} aria-hidden="true" />Fertig</button>
        </div>
      ) : !rows.length ? (
        <p className="field-hint">Alle Kunden haben schon einen Zugang. Einen weiteren Zugang für einen Kunden legst du mit „Zugang anlegen“ an.</p>
      ) : (
        <div className="import-preview">
          <p className="field-hint">Für jeden Kunden ohne Zugang steht hier eine Zeile. Prüfe Namen und Adresse; angelegt wird erst mit dem Knopf unten, und noch geht keine Mail raus.</p>
          {contacts ? (
            <div className="import-file">
              <FileSpreadsheet size={18} aria-hidden="true" />
              <span><strong>{contacts.name}</strong><small>{contacts.count === 1 ? "1 Ansprechpartner" : `${contacts.count} Ansprechpartner`} gefunden, nach Kundennummer und Firma zugeordnet</small></span>
            </div>
          ) : (
            <label className="am-zone import-zone">
              <Upload size={22} aria-hidden="true" />
              <span><strong>Ansprechpartner aus der Sevdesk-Datei übernehmen</strong><small>optional · dieselbe CSV-Datei wie beim Import</small></span>
              <input type="file" accept=".csv,text/csv" className="visually-hidden" onChange={(event) => { void readFile(event.target.files?.[0]); event.target.value = ""; }} />
            </label>
          )}
          {fileError && <p className="form-error" role="alert">{fileError}</p>}

          <div className="import-table-wrap">
            <table className="data-table import-table login-table">
              <caption className="visually-hidden">Kunden ohne Zugang mit Vorname, Nachname und E-Mail-Adresse des neuen Zugangs</caption>
              <thead>
                <tr>
                  <th scope="col"><span className="visually-hidden">Anlegen</span></th>
                  <th scope="col">Kunde</th>
                  <th scope="col">Vorname</th>
                  <th scope="col">Nachname</th>
                  <th scope="col">E-Mail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.customerId} className={`data-row${row.problem || skipped.has(row.customerId) ? " is-muted" : ""}`}>
                    <td className="cell-check"><input type="checkbox" checked={!row.problem && !skipped.has(row.customerId)} disabled={Boolean(row.problem) || running} onChange={() => toggle(row.customerId)} aria-label={`Zugang für ${row.company} anlegen`} /></td>
                    <td className="import-company">
                      <strong>{row.company}</strong>
                      <small className="numeric">{row.customerNumber}</small>
                      {row.problem ? <small className="import-note">{row.problem}</small> : row.source === "file" && !edits[row.customerId] ? <small>aus der Sevdesk-Datei</small> : null}
                    </td>
                    <td className="login-input"><input value={row.firstName} onChange={edit(row.customerId, "firstName")} disabled={running} aria-label={`Vorname für ${row.company}`} placeholder="Vorname" autoComplete="off" /></td>
                    <td className="login-input"><input value={row.lastName} onChange={edit(row.customerId, "lastName")} disabled={running} aria-label={`Nachname für ${row.company}`} placeholder="Nachname" autoComplete="off" /></td>
                    <td className="login-input login-mail"><input type="email" value={row.email} onChange={edit(row.customerId, "email")} disabled={running} aria-label={`E-Mail für ${row.company}`} placeholder="E-Mail" autoComplete="off" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="field-hint">Ein Zugang gehört zu genau einem Kunden. Die Person bekommt erst mit „Einladungen senden“ ihren Link; bis dahin bemerkt sie nichts.</p>
          {progress?.error && <p className="form-error" role="alert">{progress.error}</p>}
          <button type="button" className="sheet-button sheet-button-primary" disabled={!included.length || running} onClick={run}>
            {running ? <><MiniLoader size={18} />Lege {progress?.done ?? 0} von {progress?.total ?? included.length} an …</> : <><UserPlus size={18} aria-hidden="true" />{included.length === 1 ? "1 Zugang anlegen" : `${included.length} Zugänge anlegen`}</>}
          </button>
        </div>
      )}
    </Modal>
  );
}

/**
 * „Einladungen senden“: the activation link by mail to logins that never signed in. Those never invited start ticked;
 * the others (reminders) are ticked on purpose. A new link replaces older ones.
 */
export function InvitationsDialog({ users, customers, mailConfigured, onClose, onNotice }: { users: ManagedUser[]; customers: ManagedCustomer[]; mailConfigured: boolean; onClose: () => void; onNotice: (message: string) => void }) {
  const candidates = useMemo(() => users.filter(isInvitable).map((user) => ({ user, customer: customers.find((customer) => customer.id === user.customerIds[0]) ?? null }))
    .sort((a, b) => (a.customer?.company ?? "").localeCompare(b.customer?.company ?? "", "de") || a.user.email.localeCompare(b.user.email)), [users, customers]);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(users.filter(isFirstInvitation).map((user) => user.id)));
  const [progress, setProgress] = useState<Progress<InvitationResult> | null>(null);
  const days = ACTIVATION_LINK_HOURS / 24;
  const info = useInfo("Einladungen", {
    steps: [
      <><b>Für Zugänge ohne Anmeldung:</b> Status „Aktivierung offen“.</>,
      <><b>Der Link gilt {days} Tage;</b> ein neuer ersetzt den alten.</>,
      <><b>Erinnern:</b> schon Eingeladene bewusst anhaken.</>,
    ],
    ask: "Wie verschicke ich Einladungen an viele Zugänge?",
  });
  const running = progress !== null && progress.done < progress.total && !progress.error;
  const finished = progress !== null && !running;
  const selected = candidates.filter((item) => chosen.has(item.user.id));
  const nameOf = (userId: string) => {
    const item = candidates.find((candidate) => candidate.user.id === userId);
    return item ? `${`${item.user.firstName} ${item.user.lastName}`.trim() || item.user.email}${item.customer ? ` (${item.customer.company})` : ""}` : "Zugang";
  };
  const toggle = (userId: string) => setChosen((current) => {
    const next = new Set(current);
    if (next.has(userId)) next.delete(userId); else next.add(userId);
    return next;
  });
  const allChosen = candidates.length > 0 && selected.length === candidates.length;

  function run() {
    void inBatches(selected.map((item) => item.user.id), INVITE_BATCH, (batch) => sendInvitations({ userIds: batch }), setProgress);
  }

  function close() {
    if (running) return;
    const sent = progress?.results.filter((result) => result.outcome === "sent").length ?? 0;
    if (sent) onNotice(`${sent === 1 ? "1 Einladung" : `${sent} Einladungen`} verschickt.`);
    onClose();
  }

  return (
    <Modal title="Einladungen senden" onClose={close} className="users-modal import-modal" actions={info.button}>
      {info.box}
      {finished && progress ? (
        <div className="import-preview">
          <p className="dialog-success" role="status"><Check size={20} aria-hidden="true" />{progress.results.filter((result) => result.outcome === "sent").length} Einladungen verschickt{progress.results.some((result) => result.outcome === "skipped") ? `, ${progress.results.filter((result) => result.outcome === "skipped").length} übersprungen` : ""}.</p>
          {progress.error && <p className="form-error" role="alert">{progress.error}</p>}
          <Failures items={progress.results.filter((result) => result.outcome !== "sent").map((result) => ({ key: result.userId, label: nameOf(result.userId), error: result.error ?? "" }))} />
          <p className="field-hint">Wer sich angemeldet hat, steht unter „Zugänge“ auf „Aktiv“; unter „Kunden“ siehst du je Kunde den letzten Login.</p>
          <button type="button" className="sheet-button sheet-button-primary" onClick={close}><Check size={18} aria-hidden="true" />Fertig</button>
        </div>
      ) : !candidates.length ? (
        <p className="field-hint">Kein Zugang wartet auf eine Einladung: Mit allen hat sich schon jemand angemeldet. Neue Zugänge legst du unter „Kunden“ mit „Zugänge anlegen“ an.</p>
      ) : (
        <div className="import-preview">
          {!mailConfigured && <p className="field-warning" role="alert"><MailX size={18} aria-hidden="true" />Der Mailversand ist noch nicht eingerichtet. Ohne ihn geht keine Einladung raus.</p>}
          <div className="import-summary">
            <span className="import-count is-new">{candidates.filter((item) => !item.user.invitedAt).length} noch nie eingeladen</span>
            {candidates.some((item) => item.user.invitedAt) && <span className="import-count is-update">{candidates.filter((item) => item.user.invitedAt).length} schon eingeladen</span>}
            <button type="button" className="sheet-action import-show" onClick={() => setChosen(allChosen ? new Set() : new Set(candidates.map((item) => item.user.id)))} disabled={running}>{allChosen ? "Keine auswählen" : "Alle auswählen"}</button>
          </div>
          <div className="import-table-wrap">
            <table className="data-table import-table invite-table">
              <caption className="visually-hidden">Zugänge ohne Anmeldung mit Name, E-Mail-Adresse, Kunde und letzter Einladung</caption>
              <thead>
                <tr>
                  <th scope="col"><span className="visually-hidden">Einladen</span></th>
                  <th scope="col">Name</th>
                  <th scope="col">Kunde</th>
                  <th scope="col">Zuletzt eingeladen</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map(({ user, customer }) => (
                  <tr key={user.id} className={`data-row${chosen.has(user.id) ? "" : " is-muted"}`}>
                    <td className="cell-check"><input type="checkbox" checked={chosen.has(user.id)} disabled={running} onChange={() => toggle(user.id)} aria-label={`${user.email} einladen`} /></td>
                    <td className="import-company"><strong>{`${user.firstName} ${user.lastName}`.trim() || user.email}</strong><small>{user.email}</small></td>
                    <td className="import-city">{customer ? <>{customer.company} <small className="numeric">{customer.customerNumber}</small></> : <span className="cell-none">–</span>}</td>
                    <td className="import-what">{user.invitedAt ? <time dateTime={user.invitedAt} title={formatFileDateTime(user.invitedAt)}>{formatFileDate(user.invitedAt)}</time> : <span className="cell-none">noch nie</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="field-hint">Die E-Mails gehen sofort von der Adresse des Hubs raus, mit einem Link, der {days} Tage gilt. Wer sich noch nicht angemeldet hat, kann später erneut eingeladen werden.</p>
          {progress?.error && <p className="form-error" role="alert">{progress.error}</p>}
          <button type="button" className="sheet-button sheet-button-primary" disabled={!selected.length || running || !mailConfigured} onClick={run}>
            {running ? <><MiniLoader size={18} />Sende {progress?.done ?? 0} von {progress?.total ?? selected.length} …</> : <><Send size={18} aria-hidden="true" />{selected.length === 1 ? "1 Einladung senden" : `${selected.length} Einladungen senden`}</>}
          </button>
        </div>
      )}
    </Modal>
  );
}

function Failures({ items }: { items: { key: string; label: string; error: string }[] }) {
  if (!items.length) return null;
  return (
    <div className="field-warning" role="alert">
      <AlertTriangle size={18} aria-hidden="true" />
      <span><strong>{items.length === 1 ? "1 Eintrag nicht erledigt" : `${items.length} Einträge nicht erledigt`}</strong>
        <ul className="import-failures">{items.map((item) => <li key={item.key}>{item.label}: {item.error}</li>)}</ul>
      </span>
    </div>
  );
}
