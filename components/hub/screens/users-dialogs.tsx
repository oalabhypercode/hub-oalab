"use client";

import { useState } from "react";
import { AlertTriangle, Ban, Check, Copy, KeyRound, Loader2, Mail, MailCheck, MailX, RotateCcw, Save, Send, ShieldCheck, Trash2, UserPlus, X } from "lucide-react";
import { approveRegistration, createHubUser, createPasswordLink, deleteHubUser, rejectRegistration, saveCustomer, setHubUserActive, setHubUserSecondFactor, updateHubUser, type ActionResult } from "@/lib/hub-users/actions";
import type { MailStatus } from "@/lib/hub-mail/smtp";
import { displayStatusLabels, roleLabels, servicePackageIds, suggestCustomer, type HubRole } from "@/lib/hub-users/rules";
import type { ManagedCustomer, ManagedEvent, ManagedUser } from "@/lib/hub-users/types";
import { formatFileDateTime } from "@/lib/hub-files/catalog";
import { servicePackages, type ServicePackageId } from "@/lib/service-packages";
import { Modal } from "../modal";

export const fullName = (user: Pick<ManagedUser, "firstName" | "lastName" | "email">) => `${user.firstName} ${user.lastName}`.trim() || user.email;

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

const Spinner = () => <Loader2 size={18} className="spin" aria-hidden="true" />;

// Customer data -----------------------------------------------------------------------------------------------------

export type CustomerDraft = {
  company: string;
  customerNumber: string;
  servicePackages: ServicePackageId[];
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
  servicePackages: customer.servicePackages,
  contactEmail: customer.contactEmail,
  phone: customer.phone,
  website: customer.website,
  street: customer.street,
  postalCode: customer.postalCode,
  city: customer.city,
  country: customer.country,
});

export const emptyDraft = (customerNumber: string, preset: Partial<CustomerDraft> = {}): CustomerDraft => ({
  company: "", customerNumber, servicePackages: [], contactEmail: "", phone: "", website: "", street: "", postalCode: "", city: "", country: "Deutschland", ...preset,
});

/** Company, customer number, service packages, contact and address of one customer. */
function CustomerFields({ draft, onChange, disabled, compact = false }: { draft: CustomerDraft; onChange: (draft: CustomerDraft) => void; disabled: boolean; compact?: boolean }) {
  const set = (key: keyof CustomerDraft) => (event: React.ChangeEvent<HTMLInputElement>) => onChange({ ...draft, [key]: event.target.value });
  const togglePackage = (id: ServicePackageId) => onChange({ ...draft, servicePackages: draft.servicePackages.includes(id) ? draft.servicePackages.filter((item) => item !== id) : [...draft.servicePackages, id] });
  return (
    <div className="upload-fields">
      <label className="upload-field"><span>Unternehmen</span><input value={draft.company} onChange={set("company")} maxLength={200} required disabled={disabled} autoComplete="organization" /></label>
      <label className="upload-field"><span>Kundennummer</span><input value={draft.customerNumber} onChange={set("customerNumber")} maxLength={40} required disabled={disabled} className="numeric" /></label>
      <fieldset className="upload-field upload-field-wide package-checks" disabled={disabled}>
        <legend>Servicepakete</legend>
        {servicePackageIds.map((id) => <label key={id}><input type="checkbox" checked={draft.servicePackages.includes(id)} onChange={() => togglePackage(id)} />{servicePackages[id].name}</label>)}
      </fieldset>
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
const choicePayload = (role: HubRole, choice: Choice) => role === "oalab_admin" ? { mode: "none" } : choice.mode === "existing" ? { mode: "existing", customerId: choice.customerId } : { mode: "new", customer: choice.draft };

/** Role and, for customers, the customer: an existing one or a new one created on the spot. */
function RoleAndCustomer({ role, onRole, choice, onChoice, customers, disabled, roleLocked = false }: {
  role: HubRole; onRole: (role: HubRole) => void; choice: Choice; onChoice: (choice: Choice) => void; customers: ManagedCustomer[]; disabled: boolean; roleLocked?: boolean;
}) {
  return (
    <div className="role-customer">
      <fieldset className="choice-group" disabled={disabled || roleLocked}>
        <legend>Rolle</legend>
        {(["oalab_customer", "oalab_admin"] as const).map((item) => (
          <label key={item} className="choice-option"><input type="radio" name="role" checked={role === item} onChange={() => onRole(item)} />
            <span><strong>{roleLabels[item]}</strong><small>{item === "oalab_admin" ? "Sieht alle Kunden und verwaltet Konten, Dateien und Termine." : "Sieht nur die Daten des zugeordneten Kunden."}</small></span>
          </label>
        ))}
      </fieldset>
      {role === "oalab_admin" && !roleLocked && <p className="field-warning"><AlertTriangle size={16} aria-hidden="true" />Admins sehen alle Kunden und dürfen Konten verwalten. Vergib diese Rolle nur an das oalab-Team.</p>}
      {role === "oalab_customer" && <>
        <fieldset className="choice-group" disabled={disabled}>
          <legend>Kunde</legend>
          <label className="choice-option"><input type="radio" name="customer-mode" checked={choice.mode === "existing"} onChange={() => onChoice({ ...choice, mode: "existing" })} disabled={!customers.length} />
            <span><strong>Bestehendem Kunden zuordnen</strong><small>{customers.length ? "Die Person sieht die Dateien, Termine und Projekte dieses Kunden." : "Es gibt noch keine Kunden."}</small></span>
          </label>
          <label className="choice-option"><input type="radio" name="customer-mode" checked={choice.mode === "new"} onChange={() => onChoice({ ...choice, mode: "new" })} />
            <span><strong>Neuen Kunden anlegen</strong><small>Auch in Service, mit einer freien Kundennummer.</small></span>
          </label>
        </fieldset>
        {choice.mode === "existing" && customers.length > 0 && (
          <label className="upload-field"><span>Kunde</span>
            <select value={choice.customerId} onChange={(event) => onChoice({ ...choice, customerId: event.target.value })} disabled={disabled}>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.customerNumber} · {customer.company}</option>)}
            </select>
          </label>
        )}
        {choice.mode === "new" && <CustomerFields draft={choice.draft} onChange={(draft) => onChoice({ ...choice, draft })} disabled={disabled} compact />}
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
export function ReviewDialog({ user, customers, nextNumber, onClose, onNotice }: { user: ManagedUser; customers: ManagedCustomer[]; nextNumber: string; onClose: () => void; onNotice: (message: string) => void }) {
  const suggestion = suggestCustomer(user, customers);
  const [role, setRole] = useState<HubRole>("oalab_customer");
  const [choice, setChoice] = useState<Choice>({
    mode: suggestion || (!user.companyName && customers.length) ? "existing" : "new",
    customerId: suggestion?.id ?? customers[0]?.id ?? "",
    draft: emptyDraft(nextNumber, { company: user.companyName, website: user.website, contactEmail: user.email, phone: user.phone }),
  });
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [approved, setApproved] = useState<{ customerNumber: string | null; mail: MailStatus } | null>(null);
  const [copied, setCopied] = useState(false);
  const { busy, error, run } = useAction();
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
    <Modal title="Registrierung prüfen" onClose={onClose} className="users-modal">
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
          <RoleAndCustomer role={role} onRole={setRole} choice={choice} onChoice={setChoice} customers={customers} disabled={busy !== null} />
          {!user.emailConfirmed && <p className="field-hint">Die E-Mail-Adresse ist noch nicht bestätigt. Anmelden kann sich die Person erst nach der Bestätigung.</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="file-assign-actions">
            {user.status === "pending" && <button type="button" className="sheet-button" onClick={() => setRejecting(true)} disabled={busy !== null}><X size={18} aria-hidden="true" />Ablehnen</button>}
            <button type="button" className="sheet-button sheet-button-primary" disabled={busy !== null} onClick={() => run("approve", () => approveRegistration({ userId: user.id, role, customer: choicePayload(role, choice) }), (data) => { setApproved(data); onNotice(`${name} ist freigegeben.`); })}>{busy === "approve" ? <Spinner /> : <Check size={18} aria-hidden="true" />}Freigeben</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// Logins ------------------------------------------------------------------------------------------------------------

/** Creates a login (with activation link) or edits one: person data, role, customer, link, status and deletion. */
export function UserDialog({ user, customers, nextNumber, events, mailConfigured, onClose, onNotice, onReview }: {
  user?: ManagedUser; customers: ManagedCustomer[]; nextNumber: string; events: ManagedEvent[]; mailConfigured: boolean; onClose: () => void; onNotice: (message: string) => void; onReview: (userId: string) => void;
}) {
  const [person, setPerson] = useState({ email: user?.email ?? "", firstName: user?.firstName ?? "", lastName: user?.lastName ?? "", phone: user?.phone ?? "", position: user?.position ?? "" });
  const [role, setRole] = useState<HubRole>(user?.role ?? "oalab_customer");
  const [choice, setChoice] = useState<Choice>({
    mode: user?.customerIds[0] || customers.length ? "existing" : "new",
    customerId: user?.customerIds[0] ?? customers[0]?.id ?? "",
    draft: emptyDraft(nextNumber, { company: user?.companyName ?? "" }),
  });
  // New logins get their activation link by mail unless the admin unticks it (or mail is not set up).
  const [mailLink, setMailLink] = useState(mailConfigured);
  const [link, setLink] = useState<{ link: string | null; activation: boolean; mail: MailStatus | null } | null>(null);
  const [confirming, setConfirming] = useState<"deactivate" | "delete" | null>(null);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [secondFactor, setSecondFactor] = useState(user?.secondFactor ?? "off");
  const { busy, error, run } = useAction();
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
    ? run("save", () => updateHubUser({ userId: user.id, ...person, role, customer: choicePayload(role, choice) }), () => { onNotice(`Änderungen an ${fullName({ ...user, ...person })} gespeichert.`); onClose(); })
    : run("save", () => createHubUser({ ...person, role, customer: choicePayload(role, choice), mailLink: mailConfigured && mailLink }), (data) => { setLink({ link: data.link, activation: true, mail: data.mail }); onNotice(`Konto für ${person.firstName} ${person.lastName} angelegt.`); });

  return (
    <Modal title={user ? fullName(user) : "Benutzer anlegen"} onClose={onClose} className="users-modal">
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
        <RoleAndCustomer role={role} onRole={setRole} choice={choice} onChoice={setChoice} customers={customers} disabled={disabled} roleLocked={Boolean(user?.self)} />
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
              <option value="off">Aus</option>
              <option value="email">Code per E-Mail</option>
              {secondFactor === "totp" && <option value="totp" disabled>Authenticator-App (von der Person eingerichtet)</option>}
            </select>
          </label>
          <p className="field-hint">{secondFactor === "totp"
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

/** Creates or edits a customer (company) with packages, contact and address; lists the logins assigned to it. */
export function CustomerDialog({ customer, users, nextNumber, events, onClose, onNotice }: { customer?: ManagedCustomer; users: ManagedUser[]; nextNumber: string; events: ManagedEvent[]; onClose: () => void; onNotice: (message: string) => void }) {
  const [draft, setDraft] = useState<CustomerDraft>(customer ? draftOf(customer) : emptyDraft(nextNumber));
  const { busy, error, run } = useAction();
  const members = customer ? users.filter((user) => customer.memberIds.includes(user.id)) : [];
  return (
    <Modal title={customer ? customer.company : "Kunde anlegen"} onClose={onClose} className="users-modal">
      <form onSubmit={(event) => { event.preventDefault(); run("save", () => saveCustomer({ ...draft, id: customer?.id }), () => { onNotice(customer ? `${draft.company} gespeichert.` : `Kunde ${draft.company} angelegt.`); onClose(); }); }}>
        <CustomerFields draft={draft} onChange={setDraft} disabled={busy !== null} />
        <p className="field-hint">Die Kundinnen und Kunden sehen Unternehmen, Kundennummer, Servicepakete und Kontaktdaten nach dem Login in ihrem Profil.</p>
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
