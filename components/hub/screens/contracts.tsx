"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, ChevronLeft, Inbox, LayoutGrid, Plus, Search } from "lucide-react";
import type { HubFilesState } from "@/lib/hub-files/types";
import { formatDay, lastPayment } from "@/lib/hub-contracts/rules";
import type { ContractCustomer, ContractsState, TimelineEntry } from "@/lib/hub-contracts/types";
import { HeaderActions } from "../app-shell";
import { SegmentedControl } from "../controls";
import { GlassCard, SectionHeader } from "../glass";
import { LargeTitleHeader } from "../large-title-header";
import { SheetToolbar } from "../sheet";
import { CustomerSign } from "./customer-sign";
import { CategoryTitle } from "./workspace";
import { ContractTab, TimelineDialog, TimelineTab, packagesLine } from "./contracts-parts";
import { ContractGenerator, ContractGeneratorButton } from "./contract-generator";
import { ContractsOverview } from "./contracts-overview";
import { DomainMailTab } from "./contracts-domains";
import { CustomerContractSheet } from "./contracts-customer";
import { AccessTab } from "./contracts-access";
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

function ContractsAdmin({ state, asOf, preview, fileState }: { state: ContractsState; asOf: string; preview: boolean; fileState: HubFilesState }) {
  // „Pakete bearbeiten“ in the user management links a customer (?customer=<id>): the page opens with it.
  const linked = useSearchParams().get("customer");
  const [pane, setPane] = useState<Pane>(() => linked && state.customers.some((customer) => customer.id === linked) ? { kind: "customer", id: linked } : { kind: "overview" });
  const [paneOpen, setPaneOpen] = useState(pane.kind === "customer");
  const [tab, setTab] = useState<Tab>("contract");
  const [query, setQuery] = useState("");
  /** The search inside the open customer's tab. */
  const [tabQuery, setTabQuery] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [dialog, setDialog] = useState<{ entry?: TimelineEntry } | null>(null);
  const [generator, setGenerator] = useState(false);
  const [notice, setNotice] = useState("");
  const files = fileState.files;
  const current = pane.kind === "customer" ? state.customers.find((customer) => customer.id === pane.id) ?? null : null;

  function choose(next: Pane, nextTab: Tab = "contract") {
    setPane(next);
    setPaneOpen(true);
    setTab(nextTab);
    setTabQuery("");
    setNotice("");
    const url = new URL(window.location.href);
    if (next.kind === "customer") url.searchParams.set("customer", next.id);
    else url.searchParams.delete("customer");
    window.history.replaceState(null, "", url);
  }
  const openCustomer = (id: string, nextTab: Tab = "contract") => choose({ kind: "customer", id }, nextTab);

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
              <span className="chat-conv-main"><span className="chat-conv-top"><strong>Überblick</strong></span><span className="chat-conv-sub"><span className="chat-conv-last">Handlungsbedarf, Fristen und Pakete</span></span></span>
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
  const overview = <ContractsOverview state={state} asOf={asOf} onOpenCustomer={(id, next) => openCustomer(id, next)} onShowMissing={() => setOnlyMissing(true)} />;

  /* ---------- One customer ---------- */
  const back = <button type="button" className="chat-back" onClick={() => setPaneOpen(false)} aria-label="Zurück zu den Kunden"><ChevronLeft size={24} aria-hidden="true" /></button>;
  const entries = current ? timelineOf(current.id) : [];
  const paid = current ? lastPayment(state.timeline, current.id) : null;
  const head = current ? (
    <header className="am-pane-head">
      {back}
      <CustomerSign customer={current} logo={current.logo} size="lg" />
      <div className="am-pane-title"><strong>{current.company}</strong><span>{[current.customerNumber, packagesLine(current.packages) || "noch keine Pakete", paid ? `bezahlt ${formatDay(paid.occurredOn)}` : ""].filter(Boolean).join(" · ")}</span></div>
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
  const counts = current ? {
    domains: state.domainMail.domains.filter((item) => item.customerId === current.id).length + state.domainMail.mailboxes.filter((item) => item.customerId === current.id).length,
    access: state.domainMail.mailboxes.filter((item) => item.customerId === current.id && item.kind === "mailbox").length + state.domainMail.logins.filter((item) => item.customerId === current.id).length,
  } : { domains: 0, access: 0 };
  // Like the asset management: the tabs as a segmented control in the toolbar, the search next to it.
  const customerBody = current && (
    <>
      <SheetToolbar
        leading={<SegmentedControl label="Ansicht" value={tab} onChange={(next) => { setTab(next); setTabQuery(""); }} options={[
          { id: "contract", label: "Vertrag", name: "Vertrag" },
          { id: "domains", label: "Domain & Mail", name: "Domain & Mail", count: counts.domains },
          { id: "access", label: "Zugänge", name: "Zugänge", count: counts.access },
          { id: "timeline", label: "Verlauf", name: "Verlauf", count: entries.length },
        ]} />}
        query={tabQuery}
        onQuery={setTabQuery}
        placeholder="Suchen …"
        label={`In ${current.company} suchen`}
      />
      {tab === "domains" ? (
        <DomainMailTab key={current.id} customer={current} domainMail={state.domainMail} canManage={state.canManage && state.domainMail.ready} today={asOf} query={tabQuery} onNotice={setNotice} />
      ) : tab === "access" ? (
        <AccessTab key={current.id} customer={current} domainMail={state.domainMail} fixtures={state.source === "fixtures"} preview={preview} query={tabQuery} onNotice={setNotice} />
      ) : tab === "contract" ? (
        <ContractTab key={current.id} customer={current} files={files} preview={preview} canManage={state.canManage} query={tabQuery} onSaved={setNotice} onError={setNotice} />
      ) : (
        <TimelineTab key={current.id} customer={current} entries={entries} files={files} preview={preview} canManage={state.canManage} query={tabQuery} onEdit={(entry) => setDialog({ entry })} onNotice={setNotice} />
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
              {current ? customerBody : overview}
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

