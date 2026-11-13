"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronLeft, Clock, ExternalLink, Globe, LockKeyhole, LockKeyholeOpen, Pencil, Plus, QrCode, Save, Settings, Smartphone, Trash2, WandSparkles, X } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { MAX_LABEL, MAX_NOTE, MAX_USERNAME } from "@/lib/hub-domains/rules";
import { deleteKeychainCategory, deleteKeychainEntry, moveKeychainCategory, revealKeychainNote, saveKeychainCategory, saveKeychainEntry, saveKeychainNote, type KeychainResult } from "@/lib/hub-keychain/actions";
import { MAILBOX_CATEGORY, MAX_CATEGORY_NAME, NEW_CATEGORY_ICONS, nameTaken, readCategoryName } from "@/lib/hub-keychain/rules";
import type { KeychainCategory, KeychainEntry, KeychainLock, KeychainOwner } from "@/lib/hub-keychain/types";
import { Select } from "../select";
import { BrandLogo } from "../wordmark";
import { AssetPanel } from "./asset-panel";
import { SecretInput } from "./contracts-access";
import { CustomerSign } from "./customer-sign";
import { CategoryGlyph, formatDay, host, iconNode, olderThanYear, ownerOf, UserBox } from "./keychain-rows";
import { FieldGrid, PanelSection } from "./users-panel";

// The panels of the „Schlüsselbund“, floating at the right like the User Management's: one access with its details
// and note, the form for a new or changed access, and the settings with the fixed categories.

const tryAgain = "Das hat gerade nicht geklappt. Bitte versuche es erneut.";
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const relative = (iso: string) => {
  const days = Math.round((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days < 1) return "heute";
  if (days < 14) return `vor ${days} Tagen`;
  if (days < 60) return `vor ${Math.round(days / 7)} Wochen`;
  if (days < 365) return `vor ${Math.round(days / 30)} Monaten`;
  return days < 730 ? "vor über einem Jahr" : `vor ${Math.floor(days / 365)} Jahren`;
};

/** The sign of an owner: oalab's tile for „oalab intern“, else the customer's logo or initials. */
export function OwnerSign({ owner, size }: { owner: KeychainOwner; size?: "xs" | "sm" | "md" | "lg" }) {
  if (owner.id === null) return <span className={`kc-brand-tile${size ? ` is-${size}` : ""}`} aria-hidden="true"><BrandLogo /></span>;
  return <CustomerSign customer={{ id: owner.id, company: owner.company }} logo={owner.logo} size={size} />;
}

/** A strong password to start from: four groups of five letters and digits. */
function strongPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const chars = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]);
  return [0, 5, 10, 15].map((start) => chars.slice(start, start + 5).join("")).join("-");
}

/** One access: login page, user name, password, the note (only when open), when it changed, and the way to change it. */
export function EntryPanel({ entry, category, owner, open, secret, onEdit, onClose, onNeedUnlock, onUntil, onLock, onNotice }: {
  entry: KeychainEntry;
  category: KeychainCategory;
  owner: KeychainOwner;
  open: boolean;
  secret: React.ReactNode;
  onEdit: () => void;
  onClose: () => void;
  onNeedUnlock: (hint: string, then: () => void) => void;
  onUntil: (until: string) => void;
  onLock: (lock: KeychainLock) => void;
  onNotice: (message: string) => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState<"note" | "save" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const [seen, setSeen] = useState(entry.id);
  if (seen !== entry.id) {
    setSeen(entry.id);
    setNote(null);
    setDraft(null);
    setConfirmDelete(false);
    setError("");
  }
  // Locking hides an opened note again.
  if (!open && (note !== null || draft !== null)) {
    setNote(null);
    setDraft(null);
  }

  async function act<T>(key: "note" | "save" | "delete", action: () => Promise<KeychainResult<T>>, then: (data: T) => void) {
    setBusy(key);
    setError("");
    try {
      const result = await action();
      if (result.ok) then(result.data);
      else {
        if (result.lock) onLock(result.lock);
        setError(result.error);
      }
    } catch {
      setError(tryAgain);
    } finally {
      setBusy(null);
    }
  }
  const showNote = () => open
    ? act("note", () => revealKeychainNote({ owner: ownerOf(entry) }), (data) => { setNote(data.note); onUntil(data.until); })
    : onNeedUnlock("Danach siehst du die Notiz.", () => showNote());
  const saveNote = () => draft !== null && act("save", () => saveKeychainNote({ owner: ownerOf(entry), note: draft }), (data) => { setNote(draft.trim()); setDraft(null); onUntil(data.until); onNotice(draft.trim() ? "Notiz gespeichert." : "Notiz entfernt."); });
  const remove = () => act("delete", () => deleteKeychainEntry({ id: entry.id }), () => { onNotice(`„${entry.title}“ gelöscht.`); onClose(); });

  const old = entry.hasPassword && olderThanYear(entry.changedAt);
  const login = entry.kind === "login";
  const footer = login ? (
    <>
      {confirmDelete
        ? <button type="button" className="sheet-action is-danger" onClick={() => open ? remove() : onNeedUnlock("Danach löschen wir den Zugang.", remove)} disabled={busy !== null}>{busy === "delete" ? <MiniLoader size={15} /> : <Trash2 size={15} aria-hidden="true" />}Wirklich löschen?</button>
        : <button type="button" className="sheet-action is-danger" onClick={() => setConfirmDelete(true)} disabled={busy !== null}><Trash2 size={15} aria-hidden="true" />Löschen</button>}
      <span className="kc-foot-spacer" />
      <button type="button" className="sheet-action is-primary" onClick={() => open ? onEdit() : onNeedUnlock("Danach bearbeitest du den Zugang.", onEdit)}><Pencil size={15} aria-hidden="true" />Bearbeiten</button>
    </>
  ) : <p className="am-help kc-foot-note">Adresse und Person des Postfachs änderst du unter Vertrag &amp; Domain.</p>;

  return (
    <AssetPanel className="um-panel kc-panel" label={entry.title} icon={<CategoryGlyph category={category} size={20} tile large />} title={entry.title} subtitle={`${owner.company} · ${category.name}`} onClose={onClose} footer={footer}>
      <PanelSection title="Anmeldung" meta={entry.kind === "mailbox" ? "aus Vertrag & Domain" : undefined}>
        <div className="kc-fields">
          {entry.loginUrl && (
            <div className="um-field is-wide"><span className="am-label">Website</span>
              <div className="kc-box"><Globe size={14} aria-hidden="true" /><a className="kc-box-text is-link" href={entry.loginUrl} target="_blank" rel="noopener noreferrer">{host(entry.loginUrl)}</a><span className="kc-box-acts"><a className="row-action" href={entry.loginUrl} target="_blank" rel="noopener noreferrer" aria-label="Login-Seite öffnen" data-tip="Öffnen"><ExternalLink size={16} aria-hidden="true" /></a></span></div>
            </div>
          )}
          <div className="um-field is-wide"><span className="am-label">{entry.kind === "mailbox" ? "E-Mail-Adresse" : "Benutzername oder E-Mail"}</span><UserBox entry={entry} /></div>
          <div className="um-field is-wide"><span className="am-label">Passwort</span><div className="kc-panel-secret">{secret}</div></div>
        </div>
        <p className="kc-changed"><Clock size={13} aria-hidden="true" /><span>{entry.hasPassword ? "Passwort geändert" : "Angelegt"} am {formatDay(entry.changedAt)} · {relative(entry.changedAt)}</span>{old && <span className="kc-age" data-tip="Älter als ein Jahr" data-tip-sub="Ein neues Passwort wäre gut">alt</span>}</p>
      </PanelSection>
      <PanelSection title="Notiz" meta="verschlüsselt wie das Passwort">
        {draft !== null ? (
          <div className="kc-note-edit">
            <textarea className="am-input" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={MAX_NOTE} rows={4} placeholder="z. B. Bestätigungscode geht an …" autoFocus />
            <div className="kc-note-acts">
              <button type="button" className="sheet-action is-quiet" onClick={() => setDraft(null)} disabled={busy !== null}>Abbrechen</button>
              <button type="button" className="sheet-action is-primary" onClick={saveNote} disabled={busy !== null}>{busy === "save" ? <MiniLoader size={15} /> : <Save size={15} aria-hidden="true" />}Speichern</button>
            </div>
          </div>
        ) : !open ? (
          <p className="kc-note is-locked"><LockKeyhole size={16} aria-hidden="true" />Nach dem Entsperren sichtbar.{entry.hasNote && <button type="button" className="am-label-action" onClick={showNote}><LockKeyholeOpen size={13} aria-hidden="true" />Anzeigen</button>}</p>
        ) : note !== null ? (
          <div className="kc-note-view">
            <p className="kc-note">{note || <span className="t-secondary">Keine Notiz.</span>}</p>
            <button type="button" className="am-label-action" onClick={() => setDraft(note)}><Pencil size={13} aria-hidden="true" />{note ? "Bearbeiten" : "Notiz schreiben"}</button>
          </div>
        ) : entry.hasNote ? (
          <p className="kc-note is-locked"><LockKeyholeOpen size={16} aria-hidden="true" />Eine Notiz ist hinterlegt.<button type="button" className="am-label-action" onClick={showNote} disabled={busy !== null}>{busy === "note" ? <MiniLoader size={13} /> : null}Anzeigen</button></p>
        ) : (
          <p className="kc-note is-locked">Keine Notiz.<button type="button" className="am-label-action" onClick={() => setDraft("")}><Plus size={13} aria-hidden="true" />Notiz schreiben</button></p>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
      </PanelSection>
    </AssetPanel>
  );
}

export type EntryDraft = { id?: string; ownerId: string | null; categoryId: string; label: string; loginUrl: string; username: string; secret: string; note: string };

/** A new access or the details of one (its password and note change in the list and the details). */
export function EntryForm({ draft: start, owners, categories, onSettings, onClose, onSaved, onLock }: {
  draft: EntryDraft;
  owners: KeychainOwner[];
  categories: KeychainCategory[];
  onSettings: (draft: EntryDraft) => void;
  onClose: () => void;
  onSaved: (id: string, until: string, message: string) => void;
  onLock: (lock: KeychainLock) => void;
}) {
  const [draft, setDraft] = useState(start);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editing = Boolean(draft.id);
  const choosable = categories.filter((category) => editing || category.id !== MAILBOX_CATEGORY || draft.ownerId === null);
  const owner = owners.find((item) => item.id === draft.ownerId) ?? owners[0];
  const category = categories.find((item) => item.id === draft.categoryId);
  const set = (key: keyof EntryDraft) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft({ ...draft, [key]: event.target.value });

  async function save() {
    setBusy(true);
    setError("");
    try {
      const result = await saveKeychainEntry({ ...draft, secret: editing ? undefined : draft.secret, note: editing ? undefined : draft.note });
      if (result.ok) onSaved(result.data.id, result.data.until, editing ? "Zugang gespeichert." : "Zugang angelegt.");
      else {
        if (result.lock) onLock(result.lock);
        setError(result.error);
      }
    } catch {
      setError(tryAgain);
    } finally {
      setBusy(false);
    }
  }

  const footer = (
    <>
      <span className="kc-foot-spacer" />
      <button type="button" className="sheet-action is-quiet" onClick={onClose} disabled={busy}>Abbrechen</button>
      <button type="button" className="sheet-action is-primary" onClick={save} disabled={busy || !draft.label.trim() || !category}>{busy ? <MiniLoader size={15} /> : <Check size={15} aria-hidden="true" />}{editing ? "Speichern" : "Anlegen"}</button>
    </>
  );
  return (
    <AssetPanel className="um-panel kc-panel" label={editing ? "Zugang bearbeiten" : "Neuer Zugang"} icon={<span className="am-tile cdm-tile-icon is-lg" aria-hidden="true">{editing ? <Pencil size={20} /> : <Plus size={20} />}</span>} title={editing ? "Zugang bearbeiten" : "Neuer Zugang"} subtitle="Passwort und Notiz werden verschlüsselt gespeichert" onClose={onClose} footer={footer}>
      {/* A div, not a form: the browser shall not take a customer's password for a sign-in of its own. */}
      <div onKeyDown={(event) => { if (event.key === "Enter" && event.target instanceof HTMLInputElement && draft.label.trim() && !busy) { event.preventDefault(); save(); } }}>
        <PanelSection title="Zugang">
          <FieldGrid>
            <div className="um-field is-wide"><span className="am-label">Gehört zu</span>
              <span className="um-pick kc-pick">
                <OwnerSign owner={owner} size="xs" />
                <Select variant="bare" showLead={false} label="Gehört zu" value={owner.id ?? "own"} onChange={(value) => setDraft({ ...draft, ownerId: value === "own" ? null : value, categoryId: value !== "own" && draft.categoryId === MAILBOX_CATEGORY && !editing ? "other" : draft.categoryId })} searchPlaceholder="Kunde oder Nummer suchen …"
                  options={owners.map((item) => ({ value: item.id ?? "own", label: item.company, prefix: item.customerNumber || undefined, meta: item.id === null ? "Eigene Konten" : undefined, lead: <OwnerSign owner={item} size="xs" /> }))} disabled={busy} />
                <ChevronDown size={16} aria-hidden="true" />
              </span>
            </div>
            <div className="um-field is-wide"><span className="am-label">Kategorie<button type="button" className="am-label-action" onClick={() => onSettings(draft)}><Settings size={13} aria-hidden="true" />Kategorien verwalten</button></span>
              <span className="um-pick kc-pick">
                {category ? <span className="company-mark kc-mark"><CategoryGlyph category={category} size={14} /></span> : <span className="company-mark kc-mark" />}
                <Select variant="bare" showLead={false} label="Kategorie" value={draft.categoryId} placeholder="Kategorie wählen" onChange={(value) => setDraft({ ...draft, categoryId: value })}
                  options={choosable.map((item) => ({ value: item.id, label: item.name, meta: String(item.count), lead: <CategoryGlyph category={item} /> }))} disabled={busy} />
                <ChevronDown size={16} aria-hidden="true" />
              </span>
              <p className="am-help">Nur aus der Liste. Neue Kategorien legst du in den Einstellungen an{draft.ownerId !== null && !editing ? "; Postfächer von Kunden unter Vertrag & Domain" : ""}.</p>
            </div>
            <label className="um-field is-wide"><span className="am-label">Name</span><input className="am-input" value={draft.label} onChange={set("label")} maxLength={MAX_LABEL} placeholder="z. B. Hosting Webpanel" autoComplete="off" disabled={busy} autoFocus={!editing} /></label>
            <label className="um-field is-wide"><span className="am-label">Website <small>optional</small></span><input className="am-input" value={draft.loginUrl} onChange={set("loginUrl")} maxLength={300} placeholder="https://" inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy} /></label>
            <label className="um-field is-wide"><span className="am-label">Benutzername oder E-Mail <small>optional</small></span><input className="am-input" value={draft.username} onChange={set("username")} maxLength={MAX_USERNAME} autoComplete="off" autoCapitalize="none" spellCheck={false} data-1p-ignore="" data-lpignore="true" disabled={busy} /></label>
          </FieldGrid>
        </PanelSection>
        {!editing && (
          <PanelSection title="Passwort und Notiz" meta="verschlüsselt">
            <div className="kc-fields">
              <div className="um-field is-wide">
                <span className="am-label"><span>Passwort <small>optional</small></span><button type="button" className="am-label-action" onClick={() => setDraft({ ...draft, secret: strongPassword() })} disabled={busy}><WandSparkles size={13} aria-hidden="true" />Sicheres erzeugen</button></span>
                <SecretInput value={draft.secret} onChange={(secret) => setDraft({ ...draft, secret })} disabled={busy} label="Passwort" hideLabel />
              </div>
              <label className="um-field is-wide"><span className="am-label">Notiz <small>optional</small></span><textarea className="am-input" value={draft.note} onChange={set("note")} maxLength={MAX_NOTE} rows={3} placeholder="z. B. Bestätigungscode geht an …" disabled={busy} /></label>
            </div>
          </PanelSection>
        )}
        {editing && <p className="am-help kc-form-help">Passwort und Notiz änderst du in der Liste und in den Details.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </AssetPanel>
  );
}

/**
 * The settings. The categories are fixed for everyone, chosen from a list when an access is made: order (the groups'),
 * name, a new one with name and symbol; deleting only while empty, „Postfächer“ never. Below, the admin's own app:
 * linking it anew (new phone, lost phone) needs the keychain open, which the page asks for first.
 */
export function SettingsPanel({ categories, lock, fromForm, onRelink, onBack, onClose, onNotice }: {
  categories: KeychainCategory[];
  lock: KeychainLock;
  fromForm: boolean;
  onRelink: () => void;
  onBack: () => void;
  onClose: () => void;
  onNotice: (message: string) => void;
}) {
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [adding, setAdding] = useState<{ name: string; icon: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function act<T>(key: string, action: () => Promise<KeychainResult<T>>, then: () => void) {
    setBusy(key);
    setError("");
    try {
      const result = await action();
      if (result.ok) then();
      else setError(result.error);
    } catch {
      setError(tryAgain);
    } finally {
      setBusy(null);
    }
  }
  const renameName = renaming ? readCategoryName(renaming.name) : null;
  const renameClash = Boolean(renaming && renameName && nameTaken(renameName, categories, renaming.id));
  const addName = adding ? readCategoryName(adding.name) : null;
  const addClash = Boolean(addName && nameTaken(addName, categories));
  const saveRename = () => renaming && renameName && !renameClash && act(`rename:${renaming.id}`, () => saveKeychainCategory({ id: renaming.id, name: renameName }), () => { setRenaming(null); onNotice("Kategorie umbenannt."); });
  const saveAdd = () => adding && addName && !addClash && act("add", () => saveKeychainCategory({ name: addName, icon: adding.icon }), () => { setAdding(null); onNotice(`Kategorie „${addName}“ angelegt.`); });

  const footer = (
    <>
      <span className="kc-foot-spacer" />
      <button type="button" className="sheet-action is-primary" onClick={fromForm ? onBack : onClose}>{fromForm ? <><ChevronLeft size={15} aria-hidden="true" />Zurück zum Zugang</> : <><Check size={15} aria-hidden="true" />Fertig</>}</button>
    </>
  );
  return (
    <AssetPanel className="um-panel kc-panel" label="Einstellungen" icon={<span className="am-tile cdm-tile-icon is-lg" aria-hidden="true"><Settings size={20} /></span>} title="Einstellungen" subtitle="Kategorien für alle Admins, deine App nur für dich" onClose={fromForm ? onBack : onClose} footer={footer}
      actions={fromForm ? <button type="button" className="chat-icon-button is-muted" onClick={onBack} aria-label="Zurück zum Zugang" data-tip="Zurück zum Zugang"><ChevronLeft size={20} aria-hidden="true" /></button> : undefined}>
      <PanelSection title="Kategorien" meta={`${plural(categories.length, "Kategorie", "Kategorien")} · fest vorgegeben`}>
        <p className="am-help kc-set-lead">Beim Anlegen eines Zugangs wählst du nur aus dieser Liste. Die Reihenfolge gilt auch für die Gruppen unter „Alle Zugänge“.</p>
        <div className="um-list">
          {categories.map((category, index) => {
            const editing = renaming?.id === category.id;
            return (
              <div key={category.id} className="um-item kc-cat-row">
                <div className="um-item-main">
                  <CategoryGlyph category={category} size={16} tile />
                  {editing ? (
                    <input className="am-input kc-cat-input" value={renaming.name} onChange={(event) => setRenaming({ id: category.id, name: event.target.value })} maxLength={MAX_CATEGORY_NAME} aria-label={`Neuer Name für ${category.name}`} autoFocus
                      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); saveRename(); } if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setRenaming(null); } }} />
                  ) : (
                    <span className="um-item-text"><strong>{category.name}</strong><small>{category.count ? plural(category.count, "Zugang", "Zugänge") : "noch leer"}{category.fixed ? " · gehört zu Vertrag & Domain" : ""}</small></span>
                  )}
                  <span className="um-item-acts">
                    {editing ? (
                      <>
                        <button type="button" className="sheet-action is-primary" onClick={saveRename} disabled={!renameName || renameClash || busy !== null}>{busy === `rename:${category.id}` ? <MiniLoader size={15} /> : <Check size={15} aria-hidden="true" />}Speichern</button>
                        <button type="button" className="row-action" onClick={() => setRenaming(null)} aria-label="Abbrechen" data-tip="Abbrechen"><X size={16} aria-hidden="true" /></button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="row-action" onClick={() => act(`move:${category.id}`, () => moveKeychainCategory({ id: category.id, direction: "up" }), () => undefined)} disabled={index === 0 || busy !== null} aria-label={`${category.name} nach oben`} data-tip="Nach oben"><ArrowUp size={16} aria-hidden="true" /></button>
                        <button type="button" className="row-action" onClick={() => act(`move:${category.id}`, () => moveKeychainCategory({ id: category.id, direction: "down" }), () => undefined)} disabled={index === categories.length - 1 || busy !== null} aria-label={`${category.name} nach unten`} data-tip="Nach unten"><ArrowDown size={16} aria-hidden="true" /></button>
                        <button type="button" className="row-action" onClick={() => { setRenaming({ id: category.id, name: category.name }); setAdding(null); setConfirmDelete(null); }} aria-label={`${category.name} umbenennen`} data-tip="Umbenennen"><Pencil size={16} aria-hidden="true" /></button>
                        {category.fixed || category.count > 0
                          ? <button type="button" className="row-action kc-off" aria-disabled="true" aria-label={`${category.name} löschen geht nicht`} data-tip={category.fixed ? "Bleibt immer" : "Löschen geht erst ohne Zugänge"} data-tip-sub={category.fixed ? "Gehört zu Vertrag & Domain" : `${plural(category.count, "Zugang", "Zugänge")} vorher in eine andere Kategorie`}><Trash2 size={16} aria-hidden="true" /></button>
                          : confirmDelete === category.id
                            ? <button type="button" className="sheet-action is-danger kc-cat-sure" onClick={() => act(`delete:${category.id}`, () => deleteKeychainCategory({ id: category.id }), () => { setConfirmDelete(null); onNotice(`Kategorie „${category.name}“ gelöscht.`); })} disabled={busy !== null}>{busy === `delete:${category.id}` ? <MiniLoader size={14} /> : <Trash2 size={14} aria-hidden="true" />}Wirklich löschen?</button>
                            : <button type="button" className="row-action" onClick={() => setConfirmDelete(category.id)} aria-label={`${category.name} löschen`} data-tip="Löschen"><Trash2 size={16} aria-hidden="true" /></button>}
                      </>
                    )}
                  </span>
                </div>
                {editing && renameClash && <div className="um-item-below"><p className="am-help is-error">Diese Kategorie gibt es schon.</p></div>}
              </div>
            );
          })}
        </div>
        {adding ? (
          <div className="um-field um-new-entry kc-cat-new">
            <label className="kc-cat-new-field"><span className="am-label">Neue Kategorie</span>
              <input className="am-input" value={adding.name} onChange={(event) => setAdding({ ...adding, name: event.target.value })} maxLength={MAX_CATEGORY_NAME} placeholder="z. B. Online-Shop" autoComplete="off" autoFocus
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); saveAdd(); } if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setAdding(null); } }} />
            </label>
            {addClash && <p className="am-help is-error">Diese Kategorie gibt es schon.</p>}
            <span className="am-label">Symbol</span>
            <div className="kc-icon-pick" role="radiogroup" aria-label="Symbol">
              {NEW_CATEGORY_ICONS.map((icon) => <button key={icon} type="button" role="radio" aria-checked={adding.icon === icon} className="kc-icon-choice" onClick={() => setAdding({ ...adding, icon })} aria-label={`Symbol ${icon}`}>{iconNode(icon, 16)}</button>)}
            </div>
            <div className="kc-cat-new-acts">
              <button type="button" className="sheet-action is-quiet" onClick={() => setAdding(null)} disabled={busy !== null}>Abbrechen</button>
              <button type="button" className="sheet-action is-primary" onClick={saveAdd} disabled={!addName || addClash || busy !== null}>{busy === "add" ? <MiniLoader size={15} /> : <Plus size={15} aria-hidden="true" />}Hinzufügen</button>
            </div>
          </div>
        ) : (
          <button type="button" className="kc-cat-add" onClick={() => { setAdding({ name: "", icon: "key-round" }); setRenaming(null); setConfirmDelete(null); }}><Plus size={15} aria-hidden="true" />Kategorie hinzufügen</button>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
      </PanelSection>
      <PanelSection title="Deine App" meta="nur für dich">
        <div className="um-list">
          <div className="um-item kc-cat-row">
            <div className="um-item-main">
              <span className="am-file-icon cdm-file-icon" aria-hidden="true"><Smartphone size={16} /></span>
              <span className="um-item-text"><strong>Authenticator-App</strong><small>{lock.status === "setup" ? "noch nicht verbunden" : `verbunden · ${plural(lock.recoveryLeft, "Notfall-Code", "Notfall-Codes")} übrig`}</small></span>
              <span className="um-item-acts"><button type="button" className="sheet-action" onClick={onRelink}><QrCode size={15} aria-hidden="true" />{lock.status === "setup" ? "Einrichten" : "Neu verbinden"}</button></span>
            </div>
          </div>
        </div>
        <p className="am-help">Neues Handy oder Handy weg? Erst mit der App oder einem Notfall-Code entsperren, dann neu verbinden. Die alte App und die alten Notfall-Codes zählen danach nicht mehr.</p>
      </PanelSection>
    </AssetPanel>
  );
}
