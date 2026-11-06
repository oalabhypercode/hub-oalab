"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Ban, Check, Copy, FileBadge, ImagePlus, KeyRound, Mail, MailCheck, MailX, RotateCcw, Save, Send, ShieldCheck, Trash2, UserPlus, X } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { approveRegistration, createHubUser, createPasswordLink, deleteHubUser, rejectRegistration, saveCustomer, saveFreelancer, setHubUserActive, setHubUserSecondFactor, updateHubUser, type ActionResult } from "@/lib/hub-users/actions";
import type { MailStatus } from "@/lib/hub-mail/smtp";
import { displayStatusLabels, kindForRole, roleLabels, suggestCustomer, type CustomerKind, type HubRole } from "@/lib/hub-users/rules";
import type { ManagedCustomer, ManagedEvent, ManagedUser } from "@/lib/hub-users/types";
import { formatFileDateTime } from "@/lib/hub-files/catalog";
import { hubHref } from "@/lib/hub-data";
import { packageCatalog } from "@/lib/service-packages";
import { CustomerLogoDialog } from "../customer-logo-dialog";
import { useInfo } from "../info-box";
import { LogoMark, companyInitials } from "../logo-mark";
import { Modal } from "../modal";
import { CustomerPicker } from "./files-parts";

export const fullName = (user: Pick<ManagedUser, "firstName" | "lastName" | "email">) => `${user.firstName} ${user.lastName}`.trim() || user.email;

/** Entries for the tick list (number and name only). */
const pickable = (entries: ManagedCustomer[]) => entries.map(({ id, customerNumber, company }) => ({ id, customerNumber, company }));

/** One sentence for a mail that did not go out (or "" when it did). */
export function mailStatusText(status: MailStatus | null) {
  if (status === "skipped") return "Keine E-Mail verschickt: Der Mailversand ist noch nicht eingerichtet.";
  if (status === "failed") return "Die E-Mail konnte nicht verschickt werden.";
  return "";
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Runs a server action with a busy flag and its error message. */
function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
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
  return { busy, error, setError, run };
}

const Spinner = () => <MiniLoader size={18} />;

// Customer data -----------------------------------------------------------------------------------------------------

export type CustomerDraft = {
  company: string;
  customerNumber: string;
  contactEmail: string;
  phone: string;
  website: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
};

export const draftOf = (customer: ManagedCustomer): CustomerDraft => ({
  company: customer.company,
  customerNumber: customer.customerNumber,
  contactEmail: customer.contactEmail,
  phone: customer.phone,
  website: customer.website,
  street: customer.street,
  postalCode: customer.postalCode,
  city: customer.city,
  country: customer.country,
});

export const emptyDraft = (customerNumber: string, preset: Partial<CustomerDraft> = {}): CustomerDraft => ({
  company: "", customerNumber, contactEmail: "", phone: "", website: "", street: "", postalCode: "", city: "", country: "Deutschland", ...preset,
});

/**
 * Company, customer number, contact and address of one customer; its packages live under „Vertrag & Domain“. A freelancer
 * has a name (person or company) and an "FL-" number, and no packages: they have no access to the service platform.
 */
function CustomerFields({ draft, onChange, disabled, compact = false, freelancer = false }: { draft: CustomerDraft; onChange: (draft: CustomerDraft) => void; disabled: boolean; compact?: boolean; freelancer?: boolean }) {
  const set = (key: keyof CustomerDraft) => (event: React.ChangeEvent<HTMLInputElement>) => onChange({ ...draft, [key]: event.target.value });
  return (
    <div className="upload-fields">
      <label className="upload-field"><span>{freelancer ? "Name oder Firma" : "Unternehmen"}</span><input value={draft.company} onChange={set("company")} maxLength={200} required disabled={disabled} autoComplete="organization" /></label>
      <label className="upload-field"><span>{freelancer ? "Freelancer-Nr." : "Kundennummer"}</span><input value={draft.customerNumber} onChange={set("customerNumber")} maxLength={40} required disabled={disabled} className="numeric" /></label>
      {freelancer && compact && <label className="upload-field upload-field-wide"><span>Kontakt-E-Mail</span><input type="email" value={draft.contactEmail} onChange={set("contactEmail")} maxLength={254} disabled={disabled} placeholder="info@beispiel.de" /></label>}
      {!compact && <>
        <label className="upload-field"><span>Kontakt-E-Mail</span><input type="email" value={draft.contactEmail} onChange={set("contactEmail")} maxLength={254} disabled={disabled} placeholder="info@beispiel.de" /></label>
        <label className="upload-field"><span>Telefon</span><input type="tel" value={draft.phone} onChange={set("phone")} maxLength={40} disabled={disabled} /></label>
        <label className="upload-field upload-field-wide"><span>Website</span><input value={draft.website} onChange={set("website")} maxLength={200} disabled={disabled} placeholder="beispiel.de" /></label>
        <label className="upload-field upload-field-wide"><span>Straße und Hausnummer</span><input value={draft.street} onChange={set("street")} maxLength={120} disabled={disabled} autoComplete="street-address" /></label>
        <label className="upload-field"><span>PLZ</span><input value={draft.postalCode} onChange={set("postalCode")} maxLength={12} disabled={disabled} autoComplete="postal-code" /></label>
        <label className="upload-field"><span>Ort</span><input value={draft.city} onChange={set("city")} maxLength={80} disabled={disabled} autoComplete="address-level2" /></label>
        <label className="upload-field upload-field-wide"><span>Land</span><input value={draft.country} onChange={set("country")} maxLength={60} disabled={disabled} autoComplete="country-name" /></label>
      </>}
    </div>
  );
}

type Choice = { mode: "existing" | "new"; customerId: string; draft: CustomerDraft };
/** One choice per kind of entry, so switching between the roles keeps what was picked for each. */
type Choices = Record<CustomerKind, Choice>;

/** Starts both choices: the login's own entry if it has one of that kind, else the first one, else a new one. */
function startChoices(entries: ManagedCustomer[], numbers: Record<CustomerKind, string>, presets: Partial<Record<CustomerKind, Partial<CustomerDraft>>>, own?: string | null, preferNew = false): Choices {
  const make = (kind: CustomerKind): Choice => {
    const options = entries.filter((entry) => entry.kind === kind);
    const current = own && options.some((entry) => entry.id === own) ? own : null;
    return { mode: current || (options.length && !preferNew) ? "existing" : "new", customerId: current ?? options[0]?.id ?? "", draft: emptyDraft(numbers[kind], presets[kind]) };
  };
  return { customer: make("customer"), freelancer: make("freelancer") };
}

const choicePayload = (role: HubRole, choices: Choices) => {
  const kind = kindForRole(role);
  if (!kind) return { mode: "none" };
  const choice = choices[kind];
  return choice.mode === "existing" ? { mode: "existing", customerId: choice.customerId } : { mode: "new", customer: choice.draft };
};

const roleHints: Record<HubRole, string> = {
  oalab_customer: "Sieht nur die Daten des zugeordneten Kunden.",
  oalab_freelancer: "Sieht seine eigenen Dateien und die Dateien seiner Kunden, nur lesend. Kein Zugang zur Serviceplattform.",
  oalab_admin: "Sieht alle Kunden und verwaltet Konten, Dateien und Termine.",
};

/** Role and, for customers and freelancers, the entry they belong to: an existing one or a new one created on the spot. */
function RoleAndCustomer({ role, onRole, choices, onChoices, customers, disabled, roleLocked = false, freelancers }: {
  role: HubRole; onRole: (role: HubRole) => void; choices: Choices; onChoices: (choices: Choices) => void; customers: ManagedCustomer[]; disabled: boolean; roleLocked?: boolean;
  /** The database knows freelancers (their migration is applied). */
  freelancers: boolean;
}) {
  const kind = kindForRole(role);
  const roles: HubRole[] = freelancers || role === "oalab_freelancer" ? ["oalab_customer", "oalab_freelancer", "oalab_admin"] : ["oalab_customer", "oalab_admin"];
  const options = kind ? customers.filter((entry) => entry.kind === kind) : [];
  const choice = kind ? choices[kind] : null;
  const setChoice = (next: Choice) => { if (kind) onChoices({ ...choices, [kind]: next }); };
  const isFreelancer = kind === "freelancer";
  return (
    <div className="role-customer">
      <fieldset className="choice-group" disabled={disabled || roleLocked}>
        <legend>Rolle</legend>
        {roles.map((item) => (
          <label key={item} className="choice-option"><input type="radio" name="role" checked={role === item} onChange={() => onRole(item)} />
            <span><strong>{roleLabels[item]}</strong><small>{roleHints[item]}</small></span>
          </label>
        ))}
      </fieldset>
      {role === "oalab_admin" && !roleLocked && <p className="field-warning"><AlertTriangle size={16} aria-hidden="true" />Admins sehen alle Kunden und dürfen Konten verwalten. Vergib diese Rolle nur an das oalab-Team.</p>}
      {isFreelancer && <p className="field-hint">Freelancer bestätigen jede Anmeldung mit einem Code per E-Mail. Welche Kunden sie betreuen, legst du im Reiter „Freelancer“ fest.</p>}
      {kind && choice && <>
        <fieldset className="choice-group" disabled={disabled}>
          <legend>{isFreelancer ? "Freelancer" : "Kunde"}</legend>
          <label className="choice-option"><input type="radio" name="customer-mode" checked={choice.mode === "existing"} onChange={() => setChoice({ ...choice, mode: "existing" })} disabled={!options.length} />
            <span><strong>{isFreelancer ? "Bestehendem Freelancer zuordnen" : "Bestehendem Kunden zuordnen"}</strong><small>{options.length
              ? isFreelancer ? "Die Person sieht die Dateien dieses Freelancers und seiner Kunden." : "Die Person sieht die Dateien, Termine und Projekte dieses Kunden."
              : isFreelancer ? "Es gibt noch keine Freelancer." : "Es gibt noch keine Kunden."}</small></span>
          </label>
          <label className="choice-option"><input type="radio" name="customer-mode" checked={choice.mode === "new"} onChange={() => setChoice({ ...choice, mode: "new" })} />
            <span><strong>{isFreelancer ? "Neuen Freelancer anlegen" : "Neuen Kunden anlegen"}</strong><small>{isFreelancer ? "Nur im Hub, mit einer freien FL-Nummer." : "Auch in Service, mit einer freien Kundennummer."}</small></span>
          </label>
        </fieldset>
        {choice.mode === "existing" && options.length > 0 && (
          <label className="upload-field"><span>{isFreelancer ? "Freelancer" : "Kunde"}</span>
            <select value={choice.customerId} onChange={(event) => setChoice({ ...choice, customerId: event.target.value })} disabled={disabled}>
              {options.map((customer) => <option key={customer.id} value={customer.id}>{customer.customerNumber} · {customer.company}</option>)}
            </select>
          </label>
        )}
        {choice.mode === "new" && <CustomerFields draft={choice.draft} onChange={(draft) => setChoice({ ...choice, draft })} disabled={disabled} compact freelancer={isFreelancer} />}
      </>}
    </div>
  );
}

/** A one-time link to set the password, with copy and e-mail buttons. It is shown once and never stored. */
function LinkPanel({ link, activation, user }: { link: string; activation: boolean; user: { firstName: string; email: string } }) {
  const [copied, setCopied] = useState(false);
  const subject = activation ? "Dein Zugang zum oalab Client Hub" : "Neues Passwort für den oalab Client Hub";
  const body = `Hallo ${user.firstName || ""},\n\n${activation ? "dein Zugang zum oalab Client Hub ist eingerichtet. Über diesen persönlichen Link legst du dein Passwort fest und meldest dich an:" : "über diesen persönlichen Link legst du ein neues Passwort für den oalab Client Hub fest:"}\n\n${link}\n\nDer Link funktioniert nur einmal und ist zeitlich begrenzt gültig.\n\nViele Grüße\nDein oalab-Team`;
  return (
    <div className="link-panel">
      <p className="link-panel-title"><KeyRound size={17} aria-hidden="true" />{activation ? "Aktivierungslink" : "Link zum Passwort-Zurücksetzen"}</p>
      <input className="link-panel-input" readOnly value={link} aria-label={activation ? "Aktivierungslink" : "Link zum Passwort-Zurücksetzen"} onFocus={(event) => event.currentTarget.select()} />
      <div className="file-assign-actions">
        <button type="button" className="sheet-button" onClick={async () => setCopied(await copyText(link))}>{copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}{copied ? "Kopiert" : "Link kopieren"}</button>
        <a className="sheet-button sheet-button-primary" href={`mailto:${encodeURIComponent(user.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}><Mail size={18} aria-hidden="true" />Im Mailprogramm öffnen</a>
      </div>
      <p className="field-hint">Der Link meldet die Person an und lässt sie ein Passwort setzen. Schicke ihn nur an ihre eigene Adresse. Er gilt einmal und läuft ab (Einstellung in Supabase); bei Bedarf erzeugst du hier einen neuen.</p>
    </div>
  );
}

function History({ events }: { events: ManagedEvent[] }) {
  if (!events.length) return null;
  return (
    <details className="history">
      <summary>Verlauf ({events.length})</summary>
      <ul>{events.slice(0, 12).map((event) => <li key={event.id}><strong>{event.summary || event.action}</strong><small>{formatFileDateTime(event.at)} · {event.actorName}</small></li>)}</ul>
    </details>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt>{label}</dt><dd>{children || "–"}</dd></div>;
}

// Registration ------------------------------------------------------------------------------------------------------

/** All details of a registration and the decision: approve with role and customer, or reject with a note. */
export function ReviewDialog({ user, customers, nextNumber, nextFreelancerNumber, freelancers, onClose, onNotice }: { user: ManagedUser; customers: ManagedCustomer[]; nextNumber: string; nextFreelancerNumber: string; freelancers: boolean; onClose: () => void; onNotice: (message: string) => void }) {
  const suggestion = suggestCustomer(user, customers.filter((entry) => entry.kind === "customer"));
  const [role, setRole] = useState<HubRole>("oalab_customer");
  const [choices, setChoices] = useState<Choices>(() => startChoices(customers, { customer: nextNumber, freelancer: nextFreelancerNumber }, {
    customer: { company: user.companyName, website: user.website, contactEmail: user.email, phone: user.phone },
    freelancer: { company: user.companyName, website: user.website, contactEmail: user.email, phone: user.phone },
  }, suggestion?.id, Boolean(user.companyName) && !suggestion));
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [approved, setApproved] = useState<{ customerNumber: string | null; mail: MailStatus } | null>(null);
  const [copied, setCopied] = useState(false);
  const { busy, error, run } = useAction();
  const info = useInfo("Freigabe", {
    steps: [
      <><b>Rolle und Kunde</b> wählen, bestehend oder neu.</>,
      <><b>Freigeben</b> schickt den Link zum Login per E-Mail.</>,
      <><b>Ablehnen</b> mit Begründung; später umkehrbar.</>,
    ],
    ask: "Wie gebe ich eine Registrierung frei?",
  });
  const name = fullName(user);
  const loginUrl = typeof window === "undefined" ? "" : `${window.location.origin}/auth/login`;
  const message = `Hallo ${user.firstName},\n\ndein Zugang zum oalab Client Hub ist freigeschaltet. Du kannst dich ab sofort mit deiner E-Mail-Adresse ${user.email} und deinem Passwort anmelden:\n\n${loginUrl}\n\nViele Grüße\nDein oalab-Team`;

  if (approved !== null) {
    const handOver = <>
      <textarea className="message-preview" readOnly value={message} rows={8} aria-label="Nachricht an die Person" />
      <div className="file-assign-actions">
        <button type="button" className="sheet-button" onClick={async () => setCopied(await copyText(message))}>{copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}{copied ? "Kopiert" : "Nachricht kopieren"}</button>
        <a className="sheet-button sheet-button-primary" href={`mailto:${encodeURIComponent(user.email)}?subject=${encodeURIComponent("Dein Zugang zum oalab Client Hub ist freigeschaltet")}&body=${encodeURIComponent(message)}`}><Mail size={18} aria-hidden="true" />Im Mailprogramm öffnen</a>
      </div>
    </>;
    return (
      <Modal title="Registrierung freigegeben" onClose={onClose} className="users-modal">
        <p className="dialog-success"><ShieldCheck size={20} aria-hidden="true" />{name} hat jetzt Zugang{approved.customerNumber ? ` als Kunde ${approved.customerNumber}` : ""}.</p>
        {approved.mail === "sent" ? <>
          <p className="mail-status is-sent"><MailCheck size={18} aria-hidden="true" />Wir haben {user.firstName || name} per E-Mail informiert, mit Link zum Login.</p>
          <details className="history"><summary>Nachricht trotzdem selbst schicken</summary>{handOver}</details>
        </> : <>
          <p className={`mail-status${approved.mail === "failed" ? " is-failed" : ""}`}><MailX size={18} aria-hidden="true" />{mailStatusText(approved.mail)} Gib der Person kurz selbst Bescheid; sie hat bei der Registrierung ihr Passwort gesetzt und kann sich sofort anmelden.</p>
          {handOver}
        </>}
      </Modal>
    );
  }

  return (
    <Modal title="Registrierung prüfen" onClose={onClose} className="users-modal" actions={info.button}>
      {info.box}
      <dl className="detail-list">
        <Detail label="Name">{name}</Detail>
        <Detail label="Position">{user.position}</Detail>
        <Detail label="Unternehmen (Angabe)">{user.companyName}</Detail>
        <Detail label="E-Mail">{user.email} <span className={user.emailConfirmed ? "confirm-badge" : "confirm-badge is-open"}>{user.emailConfirmed ? "bestätigt" : "noch nicht bestätigt"}</span></Detail>
        <Detail label="Telefon">{user.phone}</Detail>
        <Detail label="Website">{user.website && <a href={user.website} target="_blank" rel="noopener noreferrer">{user.website.replace(/^https?:\/\//, "")}</a>}</Detail>
        <Detail label="Kundennummer (Angabe)">{user.customerNumberHint}</Detail>
        <Detail label="Registriert">{formatFileDateTime(user.createdAt)}</Detail>
        {user.message && <div className="detail-wide"><dt>Nachricht</dt><dd className="detail-message">{user.message}</dd></div>}
      </dl>
      {user.status === "rejected" && <p className="field-warning"><AlertTriangle size={16} aria-hidden="true" />Diese Registrierung wurde abgelehnt{user.decisionNote ? `: „${user.decisionNote}“` : ""}. Du kannst sie trotzdem freigeben.</p>}
      {suggestion && <p className="suggestion"><Check size={16} aria-hidden="true" />Passt zu {suggestion.customerNumber} · {suggestion.company}{user.customerNumberHint === suggestion.customerNumber ? " (Kundennummer stimmt)" : " (gleicher Firmenname)"}</p>}

      {rejecting ? (
        <div className="decision">
          <label className="upload-field"><span>Begründung für die Person (optional; sie bekommt den Text per E-Mail und sieht ihn nach dem Login)</span>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={3} disabled={busy !== null} placeholder="z. B. Wir konnten dein Unternehmen keinem Projekt zuordnen." />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="file-assign-actions">
            <button type="button" className="sheet-button" onClick={() => setRejecting(false)} disabled={busy !== null}>Zurück</button>
            <button type="button" className="sheet-button sheet-button-danger" disabled={busy !== null} onClick={() => run("reject", () => rejectRegistration({ userId: user.id, note }), (data) => { onNotice(`Registrierung von ${name} abgelehnt. ${data.mail === "sent" ? "Die Person wurde per E-Mail informiert." : mailStatusText(data.mail)}`); onClose(); })}>{busy === "reject" ? <Spinner /> : <X size={18} aria-hidden="true" />}Ablehnen</button>
          </div>
        </div>
      ) : (
        <div className="decision">
          <RoleAndCustomer role={role} onRole={setRole} choices={choices} onChoices={setChoices} customers={customers} disabled={busy !== null} freelancers={freelancers} />
          {!user.emailConfirmed && <p className="field-hint">Die E-Mail-Adresse ist noch nicht bestätigt. Anmelden kann sich die Person erst nach der Bestätigung.</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="file-assign-actions">
            {user.status === "pending" && <button type="button" className="sheet-button" onClick={() => setRejecting(true)} disabled={busy !== null}><X size={18} aria-hidden="true" />Ablehnen</button>}
            <button type="button" className="sheet-button sheet-button-primary" disabled={busy !== null} onClick={() => run("approve", () => approveRegistration({ userId: user.id, role, customer: choicePayload(role, choices) }), (data) => { setApproved(data); onNotice(`${name} ist freigegeben.`); })}>{busy === "approve" ? <Spinner /> : <Check size={18} aria-hidden="true" />}Freigeben</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// Logins ------------------------------------------------------------------------------------------------------------

/** Creates a login (with activation link) or edits one: person data, role, customer, link, status and deletion. */
export function UserDialog({ user, customers, nextNumber, nextFreelancerNumber, freelancers, events, mailConfigured, onClose, onNotice, onReview }: {
  user?: ManagedUser; customers: ManagedCustomer[]; nextNumber: string; nextFreelancerNumber: string; freelancers: boolean; events: ManagedEvent[]; mailConfigured: boolean; onClose: () => void; onNotice: (message: string) => void; onReview: (userId: string) => void;
}) {
  const [person, setPerson] = useState({ email: user?.email ?? "", firstName: user?.firstName ?? "", lastName: user?.lastName ?? "", phone: user?.phone ?? "", position: user?.position ?? "" });
  const [role, setRole] = useState<HubRole>(user?.role ?? "oalab_customer");
  const [choices, setChoices] = useState<Choices>(() => startChoices(customers, { customer: nextNumber, freelancer: nextFreelancerNumber }, { customer: { company: user?.companyName ?? "" } }, user?.customerIds[0]));
  // New logins get their activation link by mail unless the admin unticks it (or mail is not set up).
  const [mailLink, setMailLink] = useState(mailConfigured);
  const [link, setLink] = useState<{ link: string | null; activation: boolean; mail: MailStatus | null } | null>(null);
  const [confirming, setConfirming] = useState<"deactivate" | "delete" | null>(null);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [secondFactor, setSecondFactor] = useState(user?.secondFactor ?? "off");
  const { busy, error, run } = useAction();
  const info = useInfo(user ? "Zugang verwalten" : "Neues Konto", user ? {
    steps: [
      <><b>Passwort-Link</b> erzeugen oder per E-Mail senden.</>,
      <><b>Deaktivieren</b> sperrt sofort und ist umkehrbar.</>,
      <><b>Löschen</b> lässt sich nicht rückgängig machen.</>,
    ],
    ask: "Wie verwalte ich den Zugang eines Kontos?",
  } : {
    steps: [
      <><b>Aktivierungslink</b> per E-Mail oder zum Weitergeben.</>,
      <><b>Einmal gültig</b> und nur begrenzte Zeit.</>,
      <><b>Freelancer</b> bestätigen jede Anmeldung mit Code.</>,
    ],
    ask: "Wie lege ich ein neues Konto an?",
  });
  const set = (key: keyof typeof person) => (event: React.ChangeEvent<HTMLInputElement>) => setPerson((value) => ({ ...value, [key]: event.target.value }));
  const locked = Boolean(user?.demo);
  const disabled = busy !== null || locked;

  if (!user && link?.link) {
    return (
      <Modal title="Konto angelegt" onClose={onClose} className="users-modal">
        <p className="dialog-success"><ShieldCheck size={20} aria-hidden="true" />{`${person.firstName} ${person.lastName}`.trim()} hat jetzt ein Konto als {roleLabels[role]}.</p>
        {link.mail === "sent" ? <>
          <p className="mail-status is-sent"><MailCheck size={18} aria-hidden="true" />Der Aktivierungslink ist per E-Mail an {person.email} unterwegs.</p>
          <details className="history"><summary>Link trotzdem anzeigen</summary><LinkPanel link={link.link} activation user={person} /></details>
        </> : <>
          {link.mail && <p className={`mail-status${link.mail === "failed" ? " is-failed" : ""}`}><MailX size={18} aria-hidden="true" />{mailStatusText(link.mail)} Gib den Link bitte selbst weiter.</p>}
          <LinkPanel link={link.link} activation user={person} />
        </>}
      </Modal>
    );
  }

  if (user?.status === "pending") {
    return (
      <Modal title={fullName(user)} onClose={onClose} className="users-modal">
        <p className="modal-description">Diese Registrierung wartet auf deine Entscheidung.</p>
        <button type="button" className="sheet-button sheet-button-primary" onClick={() => onReview(user.id)}><ShieldCheck size={18} aria-hidden="true" />Registrierung prüfen</button>
      </Modal>
    );
  }

  const save = () => user
    ? run("save", () => updateHubUser({ userId: user.id, ...person, role, customer: choicePayload(role, choices) }), () => { onNotice(`Änderungen an ${fullName({ ...user, ...person })} gespeichert.`); onClose(); })
    : run("save", () => createHubUser({ ...person, role, customer: choicePayload(role, choices), mailLink: mailConfigured && mailLink }), (data) => { setLink({ link: data.link, activation: true, mail: data.mail }); onNotice(`Konto für ${person.firstName} ${person.lastName} angelegt.`); });
  const freelancerLogin = (user?.role ?? role) === "oalab_freelancer";

  return (
    <Modal title={user ? fullName(user) : "Konto anlegen"} onClose={onClose} className="users-modal" actions={info.button}>
      {info.box}
      {user && <p className="modal-description">{user.email} · <span className={`project-status status-${user.displayStatus}`}><i aria-hidden="true" />{displayStatusLabels[user.displayStatus]}</span>{user.lastSignInAt ? ` · zuletzt angemeldet ${formatFileDateTime(user.lastSignInAt)}` : " · noch nie angemeldet"}</p>}
      {locked && <p className="field-warning"><AlertTriangle size={16} aria-hidden="true" />Demo-Konto: wird per Seed verwaltet und ist hier schreibgeschützt.</p>}
      <form className="user-form" onSubmit={(event) => { event.preventDefault(); save(); }}>
        <div className="upload-fields">
          <label className="upload-field"><span>Vorname</span><input value={person.firstName} onChange={set("firstName")} maxLength={80} required disabled={disabled} autoComplete="off" /></label>
          <label className="upload-field"><span>Nachname</span><input value={person.lastName} onChange={set("lastName")} maxLength={80} required disabled={disabled} autoComplete="off" /></label>
          {!user && <label className="upload-field upload-field-wide"><span>E-Mail-Adresse</span><input type="email" value={person.email} onChange={set("email")} maxLength={254} required disabled={disabled} autoComplete="off" /></label>}
          <label className="upload-field"><span>Telefon</span><input type="tel" value={person.phone} onChange={set("phone")} maxLength={40} disabled={disabled} autoComplete="off" /></label>
          <label className="upload-field"><span>Position</span><input value={person.position} onChange={set("position")} maxLength={80} disabled={disabled} autoComplete="off" /></label>
        </div>
        <RoleAndCustomer role={role} onRole={setRole} choices={choices} onChoices={setChoices} customers={customers} disabled={disabled} roleLocked={Boolean(user?.self)} freelancers={freelancers} />
        {user?.self && <p className="field-hint">Deine eigene Rolle kannst du nicht ändern.</p>}
        {!user && <>
          <label className="check-row"><input type="checkbox" checked={mailConfigured && mailLink} onChange={(event) => setMailLink(event.target.checked)} disabled={disabled || !mailConfigured} />Aktivierungslink per E-Mail an die Person senden</label>
          <p className="field-hint">{mailConfigured ? "Mit dem Link setzt die Person ihr Passwort; vorher kann sie sich nicht anmelden. Den Link bekommst du in jedem Fall auch angezeigt." : "Der Mailversand ist noch nicht eingerichtet. Nach dem Anlegen bekommst du den Aktivierungslink zum Weitergeben angezeigt."}</p>
        </>}
        {error && !confirming && <p className="form-error" role="alert">{error}</p>}
        {!locked && <button type="submit" className="sheet-button sheet-button-primary" disabled={disabled}>{busy === "save" ? <Spinner /> : user ? <Save size={18} aria-hidden="true" /> : <UserPlus size={18} aria-hidden="true" />}{user ? "Änderungen speichern" : "Konto anlegen"}</button>}
      </form>

      {user && !locked && <>
        <div className="user-security">
          <label className="upload-field"><span>{busy === "secondFactor" ? <Spinner /> : <ShieldCheck size={16} aria-hidden="true" />} Zwei-Faktor-Schutz</span>
            <select value={secondFactor} disabled={busy !== null} onChange={(event) => {
              const choice = event.target.value === "email" ? "email" : "off";
              run("secondFactor", () => setHubUserSecondFactor({ userId: user.id, choice }), () => { setSecondFactor(choice); onNotice(choice === "email" ? `${fullName(user)} bestätigt jede Anmeldung jetzt mit einem Code per E-Mail.` : `Zwei-Faktor-Schutz für ${fullName(user)} ausgeschaltet.`); });
            }}>
              {!freelancerLogin && <option value="off">Aus</option>}
              <option value="email">Code per E-Mail</option>
              {secondFactor === "totp" && <option value="totp" disabled>Authenticator-App (von der Person eingerichtet)</option>}
            </select>
          </label>
          <p className="field-hint">{freelancerLogin
            ? `Freelancer bestätigen jede Anmeldung mit einem Code, weil sie die Dateien mehrerer Kunden sehen; ohne bestätigten Code zeigt die Datenbank ihnen keine Kundendaten. Der Code per E-Mail geht an ${user.email}.${secondFactor === "totp" ? " Stellst du auf E-Mail, wird die Authenticator-App entfernt." : ""}`
            : secondFactor === "totp"
              ? "Die Person bestätigt jede Anmeldung mit ihrer Authenticator-App. Stellst du auf E-Mail oder Aus, wird die App entfernt, etwa nach einem verlorenen Handy."
              : `Die Person wählt die Methode selbst im Profil, auch eine Authenticator-App. Der Code per E-Mail geht an ${user.email} und gilt ab der nächsten Seite, auch auf der Serviceplattform. Team-Konten fragt die Serviceplattform ohnehin nach einem Code.`}</p>
        </div>
        {user.status === "active" && (link?.link ?<LinkPanel link={link.link} activation={link.activation} user={user} /> : (
          <div className="user-link-actions">
            {link?.mail && <p className={`mail-status${link.mail === "sent" ? " is-sent" : link.mail === "failed" ? " is-failed" : ""}`}>{link.mail === "sent" ? <MailCheck size={18} aria-hidden="true" /> : <MailX size={18} aria-hidden="true" />}{link.mail === "sent" ? `${link.activation ? "Aktivierungslink" : "Link zum Passwort-Zurücksetzen"} an ${user.email} geschickt.` : mailStatusText(link.mail)}</p>}
            <div className="file-assign-actions">
              <button type="button" className="sheet-button" disabled={busy !== null} onClick={() => run("link", () => createPasswordLink({ userId: user.id, deliver: "copy" }), setLink)}>{busy === "link" ? <Spinner /> : <KeyRound size={18} aria-hidden="true" />}{user.lastSignInAt ? "Passwort-Link erzeugen" : "Aktivierungslink erzeugen"}</button>
              {mailConfigured && <button type="button" className="sheet-button" disabled={busy !== null} onClick={() => run("mail", () => createPasswordLink({ userId: user.id, deliver: "mail" }), setLink)}>{busy === "mail" ? <Spinner /> : <Send size={18} aria-hidden="true" />}Link per E-Mail senden</button>}
            </div>
          </div>
        ))}
        {!user.self && (
          <div className="danger-zone">
            {confirming === "delete" ? <>
              <label className="upload-field"><span>Zum endgültigen Löschen die E-Mail-Adresse eintragen: {user.email}</span><input type="email" value={confirmEmail} onChange={(event) => setConfirmEmail(event.target.value)} autoComplete="off" disabled={busy !== null} /></label>
              <p className="field-hint">Gelöscht werden Login, Profil und Kundenzuordnung. Dateien und Termine des Kunden bleiben erhalten. Das lässt sich nicht rückgängig machen.</p>
            </> : confirming === "deactivate" ? <p className="field-hint">Die Person kann sich nicht mehr anmelden und sieht sofort keine Daten mehr. Du kannst das Konto jederzeit wieder aktivieren.</p> : null}
            {error && confirming && <p className="form-error" role="alert">{error}</p>}
            <div className="file-assign-actions">
              {confirming ? <>
                <button type="button" className="sheet-button" onClick={() => { setConfirming(null); setConfirmEmail(""); }} disabled={busy !== null}>Abbrechen</button>
                {confirming === "delete"
                  ? <button type="button" className="sheet-button sheet-button-danger" disabled={busy !== null || confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()} onClick={() => run("delete", () => deleteHubUser({ userId: user.id, confirmEmail }), () => { onNotice(`Konto von ${fullName(user)} gelöscht.`); onClose(); })}>{busy === "delete" ? <Spinner /> : <Trash2 size={18} aria-hidden="true" />}Endgültig löschen</button>
                  : <button type="button" className="sheet-button sheet-button-danger" disabled={busy !== null} onClick={() => run("status", () => setHubUserActive({ userId: user.id, active: false }), () => { onNotice(`${fullName(user)} ist deaktiviert.`); onClose(); })}>{busy === "status" ? <Spinner /> : <Ban size={18} aria-hidden="true" />}Jetzt deaktivieren</button>}
              </> : <>
                {user.status === "active" && <button type="button" className="sheet-button" onClick={() => setConfirming("deactivate")}><Ban size={18} aria-hidden="true" />Deaktivieren</button>}
                {user.status === "disabled" && <button type="button" className="sheet-button" disabled={busy !== null} onClick={() => run("status", () => setHubUserActive({ userId: user.id, active: true }), () => { onNotice(`${fullName(user)} ist wieder aktiv.`); onClose(); })}>{busy === "status" ? <Spinner /> : <RotateCcw size={18} aria-hidden="true" />}Wieder aktivieren</button>}
                {user.status === "rejected" && <button type="button" className="sheet-button" onClick={() => onReview(user.id)}><ShieldCheck size={18} aria-hidden="true" />Doch freigeben</button>}
                <button type="button" className="sheet-button danger-text" onClick={() => setConfirming("delete")}><Trash2 size={18} aria-hidden="true" />Löschen …</button>
              </>}
            </div>
          </div>
        )}
      </>}
      <History events={events} />
    </Modal>
  );
}

// Customers ---------------------------------------------------------------------------------------------------------

/**
 * Creates or edits a customer (company) with packages, contact and address; lists the logins assigned to it. An
 * existing customer shows its logo on top: the button opens the same window as in the asset management.
 */
export function CustomerDialog({ customer, users, nextNumber, events, freelancers, freelancersEnabled, onClose, onNotice }: {
  customer?: ManagedCustomer; users: ManagedUser[]; nextNumber: string; events: ManagedEvent[];
  /** The freelancers who can look after a customer; freelancersEnabled once the database knows them. */
  freelancers: ManagedCustomer[]; freelancersEnabled: boolean;
  onClose: () => void; onNotice: (message: string) => void;
}) {
  const [draft, setDraft] = useState<CustomerDraft>(customer ? draftOf(customer) : emptyDraft(nextNumber));
  const [servedBy, setServedBy] = useState<string[]>(customer?.linkedIds ?? []);
  const [logoOpen, setLogoOpen] = useState(false);
  const { busy, error, run } = useAction();
  const info = useInfo("Kundenstamm", {
    steps: [
      <><b>Gilt in Hub und Service,</b> in beide Richtungen.</>,
      <><b>Neue Kunden</b> bekommen die nächste freie Nummer.</>,
      <><b>Pakete und Logo</b> legst du nach dem Anlegen fest.</>,
    ],
    ask: "Wie funktioniert der Kundenstamm?",
  });
  const members = customer ? users.filter((user) => customer.memberIds.includes(user.id)) : [];
  return (
    <Modal title={customer ? customer.company : "Kunde anlegen"} onClose={onClose} className="users-modal" actions={info.button}>
      {info.box}
      {customer && (
        <div className="customer-logo-row">
          <LogoMark logo={customer.logo} initials={companyInitials(customer.company)} className="avatar customer-logo-mark" plate />
          <span className="customer-logo-text"><strong>Logo</strong><small>{customer.logo ? "Sehen die Kunden in der Übersicht, unten links und am Handy." : "Noch keins hinterlegt, es stehen die Buchstaben."}</small></span>
          <button type="button" className="sheet-action" onClick={() => setLogoOpen(true)}><ImagePlus size={15} aria-hidden="true" />{customer.logo ? "Logo ändern" : "Logo hochladen"}</button>
        </div>
      )}
      {customer && logoOpen && <CustomerLogoDialog customer={customer} onClose={() => setLogoOpen(false)} onSaved={(message) => { setLogoOpen(false); onNotice(message); }} />}
      {customer && (
        <div className="customer-logo-row customer-packages-row">
          <span className="customer-logo-text"><strong>Pakete</strong><small>{customer.packages.length ? customer.packages.map((id) => packageCatalog[id].name).join(", ") : "Noch keine Pakete"}</small></span>
          <Link className="sheet-action" href={`${hubHref(false, "contracts")}?customer=${customer.id}`}><FileBadge size={15} aria-hidden="true" />Pakete bearbeiten</Link>
        </div>
      )}
      <form onSubmit={(event) => { event.preventDefault(); run("save", () => saveCustomer({ ...draft, id: customer?.id, freelancerIds: freelancersEnabled ? servedBy : undefined }), () => { onNotice(customer ? `${draft.company} gespeichert.` : `Kunde ${draft.company} angelegt.`); onClose(); }); }}>
        <CustomerFields draft={draft} onChange={setDraft} disabled={busy !== null} />
        <p className="field-hint">Die Kundinnen und Kunden sehen Unternehmen, Kundennummer und Kontaktdaten nach dem Login in ihrem Profil.{customer ? "" : " Die Pakete legst du nach dem Anlegen unter Vertrag & Domain fest."}</p>
        {freelancersEnabled && freelancers.length > 0 && <>
          <CustomerPicker customers={pickable(freelancers)} selected={servedBy} onChange={setServedBy} idPrefix="served-by" legend="Betreut von" emptyHint="nur vom oalab-Team" />
          <p className="field-hint">Ein Freelancer sieht Namen, Logo, Kontaktdaten und die freigegebenen Dateien dieses Kunden, nur lesend; Verträge, Angebote und Rechnungen nicht, außer du gibst sie frei. Chats, Termine und Logins des Kunden sieht er nicht. Der Kunde sieht nicht, wer ihn betreut.</p>
        </>}
        <p className="field-hint">{!customer || customer.inService
          ? "Unternehmen, Kundennummer und Kontaktdaten gelten auch in Service: Was du hier änderst, steht dort und umgekehrt. Die Logins dieses Kunden kommen mit demselben Zugang in Service."
          : "Diesen Kunden gibt es nur im Hub, nicht in Service."}</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="sheet-button sheet-button-primary" disabled={busy !== null}>{busy === "save" ? <Spinner /> : <Save size={18} aria-hidden="true" />}{customer ? "Änderungen speichern" : "Kunde anlegen"}</button>
      </form>
      {customer && (
        <div className="member-list">
          <h3>Logins ({members.length})</h3>
          {members.length ? <ul>{members.map((user) => <li key={user.id}><strong>{fullName(user)}</strong><small>{user.email} · {displayStatusLabels[user.displayStatus]}</small></li>)}</ul> : <p className="field-hint">Noch kein Login zugeordnet.</p>}
        </div>
      )}
      <History events={events} />
    </Modal>
  );
}

// Freelancers -------------------------------------------------------------------------------------------------------

/**
 * Creates or edits a freelancer: name, "FL-" number, contact and the customers they look after. A freelancer lives
 * only in the hub; their logins are created with "Konto anlegen" and the role Freelancer.
 */
export function FreelancerDialog({ freelancer, customers, users, nextNumber, events, onClose, onNotice }: {
  freelancer?: ManagedCustomer;
  /** The customers that can be assigned (entries of the kind customer). */
  customers: ManagedCustomer[];
  users: ManagedUser[]; nextNumber: string; events: ManagedEvent[]; onClose: () => void; onNotice: (message: string) => void;
}) {
  const [draft, setDraft] = useState<CustomerDraft>(freelancer ? draftOf(freelancer) : emptyDraft(nextNumber));
  const [customerIds, setCustomerIds] = useState<string[]>(freelancer?.linkedIds ?? []);
  const [logoOpen, setLogoOpen] = useState(false);
  const { busy, error, run } = useAction();
  const info = useInfo("Freelancer", {
    steps: [
      <><b>Nur im Hub,</b> die Nummer beginnt mit FL-.</>,
      <><b>Betreute Kunden</b> hakst du hier an.</>,
      <><b>Jede Anmeldung</b> bestätigt er mit einem Code.</>,
    ],
    ask: "Wie funktioniert ein Freelancer im Hub?",
  });
  const members = freelancer ? users.filter((user) => freelancer.memberIds.includes(user.id)) : [];
  return (
    <Modal title={freelancer ? freelancer.company : "Freelancer anlegen"} onClose={onClose} className="users-modal" actions={info.button}>
      {info.box}
      {freelancer && (
        <div className="customer-logo-row">
          <LogoMark logo={freelancer.logo} initials={companyInitials(freelancer.company)} className="avatar customer-logo-mark" plate />
          <span className="customer-logo-text"><strong>Logo</strong><small>{freelancer.logo ? "Sieht der Freelancer unten links, in der Übersicht und am Handy." : "Noch keins hinterlegt, es stehen die Buchstaben."}</small></span>
          <button type="button" className="sheet-action" onClick={() => setLogoOpen(true)}><ImagePlus size={15} aria-hidden="true" />{freelancer.logo ? "Logo ändern" : "Logo hochladen"}</button>
        </div>
      )}
      {freelancer && logoOpen && <CustomerLogoDialog customer={freelancer} onClose={() => setLogoOpen(false)} onSaved={(message) => { setLogoOpen(false); onNotice(message); }} />}
      <form onSubmit={(event) => { event.preventDefault(); run("save", () => saveFreelancer({ ...draft, id: freelancer?.id, customerIds }), () => { onNotice(freelancer ? `${draft.company} gespeichert.` : `Freelancer ${draft.company} angelegt.`); onClose(); }); }}>
        <CustomerFields draft={draft} onChange={setDraft} disabled={busy !== null} freelancer />
        <CustomerPicker customers={pickable(customers)} selected={customerIds} onChange={setCustomerIds} idPrefix="freelancer-customers" legend="Betreute Kunden" emptyHint="noch keine" />
        <p className="field-hint">Der Freelancer sieht im Asset Management seine eigenen Dateien und die Dateien dieser Kunden, nur lesend. Verträge, Angebote und Rechnungen der Kunden sieht er nicht, außer du gibst sie frei. Chats, Termine und Logins der Kunden bleiben ihm verborgen. Kunden anlegen kann er nicht, und auf der Serviceplattform hat er keinen Zugang.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="sheet-button sheet-button-primary" disabled={busy !== null}>{busy === "save" ? <Spinner /> : <Save size={18} aria-hidden="true" />}{freelancer ? "Änderungen speichern" : "Freelancer anlegen"}</button>
      </form>
      {freelancer && (
        <div className="member-list">
          <h3>Logins ({members.length})</h3>
          {members.length ? <ul>{members.map((user) => <li key={user.id}><strong>{fullName(user)}</strong><small>{user.email} · {displayStatusLabels[user.displayStatus]}</small></li>)}</ul> : <p className="field-hint">Noch kein Login. Lege ihn über „Konto anlegen“ mit der Rolle Freelancer an.</p>}
        </div>
      )}
      <History events={events} />
    </Modal>
  );
}
