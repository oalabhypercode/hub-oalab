"use client";

import { useState } from "react";
import { Loader2, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/** Leaves the waiting page: ends the Supabase session and starts again at the login. */
export function PendingSignOut() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signOut() {
    setBusy(true);
    setError("");
    const { error: failure } = await createClient().auth.signOut();
    if (failure) { setBusy(false); setError("Abmelden nicht möglich. Bitte versuche es erneut."); return; }
    window.location.replace("/auth/login");
  }
  return <>
    <button type="button" className="button-secondary full-width pending-sign-out" onClick={signOut} disabled={busy}>{busy ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <LogOut size={18} aria-hidden="true" />}Abmelden</button>
    {error && <p className="form-error" role="alert">{error}</p>}
  </>;
}
