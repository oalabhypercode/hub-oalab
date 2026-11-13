"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { Check, Copy, Eye, EyeOff, Inbox, KeyRound, LockKeyhole, Mail, Pencil, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { hubHref } from "@/lib/hub-data";
import type { ContractCustomer } from "@/lib/hub-contracts/types";
import { loginKinds, MAX_LABEL, MAX_SECRET, MAX_USERNAME, providerSuggestions, REVEAL_SECONDS, type VaultOwner } from "@/lib/hub-domains/rules";
import { MAILBOX_CATEGORY, UNLOCK_MINUTES } from "@/lib/hub-keychain/rules";
import type { DomainMailState, ProviderLogin } from "@/lib/hub-domains/types";
import { deleteLogin, removeSecret, revealSecret, saveLogin, saveSecret, type VaultResult } from "@/lib/hub-vault/actions";
import { useInfo } from "../info-box";
import { Modal } from "../modal";
import { Select, SuggestInput } from "../select";
import { SheetFooter, TableGroup, useCollapsedGroups } from "../sheet";
import { CopyButton } from "./contracts-domains";
import { ADMIN_COLUMNS, tableHit, useContractAction } from "./contracts-parts";
import { UnlockDialog, useKeychainLock } from "./keychain-lock";

const Spinner = () => <MiniLoader size={16} />;
const tryAgain = "Das hat gerade nicht geklappt. Bitte versuche es erneut.";
/** Always the same length, so the dots tell nothing about the password. */
const DOTS = "••••••••••";

/**
 * „Zugangsdaten“ of one customer, for admins: the passwords of its mailboxes and its logins (domain provider, DNS,
 * hosting and every other category of the Schlüsselbund). The page only knows whether a password is stored; showing or
 * copying asks the server each time, which checks the open Schlüsselbund (the code from the admin's app, as in the
 * Schlüsselbund itself) and logs the look first. A shown password hides itself after 30 seconds.
 */
export function AccessTab({ customer, domainMail, fixtures, preview, query, onNotice }: {
  customer: ContractCustomer;
  domainMail: DomainMailState;
  fixtures: boolean;
  preview: boolean;
  query: string;
  onNotice: (message: string) => void;
}) {
  const [dialog, setDialog] = useState<{ entry?: ProviderLogin } | null>(null);
  const [secretFor, setSecretFor] = useState<{ owner: VaultOwner; name: string; replace: boolean } | null>(null);
  const groups = useCollapsedGroups();
  const vault = domainMail.vault;
  const live = !fixtures && domainMail.ready;
  const keychain = useKeychainLock(vault?.lock ?? { status: "setup" });
  const [unlocking, setUnlocking] = useState(false);
  const confirmed = live && keychain.open;
  const usable = confirmed && Boolean(vault?.keyReady);
  const categoryName = (id: string) => domainMail.categories.find((category) => category.id === id)?.name ?? loginKinds[id as keyof typeof loginKinds] ?? id;
  const term = query.trim().toLocaleLowerCase("de");
  const mailboxes = domainMail.mailboxes.filter((item) => item.customerId === customer.id && item.kind === "mailbox");
  const logins = domainMail.logins.filter((item) => item.customerId === customer.id);
  const shownMailboxes = mailboxes.filter((mailbox) => tableHit(term, mailbox.display, mailbox.person));
  const shownLogins = logins.filter((login) => tableHit(term, login.label, categoryName(login.kind), login.loginUrl, login.username));
  const info = useInfo("Zugangsdaten", {
    steps: [
      <><b>Nur mit dem Code aus der App</b> sichtbar, wie im Schlüsselbund.</>,
      <><b>{REVEAL_SECONDS} Sekunden</b> lesbar, dann wieder verdeckt.</>,
      <><b>Jeder Blick</b> steht im Verlauf des Kunden.</>,
    ],
    ask: "Wie funktionieren die Zugangsdaten unter Vertrag & Domain?",
  });

  const note = fixtures
    ? "Fiktive Beispieldaten: Hier gibt es keine Passwörter. Anzeigen und Speichern gehen nur mit echtem Admin-Login."
    : !domainMail.ready ? "Zugangsdaten sind in der Datenbank noch nicht eingerichtet. Die Migration steht noch aus."
      : !confirmed ? null
        : !vault?.keyReady ? "Auf dem Server fehlt der Schlüssel für die Zugangsdaten (HUB_VAULT_KEY). Bis er eingetragen ist, lassen sich keine Passwörter speichern oder anzeigen."
          : null;

  return (
    <>
      {domainMail.error && <p className="form-error cdm-tab-error" role="alert">{domainMail.error}</p>}
      {/* What the vault allows right now, as one bar above the table. */}
      {live && !confirmed && (keychain.lock.status === "setup" ? (
        <div className="cdm-lock is-todo" role="status">
          <LockKeyhole size={18} aria-hidden="true" />
          <p><strong>Schlüsselbund noch nicht eingerichtet.</strong> Passwörter öffnet hier derselbe Code wie im Schlüsselbund. Verbinde dort einmal deine Authenticator-App: <Link href={hubHref(preview, "keychain")}>Zum Schlüsselbund</Link>.</p>
        </div>
      ) : (
        <div className="cdm-lock is-todo" role="status">
          <LockKeyhole size={18} aria-hidden="true" />
          <p><strong>{keychain.lock.status === "blocked" ? "Zu viele falsche Codes." : "Gesperrt."}</strong> Passwörter siehst und änderst du nur mit dem Code aus deiner Authenticator-App, wie im Schlüsselbund. Danach bleibt er {UNLOCK_MINUTES} Minuten offen.</p>
          <button type="button" className="sheet-action is-primary kc-bar-action" onClick={() => setUnlocking(true)}><LockKeyhole size={15} aria-hidden="true" />Entsperren</button>
        </div>
      ))}
      {note && <div className="cdm-lock" role="status"><LockKeyhole size={18} aria-hidden="true" /><p>{note}</p></div>}
      {usable && <div className="cdm-lock is-ok"><ShieldCheck size={18} aria-hidden="true" /><p>Passwörter liegen verschlüsselt. Ein angezeigtes Passwort ist nach {REVEAL_SECONDS} Sekunden wieder verdeckt, und jeder Blick und jede Änderung steht im Admin-Protokoll.</p></div>}
      <div className="am-scroll">
        <table className="file-table cdm-table cdm-admin-table cdm-access-table">
          <caption className="visually-hidden">Passwörter und Logins von {customer.company}</caption>
          {/* The tab's ⓘ sits at its first group and explains both. */}
          <TableGroup colSpan={ADMIN_COLUMNS} label="Postfächer" count={shownMailboxes.length} glyph={<Mail size={16} aria-hidden="true" />} collapsed={groups.isCollapsed("mailboxes")} onToggle={() => groups.toggle("mailboxes")} actions={info.button} empty={term ? "Kein Postfach passt zur Suche." : "Noch keine Postfächer. Leg sie im Reiter „Domain & Mail“ an; Weiterleitungen und Aliase haben kein Passwort."}>
            {shownMailboxes.map((mailbox) => {
              const owner: VaultOwner = { kind: "mailbox", id: mailbox.id };
              const name = `Postfach ${mailbox.display}`;
              return (
                <tr key={mailbox.id} className="file-row">
                  <td className="cell-file"><span className="am-file"><span className="am-file-icon cdm-file-icon"><Inbox size={16} aria-hidden="true" /></span><span className="am-file-text"><strong>{mailbox.display}</strong><small>{mailbox.person || "Ohne Person"}</small></span></span></td>
                  <td className="cell-secret" colSpan={ADMIN_COLUMNS - 1}>
                    <SecretControl key={`${mailbox.id}-${mailbox.hasPassword}`} owner={owner} name={name} stored={Boolean(mailbox.hasPassword)} usable={usable} onNotice={onNotice} onSet={(replace) => setSecretFor({ owner, name, replace })} />
                  </td>
                </tr>
              );
            })}
          </TableGroup>
          <TableGroup colSpan={ADMIN_COLUMNS} label="Anbieter-Logins" count={shownLogins.length} glyph={<KeyRound size={16} aria-hidden="true" />} collapsed={groups.isCollapsed("logins")} onToggle={() => groups.toggle("logins")} actions={confirmed && <button type="button" className="table-group-action is-accent" onClick={() => setDialog({})} data-tip="Login anlegen" aria-label="Login anlegen"><Plus size={15} aria-hidden="true" /></button>} empty={term ? "Kein Login passt zur Suche." : "Noch keine Logins für Domain-Anbieter, DNS oder Hosting."}>
            {shownLogins.map((login) => {
              const owner: VaultOwner = { kind: "login", id: login.id };
              const name = `Login ${login.label}`;
              return (
                <tr key={login.id} className="file-row">
                  <td className="cell-file">
                    <span className="am-file">
                      <span className="am-file-icon cdm-file-icon"><KeyRound size={16} aria-hidden="true" /></span>
                      <span className="am-file-text">
                        <strong>{login.label}</strong>
                        <small>{categoryName(login.kind)}{login.loginUrl && <> · <a href={login.loginUrl} target="_blank" rel="noopener noreferrer">{login.loginUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}<span className="visually-hidden"> (öffnet in neuem Tab)</span></a></>}</small>
                      </span>
                    </span>
                  </td>
                  <td className="cell-secret" colSpan={ADMIN_COLUMNS - 1}>
                    <span className="cdm-secret-line">
                      {login.username && <span className="dm-login-user"><span className="dm-mono">{login.username}</span><CopyButton value={login.username} label="Benutzername" /></span>}
                      <SecretControl key={`${login.id}-${login.hasPassword}`} owner={owner} name={name} stored={login.hasPassword} usable={usable} onNotice={onNotice} onSet={(replace) => setSecretFor({ owner, name, replace })} />
                      {confirmed && <button type="button" className="am-icon-btn" onClick={() => setDialog({ entry: login })} aria-label={`${login.label} bearbeiten`} data-tip="Bearbeiten"><Pencil size={16} aria-hidden="true" /></button>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </TableGroup>
        </table>
        {info.box}
      </div>
      <SheetFooter hint="Jeder Blick auf ein Passwort steht im Verlauf">
        {live && vault
          ? vault.keyId ? <>Schlüssel auf diesem Server: <span className="dm-mono" translate="no">{vault.keyId}</span>; lokal und in Vercel muss dieselbe Kennung stehen.</> : "Auf diesem Server ist kein Schlüssel für die Zugangsdaten eingetragen."
          : [mailboxes.length === 1 ? "1 Postfach" : `${mailboxes.length} Postfächer`, logins.length === 1 ? "1 Anbieter-Login" : `${logins.length} Anbieter-Logins`].join(" · ")}
      </SheetFooter>

      {dialog && <LoginDialog customer={customer} entry={dialog.entry} canStoreSecret={usable} categories={domainMail.categories.filter((category) => category.id !== MAILBOX_CATEGORY)} onClose={() => setDialog(null)} onSaved={onNotice} />}
      {secretFor && <SecretDialog owner={secretFor.owner} name={secretFor.name} replace={secretFor.replace} onClose={() => setSecretFor(null)} onSaved={onNotice} />}
      {unlocking && <UnlockDialog lock={keychain.lock} hint="Danach siehst und änderst du die Passwörter hier." onClose={() => setUnlocking(false)} onUnlocked={(next) => { keychain.setLock(next); setUnlocking(false); }} onLock={keychain.setLock} />}
    </>
  );
}

/**
 * One stored password: hidden dots, „Anzeigen“ for 30 seconds, „Kopieren“ without showing it, change and remove. It
 * hides again when the time is up, when the tab goes into the background and when the row disappears.
 */
function SecretControl({ owner, name, stored, usable, onNotice, onSet }: {
  owner: VaultOwner;
  name: string;
  stored: boolean;
  usable: boolean;
  onNotice: (message: string) => void;
  onSet: (replace: boolean) => void;
}) {
  const [shown, setShown] = useState<{ secret: string; until: number } | null>(null);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState<"show" | "copy" | "remove" | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    if (!shown) return;
    const tick = window.setInterval(() => {
      const time = Date.now();
      if (time >= shown.until) setShown(null);
      else setNow(time);
    }, 250);
    const hide = () => { if (document.visibilityState === "hidden") setShown(null); };
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [shown]);

  async function show() {
    setBusy("show");
    setError("");
    try {
      const result = await revealSecret({ owner, purpose: "show" });
      if (!result.ok) setError(result.error);
      else {
        const time = Date.now();
        setNow(time);
        setShown({ secret: result.data.secret, until: time + REVEAL_SECONDS * 1000 });
      }
    } catch {
      setError(tryAgain);
    } finally {
      setBusy(null);
    }
  }

  // The clipboard write starts within the click, with the password still on its way: Safari only allows it so.
  async function copy() {
    setBusy("copy");
    setError("");
    const box: { result: VaultResult<{ secret: string }> | null } = { result: null };
    const loading = revealSecret({ owner, purpose: "copy" }).then((result) => {
      box.result = result;
      if (!result.ok) throw new Error("refused");
      return result.data.secret;
    });
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    };
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": loading.then((secret) => new Blob([secret], { type: "text/plain" })) })]);
      } else {
        await navigator.clipboard.writeText(await loading);
      }
      done();
    } catch {
      await loading.catch(() => null);
      const result = box.result;
      if (result && !result.ok) setError(result.error);
      else if (result?.ok) {
        try {
          await navigator.clipboard.writeText(result.data.secret);
          done();
        } catch {
          setError("Der Browser hat das Kopieren blockiert. Nutze „Anzeigen“.");
        }
      } else setError(tryAgain);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("remove");
    setError("");
    try {
      const result = await removeSecret({ owner });
      if (!result.ok) setError(result.error);
      else onNotice(`Passwort von ${name} entfernt.`);
    } catch {
      setError(tryAgain);
    } finally {
      setBusy(null);
      setConfirmRemove(false);
    }
  }

  const left = shown ? Math.max(1, Math.ceil((shown.until - now) / 1000)) : 0;
  const disabled = !usable || busy !== null;
  if (!stored) {
    return (
      <div className="dm-secret">
        <span className="dm-secret-none">Kein Passwort</span>
        {usable && <button type="button" className="sheet-action" onClick={() => onSet(false)} disabled={busy !== null}><KeyRound size={15} aria-hidden="true" />Hinterlegen</button>}
      </div>
    );
  }
  return (
    <div className="dm-secret">
      <div className="dm-secret-value">
        {shown
          ? <><code className="dm-mono dm-secret-text" translate="no">{shown.secret}</code><span className="dm-secret-timer" aria-hidden="true">{left} s</span><span className="visually-hidden" role="status">Passwort angezeigt, nach {REVEAL_SECONDS} Sekunden wieder verdeckt.</span></>
          : <span className="dm-secret-dots" aria-label="Passwort verdeckt">{DOTS}</span>}
      </div>
      <div className="dm-secret-acts">
        {shown
          ? <button type="button" className="row-action" onClick={() => setShown(null)} aria-label={`Passwort von ${name} verdecken`} data-tip="Verdecken"><EyeOff size={16} aria-hidden="true" /></button>
          : <button type="button" className="row-action" onClick={show} disabled={disabled} aria-label={`Passwort von ${name} anzeigen`} data-tip={`Anzeigen (${REVEAL_SECONDS} Sekunden)`}>{busy === "show" ? <Spinner /> : <Eye size={16} aria-hidden="true" />}</button>}
        <button type="button" className="row-action" onClick={copy} disabled={disabled} aria-label={`Passwort von ${name} kopieren`} data-tip={copied ? "Kopiert" : "Kopieren"}>
          {busy === "copy" ? <Spinner /> : copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          <span className="visually-hidden" role="status">{copied ? "Kopiert" : ""}</span>
        </button>
        {usable && <button type="button" className="row-action" onClick={() => onSet(true)} disabled={busy !== null} aria-label={`Passwort von ${name} ändern`} data-tip="Ändern"><Pencil size={16} aria-hidden="true" /></button>}
        {usable && (confirmRemove
          ? <button type="button" className="sheet-action is-danger" onClick={remove} disabled={busy !== null}>{busy === "remove" ? <Spinner /> : <Trash2 size={15} aria-hidden="true" />}Entfernen?</button>
          : <button type="button" className="row-action" onClick={() => setConfirmRemove(true)} disabled={busy !== null} aria-label={`Passwort von ${name} entfernen`} data-tip="Entfernen"><Trash2 size={16} aria-hidden="true" /></button>)}
      </div>
      {error && <p className="form-error dm-secret-error" role="alert">{error}</p>}
    </div>
  );
}

/**
 * The input for a password. Not a password field: the browser shall not offer to save a customer's password as the
 * admin's own hub password. The dots come from CSS; the eye shows what was typed.
 */
export function SecretInput({ value, onChange, disabled, label, required, hideLabel = false }: { value: string; onChange: (value: string) => void; disabled: boolean; label: string; required?: boolean; hideLabel?: boolean }) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  return (
    <div className="upload-field">
      <label htmlFor={id} className={hideLabel ? "visually-hidden" : "dm-field-label"}>{label}</label>
      <div className="dm-secret-field">
        <input
          id={id}
          className={visible ? undefined : "is-masked"}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={MAX_SECRET}
          required={required}
          disabled={disabled}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          data-1p-ignore=""
          data-lpignore="true"
          data-bwignore=""
          data-form-type="other"
        />
        <button type="button" className="row-action" onClick={() => setVisible(!visible)} aria-label={visible ? "Eingabe verdecken" : "Eingabe zeigen"} aria-pressed={visible} disabled={disabled}>
          {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

/** Stores a new password or replaces the stored one. */
export function SecretDialog({ owner, name, replace, onClose, onSaved }: { owner: VaultOwner; name: string; replace: boolean; onClose: () => void; onSaved: (message: string) => void }) {
  const [secret, setSecret] = useState("");
  const { busy, error, run } = useContractAction();
  const save = () => run("save", () => saveSecret({ owner, secret }), () => { onSaved(replace ? `Passwort von ${name} geändert.` : `Passwort von ${name} hinterlegt.`); onClose(); });
  return (
    <Modal title={replace ? "Passwort ändern" : "Passwort hinterlegen"} onClose={onClose} className="users-modal">
      {/* A div, not a form: the browser shall not take the password for a sign-in of its own. */}
      <div className="cdm-dialog" onKeyDown={(event) => { if (event.key === "Enter" && event.target instanceof HTMLInputElement && secret && busy === null) { event.preventDefault(); save(); } }}>
        <p className="field-hint">{name}</p>
        <SecretInput value={secret} onChange={setSecret} disabled={busy !== null} label={replace ? "Neues Passwort" : "Passwort"} required />
        <p className="field-hint">Der Hub speichert das Passwort verschlüsselt. {replace ? "Das bisherige ist danach weg." : ""} Die Änderung steht im Admin-Protokoll, ohne das Passwort.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="button" className="sheet-button sheet-button-primary" disabled={busy !== null || !secret} onClick={save}>
          {busy === "save" ? <Spinner /> : <Save size={18} aria-hidden="true" />}Passwort speichern
        </button>
      </div>
    </Modal>
  );
}

/** Enters a provider login (with its password, if the vault is ready) or edits its details. */
function LoginDialog({ customer, entry, canStoreSecret, categories, onClose, onSaved }: { customer: ContractCustomer; entry?: ProviderLogin; canStoreSecret: boolean; categories: { id: string; name: string }[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [draft, setDraft] = useState({ kind: entry?.kind ?? "registrar", label: entry?.label ?? "", loginUrl: entry?.loginUrl ?? "", username: entry?.username ?? "" });
  const [secret, setSecret] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { busy, error, run } = useContractAction();
  const info = useInfo("Anbieter-Login", {
    steps: [
      <><b>Anbieter, Adresse, Benutzername</b> stehen offen.</>,
      <><b>Das Passwort</b> gibst du gleich beim Anlegen ein.</>,
      <><b>Löschen</b> entfernt den Login samt Passwort.</>,
    ],
    ask: "Wie lege ich einen Anbieter-Login an?",
  });
  const disabled = busy !== null;
  const set = (key: "label" | "loginUrl" | "username") => (event: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [key]: event.target.value });
  // A div, not a form: the browser shall not take the password for a sign-in of its own.
  const save = () => run("save", () => saveLogin({ ...draft, id: entry?.id, customerId: customer.id, secret: entry ? undefined : secret }), () => { onSaved(entry ? "Login gespeichert." : "Login angelegt."); onClose(); });
  return (
    <Modal title={entry ? "Login bearbeiten" : "Login anlegen"} onClose={onClose} className="users-modal" actions={info.button}>
      {info.box}
      <div className="cdm-dialog" onKeyDown={(event) => { if (event.key === "Enter" && event.target instanceof HTMLInputElement && !disabled && draft.label.trim()) { event.preventDefault(); save(); } }}>
        <p className="field-hint">{customer.company} · {customer.customerNumber}</p>
        <div className="upload-fields">
          <label className="upload-field"><span>Kategorie</span>
            <Select label="Kategorie" value={draft.kind} onChange={(kind) => setDraft({ ...draft, kind })} disabled={disabled} options={categories.map((category) => ({ value: category.id, label: category.name }))} />
          </label>
          <label className="upload-field"><span>Anbieter</span><SuggestInput label="Anbieter" value={draft.label} onValueChange={(label) => setDraft({ ...draft, label })} suggestions={providerSuggestions} maxLength={MAX_LABEL} required placeholder="z. B. netcup Kundenbereich" disabled={disabled} /></label>
          <label className="upload-field upload-field-wide"><span>Login-Adresse (optional)</span><input value={draft.loginUrl} onChange={set("loginUrl")} placeholder="https://login.anbieter.de" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url" autoComplete="off" maxLength={300} disabled={disabled} /></label>
          <label className="upload-field upload-field-wide"><span>Benutzername oder Kundennummer (optional)</span><input value={draft.username} onChange={set("username")} maxLength={MAX_USERNAME} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" data-1p-ignore="" data-lpignore="true" disabled={disabled} /></label>
        </div>
        {!entry && (canStoreSecret
          ? <SecretInput value={secret} onChange={setSecret} disabled={disabled} label="Passwort (optional)" />
          : <p className="field-hint">Ein Passwort lässt sich hinterlegen, sobald der Schlüssel auf dem Server eingetragen ist.</p>)}
        {entry && <p className="field-hint">Das Passwort änderst du in der Liste mit dem Stift neben den Punkten.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="button" className="sheet-button sheet-button-primary" disabled={disabled || !draft.label.trim()} onClick={save}>{busy === "save" ? <Spinner /> : <Save size={18} aria-hidden="true" />}{entry ? "Änderungen speichern" : "Anlegen"}</button>
        {entry && (confirmDelete
          ? <button type="button" className="sheet-button sheet-button-danger" disabled={disabled} onClick={() => run("delete", () => deleteLogin({ id: entry.id }), () => { onSaved(entry.hasPassword ? "Login samt Passwort gelöscht." : "Login gelöscht."); onClose(); })}>{busy === "delete" ? <Spinner /> : <Trash2 size={18} aria-hidden="true" />}{entry.hasPassword ? "Wirklich löschen, mit Passwort" : "Wirklich löschen"}</button>
          : <button type="button" className="sheet-button" disabled={disabled} onClick={() => setConfirmDelete(true)}><Trash2 size={18} aria-hidden="true" />Löschen</button>)}
      </div>
    </Modal>
  );
}
