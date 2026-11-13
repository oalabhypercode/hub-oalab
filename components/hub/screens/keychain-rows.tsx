"use client";

import { useEffect, useState } from "react";
import {
  AppWindow, AtSign, Building2, ChartColumn, Check, ChevronRight, Cloud, Copy, CreditCard, Database, ExternalLink, Eye, EyeOff, Globe, Inbox,
  KeyRound, LayoutTemplate, LockKeyhole, LockKeyholeOpen, Megaphone, Plus, Server, Share2, ShoppingCart, UserRound, Wifi,
} from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { REVEAL_SECONDS, type VaultOwner } from "@/lib/hub-domains/rules";
import type { KeychainEntry, KeychainLock } from "@/lib/hub-keychain/types";
import { revealSecret, type VaultResult } from "@/lib/hub-vault/actions";

// Rows of the „Schlüsselbund“ table: an access in one line, its login with copy, its password with eye and copy. The
// page knows only whether a password exists; showing or copying asks the server, which checks the open keychain and
// logs the look first. A shown password hides after 30 seconds, when the tab goes into the background and on locking.

const icons: Record<string, (size: number) => React.ReactElement> = {
  inbox: (size) => <Inbox size={size} aria-hidden="true" />, globe: (size) => <Globe size={size} aria-hidden="true" />, server: (size) => <Server size={size} aria-hidden="true" />,
  "layout-template": (size) => <LayoutTemplate size={size} aria-hidden="true" />, "share-2": (size) => <Share2 size={size} aria-hidden="true" />, "chart-column": (size) => <ChartColumn size={size} aria-hidden="true" />,
  "app-window": (size) => <AppWindow size={size} aria-hidden="true" />, "key-round": (size) => <KeyRound size={size} aria-hidden="true" />, cloud: (size) => <Cloud size={size} aria-hidden="true" />,
  "shopping-cart": (size) => <ShoppingCart size={size} aria-hidden="true" />, "credit-card": (size) => <CreditCard size={size} aria-hidden="true" />, megaphone: (size) => <Megaphone size={size} aria-hidden="true" />,
  database: (size) => <Database size={size} aria-hidden="true" />, wifi: (size) => <Wifi size={size} aria-hidden="true" />, "building-2": (size) => <Building2 size={size} aria-hidden="true" />,
};
/** The colour family of a category: the first ones as in the preview, new ones in slate. */
const tones: Record<string, string> = { mailbox: "", registrar: "is-domain", dns: "is-domain", hosting: "is-domain", cms: "is-service", social: "is-service", google: "is-service", tools: "kc-tone-tools", other: "kc-tone-tools" };
export const toneOf = (categoryId: string) => tones[categoryId] ?? "kc-tone-custom";
/** A category's symbol at a size; unknown names get the key. */
export const iconNode = (icon: string, size: number) => (icons[icon] ?? icons["key-round"])(size);

/** The category's symbol in its colour, plain (rows, groups) or on a tile (panels, settings). */
export function CategoryGlyph({ category, size = 15, tile = false, large = false, tip }: { category: { id: string; icon: string }; size?: number; tile?: boolean; large?: boolean; tip?: string }) {
  return tile
    ? <span className={`am-file-icon cdm-file-icon${large ? " is-lg" : ""} ${toneOf(category.id)}`} aria-hidden="true">{iconNode(category.icon, size)}</span>
    : <span className={`kc-kind-glyph ${toneOf(category.id)}`} data-tip={tip}>{iconNode(category.icon, size)}</span>;
}

export const host = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");
const DOTS = "••••••••••";
const tryAgain = "Das hat gerade nicht geklappt. Bitte versuche es erneut.";
const dayFormat = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

/** „vor 3 Mon.“: short enough for a column. */
export function relativeShort(iso: string, now = Date.now()) {
  const days = Math.round((now - Date.parse(iso)) / 86_400_000);
  if (days < 1) return "heute";
  if (days < 14) return `vor ${days} T.`;
  if (days < 60) return `vor ${Math.round(days / 7)} Wo.`;
  if (days < 365) return `vor ${Math.round(days / 30)} Mon.`;
  return "über 1 Jahr";
}
export const olderThanYear = (iso: string, now = Date.now()) => now - Date.parse(iso) > 365 * 86_400_000;
export const formatDay = (iso: string) => dayFormat.format(new Date(iso));
export const ownerOf = (entry: KeychainEntry): VaultOwner => ({ kind: entry.kind, id: entry.id });

/** The login in its column: the value in monospace and its copy button. Visible without a code: it is no secret. */
export function UserCell({ entry }: { entry: KeychainEntry }) {
  const [copied, setCopied] = useState(false);
  if (!entry.username) return <span className="cell-none">–</span>;
  const what = entry.kind === "mailbox" || entry.username.includes("@") ? "E-Mail" : "Benutzername";
  return (
    <span className="kc-inline">
      <span className="kc-mono" data-tip={entry.username.length > 20 ? entry.username : undefined}>{entry.username}</span>
      <button type="button" className={`row-action kc-mini${copied ? " kc-copied" : ""}`} onClick={async () => { try { await navigator.clipboard.writeText(entry.username); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { /* blocked: the value stays readable */ } }} aria-label={`${what} kopieren`} data-tip={copied ? "Kopiert" : `${what} kopieren`}>
        {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
      </button>
    </span>
  );
}

/**
 * The password in its column: lock and dots; shown, the text on a light amber ground with the line that runs down.
 * Locked, the eye or the copy button asks for the code first (`onNeedUnlock`) and then does what was asked.
 */
export function SecretCell({ entry, open, lockKey, onNeedUnlock, onSet, onUntil, onLock, onNotice }: {
  entry: KeychainEntry;
  open: boolean;
  /** Changes when the keychain locks: everything shown hides. */
  lockKey: string;
  onNeedUnlock: (hint: string, then: () => void) => void;
  onSet: () => void;
  onUntil: (until: string) => void;
  onLock: (lock: KeychainLock) => void;
  onNotice: (message: string) => void;
}) {
  const [shown, setShown] = useState<{ secret: string; until: number } | null>(null);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState<"show" | "copy" | null>(null);
  const [copied, setCopied] = useState(false);
  const [seenKey, setSeenKey] = useState(lockKey);
  if (seenKey !== lockKey) {
    setSeenKey(lockKey);
    setShown(null);
  }
  const owner = ownerOf(entry);
  const name = entry.title;

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

  function refused(result: VaultResult<unknown>) {
    if (result.ok) return;
    if (result.lock) onLock(result.lock);
    onNotice(result.error);
  }

  async function show() {
    if (!open) { onNeedUnlock(`Danach siehst du das Passwort von „${name}“.`, show); return; }
    setBusy("show");
    try {
      const result = await revealSecret({ owner, purpose: "show" });
      if (!result.ok) refused(result);
      else {
        const time = Date.now();
        setNow(time);
        setShown({ secret: result.data.secret, until: time + REVEAL_SECONDS * 1000 });
        onUntil(result.data.until);
      }
    } catch {
      onNotice(tryAgain);
    } finally {
      setBusy(null);
    }
  }

  // The clipboard write starts within the click, with the password still on its way: Safari only allows it so.
  async function copy() {
    if (!open) { onNeedUnlock(`Danach kopieren wir das Passwort von „${name}“.`, copy); return; }
    setBusy("copy");
    const box: { result: VaultResult<{ secret: string; until: string }> | null } = { result: null };
    const loading = revealSecret({ owner, purpose: "copy" }).then((result) => {
      box.result = result;
      if (!result.ok) throw new Error("refused");
      return result.data.secret;
    });
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
      if (box.result?.ok) onUntil(box.result.data.until);
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
      if (result && !result.ok) refused(result);
      else if (result?.ok) {
        try {
          await navigator.clipboard.writeText(result.data.secret);
          done();
        } catch {
          onNotice("Der Browser hat das Kopieren blockiert. Tipp noch einmal auf Kopieren oder nutze das Auge.");
        }
      } else onNotice(tryAgain);
    } finally {
      setBusy(null);
    }
  }

  if (!entry.hasPassword) {
    return <button type="button" className="kc-add-link" onClick={() => open ? onSet() : onNeedUnlock("Danach hinterlegst du das Passwort.", onSet)} data-tip="Passwort hinterlegen" data-tip-sub={open ? undefined : "Fragt einmal den Code aus der App"}><Plus size={13} aria-hidden="true" />Passwort hinterlegen</button>;
  }
  const left = shown ? Math.max(0, Math.min(1, (shown.until - now) / (REVEAL_SECONDS * 1000))) : 0;
  const askHint = open ? undefined : "Fragt einmal den Code aus der App";
  return (
    <span className={`kc-inline kc-secret${open ? " is-open" : ""}${shown ? " is-shown" : ""}`}>
      {shown
        ? <><code className="kc-mono kc-secret-text" translate="no">{shown.secret}</code><span className="kc-box-timer" style={{ "--left": left.toFixed(3) } as React.CSSProperties} aria-hidden="true" /><span className="visually-hidden" role="status">Passwort angezeigt, nach {REVEAL_SECONDS} Sekunden wieder verdeckt.</span></>
        : <>{open ? <LockKeyholeOpen size={13} className="kc-lock-glyph" aria-hidden="true" /> : <LockKeyhole size={13} className="kc-lock-glyph" aria-hidden="true" />}<span className="kc-dots" aria-label="Passwort verdeckt">{DOTS}</span></>}
      {shown
        ? <button type="button" className="row-action kc-mini" onClick={() => setShown(null)} aria-label={`Passwort von ${name} verdecken`} data-tip="Verdecken" data-tip-sub={`Sonst nach ${REVEAL_SECONDS} Sekunden von selbst`}><EyeOff size={15} aria-hidden="true" /></button>
        : <button type="button" className="row-action kc-mini" onClick={show} disabled={busy !== null} aria-label={`Passwort von ${name} anzeigen`} data-tip={open ? `Anzeigen (${REVEAL_SECONDS} Sekunden)` : "Anzeigen"} data-tip-sub={askHint}>{busy === "show" ? <MiniLoader size={14} /> : <Eye size={15} aria-hidden="true" />}</button>}
      <button type="button" className={`row-action kc-mini${copied ? " kc-copied" : ""}`} onClick={copy} disabled={busy !== null} aria-label={`Passwort von ${name} kopieren`} data-tip={copied ? "Kopiert" : "Passwort kopieren"} data-tip-sub={askHint}>
        {busy === "copy" ? <MiniLoader size={14} /> : copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
        <span className="visually-hidden" role="status">{copied ? "Kopiert" : ""}</span>
      </button>
    </span>
  );
}

/** One access as a table row: name with symbol and login page, category, login, password, last change, details. */
export function AccessRow({ entry, category, current, showKind, secret, onOpen }: {
  entry: KeychainEntry;
  category: { id: string; name: string; icon: string };
  current: boolean;
  showKind: boolean;
  secret: React.ReactNode;
  onOpen: () => void;
}) {
  const old = entry.hasPassword && olderThanYear(entry.changedAt);
  return (
    <tr className={`kc-row${current ? " is-current" : ""}`} onClick={(event) => { if (!(event.target instanceof Element && event.target.closest("a, button, input"))) onOpen(); }}>
      <td className="kc-cell-name">
        <span className="cell-title">
          <CategoryGlyph category={category} tip={category.name} />
          <span className="kc-name">{entry.title}</span>
          {entry.loginUrl && <a className="kc-site" href={entry.loginUrl} target="_blank" rel="noopener noreferrer" aria-label={`Login-Seite ${host(entry.loginUrl)} öffnen`} data-tip={host(entry.loginUrl)} data-tip-sub="Login-Seite öffnen"><ExternalLink size={13} aria-hidden="true" /></a>}
        </span>
      </td>
      {showKind && <td className="kc-col-kind kc-cell-kind">{category.name}</td>}
      <td className="kc-col-user kc-cell-user"><UserCell entry={entry} /></td>
      <td className="kc-col-secret kc-cell-secret">{secret}</td>
      <td className="kc-col-changed kc-cell-changed"><span className="numeric">{formatDay(entry.changedAt)}</span><small className={old ? "is-old" : undefined} data-tip={old ? "Älter als ein Jahr" : undefined} data-tip-sub={old ? "Ein neues Passwort wäre gut" : undefined}>{relativeShort(entry.changedAt)}</small></td>
      <td className="kc-col-open"><button type="button" className="row-action kc-mini" onClick={onOpen} aria-label={`Details zu ${entry.title}`} data-tip="Details"><ChevronRight size={15} aria-hidden="true" /></button></td>
    </tr>
  );
}

/** Login or mail address as a field box in the panel, with copy inside. */
export function UserBox({ entry }: { entry: KeychainEntry }) {
  const [copied, setCopied] = useState(false);
  if (!entry.username) return <div className="kc-box"><UserRound size={14} aria-hidden="true" /><span className="kc-box-text is-quiet">Kein Benutzername</span></div>;
  const mail = entry.kind === "mailbox" || entry.username.includes("@");
  return (
    <div className="kc-box">
      {mail ? <AtSign size={14} aria-hidden="true" /> : <UserRound size={14} aria-hidden="true" />}
      <span className="kc-box-text">{entry.username}</span>
      <span className="kc-box-acts"><button type="button" className={`row-action${copied ? " kc-copied" : ""}`} onClick={async () => { try { await navigator.clipboard.writeText(entry.username); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { /* blocked */ } }} aria-label={`${mail ? "E-Mail" : "Benutzername"} kopieren`} data-tip={copied ? "Kopiert" : "Kopieren"}>{copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}</button></span>
    </div>
  );
}
