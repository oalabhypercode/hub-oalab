"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarClock, Check, ChevronLeft, FileText, Inbox, LayoutGrid, Package, Plus, Search } from "lucide-react";
import type { HubFilesState } from "@/lib/hub-files/types";
import { packageCatalog, packageGroups, packageIds } from "@/lib/service-packages";
import { endingSoon, formatCents, formatDay, lastPayment } from "@/lib/hub-contracts/rules";
import type { ContractCustomer, ContractsState, TimelineEntry } from "@/lib/hub-contracts/types";
import { renewingSoon } from "@/lib/hub-domains/rules";
import { HeaderActions } from "../app-shell";
import { GlassCard, SectionHeader } from "../glass";
import { LargeTitleHeader } from "../large-title-header";
import { CustomerSign } from "./customer-sign";
import { CategoryTitle } from "./workspace";
import { ContractFiles, PackagesForm, TimelineDialog, TimelineList, packagesLine } from "./contracts-parts";
import { ContractGenerator, ContractGeneratorButton, ContractTemplatesSection } from "./contract-generator";
import { DomainMailTab } from "./contracts-domains";
import { CustomerContractSheet } from "./contracts-customer";
import { AccessTab } from "./contracts-access";
import { CustomerQuotaCard, QuotaCell, ServiceQuotaSection } from "./contracts-quota";
import { quotaMonth } from "@/lib/hub-service-quota/rules";
import type { ScreenProps } from "./types";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const hasService = (customer: ContractCustomer) => customer.packages.some((item) => item.group === "service" && item.packageId);
const cancelled = (customer: ContractCustomer) => customer.packages.some((item) => item.packageId && item.until);

/**
 * „Vertrag & Domain“: for admins the Contract & Domain Management of every customer (packages, timeline), laid out
 * like the asset management; for customers their own packages, released timeline and contracts.
 */
export function ContractsScreen({ state, asOf, preview, fileState }: ScreenProps & { state: ContractsState }) {
  return state.view === "admin"
    ? <ContractsAdmin state={state} asOf={asOf} preview={preview} fileState={fileState} />
    : <ContractsCustomer state={state} preview={preview} fileState={fileState} />;
}

function Notes({ state }: { state: ContractsState }) {
  if (state.error) return <GlassCard className="section-first"><p className="t-headline">Gerade nicht verfügbar</p><p className="t-subheadline t-secondary">{state.error}</p></GlassCard>;
  if (state.source === "fixtures") return <GlassCard className="section-first file-demo-note"><Inbox size={18} color="var(--accent-text)" aria-hidden="true" /><p className="t-subheadline">Fiktive Beispieldaten. Speichern geht nur mit echtem Admin-Login.</p></GlassCard>;
  if (!state.ready) return <GlassCard className="section-first file-demo-note"><Inbox size={18} color="var(--accent-text)" aria-hidden="true" /><p className="t-subheadline">Pakete und Verlauf sind in der Datenbank noch nicht eingerichtet. Die Migration steht noch aus; bis dahin lässt sich nichts speichern.</p></GlassCard>;
  return null;
}

type Pane = { kind: "overview" } | { kind: "customer"; id: string };
type Tab = "contract" | "domains" | "access" | "timeline";

/** Package endings and domain renewals of the next 60 days, soonest first. */
function upcoming(state: ContractsState, today: string) {
  const company = (id: string) => state.customers.find((customer) => customer.id === id);
  const packages = endingSoon(state.customers, today, 60).map(({ customer, packageId, until }) => ({ key: `${customer.id}-${packageId}`, day: until, customer, text: `${packageCatalog[packageId].name} endet` }));
  const domains = renewingSoon(state.domainMail.domains.flatMap((domain) => domain.details ? [{ ...domain, status: domain.details.status, renewsOn: domain.details.renewsOn }] : []), today, 60)
    .flatMap((domain) => {
      const customer = company(domain.customerId);
      return customer ? [{ key: domain.id, day: domain.renewsOn, customer, text: `${domain.display} ${domain.status === "cancelled" ? "läuft aus" : "verlängert sich"}` }] : [];
    });
  return [...packages, ...domains].sort((a, b) => a.day.localeCompare(b.day));
}

function ContractsAdmin({ state, asOf, preview, fileState }: { state: ContractsState; asOf: string; preview: boolean; fileState: HubFilesState }) {
  // „Pakete bearbeiten“ in the user management links a customer (?customer=<id>): the page opens with it.
  const linked = useSearchParams().get("customer");
  const [pane, setPane] = useState<Pane>(() => linked && state.customers.some((customer) => customer.id === linked) ? { kind: "customer", id: linked } : { kind: "overview" });
  const [paneOpen, setPaneOpen] = useState(pane.kind === "customer");
  const [tab, setTab] = useState<Tab>("contract");
  const [query, setQuery] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [dialog, setDialog] = useState<{ entry?: TimelineEntry } | null>(null);
  const [generator, setGenerator] = useState(false);
  const [notice, setNotice] = useState("");
  const files = fileState.files;
  const current = pane.kind === "customer" ? state.customers.find((customer) => customer.id === pane.id) ?? null : null;
  const companyOf = (id: string) => state.customers.find((customer) => customer.id === id)?.company ?? "";

  function choose(next: Pane) {
    setPane(next);
    setPaneOpen(true);
    setTab("contract");
    setNotice("");
    const url = new URL(window.location.href);
    if (next.kind === "customer") url.searchParams.set("customer", next.id);
    else url.searchParams.delete("customer");
    window.history.replaceState(null, "", url);
  }
  const openCustomer = (id: string) => choose({ kind: "customer", id });

  const missing = state.customers.filter((customer) => !hasService(customer));
  const term = query.trim().toLowerCase();
  const domainsOf = (id: string) => state.domainMail.domains.filter((domain) => domain.customerId === id).flatMap((domain) => [domain.display, domain.domain]);
  const listed = state.customers
    .filter((customer) => !onlyMissing || !hasService(customer))
    .filter((customer) => !term || [customer.company, customer.customerNumber, packagesLine(customer.packages), ...domainsOf(customer.id)].some((value) => value.toLowerCase().includes(term)));
  const timelineOf = useMemo(() => (id: string) => state.timeline.filter((entry) => entry.customerId === id), [state.timeline]);

  /* ---------- Customers ---------- */
  const list = (
    <div className="chat-list">
      <div className="chat-list-head"><h2>Kunden<span>{state.customers.length}</span></h2></div>
      <label className="chat-search"><Search size={15} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kunde, Paket oder Domain" aria-label="Kunden durchsuchen" /></label>
      <div className="chat-filter" role="group" aria-label="Kunden zeigen">
        <button type="button" aria-pressed={!onlyMissing} onClick={() => setOnlyMissing(false)}>Alle</button>
        <button type="button" aria-pressed={onlyMissing} onClick={() => setOnlyMissing(true)}>Ohne Servicepaket{missing.length > 0 && <span>{missing.length}</span>}</button>
      </div>
      <ul className="chat-convs" role="list">
        {!term && (
          <li>
            <button type="button" className="chat-conv" aria-current={pane.kind === "overview" ? "true" : undefined} onClick={() => choose({ kind: "overview" })}>
              <span className="am-tile cdm-tile-icon"><LayoutGrid size={20} aria-hidden="true" /></span>
              <span className="chat-conv-main"><span className="chat-conv-top"><strong>Überblick</strong></span><span className="chat-conv-sub"><span className="chat-conv-last">Pakete, Fristen und Zahlungen</span></span></span>
            </button>
          </li>
        )}
        <li className="am-list-label">{onlyMissing ? "Ohne Servicepaket" : "Kunden von A bis Z"}</li>
        {listed.map((customer) => (
          <li key={customer.id}>
            <button type="button" className="chat-conv" aria-current={pane.kind === "customer" && pane.id === customer.id ? "true" : undefined} onClick={() => openCustomer(customer.id)}>
              <CustomerSign customer={customer} logo={customer.logo} />
              <span className="chat-conv-main">
                <span className="chat-conv-top"><strong>{customer.company}</strong>{cancelled(customer) && <span className="chat-pill tone-todo">Gekündigt</span>}</span>
                <span className="chat-conv-sub"><span className="chat-conv-last">{customer.customerNumber} · {packagesLine(customer.packages) || "noch keine Pakete"}</span></span>
              </span>
            </button>
          </li>
        ))}
        {!listed.length && <li className="chat-empty">{term ? `Kein Kunde passt zu „${query.trim()}“.` : onlyMissing ? "Alle Kunden haben ein Servicepaket." : "Es sind noch keine Kunden angelegt."}</li>}
      </ul>
    </div>
  );

  /* ---------- Overview ---------- */
  const soon = upcoming(state, asOf);
  const quotaReady = state.serviceQuota.ready;
  const quotaHead = state.serviceQuota.window ? ` im ${quotaMonth(state.serviceQuota.window).month}` : "";
  const overview = (
    <div className="cdm-body">
      <div className="cdm-tiles">
        {packageIds.map((id) => {
          const count = state.customers.filter((customer) => customer.packages.some((item) => item.packageId === id)).length;
          return <div key={id} className="cdm-tile"><strong className="numeric">{count}</strong><span>{packageCatalog[id].name}</span></div>;
        })}
        <button type="button" className={`cdm-tile${missing.length ? " is-todo" : ""}`} onClick={() => setOnlyMissing(true)} title="In der Liste zeigen">
          <strong className="numeric">{missing.length}</strong><span>Ohne Servicepaket</span>
        </button>
      </div>

      <ServiceQuotaSection quota={state.serviceQuota} companyOf={companyOf} onOpenCustomer={openCustomer} onNotice={setNotice} />

      <section className="cdm-section" aria-labelledby="cdm-soon">
        <h3 id="cdm-soon"><CalendarClock size={16} aria-hidden="true" />Demnächst</h3>
        {soon.length ? (
          <ul className="cdm-rows">
            {soon.map(({ key, day, customer, text }) => (
              <li key={key}>
                <time className="numeric" dateTime={day}>{formatDay(day)}</time>
                <button type="button" className="cdm-link" onClick={() => openCustomer(customer.id)}>{customer.company}</button>
                <span className="cdm-muted">{text}</span>
              </li>
            ))}
          </ul>
        ) : <p className="cdm-empty">In den nächsten 60 Tagen endet kein Paket, und keine Domain verlängert sich.</p>}
      </section>

      <section className="cdm-section" aria-labelledby="cdm-recent">
        <h3 id="cdm-recent"><Package size={16} aria-hidden="true" />Zuletzt im Verlauf</h3>
        <TimelineList entries={state.timeline.slice(0, 8)} files={files} preview={preview} admin canManage={false} companyOf={companyOf} onOpenCustomer={openCustomer} empty="Noch keine Zeitpunkte. Trag beim Kunden zum Beispiel ein, wann eine Rechnung bezahlt wurde." />
      </section>

      <section className="cdm-section" aria-labelledby="cdm-all">
        <h3 id="cdm-all"><LayoutGrid size={16} aria-hidden="true" />Alle Kunden</h3>
        {state.customers.length ? (
          <div className="cdm-table-wrap">
            <table className="data-table cdm-table">
              <caption className="visually-hidden">Kunden mit Domain-Paket, Servicepaket, Anfragen in diesem Monat und letzter Zahlung</caption>
              <thead><tr><th scope="col">Kunde</th><th scope="col">{packageGroups.domain.name}</th><th scope="col">{packageGroups.service.name}</th>{quotaReady && <th scope="col">Anfragen{quotaHead}</th>}<th scope="col">Letzte Zahlung</th></tr></thead>
              <tbody>
                {state.customers.map((customer) => {
                  const paid = lastPayment(state.timeline, customer.id);
                  return (
                    <tr key={customer.id} className="data-row">
                      <td className="cell-person"><button type="button" className="row-open" onClick={() => openCustomer(customer.id)}><CustomerSign customer={customer} logo={customer.logo} size="sm" /><strong>{customer.company}</strong></button></td>
                      {customer.packages.map((item) => (
                        <td key={item.group}>{item.packageId ? <>{packageCatalog[item.packageId].short}{item.until && <span className="chat-pill tone-todo cdm-inline-pill">bis {formatDay(item.until)}</span>}</> : <span className="cell-none">–</span>}</td>
                      ))}
                      {quotaReady && <td><QuotaCell quota={state.serviceQuota} customerId={customer.id} /></td>}
                      <td className="cdm-muted numeric">{paid ? `${formatDay(paid.occurredOn)}${paid.amountCents !== null ? ` · ${formatCents(paid.amountCents)}` : ""}` : <span className="cell-none">–</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="cdm-empty">Es sind noch keine Kunden angelegt.</p>}
      </section>

      <ContractTemplatesSection canManage={state.canManage} />
    </div>
  );

  /* ---------- One customer ---------- */
  const back = <button type="button" className="chat-back" onClick={() => setPaneOpen(false)} aria-label="Zurück zu den Kunden"><ChevronLeft size={24} aria-hidden="true" /></button>;
  const entries = current ? timelineOf(current.id) : [];
  const head = current ? (
    <header className="am-pane-head">
      {back}
      <CustomerSign customer={current} logo={current.logo} size="lg" />
      <div className="am-pane-title"><strong>{current.company}</strong><span>{[current.customerNumber, packagesLine(current.packages) || "noch keine Pakete"].join(" · ")}</span></div>
      {tab === "timeline" && state.canManage && <div className="am-pane-actions"><button type="button" className="sheet-action is-primary" onClick={() => setDialog({})}><Plus size={15} aria-hidden="true" />Zeitpunkt</button></div>}
      {tab === "contract" && state.canManage && <div className="am-pane-actions"><ContractGeneratorButton onOpen={() => setGenerator(true)} /></div>}
    </header>
  ) : (
    <header className="am-pane-head">
      {back}
      <span className="am-tile is-lg cdm-tile-icon"><LayoutGrid size={22} aria-hidden="true" /></span>
      <div className="am-pane-title"><strong>Überblick</strong><span>{plural(state.customers.length, "Kunde", "Kunden")} · {plural(missing.length, "ohne Servicepaket", "ohne Servicepaket")}</span></div>
    </header>
  );
  const customerBody = current && (
    <>
      <div className="chat-filter cdm-tabs" role="group" aria-label="Ansicht">
        <button type="button" aria-pressed={tab === "contract"} onClick={() => setTab("contract")}>Vertrag</button>
        <button type="button" aria-pressed={tab === "domains"} onClick={() => setTab("domains")}>Domain & Mail</button>
        <button type="button" aria-pressed={tab === "access"} onClick={() => setTab("access")}>Zugänge</button>
        <button type="button" aria-pressed={tab === "timeline"} onClick={() => setTab("timeline")}>Verlauf{entries.length > 0 && <span>{entries.length}</span>}</button>
      </div>
      {tab === "domains" ? (
        <DomainMailTab key={current.id} customer={current} domainMail={state.domainMail} canManage={state.canManage && state.domainMail.ready} today={asOf} onNotice={setNotice} />
      ) : tab === "access" ? (
        <AccessTab key={current.id} customer={current} domainMail={state.domainMail} fixtures={state.source === "fixtures"} preview={preview} onNotice={setNotice} />
      ) : tab === "contract" ? (
        <div className="cdm-body">
          <PackagesForm key={current.id} customer={current} canManage={state.canManage} onSaved={setNotice} />
          <CustomerQuotaCard key={`quota-${current.id}`} customer={current} quota={state.serviceQuota} fixtures={state.source === "fixtures"} onNotice={setNotice} />
          <section className="cdm-section" aria-labelledby="cdm-files">
            <h3 id="cdm-files"><FileText size={16} aria-hidden="true" />Verträge und Rechnungen</h3>
            <ContractFiles files={files} customerId={current.id} preview={preview} empty="Im Asset Management liegen bei diesem Kunden noch keine Verträge oder Rechnungen." />
          </section>
        </div>
      ) : (
        <div className="cdm-body">
          <TimelineList entries={entries} files={files} preview={preview} admin canManage={state.canManage} onEdit={(entry) => setDialog({ entry })} onNotice={setNotice} empty="Noch keine Zeitpunkte. Trag zum Beispiel ein, wann eine Rechnung gestellt oder bezahlt wurde." />
        </div>
      )}
    </>
  );

  return (
    <>
      <LargeTitleHeader title="Contract & Domain Management" icon={<CategoryTitle category="contracts" />} actions={<HeaderActions />} />
      <Notes state={state} />
      {notice && <p className="calendar-notice section-first" role="status"><Check size={18} aria-hidden="true" />{notice}</p>}
      {!state.error && (
        <div className="sheet section-first am cdm" data-open={paneOpen ? "" : undefined}>
          <div className="am-grid">
            {list}
            <section className="am-pane" aria-label={current ? current.company : "Überblick"}>
              {head}
              <div className="am-scroll">{current ? customerBody : overview}</div>
            </section>
          </div>
        </div>
      )}
      {dialog && current && <TimelineDialog customer={current} entry={dialog.entry} files={files} today={asOf} onClose={() => setDialog(null)} onSaved={setNotice} />}
      {generator && current && <ContractGenerator customer={current} canManage={state.canManage} today={asOf} onClose={() => setGenerator(false)} onFiled={setNotice} />}
    </>
  );
}

/* ---------- Customers ---------- */

function ContractsCustomer({ state, preview, fileState }: { state: ContractsState; preview: boolean; fileState: HubFilesState }) {
  return (
    <>
      <LargeTitleHeader title="Vertrag & Domain" icon={<CategoryTitle category="contracts" />} actions={<HeaderActions />} />
      {state.error && <GlassCard className="section-first"><p className="t-headline">Gerade nicht verfügbar</p><p className="t-subheadline t-secondary">{state.error}</p></GlassCard>}
      {!state.error && !state.customers.length && <GlassCard className="section-first"><p className="t-subheadline t-secondary">Sobald dein Zugang einem Unternehmen zugeordnet ist, siehst du hier deine Pakete und wichtige Zeitpunkte.</p></GlassCard>}
      {/* Like „Dateien“: the figures in glass on top, one sheet with groups of rows below; one block per company. */}
      {!state.error && state.customers.map((customer, index) => (
        <section key={customer.id} className={index === 0 ? undefined : "cdm-next-company"} aria-label={customer.company}>
          {state.customers.length > 1 && <SectionHeader title={customer.company} />}
          <CustomerContractSheet customer={customer} state={state} files={fileState.files} preview={preview} />
        </section>
      ))}
    </>
  );
}

