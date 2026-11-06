"use client";

import { useState } from "react";
import { ArrowRight, CalendarClock, CircleAlert, History, Package } from "lucide-react";
import { packageCatalog, packageIds } from "@/lib/service-packages";
import { endingSoon, formatCents, formatDay, timelineKinds } from "@/lib/hub-contracts/rules";
import type { ContractCustomer, ContractsState } from "@/lib/hub-contracts/types";
import { domainCheckIds, domainChecks, renewalPassed, renewingSoon } from "@/lib/hub-domains/rules";
import { SheetEmpty, SheetFooter, SheetToolbar, StatusGlyph, TableGroup, useCollapsedGroups, type GlyphKind } from "../sheet";
import { CustomerSign } from "./customer-sign";
import { ContractTemplatesSection } from "./contract-generator";
import { packagesLine } from "./contracts-parts";
import { ServiceQuotaSection } from "./contracts-quota";

/** Columns of the admin tables: Eintrag, Art, Datum, Aktion. */
const COLUMNS = 4;

export type OverviewTab = "contract" | "domains";
const hasService = (customer: ContractCustomer) => customer.packages.some((item) => item.group === "service" && item.packageId);
const daysUntil = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const inDays = (days: number) => days === 0 ? "heute" : days === 1 ? "morgen" : `in ${days} Tagen`;

/** Package endings and domain renewals of the next 60 days, soonest first. */
export function upcoming(state: ContractsState, today: string) {
  const company = (id: string) => state.customers.find((customer) => customer.id === id);
  const packages = endingSoon(state.customers, today, 60).map(({ customer, packageId, until }) => ({ key: `${customer.id}-${packageId}`, day: until, customer, text: `${packageCatalog[packageId].short} endet`, sub: customer.customerNumber, tab: "contract" as OverviewTab }));
  const domains = renewingSoon(state.domainMail.domains.flatMap((domain) => domain.details ? [{ ...domain, status: domain.details.status, renewsOn: domain.details.renewsOn }] : []), today, 60)
    .flatMap((domain) => {
      const customer = company(domain.customerId);
      return customer ? [{ key: domain.id, day: domain.renewsOn, customer, text: domain.status === "cancelled" ? "Domain läuft aus" : "Domain verlängert sich", sub: domain.display, tab: "domains" as OverviewTab }] : [];
    });
  return [...packages, ...domains].sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * What needs a hand: customers without packages or without a service package, domains whose renewal day passed, and
 * running domains with checks still open.
 */
export function needsAttention(state: ContractsState, today: string) {
  const rows: { key: string; customer: ContractCustomer; glyph: GlyphKind; text: string; sub: string; tab: OverviewTab }[] = [];
  for (const customer of state.customers) {
    const line = packagesLine(customer.packages);
    if (!line) rows.push({ key: `${customer.id}-none`, customer, glyph: "disabled", text: "Keine Pakete", sub: customer.customerNumber, tab: "contract" });
    else if (!hasService(customer)) rows.push({ key: `${customer.id}-service`, customer, glyph: "disabled", text: "Kein Servicepaket", sub: `${customer.customerNumber} · ${line}`, tab: "contract" });
  }
  for (const domain of state.domainMail.domains) {
    const customer = state.customers.find((item) => item.id === domain.customerId);
    const details = domain.details;
    if (!customer || !details) continue;
    const open = domainCheckIds.filter((id) => !details.checks[id]);
    if (renewalPassed(details, today)) rows.push({ key: `${domain.id}-renewal`, customer, glyph: "pending", text: "Verlängerung prüfen", sub: `${domain.display} · ${formatDay(details.renewsOn ?? today)}`, tab: "domains" });
    else if (details.status === "active" && open.length) rows.push({ key: `${domain.id}-checks`, customer, glyph: "pending", text: `${open.length} ${open.length === 1 ? "Prüfung" : "Prüfungen"} offen`, sub: `${domain.display} · ${open.map((id) => domainChecks[id].label).join(", ")}`, tab: "domains" });
  }
  return rows;
}

/** The customer of a row, opening it; the second line says why the row is there. */
function CustomerCell({ customer, title, sub, onOpen }: { customer: ContractCustomer; title: string; sub: string; onOpen: () => void }) {
  return (
    <td className="cell-file">
      <button type="button" className="am-file" onClick={onOpen}>
        <CustomerSign customer={customer} logo={customer.logo} size="md" />
        <span className="am-file-text"><strong>{title}</strong>{sub && <small>{sub}</small>}</span>
      </button>
    </td>
  );
}

/**
 * The overview of the Contract & Domain Management in the language of the asset management: one table with what needs
 * a hand, what comes up in the next 60 days, the packages and the newest timeline entries; the templates below.
 */
export function ContractsOverview({ state, asOf, onOpenCustomer, onShowMissing, onNotice }: {
  state: ContractsState;
  asOf: string;
  onOpenCustomer: (id: string, tab: OverviewTab) => void;
  onShowMissing: () => void;
  onNotice: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const groups = useCollapsedGroups();
  const term = query.trim().toLocaleLowerCase("de");
  const hit = (...values: string[]) => !term || values.some((value) => value.toLocaleLowerCase("de").includes(term));
  const companyOf = (id: string) => state.customers.find((customer) => customer.id === id);

  const attention = needsAttention(state, asOf).filter((row) => hit(row.customer.company, row.customer.customerNumber, row.text, row.sub));
  const soon = upcoming(state, asOf).filter((row) => hit(row.customer.company, row.customer.customerNumber, row.text, row.sub));
  const packages = packageIds.map((id) => ({ id, count: state.customers.filter((customer) => customer.packages.some((item) => item.packageId === id)).length })).filter((row) => hit(packageCatalog[row.id].name));
  const missing = state.customers.filter((customer) => !hasService(customer)).length;
  const recent = state.timeline.slice(0, 8).flatMap((entry) => {
    const customer = companyOf(entry.customerId);
    return customer && hit(entry.title, customer.company, timelineKinds[entry.kind].label) ? [{ entry, customer }] : [];
  });
  const total = Math.max(1, state.customers.length);
  const nothing = Boolean(term) && !attention.length && !soon.length && !packages.length && !recent.length;

  return (
    <>
      <SheetToolbar query={query} onQuery={setQuery} placeholder="Kunde, Domain, Ereignis" label="Überblick durchsuchen" />
      <div className="am-scroll">
        {nothing ? <SheetEmpty text={`Nichts im Überblick passt zu „${query.trim()}“.`} onReset={() => setQuery("")} /> : (
          <table className="file-table cdm-table cdm-admin-table">
            <caption className="visually-hidden">Handlungsbedarf, Fristen, Pakete und Verlauf aller Kunden</caption>
            {(!term || attention.length > 0) && (
              <TableGroup colSpan={COLUMNS} label="Handlungsbedarf" count={attention.length} glyph={<CircleAlert size={16} aria-hidden="true" />} className={attention.length ? "cdm-group-alert" : undefined} collapsed={groups.isCollapsed("attention")} onToggle={() => groups.toggle("attention")} empty="Alles erledigt: Jeder Kunde hat ein Servicepaket, und keine Domain wartet.">
                {attention.map((row) => (
                  <tr key={row.key} className="file-row">
                    <CustomerCell customer={row.customer} title={row.customer.company} sub={row.sub} onOpen={() => onOpenCustomer(row.customer.id, row.tab)} />
                    <td className="cell-category"><span className="status-cell"><StatusGlyph kind={row.glyph} />{row.text}</span></td>
                    <td className="cell-date" />
                    <td className="cell-action"><button type="button" className="cdm-row-link" onClick={() => onOpenCustomer(row.customer.id, row.tab)}>{row.tab === "domains" ? "Domain öffnen" : "Pakete wählen"}<ArrowRight size={14} aria-hidden="true" /></button></td>
                  </tr>
                ))}
              </TableGroup>
            )}
            {(!term || soon.length > 0) && (
              <TableGroup colSpan={COLUMNS} label="Demnächst" count={soon.length} glyph={<CalendarClock size={16} aria-hidden="true" />} collapsed={groups.isCollapsed("soon")} onToggle={() => groups.toggle("soon")} empty="In den nächsten 60 Tagen endet kein Paket, und keine Domain verlängert sich.">
                {soon.map((row) => (
                  <tr key={row.key} className="file-row">
                    <CustomerCell customer={row.customer} title={row.customer.company} sub={row.sub} onOpen={() => onOpenCustomer(row.customer.id, row.tab)} />
                    <td className="cell-category"><span className={`file-dot cdm-dot-${row.tab === "domains" ? "domain" : "todo"}`}><i aria-hidden="true" />{row.text}</span></td>
                    <td className="cell-date numeric"><time dateTime={row.day}>{formatDay(row.day)}</time><small>{inDays(daysUntil(asOf, row.day))}</small></td>
                    <td className="cell-action" />
                  </tr>
                ))}
              </TableGroup>
            )}
            {(!term || packages.length > 0) && (
              <TableGroup colSpan={COLUMNS} label="Pakete" count={state.customers.length} glyph={<Package size={16} aria-hidden="true" />} collapsed={groups.isCollapsed("packages")} onToggle={() => groups.toggle("packages")}>
                {packages.map((row) => {
                  const share = Math.round((row.count / total) * 100);
                  const group = packageCatalog[row.id].group;
                  return (
                    <tr key={row.id} className="file-row">
                      <td className="cell-file"><span className="am-file"><span className={`am-file-icon cdm-file-icon is-${group}`}><Package size={16} aria-hidden="true" /></span><span className="am-file-text"><strong>{packageCatalog[row.id].name}</strong><small>{packageCatalog[row.id].description}</small></span></span></td>
                      <td className="cell-category"><span className="cdm-share" aria-label={`${share} % der Kunden`}><span className={`list-progress is-${group}`}><span style={{ width: `${share}%` }} /></span><b className="numeric">{share} %</b></span></td>
                      <td className="cell-date numeric">{row.count === 1 ? "1 Kunde" : `${row.count} Kunden`}</td>
                      <td className="cell-action" />
                    </tr>
                  );
                })}
                {!term && (
                  <tr className="file-row">
                    <td className="cell-file"><span className="am-file"><span className="am-file-icon cdm-file-icon is-none"><CircleAlert size={16} aria-hidden="true" /></span><span className="am-file-text"><strong>Ohne Servicepaket</strong><small>Kunden ohne Service Lite oder Max</small></span></span></td>
                    <td className="cell-category"><span className="status-cell"><StatusGlyph kind={missing ? "disabled" : "active"} />{missing ? "Paket fehlt" : "Alle haben eins"}</span></td>
                    <td className="cell-date numeric">{missing === 1 ? "1 Kunde" : `${missing} Kunden`}</td>
                    <td className="cell-action">{missing > 0 && <button type="button" className="cdm-row-link" onClick={onShowMissing}>In der Liste<ArrowRight size={14} aria-hidden="true" /></button>}</td>
                  </tr>
                )}
              </TableGroup>
            )}
            {!term && <ServiceQuotaSection quota={state.serviceQuota} customers={state.customers} onOpenCustomer={(id) => onOpenCustomer(id, "contract")} onNotice={onNotice} />}
            {(!term || recent.length > 0) && (
              <TableGroup colSpan={COLUMNS} label="Zuletzt im Verlauf" count={recent.length} glyph={<History size={16} aria-hidden="true" />} collapsed={groups.isCollapsed("recent")} onToggle={() => groups.toggle("recent")} empty="Noch keine Zeitpunkte. Trag beim Kunden zum Beispiel ein, wann eine Rechnung bezahlt wurde.">
                {recent.map(({ entry, customer }) => (
                  <tr key={entry.id} className="file-row">
                    <CustomerCell customer={customer} title={entry.title} sub={[customer.company, entry.amountCents !== null ? formatCents(entry.amountCents) : ""].filter(Boolean).join(" · ")} onOpen={() => onOpenCustomer(customer.id, "contract")} />
                    <td className="cell-category"><span className={`file-dot cdm-dot-${timelineKinds[entry.kind].tone}`}><i aria-hidden="true" />{timelineKinds[entry.kind].label}</span></td>
                    <td className="cell-date numeric">{formatDay(entry.occurredOn)}</td>
                    <td className="cell-action"><span className="status-cell cdm-visibility-state"><StatusGlyph kind={entry.customerVisible ? "active" : "invited"} />{entry.customerVisible ? "Kunde" : "Intern"}</span></td>
                  </tr>
                ))}
              </TableGroup>
            )}
          </table>
        )}
        <ContractTemplatesSection canManage={state.canManage} />
      </div>
      <SheetFooter hint="Ein Klick auf einen Kunden öffnet ihn">
        {state.customers.length === 1 ? "1 Kunde" : `${state.customers.length} Kunden`} · {missing} ohne Servicepaket
      </SheetFooter>
    </>
  );
}
