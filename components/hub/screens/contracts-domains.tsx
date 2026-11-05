"use client";

import { useId, useState } from "react";
import { Check, Copy, ExternalLink, Globe, Mail, Minus, Pencil, Plus, Save, Server, Trash2 } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { formatDay } from "@/lib/hub-contracts/rules";
import type { ContractCustomer } from "@/lib/hub-contracts/types";
import { deleteDomain, deleteMailbox, saveDomain, saveMailbox, saveMailServer } from "@/lib/hub-domains/actions";
import {
  domainCheckIds, domainChecks, domainOwners, domainStatuses, domainStatusIds, mailboxKindIds, mailboxKinds, mailSecurities, MAX_NOTE, MAX_PERSON, MAX_PROVIDER,
  normalizeEmail, providerSuggestions, renewalPassed, type DomainCheck, type DomainOwner, type DomainStatus, type MailboxKind, type MailSecurity,
} from "@/lib/hub-domains/rules";
import type { CustomerDomain, DomainMailState, Mailbox, MailServer } from "@/lib/hub-domains/types";
import { GlassCard } from "../glass";
import { Modal } from "../modal";
import { useContractAction } from "./contracts-parts";

const Spinner = () => <MiniLoader size={16} />;
const hasMailPackage = (customer: ContractCustomer) => customer.packages.some((item) => item.packageId === "domain-mail");

/** Copies a value that is no secret (a server name, a port, a user name) and says so for a moment. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="row-action dm-copy"
      aria-label={`${label} kopieren`}
      title={copied ? "Kopiert" : `${label} kopieren`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch { /* clipboard blocked: the value stays readable */ }
      }}
    >
      {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
      <span className="visually-hidden" role="status">{copied ? "Kopiert" : ""}</span>
    </button>
  );
}

function ProviderList({ id }: { id: string }) {
  return <datalist id={id}>{providerSuggestions.map((name) => <option key={name} value={name} />)}</datalist>;
}

/* ---------- Admin: tab „Domain & Mail“ ---------- */

type Dialog = { kind: "domain"; entry?: CustomerDomain } | { kind: "mailbox"; entry?: Mailbox } | null;

/** The domains, the mail server and the addresses of one customer, for admins. Passwords live under „Zugänge“. */
export function DomainMailTab({ customer, domainMail, canManage, today, onNotice }: {
  customer: ContractCustomer;
  domainMail: DomainMailState;
  canManage: boolean;
  today: string;
  onNotice: (message: string) => void;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const domains = domainMail.domains.filter((item) => item.customerId === customer.id);
  const server = domainMail.mailServers.find((item) => item.customerId === customer.id) ?? null;
  const mailboxes = domainMail.mailboxes.filter((item) => item.customerId === customer.id);
  const withMail = hasMailPackage(customer);
  return (
    <div className="cdm-body">
      {domainMail.error && <p className="form-error" role="alert">{domainMail.error}</p>}
      {!domainMail.ready && !domainMail.error && <p className="cdm-empty">Domains und Mail sind in der Datenbank noch nicht eingerichtet. Die Migration steht noch aus; bis dahin lässt sich nichts speichern.</p>}

      <section className="cdm-section" aria-labelledby="dm-domains">
        <div className="dm-section-head">
          <h3 id="dm-domains"><Globe size={16} aria-hidden="true" />Domains</h3>
          {canManage && <button type="button" className="sheet-action" onClick={() => setDialog({ kind: "domain" })}><Plus size={15} aria-hidden="true" />Domain</button>}
        </div>
        {domains.length ? (
          <ul className="dm-list">
            {domains.map((domain) => <DomainItem key={domain.id} domain={domain} today={today} onEdit={canManage ? () => setDialog({ kind: "domain", entry: domain }) : undefined} />)}
          </ul>
        ) : <p className="cdm-empty">Noch keine Domain eingetragen.</p>}
      </section>

      <section className="cdm-section" aria-labelledby="dm-server">
        <div className="dm-section-head"><h3 id="dm-server"><Server size={16} aria-hidden="true" />Mail-Server</h3></div>
        {withMail
          ? <MailServerForm key={`${customer.id}-${JSON.stringify(server)}`} customerId={customer.id} server={server} canManage={canManage} onSaved={onNotice} />
          : <p className="cdm-empty">Einen Mail-Server gibt es nur mit dem Paket OALAB Domain & Mail; festlegen lässt es sich im Reiter „Vertrag“.{server ? " Die gespeicherten Angaben bleiben, der Kunde sieht sie aber erst wieder mit diesem Paket." : ""}</p>}
      </section>

      <section className="cdm-section" aria-labelledby="dm-mailboxes">
        <div className="dm-section-head">
          <h3 id="dm-mailboxes"><Mail size={16} aria-hidden="true" />E-Mail-Adressen</h3>
          {canManage && <button type="button" className="sheet-action" onClick={() => setDialog({ kind: "mailbox" })}><Plus size={15} aria-hidden="true" />Adresse</button>}
        </div>
        {mailboxes.length ? (
          <ul className="dm-list">
            {mailboxes.map((mailbox) => (
              <li key={mailbox.id} className="dm-item">
                <div className="dm-item-main">
                  <div className="dm-item-top"><strong>{mailbox.address}</strong><span className={`chat-pill ${mailbox.kind === "mailbox" ? "tone-info" : "tone-off"}`}>{mailboxKinds[mailbox.kind].label}</span></div>
                  <p className="dm-item-sub">{mailbox.kind === "mailbox" ? (mailbox.person || "Ohne Person") : `${mailboxKinds[mailbox.kind].target} ${mailbox.target}`}{mailbox.kind !== "mailbox" && mailbox.person ? ` · ${mailbox.person}` : ""}</p>
                </div>
                {canManage && <button type="button" className="row-action" onClick={() => setDialog({ kind: "mailbox", entry: mailbox })} aria-label={`${mailbox.address} bearbeiten`} title="Bearbeiten"><Pencil size={16} aria-hidden="true" /></button>}
              </li>
            ))}
          </ul>
        ) : <p className="cdm-empty">Noch keine Postfächer, Weiterleitungen oder Aliase.</p>}
        <p className="field-hint">Die Passwörter der Postfächer liegen verschlüsselt unter „Zugänge“.</p>
      </section>

      {dialog?.kind === "domain" && <DomainDialog customer={customer} entry={dialog.entry} onClose={() => setDialog(null)} onSaved={onNotice} />}
      {dialog?.kind === "mailbox" && <MailboxDialog customer={customer} entry={dialog.entry} domains={domains} onClose={() => setDialog(null)} onSaved={onNotice} />}
    </div>
  );
}

function DomainItem({ domain, today, onEdit }: { domain: CustomerDomain; today: string; onEdit?: () => void }) {
  const details = domain.details;
  if (!details) return null;
  const status = domainStatuses[details.status];
  return (
    <li className="dm-item">
      <div className="dm-item-main">
        <div className="dm-item-top">
          <strong>{domain.display}</strong>
          <span className={`chat-pill tone-${status.tone}`}>{status.label}</span>
          {renewalPassed(details, today) && <span className="chat-pill tone-todo" title="Das Datum der Verlängerung liegt in der Vergangenheit.">Verlängerung prüfen</span>}
        </div>
        {domain.display !== domain.domain && <p className="dm-item-sub">{domain.domain}</p>}
        <dl className="dm-facts">
          <div><dt>Registriert bei</dt><dd>{details.registrar || "–"}</dd></div>
          <div><dt>DNS bei</dt><dd>{details.dnsProvider || "–"}</dd></div>
          <div><dt>Website läuft bei</dt><dd>{details.websiteHost || "–"}</dd></div>
          <div><dt>Inhaber</dt><dd>{domainOwners[details.owner]}</dd></div>
          <div><dt>Verlängerung am</dt><dd className="numeric">{details.renewsOn ? formatDay(details.renewsOn) : "–"}</dd></div>
        </dl>
        <ul className="dm-checks" aria-label="Einträge und Prüfungen">
          {domainCheckIds.map((id) => (
            <li key={id} className={details.checks[id] ? "is-ok" : undefined} title={domainChecks[id].hint}>
              {details.checks[id] ? <Check size={13} aria-hidden="true" /> : <Minus size={13} aria-hidden="true" />}
              {domainChecks[id].label}
              <span className="visually-hidden">{details.checks[id] ? ": erledigt" : ": offen"}</span>
            </li>
          ))}
        </ul>
        {details.note && <p className="cdm-note">{details.note}</p>}
      </div>
      {onEdit && <button type="button" className="row-action" onClick={onEdit} aria-label={`${domain.display} bearbeiten`} title="Bearbeiten"><Pencil size={16} aria-hidden="true" /></button>}
    </li>
  );
}

const noChecks: Record<DomainCheck, boolean> = { website: false, ssl: false, mx: false, spf: false, dkim: false, dmarc: false };

/** Enters a domain or edits one: name, status, owner, where it lives, renewal, the six checks and an internal note. */
function DomainDialog({ customer, entry, onClose, onSaved }: { customer: ContractCustomer; entry?: CustomerDomain; onClose: () => void; onSaved: (message: string) => void }) {
  const details = entry?.details;
  const [draft, setDraft] = useState({
    domain: entry?.display ?? "",
    status: details?.status ?? ("active" as DomainStatus),
    owner: details?.owner ?? ("customer" as DomainOwner),
    registrar: details?.registrar ?? "",
    dnsProvider: details?.dnsProvider ?? "",
    websiteHost: details?.websiteHost ?? "",
    renewsOn: details?.renewsOn ?? "",
    checks: details?.checks ?? noChecks,
    note: details?.note ?? "",
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { busy, error, run } = useContractAction();
  const listId = useId();
  const disabled = busy !== null;
  const set = (key: "domain" | "status" | "owner" | "registrar" | "dnsProvider" | "websiteHost" | "renewsOn" | "note") =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setDraft({ ...draft, [key]: event.target.value });
  return (
    <Modal title={entry ? "Domain bearbeiten" : "Domain eintragen"} onClose={onClose} className="users-modal">
      <form className="cdm-dialog" onSubmit={(event) => {
        event.preventDefault();
        run("save", () => saveDomain({ ...draft, id: entry?.id, customerId: customer.id }), () => { onSaved(entry ? "Domain gespeichert." : "Domain eingetragen."); onClose(); });
      }}>
        <p className="field-hint">{customer.company} · {customer.customerNumber}</p>
        <ProviderList id={listId} />
        <div className="upload-fields">
          <label className="upload-field upload-field-wide"><span>Domain</span><input value={draft.domain} onChange={set("domain")} required placeholder="kunde.de" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url" maxLength={260} disabled={disabled} /></label>
          <label className="upload-field"><span>Status</span><select value={draft.status} onChange={set("status")} disabled={disabled}>{domainStatusIds.map((id) => <option key={id} value={id}>{domainStatuses[id].label}</option>)}</select></label>
          <label className="upload-field"><span>Inhaber</span><select value={draft.owner} onChange={set("owner")} disabled={disabled}>{(Object.keys(domainOwners) as DomainOwner[]).map((id) => <option key={id} value={id}>{domainOwners[id]}</option>)}</select></label>
          <label className="upload-field"><span>Registriert bei</span><input value={draft.registrar} onChange={set("registrar")} list={listId} maxLength={MAX_PROVIDER} placeholder="z. B. netcup" disabled={disabled} /></label>
          <label className="upload-field"><span>DNS bei</span><input value={draft.dnsProvider} onChange={set("dnsProvider")} list={listId} maxLength={MAX_PROVIDER} placeholder="z. B. Cloudflare" disabled={disabled} /></label>
          <label className="upload-field"><span>Website läuft bei</span><input value={draft.websiteHost} onChange={set("websiteHost")} list={listId} maxLength={MAX_PROVIDER} placeholder="z. B. Vercel" disabled={disabled} /></label>
          <label className="upload-field"><span>Verlängerung am</span><input type="date" value={draft.renewsOn} onChange={set("renewsOn")} disabled={disabled} /></label>
        </div>
        <fieldset className="dm-check-fields" disabled={disabled}>
          <legend>Eingetragen und geprüft</legend>
          {domainCheckIds.map((id) => (
            <label key={id} className="dm-check-field">
              <input type="checkbox" checked={draft.checks[id]} onChange={(event) => setDraft({ ...draft, checks: { ...draft.checks, [id]: event.target.checked } })} />
              <span><strong>{domainChecks[id].label}</strong><small>{domainChecks[id].hint}</small></span>
            </label>
          ))}
        </fieldset>
        <label className="upload-field"><span>Notiz (nur für das oalab-Team)</span><textarea value={draft.note} onChange={set("note")} maxLength={MAX_NOTE} rows={3} disabled={disabled} /></label>
        <p className="field-hint">Der Kunde sieht nur den Namen der Domain, solange sie nicht beendet ist. Anbieter, Fristen, Häkchen und Notiz bleiben intern.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="sheet-button sheet-button-primary" disabled={disabled}>{busy === "save" ? <Spinner /> : <Save size={18} aria-hidden="true" />}{entry ? "Änderungen speichern" : "Eintragen"}</button>
        {entry && (confirmDelete
          ? <button type="button" className="sheet-button sheet-button-danger" disabled={disabled} onClick={() => run("delete", () => deleteDomain({ id: entry.id }), () => { onSaved("Domain gelöscht."); onClose(); })}>{busy === "delete" ? <Spinner /> : <Trash2 size={18} aria-hidden="true" />}Wirklich löschen</button>
          : <button type="button" className="sheet-button" disabled={disabled} onClick={() => setConfirmDelete(true)}><Trash2 size={18} aria-hidden="true" />Löschen</button>)}
      </form>
    </Modal>
  );
}

type ServerDraft = { provider: string; imapHost: string; imapPort: string; imapSecurity: MailSecurity; smtpHost: string; smtpPort: string; smtpSecurity: MailSecurity; webmailUrl: string };

const serverDraft = (server: MailServer | null): ServerDraft => ({
  provider: server?.provider ?? "",
  imapHost: server?.imapHost ?? "",
  imapPort: String(server?.imapPort ?? mailSecurities[server?.imapSecurity ?? "ssl"].ports.imap),
  imapSecurity: server?.imapSecurity ?? "ssl",
  smtpHost: server?.smtpHost ?? "",
  smtpPort: String(server?.smtpPort ?? mailSecurities[server?.smtpSecurity ?? "ssl"].ports.smtp),
  smtpSecurity: server?.smtpSecurity ?? "ssl",
  webmailUrl: server?.webmailUrl ?? "",
});

/** Incoming and outgoing server with port and encryption, webmail and the provider (internal). */
function MailServerForm({ customerId, server, canManage, onSaved }: { customerId: string; server: MailServer | null; canManage: boolean; onSaved: (message: string) => void }) {
  const [saved, setSaved] = useState(() => serverDraft(server));
  const [draft, setDraft] = useState(saved);
  const { busy, error, run } = useContractAction();
  const listId = useId();
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (key: keyof ServerDraft) => (event: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [key]: event.target.value });
  // Switching the encryption takes the usual port along, unless a port of its own was typed.
  const setSecurity = (side: "imap" | "smtp") => (event: React.ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value as MailSecurity;
    const port = draft[`${side}Port`];
    const usual = Object.values(mailSecurities).some((item) => String(item.ports[side]) === port) || port === "";
    setDraft({ ...draft, [`${side}Security`]: next, [`${side}Port`]: usual ? String(mailSecurities[next].ports[side]) : port });
  };
  return (
    <form className="cdm-packages" onSubmit={(event) => {
      event.preventDefault();
      run("save", () => saveMailServer({ ...draft, customerId }), () => { setSaved(draft); onSaved("Mail-Server gespeichert."); });
    }}>
      <ProviderList id={listId} />
      <fieldset className="dm-server" disabled={!canManage || busy !== null}>
        <legend className="visually-hidden">Mail-Server</legend>
        <label className="upload-field dm-server-wide"><span>Anbieter (nur für das oalab-Team)</span><input value={draft.provider} onChange={set("provider")} list={listId} maxLength={MAX_PROVIDER} placeholder="z. B. netcup" /></label>
        {(["imap", "smtp"] as const).map((side) => (
          <div key={side} className="dm-server-side">
            <p className="dm-server-title">{side === "imap" ? "Posteingang (IMAP)" : "Postausgang (SMTP)"}</p>
            <label className="upload-field"><span>Server</span><input value={draft[`${side}Host`]} onChange={set(`${side}Host`)} placeholder="mail.kunde.de" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={253} /></label>
            <div className="dm-server-row">
              <label className="upload-field"><span>Port</span><input value={draft[`${side}Port`]} onChange={set(`${side}Port`)} inputMode="numeric" pattern="[0-9]*" maxLength={5} /></label>
              <label className="upload-field"><span>Verschlüsselung</span>
                <select value={draft[`${side}Security`]} onChange={setSecurity(side)}>{(Object.keys(mailSecurities) as MailSecurity[]).map((id) => <option key={id} value={id}>{mailSecurities[id].label}</option>)}</select>
              </label>
            </div>
          </div>
        ))}
        <label className="upload-field dm-server-wide"><span>Webmail-Adresse</span><input value={draft.webmailUrl} onChange={set("webmailUrl")} placeholder="https://webmail.kunde.de" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url" maxLength={300} /></label>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      {canManage && (
        <div className="cdm-form-foot">
          <p className="field-hint">Der Kunde sieht Server, Ports, Verschlüsselung und Webmail unter „Vertrag & Domain“, den Anbieter nicht.</p>
          <button type="submit" className="sheet-action is-primary" disabled={!changed || busy !== null}>{busy ? <Spinner /> : <Save size={15} aria-hidden="true" />}Mail-Server speichern</button>
        </div>
      )}
    </form>
  );
}

/** Enters a mailbox, forward or alias or edits one. */
function MailboxDialog({ customer, entry, domains, onClose, onSaved }: { customer: ContractCustomer; entry?: Mailbox; domains: readonly CustomerDomain[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [draft, setDraft] = useState({ address: entry?.address ?? "", kind: entry?.kind ?? ("mailbox" as MailboxKind), person: entry?.person ?? "", target: entry?.target ?? "" });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { busy, error, run } = useContractAction();
  const kindName = useId();
  const disabled = busy !== null;
  const set = (key: "address" | "person" | "target") => (event: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [key]: event.target.value });
  const address = normalizeEmail(draft.address);
  const foreign = address && domains.length > 0 && !domains.some((domain) => address.endsWith(`@${domain.domain}`));
  const keepsPassword = Boolean(entry?.hasPassword && draft.kind !== "mailbox");
  return (
    <Modal title={entry ? "E-Mail-Adresse bearbeiten" : "E-Mail-Adresse eintragen"} onClose={onClose} className="users-modal">
      <form className="cdm-dialog" onSubmit={(event) => {
        event.preventDefault();
        run("save", () => saveMailbox({ ...draft, id: entry?.id, customerId: customer.id }), () => { onSaved(entry ? "E-Mail-Adresse gespeichert." : "E-Mail-Adresse eingetragen."); onClose(); });
      }}>
        <p className="field-hint">{customer.company} · {customer.customerNumber}</p>
        <label className="upload-field"><span>Adresse</span><input value={draft.address} onChange={set("address")} required placeholder="info@kunde.de" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email" autoComplete="off" maxLength={254} disabled={disabled} /></label>
        {foreign && <p className="field-hint">Die Domain dieser Adresse ist bei {customer.company} nicht eingetragen.</p>}
        <fieldset className="dm-kinds" disabled={disabled}>
          <legend>Art</legend>
          {mailboxKindIds.map((id) => (
            <label key={id} className="cdm-option">
              <input type="radio" name={kindName} checked={draft.kind === id} onChange={() => setDraft({ ...draft, kind: id })} />
              <span><strong>{mailboxKinds[id].label}</strong><small>{id === "mailbox" ? "Eigenes Postfach mit Passwort" : id === "forward" ? "Leitet an eine oder mehrere Adressen weiter" : "Zweite Adresse für ein Postfach"}</small></span>
            </label>
          ))}
        </fieldset>
        {draft.kind !== "mailbox" && (
          <label className="upload-field"><span>{mailboxKinds[draft.kind].target}</span>
            <input value={draft.target} onChange={set("target")} required placeholder={draft.kind === "forward" ? "info@kunde.de, jana@kunde.de" : "info@kunde.de"} autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email" autoComplete="off" maxLength={1000} disabled={disabled} />
          </label>
        )}
        {draft.kind === "forward" && <p className="field-hint">Mehrere Ziele mit Komma trennen.</p>}
        <label className="upload-field"><span>Person (optional)</span><input value={draft.person} onChange={set("person")} maxLength={MAX_PERSON} placeholder="z. B. Jana Sommer" autoComplete="off" disabled={disabled} /></label>
        {keepsPassword && <p className="form-error" role="status">Dieses Postfach hat ein Passwort. Entferne es zuerst unter „Zugänge“, dann wird daraus eine Weiterleitung oder ein Alias.</p>}
        <p className="field-hint">Der Kunde sieht Adresse, Art, Ziel und Person unter „Vertrag & Domain“.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="sheet-button sheet-button-primary" disabled={disabled || keepsPassword}>{busy === "save" ? <Spinner /> : <Save size={18} aria-hidden="true" />}{entry ? "Änderungen speichern" : "Eintragen"}</button>
        {entry && (confirmDelete
          ? <button type="button" className="sheet-button sheet-button-danger" disabled={disabled} onClick={() => run("delete", () => deleteMailbox({ id: entry.id }), () => { onSaved(entry.hasPassword ? "E-Mail-Adresse samt Passwort gelöscht." : "E-Mail-Adresse gelöscht."); onClose(); })}>{busy === "delete" ? <Spinner /> : <Trash2 size={18} aria-hidden="true" />}{entry.hasPassword ? "Wirklich löschen, mit Passwort" : "Wirklich löschen"}</button>
          : <button type="button" className="sheet-button" disabled={disabled} onClick={() => setConfirmDelete(true)}><Trash2 size={18} aria-hidden="true" />Löschen</button>)}
      </form>
    </Modal>
  );
}

/* ---------- Customers: card „Domain & E-Mail“ ---------- */

function Setting({ label, value, copy }: { label: string; value: string; copy?: boolean }) {
  return (
    <div className="dm-setting">
      <dt>{label}</dt>
      <dd><span className={copy ? "dm-mono" : undefined}>{value}</span>{copy && <CopyButton value={value} label={label} />}</dd>
    </div>
  );
}

/**
 * What a customer sees of its domains and mail: the running domain names, its addresses and, with OALAB Domain & Mail,
 * the settings for a mail program. Never passwords, providers, deadlines or notes. Nothing at all while there is nothing.
 */
export function CustomerDomainCard({ customer, domainMail }: { customer: ContractCustomer; domainMail: DomainMailState }) {
  const domains = domainMail.domains.filter((item) => item.customerId === customer.id);
  const mailboxes = domainMail.mailboxes.filter((item) => item.customerId === customer.id);
  const server = domainMail.mailServers.find((item) => item.customerId === customer.id && (item.imapHost || item.smtpHost || item.webmailUrl)) ?? null;
  if (!domains.length && !mailboxes.length && !server) return null;
  return (
    <GlassCard className="settings-card">
      <h2 className="t-headline settings-card-title"><Globe size={20} color="var(--cat-contracts-text)" aria-hidden="true" />Domain & E-Mail</h2>
      {domains.length > 0 && (
        <div className="dm-block">
          <h3>Domains</h3>
          <ul className="dm-plain">{domains.map((domain) => <li key={domain.id}><strong>{domain.display}</strong></li>)}</ul>
        </div>
      )}
      {mailboxes.length > 0 && (
        <div className="dm-block">
          <h3>E-Mail-Adressen</h3>
          <ul className="dm-plain">
            {mailboxes.map((mailbox) => (
              <li key={mailbox.id}>
                <strong>{mailbox.address}</strong>
                <small>{mailbox.kind === "mailbox" ? [mailboxKinds.mailbox.label, mailbox.person].filter(Boolean).join(" · ") : `${mailboxKinds[mailbox.kind].target} ${mailbox.target}`}</small>
              </li>
            ))}
          </ul>
        </div>
      )}
      {server && (
        <div className="dm-block">
          <h3>Für dein Mailprogramm</h3>
          {(["imap", "smtp"] as const).filter((side) => server[`${side}Host`]).map((side) => (
            <div key={side} className="dm-settings">
              <p className="dm-settings-title">{side === "imap" ? "Posteingang (IMAP)" : "Postausgang (SMTP)"}</p>
              <dl>
                <Setting label="Server" value={server[`${side}Host`]} copy />
                {server[`${side}Port`] !== null && <Setting label="Port" value={String(server[`${side}Port`])} copy />}
                <Setting label="Verschlüsselung" value={mailSecurities[server[`${side}Security`]].label} />
              </dl>
            </div>
          ))}
          <p className="t-footnote t-secondary">Benutzername ist jeweils deine vollständige E-Mail-Adresse. Passwörter zeigt der Hub aus Sicherheitsgründen nicht an; brauchst du ein neues, hilft dir dein oalab-Team.</p>
          {server.webmailUrl && <a className="sheet-action dm-webmail" href={server.webmailUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} aria-hidden="true" />Webmail öffnen<span className="visually-hidden"> (öffnet in neuem Tab)</span></a>}
        </div>
      )}
    </GlassCard>
  );
}
