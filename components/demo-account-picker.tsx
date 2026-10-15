"use client";

import { useState } from "react";
import { ArrowUpRight, Building2, Loader2, ShieldCheck } from "lucide-react";
import type { DemoLoginOption } from "@/lib/demo-login-policy";

export function DemoAccountPicker({ accounts, publicDemo = false }: { accounts: DemoLoginOption[]; publicDemo?: boolean }) {
  const [pending, setPending] = useState<string | null>(null);
  return (
    <section className="demo-login-panel" aria-labelledby="demo-login-title">
      <div className="demo-login-heading"><h3 id="demo-login-title">Direkt in die Demo</h3><span>{publicDemo ? "Öffentliche Demo" : "Nur lokal"}</span></div>
      <p>Wähle ein Testkonto. Wir melden dich direkt an.</p>
      <div className="demo-login-grid">
        {accounts.map((account) => {
          const admin = account.role === "oalab_admin";
          const title = admin ? "OALAB Admin" : account.company;
          const Icon = admin ? ShieldCheck : Building2;
          return (
            <form key={account.id} action="/auth/demo" method="post" onSubmit={() => setPending(account.id)}>
              <input type="hidden" name="account" value={account.id} />
              <button type="submit" className={`demo-login-card${admin ? " demo-login-card-admin" : ""}`} disabled={pending !== null} aria-label={`Als ${title} anmelden`} aria-busy={pending === account.id}>
                <span className="demo-login-card-top"><Icon size={16} /><span>{admin ? "ADMIN" : "CUSTOMER"}</span>{pending === account.id ? <Loader2 size={15} className="spin" /> : <ArrowUpRight size={15} />}</span>
                <strong>{title}</strong><small>{account.name}</small>
              </button>
            </form>
          );
        })}
      </div>
      <span className="demo-login-note" role="status">{pending ? "Dein Demo-Workspace wird geöffnet …" : publicDemo ? "Nur Beispieldaten · getrennt von echten Konten · keine persönlichen Daten eingeben" : "Echter Login · ausschließlich fiktive Kundendaten"}</span>
      <div className="demo-login-divider"><span />ODER MIT DEINEM KONTO<span /></div>
    </section>
  );
}
