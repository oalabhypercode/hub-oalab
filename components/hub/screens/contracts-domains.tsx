"use client";

import { useId, useState } from "react";
import { ArrowUpRight, AtSign, Check, Copy, Forward, Globe, Inbox, Mail, Pencil, Plus, Save, Send, Server, StickyNote, Trash2, type LucideIcon } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { formatDay } from "@/lib/hub-contracts/rules";
import type { ContractCustomer } from "@/lib/hub-contracts/types";
import { deleteDomain, deleteMailbox, deleteMailServer, saveDomain, saveMailbox, saveMailServer } from "@/lib/hub-domains/actions";
import {
  domainCheckIds, domainChecks, domainOwners, domainStatuses, domainStatusIds, mailboxKindIds, mailboxKinds, mailSecurities, MAX_NOTE, MAX_PERSON, MAX_PROVIDER,
  normalizeEmail, providerSuggestions, renewalPassed, type DomainCheck, type DomainOwner, type DomainStatus, type MailboxKind, type MailSecurity,
} from "@/lib/hub-domains/rules";
import type { CustomerDomain, DomainMailState, Mailbox, MailServer } from "@/lib/hub-domains/types";
import { useInfo } from "../info-box";
import { Modal } from "../modal";
import { Select, SuggestInput } from "../select";
import { toneDot } from "../select-options";
import { SheetFooter, StatusGlyph, TableGroup, useCollapsedGroups, type GlyphKind } from "../sheet";
import { ADMIN_COLUMNS, tableHit, useContractAction } from "./contracts-parts";

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
      data-tip={copied ? "Kopiert" : `${label} kopieren`}
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

/* ---------- Admin: tab „Domain & Mail“ ---------- */

type Dialog = { kind: "domain"; entry?: CustomerDomain } | { kind: "mailbox"; entry?: Mailbox } | { kind: "server" } | null;

const kindIcons: Record<MailboxKind, LucideIcon> = { mailbox: Inbox, forward: Forward, alias: AtSign };
const daysUntil = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const statusGlyphs: Record<DomainStatus, GlyphKind> = { active: "active", setup: "progress", transfer: "progress", cancelled: "pending", ended: "rejected" };

/**
 * The domains, the mail server and the addresses of one customer, for admins, as one table in groups. The server is
 * changed in a dialog behind the pencil; passwords live under „Zugangsdaten“.
 */
export function DomainMailTab({ customer, domainMail, canManage, today, query, onNotice }: {
  customer: ContractCustomer;
  domainMail: DomainMailState;
  canManage: boolean;
  today: string;
  query: string;
  onNotice: (message: string) => void;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const groups = useCollapsedGroups();
  const term = query.trim().toLocaleLowerCase("de");
  const domains = domainMail.domains.filter((item) => item.customerId === customer.id);
  const server = domainMail.mailServers.find((item) => item.customerId === customer.id) ?? null;
  const mailboxes = domainMail.mailboxes.filter((item) => item.customerId === customer.id);
  const withMail = hasMailPackage(customer);
  const serverInfo = useInfo("Mail-Server", {
    steps: [
      <><b>Nur mit dem Paket</b> Domain & Mail.</>,
      <><b>Verschlüsselung</b> wählen, der Port folgt von selbst.</>,
      <><b>Der Kunde sieht</b> Server und Ports, nie Passwörter.</>,
    ],
    ask: "Wie richte ich den Mail-Server eines Kunden ein?",
  });
  const shownDomains = domains.filter((domain) => tableHit(term, domain.display, domain.domain, domain.details?.registrar, domain.details?.dnsProvider, domain.details?.websiteHost, domain.details?.note));
  const shownMailboxes = mailboxes.filter((mailbox) => tableHit(term, mailbox.display, mailbox.person, mailbox.targetDisplay, mailboxKinds[mailbox.kind].label));
  const serverRows = server ? [
    ...(["imap", "smtp"] as const).filter((side) => server[`${side}Host`]).map((side) => ({
      key: side, icon: side === "imap" ? Inbox : Send, title: side === "imap" ? "Posteingang" : "Postausgang", sub: server[`${side}Host`], kind: side.toUpperCase(),
      detail: `${server[`${side}Port`] ?? "–"} · ${mailSecurities[server[`${side}Security`]].label}`,
      action: <CopyButton value={server[`${side}Host`]} label={side === "imap" ? "Server Posteingang" : "Server Postausgang"} />,
    })),
    ...(server.webmailUrl ? [{
      key: "webmail", icon: Globe, title: "Webmail", sub: server.webmailUrl.replace(/^https?:\/\//, "").replace(/\/$/, ""), kind: "Browser", detail: "",
      action: <a className="am-icon-btn is-accent" href={server.webmailUrl} target="_blank" rel="noopener noreferrer" aria-label="Webmail öffnen (neuer Tab)" data-tip="Webmail öffnen"><ArrowUpRight size={16} aria-hidden="true" /></a>,
    }] : []),
    ...(server.provider ? [{ key: "provider", icon: Server, title: "Anbieter", sub: server.provider, kind: "intern", detail: "", action: null }] : []),
  ].filter((row) => tableHit(term, row.title, row.sub)) : [];

  return (
    <>
      {domainMail.error && <p className="form-error cdm-tab-error" role="alert">{domainMail.error}</p>}
      {!domainMail.ready && !domainMail.error && <p className="cdm-tab-note">Domains und Mail sind in der Datenbank noch nicht eingerichtet. Die Migration steht noch aus; bis dahin lässt sich nichts speichern.</p>}
      <div className="am-scroll">
        <table className="file-table cdm-table cdm-admin-table">
          <caption className="visually-hidden">Domains, Mail-Server und E-Mail-Adressen von {customer.company}</caption>
          <TableGroup
            colSpan={ADMIN_COLUMNS}
            label="Domains"
            count={shownDomains.length}
            glyph={<Globe size={16} aria-hidden="true" />}
            collapsed={groups.isCollapsed("domains")}
            onToggle={() => groups.toggle("domains")}
            actions={canManage && <button type="button" className="table-group-action is-accent" onClick={() => setDialog({ kind: "domain" })} data-tip="Domain eintragen" aria-label="Domain eintragen"><Plus size={15} aria-hidden="true" /></button>}
            empty={term ? "Keine Domain passt zur Suche." : "Noch keine Domain eingetragen."}
          >
            {shownDomains.map((domain) => <DomainRow key={domain.id} domain={domain} today={today} onEdit={canManage ? () => setDialog({ kind: "domain", entry: domain }) : undefined} />)}
          </TableGroup>
          <TableGroup
            colSpan={ADMIN_COLUMNS}
            label="Mail-Server"
            count={serverRows.length}
            glyph={<Server size={16} aria-hidden="true" />}
            collapsed={groups.isCollapsed("server")}
            onToggle={() => groups.toggle("server")}
            actions={<>{serverInfo.button}{canManage && (withMail || server) && <button type="button" className="table-group-action" onClick={() => setDialog({ kind: "server" })} data-tip={server ? "Mail-Server bearbeiten" : "Mail-Server eintragen"} aria-label={server ? "Mail-Server bearbeiten" : "Mail-Server eintragen"}>{server ? <Pencil size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}</button>}</>}
            empty={withMail ? "Noch kein Mail-Server eingetragen." : "Einen Mail-Server gibt es nur mit dem Paket OALAB Domain & Mail; festlegen lässt es sich im Reiter „Vertrag“."}
          >
            {serverRows.map((row) => (
              <tr key={row.key} className="file-row">
                <td className="cell-file"><span className="am-file"><span className="am-file-icon cdm-file-icon"><row.icon size={16} aria-hidden="true" /></span><span className="am-file-text"><strong>{row.title}</strong><small className={row.key === "provider" ? undefined : "dm-mono"}>{row.sub}</small></span></span></td>
                <td className="cell-category"><span className={`file-dot cdm-dot-${row.key === "provider" ? "off" : "mailbox"}`}><i aria-hidden="true" />{row.kind}</span></td>
                <td className="cell-date numeric">{row.detail}</td>
                <td className="cell-action">{row.action}</td>
              </tr>
            ))}
            {server && !withMail && <tr className="table-empty-row"><td colSpan={ADMIN_COLUMNS}>Ohne das Paket OALAB Domain & Mail sieht der Kunde diese Angaben nicht; sie bleiben gespeichert.</td></tr>}
          </TableGroup>
          <TableGroup
            colSpan={ADMIN_COLUMNS}
            label="E-Mail-Adressen"
            count={shownMailboxes.length}
            glyph={<Mail size={16} aria-hidden="true" />}
            collapsed={groups.isCollapsed("addresses")}
            onToggle={() => groups.toggle("addresses")}
            actions={canManage && <button type="button" className="table-group-action is-accent" onClick={() => setDialog({ kind: "mailbox" })} data-tip="Adresse eintragen" aria-label="Adresse eintragen"><Plus size={15} aria-hidden="true" /></button>}
            empty={term ? "Keine Adresse passt zur Suche." : "Noch keine Postfächer, Weiterleitungen oder Aliase."}
          >
            {shownMailboxes.map((mailbox) => {
              const Icon = kindIcons[mailbox.kind];
              return (
                <tr key={mailbox.id} className="file-row">
                  <td className="cell-file"><span className="am-file"><span className="am-file-icon cdm-file-icon"><Icon size={16} aria-hidden="true" /></span><span className="am-file-text"><strong>{mailbox.display}</strong><small>{mailbox.kind === "mailbox" ? (mailbox.person || "Ohne Person") : `${mailboxKinds[mailbox.kind].target} ${mailbox.targetDisplay}${mailbox.person ? ` · ${mailbox.person}` : ""}`}</small></span></span></td>
                  <td className="cell-category"><span className={`file-dot cdm-dot-${mailbox.kind}`}><i aria-hidden="true" />{mailboxKinds[mailbox.kind].label}</span></td>
                  <td className="cell-date">{mailbox.kind === "mailbox" && <span className="status-cell"><StatusGlyph kind={mailbox.hasPassword ? "active" : "invited"} />{mailbox.hasPassword ? "Passwort hinterlegt" : "kein Passwort"}</span>}</td>
                  <td className="cell-action">{canManage && <button type="button" className="am-icon-btn" onClick={() => setDialog({ kind: "mailbox", entry: mailbox })} aria-label={`${mailbox.display} bearbeiten`} data-tip="Bearbeiten"><Pencil size={16} aria-hidden="true" /></button>}</td>
                </tr>
              );
            })}
          </TableGroup>
        </table>
        {serverInfo.box}
      </div>
      <SheetFooter hint="Passwörter der Postfächer liegen unter „Zugangsdaten“">
        {[domains.length === 1 ? "1 Domain" : `${domains.length} Domains`, server ? "Mail-Server eingetragen" : "kein Mail-Server", mailboxes.length === 1 ? "1 Adresse" : `${mailboxes.length} Adressen`].join(" · ")}
      </SheetFooter>
      {dialog?.kind === "domain" && <DomainDialog customer={customer} entry={dialog.entry} onClose={() => setDialog(null)} onSaved={onNotice} />}
      {dialog?.kind === "mailbox" && <MailboxDialog customer={customer} entry={dialog.entry} domains={domains} onClose={() => setDialog(null)} onSaved={onNotice} />}
      {dialog?.kind === "server" && (
        <Modal title={server ? "Mail-Server bearbeiten" : "Mail-Server eintragen"} onClose={() => setDialog(null)} className="users-modal">
          <MailServerForm customerId={customer.id} server={server} canManage={canManage} onSaved={(message) => { onNotice(message); setDialog(null); }} />
        </Modal>
      )}
    </>
  );
}

/** One domain: where it lives, its status, the renewal day and its six checks as dots. */
function DomainRow({ domain, today, onEdit }: { domain: CustomerDomain; today: string; onEdit?: () => void }) {
  const details = domain.details;
  if (!details) return null;
  const done = domainCheckIds.filter((id) => details.checks[id]).length;
  const passed = renewalPassed(details, today);
  const days = details.renewsOn ? daysUntil(today, details.renewsOn) : null;
  const where = [details.registrar, details.dnsProvider, details.websiteHost].map((value) => value || "–").join(" · ");
  return (
    <tr className="file-row">
      <td className="cell-file">
        <span className="am-file" data-tip={[domain.display !== domain.domain ? domain.domain : "", details.note].filter(Boolean).join("\n") || undefined}>
          <span className="am-file-icon cdm-file-icon is-domain"><Globe size={16} aria-hidden="true" /></span>
          <span className="am-file-text">
            <strong>{domain.display}{details.note && <StickyNote size={13} className="cdm-note-mark" aria-label="Mit Notiz" />}</strong>
            <small>{where}{details.owner === "oalab" ? ` · gehört ${domainOwners.oalab}` : ""}</small>
          </span>
        </span>
      </td>
      <td className="cell-category"><span className="status-cell"><StatusGlyph kind={statusGlyphs[details.status]} />{domainStatuses[details.status].label}</span></td>
      <td className="cell-date numeric">
        {details.renewsOn && <time dateTime={details.renewsOn}>{formatDay(details.renewsOn)}</time>}
        {passed ? <small className="is-overdue">prüfen</small> : days !== null && days >= 0 && days <= 60 ? <small>in {days} {days === 1 ? "Tag" : "Tagen"}</small> : null}
      </td>
      <td className="cell-action">
        <span className="cdm-checks" aria-label={`${done} von ${domainCheckIds.length} Prüfungen erledigt`} data-tip={domainCheckIds.map((id) => `${domainChecks[id].label}: ${details.checks[id] ? "erledigt" : "offen"}`).join("\n")}>
          {domainCheckIds.map((id) => <i key={id} className={details.checks[id] ? "is-ok" : undefined} aria-hidden="true" />)}
          <b className="numeric" aria-hidden="true">{done}/{domainCheckIds.length}</b>
        </span>
        {onEdit && <button type="button" className="am-icon-btn" onClick={onEdit} aria-label={`${domain.display} bearbeiten`} data-tip="Bearbeiten"><Pencil size={16} aria-hidden="true" /></button>}
      </td>
    </tr>
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
  const info = useInfo("Domains", {
    steps: [
      <><b>Sechs Häkchen</b> setzt du nach der Prüfung selbst.</>,
      <><b>Verlängerung</b> in 60 Tagen steht unter „Demnächst“.</>,
      <><b>Logins</b> der Anbieter gehören unter „Zugangsdaten“.</>,
    ],
    ask: "Wie trage ich eine Domain ein?",
  });
  const disabled = busy !== null;
  const set = (key: "domain" | "status" | "owner" | "registrar" | "dnsProvider" | "websiteHost" | "renewsOn" | "note") =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setDraft({ ...draft, [key]: event.target.value });
  return (
    <Modal title={entry ? "Domain bearbeiten" : "Domain eintragen"} onClose={onClose} className="users-modal" actions={info.button}>
      {info.box}
      <form className="cdm-dialog" onSubmit={(event) => {
        event.preventDefault();
        run("save", () => saveDomain({ ...draft, id: entry?.id, customerId: customer.id }), () => { onSaved(entry ? "Domain gespeichert." : "Domain eingetragen."); onClose(); });
      }}>
        <p className="field-hint">{customer.company} · {customer.customerNumber}</p>
        <div className="upload-fields">
          <label className="upload-field upload-field-wide"><span>Domain</span><input value={draft.domain} onChange={set("domain")} required placeholder="kunde.de" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url" maxLength={260} disabled={disabled} /></label>
          <label className="upload-field"><span>Status</span><Select label="Status" value={draft.status} onChange={(status) => setDraft({ ...draft, status: status as DomainStatus })} disabled={disabled} options={domainStatusIds.map((id) => ({ value: id, label: domainStatuses[id].label, lead: toneDot(domainStatuses[id].tone) }))} /></label>
          <label className="upload-field"><span>Inhaber</span><Select label="Inhaber" value={draft.owner} onChange={(owner) => setDraft({ ...draft, owner: owner as DomainOwner })} disabled={disabled} options={(Object.keys(domainOwners) as DomainOwner[]).map((id) => ({ value: id, label: domainOwners[id] }))} /></label>
          <label className="upload-field"><span>Registriert bei</span><SuggestInput label="Registriert bei" value={draft.registrar} onValueChange={(registrar) => setDraft({ ...draft, registrar })} suggestions={providerSuggestions} maxLength={MAX_PROVIDER} placeholder="z. B. netcup" disabled={disabled} /></label>
          <label className="upload-field"><span>DNS bei</span><SuggestInput label="DNS bei" value={draft.dnsProvider} onValueChange={(dnsProvider) => setDraft({ ...draft, dnsProvider })} suggestions={providerSuggestions} maxLength={MAX_PROVIDER} placeholder="z. B. Cloudflare" disabled={disabled} /></label>
          <label className="upload-field"><span>Website läuft bei</span><SuggestInput label="Website läuft bei" value={draft.websiteHost} onValueChange={(websiteHost) => setDraft({ ...draft, websiteHost })} suggestions={providerSuggestions} maxLength={MAX_PROVIDER} placeholder="z. B. Vercel" disabled={disabled} /></label>
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
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (key: keyof ServerDraft) => (event: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [key]: event.target.value });
  // Switching the encryption takes the usual port along, unless a port of its own was typed.
  const setSecurity = (side: "imap" | "smtp") => (value: string) => {
    const next = value as MailSecurity;
    const port = draft[`${side}Port`];
    const usual = Object.values(mailSecurities).some((item) => String(item.ports[side]) === port) || port === "";
    setDraft({ ...draft, [`${side}Security`]: next, [`${side}Port`]: usual ? String(mailSecurities[next].ports[side]) : port });
  };
  return (
    <form className="cdm-packages" onSubmit={(event) => {
      event.preventDefault();
      run("save", () => saveMailServer({ ...draft, customerId }), () => { setSaved(draft); onSaved("Mail-Server gespeichert."); });
    }}>
      <fieldset className="dm-server" disabled={!canManage || busy !== null}>
        <legend className="visually-hidden">Mail-Server</legend>
        <label className="upload-field dm-server-wide"><span>Anbieter (nur für das oalab-Team)</span><SuggestInput label="Anbieter" value={draft.provider} onValueChange={(provider) => setDraft({ ...draft, provider })} suggestions={providerSuggestions} maxLength={MAX_PROVIDER} placeholder="z. B. netcup" /></label>
        {(["imap", "smtp"] as const).map((side) => (
          <div key={side} className="dm-server-side">
            <p className="dm-server-title">{side === "imap" ? "Posteingang (IMAP)" : "Postausgang (SMTP)"}</p>
            <label className="upload-field"><span>Server</span><input value={draft[`${side}Host`]} onChange={set(`${side}Host`)} placeholder="mail.kunde.de" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={253} /></label>
            <div className="dm-server-row">
              <label className="upload-field"><span>Port</span><input value={draft[`${side}Port`]} onChange={set(`${side}Port`)} inputMode="numeric" pattern="[0-9]*" maxLength={5} /></label>
              <label className="upload-field"><span>Verschlüsselung</span>
                <Select label="Verschlüsselung" value={draft[`${side}Security`]} onChange={setSecurity(side)} options={(Object.keys(mailSecurities) as MailSecurity[]).map((id) => ({ value: id, label: mailSecurities[id].label }))} />
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
          <div className="dm-form-acts">
            {server && <RemoveMailServer customerId={customerId} onRemoved={onSaved} />}
            <button type="submit" className="sheet-action is-primary" disabled={!changed || busy !== null}>{busy ? <Spinner /> : <Save size={15} aria-hidden="true" />}Mail-Server speichern</button>
          </div>
        </div>
      )}
    </form>
  );
}

/** Removes a saved mail server after asking once more. */
function RemoveMailServer({ customerId, onRemoved }: { customerId: string; onRemoved: (message: string) => void }) {
  const [confirm, setConfirm] = useState(false);
  const { busy, error, run } = useContractAction();
  return (
    <>
      {confirm
        ? <button type="button" className="sheet-action is-danger" disabled={busy !== null} onClick={() => run("remove", () => deleteMailServer({ customerId }), () => onRemoved("Mail-Server entfernt."))}>{busy ? <Spinner /> : <Trash2 size={15} aria-hidden="true" />}Wirklich entfernen</button>
        : <button type="button" className="sheet-action" onClick={() => setConfirm(true)}><Trash2 size={15} aria-hidden="true" />Entfernen</button>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </>
  );
}

/** Enters a mailbox, forward or alias or edits one. */
function MailboxDialog({ customer, entry, domains, onClose, onSaved }: { customer: ContractCustomer; entry?: Mailbox; domains: readonly CustomerDomain[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [draft, setDraft] = useState({ address: entry?.display ?? "", kind: entry?.kind ?? ("mailbox" as MailboxKind), person: entry?.person ?? "", target: entry?.targetDisplay ?? "" });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { busy, error, run } = useContractAction();
  const kindName = useId();
  const info = useInfo("E-Mail-Adressen", {
    steps: [
      <><b>Postfach:</b> eigene Adresse mit Passwort.</>,
      <><b>Weiterleitung:</b> schickt Mails an andere Adressen.</>,
      <><b>Alias:</b> zweiter Name für ein Postfach.</>,
    ],
    ask: "Was ist der Unterschied zwischen Postfach, Weiterleitung und Alias?",
  });
  const disabled = busy !== null;
  const set = (key: "address" | "person" | "target") => (event: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [key]: event.target.value });
  const address = normalizeEmail(draft.address);
  const foreign = address && domains.length > 0 && !domains.some((domain) => address.endsWith(`@${domain.domain}`));
  const keepsPassword = Boolean(entry?.hasPassword && draft.kind !== "mailbox");
  return (
    <Modal title={entry ? "E-Mail-Adresse bearbeiten" : "E-Mail-Adresse eintragen"} onClose={onClose} className="users-modal" actions={info.button}>
      {info.box}
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
        {keepsPassword && <p className="form-error" role="status">Dieses Postfach hat ein Passwort. Entferne es zuerst unter „Zugangsdaten“, dann wird daraus eine Weiterleitung oder ein Alias.</p>}
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
