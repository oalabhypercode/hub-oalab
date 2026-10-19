import { LockKeyhole } from "lucide-react";
import { BackgroundLayer } from "@/components/hub/background-layer";
import { BrandLogo, Wordmark } from "@/components/hub/wordmark";

/** Authentication frame: the hub's selectable background with the form on one matte glass card. */
export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <BackgroundLayer />
      <header className="auth-topbar"><Wordmark href="/" /></header>
      <div className="auth-layout">
        <section className="auth-intro" aria-label="Willkommen bei oalab">
          <div className="auth-intro-text">
            <p className="auth-intro-caption">Gute Ideen brauchen ein Wir.</p>
            <h1 className="t-large-title">Zusammen.<br />Weiter.</h1>
            <p className="t-body auth-intro-body">Ein Ort für deine Projekte. Und alles, was wir gemeinsam bewegen.</p>
          </div>
          <p className="auth-intro-note">Von der ersten Idee. Bis zum guten Gefühl.</p>
          {/* Original logo as a faint watermark, only made translucent (never recoloured). */}
          <div className="auth-sculpture" aria-hidden="true"><BrandLogo preload /></div>
        </section>
        <section className="glass glass-float auth-card">{children}</section>
      </div>
      <footer className="auth-footer"><span>oalab Client Hub</span><span><LockKeyhole size={13} aria-hidden="true" />Dein geschützter Workspace</span></footer>
    </main>
  );
}
