"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { archiveCustomer, deleteCustomer, previewCustomerRemoval, restoreCustomer, type ActionResult, type CustomerDeletion, type CustomerRemovalPreview } from "@/lib/hub-users/actions";
import type { ManagedCustomer, ManagedUser } from "@/lib/hub-users/types";
import { formatFileDateTime } from "@/lib/hub-files/catalog";
import { useInfo } from "../info-box";
import { PanelSection, Row, RowIcon, RowList } from "./users-panel";

/*
 * Archive, restore and delete a customer or a freelancer (user 17.11.2026, clean-up before the official start). In
 * the master data of its panel: a notice on top while it is archived, the actions at the end. Archiving hides it
 * everywhere but the User Management and blocks its logins; deleting takes everything the hub holds for it, after a
 * preview and the typed number. lib/hub-users/actions.ts and the database (service-oalab 202611170001) do the work.
 */

const count = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;
const Spinner = () => <MiniLoader size={16} />;

/** What deleting takes along and what stays, as short lines for the confirmation. */
export function removalLines(preview: CustomerRemovalPreview) {
  const gone = [
    preview.logins ? count(preview.logins, "Zugang", "Zugänge") : "",
    preview.files ? count(preview.files, "Datei", "Dateien") : "",
    preview.folders ? count(preview.folders, "Ordner", "Ordner") : "",
    preview.appointments ? `${count(preview.appointments, "Termin", "Termine")}${preview.upcoming ? ` (${preview.upcoming} kommend)` : ""}` : "",
    preview.packages ? count(preview.packages, "Paket", "Pakete") : "",
    preview.domains ? count(preview.domains, "Domain", "Domains") : "",
    preview.accesses ? count(preview.accesses, "Eintrag der Zugangsdaten", "Einträge der Zugangsdaten") : "",
    preview.messages ? count(preview.messages, "Chat-Nachricht", "Chat-Nachrichten") : "",
  ].filter(Boolean);
  const kept = [
    preview.sharedFiles ? `${count(preview.sharedFiles, "geteilte Datei", "geteilte Dateien")} bei den anderen Kunden` : "",
    preview.service ? `in Service die archivierte Firma${preview.service.requests ? ` mit ${count(preview.service.requests, "Anfrage", "Anfragen")}` : ""}${preview.service.projects ? `${preview.service.requests ? " und" : " mit"} ${count(preview.service.projects, "Projekt", "Projekten")}` : ""}` : "",
  ].filter(Boolean);
  return { gone, kept };
}

/** The notice after a deletion: what happened to the logins and, if any, to the stored bytes. */
export function deletionNotice(name: string, result: CustomerDeletion) {
  const parts = [
    result.removed ? `${count(result.removed, "Zugang", "Zugänge")} gelöscht` : "",
    result.blocked ? `${count(result.blocked, "Zugang", "Zugänge")} gesperrt, weil Service noch auf ${result.blocked === 1 ? "ihn" : "sie"} verweist` : "",
    result.detached ? `${count(result.detached, "Team- oder Admin-Zugang", "Team- oder Admin-Zugänge")} nur gelöst` : "",
  ].filter(Boolean);
  const storage = result.storageFailed ? " Ein paar Dateien ließen sich nicht aus dem Speicher entfernen; erreichbar sind sie nicht mehr." : "";
  return `${name} ist endgültig gelöscht${parts.length ? `: ${parts.join(", ")}` : ""}.${storage}`;
}

/**
 * Archive, restore and delete for one entry of the User Management: `notice` goes on top of its master data while it
 * is archived, `section` at their end. Nothing for a new entry.
 */
export function useEntryRemoval({ entry, users, onNotice, onClose }: {
  entry: ManagedCustomer | undefined;
  users: ManagedUser[];
  onNotice: (message: string) => void;
  onClose: (discard?: boolean) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<"archive" | "delete" | null>(null);
  const [preview, setPreview] = useState<CustomerRemovalPreview | null>(null);
  const [typed, setTyped] = useState("");
  const freelancer = entry?.kind === "freelancer";
  const title = "Archivieren oder löschen";
  const info = useInfo("Archivieren oder löschen", {
    steps: [
      <><b>Archivieren</b> blendet überall aus und sperrt die Zugänge.</>,
      <><b>Wiederherstellen</b> holt alles zurück, auch die Zugänge.</>,
      <><b>Löschen</b> entfernt alles im Hub, nicht umkehrbar.</>,
    ],
    ask: "Was passiert beim Archivieren und Löschen eines Kunden?",
  });
  if (!entry) return { notice: null, section: null };

  async function run<T>(key: string, action: () => Promise<ActionResult<T>>, onDone: (data: T) => void) {
    setBusy(key);
    setError("");
    try {
      const result = await action();
      if (result.ok) onDone(result.data);
      else setError(result.error);
    } catch {
      setError("Das hat gerade nicht geklappt. Bitte versuche es erneut.");
    } finally {
      setBusy(null);
    }
  }
  const cancel = () => { setConfirming(null); setTyped(""); setError(""); };
  const word = freelancer ? "Freelancer" : "Kunde";
  // The logins an archive blocks: active ones of the entry; admins and the oalab team never.
  const active = users.filter((user) => entry.memberIds.includes(user.id) && user.status === "active" && user.role !== "oalab_admin").length;
  const archived = Boolean(entry.archivedAt);
  const matches = typed.trim().toUpperCase() === entry.customerNumber.toUpperCase();

  const restore = () => run("restore", () => restoreCustomer({ customerId: entry.id }), (data) => {
    onNotice(`${entry.company} ist wiederhergestellt${data.freed ? `; ${count(data.freed, "Zugang ist", "Zugänge sind")} wieder aktiv` : ""}.${data.incomplete ? ` Bei ${data.incomplete} ließ sich die Anmeldung nicht freischalten; bitte dort „Aktivieren“ wählen.` : ""}`);
  });
  const archive = () => run("archive", () => archiveCustomer({ customerId: entry.id }), (data) => {
    setConfirming(null);
    onNotice(`${entry.company} ist archiviert${data.blocked ? `; ${count(data.blocked, "Zugang ist", "Zugänge sind")} gesperrt` : ""}.${data.incomplete ? ` Bei ${data.incomplete} ließ sich die Anmeldung nicht ganz sperren; Daten sehen sie trotzdem keine mehr.` : ""}`);
  });
  const askDelete = () => {
    setConfirming("delete");
    setTyped("");
    setPreview(null);
    run("preview", () => previewCustomerRemoval({ customerId: entry.id }), setPreview);
  };
  const remove = () => run("delete", () => deleteCustomer({ customerId: entry.id, confirmNumber: typed }), (data) => {
    onNotice(deletionNotice(entry.company, data));
    onClose(true);
  });

  const notice = archived && (
    <div className="um-invite um-lead is-archived" role="group" aria-label="Archiviert">
      <span className="um-invite-icon"><Archive size={16} aria-hidden="true" /></span>
      <span className="um-invite-text">
        <strong>Archiviert{entry.archivedAt ? ` am ${formatFileDateTime(entry.archivedAt)}` : ""}{entry.archivedBy ? ` von ${entry.archivedBy}` : ""}</strong>
        <small>Nur hier im User Management sichtbar, sonst nirgends im Hub.{entry.archivedLoginIds.length ? ` ${count(entry.archivedLoginIds.length, "Zugang ist", "Zugänge sind")} gesperrt.` : ""}{entry.inService ? " In Service ist die Firma ebenfalls archiviert." : ""}</small>
      </span>
      <div className="um-actions">
        <button type="button" className="sheet-action is-primary" disabled={busy !== null} onClick={restore}>{busy === "restore" ? <Spinner /> : <ArchiveRestore size={14} aria-hidden="true" />}Wiederherstellen</button>
      </div>
    </div>
  );

  const deletion = preview && removalLines(preview);
  const section = (
    <PanelSection title={title} info={info.button}>
      {info.box}
      <RowList>
        {archived ? (
          <Row lead={<RowIcon icon={ArchiveRestore} />} title="Wiederherstellen" text="Wieder überall sichtbar; die gesperrten Zugänge werden wieder aktiv.">
            <button type="button" className="sheet-action is-quiet" disabled={busy !== null} onClick={restore}>{busy === "restore" ? <Spinner /> : <ArchiveRestore size={14} aria-hidden="true" />}Wiederherstellen</button>
          </Row>
        ) : (
          <Row lead={<RowIcon icon={Archive} />} title="Archivieren" text="Überall ausgeblendet außer hier, Zugänge gesperrt; jederzeit umkehrbar."
            below={confirming === "archive" && (
              <div className="um-stack">
                <p className="am-help">{entry.company} verschwindet aus Asset Management, Projekten, Kalender, Nachrichten, Vertrag & Domain, Schlüsselbund, Assistent und Claude. {active ? `${count(active, "aktiver Zugang wird", "aktive Zugänge werden")} sofort gesperrt.` : "Aktive Zugänge gibt es keine."}{entry.inService ? " Die Firma wird auch in Service archiviert; ihre Anfragen bleiben dort." : ""} Gelöscht wird nichts.</p>
                <div className="um-actions">
                  <button type="button" className="sheet-action is-quiet" onClick={cancel} disabled={busy !== null}>Abbrechen</button>
                  <button type="button" className="sheet-action is-danger" disabled={busy !== null} onClick={archive}>{busy === "archive" ? <Spinner /> : <Archive size={14} aria-hidden="true" />}Jetzt archivieren</button>
                </div>
              </div>
            )}>
            {confirming !== "archive" && <button type="button" className="sheet-action is-quiet" onClick={() => { setError(""); setConfirming("archive"); }} disabled={busy !== null}>Archivieren …</button>}
          </Row>
        )}
        <Row danger lead={<RowIcon icon={Trash2} />} title="Endgültig löschen" text={`Mit allem, was der Hub zu ${freelancer ? "diesem Freelancer" : "diesem Kunden"} speichert; nicht umkehrbar.`}
          below={confirming === "delete" && (
            <div className="um-stack">
              {!preview ? (
                busy === "preview" ? <p className="am-help um-loading"><Spinner />Prüfe, was dazugehört …</p> : null
              ) : (
                <div className="um-removal">
                  <p className="am-help"><strong>Wird gelöscht:</strong> {deletion?.gone.length ? deletion.gone.join(", ") : `nur der ${word} selbst`}.</p>
                  {deletion?.kept.length ? <p className="am-help"><strong>Bleibt:</strong> {deletion.kept.join("; ")}.</p> : null}
                  <p className="am-help">Zugänge, auf die Service noch verweist, werden gesperrt statt gelöscht. Es geht keine E-Mail raus.</p>
                </div>
              )}
              <label className="um-field"><span className="am-label">Zum endgültigen Löschen die Nummer eintragen</span><input className="am-input" value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={entry.customerNumber} autoComplete="off" spellCheck={false} disabled={busy === "delete"} /></label>
              <div className="um-actions">
                <button type="button" className="sheet-action is-quiet" onClick={cancel} disabled={busy === "delete"}>Abbrechen</button>
                <button type="button" className="sheet-action is-danger" disabled={busy !== null || !matches || !preview} onClick={remove}>{busy === "delete" ? <Spinner /> : <Trash2 size={14} aria-hidden="true" />}Endgültig löschen</button>
              </div>
            </div>
          )}>
          {confirming !== "delete" && <button type="button" className="sheet-action is-danger" onClick={askDelete} disabled={busy !== null}>Löschen …</button>}
        </Row>
      </RowList>
      {error && <p className="form-error" role="alert">{error}</p>}
    </PanelSection>
  );

  return { notice, section };
}
