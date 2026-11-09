"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Ban, Building2, Check, ChevronDown, ChevronRight, Copy, FileBadge, Handshake, ImagePlus, Info, KeyRound, LogIn, Mail, MailCheck, MailX, Plus, RotateCcw, Send, Shield, ShieldCheck, Trash2, UserPlus, UserRound, X, type LucideIcon } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { approveRegistration, createHubUser, createPasswordLink, deleteHubUser, rejectRegistration, saveCustomer, saveFreelancer, setHubUserActive, setHubUserSecondFactor, updateHubUser, type ActionResult } from "@/lib/hub-users/actions";
import type { MailStatus } from "@/lib/hub-mail/smtp";
import { displayStatusLabels, kindForRole, roleLabels, suggestCustomer, type CustomerKind, type DisplayStatus, type HubRole } from "@/lib/hub-users/rules";
import type { ManagedCustomer, ManagedEvent, ManagedUser } from "@/lib/hub-users/types";
import { formatFileDateTime } from "@/lib/hub-files/catalog";
import { hubHref } from "@/lib/hub-data";
import { packageCatalog } from "@/lib/service-packages";
import { CustomerLogoDialog } from "../customer-logo-dialog";
import { useInfo } from "../info-box";
import { LogoMark, companyInitials } from "../logo-mark";
import { StatusGlyph, type GlyphKind } from "../sheet";
import { AssetPanel } from "./asset-panel";
import { EntryChips, EntryNav, Field, FieldGrid, HistoryList, PanelSection, PanelTabs, ReadonlyField, Row, RowIcon, RowList, SaveStatus, Segmented, useDirtyReport } from "./users-panel";

/*
 * The User Management's panels: a login, a registration, a customer and a freelancer, each new or existing. They open at
 * the right edge next to the table, in its look (decision of 9.11.2026, variant V2), and replace the glass windows.
 */

export const fullName = (user: Pick<ManagedUser, "firstName" | "lastName" | "email">) => `${user.firstName} ${user.lastName}`.trim() || user.email;
const initialsOf = (user: Pick<ManagedUser, "firstName" | "lastName" | "email">) => ((user.firstName[0] ?? "") + (user.lastName[0] ?? "")).toUpperCase() || user.email.slice(0, 1).toUpperCase() || "?";

export const statusGlyph: Record<DisplayStatus, GlyphKind> = { pending: "pending", invited: "invited", active: "active", disabled: "disabled", rejected: "rejected" };

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

const Spinner = () => <MiniLoader size={16} />;

/**
 * "Speichern" sits in the footer, outside the form, and submits it there so the browser checks the required fields.
 * From another tab it first goes to the form's tab.
 */
function useFooterSubmit<T extends string>(formTab: T, tab: T, setTab: (tab: T) => void) {
  const formRef = useRef<HTMLFormElement>(null);
  const pending = useRef(false);
  useEffect(() => {
    if (!pending.current || !formRef.current) return;
    pending.current = false;
    formRef.current.requestSubmit();
  }, [tab]);
  const submit = () => {
    if (formRef.current) { formRef.current.requestSubmit(); return; }
    pending.current = true;
    setTab(formTab);
  };
  return { formRef, submit };
}

/** What every panel gets from the page: closing (Abbrechen discards without asking), the notice, unsaved changes, ↑/↓. */
type PanelProps = {
  onClose: (discard?: boolean) => void;
  onNotice: (message: string) => void;
  onDirty?: (dirty: boolean) => void;
  onPrev?: () => void;
  onNext?: () => void;
};

/** E-mail and status of a login under its name. */
function UserLine({ user }: { user: ManagedUser }) {
  return <><span className="um-clip">{user.email}</span><span className="um-dot" aria-hidden="true">·</span><span className="status-cell"><StatusGlyph kind={statusGlyph[user.displayStatus]} />{displayStatusLabels[user.displayStatus]}</span></>;
}

const Count = ({ value }: { value: number }) => <span className="um-count numeric">{value}</span>;

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
 * Company, customer number and contact of one customer; its packages live under „Vertrag & Domain“. A freelancer has a
 * name (person or company) and an "FL-" number, and no packages: they have no access to the service platform.
 */
function CompanyFields({ draft, onChange, disabled, compact = false, freelancer = false }: { draft: CustomerDraft; onChange: (draft: CustomerDraft) => void; disabled: boolean; compact?: boolean; freelancer?: boolean }) {
  const set = (key: keyof CustomerDraft) => (event: React.ChangeEvent<HTMLInputElement>) => onChange({ ...draft, [key]: event.target.value });
  return (
    <FieldGrid>
      <Field label={freelancer ? "Name oder Firma" : "Unternehmen"}><input className="am-input" value={draft.company} onChange={set("company")} maxLength={200} required disabled={disabled} autoComplete="organization" /></Field>
      <Field label={freelancer ? "Freelancer-Nr." : "Kundennummer"}><input className="am-input numeric is-number" value={draft.customerNumber} onChange={set("customerNumber")} maxLength={40} required disabled={disabled} /></Field>
      {(!compact || freelancer) && <Field label="Kontakt-E-Mail" wide={compact}><input className="am-input" type="email" value={draft.contactEmail} onChange={set("contactEmail")} maxLength={254} disabled={disabled} placeholder="info@beispiel.de" /></Field>}
      {!compact && <>
        <Field label="Telefon"><input className="am-input" type="tel" value={draft.phone} onChange={set("phone")} maxLength={40} disabled={disabled} /></Field>
        <Field label="Website" wide><input className="am-input" value={draft.website} onChange={set("website")} maxLength={200} disabled={disabled} placeholder="beispiel.de" /></Field>
      </>}
    </FieldGrid>
  );
}

function AddressFields({ draft, onChange, disabled }: { draft: CustomerDraft; onChange: (draft: CustomerDraft) => void; disabled: boolean }) {
  const set = (key: keyof CustomerDraft) => (event: React.ChangeEvent<HTMLInputElement>) => onChange({ ...draft, [key]: event.target.value });
  return (
    <FieldGrid address>
      <Field label="Straße und Hausnummer" wide><input className="am-input" value={draft.street} onChange={set("street")} maxLength={120} disabled={disabled} autoComplete="street-address" /></Field>
      <Field label="PLZ"><input className="am-input" value={draft.postalCode} onChange={set("postalCode")} maxLength={12} disabled={disabled} autoComplete="postal-code" /></Field>
      <Field label="Ort"><input className="am-input" value={draft.city} onChange={set("city")} maxLength={80} disabled={disabled} autoComplete="address-level2" /></Field>
      <Field label="Land" wide><input className="am-input" value={draft.country} onChange={set("country")} maxLength={60} disabled={disabled} autoComplete="country-name" /></Field>
    </FieldGrid>
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
const roleIcons: Record<HubRole, LucideIcon> = { oalab_customer: UserRound, oalab_freelancer: Handshake, oalab_admin: ShieldCheck };

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
  const chosen = choice ? options.find((entry) => entry.id === choice.customerId) ?? null : null;
  return (
    <div className="um-stack">
      <div className="um-field">
        <span className="am-label">Rolle</span>
        <Segmented label="Rolle" value={role} onChange={onRole} disabled={disabled || roleLocked} options={roles.map((id) => ({ id, label: roleLabels[id], icon: roleIcons[id] }))} />
        <p className="am-help">{roleLocked ? "Deine eigene Rolle kannst du nicht ändern." : roleHints[role]}</p>
      </div>
      {role === "oalab_admin" && !roleLocked && <p className="am-note is-todo"><AlertTriangle size={16} aria-hidden="true" /><span>Admins sehen alle Kunden und dürfen Konten verwalten. Vergib diese Rolle nur an das oalab-Team.</span></p>}
      {isFreelancer && <p className="am-help">Freelancer bestätigen jede Anmeldung mit einem Code per E-Mail. Welche Kunden sie betreuen, legst du beim Freelancer fest.</p>}
      {kind && choice && (choice.mode === "existing" && options.length ? (
        <div className="um-field">
          <span className="am-label">{isFreelancer ? "Gehört zum Freelancer" : "Gehört zum Kunden"}
            <button type="button" className="am-label-action" onClick={() => setChoice({ ...choice, mode: "new" })} disabled={disabled}><Plus size={13} aria-hidden="true" />{isFreelancer ? "Neuen Freelancer anlegen" : "Neuen Kunden anlegen"}</button>
          </span>
          <span className="um-pick">
            <LogoMark logo={chosen?.logo} initials={companyInitials(chosen?.company ?? "")} className="company-mark" />
            <select value={choice.customerId} onChange={(event) => setChoice({ ...choice, customerId: event.target.value })} disabled={disabled} aria-label={isFreelancer ? "Freelancer" : "Kunde"}>
              {options.map((entry) => <option key={entry.id} value={entry.id}>{entry.company} · {entry.customerNumber}</option>)}
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </span>
          <p className="am-help">{isFreelancer ? "Die Person sieht die Dateien dieses Freelancers und seiner Kunden." : "Die Person sieht die Dateien, Termine und Projekte dieses Kunden."}</p>
        </div>
      ) : (
        <div className="um-field um-new-entry">
          <span className="am-label">{isFreelancer ? "Neuer Freelancer" : "Neuer Kunde"}
            {options.length > 0 && <button type="button" className="am-label-action" onClick={() => setChoice({ ...choice, mode: "existing" })} disabled={disabled}>Bestehenden wählen</button>}
          </span>
          <CompanyFields draft={choice.draft} onChange={(draft) => setChoice({ ...choice, draft })} disabled={disabled} compact freelancer={isFreelancer} />
          <p className="am-help">{isFreelancer ? "Nur im Hub, mit einer freien FL-Nummer." : "Auch in Service, mit einer freien Kundennummer."}</p>
        </div>
      ))}
    </div>
  );
}

/** A one-time link to set the password, with copy and e-mail buttons. It is shown once and never stored. */
function LinkPanel({ link, activation, user }: { link: string; activation: boolean; user: { firstName: string; email: string } }) {
  const [copied, setCopied] = useState(false);
  const subject = activation ? "Dein Zugang zum oalab Client Hub" : "Neues Passwort für den oalab Client Hub";
  const body = `Hallo ${user.firstName || ""},\n\n${activation ? "dein Zugang zum oalab Client Hub ist eingerichtet. Über diesen persönlichen Link legst du dein Passwort fest und meldest dich an:" : "über diesen persönlichen Link legst du ein neues Passwort für den oalab Client Hub fest:"}\n\n${link}\n\nDer Link funktioniert nur einmal und ist zeitlich begrenzt gültig.\n\nViele Grüße\nDein oalab-Team`;
  return (
    <div className="um-link">
      <input className="am-input" readOnly value={link} aria-label={activation ? "Aktivierungslink" : "Link zum Passwort-Zurücksetzen"} onFocus={(event) => event.currentTarget.select()} />
      <div className="um-actions">
        <button type="button" className="sheet-action is-quiet" onClick={async () => setCopied(await copyText(link))}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? "Kopiert" : "Link kopieren"}</button>
        <a className="sheet-action" href={`mailto:${encodeURIComponent(user.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}><Mail size={14} aria-hidden="true" />Im Mailprogramm öffnen</a>
      </div>
      <p className="am-help">Der Link meldet die Person an und lässt sie ein Passwort setzen. Er gilt einmal und läuft ab; schicke ihn nur an ihre eigene Adresse.</p>
    </div>
  );
}

/** The logins of a customer or a freelancer; the arrow opens one of them in the panel. */
function MemberRows({ members, onOpenUser }: { members: ManagedUser[]; onOpenUser: (user: ManagedUser) => void }) {
  return (
    <RowList>
      {members.map((user) => (
        <Row key={user.id} lead={<span className="avatar" aria-hidden="true">{initialsOf(user)}</span>} title={fullName(user)} text={user.email}>
          <span className="status-cell"><StatusGlyph kind={statusGlyph[user.displayStatus]} />{displayStatusLabels[user.displayStatus]}</span>
          <button type="button" className="am-icon-btn" onClick={() => onOpenUser(user)} aria-label={`${fullName(user)} öffnen`} title="Konto öffnen"><ChevronRight size={16} aria-hidden="true" /></button>
        </Row>
      ))}
    </RowList>
  );
}

// Registration ------------------------------------------------------------------------------------------------------

/** All details of a registration and the decision: approve with role and customer, or reject with a note. */
export function ReviewPanel({ user, customers, nextNumber, nextFreelancerNumber, freelancers, onClose, onNotice, onDirty, onPrev, onNext }: PanelProps & { user: ManagedUser; customers: ManagedCustomer[]; nextNumber: string; nextFreelancerNumber: string; freelancers: boolean }) {
  const suggestion = suggestCustomer(user, customers.filter((entry) => entry.kind === "customer"));
  const fresh = () => ({
    role: "oalab_customer" as HubRole,
    choices: startChoices(customers, { customer: nextNumber, freelancer: nextFreelancerNumber }, {
      customer: { company: user.companyName, website: user.website, contactEmail: user.email, phone: user.phone },
      freelancer: { company: user.companyName, website: user.website, contactEmail: user.email, phone: user.phone },
    }, suggestion?.id, Boolean(user.companyName) && !suggestion),
  });
  const [decision, setDecision] = useState(fresh);
  const [base] = useState(() => JSON.stringify(fresh()));
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [approved, setApproved] = useState<{ customerNumber: string | null; mail: MailStatus } | null>(null);
  const [copied, setCopied] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const { busy, error, run } = useAction();
  const info = useInfo("Freigabe", {
    steps: [
      <><b>Rolle und Kunde</b> wählen, bestehend oder neu.</>,
      <><b>Freigeben</b> schickt den Link zum Login per E-Mail.</>,
      <><b>Ablehnen</b> mit Begründung; später umkehrbar.</>,
    ],
    ask: "Wie gebe ich eine Registrierung frei?",
  });
  useDirtyReport(approved === null && (JSON.stringify(decision) !== base || note.trim() !== ""), onDirty);
  const name = fullName(user);
  const loginUrl = typeof window === "undefined" ? "" : `${window.location.origin}/auth/login`;
  const message = `Hallo ${user.firstName},\n\ndein Zugang zum oalab Client Hub ist freigeschaltet. Du kannst dich ab sofort mit deiner E-Mail-Adresse ${user.email} und deinem Passwort anmelden:\n\n${loginUrl}\n\nViele Grüße\nDein oalab-Team`;
  const avatar = <span className="avatar" aria-hidden="true">{initialsOf(user)}</span>;
  const approve = () => run("approve", () => approveRegistration({ userId: user.id, role: decision.role, customer: choicePayload(decision.role, decision.choices) }), (data) => { setApproved(data); onNotice(`${name} ist freigegeben.`); });

  if (approved !== null) {
    const handOver = <>
      <textarea className="am-textarea" readOnly value={message} rows={8} aria-label="Nachricht an die Person" />
      <div className="um-actions">
        <button type="button" className="sheet-action is-quiet" onClick={async () => setCopied(await copyText(message))}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? "Kopiert" : "Nachricht kopieren"}</button>
        <a className="sheet-action" href={`mailto:${encodeURIComponent(user.email)}?subject=${encodeURIComponent("Dein Zugang zum oalab Client Hub ist freigeschaltet")}&body=${encodeURIComponent(message)}`}><Mail size={14} aria-hidden="true" />Im Mailprogramm öffnen</a>
      </div>
    </>;
    return (
      <AssetPanel className="um-panel" label="Registrierung freigegeben" icon={avatar} title={name} subtitle="Registrierung freigegeben" onClose={() => onClose(true)}
        footer={<><span className="um-foot-state" /><button type="button" className="sheet-action is-primary" onClick={() => onClose(true)}><Check size={15} aria-hidden="true" />Fertig</button></>}>
        <div className="um-stack um-pad">
          <p className="am-note is-ok"><ShieldCheck size={16} aria-hidden="true" /><span>{name} hat jetzt Zugang{approved.customerNumber ? ` als Kunde ${approved.customerNumber}` : ""}.</span></p>
          {approved.mail === "sent" ? <>
            <p className="am-note is-ok"><MailCheck size={16} aria-hidden="true" /><span>Wir haben {user.firstName || name} per E-Mail informiert, mit Link zum Login.</span></p>
            <details className="um-more"><summary>Nachricht trotzdem selbst schicken</summary><div className="um-stack">{handOver}</div></details>
          </> : <>
            <p className={`am-note ${approved.mail === "failed" ? "is-bad" : "is-todo"}`}><MailX size={16} aria-hidden="true" /><span>{mailStatusText(approved.mail)} Gib der Person kurz selbst Bescheid; sie hat bei der Registrierung ihr Passwort gesetzt und kann sich sofort anmelden.</span></p>
            {handOver}
          </>}
        </div>
      </AssetPanel>
    );
  }

  const footer = rejecting ? <>
    <span className="um-foot-state" />
    <button type="button" className="sheet-action is-quiet" onClick={() => setRejecting(false)} disabled={busy !== null}>Zurück</button>
    <button type="button" className="sheet-action is-danger" disabled={busy !== null} onClick={() => run("reject", () => rejectRegistration({ userId: user.id, note }), (data) => { onNotice(`Registrierung von ${name} abgelehnt. ${data.mail === "sent" ? "Die Person wurde per E-Mail informiert." : mailStatusText(data.mail)}`); onClose(true); })}>{busy === "reject" ? <Spinner /> : <X size={15} aria-hidden="true" />}Ablehnen</button>
  </> : <>
    <span className="um-foot-state" />
    {user.status === "pending" && <button type="button" className="sheet-action is-quiet" onClick={() => setRejecting(true)} disabled={busy !== null}><X size={15} aria-hidden="true" />Ablehnen</button>}
    <button type="button" className="sheet-action is-primary" disabled={busy !== null} onClick={() => formRef.current?.requestSubmit()}>{busy === "approve" ? <Spinner /> : <Check size={15} aria-hidden="true" />}Freigeben</button>
  </>;

  return (
    <AssetPanel className="um-panel" label={`Registrierung von ${name}`} icon={avatar} title={name} subtitle={<UserLine user={user} />} actions={<>{info.button}<EntryNav onPrev={onPrev} onNext={onNext} /></>} onClose={() => onClose()} footer={footer}>
      {info.box}
      <PanelSection title="Angaben aus der Registrierung">
        <dl className="am-dl">
          <dt>Name</dt><dd>{name}</dd>
          <dt>Position</dt><dd>{user.position || "–"}</dd>
          <dt>Unternehmen</dt><dd>{user.companyName || "–"}</dd>
          <dt>E-Mail</dt><dd>{user.email} <span className={user.emailConfirmed ? "confirm-badge" : "confirm-badge is-open"}>{user.emailConfirmed ? "bestätigt" : "noch nicht bestätigt"}</span></dd>
          <dt>Telefon</dt><dd>{user.phone || "–"}</dd>
          <dt>Website</dt><dd>{user.website ? <a href={user.website} target="_blank" rel="noopener noreferrer">{user.website.replace(/^https?:\/\//, "")}</a> : "–"}</dd>
          <dt>Kundennummer</dt><dd>{user.customerNumberHint || "–"}</dd>
          <dt>Registriert</dt><dd>{formatFileDateTime(user.createdAt)}</dd>
          {user.message && <><dt>Nachricht</dt><dd className="um-message">{user.message}</dd></>}
        </dl>
        {user.status === "rejected" && <p className="am-note is-todo"><AlertTriangle size={16} aria-hidden="true" /><span>Diese Registrierung wurde abgelehnt{user.decisionNote ? `: „${user.decisionNote}“` : ""}. Du kannst sie trotzdem freigeben.</span></p>}
        {suggestion && <p className="am-note is-ok"><Check size={16} aria-hidden="true" /><span>Passt zu {suggestion.customerNumber} · {suggestion.company}{user.customerNumberHint === suggestion.customerNumber ? " (Kundennummer stimmt)" : " (gleicher Firmenname)"}</span></p>}
      </PanelSection>
      {rejecting ? (
        <PanelSection title="Ablehnen">
          <label className="um-field"><span className="am-label">Begründung für die Person (optional)</span>
            <textarea className="am-textarea" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={4} disabled={busy !== null} placeholder="z. B. Wir konnten dein Unternehmen keinem Projekt zuordnen." />
          </label>
          <p className="am-help">Die Person bekommt den Text per E-Mail und sieht ihn nach dem Login.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
        </PanelSection>
      ) : (
        <form ref={formRef} className="um-form" onSubmit={(event) => { event.preventDefault(); approve(); }}>
          <PanelSection title="Rolle und Kunde">
            <RoleAndCustomer role={decision.role} onRole={(role) => setDecision((current) => ({ ...current, role }))} choices={decision.choices} onChoices={(choices) => setDecision((current) => ({ ...current, choices }))} customers={customers} disabled={busy !== null} freelancers={freelancers} />
            {!user.emailConfirmed && <p className="am-help">Die E-Mail-Adresse ist noch nicht bestätigt. Anmelden kann sich die Person erst nach der Bestätigung.</p>}
            {error && <p className="form-error" role="alert">{error}</p>}
          </PanelSection>
        </form>
      )}
    </AssetPanel>
  );
}

// Logins ------------------------------------------------------------------------------------------------------------

type UserTab = "profile" | "access" | "history";
type UserDraft = { person: { email: string; firstName: string; lastName: string; phone: string; position: string }; role: HubRole; choices: Choices };

/**
 * Creates a login (with activation link) or edits one. Profil: person, role and customer, saved with "Speichern".
 * Zugang: last sign-in, second factor, password link, deactivation and deletion, each at once. Verlauf: the history.
 */
export function UserPanel({ user, customers, nextNumber, nextFreelancerNumber, freelancers, events, mailConfigured, presetCustomerId, presetRole, onReview, onClose, onNotice, onDirty, onPrev, onNext }: PanelProps & {
  user?: ManagedUser; customers: ManagedCustomer[]; nextNumber: string; nextFreelancerNumber: string; freelancers: boolean; events: ManagedEvent[]; mailConfigured: boolean;
  /** "Konto anlegen" at a customer or a freelancer: that entry is chosen, with its role. */
  presetCustomerId?: string; presetRole?: HubRole;
  onReview: (userId: string) => void;
}) {
  const fresh = (): UserDraft => ({
    person: { email: user?.email ?? "", firstName: user?.firstName ?? "", lastName: user?.lastName ?? "", phone: user?.phone ?? "", position: user?.position ?? "" },
    role: user?.role ?? presetRole ?? "oalab_customer",
    choices: startChoices(customers, { customer: nextNumber, freelancer: nextFreelancerNumber }, { customer: { company: user?.companyName ?? "" } }, user?.customerIds[0] ?? presetCustomerId),
  });
  const [draft, setDraft] = useState(fresh);
  const [base, setBase] = useState(() => JSON.stringify(fresh()));
  // Saved here or elsewhere: once the login's data changes, the form starts from it again.
  const source = user ? JSON.stringify([user.firstName, user.lastName, user.phone, user.position, user.role, user.customerIds]) : "";
  const [seen, setSeen] = useState(source);
  if (seen !== source) {
    const next = fresh();
    setSeen(source);
    setDraft(next);
    setBase(JSON.stringify(next));
  }
  const dirty = JSON.stringify(draft) !== base;
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<UserTab>("profile");
  // New logins get their activation link by mail unless the admin unticks it (or mail is not set up).
  const [mailLink, setMailLink] = useState(mailConfigured);
  const [link, setLink] = useState<{ link: string | null; activation: boolean; mail: MailStatus | null } | null>(null);
  const [confirming, setConfirming] = useState<"deactivate" | "delete" | null>(null);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [secondFactor, setSecondFactor] = useState(user?.secondFactor ?? "off");
  const { busy, error, setError, run } = useAction();
  const { formRef, submit } = useFooterSubmit<UserTab>("profile", tab, setTab);
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
  const created = !user && Boolean(link?.link);
  useDirtyReport(dirty && !created, onDirty);
  const { person, role, choices } = draft;
  const change = (next: Partial<UserDraft>) => { setSaved(false); setDraft((current) => ({ ...current, ...next })); };
  const set = (key: keyof UserDraft["person"]) => (event: React.ChangeEvent<HTMLInputElement>) => change({ person: { ...person, [key]: event.target.value } });
  const locked = Boolean(user?.demo);
  const disabled = busy !== null || locked;
  const name = `${person.firstName} ${person.lastName}`.trim();
  const freelancerLogin = (user?.role ?? role) === "oalab_freelancer";
  const showTab = (next: UserTab) => { setError(""); setTab(next); };

  const save = () => user
    ? run("save", () => updateHubUser({ userId: user.id, firstName: person.firstName, lastName: person.lastName, phone: person.phone, position: person.position, role, customer: choicePayload(role, choices) }), () => { setSaved(true); setBase(JSON.stringify(draft)); onNotice(`Änderungen an ${fullName({ ...user, ...person })} gespeichert.`); })
    : run("save", () => createHubUser({ ...person, role, customer: choicePayload(role, choices), mailLink: mailConfigured && mailLink }), (data) => { setLink({ link: data.link, activation: true, mail: data.mail }); onNotice(`Konto für ${name} angelegt.`); });

  if (created && link?.link) {
    return (
      <AssetPanel className="um-panel" label="Konto angelegt" icon={<span className="avatar" aria-hidden="true">{initialsOf(person)}</span>} title={name || person.email} subtitle={`Konto angelegt als ${roleLabels[role]}`} onClose={() => onClose(true)}
        footer={<><span className="um-foot-state" /><button type="button" className="sheet-action is-primary" onClick={() => onClose(true)}><Check size={15} aria-hidden="true" />Fertig</button></>}>
        <div className="um-stack um-pad">
          <p className="am-note is-ok"><ShieldCheck size={16} aria-hidden="true" /><span>{name} hat jetzt ein Konto als {roleLabels[role]}.</span></p>
          {link.mail === "sent" ? <>
            <p className="am-note is-ok"><MailCheck size={16} aria-hidden="true" /><span>Der Aktivierungslink ist per E-Mail an {person.email} unterwegs.</span></p>
            <details className="um-more"><summary>Link trotzdem anzeigen</summary><LinkPanel link={link.link} activation user={person} /></details>
          </> : <>
            {link.mail && <p className={`am-note ${link.mail === "failed" ? "is-bad" : "is-todo"}`}><MailX size={16} aria-hidden="true" /><span>{mailStatusText(link.mail)} Gib den Link bitte selbst weiter.</span></p>}
            <LinkPanel link={link.link} activation user={person} />
          </>}
        </div>
      </AssetPanel>
    );
  }

  if (user?.status === "pending") {
    return (
      <AssetPanel className="um-panel" label={`Registrierung von ${fullName(user)}`} icon={<span className="avatar" aria-hidden="true">{initialsOf(user)}</span>} title={fullName(user)} subtitle={<UserLine user={user} />} onClose={() => onClose()}>
        <div className="um-stack um-pad">
          <p className="am-help">Diese Registrierung wartet auf deine Entscheidung.</p>
          <button type="button" className="sheet-action is-primary" onClick={() => onReview(user.id)}><ShieldCheck size={15} aria-hidden="true" />Registrierung prüfen</button>
        </div>
      </AssetPanel>
    );
  }

  const form = (
    <form ref={formRef} className="um-form" onSubmit={(event) => { event.preventDefault(); if (!user || dirty) save(); }}>
      {locked && <p className="am-note is-todo um-lead"><AlertTriangle size={16} aria-hidden="true" /><span>Demo-Konto: wird per Seed verwaltet und ist hier schreibgeschützt.</span></p>}
      <PanelSection title="Person">
        <FieldGrid>
          <Field label="Vorname"><input className="am-input" value={person.firstName} onChange={set("firstName")} maxLength={80} required disabled={disabled} autoComplete="off" /></Field>
          <Field label="Nachname"><input className="am-input" value={person.lastName} onChange={set("lastName")} maxLength={80} required disabled={disabled} autoComplete="off" /></Field>
          {user ? <ReadonlyField label="E-Mail-Adresse" note="der Login" value={user.email} copyLabel={`E-Mail-Adresse von ${fullName(user)} kopieren`} />
            : <Field label="E-Mail-Adresse" wide><input className="am-input" type="email" value={person.email} onChange={set("email")} maxLength={254} required disabled={disabled} autoComplete="off" /></Field>}
          <Field label="Telefon"><input className="am-input" type="tel" value={person.phone} onChange={set("phone")} maxLength={40} disabled={disabled} autoComplete="off" placeholder="+49 …" /></Field>
          <Field label="Position"><input className="am-input" value={person.position} onChange={set("position")} maxLength={80} disabled={disabled} autoComplete="off" placeholder="z. B. Geschäftsführung" /></Field>
        </FieldGrid>
      </PanelSection>
      <PanelSection title="Rolle und Kunde">
        <RoleAndCustomer role={role} onRole={(next) => change({ role: next })} choices={choices} onChoices={(next) => change({ choices: next })} customers={customers} disabled={disabled} roleLocked={Boolean(user?.self)} freelancers={freelancers} />
      </PanelSection>
      {!user && (
        <PanelSection title="Aktivierung">
          <label className="um-check"><input type="checkbox" checked={mailConfigured && mailLink} onChange={(event) => setMailLink(event.target.checked)} disabled={disabled || !mailConfigured} />Aktivierungslink per E-Mail an die Person senden</label>
          <p className="am-help">{mailConfigured ? "Mit dem Link setzt die Person ihr Passwort; vorher kann sie sich nicht anmelden. Den Link bekommst du in jedem Fall auch angezeigt." : "Der Mailversand ist noch nicht eingerichtet. Nach dem Anlegen bekommst du den Aktivierungslink zum Weitergeben angezeigt."}</p>
        </PanelSection>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  );

  const access = user && (
    <PanelSection title="Zugang und Sicherheit" info={info.button} meta="wirkt sofort">
      {info.box}
      {locked ? <p className="am-help">Demo-Konten verwaltet der Seed; hier lässt sich nichts ändern.</p> : (
        <RowList>
          <Row lead={<RowIcon icon={LogIn} />} title="Letzte Anmeldung" text={user.lastSignInAt ? formatFileDateTime(user.lastSignInAt) : "Noch nie angemeldet"} />
          <Row lead={<RowIcon icon={ShieldCheck} />} title="Zwei-Faktor-Schutz" text={freelancerLogin
            ? "Für Freelancer immer an: Ohne bestätigten Code zeigt der Hub ihnen keine Kundendaten."
            : secondFactor === "totp" ? "Die Person nutzt eine Authenticator-App. Stellst du um, wird sie entfernt, etwa nach einem verlorenen Handy."
            : "Die Person wählt die Methode im Profil selbst. Der Code per E-Mail gilt auch auf der Serviceplattform."}>
            <span className="am-mini">
              {busy === "secondFactor" ? <MiniLoader size={14} /> : <Shield size={14} aria-hidden="true" />}
              <select value={secondFactor} disabled={busy !== null} aria-label="Zwei-Faktor-Schutz" onChange={(event) => {
                const choice = event.target.value === "email" ? "email" : "off";
                run("secondFactor", () => setHubUserSecondFactor({ userId: user.id, choice }), () => { setSecondFactor(choice); onNotice(choice === "email" ? `${fullName(user)} bestätigt jede Anmeldung jetzt mit einem Code per E-Mail.` : `Zwei-Faktor-Schutz für ${fullName(user)} ausgeschaltet.`); });
              }}>
                {!freelancerLogin && <option value="off">Aus</option>}
                <option value="email">Code per E-Mail</option>
                {secondFactor === "totp" && <option value="totp" disabled>Authenticator-App</option>}
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </span>
          </Row>
          {user.status === "active" && (
            <Row lead={<RowIcon icon={KeyRound} />} title={user.lastSignInAt ? "Passwort-Link" : "Aktivierungslink"} text="Gilt einmal und läuft ab."
              below={link?.link ? <LinkPanel link={link.link} activation={link.activation} user={user} />
                : link?.mail ? <p className={`am-note ${link.mail === "sent" ? "is-ok" : link.mail === "failed" ? "is-bad" : "is-todo"}`}>{link.mail === "sent" ? <MailCheck size={16} aria-hidden="true" /> : <MailX size={16} aria-hidden="true" />}<span>{link.mail === "sent" ? `${link.activation ? "Aktivierungslink" : "Link zum Passwort-Zurücksetzen"} an ${user.email} geschickt.` : mailStatusText(link.mail)}</span></p>
                : null}>
              <button type="button" className="sheet-action is-quiet" disabled={busy !== null} onClick={() => run("link", () => createPasswordLink({ userId: user.id, deliver: "copy" }), setLink)}>{busy === "link" ? <Spinner /> : <KeyRound size={14} aria-hidden="true" />}Link erzeugen</button>
              {mailConfigured && <button type="button" className="sheet-action" disabled={busy !== null} onClick={() => run("mail", () => createPasswordLink({ userId: user.id, deliver: "mail" }), setLink)}>{busy === "mail" ? <Spinner /> : <Send size={14} aria-hidden="true" />}Per E-Mail</button>}
            </Row>
          )}
          {!user.self && user.status === "active" && (
            <Row lead={<RowIcon icon={Ban} />} title="Deaktivieren" text="Sperrt Anmeldung und Datenzugriff sofort, jederzeit umkehrbar."
              below={confirming === "deactivate" && (
                <div className="um-stack">
                  <p className="am-help">Die Person kann sich nicht mehr anmelden und sieht sofort keine Daten mehr. Du kannst das Konto jederzeit wieder aktivieren.</p>
                  <div className="um-actions">
                    <button type="button" className="sheet-action is-quiet" onClick={() => setConfirming(null)} disabled={busy !== null}>Abbrechen</button>
                    <button type="button" className="sheet-action is-danger" disabled={busy !== null} onClick={() => run("status", () => setHubUserActive({ userId: user.id, active: false }), () => { setConfirming(null); onNotice(`${fullName(user)} ist deaktiviert.`); })}>{busy === "status" ? <Spinner /> : <Ban size={14} aria-hidden="true" />}Jetzt deaktivieren</button>
                  </div>
                </div>
              )}>
              {confirming !== "deactivate" && <button type="button" className="sheet-action is-quiet" onClick={() => setConfirming("deactivate")} disabled={busy !== null}>Deaktivieren</button>}
            </Row>
          )}
          {!user.self && user.status === "disabled" && (
            <Row lead={<RowIcon icon={RotateCcw} />} title="Wieder aktivieren" text="Die Person kann sich sofort wieder anmelden.">
              <button type="button" className="sheet-action is-quiet" disabled={busy !== null} onClick={() => run("status", () => setHubUserActive({ userId: user.id, active: true }), () => onNotice(`${fullName(user)} ist wieder aktiv.`))}>{busy === "status" ? <Spinner /> : <RotateCcw size={14} aria-hidden="true" />}Aktivieren</button>
            </Row>
          )}
          {!user.self && user.status === "rejected" && (
            <Row lead={<RowIcon icon={ShieldCheck} />} title="Registrierung abgelehnt" text={user.decisionNote ? `„${user.decisionNote}“` : "Du kannst sie trotzdem freigeben."}>
              <button type="button" className="sheet-action is-quiet" onClick={() => onReview(user.id)}>Doch freigeben</button>
            </Row>
          )}
          {!user.self && (
            <Row danger lead={<RowIcon icon={Trash2} />} title="Konto löschen" text="Login, Profil und Kundenzuordnung, nicht umkehrbar."
              below={confirming === "delete" && (
                <div className="um-stack">
                  <label className="um-field"><span className="am-label">Zum endgültigen Löschen die E-Mail-Adresse eintragen</span><input className="am-input" type="email" value={confirmEmail} onChange={(event) => setConfirmEmail(event.target.value)} placeholder={user.email} autoComplete="off" disabled={busy !== null} /></label>
                  <p className="am-help">Gelöscht werden Login, Profil und Kundenzuordnung. Dateien und Termine des Kunden bleiben erhalten.</p>
                  <div className="um-actions">
                    <button type="button" className="sheet-action is-quiet" onClick={() => { setConfirming(null); setConfirmEmail(""); }} disabled={busy !== null}>Abbrechen</button>
                    <button type="button" className="sheet-action is-danger" disabled={busy !== null || confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()} onClick={() => run("delete", () => deleteHubUser({ userId: user.id, confirmEmail }), () => { onNotice(`Konto von ${fullName(user)} gelöscht.`); onClose(true); })}>{busy === "delete" ? <Spinner /> : <Trash2 size={14} aria-hidden="true" />}Endgültig löschen</button>
                  </div>
                </div>
              )}>
              {confirming !== "delete" && <button type="button" className="sheet-action is-danger" onClick={() => setConfirming("delete")} disabled={busy !== null}>Löschen …</button>}
            </Row>
          )}
        </RowList>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </PanelSection>
  );

  const footer = <>
    {user ? <SaveStatus state={dirty ? "dirty" : saved ? "saved" : "clean"} /> : <span className="um-foot-state" />}
    <button type="button" className="sheet-action is-quiet" onClick={() => onClose(true)} disabled={busy === "save"}>Abbrechen</button>
    {!locked && <button type="button" className="sheet-action is-primary" onClick={submit} disabled={busy !== null || (Boolean(user) && !dirty)}>{busy === "save" ? <Spinner /> : user ? <Check size={15} aria-hidden="true" /> : <UserPlus size={15} aria-hidden="true" />}{user ? "Speichern" : "Konto anlegen"}</button>}
  </>;

  return (
    <AssetPanel className="um-panel" label={user ? `Konto von ${fullName(user)}` : "Konto anlegen"}
      icon={user ? <span className="avatar" aria-hidden="true">{initialsOf(user)}</span> : <span className="am-tile"><UserPlus size={20} aria-hidden="true" /></span>}
      title={user ? fullName(user) : "Konto anlegen"} subtitle={user ? <UserLine user={user} /> : "Mit Aktivierungslink zum Passwort-Setzen"}
      actions={user ? <EntryNav onPrev={onPrev} onNext={onNext} /> : info.button}
      bar={user && <PanelTabs value={tab} onChange={showTab} options={[{ id: "profile", label: "Profil" }, { id: "access", label: "Zugang" }, { id: "history", label: <>Verlauf <Count value={events.length} /></> }]} />}
      onClose={() => onClose()} footer={footer}>
      {!user && info.box}
      {!user || tab === "profile" ? form : tab === "access" ? access : <PanelSection title="Verlauf"><HistoryList events={events} /></PanelSection>}
    </AssetPanel>
  );
}

// Customers and freelancers -----------------------------------------------------------------------------------------

type EntryTab = "data" | "logins" | "history";

/** Name, number, contact, address and who is linked (freelancers of a customer, customers of a freelancer), as one form. */
function useEntryForm(entry: ManagedCustomer | undefined, nextNumber: string) {
  const fresh = () => ({ draft: entry ? draftOf(entry) : emptyDraft(nextNumber), linked: entry?.linkedIds ?? [] });
  const [form, setForm] = useState(fresh);
  const [base, setBase] = useState(() => JSON.stringify(fresh()));
  // Saved here or elsewhere: once the entry's data changes, the form starts from it again.
  const source = entry ? JSON.stringify([draftOf(entry), entry.linkedIds]) : "";
  const [seen, setSeen] = useState(source);
  if (seen !== source) {
    const next = fresh();
    setSeen(source);
    setForm(next);
    setBase(JSON.stringify(next));
  }
  const [saved, setSaved] = useState(false);
  const change = (next: Partial<ReturnType<typeof fresh>>) => { setSaved(false); setForm((current) => ({ ...current, ...next })); };
  const dirty = JSON.stringify(form) !== base;
  const markSaved = () => { setSaved(true); setBase(JSON.stringify(form)); };
  return { ...form, change, dirty, state: (dirty ? "dirty" : saved ? "saved" : "clean") as "dirty" | "saved" | "clean", markSaved };
}

/**
 * Creates or edits a customer (company): contact, address and the freelancers who look after it; logo and packages
 * on top, its logins in their own tab. The logo opens the same window as in the asset management.
 */
export function CustomerPanel({ customer, users, nextNumber, events, freelancers, freelancersEnabled, onOpenUser, onNewUser, onClose, onNotice, onDirty, onPrev, onNext }: PanelProps & {
  customer?: ManagedCustomer; users: ManagedUser[]; nextNumber: string; events: ManagedEvent[];
  /** The freelancers who can look after a customer; freelancersEnabled once the database knows them. */
  freelancers: ManagedCustomer[]; freelancersEnabled: boolean;
  onOpenUser: (user: ManagedUser) => void; onNewUser: (customerId: string) => void;
}) {
  const entry = useEntryForm(customer, nextNumber);
  const [tab, setTab] = useState<EntryTab>("data");
  const [logoOpen, setLogoOpen] = useState(false);
  const { busy, error, setError, run } = useAction();
  const { formRef, submit } = useFooterSubmit<EntryTab>("data", tab, setTab);
  const info = useInfo("Kundenstamm", {
    steps: [
      <><b>Gilt in Hub und Service,</b> in beide Richtungen.</>,
      <><b>Neue Kunden</b> bekommen die nächste freie Nummer.</>,
      <><b>Pakete und Logo</b> legst du nach dem Anlegen fest.</>,
    ],
    ask: "Wie funktioniert der Kundenstamm?",
  });
  useDirtyReport(entry.dirty, onDirty);
  const members = customer ? users.filter((user) => customer.memberIds.includes(user.id)) : [];
  const { draft } = entry;
  const save = () => run("save", () => saveCustomer({ ...draft, id: customer?.id, freelancerIds: freelancersEnabled ? entry.linked : undefined }), () => {
    onNotice(customer ? `${draft.company} gespeichert.` : `Kunde ${draft.company} angelegt.`);
    if (customer) entry.markSaved();
    else onClose(true);
  });

  const dataTab = <>
    {customer && (
      <PanelSection title="Logo und Pakete">
        <RowList>
          <Row lead={<LogoMark logo={customer.logo} initials={companyInitials(customer.company)} className="company-mark" />} title="Logo" text={customer.logo ? "Sehen die Kunden in der Übersicht, unten links und am Handy." : "Noch keins hinterlegt, es stehen die Buchstaben."}>
            <button type="button" className="sheet-action is-quiet" onClick={() => setLogoOpen(true)}><ImagePlus size={14} aria-hidden="true" />{customer.logo ? "Logo ändern" : "Logo hochladen"}</button>
          </Row>
          <Row lead={<RowIcon icon={FileBadge} />} title="Pakete" text={customer.packages.length ? customer.packages.map((id) => packageCatalog[id].name).join(", ") : "Noch keine Pakete"}>
            <Link className="sheet-action is-quiet" href={`${hubHref(false, "contracts")}?customer=${customer.id}`}>Pakete bearbeiten<ArrowRight size={14} aria-hidden="true" /></Link>
          </Row>
        </RowList>
      </PanelSection>
    )}
    <form ref={formRef} className="um-form" onSubmit={(event) => { event.preventDefault(); if (!customer || entry.dirty) save(); }}>
      <PanelSection title="Firma und Kontakt" info={info.button}>
        {info.box}
        <CompanyFields draft={draft} onChange={(next) => entry.change({ draft: next })} disabled={busy !== null} />
        <p className="am-note"><Info size={16} aria-hidden="true" /><span>{!customer || customer.inService
          ? "Unternehmen, Kundennummer und Kontaktdaten gelten auch in Service: Was du hier änderst, steht dort und umgekehrt. Die Logins des Kunden kommen mit demselben Zugang in Service."
          : "Diesen Kunden gibt es nur im Hub, nicht in Service."}</span></p>
      </PanelSection>
      <PanelSection title="Adresse">
        <AddressFields draft={draft} onChange={(next) => entry.change({ draft: next })} disabled={busy !== null} />
        <p className="am-help">Die Kundinnen und Kunden sehen Unternehmen, Kundennummer und Kontaktdaten nach dem Login in ihrem Profil.{customer ? "" : " Pakete und Logo legst du nach dem Anlegen fest."}</p>
      </PanelSection>
      {freelancersEnabled && freelancers.length > 0 && (
        <PanelSection title="Betreut von">
          <EntryChips legend="Betreut von" entries={freelancers} selected={entry.linked} onChange={(ids) => entry.change({ linked: ids })} addLabel="Freelancer" emptyText="nur vom oalab-Team" idPrefix="served-by" disabled={busy !== null} />
          <p className="am-help">Ein Freelancer sieht Namen, Logo, Kontaktdaten und die freigegebenen Dateien dieses Kunden, nur lesend; Verträge, Angebote und Rechnungen nicht, außer du gibst sie frei. Chats, Termine und Logins sieht er nicht, und der Kunde sieht nicht, wer ihn betreut.</p>
        </PanelSection>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  </>;

  const footer = <>
    {customer ? <SaveStatus state={entry.state} /> : <span className="um-foot-state" />}
    <button type="button" className="sheet-action is-quiet" onClick={() => onClose(true)} disabled={busy === "save"}>Abbrechen</button>
    <button type="button" className="sheet-action is-primary" onClick={submit} disabled={busy !== null || (Boolean(customer) && !entry.dirty)}>{busy === "save" ? <Spinner /> : customer ? <Check size={15} aria-hidden="true" /> : <Building2 size={15} aria-hidden="true" />}{customer ? "Speichern" : "Kunde anlegen"}</button>
  </>;

  return <>
    <AssetPanel className="um-panel" label={customer ? `Kunde ${customer.company}` : "Kunde anlegen"}
      icon={customer ? <LogoMark logo={customer.logo} initials={companyInitials(customer.company)} className="company-mark" /> : <span className="am-tile"><Building2 size={20} aria-hidden="true" /></span>}
      title={customer ? customer.company : "Kunde anlegen"}
      subtitle={customer ? <><span className="numeric">{customer.customerNumber}</span><span className="um-dot" aria-hidden="true">·</span><span className="um-clip">{customer.packages.length ? customer.packages.map((id) => packageCatalog[id].short).join(" · ") : "noch keine Pakete"}</span></> : `Nächste freie Nummer: ${nextNumber}`}
      actions={customer && <EntryNav onPrev={onPrev} onNext={onNext} />}
      bar={customer && <PanelTabs value={tab} onChange={(next) => { setError(""); setTab(next); }} options={[{ id: "data", label: "Stammdaten" }, { id: "logins", label: <>Konten <Count value={members.length} /></> }, { id: "history", label: <>Verlauf <Count value={events.length} /></> }]} />}
      onClose={() => onClose()} footer={footer}>
      {!customer || tab === "data" ? dataTab
        : tab === "logins" ? (
          <PanelSection title="Konten" action={<button type="button" className="sheet-action" onClick={() => onNewUser(customer.id)}><UserPlus size={14} aria-hidden="true" />Konto anlegen</button>}>
            {members.length ? <MemberRows members={members} onOpenUser={onOpenUser} /> : <p className="am-help">Noch kein Konto. „Konto anlegen“ legt eins für diesen Kunden an; es gilt auch in Service.</p>}
          </PanelSection>
        ) : <PanelSection title="Verlauf"><HistoryList events={events} /></PanelSection>}
    </AssetPanel>
    {customer && logoOpen && <CustomerLogoDialog customer={customer} onClose={() => setLogoOpen(false)} onSaved={(message) => { setLogoOpen(false); onNotice(message); }} />}
  </>;
}

/**
 * Creates or edits a freelancer: name, "FL-" number, contact and the customers they look after. A freelancer lives
 * only in the hub; their logins are created with "Konto anlegen" and the role Freelancer.
 */
export function FreelancerPanel({ freelancer, customers, users, nextNumber, events, onOpenUser, onNewUser, onClose, onNotice, onDirty, onPrev, onNext }: PanelProps & {
  freelancer?: ManagedCustomer;
  /** The customers that can be assigned (entries of the kind customer). */
  customers: ManagedCustomer[];
  users: ManagedUser[]; nextNumber: string; events: ManagedEvent[];
  onOpenUser: (user: ManagedUser) => void; onNewUser: (freelancerId: string) => void;
}) {
  const entry = useEntryForm(freelancer, nextNumber);
  const [tab, setTab] = useState<EntryTab>("data");
  const [logoOpen, setLogoOpen] = useState(false);
  const { busy, error, setError, run } = useAction();
  const { formRef, submit } = useFooterSubmit<EntryTab>("data", tab, setTab);
  const info = useInfo("Freelancer", {
    steps: [
      <><b>Nur im Hub,</b> die Nummer beginnt mit FL-.</>,
      <><b>Betreute Kunden</b> wählst du hier aus.</>,
      <><b>Jede Anmeldung</b> bestätigt er mit einem Code.</>,
    ],
    ask: "Wie funktioniert ein Freelancer im Hub?",
  });
  useDirtyReport(entry.dirty, onDirty);
  const members = freelancer ? users.filter((user) => freelancer.memberIds.includes(user.id)) : [];
  const { draft } = entry;
  const save = () => run("save", () => saveFreelancer({ ...draft, id: freelancer?.id, customerIds: entry.linked }), () => {
    onNotice(freelancer ? `${draft.company} gespeichert.` : `Freelancer ${draft.company} angelegt.`);
    if (freelancer) entry.markSaved();
    else onClose(true);
  });

  const dataTab = <>
    {freelancer && (
      <PanelSection title="Logo">
        <RowList>
          <Row lead={<LogoMark logo={freelancer.logo} initials={companyInitials(freelancer.company)} className="company-mark" />} title="Logo" text={freelancer.logo ? "Sieht der Freelancer unten links, in der Übersicht und am Handy." : "Noch keins hinterlegt, es stehen die Buchstaben."}>
            <button type="button" className="sheet-action is-quiet" onClick={() => setLogoOpen(true)}><ImagePlus size={14} aria-hidden="true" />{freelancer.logo ? "Logo ändern" : "Logo hochladen"}</button>
          </Row>
        </RowList>
      </PanelSection>
    )}
    <form ref={formRef} className="um-form" onSubmit={(event) => { event.preventDefault(); if (!freelancer || entry.dirty) save(); }}>
      <PanelSection title="Name und Kontakt">
        <CompanyFields draft={draft} onChange={(next) => entry.change({ draft: next })} disabled={busy !== null} freelancer />
      </PanelSection>
      <PanelSection title="Adresse">
        <AddressFields draft={draft} onChange={(next) => entry.change({ draft: next })} disabled={busy !== null} />
      </PanelSection>
      <PanelSection title="Betreute Kunden">
        <EntryChips legend="Betreute Kunden" entries={customers} selected={entry.linked} onChange={(ids) => entry.change({ linked: ids })} addLabel="Kunden" emptyText="noch keine" idPrefix="freelancer-customers" disabled={busy !== null} />
        <p className="am-help">Der Freelancer sieht im Asset Management seine eigenen Dateien und die Dateien dieser Kunden, nur lesend. Verträge, Angebote und Rechnungen der Kunden sieht er nicht, außer du gibst sie frei; Chats, Termine und Logins bleiben ihm verborgen. Kunden anlegen kann er nicht, und auf der Serviceplattform hat er keinen Zugang.</p>
      </PanelSection>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  </>;

  const footer = <>
    {freelancer ? <SaveStatus state={entry.state} /> : <span className="um-foot-state" />}
    <button type="button" className="sheet-action is-quiet" onClick={() => onClose(true)} disabled={busy === "save"}>Abbrechen</button>
    <button type="button" className="sheet-action is-primary" onClick={submit} disabled={busy !== null || (Boolean(freelancer) && !entry.dirty)}>{busy === "save" ? <Spinner /> : freelancer ? <Check size={15} aria-hidden="true" /> : <Handshake size={15} aria-hidden="true" />}{freelancer ? "Speichern" : "Freelancer anlegen"}</button>
  </>;

  return <>
    <AssetPanel className="um-panel" label={freelancer ? `Freelancer ${freelancer.company}` : "Freelancer anlegen"}
      icon={freelancer ? <LogoMark logo={freelancer.logo} initials={companyInitials(freelancer.company)} className="company-mark" /> : <span className="am-tile"><Handshake size={20} aria-hidden="true" /></span>}
      title={freelancer ? freelancer.company : "Freelancer anlegen"}
      subtitle={freelancer ? <><span className="numeric">{freelancer.customerNumber}</span><span className="um-dot" aria-hidden="true">·</span><span className="um-clip">{freelancer.linkedIds.length === 1 ? "1 betreuter Kunde" : `${freelancer.linkedIds.length} betreute Kunden`}</span></> : `Nächste freie Nummer: ${nextNumber}`}
      actions={<>{info.button}{freelancer && <EntryNav onPrev={onPrev} onNext={onNext} />}</>}
      bar={freelancer && <PanelTabs value={tab} onChange={(next) => { setError(""); setTab(next); }} options={[{ id: "data", label: "Stammdaten" }, { id: "logins", label: <>Konten <Count value={members.length} /></> }, { id: "history", label: <>Verlauf <Count value={events.length} /></> }]} />}
      onClose={() => onClose()} footer={footer}>
      {info.box}
      {!freelancer || tab === "data" ? dataTab
        : tab === "logins" ? (
          <PanelSection title="Konten" action={<button type="button" className="sheet-action" onClick={() => onNewUser(freelancer.id)}><UserPlus size={14} aria-hidden="true" />Konto anlegen</button>}>
            {members.length ? <MemberRows members={members} onOpenUser={onOpenUser} /> : <p className="am-help">Noch kein Login. „Konto anlegen“ legt einen mit der Rolle Freelancer an.</p>}
          </PanelSection>
        ) : <PanelSection title="Verlauf"><HistoryList events={events} /></PanelSection>}
    </AssetPanel>
    {freelancer && logoOpen && <CustomerLogoDialog customer={freelancer} onClose={() => setLogoOpen(false)} onSaved={(message) => { setLogoOpen(false); onNotice(message); }} />}
  </>;
}
