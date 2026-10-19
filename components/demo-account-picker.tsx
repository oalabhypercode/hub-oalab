"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Building2, ChevronDown, Loader2, ShieldCheck, UserRound } from "lucide-react";
import type { DemoLoginOption } from "@/lib/demo-login-policy";

const title = (account: DemoLoginOption) => (account.role === "oalab_admin" ? "OALAB Admin" : account.company);

/**
 * Demo accounts as a dropdown. Every option stays in the HTML (hidden while closed),
 * submits its own same-origin POST and signs in with one click.
 */
export function DemoAccountPicker({ accounts, publicDemo = false }: { accounts: DemoLoginOption[]; publicDemo?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const focusOnOpen = useRef<number | null>(null);
  const pendingAccount = accounts.find((account) => account.id === pending);

  useEffect(() => {
    if (!open) return;
    if (focusOnOpen.current !== null) {
      items.current[focusOnOpen.current]?.focus();
      focusOnOpen.current = null;
    }
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  function openAt(index: number) {
    focusOnOpen.current = index;
    if (open) { items.current[index]?.focus(); focusOnOpen.current = null; } else setOpen(true);
  }

  function onTriggerKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openAt(event.key === "ArrowDown" ? 0 : accounts.length - 1);
    }
  }

  function onItemKeyDown(event: React.KeyboardEvent, index: number) {
    const last = accounts.length - 1;
    const target = { ArrowDown: index === last ? 0 : index + 1, ArrowUp: index === 0 ? last : index - 1, Home: 0, End: last }[event.key];
    if (target !== undefined) {
      event.preventDefault();
      items.current[target]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    }
  }

  return (
    <section className="demo-login-panel" aria-labelledby="demo-login-title">
      <div className="demo-login-heading"><h3 id="demo-login-title">Direkt in die Demo</h3><span>{publicDemo ? "Öffentliche Demo" : "Nur lokal"}</span></div>
      <p>Wähle ein Testkonto. Wir melden dich direkt an.</p>
      <div
        ref={root}
        className="demo-login-dropdown"
        onBlur={(event) => { if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false); }}
      >
        <button
          ref={trigger}
          type="button"
          className="demo-login-trigger"
          aria-expanded={open}
          aria-controls={menuId}
          disabled={pending !== null}
          onClick={() => setOpen((value) => !value)}
          onKeyDown={onTriggerKeyDown}
        >
          {pending ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <UserRound size={18} aria-hidden="true" />}
          <span className="demo-login-trigger-label">{pendingAccount ? `${title(pendingAccount)} wird geöffnet …` : "Testkonto wählen"}</span>
          <ChevronDown size={18} className="demo-login-chevron" aria-hidden="true" />
        </button>
        <ul id={menuId} className="demo-login-menu" hidden={!open} aria-label="Testkonten">
          {accounts.map((account, index) => {
            const admin = account.role === "oalab_admin";
            const Icon = admin ? ShieldCheck : Building2;
            return (
              <li key={account.id}>
                <form action="/auth/demo" method="post" onSubmit={() => { setPending(account.id); setOpen(false); }}>
                  <input type="hidden" name="account" value={account.id} />
                  <button
                    ref={(element) => { items.current[index] = element; }}
                    type="submit"
                    className={`demo-login-card${admin ? " demo-login-card-admin" : ""}`}
                    disabled={pending !== null}
                    aria-label={`Als ${title(account)} anmelden (${account.name})`}
                    onKeyDown={(event) => onItemKeyDown(event, index)}
                  >
                    <Icon size={18} className="demo-login-card-icon" aria-hidden="true" />
                    <span className="demo-login-card-text"><strong>{title(account)}</strong><small>{account.name}</small></span>
                    <span className="demo-login-card-role">{admin ? "Admin" : "Kunde"}</span>
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      </div>
      <span className="demo-login-note" role="status">{pending ? "Dein Demo-Workspace wird geöffnet …" : publicDemo ? "Nur Beispieldaten · getrennt von echten Konten · keine persönlichen Daten eingeben" : "Echter Login · ausschließlich fiktive Kundendaten"}</span>
      <div className="demo-login-divider"><span />Oder mit deinem Konto<span /></div>
    </section>
  );
}
