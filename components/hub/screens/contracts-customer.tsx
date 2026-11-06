"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, AtSign, CalendarClock, ChevronDown, FileText, Forward, Globe, History, Inbox, LifeBuoy, Mail, Package, Receipt, Smartphone, type LucideIcon } from "lucide-react";
import { hubHref } from "@/lib/hub-data";
import type { HubStoredFile } from "@/lib/hub-files/types";
import { packageCatalog, packageGroups, type CustomerPackage } from "@/lib/service-packages";
import { formatCents, formatDay, lastPayment, timelineKinds, type TimelineKind } from "@/lib/hub-contracts/rules";
import type { ContractCustomer, ContractsState, TimelineEntry } from "@/lib/hub-contracts/types";
import { mailboxKinds, mailSecurities, type MailboxKind } from "@/lib/hub-domains/rules";
import type { MailServer } from "@/lib/hub-domains/types";
import { MiniChart } from "../charts";
import { SegmentedControl } from "../controls";
import { CategoryIcon } from "../glass";
import { useInfo } from "../info-box";
import { Modal } from "../modal";
import { SheetEmpty, SheetFooter, SheetToolbar, StatusGlyph, TableGroup, useCollapsedGroups } from "../sheet";
import { CopyButton } from "./contracts-domains";
import { DownloadButton } from "./files-dialogs";
import { CategoryDot } from "./files-parts";

/** Columns of the customer's table: Eintrag, Art, Details, Datum, Stand, Aktion. */
const COLUMNS = 6;
/** The newest entries of the timeline; „Ältere anzeigen“ shows the rest. */
const RECENT = 3;

type Scope = "all" | "contract" | "domain";
const scopeOf: Record<string, Scope> = { packages: "contract", domains: "domain", addresses: "domain", documents: "contract", timeline: "contract" };

const kindIcons: Record<MailboxKind, LucideIcon> = { mailbox: Inbox, forward: Forward, alias: AtSign };
const timelineIcons: Record<TimelineKind, LucideIcon> = { invoice_paid: Receipt, invoice_sent: Receipt, package: Package, domain: Globe, mail: Mail, other: CalendarClock };

const fileHref = (preview: boolean, fileId: string) => `${hubHref(preview, "files")}?file=${encodeURIComponent(fileId)}`;
const shortDay = (day: string) => new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
const monthOf = (day: string) => new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
const count = (amount: number, one: string, many: string) => `${amount} ${amount === 1 ? one : many}`;

/** The row icon in the colour of „Vertrag & Domain“, like the file icons of „Dateien“. */
function RowIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon size={16} strokeWidth={1.9} className="cdm-row-icon" aria-hidden="true" />;
}

function Dot({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`file-dot cdm-dot-${tone}`}><i aria-hidden="true" />{children}</span>;
}

/** What a package row says in „Stand“: running, or cancelled to a day. */
function PackageState({ item }: { item: CustomerPackage }) {
  return item.until
    ? <span className="status-cell"><StatusGlyph kind="pending" />bis {formatDay(item.until)}</span>
    : <span className="status-cell"><StatusGlyph kind="active" />Aktiv</span>;
}

/**
 * „Vertrag & Domain“ of one company for its customers, in the language of „Dateien“: two glass figures on top, one
 * sheet below with packages, domains, addresses, documents and the released timeline as groups of rows. Read only;
 * changes go through the oalab team.
 */
export function CustomerContractSheet({ customer, state, files, preview }: { customer: ContractCustomer; state: ContractsState; files: readonly HubStoredFile[]; preview: boolean }) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [allEntries, setAllEntries] = useState(false);
  const [setup, setSetup] = useState(false);
  const [notice, setNotice] = useState("");
  const groups = useCollapsedGroups();
  const packagesInfo = useInfo("Deine Pakete", {
    steps: [
      <><b>Domain & Mail:</b> deine Website und deine Postfächer.</>,
      <><b>Service:</b> Änderungen stellst du als Anfrage.</>,
      <><b>Wechseln oder kündigen:</b> schreib uns unter Nachrichten.</>,
    ],
    ask: "Was steckt in meinen Paketen?",
  });
  const addressesInfo = useInfo("Deine Adressen", {
    steps: [
      <><b>Postfach:</b> eigene Adresse mit Passwort.</>,
      <><b>Weiterleitung:</b> schickt Mails an andere Adressen.</>,
      <><b>Alias:</b> zweiter Name für ein Postfach.</>,
    ],
    ask: "Was ist der Unterschied zwischen Postfach, Weiterleitung und Alias?",
  });

  const term = query.trim().toLocaleLowerCase("de");
  const hit = (...values: (string | null | undefined)[]) => !term || values.some((value) => value?.toLocaleLowerCase("de").includes(term));

  const held = customer.packages.flatMap((item) => item.packageId ? [{ ...item, packageId: item.packageId }] : []);
  const domains = state.domainMail.domains.filter((item) => item.customerId === customer.id);
  const mailboxes = state.domainMail.mailboxes.filter((item) => item.customerId === customer.id);
  const server: MailServer | null = state.domainMail.mailServers.find((item) => item.customerId === customer.id && (item.imapHost || item.smtpHost || item.webmailUrl)) ?? null;
  const entries = state.timeline.filter((entry) => entry.customerId === customer.id);
  const documents = files
    .filter((file) => (file.category === "contract" || file.category === "invoice") && file.customers.some((item) => item.id === customer.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // An invoice counts as paid once a released „Rechnung bezahlt“ points at it, as open while only „gestellt“ does.
  const invoiceState = (file: HubStoredFile) => entries.some((entry) => entry.fileId === file.id && entry.kind === "invoice_paid") ? "paid" : entries.some((entry) => entry.fileId === file.id && entry.kind === "invoice_sent") ? "open" : null;

  const rows = {
    packages: held.filter((item) => hit(packageCatalog[item.packageId].name, packageGroups[item.group].name, packageCatalog[item.packageId].description)),
    domains: domains.filter((domain) => hit(domain.display, domain.domain)),
    addresses: mailboxes.filter((mailbox) => hit(mailbox.display, mailbox.person, mailbox.targetDisplay, mailboxKinds[mailbox.kind].label)),
    documents: documents.filter((file) => hit(file.title, file.description)),
    timeline: entries.filter((entry) => hit(entry.title, timelineKinds[entry.kind].label)),
  };
  const shows = (key: keyof typeof rows) => scope === "all" || scopeOf[key] === scope;
  const scopeCount = (wanted: Scope) => (Object.keys(rows) as (keyof typeof rows)[]).filter((key) => wanted === "all" || scopeOf[key] === wanted).reduce((sum, key) => sum + rows[key].length, 0);
  const shownTimeline = term || allEntries ? rows.timeline : rows.timeline.slice(0, RECENT);
  const nothing = Boolean(term) && (Object.keys(rows) as (keyof typeof rows)[]).every((key) => !shows(key) || rows[key].length === 0);

  // Figures on top: the packages and the newest payment, with the paid amounts as small bars.
  const firstSince = held.map((item) => item.since).filter((day): day is string => Boolean(day)).sort()[0];
  const paid = lastPayment(entries, customer.id);
  const paidAmounts = entries
    .flatMap((entry) => entry.kind === "invoice_paid" && entry.amountCents !== null ? [{ day: entry.occurredOn, cents: entry.amountCents }] : [])
    .sort((a, b) => a.day.localeCompare(b.day)).slice(-6).map((entry) => entry.cents);
  const paidCents = paid?.amountCents ?? null;
  const paidValue = paidCents !== null ? formatCents(paidCents).replace(/\s?€$/, "") : "–";

  return (
    <>
      <div className="metric-grid section-first">
        <section className="glass glass-card metric-card" aria-label="Pakete">
          <div className="card-head">
            <CategoryIcon category="contracts" />
            <span className="card-head-title" style={{ color: "var(--cat-contracts-text)" }}>Pakete</span>
            {firstSince && <span className="card-head-time">seit {monthOf(firstSince)}</span>}
          </div>
          <div className="metric-card-body">
            <div className="metric-card-figure">
              <p className="metric-value-line"><span className="metric-value numeric">{held.length}</span><span className="metric-unit">aktiv</span></p>
              <p className="metric-context">{held.map((item) => packageCatalog[item.packageId].short).join(" · ") || "Noch keine Pakete"}</p>
            </div>
            {held.length > 0 && (
              <div className="cdm-badges" aria-hidden="true">
                {held.map((item) => <span key={item.group} className={`cdm-badge is-${item.group}`}>{item.group === "domain" ? <Globe size={17} /> : <LifeBuoy size={17} />}</span>)}
              </div>
            )}
          </div>
        </section>
        <section className="glass glass-card metric-card" aria-label="Zahlungen">
          <div className="card-head">
            <CategoryIcon category="contracts" />
            <span className="card-head-title" style={{ color: "var(--cat-contracts-text)" }}>Zahlungen</span>
            {paid && <span className="card-head-time">{shortDay(paid.occurredOn)}</span>}
          </div>
          <div className="metric-card-body">
            <div className="metric-card-figure">
              <p className="metric-value-line"><span className="metric-value numeric">{paidValue}</span>{paidCents !== null && <span className="metric-unit">€</span>}</p>
              <p className="metric-context">{paid ? paid.title : "Noch keine Zahlung im Verlauf"}</p>
            </div>
            {paidAmounts.length > 1 && <MiniChart data={{ type: "bars", values: paidAmounts }} category="contracts" />}
          </div>
        </section>
      </div>

      <div className="sheet section-first cdm-sheet">
        <SheetToolbar
          query={query}
          onQuery={setQuery}
          placeholder="Domain, Adresse …"
          label="Vertrag und Domain durchsuchen"
          trailing={<SegmentedControl label="Bereich zeigen" value={scope} onChange={setScope} options={[
            { id: "all", label: "Alles", name: "Alles zeigen", count: scopeCount("all") },
            { id: "contract", label: "Vertrag", name: "Pakete, Dokumente und Verlauf", count: scopeCount("contract") },
            { id: "domain", label: "Domain & E-Mail", name: "Domains und E-Mail-Adressen", count: scopeCount("domain") },
          ]} />}
        />
        {notice && <p className="form-error cdm-sheet-notice" role="alert">{notice}</p>}
        {nothing ? <SheetEmpty text={`Nichts passt zu „${query.trim()}“.`} onReset={() => { setQuery(""); setScope("all"); }} /> : (
          <div className="sheet-scroll">
            <table className="file-table cdm-table">
              <caption className="visually-hidden">Pakete, Domains, E-Mail-Adressen, Dokumente und Verlauf von {customer.company}</caption>
              <thead>
                <tr><th scope="col">Eintrag</th><th scope="col">Art</th><th scope="col" className="col-description">Details</th><th scope="col">Datum</th><th scope="col">Stand</th><th scope="col"><span className="visually-hidden">Aktion</span></th></tr>
              </thead>

              {shows("packages") && (!term || rows.packages.length > 0) && (
                <TableGroup colSpan={COLUMNS} label="Pakete" count={rows.packages.length} glyph={<Package size={16} aria-hidden="true" />} collapsed={groups.isCollapsed("packages")} onToggle={() => groups.toggle("packages")} empty="Noch keine Pakete. Fragen dazu beantwortet dein oalab-Team unter Nachrichten." actions={packagesInfo.button}>
                  {rows.packages.map((item) => {
                    const id = item.packageId;
                    return (
                      <tr key={item.group} className="file-row">
                        <td className="cell-file"><span className="file-open"><RowIcon icon={item.group === "domain" ? Globe : LifeBuoy} /><strong>{packageCatalog[id].name}</strong></span></td>
                        <td className="cell-category"><Dot tone={item.group}>{packageGroups[item.group].name}</Dot></td>
                        <td className="cell-description col-description">{packageCatalog[id].description}</td>
                        <td className="cell-date numeric">{item.since ? `seit ${formatDay(item.since)}` : ""}</td>
                        <td className="cell-state"><PackageState item={item} /></td>
                        <td className="cell-action" />
                      </tr>
                    );
                  })}
                </TableGroup>
              )}

              {shows("domains") && domains.length > 0 && (!term || rows.domains.length > 0) && (
                <TableGroup colSpan={COLUMNS} label="Domains" count={rows.domains.length} glyph={<Globe size={16} aria-hidden="true" />} collapsed={groups.isCollapsed("domains")} onToggle={() => groups.toggle("domains")}>
                  {rows.domains.map((domain) => (
                    <tr key={domain.id} className="file-row">
                      <td className="cell-file"><span className="file-open"><RowIcon icon={Globe} /><strong>{domain.display}</strong></span></td>
                      <td className="cell-category"><Dot tone="domain">Domain</Dot></td>
                      <td className="cell-description col-description">{domain.display !== domain.domain ? domain.domain : ""}</td>
                      <td className="cell-date" />
                      <td className="cell-state" />
                      <td className="cell-action">
                        <a className="file-download" href={`https://${domain.domain}`} target="_blank" rel="noopener noreferrer" aria-label={`${domain.display} öffnen (neuer Tab)`} title="Website öffnen"><ArrowUpRight size={17} aria-hidden="true" /></a>
                      </td>
                    </tr>
                  ))}
                </TableGroup>
              )}

              {shows("addresses") && (mailboxes.length > 0 || server) && (!term || rows.addresses.length > 0) && (
                <TableGroup colSpan={COLUMNS} label="E-Mail-Adressen" count={rows.addresses.length} glyph={<Mail size={16} aria-hidden="true" />} collapsed={groups.isCollapsed("addresses")} onToggle={() => groups.toggle("addresses")} empty={server ? undefined : "Noch keine E-Mail-Adressen."} actions={addressesInfo.button}>
                  {rows.addresses.map((mailbox) => (
                    <tr key={mailbox.id} className="file-row">
                      <td className="cell-file"><span className="file-open"><RowIcon icon={kindIcons[mailbox.kind]} /><strong>{mailbox.display}</strong></span></td>
                      <td className="cell-category"><Dot tone={mailbox.kind}>{mailboxKinds[mailbox.kind].label}</Dot></td>
                      <td className="cell-description col-description">{mailbox.kind === "mailbox" ? mailbox.person : `${mailboxKinds[mailbox.kind].target} ${mailbox.targetDisplay}`}</td>
                      <td className="cell-date" />
                      <td className="cell-state" />
                      <td className="cell-action"><CopyButton value={mailbox.display} label="Adresse" /></td>
                    </tr>
                  ))}
                  {server && (
                    <tr className="table-add-row">
                      <td colSpan={COLUMNS}>
                        <span className="cdm-add-actions">
                          <button type="button" className="table-add is-primary" onClick={() => setSetup(true)}><Smartphone size={15} aria-hidden="true" />Mailprogramm einrichten</button>
                          {server.webmailUrl && <a className="table-add" href={server.webmailUrl} target="_blank" rel="noopener noreferrer"><ArrowUpRight size={15} aria-hidden="true" />Webmail öffnen<span className="visually-hidden"> (öffnet in neuem Tab)</span></a>}
                        </span>
                      </td>
                    </tr>
                  )}
                </TableGroup>
              )}

              {shows("documents") && (!term || rows.documents.length > 0) && (
                <TableGroup colSpan={COLUMNS} label="Dokumente" count={rows.documents.length} glyph={<FileText size={16} aria-hidden="true" />} collapsed={groups.isCollapsed("documents")} onToggle={() => groups.toggle("documents")} empty="In deinen Dateien liegen noch keine Verträge oder Rechnungen.">
                  {rows.documents.map((file) => {
                    const invoice = file.category === "invoice" ? invoiceState(file) : null;
                    return (
                      <tr key={file.id} className="file-row">
                        <td className="cell-file"><Link className="file-open" href={fileHref(preview, file.id)}><RowIcon icon={file.category === "invoice" ? Receipt : FileText} /><strong>{file.title}</strong></Link></td>
                        <td className="cell-category"><CategoryDot category={file.category} /></td>
                        <td className="cell-description col-description">{file.description}</td>
                        <td className="cell-date numeric">{formatDay(file.createdAt.slice(0, 10))}</td>
                        <td className="cell-state">{invoice === "paid" ? <span className="status-cell"><StatusGlyph kind="active" />bezahlt</span> : invoice === "open" ? <span className="status-cell"><StatusGlyph kind="pending" />offen</span> : null}</td>
                        <td className="cell-action"><DownloadButton file={file} onError={setNotice} /></td>
                      </tr>
                    );
                  })}
                  {documents.length > 0 && (
                    <tr className="table-add-row"><td colSpan={COLUMNS}><Link className="table-add" href={hubHref(preview, "files")}><ArrowRight size={15} aria-hidden="true" />Alle in Dateien</Link></td></tr>
                  )}
                </TableGroup>
              )}

              {shows("timeline") && (!term || rows.timeline.length > 0) && (
                <TableGroup colSpan={COLUMNS} label="Verlauf" count={rows.timeline.length} glyph={<History size={16} aria-hidden="true" />} collapsed={groups.isCollapsed("timeline")} onToggle={() => groups.toggle("timeline")} empty="Noch keine Einträge. Hier stehen zum Beispiel bezahlte Rechnungen und Änderungen an deinen Paketen.">
                  {shownTimeline.map((entry) => <TimelineRow key={entry.id} entry={entry} files={files} preview={preview} />)}
                  {!term && rows.timeline.length > RECENT && (
                    <tr className="table-add-row">
                      <td colSpan={COLUMNS}>
                        <button type="button" className="table-add cdm-more" aria-expanded={allEntries} onClick={() => setAllEntries(!allEntries)}>
                          <ChevronDown size={15} aria-hidden="true" />{allEntries ? "Weniger anzeigen" : `Ältere anzeigen (${rows.timeline.length - RECENT})`}
                        </button>
                      </td>
                    </tr>
                  )}
                </TableGroup>
              )}
            </table>
          </div>
        )}
        {packagesInfo.box}
        {addressesInfo.box}
        <SheetFooter hint={<>Fragen zu deinem Vertrag? Schreib uns unter <Link href={hubHref(preview, "messages")}>Nachrichten</Link>.</>}>
          {[count(held.length, "Paket", "Pakete"), domains.length ? count(domains.length, "Domain", "Domains") : "", mailboxes.length ? count(mailboxes.length, "Adresse", "Adressen") : "", count(documents.length, "Dokument", "Dokumente")].filter(Boolean).join(" · ")}
        </SheetFooter>
      </div>
      {setup && server && <MailSetupDialog server={server} preview={preview} onClose={() => setSetup(false)} />}
    </>
  );
}

function TimelineRow({ entry, files, preview }: { entry: TimelineEntry; files: readonly HubStoredFile[]; preview: boolean }) {
  const file = entry.fileId ? files.find((item) => item.id === entry.fileId) : undefined;
  const kind = timelineKinds[entry.kind];
  return (
    <tr className="file-row">
      <td className="cell-file"><span className="file-open"><RowIcon icon={timelineIcons[entry.kind]} /><strong>{entry.title}</strong></span></td>
      <td className="cell-category"><Dot tone={kind.tone}>{kind.label}</Dot></td>
      <td className="cell-description col-description">
        {entry.amountCents !== null && <span className="numeric">{formatCents(entry.amountCents)}</span>}
        {entry.amountCents !== null && file && " · "}
        {file && <Link className="cdm-link" href={fileHref(preview, file.id)}>{file.title}</Link>}
      </td>
      <td className="cell-date numeric">{formatDay(entry.occurredOn)}</td>
      <td className="cell-state" />
      <td className="cell-action" />
    </tr>
  );
}

/** The settings for a mail program in three steps, with buttons that copy server and port. */
function MailSetupDialog({ server, preview, onClose }: { server: MailServer; preview: boolean; onClose: () => void }) {
  const sides = (["imap", "smtp"] as const).filter((side) => server[`${side}Host`]);
  return (
    <Modal title="Mailprogramm einrichten" onClose={onClose} className="cdm-setup">
      <p className="cdm-setup-lead">In drei Schritten, auf dem Handy wie am Computer.</p>
      <ol className="cdm-steps">
        <li className="cdm-step">
          <span className="cdm-step-no" aria-hidden="true">1</span>
          <div><h3>Konto hinzufügen</h3><p>Im Mailprogramm „Konto hinzufügen“ und die Einrichtung von Hand mit <b>IMAP</b> wählen.</p></div>
        </li>
        <li className="cdm-step">
          <span className="cdm-step-no" aria-hidden="true">2</span>
          <div>
            <h3>Server eintragen</h3>
            <div className="cdm-servers">
              {sides.map((side) => {
                const host = server[`${side}Host`];
                const port = server[`${side}Port`];
                return (
                  <div key={side} className="cdm-server">
                    <span className="cdm-server-label">{side === "imap" ? "Posteingang" : "Postausgang"}</span>
                    <span className="dm-mono cdm-server-host">{host}</span>
                    <CopyButton value={host} label={side === "imap" ? "Server Posteingang" : "Server Postausgang"} />
                    {port !== null && <span className="dm-mono numeric">{port}</span>}
                    {port !== null && <CopyButton value={String(port)} label={side === "imap" ? "Port Posteingang" : "Port Postausgang"} />}
                    <span className="chat-pill tone-off">{mailSecurities[server[`${side}Security`]].label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </li>
        <li className="cdm-step">
          <span className="cdm-step-no" aria-hidden="true">3</span>
          <div>
            <h3>Anmelden</h3>
            <dl className="cdm-login-facts"><dt>Benutzername</dt><dd>deine vollständige E-Mail-Adresse</dd><dt>Passwort</dt><dd>das deines Postfachs</dd></dl>
            <p className="cdm-setup-note">Passwörter zeigt der Hub nicht an. Brauchst du ein neues, schreib deinem oalab-Team unter <Link href={hubHref(preview, "messages")} onClick={onClose}>Nachrichten</Link>.</p>
          </div>
        </li>
      </ol>
      {server.webmailUrl && <a className="sheet-button" href={server.webmailUrl} target="_blank" rel="noopener noreferrer"><ArrowUpRight size={18} aria-hidden="true" />Webmail öffnen<span className="visually-hidden"> (öffnet in neuem Tab)</span></a>}
    </Modal>
  );
}
