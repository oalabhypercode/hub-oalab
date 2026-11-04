"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { setCustomerFreelancers } from "@/lib/hub-users/actions";
import type { FileAudience, HubFileCustomer } from "@/lib/hub-files/types";
import { Modal } from "../modal";
import { CustomerPicker } from "./files-parts";

/** The words for "Sichtbar für" at a customer, as admins choose it. */
export const audienceLabels: Record<FileAudience, string> = { both: "Kunde und Freelancer", customer: "Nur Kunde", freelancer: "Nur Freelancer" };

/** The small tag at a file in the list, or null when both sides see it. */
export function audienceTag(audience: FileAudience | undefined, freelancerView: boolean) {
  if (!audience || audience === "both") return null;
  if (freelancerView) return audience === "freelancer" ? "Nur für dich" : null;
  return audience === "freelancer" ? "Nur Freelancer" : "Nur Kunde";
}

/** Names of the freelancers who look after a customer, or "" for none. */
export function servedByNames(customer: HubFileCustomer, freelancers: HubFileCustomer[]) {
  return (customer.freelancerIds ?? []).flatMap((id) => freelancers.find((item) => item.id === id)?.company ?? []).join(", ");
}

/**
 * Admins pick the freelancers who look after one customer, from the head of the customer in the asset management. The
 * freelancers then see the customer and the files shared with them; the customer notices nothing.
 */
export function ServedByDialog({ customer, freelancers, onClose, onSaved }: { customer: HubFileCustomer; freelancers: HubFileCustomer[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [selected, setSelected] = useState(customer.freelancerIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      const result = await setCustomerFreelancers({ customerId: customer.id, freelancerIds: selected });
      if (!result.ok) { setError(result.error); return; }
      onSaved(selected.length ? `${customer.company} wird jetzt von ${selected.length === 1 ? "einem Freelancer" : `${selected.length} Freelancern`} mitbetreut.` : `${customer.company} betreut jetzt nur das oalab-Team.`);
    } catch {
      setError("Das hat gerade nicht geklappt. Bitte versuche es erneut.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Betreut von · ${customer.company}`} onClose={onClose} className="users-modal">
      <CustomerPicker customers={freelancers.map(({ id, customerNumber, company }) => ({ id, customerNumber, company }))} selected={selected} onChange={setSelected} idPrefix={`served-${customer.id}`} legend="Freelancer" emptyHint="nur vom oalab-Team" />
      <p className="field-hint">Ein Freelancer sieht Namen, Logo, Kontaktdaten und die freigegebenen Dateien dieses Kunden, nur lesend. Verträge, Angebote und Rechnungen sieht er nicht, außer du stellst sie in den Details auf „Kunde und Freelancer“. Chats, Termine und Logins des Kunden bleiben ihm verborgen; der Kunde sieht nicht, wer ihn betreut.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="file-assign-actions">
        <button type="button" className="sheet-button" onClick={onClose} disabled={busy}>Abbrechen</button>
        <button type="button" className="sheet-button sheet-button-primary" onClick={save} disabled={busy}>{busy ? <MiniLoader size={18} /> : <Check size={18} aria-hidden="true" />}Speichern</button>
      </div>
    </Modal>
  );
}
