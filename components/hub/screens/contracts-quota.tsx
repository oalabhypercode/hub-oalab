"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Gauge, MessageSquare, MinusCircle, PlusCircle, Power, Save } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { packageCatalog, serviceRequestLimits } from "@/lib/service-packages";
import type { ContractCustomer } from "@/lib/hub-contracts/types";
import { blockList, formatBerlinDay, MAX_EXEMPT_REASON, MIN_EXEMPT_REASON, quotaMonth, quotaStatus, usageLine, warnList, type QuotaRow } from "@/lib/hub-service-quota/rules";
import { loadServiceQuotaRequests, setServiceQuotaSwitch, setServiceRequestExempt } from "@/lib/hub-service-quota/actions";
import { quotaRequestFixtures } from "@/lib/hub-service-quota/fixtures";
import type { QuotaRequest, ServiceQuotaState } from "@/lib/hub-service-quota/types";
import { useInfo } from "../info-box";
import { Modal } from "../modal";
import { StatusGlyph, TableGroup, useCollapsedGroups, type GlyphKind } from "../sheet";
import { CustomerSign } from "./customer-sign";
import { useContractAction } from "./contracts-parts";

// Vertrag & Domain, stage 3: the Service package sets how many new requests a customer may make on the service
// platform each month (Lite 5, Max 20, none without a package). Admins see the switch, the block list and the
// counted requests of each customer and take single ones out of the count; a customer sees their own state only
// once the switch is on. The database counts and blocks (202611060001 in service-oalab).

const Spinner = () => <MiniLoader size={16} />;
const LITE = serviceRequestLimits["service-lite"];
const MAX = serviceRequestLimits["service-max"];
/** Columns of the overview table it joins: Eintrag, Art, Datum, Aktion. */
const QUOTA_COLUMNS = 4;

type Month = ReturnType<typeof quotaMonth>;
type Named = QuotaRow & { company: string };

const packageLine = (row: QuotaRow, month: Month | null) =>
  row.packageId ? `${packageCatalog[row.packageId].short} · ${usageLine(row)} im ${month?.month ?? "Monat"}` : "Kein Servicepaket";

/**
 * The overview's group „Service-Kontingente“: the switch as the first row, then whom it blocks (or would block) and
 * who is from 80 % on, each opening the customer. Nothing without the migration, the error with it.
 */
export function ServiceQuotaSection({ quota, customers, onOpenCustomer, onNotice }: {
  quota: ServiceQuotaState;
  customers: readonly ContractCustomer[];
  onOpenCustomer: (customerId: string) => void;
  onNotice: (message: string) => void;
}) {
  const [dialog, setDialog] = useState(false);
  const groups = useCollapsedGroups();
  const info = useInfo("Service-Kontingente", {
    steps: [
      <><b>Service Lite {LITE}, Max {MAX}</b> neue Anfragen im Monat.</>,
      <><b>Antworten</b> in einem Gespräch zählen nie.</>,
      <><b>Sperre aus:</b> Der Hub zählt nur mit.</>,
    ],
    warn: "Einschalten sperrt sofort, wer am Limit ist.",
    ask: "Wie funktionieren die Service-Kontingente?",
  });
  if (!quota.ready) {
    return quota.error
      ? <TableGroup colSpan={QUOTA_COLUMNS} label="Service-Kontingente" count={0} glyph={<Gauge size={16} aria-hidden="true" />} collapsed={false} onToggle={() => undefined} empty={quota.error} />
      : null;
  }
  const month = quota.window ? quotaMonth(quota.window) : null;
  const named: Named[] = quota.customers.flatMap((row) => {
    const customer = customers.find((item) => item.id === row.customerId);
    return customer ? [{ ...row, company: customer.company }] : [];
  });
  const blocked = blockList(named);
  const warned = warnList(named);
  const customerRow = (row: Named, glyph: GlyphKind, label: string) => {
    const customer = customers.find((item) => item.id === row.customerId);
    if (!customer) return null;
    return (
      <tr key={`${label}-${row.customerId}`} className="file-row">
        <td className="cell-file">
          <button type="button" className="am-file" onClick={() => onOpenCustomer(row.customerId)}>
            <CustomerSign customer={customer} logo={customer.logo} size="md" />
            <span className="am-file-text"><strong>{customer.company}</strong><small>{packageLine(row, month)}</small></span>
          </button>
        </td>
        <td className="cell-category"><span className="status-cell"><StatusGlyph kind={glyph} />{label}</span></td>
        <td className="cell-date"><QuotaCell quota={quota} customerId={row.customerId} /></td>
        <td className="cell-action"><button type="button" className="cdm-row-link" onClick={() => onOpenCustomer(row.customerId)}>Öffnen<ArrowRight size={14} aria-hidden="true" /></button></td>
      </tr>
    );
  };
  return (
    <TableGroup colSpan={QUOTA_COLUMNS} label="Service-Kontingente" count={blocked.length + warned.length} glyph={<Gauge size={16} aria-hidden="true" />} collapsed={groups.isCollapsed("quota")} onToggle={() => groups.toggle("quota")} actions={info.button}>
      <tr className="file-row cdm-quota-switch-row">
        <td className="cell-file">
          <span className="am-file">
            <span className={`am-file-icon cdm-file-icon${quota.enforced ? "" : " is-off"}`}><Power size={16} aria-hidden="true" /></span>
            <span className="am-file-text">
              <strong>Anfragen-Sperre</strong>
              <small>{quota.enforced
                ? `Am Limit und ohne Servicepaket gehen keine neuen Anfragen${month ? `, bis zum ${month.resetDay}` : ""}.`
                : "Kunden stellen weiter unbegrenzt neue Anfragen; gezählt wird schon."}</small>
            </span>
          </span>
        </td>
        <td className="cell-category"><span className="status-cell"><StatusGlyph kind={quota.enforced ? "active" : "invited"} />{quota.enforced ? "Sperre an" : "Sperre aus"}</span></td>
        <td className="cell-date" data-tip={quota.switchedBy ? `von ${quota.switchedBy}` : undefined}>{quota.switchedAt ? `${quota.enforced ? "an" : "aus"} seit ${formatBerlinDay(quota.switchedAt)}` : ""}</td>
        <td className="cell-action">
          {quota.canManage && (
            <button type="button" className={`sheet-action${quota.enforced ? "" : " is-primary"}`} onClick={() => setDialog(true)}>
              <Power size={15} aria-hidden="true" />{quota.enforced ? "Ausschalten" : "Einschalten"}
            </button>
          )}
          {info.box}
          {dialog && (
            <QuotaSwitchDialog
              enforce={!quota.enforced}
              blocked={blocked}
              onClose={() => setDialog(false)}
              onDone={(on) => { setDialog(false); onNotice(on ? "Die Anfragen-Sperre ist eingeschaltet." : "Die Anfragen-Sperre ist ausgeschaltet."); }}
            />
          )}
        </td>
      </tr>
      {blocked.map((row) => customerRow(row, "disabled", quota.enforced ? "Gesperrt" : "Beim Einschalten gesperrt"))}
      {warned.map((row) => customerRow(row, "pending", "Ab 80 %"))}
      {!blocked.length && <tr className="table-empty-row"><td colSpan={QUOTA_COLUMNS}>Niemand gesperrt: Alle Kunden mit Zugang zur Serviceplattform haben ein Servicepaket und noch Anfragen frei.</td></tr>}
    </TableGroup>
  );
}

/** Asks once more before the switch changes, with the customers it blocks right away. */
function QuotaSwitchDialog({ enforce, blocked, onClose, onDone }: { enforce: boolean; blocked: readonly Named[]; onClose: () => void; onDone: (enforced: boolean) => void }) {
  const { busy, error, run } = useContractAction();
  return (
    <Modal title={enforce ? "Anfragen-Sperre einschalten" : "Anfragen-Sperre ausschalten"} onClose={onClose} className="users-modal">
      <div className="cdm-dialog">
        {enforce ? (
          <>
            <p className="field-hint">Ab sofort gilt auf der Serviceplattform das Servicepaket: Service Lite {LITE}, Service Max {MAX} neue Anfragen im Monat, ohne Servicepaket keine. Kunden sehen ab 80 % eine Vorwarnung.</p>
            <p className="field-hint">{blocked.length ? `Sofort gesperrt: ${blocked.map((row) => row.company).join(", ")}.` : "Sofort gesperrt wäre niemand."}</p>
          </>
        ) : (
          <p className="field-hint">Kunden stellen dann wieder unbegrenzt neue Anfragen, und die Hinweise auf der Serviceplattform verschwinden. Gezählt wird weiter.</p>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button
          type="button"
          className={`sheet-button${enforce ? " sheet-button-primary" : ""}`}
          disabled={busy !== null}
          onClick={() => run("switch", () => setServiceQuotaSwitch({ enforced: enforce }), (data) => onDone(data.enforced))}
        >
          {busy ? <Spinner /> : <Power size={18} aria-hidden="true" />}{enforce ? "Ja, Sperre einschalten" : "Ja, Sperre ausschalten"}
        </button>
        <button type="button" className="sheet-button" disabled={busy !== null} onClick={onClose}>Abbrechen</button>
      </div>
    </Modal>
  );
}

/** „3 von 5“ with a bar; without a package only the count. */
function QuotaMeter({ row }: { row: QuotaRow }) {
  const status = quotaStatus(row);
  if (status === "none") return <p className="cdm-quota-count"><strong className="numeric">{usageLine(row)}</strong> diesen Monat · kein Servicepaket</p>;
  const share = Math.min(1, row.monthlyUsed / row.monthlyLimit);
  return (
    <div className="cdm-meter-row">
      <div className={`cdm-meter is-${status}`} role="meter" aria-valuemin={0} aria-valuemax={row.monthlyLimit} aria-valuenow={Math.min(row.monthlyUsed, row.monthlyLimit)} aria-label="Anfragen in diesem Monat">
        <span style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
      <strong className="numeric">{usageLine(row)}</strong>
    </div>
  );
}

function statusText(row: QuotaRow, month: Month | null, enforced: boolean) {
  const reset = month ? ` ab dem ${month.resetDay}` : " zum Monatswechsel";
  const exempted = row.exempted ? ` ${row.exempted === 1 ? "Eine Anfrage zählt" : `${row.exempted} Anfragen zählen`} nicht mit.` : "";
  switch (quotaStatus(row)) {
    case "none": return (enforced ? "Ohne Servicepaket kann der Kunde keine neuen Anfragen stellen." : "Ohne Servicepaket könnte der Kunde mit eingeschalteter Sperre keine neuen Anfragen stellen.") + exempted;
    case "full": return (enforced ? `Aufgebraucht: Neue Anfragen gehen wieder${reset}.` : `Am Limit: Mit eingeschalteter Sperre gingen neue Anfragen erst wieder${reset}.`) + exempted;
    case "warn": return (enforced ? `Ab 80 %: Der Kunde sieht beim Schreiben eine Vorwarnung.` : `Ab 80 %: Mit eingeschalteter Sperre sähe der Kunde eine Vorwarnung.`) + exempted;
    default: return `Noch ${row.monthlyLimit - row.monthlyUsed} frei,${reset} wieder ${row.monthlyLimit}.${exempted}`;
  }
}

/**
 * Kunde → Vertrag: the group „Service-Anfragen im <Monat>“ of the tab's table: the state of this month as its first
 * row, then every request that counts, newest first, with „Nicht mitzählen“ (a short internal reason) and „Wieder
 * mitzählen“. The list loads when the tab opens; the examples use fixtures.
 */
export function CustomerQuotaCard({ customer, quota, fixtures, onNotice }: { customer: ContractCustomer; quota: ServiceQuotaState; fixtures: boolean; onNotice: (message: string) => void }) {
  const row = quota.customers.find((item) => item.customerId === customer.id) ?? null;
  const listed = Boolean(row) && (fixtures || quota.canManage);
  const [requests, setRequests] = useState<QuotaRequest[] | null>(() => fixtures ? quotaRequestFixtures(customer.id) : null);
  const [loadError, setLoadError] = useState("");
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState<QuotaRequest | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const { busy, error, run } = useContractAction();
  const info = useInfo("Service-Anfragen", {
    steps: [
      <><b>Neue Anfragen</b> dieses Monats, neueste zuerst.</>,
      <><b>Nicht mitzählen</b> mit kurzem internen Grund.</>,
      <><b>Der Kunde</b> sieht nur die Zahl.</>,
    ],
    ask: "Wie nehme ich eine Anfrage aus der Zählung?",
  });

  useEffect(() => {
    if (fixtures || !listed) return;
    let live = true;
    loadServiceQuotaRequests({ customerId: customer.id })
      .then((result) => {
        if (!live) return;
        if (result.ok) { setRequests(result.data); setLoadError(""); } else setLoadError(result.error);
      })
      .catch(() => { if (live) setLoadError("Die Anfragen konnten gerade nicht geladen werden. Bitte versuche es erneut."); });
    return () => { live = false; };
  }, [customer.id, fixtures, listed, version]);

  if (!quota.ready) return null;
  const month = quota.window ? quotaMonth(quota.window) : null;
  const changed = (message: string) => { setVersion((value) => value + 1); onNotice(message); };
  const note = (text: string) => <tr className="table-empty-row"><td colSpan={QUOTA_COLUMNS}>{text}</td></tr>;
  return (
    <TableGroup
      colSpan={QUOTA_COLUMNS}
      label={`Service-Anfragen${month ? ` im ${month.month}` : ""}`}
      count={requests?.length ?? 0}
      glyph={<Gauge size={16} aria-hidden="true" />}
      collapsed={collapsed}
      onToggle={() => setCollapsed(!collapsed)}
      actions={info.button}

    >
      {!row ? note("Dieser Kunde hat keinen Zugang zur Serviceplattform. Dort gibt es nichts zu zählen.") : (
        <>
          <tr className="file-row cdm-quota-meter">
            <td className="cell-file">
              <span className="am-file">
                <span className="am-file-icon cdm-file-icon is-service"><Gauge size={16} aria-hidden="true" /></span>
                <span className="am-file-text"><strong>Diesen Monat</strong><small>{statusText(row, month, quota.enforced)}</small></span>
              </span>
            </td>
            <td className="cell-category" colSpan={2}><QuotaMeter row={row} /></td>
            <td className="cell-action" />
          </tr>
          {error && note(error)}
          {loadError ? note(loadError) : requests === null ? <tr className="table-empty-row"><td colSpan={QUOTA_COLUMNS}><Spinner /></td></tr> : requests.length ? requests.map((request) => (
            <tr key={request.requestId} className={`file-row${request.exemption ? " is-exempt" : ""}`}>
              <td className="cell-file">
                <span className="am-file">
                  <span className="am-file-icon cdm-file-icon"><MessageSquare size={16} aria-hidden="true" /></span>
                  <span className="am-file-text">
                    <strong>{request.title || "Ohne Titel"}</strong>
                    <small>{[request.reference, request.trashed ? "im Papierkorb" : "", request.exemption ? `„${request.exemption.reason}“ · ${request.exemption.byName}, ${formatBerlinDay(request.exemption.createdAt)}` : ""].filter(Boolean).join(" · ")}</small>
                  </span>
                </span>
              </td>
              <td className="cell-category"><span className="status-cell"><StatusGlyph kind={request.exemption ? "rejected" : "active"} />{request.exemption ? "zählt nicht" : "zählt"}</span></td>
              <td className="cell-date numeric"><time dateTime={request.submittedAt}>{formatBerlinDay(request.submittedAt)}</time></td>
              <td className="cell-action">
                {quota.canManage && (request.exemption ? (
                  <button
                    type="button"
                    className="cdm-release"
                    disabled={busy !== null}
                    aria-label={`${request.reference} wieder mitzählen`}
                    onClick={() => run(request.requestId, () => setServiceRequestExempt({ customerId: customer.id, requestId: request.requestId, exempt: false }), () => changed(`${request.reference} zählt wieder mit.`))}
                  >
                    {busy === request.requestId ? <Spinner /> : <PlusCircle size={14} aria-hidden="true" />}<span>Wieder mitzählen</span>
                  </button>
                ) : (
                  <button type="button" className="cdm-release" disabled={busy !== null} aria-label={`${request.reference} nicht mitzählen`} onClick={() => setDialog(request)}>
                    <MinusCircle size={14} aria-hidden="true" /><span>Nicht mitzählen</span>
                  </button>
                ))}
              </td>
            </tr>
          )) : note("In diesem Monat hat der Kunde noch keine neue Anfrage gestellt.")}
        </>
      )}
      <tr className="cdm-quota-slot">
        <td colSpan={QUOTA_COLUMNS}>
          {info.box}
          {dialog && <ExemptDialog customer={customer} request={dialog} onClose={() => setDialog(null)} onDone={() => { setDialog(null); changed(`${dialog.reference} zählt nicht mehr mit.`); }} />}
        </td>
      </tr>
    </TableGroup>
  );
}

/** Asks for the short internal reason before a request leaves the count. */
function ExemptDialog({ customer, request, onClose, onDone }: { customer: ContractCustomer; request: QuotaRequest; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const { busy, error, run } = useContractAction();
  return (
    <Modal title={`${request.reference} nicht mitzählen`} onClose={onClose} className="users-modal">
      <form className="cdm-dialog" onSubmit={(event) => {
        event.preventDefault();
        run("save", () => setServiceRequestExempt({ customerId: customer.id, requestId: request.requestId, exempt: true, reason }), onDone);
      }}>
        <p className="field-hint">{customer.company} · {request.title || "Ohne Titel"}</p>
        <label className="upload-field upload-field-wide">
          <span>Grund (nur für das oalab-Team)</span>
          <input value={reason} onChange={(event) => setReason(event.target.value)} minLength={MIN_EXEMPT_REASON} maxLength={MAX_EXEMPT_REASON} required placeholder="Fehler von oalab beim letzten Update" disabled={busy !== null} />
        </label>
        <p className="field-hint">Die Anfrage fällt aus der Zählung dieses Monats. Der Kunde sieht nur die neue Zahl.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="sheet-button sheet-button-primary" disabled={busy !== null}>{busy ? <Spinner /> : <Save size={18} aria-hidden="true" />}Nicht mitzählen</button>
      </form>
    </Modal>
  );
}

/**
 * The table „Alle Kunden“: this month's count, also without a package („1 Anfrage · kein Paket“); amber where the
 * switch blocks or would block; „–“ for customers without access to the service platform.
 */
export function QuotaCell({ quota, customerId }: { quota: ServiceQuotaState; customerId: string }) {
  const row = quota.customers.find((item) => item.customerId === customerId);
  if (!row) return <span className="cell-none">–</span>;
  const status = quotaStatus(row);
  const text = status === "none" ? `${usageLine(row)} · kein Paket` : usageLine(row);
  return status === "none" || status === "full"
    ? <span className="chat-pill tone-todo numeric">{text}</span>
    : <span className="numeric">{text}</span>;
}

/**
 * The customer's own row in the group „Pakete“ of their sheet, only while the switch is on: how many requests this
 * month, and from when all are free again.
 */
export function CustomerQuotaLine({ quota, customerId }: { quota: ServiceQuotaState; customerId: string }) {
  const info = useInfo("Deine Anfragen", {
    steps: [
      <><b>Service Lite {LITE}, Max {MAX}</b> neue Anfragen im Monat.</>,
      <><b>Antworten</b> in einem Gespräch zählen nicht.</>,
      <><b>Am 1. des Monats</b> beginnt die Zählung neu.</>,
    ],
    ask: "Wie zählen meine Anfragen auf der Serviceplattform?",
  });
  const row = quota.enforced ? quota.customers.find((item) => item.customerId === customerId) : undefined;
  if (!row || !quota.window) return null;
  const month = quotaMonth(quota.window);
  const status = quotaStatus(row);
  const glyph = status === "ok" ? "active" : status === "warn" ? "pending" : "disabled";
  const state = status === "ok" ? "frei" : status === "warn" ? "ab 80 %" : status === "full" ? "aufgebraucht" : "kein Paket";
  return (
    <tr className="file-row cdm-quota-row">
      <td className="cell-file"><span className="file-open"><Gauge size={16} strokeWidth={1.9} className="cdm-row-icon" aria-hidden="true" /><strong>Anfragen im {month.month}</strong></span></td>
      <td className="cell-category"><span className="file-dot cdm-dot-service"><i aria-hidden="true" />Service</span></td>
      <td className="cell-description col-description">{status === "none" ? "Ohne Servicepaket gehen keine neuen Anfragen." : `${row.monthlyUsed} von ${row.monthlyLimit} genutzt`}</td>
      <td className="cell-date">{status === "none" ? "" : `ab dem ${month.resetDay} wieder ${row.monthlyLimit}`}</td>
      <td className="cell-state"><span className="status-cell"><StatusGlyph kind={glyph} />{state}</span></td>
      <td className="cell-action">{info.button}{info.box}</td>
    </tr>
  );
}
