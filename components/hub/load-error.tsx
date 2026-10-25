"use client";

import { catchError, type ErrorInfo } from "next/error";
import { RefreshCw } from "lucide-react";
import { AppShell } from "./app-shell";
import { GlassCard } from "./glass";

const copy = {
  eyebrow: "Kurz keine Verbindung.",
  title: ["Dein Konto lädt", "gerade nicht."],
  text: "Deine Daten sind sicher. Die Verbindung zum Hub hat nur kurz gehakt – lade neu, meist klappt es sofort.",
};

/** Shown when the account could not be read: never "pending" or "no company" for a failed read. */
function WorkspaceLoadError(_props: { children?: React.ReactNode }, { retry }: ErrorInfo) {
  return (
    <AppShell pending>
      <GlassCard className="empty-state section-first load-error" role="alert">
        <span className="eyebrow">{copy.eyebrow}</span>
        <h2 className="t-title3">{copy.title.join(" ")}</h2>
        <p className="t-body t-secondary">{copy.text}</p>
        <button type="button" className="button-primary" onClick={() => retry()}><RefreshCw size={18} aria-hidden="true" />Neu laden</button>
      </GlassCard>
    </AppShell>
  );
}

/** Error boundary around the signed-in workspace; the layout's own error.js would not cover it. */
export const HubLoadBoundary = catchError(WorkspaceLoadError);

/** The same message inside the sign-in frame (pending page). */
export function AuthLoadError({ retry }: { retry: () => void }) {
  return (
    <div className="auth-form" role="alert">
      <span className="auth-success-icon" aria-hidden="true"><RefreshCw size={26} /></span>
      <span className="eyebrow">{copy.eyebrow}</span>
      <h2>{copy.title[0]}<br />{copy.title[1]}</h2>
      <p>{copy.text}</p>
      <button type="button" className="button-primary full-width" onClick={() => retry()}><RefreshCw size={18} aria-hidden="true" />Neu laden</button>
    </div>
  );
}
