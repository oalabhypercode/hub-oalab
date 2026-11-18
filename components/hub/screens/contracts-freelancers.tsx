"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Contact, Globe, KeyRound, LockKeyhole, Mail, Package, Pencil, StickyNote, UserCog, UserRound, Users, type LucideIcon } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { hubHref } from "@/lib/hub-data";
import type { ContractCustomer } from "@/lib/hub-contracts/types";
import type { DomainMailState } from "@/lib/hub-domains/types";
import { saveFreelancerNote, setFreelancerShare } from "@/lib/hub-freelancer-customers/actions";
import { cleanShareNote, MAX_SHARE_NOTE, shareAreaIds, shareAreas, type ShareArea } from "@/lib/hub-freelancer-customers/rules";
import type { FreelancerAssignment, FreelancerShareState } from "@/lib/hub-freelancer-customers/types";
import { packageCatalog } from "@/lib/service-packages";
import { Switch } from "../controls";
import { useInfo } from "../info-box";
import { SheetFooter, StatusGlyph, TableGroup, useCollapsedGroups } from "../sheet";
import { AssetPanel } from "./asset-panel";

/*
 * The admins' tab „Freelancer“ under „Vertrag & Domain“ (approved preview of 18.11.2026): per freelancer who looks after
 * the customer one group with a small switch per area, a note only that freelancer reads, and the passwords that stay in
 * the Schlüsselbund. A switch saves at once; everything starts switched off. The freelancer reads the result under
 * „Kunden“ › „Vertrag & Domain“, only reading.
 */

const COLS = 4;
const icons: Record<ShareArea, LucideIcon> = { domains: Globe, mail: Mail, packages: Package, contact: Contact };
const dayFormat = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });
const formatDay = (value: string | null) => (value && !Number.isNaN(Date.parse(value)) ? dayFormat.format(new Date(value)) : "");
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function FreelancerTab({ customer, state, domainMail, fixtures, preview, onNotice }: {
  customer: ContractCustomer;
  state: FreelancerShareState;
  domainMail: DomainMailState;
  /** The preview: switches and notes change only in this window. */
  fixtures: boolean;
  preview: boolean;
  onNotice: (message: string) => void;
}) {
  const [assignments, setAssignments] = useState(() => state.assignments.filter((assignment) => assignment.customerId === customer.id));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [noteFor, setNoteFor] = useState<FreelancerAssignment | null>(null);
  const groups = useCollapsedGroups();
  const info = useInfo("Freigabe für Freelancer", {
    steps: [
      <><b>Zugeordnete Kunden</b> sind immer sichtbar, mehr nur hier.</>,
      <><b>Je Bereich</b> ein Schalter, getrennt für jeden Freelancer.</>,
      <><b>Passwörter</b> bleiben im Schlüsselbund.</>,
    ],
    ask: "Was sieht ein Freelancer, wenn ich unter Vertrag & Domain etwas freigebe?",
  });
  const canSave = fixtures || state.ready;
  const domains = domainMail.domains.filter((domain) => domain.customerId === customer.id);
  const mailboxes = domainMail.mailboxes.filter((mailbox) => mailbox.customerId === customer.id);
  const server = domainMail.mailServers.find((item) => item.customerId === customer.id);
  const packages = customer.packages.flatMap((item) => (item.packageId ? [packageCatalog[item.packageId].short] : []));
  const details: Record<ShareArea, { text: string; empty: boolean }> = {
    domains: domains.length ? { text: `${plural(domains.length, "Domain", "Domains")}, wo Website, Domain und DNS liegen`, empty: false } : { text: "Noch keine Domain eingetragen", empty: true },
    mail: mailboxes.length || server ? { text: `${plural(mailboxes.length, "Adresse", "Adressen")}${server ? " und Mail-Server" : ""}, ohne Passwörter`, empty: false } : { text: "Noch keine Adresse und kein Mail-Server", empty: true },
    packages: packages.length ? { text: `${packages.join(" · ")}, ohne Preise`, empty: false } : { text: "Noch kein Paket gebucht", empty: true },
    contact: { text: shareAreas.contact.hint, empty: false },
  };

  async function toggle(assignment: FreelancerAssignment, area: ShareArea, on: boolean) {
    const label = shareAreas[area].label;
    const message = on ? `${assignment.freelancerName} sieht jetzt „${label}“ von ${customer.company}.` : `${assignment.freelancerName} sieht „${label}“ von ${customer.company} nicht mehr.`;
    setError("");
    if (fixtures) {
      setAssignments((list) => list.map((item) => (item.freelancerId === assignment.freelancerId ? { ...item, shares: { ...item.shares, [area]: on ? new Date().toISOString() : null } } : item)));
      onNotice(`${message} (Vorschau, nichts gespeichert)`);
      return;
    }
    setBusy(`${assignment.freelancerId}:${area}`);
    const result = await setFreelancerShare({ customerId: customer.id, freelancerId: assignment.freelancerId, area, on });
    setBusy(null);
    if (!result.ok) { setError(result.error); return; }
    setAssignments((list) => list.map((item) => (item.freelancerId === assignment.freelancerId ? { ...item, shares: { ...item.shares, [area]: result.data.since } } : item)));
    onNotice(message);
  }

  if (!assignments.length) {
    return (
      <div className="am-scroll">
        <table className="file-table cdm-table cdm-admin-table">
          <caption className="visually-hidden">Freelancer von {customer.company}</caption>
          <TableGroup colSpan={COLS} label="Freelancer" count={0} glyph={<Users size={16} aria-hidden="true" />} collapsed={false} onToggle={() => undefined} actions={info.button}
            empty="Diesen Kunden betreut kein Freelancer. Zuordnen kannst du ihn im User Management beim Kunden unter „Betreut von“." />
        </table>
        {info.box}
      </div>
    );
  }

  return (
    <>
      {!canSave && <p className="cdm-tab-note">Freigaben für Freelancer sind in der Datenbank noch nicht eingerichtet. Die Migration steht noch aus; bis dahin sieht kein Freelancer etwas davon.</p>}
      {error && <p className="form-error cdm-tab-error" role="alert">{error}</p>}
      <div className="am-scroll">
        <table className="file-table cdm-table cdm-admin-table">
          <caption className="visually-hidden">Was die Freelancer von {customer.company} sehen</caption>
          {assignments.map((assignment, index) => {
            const on = shareAreaIds.filter((area) => assignment.shares[area]).length;
            return (
              <TableGroup key={assignment.freelancerId} colSpan={COLS} label={assignment.freelancerName} count={on} glyph={<Users size={16} aria-hidden="true" />}
                collapsed={groups.isCollapsed(assignment.freelancerId)} onToggle={() => groups.toggle(assignment.freelancerId)} actions={index === 0 ? info.button : undefined}>
                <tr className="file-row">
                  <td className="cell-file"><span className="am-file"><span className="am-file-icon cdm-file-icon"><UserRound size={16} aria-hidden="true" /></span><span className="am-file-text"><strong>{assignment.freelancerName} · {assignment.freelancerNumber}</strong><small>{assignment.assignedAt ? `betreut seit ${formatDay(assignment.assignedAt)}` : "betreut diesen Kunden"}</small></span></span></td>
                  <td className="cell-category"><span className="status-cell"><StatusGlyph kind="active" />Zugeordnet</span></td>
                  <td className="cell-date" />
                  <td className="cell-action"><Link className="am-icon-btn" href={hubHref(preview, "users")} aria-label={`${assignment.freelancerName} im User Management öffnen`} data-tip="Im User Management öffnen"><UserCog size={16} aria-hidden="true" /></Link></td>
                </tr>
                {shareAreaIds.map((area) => {
                  const Icon = icons[area];
                  const since = assignment.shares[area];
                  const key = `${assignment.freelancerId}:${area}`;
                  return (
                    <tr key={area} className="file-row">
                      <td className="cell-file"><span className="am-file"><span className="am-file-icon cdm-file-icon"><Icon size={16} aria-hidden="true" /></span><span className="am-file-text"><strong>{shareAreas[area].label}</strong><small>{details[area].text}</small></span></span></td>
                      <td className="cell-category"><span className="status-cell"><StatusGlyph kind={since ? "active" : "invited"} />{since ? "Sichtbar" : "Aus"}</span></td>
                      <td className="cell-date">{since && <span className="numeric">seit {formatDay(since)}</span>}</td>
                      <td className="cell-action">
                        {busy === key ? <MiniLoader size={15} /> : (
                          <Switch size="sm" checked={Boolean(since)} label={`${shareAreas[area].label} für ${assignment.freelancerName} freigeben`}
                            disabled={!canSave || busy !== null || (details[area].empty && !since)} onChange={(value) => void toggle(assignment, area, value)} />
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr className="file-row">
                  <td className="cell-file"><span className="am-file"><span className="am-file-icon cdm-file-icon"><StickyNote size={16} aria-hidden="true" /></span><span className="am-file-text"><strong>Hinweise für {assignment.freelancerName}</strong><small>{assignment.note ? assignment.note.split("\n")[0] : "Noch keine, zum Beispiel CMS, Testseite oder Ansprechperson"}</small></span></span></td>
                  <td className="cell-category"><span className="status-cell"><StatusGlyph kind={assignment.note ? "active" : "invited"} />{assignment.note ? "Sichtbar" : "Leer"}</span></td>
                  <td className="cell-date">{assignment.noteUpdatedAt && <span className="numeric">Stand {formatDay(assignment.noteUpdatedAt)}</span>}</td>
                  <td className="cell-action"><button type="button" className="am-icon-btn" onClick={() => setNoteFor(assignment)} disabled={!canSave} aria-label={`Hinweise für ${assignment.freelancerName} bearbeiten`} data-tip="Bearbeiten"><Pencil size={16} aria-hidden="true" /></button></td>
                </tr>
                <tr className="file-row fc-off">
                  <td className="cell-file"><span className="am-file"><span className="am-file-icon cdm-file-icon"><KeyRound size={16} aria-hidden="true" /></span><span className="am-file-text"><strong>Zugangsdaten</strong><small>Passwörter und Logins bleiben im Schlüsselbund</small></span></span></td>
                  <td className="cell-category"><span className="status-cell"><StatusGlyph kind="invited" />Nicht freigebbar</span></td>
                  <td className="cell-date" />
                  <td className="cell-action"><span className="fc-lock" data-tip="Bleibt beim oalab-Team"><LockKeyhole size={16} aria-hidden="true" /></span></td>
                </tr>
              </TableGroup>
            );
          })}
        </table>
        {info.box}
      </div>
      <SheetFooter hint="Jede Änderung steht im Admin-Protokoll.">{plural(assignments.length, "Freelancer betreut", "Freelancer betreuen")} diesen Kunden</SheetFooter>
      {noteFor && (
        <NotePanel customer={customer} assignment={noteFor} fixtures={fixtures} onClose={() => setNoteFor(null)}
          onSaved={(note, updatedAt) => {
            setAssignments((list) => list.map((item) => (item.freelancerId === noteFor.freelancerId ? { ...item, note, noteUpdatedAt: updatedAt } : item)));
            setNoteFor(null);
            onNotice(note ? `Hinweise für ${noteFor.freelancerName} gespeichert.${fixtures ? " (Vorschau, nichts gespeichert)" : ""}` : `Hinweise für ${noteFor.freelancerName} entfernt.`);
          }} />
      )}
    </>
  );
}

/** The note for one freelancer at this customer, edited beside the table. */
function NotePanel({ customer, assignment, fixtures, onClose, onSaved }: { customer: ContractCustomer; assignment: FreelancerAssignment; fixtures: boolean; onClose: () => void; onSaved: (note: string, updatedAt: string | null) => void }) {
  const [text, setText] = useState(assignment.note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changed = cleanShareNote(text) !== assignment.note;
  async function save() {
    const note = cleanShareNote(text);
    if (fixtures) { onSaved(note, note ? new Date().toISOString() : null); return; }
    setBusy(true);
    setError("");
    const result = await saveFreelancerNote({ customerId: customer.id, freelancerId: assignment.freelancerId, note: text });
    setBusy(false);
    if (result.ok) onSaved(result.data.note, result.data.updatedAt); else setError(result.error);
  }
  return (
    <AssetPanel className="um-panel" label={`Hinweise für ${assignment.freelancerName}`} onClose={onClose} closeDisabled={busy}
      icon={<span className="am-tile fc-tile"><StickyNote size={19} aria-hidden="true" /></span>}
      title={`Hinweise für ${assignment.freelancerName}`} subtitle={`${customer.company} · nur für ${assignment.freelancerName} sichtbar`}
      footer={<><button type="button" className="sheet-action" onClick={onClose} disabled={busy}>Abbrechen</button><span className="pj-spacer" /><button type="button" className="sheet-action is-primary" onClick={save} disabled={busy || !changed}>{busy ? <MiniLoader size={15} /> : <Check size={15} aria-hidden="true" />}Speichern</button></>}>
      <section className="um-sec">
        <div className="um-sec-head"><h3>Was {assignment.freelancerName} wissen muss</h3><span className="um-sec-meta numeric">{text.length}/{MAX_SHARE_NOTE}</span></div>
        <div className="um-grid">
          <label className="um-field is-wide"><span className="am-label">Hinweise</span>
            <textarea className="am-textarea" rows={10} maxLength={MAX_SHARE_NOTE} value={text} onChange={(event) => setText(event.target.value)} disabled={busy} autoFocus />
          </label>
        </div>
        <p className="field-hint">Zum Beispiel CMS, Testseite oder Ansprechperson beim Kunden. Keine Passwörter: Die bleiben im Schlüsselbund.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
      </section>
    </AssetPanel>
  );
}
