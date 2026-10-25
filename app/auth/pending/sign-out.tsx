"use client";

import { useState } from "react";
import { Loader2, LogOut } from "lucide-react";
import { signOutAction } from "@/lib/hub-auth/actions";

/** Leaves the waiting page: ends the Supabase session and starts again at the login. */
export function PendingSignOut() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signOut() {
    setBusy(true);
    setError("");
    // On the server: the shared session cookie is HTTP-only, and signing out here signs out of Service OALab too.
    const result = await signOutAction().catch(() => null);
    if (!result?.ok) { setBusy(false); setError("Abmelden nicht möglich. Bitte versuche es erneut."); return; }
    window.location.replace("/auth/login");
  }
  return <>
    <button type="button" className="button-secondary full-width pending-sign-out" onClick={signOut} disabled={busy}>{busy ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <LogOut size={18} aria-hidden="true" />}Abmelden</button>
    {error && <p className="form-error" role="alert">{error}</p>}
  </>;
}
