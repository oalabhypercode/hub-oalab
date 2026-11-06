"use client";

import { useEffect, useState } from "react";
import { Gauge, MinusCircle, PlusCircle, Power, Save } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { packageCatalog, serviceRequestLimits } from "@/lib/service-packages";
import type { ContractCustomer } from "@/lib/hub-contracts/types";
import { blockList, formatBerlinDay, MAX_EXEMPT_REASON, MIN_EXEMPT_REASON, quotaMonth, quotaStatus, usageLine, warnList, type QuotaRow } from "@/lib/hub-service-quota/rules";
import { loadServiceQuotaRequests, setServiceQuotaSwitch, setServiceRequestExempt } from "@/lib/hub-service-quota/actions";
import { quotaRequestFixtures } from "@/lib/hub-service-quota/fixtures";
import type { QuotaRequest, ServiceQuotaState } from "@/lib/hub-service-quota/types";
import { useInfo } from "../info-box";
import { Modal } from "../modal";
import { useContractAction } from "./contracts-parts";

// Vertrag & Domain, stage 3: the Service package sets how many new requests a customer may make on the service
// platform each month (Lite 5, Max 20, none without a package). Admins see the switch, the block list and the
// counted requests of each customer and take single ones out of the count; a customer sees their own state only
// once the switch is on. The database counts and blocks (202611060001 in service-oalab).

const Spinner = () => <MiniLoader size={16} />;
const LITE = serviceRequestLimits["service-lite"];
const MAX = serviceRequestLimits["service-max"];

type Month = ReturnType<typeof quotaMonth>;
type Named = QuotaRow & { company: string };

const packageLine = (row: QuotaRow, month: Month | null) =>
  row.packageId ? `${packageCatalog[row.packageId].short} · ${usageLine(row)} im ${month?.month ?? "Monat"}` : "Kein Servicepaket";

/** The overview's card: switch, whom it blocks (or would block) and who is from 80 % on. Nothing without the migration. */
export function ServiceQuotaSection({ quota, companyOf, onOpenCustomer, onNotice }: {
  quota: ServiceQuotaState;
  companyOf: (customerId: string) => string;
  onOpenCustomer: (customerId: string) => void;
  onNotice: (message: string) => void;
}) {
  const [dialog, setDialog] = useState(false);
  const info = useInfo("So funktionieren die Service-Kontingente", (
    <ul>
      <li>Service Lite erlaubt {LITE}, Service Max {MAX} neue Anfragen je Kalendermonat auf der Serviceplattform, gezählt nach deutscher Zeit. Ohne Servicepaket gehen keine neuen Anfragen.</li>
      <li>Jede abgeschickte neue Anfrage zählt. Antworten in einem Gespräch und Anfragen, die oalab selbst aus Mail oder WhatsApp anlegt, zählen nie.</li>
      <li>Solange die Sperre aus ist, zählt der Hub nur mit, und Kunden sehen davon nichts. Die Sperrliste zeigt, wer beim Einschalten sofort keine neue Anfrage mehr stellen könnte.</li>
      <li>Mit eingeschalteter Sperre sieht der Kunde beim Schreiben ab 80 % eine Vorwarnung, am Limit einen Hinweis mit dem Tag, ab dem es wieder geht, und den Weg zu Nachrichten.</li>
      <li>Einzelne Anfragen nimmst du beim Kunden unter „Vertrag“ aus der Zählung, etwa wenn oalab einen Fehler verursacht hat. Jedes Umschalten steht im Admin-Protokoll.</li>
    </ul>
  ));
  if (!quota.ready) {
    return quota.error ? (
      <section className="cdm-section" aria-labelledby="cdm-quota">
        <h3 id="cdm-quota"><Gauge size={16} aria-hidden="true" />Service-Kontingente</h3>
        <p className="cdm-empty">{quota.error}</p>
      </section>
    ) : null;
  }
  const month = quota.window ? quotaMonth(quota.window) : null;
  const named: Named[] = quota.customers.flatMap((row) => {
    const company = companyOf(row.customerId);
    return company ? [{ ...row, company }] : [];
  });
  const blocked = blockList(named);
  const warned = warnList(named);
  return (
    <section className="cdm-section" aria-labelledby="cdm-quota">
      <h3 id="cdm-quota"><Gauge size={16} aria-hidden="true" />Service-Kontingente{info.button}</h3>
      {info.box}
      <div className="cdm-quota-switch">
        <span className={`chat-pill tone-${quota.enforced ? "ok" : "off"}`}>{quota.enforced ? "Sperre an" : "Sperre aus"}</span>
        <p>
          {quota.enforced
            ? `Am Limit und ohne Servicepaket gehen keine neuen Anfragen${month ? `, bis zum ${month.resetDay}` : ""}.`
            : "Kunden stellen weiter unbegrenzt neue Anfragen. Gezählt wird schon, Kunden sehen davon noch nichts."}
        </p>
        {quota.canManage && (
          <button type="button" className={`sheet-action${quota.enforced ? "" : " is-primary"}`} onClick={() => setDialog(true)}>
            <Power size={15} aria-hidden="true" />{quota.enforced ? "Sperre ausschalten" : "Sperre einschalten"}
          </button>
        )}
      </div>
      {quota.switchedBy && quota.switchedAt && (
        <p className="cdm-empty">Zuletzt {quota.enforced ? "eingeschaltet" : "ausgeschaltet"} am {formatBerlinDay(quota.switchedAt)} von {quota.switchedBy}.</p>
      )}
      <div className="cdm-quota-group">
        <h4>{quota.enforced ? "Gesperrt" : "Beim Einschalten gesperrt"}<span className="numeric">{blocked.length}</span></h4>
        {blocked.length ? (
          <ul className="cdm-rows">
            {blocked.map((row) => (
              <li key={row.customerId}>
                <button type="button" className="cdm-link" onClick={() => onOpenCustomer(row.customerId)}>{row.company}</button>
                <span className="cdm-muted">{packageLine(row, month)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="cdm-empty">Niemand: Alle Kunden mit Zugang zur Serviceplattform haben ein Servicepaket und noch Anfragen frei.</p>}
      </div>
      {warned.length > 0 && (
        <div className="cdm-quota-group">
          <h4>Ab 80 %<span className="numeric">{warned.length}</span></h4>
          <ul className="cdm-rows">
            {warned.map((row) => (
              <li key={row.customerId}>
                <button type="button" className="cdm-link" onClick={() => onOpenCustomer(row.customerId)}>{row.company}</button>
                <span className="cdm-muted">{packageLine(row, month)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {dialog && (
        <QuotaSwitchDialog
          enforce={!quota.enforced}
          blocked={blocked}
          onClose={() => setDialog(false)}
          onDone={(on) => { setDialog(false); onNotice(on ? "Die Anfragen-Sperre ist eingeschaltet." : "Die Anfragen-Sperre ist ausgeschaltet."); }}
        />
      )}
    </section>
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
 * Kunde → Vertrag: the state of this month and every request that counts, newest first, with „Nicht mitzählen“ (a
 * short internal reason) and „Wieder mitzählen“. The list loads when the card opens; the examples use fixtures.
 */
export function CustomerQuotaCard({ customer, quota, fixtures, onNotice }: { customer: ContractCustomer; quota: ServiceQuotaState; fixtures: boolean; onNotice: (message: string) => void }) {
  const row = quota.customers.find((item) => item.customerId === customer.id) ?? null;
  const listed = Boolean(row) && (fixtures || quota.canManage);
  const [requests, setRequests] = useState<QuotaRequest[] | null>(() => fixtures ? quotaRequestFixtures(customer.id) : null);
  const [loadError, setLoadError] = useState("");
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState<QuotaRequest | null>(null);
  const { busy, error, run } = useContractAction();
  const info = useInfo("So zählen die Anfragen", (
    <ul>
      <li>Hier stehen die neuen Anfragen dieses Kunden auf der Serviceplattform im laufenden Kalendermonat (deutsche Zeit), neueste zuerst. Antworten in einem Gespräch zählen nie.</li>
      <li>„Nicht mitzählen“ nimmt eine Anfrage aus dem Kontingent, etwa bei einem Fehler, den oalab verursacht hat. Der kurze Grund ist nur für das oalab-Team.</li>
      <li>„Wieder mitzählen“ macht das rückgängig. Beides steht im Admin-Protokoll.</li>
      <li>Der Kunde sieht nur die Zahl, nicht welche Anfrage ausgenommen ist und warum.</li>
      <li>Am 1. des nächsten Monats beginnt die Zählung neu. Ein Paketwechsel gilt für den ganzen laufenden Monat.</li>
    </ul>
  ));

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
  return (
    <section className="cdm-section" aria-labelledby="cdm-quota-customer">
      <h3 id="cdm-quota-customer"><Gauge size={16} aria-hidden="true" />Service-Anfragen{month ? ` im ${month.month}` : ""}{info.button}</h3>
      {info.box}
      {!row ? <p className="cdm-empty">Dieser Kunde hat keinen Zugang zur Serviceplattform. Dort gibt es nichts zu zählen.</p> : (
        <>
          <QuotaMeter row={row} />
          <p className="cdm-empty">{statusText(row, month, quota.enforced)}</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          {loadError ? <p className="form-error" role="alert">{loadError}</p> : requests === null ? <Spinner /> : requests.length ? (
            <ol className="cdm-entries">
              {requests.map((request) => (
                <li key={request.requestId} className={`cdm-entry${request.exemption ? " is-exempt" : ""}`}>
                  <time className="cdm-entry-day numeric" dateTime={request.submittedAt}>{formatBerlinDay(request.submittedAt)}</time>
                  <div className="cdm-entry-main">
                    <div className="cdm-entry-top">
                      <span className="chat-pill tone-info">{request.reference}</span>
                      <strong>{request.title || "Ohne Titel"}</strong>
                      {request.exemption && <span className="chat-pill tone-off">zählt nicht</span>}
                      {request.trashed && <span className="chat-pill tone-off">im Papierkorb</span>}
                    </div>
                    {request.exemption && <small className="cdm-entry-by">„{request.exemption.reason}“ · {request.exemption.byName}, {formatBerlinDay(request.exemption.createdAt)}</small>}
                  </div>
                  {quota.canManage && (
                    <div className="cdm-entry-acts">
                      {request.exemption ? (
                        <button
                          type="button"
                          className="cdm-visibility"
                          disabled={busy !== null}
                          aria-label={`${request.reference} wieder mitzählen`}
                          onClick={() => run(request.requestId, () => setServiceRequestExempt({ customerId: customer.id, requestId: request.requestId, exempt: false }), () => changed(`${request.reference} zählt wieder mit.`))}
                        >
                          {busy === request.requestId ? <Spinner /> : <PlusCircle size={14} aria-hidden="true" />}<span>Wieder mitzählen</span>
                        </button>
                      ) : (
                        <button type="button" className="cdm-visibility" disabled={busy !== null} aria-label={`${request.reference} nicht mitzählen`} onClick={() => setDialog(request)}>
                          <MinusCircle size={14} aria-hidden="true" /><span>Nicht mitzählen</span>
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          ) : <p className="cdm-empty">In diesem Monat hat der Kunde noch keine neue Anfrage gestellt.</p>}
        </>
      )}
      {dialog && <ExemptDialog customer={customer} request={dialog} onClose={() => setDialog(null)} onDone={() => { setDialog(null); changed(`${dialog.reference} zählt nicht mehr mit.`); }} />}
    </section>
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
 * The customer's own line under „Deine Pakete“, only while the switch is on: how many requests this month, and from
 * when all are free again.
 */
export function CustomerQuotaLine({ quota, customerId }: { quota: ServiceQuotaState; customerId: string }) {
  const info = useInfo("So zählen deine Anfragen", (
    <ul>
      <li>Service Lite enthält {LITE}, Service Max {MAX} neue Anfragen je Kalendermonat auf der Serviceplattform. Ohne Servicepaket kannst du dort keine neuen Anfragen stellen.</li>
      <li>Jede abgeschickte neue Anfrage zählt. Antworten in einem bestehenden Gespräch zählen nicht.</li>
      <li>Am 1. des nächsten Monats um Mitternacht (deutsche Zeit) beginnt die Zählung neu.</li>
      <li>Ab 80 % siehst du beim Schreiben eine Vorwarnung. Sind alle aufgebraucht, geht bis zum Monatswechsel keine neue Anfrage; bei etwas Dringendem schreib uns unter Nachrichten.</li>
    </ul>
  ));
  const row = quota.enforced ? quota.customers.find((item) => item.customerId === customerId) : undefined;
  if (!row || !quota.window) return null;
  const month = quotaMonth(quota.window);
  const status = quotaStatus(row);
  const text = status === "none"
    ? "Ohne Servicepaket kannst du auf der Serviceplattform keine neuen Anfragen stellen."
    : status === "full"
      ? `Im ${month.month} sind alle ${row.monthlyLimit} Anfragen genutzt. Neue Anfragen gehen wieder ab dem ${month.resetDay}.`
      : `Im ${month.month} ${row.monthlyUsed} von ${row.monthlyLimit} Anfragen genutzt, ab dem ${month.resetDay} wieder ${row.monthlyLimit}.`;
  return (
    <div className="cdm-quota-line">
      <p>{status !== "ok" && <span className="chat-pill tone-todo">{status === "none" ? "Kein Servicepaket" : status === "full" ? "Aufgebraucht" : "Ab 80 %"}</span>}<span>{text}</span>{info.button}</p>
      {info.box}
    </div>
  );
}
