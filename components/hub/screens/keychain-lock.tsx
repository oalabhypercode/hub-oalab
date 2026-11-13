"use client";

import { useEffect, useRef, useState } from "react";
import { BadgeCheck, Check, Copy, Download, LifeBuoy, LockKeyhole, LockKeyholeOpen, Printer, QrCode, ShieldAlert, ShieldCheck, Smartphone, Timer } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { confirmKeychainApp, confirmKeychainSetupCode, keychainStatus, lockKeychain, sendKeychainSetupCode, unlockKeychain, unlockKeychainWithRecovery, type KeychainResult } from "@/lib/hub-keychain/actions";
import { LOCK_MINUTES, MAX_OPEN_MINUTES, UNLOCK_MINUTES } from "@/lib/hub-keychain/rules";
import type { KeychainLock } from "@/lib/hub-keychain/types";
import { REVEAL_SECONDS } from "@/lib/hub-domains/rules";
import { Modal } from "../modal";

// The lock of the „Schlüsselbund“ in the page: where it stands, the dialog for the app's code (or a recovery code) and
// the setup in three steps. The server decides; the page only counts down the time it was told and asks again when it
// runs out. Shared with the passwords under „Vertrag & Domain“.

const tryAgain = "Das hat gerade nicht geklappt. Bitte versuche es erneut.";
const clock = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const lockEnd = (lock: KeychainLock) => lock.status === "unlocked" || lock.status === "blocked" ? Date.parse(lock.until) : 0;

/** The lock as the page sees it, counting down; when the time is up it asks the server where it stands. */
export function useKeychainLock(initial: KeychainLock) {
  const [lock, setLock] = useState(initial);
  const [seen, setSeen] = useState(initial);
  const [now, setNow] = useState(0);
  // New data from the server (after a save, a reload) wins.
  if (seen !== initial) {
    setSeen(initial);
    setLock(initial);
  }
  const end = lockEnd(lock);
  useEffect(() => {
    if (!end) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [end]);
  const over = end > 0 && now >= end;
  useEffect(() => {
    if (!over) return;
    let gone = false;
    keychainStatus().then((result) => { if (!gone && result.ok) setLock(result.data.lock); }).catch(() => undefined);
    return () => { gone = true; };
  }, [over]);
  return {
    lock,
    setLock,
    open: lock.status === "unlocked" && !over,
    left: end ? Math.max(0, end - now) : 0,
    /** An action kept the keychain open: its new end. */
    extend: (until: string) => setLock((current) => current.status === "unlocked" ? { ...current, until } : current),
    /** A refusal brought the current lock along. */
    take: <T,>(result: KeychainResult<T> | { ok: false; error: string; lock?: KeychainLock } | { ok: true; data: T }) => {
      if (!result.ok && "lock" in result && result.lock) setLock(result.lock);
    },
  };
}

export type KeychainLockApi = ReturnType<typeof useKeychainLock>;

/** In the pane's head: the state as a chip and the one button that changes it. */
export function LockControl({ lock, left, onUnlock, onLock, onSetup, busy }: { lock: KeychainLock; left: number; onUnlock: () => void; onLock: () => void; onSetup: () => void; busy: boolean }) {
  if (lock.status === "setup") {
    return <div className="kc-lock-ctl"><span className="kc-chip is-setup"><Smartphone size={14} aria-hidden="true" /><span>Noch nicht eingerichtet</span></span><button type="button" className="sheet-action is-primary" onClick={onSetup}><QrCode size={15} aria-hidden="true" />Einrichten</button></div>;
  }
  if (lock.status === "unlocked" && left > 0) {
    return (
      <div className="kc-lock-ctl">
        <span className="kc-chip is-open" data-tip={`Sperrt sich nach ${UNLOCK_MINUTES} Minuten ohne Aktion`}><LockKeyholeOpen size={14} aria-hidden="true" /><span>Entsperrt · <b className="numeric">{mmss(left)}</b></span></span>
        <button type="button" className="sheet-action" onClick={onLock} disabled={busy}>{busy ? <MiniLoader size={15} /> : <LockKeyhole size={15} aria-hidden="true" />}Sperren</button>
      </div>
    );
  }
  if (lock.status === "blocked") {
    return <div className="kc-lock-ctl"><span className="kc-chip is-blocked" data-tip="Zu viele falsche Codes"><ShieldAlert size={14} aria-hidden="true" /><span>Gesperrt bis {clock.format(new Date(lock.until))}</span></span><button type="button" className="sheet-action" onClick={onUnlock}><LifeBuoy size={15} aria-hidden="true" />Notfall-Code</button></div>;
  }
  return <div className="kc-lock-ctl"><span className="kc-chip is-locked"><LockKeyhole size={14} aria-hidden="true" /><span>Gesperrt</span></span><button type="button" className="sheet-action is-primary" onClick={onUnlock}><LockKeyholeOpen size={15} aria-hidden="true" />Entsperren</button></div>;
}

/** The bar above the table: what the lock allows right now. */
export function LockBar({ lock, open, onRelink }: { lock: KeychainLock; open: boolean; onRelink: () => void }) {
  if (lock.status === "setup") {
    return <div className="cdm-lock is-todo" role="status"><Smartphone size={18} aria-hidden="true" /><p><strong>Noch nicht eingerichtet.</strong> Verbinde einmal eine Authenticator-App, zum Beispiel die Passwörter-App deines iPhones. Danach öffnet nur ihr Code die Passwörter; deine Anmeldung im Hub bleibt, wie sie ist.</p></div>;
  }
  if (lock.status === "unlocked" && open) {
    const extra = lock.via === "recovery" ? <> <strong>Mit Notfall-Code entsperrt:</strong> noch {lock.recoveryLeft} übrig. Ist dein Handy weg oder neu? <button type="button" className="kc-link" onClick={onRelink}>App neu verbinden</button></> : null;
    return <div className="cdm-lock is-ok" role="status"><ShieldCheck size={18} aria-hidden="true" /><p><strong>Entsperrt bis {clock.format(new Date(lock.until))} Uhr.</strong> Jede Aktion verlängert um {UNLOCK_MINUTES} Minuten, höchstens {MAX_OPEN_MINUTES} am Stück. Ein Passwort bleibt {REVEAL_SECONDS} Sekunden lesbar, jeder Blick steht im Protokoll.{extra}</p></div>;
  }
  if (lock.status === "blocked") {
    return <div className="cdm-lock is-todo" role="status"><ShieldAlert size={18} aria-hidden="true" /><p><strong>Zu viele falsche Codes.</strong> Der Schlüsselbund bleibt bis {clock.format(new Date(lock.until))} Uhr zu. Mit einem Notfall-Code geht es sofort weiter; das Team bekommt in Telegram Bescheid.</p></div>;
  }
  return <div className="cdm-lock" role="status"><LockKeyhole size={18} aria-hidden="true" /><p><strong>Gesperrt.</strong> Zugänge und Benutzernamen siehst du immer. Für ein Passwort tippst du aufs Auge oder auf „Entsperren“ und gibst den Code aus deiner Authenticator-App ein.</p></div>;
}

/** Locks in this sign-in. */
export async function lockNow(api: KeychainLockApi) {
  const result = await lockKeychain().catch(() => null);
  if (result?.ok) api.setLock(result.data.lock);
}

/** Six digits (or a recovery code) as typed or pasted. */
const digits = (value: string) => value.replace(/\D/g, "").slice(0, 6);
const recoveryInput = (value: string) => {
  const raw = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
};

/**
 * Opens the keychain: the app's six digits (they check themselves once complete), or one of the recovery codes.
 * `hint` names what happens after („Danach siehst du das Passwort von …“).
 */
export function UnlockDialog({ lock, hint, onClose, onUnlocked, onLock }: { lock: KeychainLock; hint?: string; onClose: () => void; onUnlocked: (lock: KeychainLock) => void; onLock: (lock: KeychainLock) => void }) {
  const [recovery, setRecovery] = useState(lock.status === "blocked");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, [recovery]);

  async function submit(value: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = recovery ? await unlockKeychainWithRecovery({ code: value }) : await unlockKeychain({ code: value });
      if (result.ok) {
        setDone(true);
        window.setTimeout(() => onUnlocked(result.data.lock), 350);
        return;
      }
      setError(result.error);
      setCode("");
      // The page's bar and button follow at once (attempts left, „Gesperrt bis …“).
      if (result.lock) onLock(result.lock);
      if (result.lock?.status === "blocked") setRecovery(true);
    } catch {
      setError(tryAgain);
    } finally {
      setBusy(false);
    }
  }

  const blocked = lock.status === "blocked" && !recovery;
  return (
    <Modal title={recovery ? "Mit Notfall-Code entsperren" : "Schlüsselbund entsperren"} onClose={onClose} className="kc-dialog">
      <form className="kc-unlock" noValidate onSubmit={(event) => { event.preventDefault(); if (recovery ? code.length === 9 : code.length === 6) submit(code); }}>
        <span className={`kc-unlock-icon${done ? " is-ok" : ""}`}>{done ? <Check size={30} aria-hidden="true" /> : recovery ? <LifeBuoy size={28} aria-hidden="true" /> : <LockKeyhole size={28} aria-hidden="true" />}</span>
        {recovery
          ? <p className="kc-lead">Gib einen deiner 8 Notfall-Codes ein. Jeder Code funktioniert <b>nur einmal</b>.{hint ? ` ${hint}` : ""}</p>
          : <p className="kc-lead">Gib den 6-stelligen Code aus deiner Authenticator-App ein, Eintrag <b>„oalab Schlüsselbund“</b>.{hint ? ` ${hint}` : ""}</p>}
        <input
          ref={input}
          className={`kc-code${recovery ? " is-recovery" : ""}${error ? " is-wrong" : ""}`}
          value={code}
          onChange={(event) => {
            const next = recovery ? recoveryInput(event.target.value) : digits(event.target.value);
            setCode(next);
            setError("");
            if (!recovery && next.length === 6) submit(next);
          }}
          inputMode={recovery ? "text" : "numeric"}
          autoComplete={recovery ? "off" : "one-time-code"}
          autoCapitalize={recovery ? "characters" : "off"}
          spellCheck={false}
          maxLength={recovery ? 9 : 6}
          placeholder={recovery ? "XXXX-XXXX" : "______"}
          aria-label={recovery ? "Notfall-Code" : "Code aus der App"}
          disabled={busy || done || blocked}
        />
        {error && <p className="form-error" role="alert">{error}</p>}
        {busy
          ? <p className="kc-checking"><MiniLoader size={16} />Wird geprüft …</p>
          : <button type="submit" className="sheet-button sheet-button-primary" disabled={done || blocked || (recovery ? code.length !== 9 : code.length !== 6)}><LockKeyholeOpen size={18} aria-hidden="true" />Entsperren</button>}
        <p className="kc-meta"><Timer size={14} aria-hidden="true" />{UNLOCK_MINUTES} Minuten offen · nur in diesem Browser</p>
        <button type="button" className="kc-link" onClick={() => { setRecovery(!recovery); setCode(""); setError(""); }}>
          {recovery ? "Zurück zum Code aus der App" : "Handy nicht zur Hand? Notfall-Code verwenden"}
        </button>
        {lock.status === "blocked" && !recovery && <p className="kc-meta">Nach {LOCK_MINUTES} Minuten geht es mit der App weiter.</p>}
      </form>
    </Modal>
  );
}

/** The recovery codes as a text file to keep apart from the phone. */
function downloadCodes(codes: string[]) {
  const text = ["oalab Schlüsselbund · Notfall-Codes", `Erstellt am ${new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeStyle: "short" }).format(new Date())}`, "Jeder Code öffnet den Schlüsselbund einmal. Getrennt vom Handy aufbewahren.", "", ...codes.map((code, index) => `${index + 1}. ${code}`), ""].join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: "oalab-schluesselbund-notfall-codes.txt" });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** The codes on paper: a small page of its own, printed and closed. */
function printCodes(codes: string[]) {
  const page = window.open("", "_blank", "width=480,height=640");
  if (!page) return;
  page.document.title = "Notfall-Codes";
  const body = page.document.body;
  body.style.font = "16px/1.5 system-ui, sans-serif";
  body.style.padding = "24px";
  const heading = page.document.createElement("h1");
  heading.textContent = "oalab Schlüsselbund · Notfall-Codes";
  heading.style.fontSize = "18px";
  const list = page.document.createElement("ol");
  list.style.fontFamily = "ui-monospace, Menlo, Consolas, monospace";
  for (const code of codes) list.append(Object.assign(page.document.createElement("li"), { textContent: code }));
  const note = Object.assign(page.document.createElement("p"), { textContent: "Jeder Code öffnet den Schlüsselbund einmal. Getrennt vom Handy aufbewahren." });
  body.append(heading, note, list);
  page.focus();
  page.print();
  page.close();
}

/**
 * Linking the app, once, in three steps: a code by mail (so nobody with a stolen sign-in binds the keychain to their
 * phone), the QR code with the first code from the app, and the eight recovery codes, shown only here.
 */
export function SetupDialog({ email, relink = false, onClose, onDone }: { email: string; relink?: boolean; onClose: () => void; onDone: (lock: KeychainLock) => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sent, setSent] = useState(false);
  const [mailCode, setMailCode] = useState("");
  const [appCode, setAppCode] = useState("");
  const [qr, setQr] = useState<{ qr: string; key: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [lock, setLock] = useState<KeychainLock | null>(null);
  const [saved, setSaved] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run<T>(action: () => Promise<KeychainResult<T>>, then: (data: T) => void) {
    setBusy(true);
    setError("");
    try {
      const result = await action();
      if (result.ok) then(result.data);
      else setError(result.error);
    } catch {
      setError(tryAgain);
    } finally {
      setBusy(false);
    }
  }
  const sendCode = () => run(() => sendKeychainSetupCode(), () => setSent(true));
  const checkMail = (value: string) => run(() => confirmKeychainSetupCode({ code: value }), (data) => { setQr(data); setStep(2); setMailCode(""); });
  const checkApp = (value: string) => run(() => confirmKeychainApp({ code: value }), (data) => { setCodes(data.codes); setLock(data.lock); setStep(3); setAppCode(""); });
  const state = (n: number) => (n < step ? "is-done" : n > step ? "is-next" : "is-current");
  const number = (n: number) => <span className="cdm-step-no">{n < step ? <Check size={16} aria-hidden="true" /> : n}</span>;

  return (
    <Modal title={relink ? "App neu verbinden" : "Authenticator einrichten"} onClose={onClose} className="kc-dialog is-wide">
      <div className="kc-setup">
        <p className="cdm-setup-lead">{relink ? "Die bisherige App zählt danach nicht mehr, die alten Notfall-Codes auch nicht." : "Einmalig, etwa zwei Minuten. Danach öffnet nur der Code aus deiner App die Passwörter. Deine Anmeldung im Hub bleibt, wie sie ist."}</p>
        <ol className="cdm-steps">
          <li className={`cdm-step ${state(1)}`}>{number(1)}<div><h3>Bestätigen, dass du es bist</h3>
            {step === 1 ? (
              <>
                <p>Damit niemand mit einer fremden Sitzung den Schlüsselbund an sein Handy bindet, schicken wir dir einen Code an <b>{email || "deine Adresse"}</b>.</p>
                <div className="kc-step-body">
                  {sent ? (
                    <div className="kc-step-row">
                      <input className="kc-code" value={mailCode} onChange={(event) => { const next = digits(event.target.value); setMailCode(next); setError(""); if (next.length === 6) checkMail(next); }} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="______" aria-label="Code aus der E-Mail" disabled={busy} autoFocus />
                      <button type="button" className="sheet-action is-primary" onClick={() => checkMail(mailCode)} disabled={busy || mailCode.length !== 6}>{busy ? <MiniLoader size={15} /> : <Check size={15} aria-hidden="true" />}Weiter</button>
                    </div>
                  ) : (
                    <div className="kc-step-row"><button type="button" className="sheet-action is-primary" onClick={sendCode} disabled={busy}>{busy ? <MiniLoader size={15} /> : <Check size={15} aria-hidden="true" />}Code senden</button></div>
                  )}
                  {sent && <button type="button" className="kc-link" style={{ justifySelf: "start" }} onClick={sendCode} disabled={busy}>Code erneut senden</button>}
                </div>
              </>
            ) : <p>Mit dem Code aus deiner E-Mail bestätigt.</p>}
          </div></li>
          <li className={`cdm-step ${state(2)}`}>{number(2)}<div><h3>App verbinden</h3>
            {step === 2 && qr ? (
              <>
                <p>Scanne den QR-Code mit deiner Authenticator-App und gib dann den Code ein, den sie zeigt.</p>
                <div className="kc-step-body">
                  <div className="kc-qr-row">
                    {/* eslint-disable-next-line @next/next/no-img-element -- an inline SVG data URL made on the server */}
                    <img className="factor-qr" src={qr.qr} alt="QR-Code für die Authenticator-App" width={150} height={150} />
                    <ul className="kc-apps">
                      <li><Smartphone size={15} aria-hidden="true" /><span><b>iPhone, ohne neue App:</b> Kamera auf den QR-Code halten und „Bestätigungscode hinzufügen“ tippen. Der Code steht dann in der App <b>Passwörter</b> unter <b>Codes</b>.</span></li>
                      <li><Smartphone size={15} aria-hidden="true" /><span><b>Oder:</b> Google Authenticator, Microsoft Authenticator oder 1Password.</span></li>
                    </ul>
                  </div>
                  <div className="kc-key">
                    <p className="factor-secret" aria-label="Schlüssel zum Abtippen" translate="no">{qr.key}</p>
                    <button type="button" className="row-action" onClick={async () => { try { await navigator.clipboard.writeText(qr.key.replace(/\s/g, "")); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* blocked: the key stays readable */ } }} aria-label="Schlüssel kopieren" data-tip={copied ? "Kopiert" : "Schlüssel kopieren"}>{copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}</button>
                  </div>
                  <div className="kc-step-row">
                    <input className="kc-code" value={appCode} onChange={(event) => { const next = digits(event.target.value); setAppCode(next); setError(""); if (next.length === 6) checkApp(next); }} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="______" aria-label="Code aus der App" disabled={busy} autoFocus />
                    <button type="button" className="sheet-action is-primary" onClick={() => checkApp(appCode)} disabled={busy || appCode.length !== 6}>{busy ? <MiniLoader size={15} /> : <Check size={15} aria-hidden="true" />}Verbinden</button>
                  </div>
                </div>
              </>
            ) : <p>{step < 2 ? "QR-Code scannen und mit einem Code aus der App bestätigen." : "„oalab Schlüsselbund“ steht jetzt in deiner App."}</p>}
          </div></li>
          <li className={`cdm-step ${state(3)}`}>{number(3)}<div><h3>Notfall-Codes sichern</h3>
            {step === 3 ? (
              <>
                <p>Ist dein Handy weg, öffnet jeder dieser Codes den Schlüsselbund <b>einmal</b>. Leg sie getrennt vom Handy ab, zum Beispiel ausgedruckt im Büro. Sie stehen nur hier, später nicht mehr.</p>
                <div className="kc-step-body">
                  <ol className="kc-codes">{codes.map((code, index) => <li key={code}><span>{index + 1}.</span>{code}</li>)}</ol>
                  <div className="kc-step-row">
                    <button type="button" className="sheet-action" onClick={() => { downloadCodes(codes); setDownloaded(true); }}>{downloaded ? <Check size={15} aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}{downloaded ? "Heruntergeladen" : "Herunterladen"}</button>
                    <button type="button" className="sheet-action" onClick={() => printCodes(codes)}><Printer size={15} aria-hidden="true" />Drucken</button>
                  </div>
                  <label className="kc-check"><input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} /><span>Ich habe die Notfall-Codes sicher abgelegt.</span></label>
                  <button type="button" className="sheet-button sheet-button-primary" disabled={!saved || !lock} onClick={() => lock && onDone(lock)}><BadgeCheck size={18} aria-hidden="true" />Fertig, Schlüsselbund ist bereit</button>
                </div>
              </>
            ) : <p>8 Codes für den Notfall, jeder nur einmal gültig.</p>}
          </div></li>
        </ol>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
